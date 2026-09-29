// schemas/intake-receipt.schema.json 的契约测试。
//
// 这份 Schema 由 SKILL.md 前置规则第 6 条交给 StructuredFileValidate 使用，所以这里的
// Ajv 选项与 YAML 解析参数刻意照抄平台校验器（desirecore
// packages/agent-service/src/structured-file-validate/validator.ts）：本地通过、平台拒收的
// Schema 会让 intake 永远走兜底分支，重新回到「passed 不可达」。
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import YAML from 'yaml'

const testsDir = path.dirname(fileURLToPath(import.meta.url))
const skillDir = path.dirname(testsDir)
const fixturesDir = path.join(testsDir, 'fixtures')

function parseLikePlatform(text) {
  const documents = YAML.parseAllDocuments(text, { schema: 'core', strict: true, uniqueKeys: true, maxAliasCount: 0, merge: false, customTags: [] })
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

const fixtureNames = (await readdir(fixturesDir)).filter((name) => name.endsWith('.yaml')).sort()
const fixture = async (name) => parseLikePlatform(await readFile(path.join(fixturesDir, name), 'utf8'))
const clone = (value) => JSON.parse(JSON.stringify(value))

test('schema uses only the Draft-07 dialect the platform validator accepts', () => {
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#')
})

test('every receipt fixture parses like the platform and matches the schema', async () => {
  assert.ok(fixtureNames.length >= 8, 'fixtures went missing; this test would pass vacuously')
  for (const name of fixtureNames) {
    const ok = validate(await fixture(name))
    assert.equal(ok, true, `${name}: ${JSON.stringify(validate.errors)}`)
  }
})

test('free-form summary files only need legal verdict vocabulary', () => {
  const summary = { intake: { verdict: 'blocked', verdict_label: '拒绝', blocks: [{ gate_reason_id: 'attachment-missing' }], handoff_to: null } }
  assert.equal(validate(summary), true, JSON.stringify(validate.errors))
  assert.equal(validate({ intake: { verdict: 'blocked', verdict_label: '条件通过' } }), false)
})

test('passed may carry S8 version-unavailable flags but no verdict-affecting flag', async () => {
  const receipt = await fixture('complete-manifest.receipt.yaml')
  const withCoverageGap = clone(receipt)
  withCoverageGap.contract_intake_receipt.flags = [
    { code: 'FLG-SERVER-VERSION-UNAVAILABLE', gate_reason_id: null, severity: 'flag' },
    { code: 'FLG-PARSER-REVISION-UNAVAILABLE', gate_reason_id: null, severity: 'flag' },
  ]
  assert.equal(validate(withCoverageGap), true, JSON.stringify(validate.errors))

  const withRealFlag = clone(receipt)
  withRealFlag.contract_intake_receipt.flags = [{ code: 'FLG-JURISDICTION-UNDETERMINED', gate_reason_id: null, severity: 'flag' }]
  assert.equal(validate(withRealFlag), false)
})

test('schema rejects receipts downstream would misread', async () => {
  const passed = await fixture('complete-manifest.receipt.yaml')
  const blocked = await fixture('incomplete-signature.receipt.yaml')
  const conditional = await fixture('r02-manifest-incomplete.receipt.yaml')
  const cases = [
    ['非法三态字面量', passed, (r) => { r.verdict = 'pass' }],
    ['标签与结论不对应', passed, (r) => { r.verdict_label = '条件通过' }],
    ['blocked 仍交接', blocked, (r) => { r.handoff.to = 'clause-extractor' }],
    ['conditional 不交接', conditional, (r) => { r.handoff.to = null }],
    ['conditional 带阻断项', conditional, (r) => { r.blocks = [{ code: 'BLK-ATTACHMENT-MISSING', severity: 'block' }] }],
    ['must_escalate 写成字符串', conditional, (r) => { r.handoff.pending[0].must_escalate = 'true' }],
    ['待办编号不合规', conditional, (r) => { r.handoff.pending[0].id = 'P1' }],
    ['判定编码不合规', conditional, (r) => { r.flags[0].code = 'flg-attachment' }],
    ['正式回执缺 handoff', passed, (r) => { delete r.handoff }],
  ]
  for (const [label, base, mutate] of cases) {
    const receipt = clone(base)
    mutate(receipt.contract_intake_receipt)
    assert.equal(validate(receipt), false, `${label} 应被拒绝`)
  }
})

test('an unquoted colon inside a scalar is a parse error, not a warning', () => {
  // 2026-09-29 真机：intake.yaml 第 164 行写成 `quote: yaml_unverified: true`，整份文件读不出来。
  assert.throws(() => parseLikePlatform('evidence:\n  quote: yaml_unverified: true\n'), /INVALID_YAML/)
  assert.deepEqual(parseLikePlatform("evidence:\n  quote: 'yaml_unverified: true'\n"), { evidence: { quote: 'yaml_unverified: true' } })
})
