import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import { parse } from 'yaml'

const testsDir = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.join(testsDir, '..', 'references', 'contract-intake-receipt.schema.json')
const fixture = async (name = 'receipt-schema-valid.yaml') => parse(await readFile(path.join(testsDir, 'fixtures', name), 'utf8'))
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

  const source = { part: 'body', page: 1, quote: '附件A1-v1' }
  const nullIdentityInPassedReceipt = structuredClone(receipt)
  nullIdentityInPassedReceipt.contract_intake_receipt.freeze.attachment_manifest.status = 'formal_list'
  nullIdentityInPassedReceipt.contract_intake_receipt.freeze.attachment_manifest.declared = [{ no: 'A1', name: null, version: 'v1', doc_no: null, source }]
  assert.equal(validate(nullIdentityInPassedReceipt), false)

  const blankIdentityInPassedReceipt = structuredClone(receipt)
  blankIdentityInPassedReceipt.contract_intake_receipt.freeze.attachment_manifest.status = 'formal_list'
  blankIdentityInPassedReceipt.contract_intake_receipt.freeze.attachment_manifest.declared = [{ no: 'A1', name: '', version: 'v1', doc_no: null, source }]
  assert.equal(validate(blankIdentityInPassedReceipt), false)

  const formalDeclaredNullVersion = structuredClone(receipt)
  formalDeclaredNullVersion.contract_intake_receipt.freeze.attachment_manifest.status = 'formal_list'
  formalDeclaredNullVersion.contract_intake_receipt.freeze.attachment_manifest.declared = [{
    no: 'A1', name: '技术及验收标准', version: null, doc_no: null, source,
  }]
  assert.equal(validate(formalDeclaredNullVersion), true, JSON.stringify(validate.errors))

  const resolutionPollutesFormalDeclaration = structuredClone(formalDeclaredNullVersion)
  resolutionPollutesFormalDeclaration.contract_intake_receipt.freeze.attachment_manifest.declared[0].version_resolution = {
    resolved_version: 'v1',
    basis: 'same_id_unique_explicit_version',
    explicit_reference_sources: [source],
    delivered_source: source,
  }
  assert.equal(validate(resolutionPollutesFormalDeclaration), false)

  const missingFormalList = structuredClone(receipt)
  const missingFormalReceipt = missingFormalList.contract_intake_receipt
  missingFormalReceipt.verdict = 'conditional'
  missingFormalReceipt.verdict_label = '条件通过'
  missingFormalReceipt.all_frozen = false
  missingFormalReceipt.freeze.attachment_manifest = {
    frozen: false,
    status: 'missing_formal_list',
    declared: null,
    referenced: [{ no: 'A1', name: null, version: 'v1', doc_no: null, source }],
    delivered: [{ no: 'A1', name: '技术及验收标准', version: 'v1', doc_no: null, source: { part: 'attachment:附件A1', page: 1, quote: '附件编号：A1；附件版本：v1' } }],
  }
  missingFormalReceipt.flags = [{
    code: 'FLG-ATTACHMENT-MANIFEST-ABSENT', gate_reason_id: 'attachment-manifest-absent', severity: 'flag', clause: '9', evidence: source,
    finding: 'No formal attachment list was submitted.', action: 'Confirm the formal attachment list.',
  }]
  missingFormalReceipt.handoff.pending = [{
    id: 'PEND-004', from_flag: 'FLG-ATTACHMENT-MANIFEST-ABSENT', must_escalate: true,
    statement: 'The formal list is absent.', required_downstream_action: 'Keep overall attachment scope not_covered.',
  }]
  assert.equal(validate(missingFormalList), true, JSON.stringify(validate.errors))

  const missingFormalResolvedShortReference = structuredClone(missingFormalList)
  missingFormalResolvedShortReference.contract_intake_receipt.freeze.attachment_manifest.referenced.push({
    no: 'A1', name: null, version: null, doc_no: null,
    source: { part: 'body', page: 2, quote: '甲方按附件A1书面验收合格' },
    version_resolution: {
      resolved_version: 'v1',
      basis: 'same_id_unique_explicit_version',
      explicit_reference_sources: [source],
      delivered_source: { part: 'attachment:附件A1', page: 1, quote: '附件编号：A1；附件版本：v1' },
    },
  })
  assert.equal(validate(missingFormalResolvedShortReference), true, JSON.stringify(validate.errors))

  const resolutionRewritesRawVersion = structuredClone(missingFormalResolvedShortReference)
  resolutionRewritesRawVersion.contract_intake_receipt.freeze.attachment_manifest.referenced[1].version = 'v1'
  assert.equal(validate(resolutionRewritesRawVersion), false)

  const resolutionHasUnknownBasis = structuredClone(missingFormalResolvedShortReference)
  resolutionHasUnknownBasis.contract_intake_receipt.freeze.attachment_manifest.referenced[1].version_resolution.basis = 'nearest-mention'
  assert.equal(validate(resolutionHasUnknownBasis), false)

  const resolutionHasExtraField = structuredClone(missingFormalResolvedShortReference)
  resolutionHasExtraField.contract_intake_receipt.freeze.attachment_manifest.referenced[1].version_resolution.inferred_from_name = true
  assert.equal(validate(resolutionHasExtraField), false)

  const missingFormalNullName = structuredClone(missingFormalList)
  missingFormalNullName.contract_intake_receipt.freeze.attachment_manifest.declared = [{ no: 'A1', name: null, version: 'v1', doc_no: null, source }]
  assert.equal(validate(missingFormalNullName), false)

  const missingFormalWithoutPending = structuredClone(missingFormalList)
  missingFormalWithoutPending.contract_intake_receipt.handoff.pending = []
  assert.equal(validate(missingFormalWithoutPending), false)

  const authorityListUnavailable = structuredClone(missingFormalList)
  authorityListUnavailable.contract_intake_receipt.freeze.attachment_manifest.status = 'authority_list_unavailable'
  authorityListUnavailable.contract_intake_receipt.flags[0].code = 'FLG-ATTACHMENT-MANIFEST-INCOMPLETE'
  authorityListUnavailable.contract_intake_receipt.flags[0].gate_reason_id = 'attachment-manifest-incomplete'
  authorityListUnavailable.contract_intake_receipt.handoff.pending[0].id = 'PEND-001'
  authorityListUnavailable.contract_intake_receipt.handoff.pending[0].from_flag = 'FLG-ATTACHMENT-MANIFEST-INCOMPLETE'
  assert.equal(validate(authorityListUnavailable), true, JSON.stringify(validate.errors))

  const r9Fixture = await fixture('r02-manifest-incomplete.receipt.yaml')
  assert.equal(validate(r9Fixture), true, JSON.stringify(validate.errors))

  const authorityListWithoutFlag = structuredClone(authorityListUnavailable)
  authorityListWithoutFlag.contract_intake_receipt.flags = []
  assert.equal(validate(authorityListWithoutFlag), false)

  const authorityListWithoutPending = structuredClone(authorityListUnavailable)
  authorityListWithoutPending.contract_intake_receipt.handoff.pending = []
  assert.equal(validate(authorityListWithoutPending), false)

  const noAttachmentsWithReference = structuredClone(receipt)
  noAttachmentsWithReference.contract_intake_receipt.freeze.attachment_manifest.referenced = [{ no: 'A1', name: null, version: 'v1', doc_no: null, source }]
  assert.equal(validate(noAttachmentsWithReference), false)

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

  const allFrozenButOneFalse = structuredClone(receipt)
  allFrozenButOneFalse.contract_intake_receipt.freeze.page_range.frozen = false
  assert.equal(validate(allFrozenButOneFalse), false)

  const oneFalseButAllFrozen = structuredClone(missingFormalList)
  oneFalseButAllFrozen.contract_intake_receipt.all_frozen = true
  assert.equal(validate(oneFalseButAllFrozen), false)

  const allTrueButAllFrozenFalse = structuredClone(receipt)
  allTrueButAllFrozenFalse.contract_intake_receipt.all_frozen = false
  assert.equal(validate(allTrueButAllFrozenFalse), false)
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
  assert.match(skill, /含页码、附件、占位或金额的正则模式传 `pattern` 加 `is_regex: true`/)
  assert.match(skill, /用 `MathCalc` 校验实际出现的页码集合是否等于 `\{1\.\.M\}`/)
  assert.match(skill, /用 `MathCalc` 与小写数值做\*\*精确\*\*比较/)
})

test('agent, Skill, and schema-valid fixture bind the same Intake release version', async () => {
  const [agentText, skillText, receipt] = await Promise.all([
    readFile(path.join(testsDir, '..', '..', '..', 'agent.json'), 'utf8'),
    readFile(path.join(testsDir, '..', 'SKILL.md'), 'utf8'),
    fixture(),
  ])
  const agent = JSON.parse(agentText)
  const skillVersion = skillText.match(/^version: ([0-9]+\.[0-9]+\.[0-9]+)$/m)?.[1]

  assert.equal(agent.version, skillVersion)
  assert.equal(receipt.contract_intake_receipt.skill, `contract-intake-gate@${skillVersion}`)
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
