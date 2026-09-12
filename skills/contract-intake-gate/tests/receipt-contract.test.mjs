import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const testsDir = path.dirname(fileURLToPath(import.meta.url))
const fixture = async (name) => parse(await readFile(path.join(testsDir, 'fixtures', name), 'utf8'))
const skill = () => readFile(path.join(testsDir, '..', 'SKILL.md'), 'utf8')

test('FileDigest freezes one exact input set and never degrades a batch to single-file digests', async () => {
  const text = await skill()

  assert.match(text, /1\. 用 `Ls` \/ `Glob` 列出本次提交的全部文件，逐一 `Read`，再按以下顺序计算摘要：/)
  assert.match(text, /\n2\. 把内容切分为\*\*文档部件（part）\*\*：/)
  assert.match(text, /本次已确认输入逐字冻结为 `submitted_file_paths` 的 canonical 绝对路径列表/)
  assert.match(text, /用户给出的绝对路径直接复用；相对名只可按当前 effective cwd 确定性解析/)
  assert.match(text, /不得猜测、缩短、重组\/换根或改用旧 workspace/)
  assert.match(text, /`N = 1` 时唯一形状是 `FileDigest\(\{paths: submitted_file_paths\[0\]\}\)`/)
  assert.match(text, /其中 `paths` 是裸绝对字符串且 JSON 外观仍按字面路径处理/)
  assert.match(text, /`N > 1` 时只有当前工具参数明示 `paths_json` 兼容入口才可调用唯一形状 `FileDigest\(\{paths_json: JSON\.stringify\(submitted_file_paths\)\}\)`/)
  assert.match(text, /这只是参数构造示例，不得调用 shell 或 JS/)
  assert.match(text, /JSON 字符串数组（1–100 项、UTF-8 不超过 64 KiB）/)
  assert.match(text, /解码后逐项等于 `submitted_file_paths`、不多不少/)
  assert.match(text, /不得同时传 `paths`、`file_path` 或 `path`/)
  assert.match(text, /`FileDigest\.paths_json` 是发布此批量规则的最小客户端能力要求/)
  assert.match(text, /入口未提供时立即在既有 S1 finding\/`unknown` failure reason 中写 `batch_unverified` 后停止 S1 摘要步骤/)
  assert.match(text, /返回 `files` 覆盖完整 `submitted_file_paths` 集合且 `aggregate\.file_count = N` 时成立/)
  assert.match(text, /只有 `FileDigest` 明确返回参数形态错误时，才可保持同一原集合和同一 `paths_json` 形状纠正一次/)
  assert.match(text, /绝不拆成多个单文件调用、缩减集合或以单文件 aggregate 冒充批量/)
  assert.match(text, /权限拒绝、超限、文件消失、入口不可用、真实执行失败、返回缺项或 aggregate 数不符/)
  assert.match(text, /既有 S1 finding\/`unknown` failure reason 中明确 `batch_unverified` 和真实工具原因后停止 S1 摘要步骤/)
  assert.match(text, /不得跨文件把冻结记为 `true`/)
  assert.match(text, /不得用 shell 诊断、重试或替代 `FileDigest`/)
})

