import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const testsDir = path.dirname(fileURLToPath(import.meta.url))
const fixture = async (name) => parse(await readFile(path.join(testsDir, 'fixtures', name), 'utf8'))

function assertSignatureEvidenceContract(receipt) {
  const execution = receipt.freeze.execution_status
  const allowedEvidenceLevels = new Set(['declared_in_text', 'visual_mark_detected', 'not_covered'])

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
