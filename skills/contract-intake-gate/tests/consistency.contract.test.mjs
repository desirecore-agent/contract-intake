import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import { parse } from 'yaml'
import { decideReceiptAdmission } from '../lib/intake-decision.mjs'
import { buildIntakeArtifactPaths, createValidationSidecar, validateRerunIdentity } from '../lib/intake-artifacts.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const intakeRoot = path.resolve(here, '../../..')
const read = (p) => readFile(p, 'utf8')
const fixture = async (name) => parse(await read(path.join(here, 'fixtures', name)))
const validator = async () => new Ajv({ strict: false }).compile(JSON.parse(await read(path.join(intakeRoot, 'skills/contract-intake-gate/schemas/intake-receipt.schema.json'))))

// This fixture models a trusted validator response, not a live tool invocation.
async function admissionInput(receipt) {
  const schemaBytes = await readFile(path.join(intakeRoot, 'skills/contract-intake-gate/schemas/intake-receipt.schema.json'))
  const documentBytes = Buffer.from(JSON.stringify(receipt), 'utf8')
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const expectedDocumentSha256 = digest(documentBytes)
  const expectedSchemaSha256 = digest(schemaBytes)
  return { receipt: JSON.parse(documentBytes), toolSuccess: true, expectedDocumentSha256, expectedSchemaSha256,
    validationReport: { valid: true, document_sha256: expectedDocumentSha256, schema_sha256: expectedSchemaSha256 } }
}

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
    (x) => { x.party_assessments[0].identifier_applicability = 'required'; x.party_assessments[0].identifier_status = 'unknown'; delete x.party_assessments[0].identifier_value },
    (x) => { x.party_assessments[1].identifier_applicability = 'unknown'; x.party_assessments[1].identifier_status = 'redacted' },
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

  const windowsSource = structuredClone(valid)
  windowsSource.object.source_path = 'C:\\authorized\\contracts\\example.md'
  assert.equal(validate(windowsSource), true, JSON.stringify(validate.errors))
  windowsSource.object.source_path = 'authorized\\contracts\\example.md'
  assert.equal(validate(windowsSource), false)
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

test('admission separates tool failure, schema invalidity and business gates', async () => {
  const receipt = await fixture('schema-valid.receipt.yaml')
  const input = await admissionInput(receipt)
  assert.deepEqual(decideReceiptAdmission({ ...input, validationReport: { ...input.validationReport, valid: false } }), { startO2: false, reason: 'schema_invalid' })
  assert.deepEqual(decideReceiptAdmission(input), { startO2: true, reason: 'admitted' })
  assert.deepEqual(decideReceiptAdmission({ ...input, toolSuccess: false }), { startO2: false, reason: 'validator_tool_failed' })
  for (const verdict of ['blocked', 'unknown', undefined, 'invalid']) {
    assert.deepEqual(decideReceiptAdmission(await admissionInput({ ...receipt, verdict })), { startO2: false, reason: 'business_blocked' })
  }
})

test('admission fails closed unless both validator hashes bind the read receipt and schema', async () => {
  const input = await admissionInput(await fixture('schema-valid.receipt.yaml'))
  assert.equal(decideReceiptAdmission(input).startO2, true)
  const mutations = [
    (x) => { delete x.expectedDocumentSha256 },
    (x) => { delete x.expectedSchemaSha256 },
    (x) => { delete x.validationReport.document_sha256 },
    (x) => { delete x.validationReport.schema_sha256 },
    (x) => { x.validationReport.document_sha256 = '0'.repeat(64) },
    (x) => { x.validationReport.schema_sha256 = '0'.repeat(64) },
    (x) => { x.expectedDocumentSha256 = 'not-a-digest' },
  ]
  for (const mutate of mutations) {
    const bad = structuredClone(input); mutate(bad)
    assert.equal(decideReceiptAdmission(bad).startO2, false, String(mutate))
  }
})

test('admission rejects malformed input with a bounded result', () => {
  for (const value of [undefined, null, 1, 'receipt', [], {}]) {
    assert.doesNotThrow(() => decideReceiptAdmission(value))
    assert.equal(decideReceiptAdmission(value).startO2, false)
  }
})

test('skill records role applicability and write-once sidecar validation semantics', async () => {
  const skill = await read(path.join(intakeRoot, 'skills/contract-intake-gate/SKILL.md'))
  assert.match(skill, /party_role/)
  assert.match(skill, /identifier_applicability/)
  assert.match(skill, /valid:true/)
  assert.match(skill, /sidecar[^\n]*不自引用/)
})