function assertSignatureEvidenceContract(receipt) {
  const execution = receipt.freeze.execution_status
  const allowedEvidenceLevels = new Set(['declared_in_text', 'visual_mark_detected', 'not_covered', 'known_unsigned_draft'])

  assert.equal(execution.verification_status, 'not_performed')
  for (const party of execution.parties) {
    assert.equal(allowedEvidenceLevels.has(party.evidence_level), true, 'S5 evidence level is unsupported')
    assert.equal(party.verification_status, 'not_performed')
    assert.equal(party.seal, undefined, 'a text or image observation must not claim seal: present')
    assert.ok(party.seal_evidence, 'every S5 evidence level needs a source anchor')
    assert.equal(path.isAbsolute(party.seal_evidence.input_path), true, 'S5 evidence path must be absolute')
    assert.equal(Number.isInteger(party.seal_evidence.page) || Number.isInteger(party.seal_evidence.image_index), true, 'S5 evidence needs a page or image index')
    assert.equal(typeof party.seal_evidence.locator, 'string', 'S5 evidence needs a locator')
    assert.equal(party.seal_evidence.locator.length > 0, true, 'S5 evidence locator must not be empty')
    if (party.evidence_level === 'declared_in_text') {
      assert.equal(party.seal_field, 'declared_in_text')
      assert.equal(typeof party.seal_evidence.quote, 'string', 'text-declared seal needs an original quote')
      assert.equal(party.seal_evidence.quote.length > 0, true, 'text-declared quote must not be empty')
    }
    if (party.evidence_level === 'visual_mark_detected') {
      assert.equal(party.seal_field, 'visual_mark_detected')
      assert.equal(typeof party.seal_evidence.visual_description, 'string', 'visual evidence needs a description')
      assert.equal(party.seal_evidence.visual_description.length > 0, true, 'visual description must not be empty')
      assert.equal(party.seal_evidence.tool_observation?.tool, 'UnderstandImage', 'visual evidence needs its actual tool')
      assert.equal(typeof party.seal_evidence.tool_observation?.summary, 'string', 'visual evidence needs a tool observation')
      assert.equal(party.seal_evidence.tool_observation.summary.length > 0, true, 'visual tool observation must not be empty')
    }
    if (party.evidence_level === 'not_covered') {
      assert.equal(party.seal_field, 'not_covered')
      assert.equal(typeof party.seal_evidence.quote, 'string', 'uncovered S5 evidence needs its missing-field quote')
      assert.equal(party.seal_evidence.quote.length > 0, true, 'uncovered S5 quote must not be empty')
    }
    if (party.evidence_level === 'known_unsigned_draft') {
      assert.equal(party.seal_field, 'not_covered')
      assert.equal(typeof party.seal_evidence.quote, 'string', 'known unsigned draft needs its source quote')
      assert.equal(party.seal_evidence.quote.length > 0, true, 'known unsigned draft quote must not be empty')
      assert.equal(party.complete, false)
    }
  }
}

test('R02-like incomplete manifest is conditional, escalated, and handed off', async () => {
  const receipt = await fixture('r02-manifest-incomplete.receipt.yaml').then(({ contract_intake_receipt }) => contract_intake_receipt)
  const { handoff } = receipt
  const pending = handoff.pending.find(({ id }) => id === 'PEND-001')

  assert.equal(receipt.verdict, 'conditional')
  assert.equal(receipt.verdict_label, '条件通过')
  assert.equal(handoff.to, 'clause-extractor')
  assert.equal(handoff.from, 'contract-intake')
  assert.equal(handoff.intake_id, receipt.intake_id)
  assert.equal(path.isAbsolute(handoff.receipt_path), true)
  assert.equal(typeof handoff.object.contract_object_id, 'string')
  assert.equal(handoff.object.contract_object_id.length > 0, true)
  assert.equal(Array.isArray(handoff.scope.in_scope), true)
  assert.equal(Array.isArray(handoff.scope.out_of_scope), true)
  assert.equal(handoff.scope.in_scope.length > 0, true)
  assert.equal(handoff.scope.out_of_scope.length > 0, true)
  assert.equal(handoff.scope.in_scope.some((item) => item.includes('附件')), true)
  assert.equal(handoff.scope.out_of_scope.some((item) => item.includes('附件')), false)
  assert.equal(Array.isArray(handoff.confirmed), true)
  assert.equal(handoff.confirmed.length > 0, true)
  assert.equal(receipt.freeze.attachment_manifest.frozen, false)
  assert.deepEqual(receipt.flags.map(({ code }) => code), ['FLG-ATTACHMENT-MANIFEST-INCOMPLETE'])
  assert.equal(handoff.pending.length, 1)
  assert.ok(receipt.flags.some(({ code, gate_reason_id }) =>
    code === 'FLG-ATTACHMENT-MANIFEST-INCOMPLETE' && gate_reason_id === 'attachment-manifest-incomplete'))
  assert.deepEqual(
    { from_flag: pending?.from_flag, must_escalate: pending?.must_escalate },
    { from_flag: 'FLG-ATTACHMENT-MANIFEST-INCOMPLETE', must_escalate: true },
  )
  assert.match(pending?.required_downstream_action ?? '', /not_covered/)
})

test('complete manifest remains passed', async () => {
  const receipt = await fixture('complete-manifest.receipt.yaml').then(({ contract_intake_receipt }) => contract_intake_receipt)

  assert.equal(receipt.verdict, 'passed')
  assert.equal(receipt.handoff.to, 'clause-extractor')
  assert.equal(receipt.flags.length, 0)
  assert.equal(receipt.handoff.pending.length, 0)
})

test('ordinary declared attachment body absence remains a scope fact', async () => {
  const receipt = await fixture('undelivered-attachment-body.receipt.yaml').then(({ contract_intake_receipt }) => contract_intake_receipt)

  assert.equal(receipt.verdict, 'passed')
  assert.equal(receipt.handoff.to, 'clause-extractor')
  assert.equal(receipt.flags.length, 0)
  assert.equal(receipt.handoff.pending.some(({ id }) => id === 'PEND-001'), false)
})

