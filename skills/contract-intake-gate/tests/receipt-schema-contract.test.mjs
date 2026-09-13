import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import { parse } from 'yaml'

const testsDir = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.join(testsDir, '..', 'references', 'contract-intake-receipt.schema.json')
const fixture = async () => parse(await readFile(path.join(testsDir, 'fixtures', 'receipt-schema-valid.yaml'), 'utf8'))
const schema = async () => JSON.parse(await readFile(schemaPath, 'utf8'))

test('release-owned final receipt schema accepts the defined receipt and rejects missing S1-S8 evidence', async () => {
  const validate = new Ajv({ allErrors: true, strict: true }).compile(await schema())
  const receipt = await fixture()

  assert.equal(validate(receipt), true, JSON.stringify(validate.errors))

  const missingCheck = structuredClone(receipt)
  missingCheck.contract_intake_receipt.checks.pop()
  assert.equal(validate(missingCheck), false)

  const blockedButHandoff = structuredClone(receipt)
  blockedButHandoff.contract_intake_receipt.verdict = 'blocked'
  blockedButHandoff.contract_intake_receipt.verdict_label = '拒绝'
  assert.equal(validate(blockedButHandoff), false)

  const blockInPassedReceipt = structuredClone(receipt)
  blockInPassedReceipt.contract_intake_receipt.blocks.push({
    code: 'BLK-PLACEHOLDER',
    gate_reason_id: 'placeholder-unfilled',
    severity: 'block',
    clause: null,
    evidence: { part: 'body', page: 1, quote: 'TBD' },
    finding: 'Placeholder remains.',
    action: 'Complete the placeholder.',
  })
  assert.equal(validate(blockInPassedReceipt), false)

  const falseFreezeInPassedReceipt = structuredClone(receipt)
  falseFreezeInPassedReceipt.contract_intake_receipt.freeze.page_range.frozen = false
  assert.equal(validate(falseFreezeInPassedReceipt), false)

  const missingMirroredCaseId = structuredClone(receipt)
  delete missingMirroredCaseId.contract_intake_receipt.handoff.case_id
  assert.equal(validate(missingMirroredCaseId), false)

  const unsignedDraft = structuredClone(receipt)
  const execution = unsignedDraft.contract_intake_receipt.freeze.execution_status
  execution.signature_status = 'unsigned_draft'
  execution.review_purpose = 'draft_negotiation_assistance'
  execution.exception_basis = {
    request_scope_evidence: { source: 'current_user_request', quote: '请对本未签署草稿开展草稿/谈判辅助审查' },
    material_evidence: { input_path: 'C:/workspace/contracts/c01.md', page: 3, locator: '落款区', quote: '本草稿尚未签署' },
  }
  unsignedDraft.contract_intake_receipt.handoff.review_purpose = 'draft_negotiation_assistance'
  unsignedDraft.contract_intake_receipt.handoff.exception_basis = structuredClone(execution.exception_basis)
  assert.equal(validate(unsignedDraft), true, JSON.stringify(validate.errors))

  const wrongDraftPurpose = structuredClone(unsignedDraft)
  wrongDraftPurpose.contract_intake_receipt.handoff.review_purpose = 'draft_negotiation_assistance_with_execution_review'
  assert.equal(validate(wrongDraftPurpose), false)
})

test('source wiring allows and requires only the readonly structural validation tool for this new check', async () => {
  const [agent, skill] = await Promise.all([
    readFile(path.join(testsDir, '..', '..', '..', 'agent.json'), 'utf8'),
    readFile(path.join(testsDir, '..', 'SKILL.md'), 'utf8'),
  ])

  assert.match(agent, /"StructuredFileValidate"/)
  assert.match(skill, /- StructuredFileValidate/)
  assert.match(skill, /contract-intake-receipt\.schema\.json/)
  assert.match(skill, /没有独立 `intake\.yaml` 的路径、模板或数据契约/)
  assert.match(skill, /现有回执协议没有 `yaml_unverified` 或验证状态字段/)
  assert.match(skill, /第二次 `valid: false`、任何路径\/schema\/parser\/runtime/)
  assert.match(skill, /HOLD.*不调用 `Delegate` \/ `SendMessage`/)
  assert.match(skill, /不得把未验证或无效候选文件作为回执交付/)
  assert.match(skill, /先前成功校验立即失效/)
  assert.match(skill, /逐字段精确镜像\s*比较/)
  assert.match(skill, /不能证明跨位置值相等/)
})

test('receipt schema stays local Draft-07 without formats or external references', async () => {
  const receiptSchema = await schema()
  const encoded = JSON.stringify(receiptSchema)

  assert.equal(receiptSchema.$schema, 'http://json-schema.org/draft-07/schema#')
  assert.doesNotMatch(encoded, /"format"/)
  assert.doesNotMatch(encoded, /"\$id"/)

  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (value && typeof value === 'object') {
      if ('$ref' in value) assert.match(value.$ref, /^#\//)
      Object.values(value).forEach(visit)
    }
  }
  visit(receiptSchema)
})
