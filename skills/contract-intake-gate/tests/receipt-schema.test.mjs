import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import YAML from 'yaml'

const testsDir = path.dirname(fileURLToPath(import.meta.url))
const skillDir = path.dirname(testsDir)

function parseLikePlatform(text) {
  const documents = YAML.parseAllDocuments(text, {
    schema: 'core', strict: true, uniqueKeys: true, maxAliasCount: 0, merge: false, customTags: [],
  })
  if (documents.length !== 1 || documents[0].errors.length > 0) throw new Error('INVALID_YAML')
  return documents[0].toJS({ maxAliasCount: 0, mapAsMap: false })
}

const schema = JSON.parse(await readFile(path.join(skillDir, 'schemas', 'intake-receipt.schema.json'), 'utf8'))
const validate = new Ajv({
  strictSchema: true,
  allowMatchingProperties: true,
  strictRequired: false,
  strictTypes: false,
  validateSchema: true,
  allErrors: false,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  addUsedSchema: false,
  inlineRefs: false,
  validateFormats: false,
  logger: false,
}).compile(schema)

const readFixture = async (name) => parseLikePlatform(await readFile(path.join(testsDir, 'fixtures', name), 'utf8'))

test('schema compiles with the platform Draft-07 Ajv profile and validates the live flat receipt', async () => {
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#')
  const receipt = await readFixture('schema-valid.receipt.yaml')
  assert.equal(validate(receipt), true, JSON.stringify(validate.errors))
  assert.equal('contract_intake_receipt' in receipt, false, 'live machine receipt must remain flat')
})

test('passed accepts exactly the four S8 unavailable flags and rejects a real business flag', async () => {
  const allowed = [
    'FLG-SKILL-VERSION-UNAVAILABLE',
    'FLG-SERVER-VERSION-UNAVAILABLE',
    'FLG-KNOWLEDGE-BASE-VERSION-UNAVAILABLE',
    'FLG-PARSER-REVISION-UNAVAILABLE',
  ]
  for (const id of allowed) {
    const receipt = await readFixture('schema-valid.receipt.yaml')
    receipt.flags = [{ id, source_scope: 'runtime version matrix', action: 'record coverage debt', search_patterns: [id], gate_affecting: false }]
    assert.equal(validate(receipt), true, `${id}: ${JSON.stringify(validate.errors)}`)
  }

  const businessFlag = await readFixture('schema-valid.receipt.yaml')
  businessFlag.flags = [{ id: 'FLG-JURISDICTION-UNDETERMINED', source_scope: 'governing-law search', action: 'clarify jurisdiction', search_patterns: ['governing law'], gate_affecting: true }]
  assert.equal(validate(businessFlag), false, 'a verdict-affecting FLG must not coexist with passed')
})

test('conditional still requires a verdict-affecting flag and BLK remains dominant', async () => {
  const conditional = await readFixture('schema-valid.receipt.yaml')
  conditional.verdict = 'conditional'
  conditional.flags = [{ id: 'FLG-JURISDICTION-UNDETERMINED', source_scope: 'governing-law search', action: 'clarify jurisdiction', search_patterns: ['governing law'], gate_affecting: true }]
  assert.equal(validate(conditional), true, JSON.stringify(validate.errors))

  const blocked = structuredClone(conditional)
  blocked.blocks = [{ id: 'BLK-PLACEHOLDER', source_scope: 'price clause', action: 'fill the price', quote: 'price: ____' }]
  blocked.verdict = 'blocked'
  blocked.handoff.to = null
  assert.equal(validate(blocked), true, JSON.stringify(validate.errors))
  blocked.verdict = 'conditional'
  assert.equal(validate(blocked), false, 'a BLK finding must force blocked')
})

test('conditional requires the canonical Lead route instead of null, blank or another member', async () => {
  const receipt = await readFixture('schema-valid.receipt.yaml')
  receipt.verdict = 'conditional'
  receipt.flags = [{ id: 'FLG-PARTY-ID-ABSENT', source_scope: 'party block', action: 'request identifier', search_patterns: ['registration number'], gate_affecting: true }]
  assert.equal(validate(receipt), true, JSON.stringify(validate.errors))
  for (const to of [null, '', ' ', 'risk-scanner']) {
    const bad = structuredClone(receipt)
    bad.handoff.to = to
    assert.equal(validate(bad), false, `conditional route ${JSON.stringify(to)} must be rejected`)
  }
})

test('S8 unavailable flags cannot become business flags by flipping their boolean', async () => {
  const ids = ['FLG-SKILL-VERSION-UNAVAILABLE', 'FLG-SERVER-VERSION-UNAVAILABLE', 'FLG-KNOWLEDGE-BASE-VERSION-UNAVAILABLE', 'FLG-PARSER-REVISION-UNAVAILABLE']
  const flag = (id, gate_affecting) => ({ id, gate_affecting, source_scope: 'version matrix', action: 'retain version gap', search_patterns: [id] })
  for (const selected of [...ids.map(id => [id]), ids]) {
    const receipt = await readFixture('schema-valid.receipt.yaml')
    receipt.verdict = 'conditional'
    receipt.flags = selected.map(id => flag(id, true))
    assert.equal(validate(receipt), false, `coverage-only conditional must fail: ${selected}`)
  }
  const mixed = await readFixture('schema-valid.receipt.yaml')
  mixed.verdict = 'conditional'
  mixed.flags = [...ids.map(id => flag(id, false)), flag('FLG-PARTY-ID-ABSENT', true)]
  assert.equal(validate(mixed), true, JSON.stringify(validate.errors))
  mixed.flags[0].gate_affecting = true
  assert.equal(validate(mixed), false, 'real business debt must not hide a mislabeled coverage flag')
  mixed.flags[0].gate_affecting = false
  mixed.blocks = [{ id: 'BLK-PLACEHOLDER', source_scope: 'price', action: 'fill price', quote: '____' }]
  mixed.verdict = 'blocked'
  mixed.handoff.to = null
  assert.equal(validate(mixed), true, JSON.stringify(validate.errors))
})

test('strict platform YAML parser rejects malformed scalars and duplicate keys', () => {
  assert.throws(() => parseLikePlatform('evidence:\n  quote: yaml_unverified: true\n'), /INVALID_YAML/)
  assert.throws(() => parseLikePlatform('verdict: passed\nverdict: blocked\n'), /INVALID_YAML/)
  assert.deepEqual(parseLikePlatform("evidence:\n  quote: 'yaml_unverified: true'\n"), { evidence: { quote: 'yaml_unverified: true' } })
})

test('skill keeps validator failure separate from the business verdict', async () => {
  const skill = await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')
  assert.match(skill, /工具失败属于 capability\/serialization debt，不伪装成合同 FLG 或自动把合同 verdict 降为 conditional/)
  assert.match(skill, /不启动下游、不把工具失败改成合同 conditional/)
  assert.match(skill, /document_sha256/)
  assert.match(skill, /schema_sha256/)
})