test('R8 keeps its version-change escalation without becoming PEND-001', async () => {
  const receipt = await fixture('r8-version-change.receipt.yaml').then(({ contract_intake_receipt }) => contract_intake_receipt)
  const pending = receipt.handoff.pending.find(({ id }) => id === 'PEND-002')

  assert.equal(receipt.verdict, 'conditional')
  assert.equal(receipt.handoff.to, 'clause-extractor')
  assert.deepEqual(
    { from_flag: pending?.from_flag, must_escalate: pending?.must_escalate },
    { from_flag: 'FLG-ATTACHMENT-VERSION-CHANGED', must_escalate: true },
  )
  assert.equal(receipt.handoff.pending.some(({ id }) => id === 'PEND-001'), false)
})

test('referenced attachment omitted from formal manifest remains blocked', async () => {
  const receipt = await fixture('undeclared-referenced-attachment.receipt.yaml').then(({ contract_intake_receipt }) => contract_intake_receipt)

  assert.equal(receipt.verdict, 'blocked')
  assert.equal(receipt.handoff.to, null)
  assert.ok(receipt.blocks.some(({ code, gate_reason_id }) =>
    code === 'BLK-ATTACHMENT-MISSING' && gate_reason_id === 'attachment-missing'))
})

test('text-declared signature fields can pass S5 without claiming authenticity verification', async () => {
  const receipt = await fixture('text-declared-signature.receipt.yaml').then(({ contract_intake_receipt }) => contract_intake_receipt)
  const execution = receipt.freeze.execution_status
  const party = execution.parties[0]
  const s5 = receipt.checks.find(({ id }) => id === 'S5')
  const confirmed = receipt.handoff.confirmed.join('\n')

  assertSignatureEvidenceContract(receipt)
  assert.equal(receipt.verdict, 'passed')
  assert.equal(execution.frozen, true)
  assert.equal(execution.verification_status, 'not_performed')
  assert.equal(party.complete, true)
  assert.equal(party.evidence_level, 'declared_in_text')
  assert.equal(party.seal_field, 'declared_in_text')
  assert.equal(path.isAbsolute(party.seal_evidence.input_path), true)
  assert.equal(s5?.status, 'pass')
  assert.match(s5?.finding ?? '', /declared_in_text/)
  assert.match(s5?.finding ?? '', /未做图像或电子签真实性验证/)
  assert.match(confirmed, /declared_in_text/)
  assert.match(confirmed, /未做图像或电子签真实性验证/)
  assert.doesNotMatch(`${s5?.finding}\n${confirmed}`, /真实性已验证|授权已验证|签章真实|实际签署已验证/)
})

test('visual signature observation can pass S5 without becoming authenticity verification', async () => {
  const receipt = await fixture('visual-signature-mark.receipt.yaml').then(({ contract_intake_receipt }) => contract_intake_receipt)
  const party = receipt.freeze.execution_status.parties[0]
  const confirmed = receipt.handoff.confirmed.join('\n')

  assertSignatureEvidenceContract(receipt)
  assert.equal(receipt.verdict, 'passed')
  assert.equal(party.evidence_level, 'visual_mark_detected')
  assert.equal(party.seal_evidence.tool_observation.tool, 'UnderstandImage')
  assert.match(confirmed, /visual_mark_detected/)
  assert.doesNotMatch(confirmed, /真实性已验证|授权已验证|签章真实|实际签署已验证/)
})

test('incomplete S5 fixture remains source-anchored without an ungrounded seal field', async () => {
  const receipt = await fixture('incomplete-signature.receipt.yaml').then(({ contract_intake_receipt }) => contract_intake_receipt)
  const execution = receipt.freeze.execution_status
  const party = execution.parties[0]

  assertSignatureEvidenceContract(receipt)
  assert.equal(receipt.verdict, 'blocked')
  assert.equal(execution.frozen, false)
  assert.equal(party.evidence_level, 'not_covered')
  assert.equal(party.seal_field, 'not_covered')
  assert.equal(party.seal, undefined)
  assert.equal(party.complete, false)
  assert.ok(receipt.blocks.some(({ code }) => code === 'BLK-SIGNATURE-INCOMPLETE'))
})

