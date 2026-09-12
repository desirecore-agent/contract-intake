import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('..', import.meta.url)
const skill = async () => readFile(new URL('SKILL.md', root), 'utf8')

// This is a source-contract check of the Agent's own template and instructions.
// It does not validate a receipt, a Delegate run, YAML parsing, or Agent behavior.
test('Skill template keeps the explicit Delegate case source, digest mirrors, and S4 boundary', async () => {
  const text = await skill()
  assert.match(text, /只有 `Delegate` 的显式 `handoff\.case_id` 可作为本案 case_id/)
  assert.match(text, /Lead 的 O1 交接必须含 `submitted_file_paths`、`object\.documents` 和 `input_inventory`/)
  assert.match(text, /S1 的完整批量 aggregate 必须逐字等于 `input_inventory\.submission_inventory_manifest_digest`/)
  assert.match(text, /`object\.manifest_digest` 必须逐字等于 `input_inventory\.current_contract_manifest_digest`/)
  assert.match(text, /input_inventory:\s+# Lead O0 摘要；不是 S4 四字段对账表\s+submission_inventory_manifest_digest: <64-lowercase-sha256-or-unknown>\s+current_contract_manifest_digest: <64-lowercase-sha256-or-unknown>/)
  assert.match(text, /input_inventory:\s+# 必须与 receipt 中逐字相同；不能由 S4 表摘要替代\s+submission_inventory_manifest_digest: <64-lowercase-sha256-or-unknown>\s+current_contract_manifest_digest: <64-lowercase-sha256-or-unknown>/)
  assert.match(text, /O1_MANIFEST_CONTRACT_INVALID.*HOLD/)
  assert.match(text, /S4 `attachment_manifest_digest` 仅是四字段对账表摘要/)
})
