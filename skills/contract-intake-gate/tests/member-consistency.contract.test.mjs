import assert from 'node:assert/strict'
import { execFile as callback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execFile = promisify(callback)
const sourcesRoot = process.env.CONTRACT_MEMBER_SOURCES_ROOT
if (!sourcesRoot) throw new Error('CONTRACT_MEMBER_SOURCES_ROOT is required; point it at the directory containing all four fixed member clones')
const baselines = {
  'contract-intake': '7c3f436852aa258259a166f3b376243587bfe915',
  'clause-extractor': '6129add5f40109f895d4125065a761b58f73819d',
  'risk-scanner': 'ea396f95e0a3c1917bd0b8fa02e956c4cc7bf578',
  'jurisdiction-auditor': '7ae69f15a6f56dc71cbfef9f07d6e65642563601',
}
const protectedKeys = ['llm', 'network_security', 'file_security', 'compute_credentials', 'tools', 'env']

test('protected member configuration is compared to fixed commits, never current HEAD', async () => {
  for (const [member, sha] of Object.entries(baselines)) {
    const root = path.join(sourcesRoot, member)
    let current
    try { current = JSON.parse(await readFile(path.join(root, 'agent.json'), 'utf8')) } catch (error) { throw new Error(`missing required member ${member} at ${root}: ${error.message}`) }
    let baseline
    try { baseline = JSON.parse((await execFile('git', ['show', `${sha}:agent.json`], { cwd: root })).stdout) } catch (error) { throw new Error(`cannot read fixed baseline ${sha} for ${member}: ${error.message}`) }
    for (const key of protectedKeys) assert.deepEqual(current[key], baseline[key], `${member}.${key} diverged from fixed ${sha}`)
  }
})