test('known unsigned draft is reviewable only for explicit draft assistance without signature claims', async () => {
  const receipt = await fixture('unsigned-draft-assistance.receipt.yaml').then(({ contract_intake_receipt }) => contract_intake_receipt)
  const execution = receipt.freeze.execution_status
  const s5 = receipt.checks.find(({ id }) => id === 'S5')
  const confirmed = receipt.handoff.confirmed.join('\n')

  assertSignatureEvidenceContract(receipt)
  assert.equal(receipt.verdict, 'passed')
  assert.equal(execution.frozen, true)
  assert.equal(execution.signature_status, 'unsigned_draft')
  assert.equal(execution.review_purpose, 'draft_negotiation_assistance')
  assert.match(execution.exception_basis.request_scope_evidence.quote, /草稿|谈判/)
  assert.equal(path.isAbsolute(execution.exception_basis.material_evidence.input_path), true)
  assert.equal(Number.isInteger(execution.exception_basis.material_evidence.page), true)
  assert.equal(typeof execution.exception_basis.material_evidence.locator, 'string')
  assert.equal(typeof execution.exception_basis.material_evidence.quote, 'string')
  assert.equal(s5?.status, 'pass')
  assert.match(`${s5?.finding}\n${confirmed}`, /草稿\/谈判辅助审查/)
  assert.match(`${s5?.finding}\n${confirmed}`, /不可签署/)
  assert.doesNotMatch(`${s5?.finding}\n${confirmed}`, /已签署|已生效|真实性已验证|授权已验证/)
  assert.equal(receipt.handoff.review_purpose, 'draft_negotiation_assistance')
  assert.deepEqual(receipt.handoff.exception_basis, execution.exception_basis)
})

test('S5 keeps the unsigned-draft exception bounded to explicit draft assistance', async () => {
  const text = await skill()

  assert.match(text, /用户在\*\*本次请求\*\*明确要求草稿\/谈判辅助审查/)
  assert.match(text, /材料自身明确声明当前版本为未签署草稿/)
  assert.match(text, /混合执行请求/)
  assert.match(text, /完整记录 `review_purpose` 与两类 `exception_basis` 证据/)
  assert.match(text, /BLK-EXECUTION-STATUS-CONFLICT/)
})

test('draft exception leaves every non-qualifying signature condition blocked with its exact code', async () => {
  for (const [name, code] of [
    ['draft-status-conflict.receipt.yaml', 'BLK-EXECUTION-STATUS-CONFLICT'],
    ['draft-label-only.receipt.yaml', 'BLK-SIGNATURE-BLOCK-ABSENT'],
    ['unsigned-draft-non-assistance.receipt.yaml', 'BLK-SIGNATURE-BLOCK-ABSENT'],
    ['unsigned-draft-execution-review.receipt.yaml', 'BLK-SIGNATURE-BLOCK-ABSENT'],
    ['no-signature-status-unknown.receipt.yaml', 'BLK-SIGNATURE-BLOCK-ABSENT'],
  ]) {
    const receipt = await fixture(name).then(({ contract_intake_receipt }) => contract_intake_receipt)
    assert.equal(receipt.verdict, 'blocked', name)
    assert.equal(receipt.handoff.to, null, name)
    assert.ok(receipt.blocks.some(({ code: actual }) => actual === code), name)
  }
})

test('S5 contract rejects a text claim of a present seal or unsupported authenticity verification', async () => {
  const receipt = await fixture('text-declared-signature.receipt.yaml').then(({ contract_intake_receipt }) => contract_intake_receipt)
  const conflict = structuredClone(receipt)
  conflict.freeze.execution_status.parties[0].seal = 'present'
  assert.throws(() => assertSignatureEvidenceContract(conflict), /seal: present/)

  const unsupported = structuredClone(receipt)
  unsupported.freeze.execution_status.parties[0].evidence_level = 'authenticity_verified'
  unsupported.freeze.execution_status.parties[0].verification_status = 'verified'
  assert.throws(() => assertSignatureEvidenceContract(unsupported), /unsupported/)

  const missingTextAnchor = structuredClone(receipt)
  delete missingTextAnchor.freeze.execution_status.parties[0].seal_evidence
  assert.throws(() => assertSignatureEvidenceContract(missingTextAnchor), /source anchor/)

  const visual = await fixture('visual-signature-mark.receipt.yaml').then(({ contract_intake_receipt }) => contract_intake_receipt)
  const missingObservation = structuredClone(visual)
  delete missingObservation.freeze.execution_status.parties[0].seal_evidence.tool_observation
  assert.throws(() => assertSignatureEvidenceContract(missingObservation), /actual tool/)
})