test('intake artifact layout keeps machine, detail and validation files run-local and distinct', () => {
  const roots = ['/authorized/review/C-1/O-1/V-1/R-1', 'C:\\authorized\\review\\C-2\\O-2\\V-2\\R-2']
  for (const [index, canonicalRoot] of roots.entries()) {
    const intakeId = `INTAKE-${index + 1}`
    const paths = buildIntakeArtifactPaths({ canonicalRoot, intakeId })
    assert.equal(new Set(Object.values(paths)).size, 3)
    assert.match(paths.receipt, new RegExp(`intake[/\\\\]${intakeId}\\.receipt\\.yaml$`))
    assert.match(paths.detail, new RegExp(`intake[/\\\\]${intakeId}\\.detail\\.yaml$`))
    assert.match(paths.validation, new RegExp(`intake[/\\\\]${intakeId}\\.validation\\.json$`))
  }
  assert.throws(() => buildIntakeArtifactPaths({ canonicalRoot: 'relative/C/O/V/R', intakeId: 'INTAKE-X' }), /absolute/)
})

test('validation sidecar binds actual validator report hashes and fails closed on mismatch', () => {
  const report = {
    valid: false, code: 'SCHEMA_MISMATCH', pointer: '/verdict', document_sha256: 'a'.repeat(64),
    schema_sha256: 'b'.repeat(64), report_sha256: 'c'.repeat(64), profile: 'bounded-local-draft7-v1', version: '1', format: 'yaml',
  }
  const sidecar = createValidationSidecar({
    intakeId: 'INTAKE-1', documentPath: '/authorized/C/O/V/R/intake/INTAKE-1.receipt.yaml',
    schemaPath: '/installed/contract-intake/schemas/intake-receipt.schema.json', format: 'yaml',
    documentSha256: 'a'.repeat(64), schemaSha256: 'b'.repeat(64), toolSuccess: true,
    validationReport: report,
  })
  assert.equal(sidecar.tool_success, true)
  assert.equal(sidecar.schema_valid, false)
  assert.equal(sidecar.validator_report_sha256, report.report_sha256)
  assert.equal(sidecar.diagnostics[0].pointer, '/verdict')
  assert.equal('verdict' in sidecar, false)
  assert.equal(sidecar.document.path.endsWith('.receipt.yaml'), true)
  assert.equal(sidecar.schema.path.endsWith('intake-receipt.schema.json'), true)
  const mismatch = createValidationSidecar({
    intakeId: 'INTAKE-1', documentPath: '/authorized/C/O/V/R/intake/INTAKE-1.receipt.yaml',
    schemaPath: '/installed/contract-intake/schemas/intake-receipt.schema.json', format: 'yaml',
    documentSha256: 'a'.repeat(64), schemaSha256: 'b'.repeat(64), toolSuccess: true,
    validationReport: { ...report, valid: true, document_sha256: 'd'.repeat(64) },
  })
  assert.equal(mismatch.schema_valid, false)
  assert.equal(mismatch.diagnostics[0].code, 'document_sha256_mismatch')
})

test('supplemental material requires a new run root and intake id without mutating the prior receipt', () => {
  assert.deepEqual(validateRerunIdentity({
    previous: { canonicalRoot: '/authorized/C/O/V/R-1', intakeId: 'INTAKE-1', receiptSha256: 'a'.repeat(64) },
    next: { canonicalRoot: '/authorized/C/O/V/R-2', intakeId: 'INTAKE-2', previousReceiptSha256: 'a'.repeat(64) },
  }), { valid: true })
  assert.equal(validateRerunIdentity({
    previous: { canonicalRoot: '/authorized/C/O/V/R-1', intakeId: 'INTAKE-1', receiptSha256: 'a'.repeat(64) },
    next: { canonicalRoot: '/authorized/C/O/V/R-1', intakeId: 'INTAKE-2', previousReceiptSha256: 'a'.repeat(64) },
  }).valid, false)
  assert.equal(validateRerunIdentity({
    previous: { canonicalRoot: '/authorized/C/O/V/R-1', intakeId: undefined, receiptSha256: 'a'.repeat(64) },
    next: { canonicalRoot: '/authorized/C/O/V/R-2', intakeId: 'INTAKE-2', previousReceiptSha256: 'a'.repeat(64) },
  }).valid, false)
  assert.equal(validateRerunIdentity({
    previous: { canonicalRoot: '/authorized/C/O/V/R-1/../R-2', intakeId: 'INTAKE-1', receiptSha256: 'a'.repeat(64) },
    next: { canonicalRoot: '/authorized/C/O/V/R-2', intakeId: 'INTAKE-2', previousReceiptSha256: 'a'.repeat(64) },
  }).valid, false)
})
