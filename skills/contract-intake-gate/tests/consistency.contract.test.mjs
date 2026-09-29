import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import { parse } from 'yaml'
import { decideReceiptAdmission } from '../lib/intake-decision.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const intakeRoot = path.resolve(here, '../../..')
const read = (p) => readFile(p, 'utf8')
const fixture = async (name) => parse(await read(path.join(here, 'fixtures', name)))
const validator = async () => new Ajv({ strict: false }).compile(JSON.parse(await read(path.join(intakeRoot, 'skills/contract-intake-gate/schemas/intake-receipt.schema.json'))))

test('frontmatter is byte-zero YAML and skill versions are internally consistent', async () => {
  const text = await read(path.join(intakeRoot, 'skills/contract-intake-gate/SKILL.md'))
  assert.equal(text.startsWith('---\n'), true)
  const end = text.indexOf('\n---\n', 4)
  assert.ok(end > 4)
  const frontmatter = parse(text.slice(4, end))
  const agent = JSON.parse(await read(path.join(intakeRoot, 'agent.json')))
  assert.equal(frontmatter.version, '1.0.7')
  assert.equal(frontmatter.metadata.version, '1.0.7')
  assert.equal(agent.version, '1.0.7')
})

test('real Draft-07 schema accepts the valid document and rejects the combined review counterexample', async () => {
  const validate = await validator()
  const valid = await fixture('schema-valid.receipt.yaml')
  assert.equal(validate(valid), true, JSON.stringify(validate.errors))
  const bad = structuredClone(valid)
  bad.verdict = 'blocked'
  bad.blocks = []
  bad.checks = Array.from({ length: 8 }, () => ({ id: 'S1', status: 'pass', source_scope: 'same', action: 'same' }))
  bad.serialization_status = 'invalid'
  bad.handoff.to = 'contract-review-lead'
  assert.equal(validate(bad), false)
})

test('each receipt contradiction is independently rejected', async () => {
  const validate = await validator()
  const valid = await fixture('schema-valid.receipt.yaml')
  const mutations = [
    (x) => { x.verdict = 'blocked'; x.blocks = [] },
    (x) => { x.checks[1].id = 'S1' },
    (x) => { x.serialization_status = 'invalid'; x.handoff.to = 'contract-review-lead' },
    (x) => { x.blocks = [{}]; x.verdict = 'blocked'; x.handoff.to = null },
    (x) => { x.flags = [{}] },
    (x) => { x.scope_facts = [{}] },
    (x) => { x.handoff.pending = [{}] },
    (x) => { x.handoff.scope.in_scope = [] },
    (x) => { x.verdict = 'passed'; x.flags = [{ id: 'FLG-X', source_scope: 'body', action: 'clarify', quote: 'x', gate_affecting: true }] },
    (x) => { x.verdict = 'conditional'; x.flags = [{ id: 'FLG-X', source_scope: 'body', action: 'record only', quote: 'x', gate_affecting: false }] },
    (x) => { delete x.party_assessments },
    (x) => { delete x.party_assessments[0].role_source },
    (x) => { x.party_assessments[1].identifier_applicability = 'not_applicable'; x.party_assessments[1].identifier_status = 'present'; x.party_assessments[1].identifier_value = 'should-not-exist' },
    (x) => { delete x.freeze },
    (x) => { delete x.conclusions.consistency_conclusion_allowed },
    (x) => { x.freeze.attachment_manifest.frozen = false; x.conclusions.consistency_conclusion_allowed = true },
    (x) => { x.checks.find(({ id }) => id === 'S7').status = 'flag'; x.flags = []; x.verdict = 'passed' },
  ]
  for (const mutate of mutations) {
    const bad = structuredClone(valid); mutate(bad)
    assert.equal(validate(bad), false, `mutation unexpectedly accepted: ${JSON.stringify(bad)}`)
  }
})

test('real Draft-07 schema accepts required, not_applicable and unknown role receipts without conflating them', async () => {
  const validate = await validator()
  const valid = await fixture('schema-valid.receipt.yaml')
  valid.party_assessments.push({
    party_id: 'PARTY-UNCLEAR', party_role: 'unknown', role_source: 'unlabelled signature line',
    identifier_applicability: 'unknown', identifier_status: 'unknown', basis: 'role must be clarified from source',
  })
  assert.equal(validate(valid), true, JSON.stringify(validate.errors))

  const missingRequired = structuredClone(valid)
  missingRequired.party_assessments[0].identifier_status = 'missing'
  delete missingRequired.party_assessments[0].identifier_value
  missingRequired.checks.find(({ id }) => id === 'S7').status = 'flag'
  missingRequired.verdict = 'conditional'
  missingRequired.flags = [{ id: 'FLG-PARTY-ID-ABSENT', source_scope: 'customer party block', action: 'obtain identifier', search_patterns: ['统一社会信用代码'], gate_affecting: true }]
  assert.equal(validate(missingRequired), true, JSON.stringify(validate.errors))
})

test('a blocking finding elsewhere takes precedence over an S7 flag', async () => {
  const validate = await validator()
  const receipt = await fixture('schema-valid.receipt.yaml')
  receipt.checks.find(({id}) => id === 'S7').status = 'flag'
  receipt.checks.find(({id}) => id === 'S6').status = 'block'
  receipt.flags = [{id:'FLG-PARTY-ID-ABSENT',source_scope:'main party block',action:'clarify required identifier',search_patterns:['registration number'],gate_affecting:true}]
  receipt.blocks = [{id:'BLK-PLACEHOLDER',source_scope:'price clause',action:'fill missing price',quote:'price: ____'}]
  receipt.verdict = 'blocked'
  receipt.handoff.to = null
  assert.equal(validate(receipt), true, JSON.stringify(validate.errors))
  const wrong = structuredClone(receipt)
  wrong.verdict = 'conditional'
  assert.equal(validate(wrong), false)
})

test('tool success with report.valid false is denied by the real admission decision', async () => {
  const receipt = await fixture('schema-valid.receipt.yaml')
  assert.deepEqual(decideReceiptAdmission({ toolSuccess: true, validationReport: { valid: false }, receipt }), { startO2: false, reason: 'schema_invalid' })
  assert.deepEqual(decideReceiptAdmission({ toolSuccess: true, validationReport: { valid: true }, receipt }), { startO2: true, reason: 'admitted' })
})

test('skill records role applicability and write-once sidecar validation semantics', async () => {
  const skill = await read(path.join(intakeRoot, 'skills/contract-intake-gate/SKILL.md'))
  assert.match(skill, /party_role/)
  assert.match(skill, /identifier_applicability/)
  assert.match(skill, /valid:true/)
  assert.match(skill, /sidecar[^\n]*不自引用/)
})
