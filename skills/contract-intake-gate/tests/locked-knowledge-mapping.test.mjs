import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFile(path.join(root, name), 'utf8')
test('locked intake R2-R8 knowledge, exceptions and rerun actions remain in live resources', async () => {
  const [skill, map] = await Promise.all([read('SKILL.md'), read('LOCKED-KNOWLEDGE-MAP.md')])
  for (const pattern of [/## S2 /, /## S3 /, /## S4 /, /## S5 /, /## S6 /, /## S7 /, /## S8 /, /内嵌/, /脱敏/, /简称/, /补料/, /全量重跑/, /gate_reason_id/]) assert.match(skill, pattern)
  for (const row of ['R2 主版本冻结','R3 页码连续性','R4 附件四字段','R5 签章状态','R6 占位符','R7 主体一致性','R8 五维版本矩阵','内嵌附件正文','补料处理','稳定原因码']) assert.match(map, new RegExp(row))
})
test('platform-equivalent frontmatter and live instructions encode O1 Lead-only handoff once',async()=>{
 const text=await readFile(path.join(root,'SKILL.md'),'utf8'); const match=text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/); assert.ok(match)
 assert.equal((text.match(/^---\s*\nname:/gm)??[]).length,1); const fm=parse(match[1]); assert.equal(fm.metadata.pipeline_stage,'O1'); assert.equal(fm.metadata.upstream,'contract-review-lead'); assert.deepEqual(fm.metadata.downstream,['contract-review-lead'])
 assert.doesNotMatch(match[2],/下游的条款抽取、风险识别、法域合规、\s*复核出报告四个环节|没有 YAML 解析器时[\s\S]{0,160}降为 `conditional`|to: clause-extractor|用 `Delegate`（`mode: sync`）/)
})
