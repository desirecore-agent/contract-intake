import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const testsDir = path.dirname(fileURLToPath(import.meta.url))
const fixture = async (name) => parse(await readFile(path.join(testsDir, 'fixtures', name), 'utf8'))

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
