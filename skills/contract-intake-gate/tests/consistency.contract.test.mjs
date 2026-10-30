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
  assert.equal(frontmatter.version, '1.0.9')
  assert.equal(frontmatter.metadata.version, '1.0.9')
  assert.equal(agent.version, '1.0.9')
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

test('PEND-001 编号只留给 R9，R7 范围待办从 PEND-002 起编号', async () => {
  const skill = await read(path.join(intakeRoot, 'skills/contract-intake-gate/SKILL.md'))
  assert.match(skill, /\*\*`PEND-001` 编号只留给 R9\*\*/)
  assert.match(skill, /本次没有 R9 时也不使用这个编号/)
  assert.match(skill, /一律从 `PEND-002` 起顺序编号/)
  assert.match(skill, /R7 待办写 `from_flag: SCOPE-ATTACHMENT-BODY-ABSENT`、`must_escalate: false`/)
  assert.match(skill, /R7 待办只用于范围留白，不是 Human Gate pending，也不透传给 O5/)
})

test('落盘次序位于前提与 S1 之前：先写 detail 骨架，单次写入不超过约 3000 字，回执超限分段', async () => {
  const text = await read(path.join(intakeRoot, 'skills/contract-intake-gate/SKILL.md'))
  const order = text.indexOf('## 落盘次序（先于 S1）')
  const premise = text.indexOf('## 不可协商的前提')
  assert.ok(order > 0 && premise > order && text.indexOf('## S1 受理范围清点') > premise, '落盘次序必须放在前提与 S1 之前')
  const body = text.slice(order, premise)
  assert.match(body, /下一次回复只做两步：`GenerateUUID` 取本次 `intake_id`（格式 `INTAKE-<YYYYMMDD>-<uuid 前 8 位>`，S1 起一律沿用它），随后 `Write` `<intake_id>\.detail\.yaml` 骨架/)
  assert.match(body, /写骨架之前不读正文、不推演 S1–S8/)
  assert.match(body, /不超过约 3000 字/)
  assert.match(body, /末尾留一行 `# <<续写回执>>`，再用 `Edit` 把这一行换成其余段/)
  assert.doesNotMatch(text, /一次写成机器回执/)
  assert.match(text, /机器回执与 `validation\.json`\n {3}交付时不留锚点/)
})

test('回执分段写入：前半留续写行、Edit 换成后半后与一次写成的字节一致且通过 schema', async () => {
  const raw = await read(path.join(here, 'fixtures', 'schema-valid.receipt.yaml'))
  const cut = raw.indexOf('\nblocks:')
  assert.ok(cut > 0)
  const anchor = '# <<续写回执>>'
  const firstHalf = raw.slice(0, cut + 1) + anchor + '\n'
  assert.doesNotThrow(() => parse(firstHalf), '前半加续写行应可解析')
  assert.equal(firstHalf.split(anchor).length, 2, '续写行必须唯一')
  const joined = firstHalf.replace(anchor + '\n', raw.slice(cut + 1))
  assert.equal(joined, raw)
  const validate = await validator()
  assert.equal(validate(parse(joined)), true, JSON.stringify(validate.errors))
  // 切在序列中间（两条 checks 之间）同样成立：续写行在序列里是注释，前半可解析，换回后一致
  const mid = raw.indexOf('\n  - {id: S5')
  assert.ok(mid > 0)
  const midHalf = raw.slice(0, mid + 1) + anchor + '\n'
  const midParsed = parse(midHalf)
  assert.equal(midParsed.checks.length, 4, '前半应保留已写的 S1–S4')
  assert.equal(midHalf.replace(anchor + '\n', raw.slice(mid + 1)), raw)
})

test('S1 沿用落盘次序的 intake_id，不再另取', async () => {
  const text = await read(path.join(intakeRoot, 'skills/contract-intake-gate/SKILL.md'))
  const s1 = text.slice(text.indexOf('## S1 受理范围清点'), text.indexOf('## S2 主版本冻结'))
  assert.doesNotMatch(s1, /GenerateUUID/)
  assert.match(s1, /沿用「落盘次序」已生成的 `intake_id`，不再另取/)
  assert.equal((text.match(/INTAKE-<YYYYMMDD>-<uuid 前 8 位>/g) ?? []).length, 1, 'id 格式只在落盘次序写一处')
})

test('Lead 点名续写本产物 id 的重新委派按续跑处理', async () => {
  const text = await read(path.join(intakeRoot, 'skills/contract-intake-gate/SKILL.md'))
  assert.match(text, /续跑（含 Lead 点名续写本产物 id 的重新委派）时跳过本步：不再 `GenerateUUID`、不再 `Write` 骨架/)
  assert.match(text, /被续跑时（含 Lead 因原运行已正常结束无法 resume、改用重新委派并在任务里点名续写本产物 id 的情形）会话里已有本次 `intake_id`/)
})
