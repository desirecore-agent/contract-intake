import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

const PROTOCOL = 'desirecore.script.snapshot.v1'
const pageCn = /第\s*([1-9]\d*)\s*页\s*[\/／]\s*共\s*([1-9]\d*)\s*页/g
const pageEn = /\bPage\s+([1-9]\d*)\s+of\s+([1-9]\d*)\b/gi
const pagePhysical = /源文件物理页\s*([1-9]\d*)\s*[\/／]\s*([1-9]\d*)/g
const amountPairs = [
  /人民币([零壹贰叁肆伍陆柒捌玖拾佰仟万萬亿]+(?:元(?:[零壹贰叁肆伍陆柒捌玖]+角)?(?:[零壹贰叁肆伍陆柒捌玖]+分)?|元整))\s*[（(]\s*[¥￥]\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*[)）]/g,
  /([¥￥]?[0-9][0-9,]*(?:\.\d{1,2})?)\s*元\s*[（(]\s*大写\s*[:：]\s*(?:人民币)?([零壹贰叁肆伍陆柒捌玖拾佰仟万萬亿]+(?:元(?:[零壹贰叁肆伍陆柒捌玖]+角)?(?:[零壹贰叁肆伍陆柒捌玖]+分)?|元整))\s*[)）]/g,
  /人民币\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*元\s*[（(]\s*大写\s*[:：]?\s*([零壹贰叁肆伍陆柒捌玖拾佰仟万萬亿]+(?:元(?:[零壹贰叁肆伍陆柒捌玖]+角)?(?:[零壹贰叁肆伍陆柒捌玖]+分)?|元整))\s*[)）]/g,
  /RMB\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*\(\s*SAY\s+([零壹贰叁肆伍陆柒捌玖拾佰仟万萬亿]+(?:元(?:[零壹贰叁肆伍陆柒捌玖]+角)?(?:[零壹贰叁肆伍陆柒捌玖]+分)?|元整))\s+ONLY\s*\)/gi,
]
const names = { S3: '页码连续性', S7: '一致性（主体身份 / 金额大小写）' }

const fail = (code) => { throw new Error(code) }
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const text = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)

function parseCents(raw) {
  const v = raw.replace(/[¥￥,\s]/g, '')
  if (!/^\d+(?:\.\d{1,2})?$/.test(v)) fail('AMOUNT_ARABIC_UNCERTAIN')
  const [whole, fraction = ''] = v.split('.')
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))
}
function upperCents(raw) {
  const digits = { 零: 0n, 壹: 1n, 贰: 2n, 叁: 3n, 肆: 4n, 伍: 5n, 陆: 6n, 柒: 7n, 捌: 8n, 玖: 9n }
  const lowUnits = { 拾: 10n, 佰: 100n, 仟: 1000n }
  const s = raw.replace(/^人民币/, '')
  const parts = s.split('元'); if (parts.length !== 2 || !parts[0]) fail('AMOUNT_UPPER_UNCERTAIN')
  const [integer, minor] = parts; if (minor !== '' && minor !== '整' && !/^(?:零?([壹贰叁肆伍陆柒捌玖])角)?(?:零?([壹贰叁肆伍陆柒捌玖])分)?$/.test(minor)) fail('AMOUNT_UPPER_UNCERTAIN')
  let total = 0n; let section = 0n; let digit = null; let lastLow = 10000n; let highest = 0n
  for (const char of integer) {
    if (char in digits) { if (digit !== null) fail('AMOUNT_UPPER_UNCERTAIN'); digit = digits[char]; continue }
    if (char in lowUnits) { const unit = lowUnits[char]; if (unit >= lastLow || digit === 0n || (digit === null && !(char === '拾' && section === 0n && lastLow === 10000n))) fail('AMOUNT_UPPER_UNCERTAIN'); section += (digit ?? 1n) * unit; digit = null; lastLow = unit; continue }
    if (char === '万' || char === '萬' || char === '亿') {
      const scale = char === '亿' ? 100000000n : 10000n
      if (section === 0n && digit === null) fail('AMOUNT_UPPER_UNCERTAIN')
      section += digit ?? 0n; digit = null; lastLow = 10000n
      if (char === '万') { if (highest >= 1) fail('AMOUNT_UPPER_UNCERTAIN'); total += section * scale; highest = 1 }
      else { if (highest > 2) fail('AMOUNT_UPPER_UNCERTAIN'); total = (total + section) * scale; highest = 2 }
      section = 0n; continue
    }
    fail('AMOUNT_UPPER_UNCERTAIN')
  }
  total += section + (digit ?? 0n)
  let cents = total * 100n
  if (minor && minor !== '整') {
    const match = /^(?:零?([壹贰叁肆伍陆柒捌玖])角)?(?:零?([壹贰叁肆伍陆柒捌玖])分)?$/.exec(minor)
    if (!match || (!match[1] && !match[2])) fail('AMOUNT_UPPER_UNCERTAIN')
    if (match[1]) cents += digits[match[1]] * 10n
    if (match[2]) cents += digits[match[2]]
  }
  return cents
}
function locate(textValue, offset) { return { page: null, quote: textValue.slice(Math.max(0, offset - 24), offset + 160) || 'deterministic source check' } }
function sourceAnchor(part, textValue, offset) { return { part, ...locate(textValue, offset) } }
function finding(code, severity, anchor, detail, action, reason = null) { return { code, gate_reason_id: reason, severity, clause: null, evidence: anchor, finding: detail, action } }
function ensureArray(v) { return Array.isArray(v) ? v : [] }

function parseMarkdown(bytes) { return text(bytes) }
function xmlText(xml) {
  if (/TargetMode=["']External["']|<w:fldSimple\b[^>]*(?:w:instr|instr)\s*=\s*["'][^"']*(?:PAGE|NUMPAGES)|<w:instrText\b[^>]*>[\s\S]*?(?:PAGE|NUMPAGES)/i.test(xml)) fail('DOCX_DYNAMIC_OR_EXTERNAL')
  return xml.replace(/<w:tab\b[^>]*\/>/gi, '\t').replace(/<w:br\b[^>]*\/>/gi, '\n').replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}
function parseDocx(bytes) {
  if (bytes.length < 30 || bytes.length > 1048576) fail('DOCX_BUDGET')
  let offset = 0; const entries = []; let inflated = 0
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const flags = bytes.readUInt16LE(offset + 6); const method = bytes.readUInt16LE(offset + 8); const compressed = bytes.readUInt32LE(offset + 18); const uncompressed = bytes.readUInt32LE(offset + 22); const nameLength = bytes.readUInt16LE(offset + 26); const extraLength = bytes.readUInt16LE(offset + 28); const start = offset + 30 + nameLength + extraLength; const end = start + compressed
    if (flags & 1 || flags & 8 || end > bytes.length || entries.length >= 128 || uncompressed > 1048576 || (inflated += uncompressed) > 2097152) fail('DOCX_UNSUPPORTED')
    const name = text(bytes.subarray(offset + 30, offset + 30 + nameLength)); const payload = bytes.subarray(start, end); if (method !== 0 && method !== 8) fail('DOCX_UNSUPPORTED'); const data = method === 8 ? inflateRawSync(payload, { maxOutputLength: Math.min(uncompressed, 1048576) }) : payload; if (data.length !== uncompressed) fail('DOCX_UNSUPPORTED'); entries.push({ name, data }); offset = end
  }
  const names = entries.map((x) => x.name); if (!names.includes('word/document.xml') || names.some((name) => /vbaProject|\.bin$/i.test(name)) || names.some((name) => /word\/_rels\/.*\.rels$/i.test(name) && /TargetMode=["']External["']/.test(text(entries.find((x) => x.name === name).data)))) fail('DOCX_UNSUPPORTED')
  return entries.filter((x) => x.name === 'word/document.xml' || /^word\/(?:header|footer)\d+\.xml$/.test(x.name)).map((x) => xmlText(text(x.data))).join('\n')
}
function sourceText(input) { return input.content[0] === 0x50 && input.content[1] === 0x4b ? parseDocx(input.content) : parseMarkdown(input.content) }
function evaluatePart(part, source) {
  const markers = []
  for (const match of source.matchAll(pageCn)) markers.push({ page: Number(match[1]), total: Number(match[2]), offset: match.index })
  for (const match of source.matchAll(pageEn)) markers.push({ page: Number(match[1]), total: Number(match[2]), offset: match.index })
  for (const match of source.matchAll(pagePhysical)) markers.push({ page: Number(match[1]), total: Number(match[2]), offset: match.index })
  if (!markers.length) return { part, declared_total: null, observed: [], missing: [], duplicated: [], continuous: false, absent: true }
  const totals = [...new Set(markers.map((m) => m.total))]
  const declared = totals.length === 1 ? totals[0] : null
  if (declared !== null && (!Number.isSafeInteger(declared) || declared > 8000)) return { part, declared_total: declared, observed: [], missing: [], duplicated: [], continuous: false, budgetExceeded: true }
  const counts = new Map(); for (const marker of markers) counts.set(marker.page, (counts.get(marker.page) ?? 0) + 1)
  const observed = [...counts.keys()].sort((a, b) => a - b)
  const missing = declared ? Array.from({ length: declared }, (_, i) => i + 1).filter((n) => !counts.has(n)) : []
  const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([n]) => n)
  const unexpected = declared ? observed.filter((n) => n > declared) : []
  return { part, declared_total: declared, observed, missing, duplicated, unexpected, continuous: Boolean(declared && !missing.length && !duplicated.length && !unexpected.length && totals.length === 1), markers, totalConflict: totals.length > 1 }
}
function replaceCheck(checks, id, status, detail) { const rest = ensureArray(checks).filter((check) => check?.id !== id); rest.push({ id, name: names[id], status, ...(detail ? { finding: detail } : {}) }); return ['S1','S2','S3','S4','S5','S6','S7','S8'].map((id) => rest.find((c) => c.id === id) ?? { id, name: names[id] ?? id, status: 'not_covered' }) }
function isDerived(entry) { return /^(?:BLK-PAGE-[A-Z0-9-]+|BLK-DETERMINISTIC-[A-Z0-9-]+|FLG-PAGINATION-ABSENT|FLG-AMOUNT-IN-WORDS-MISMATCH|FLG-FREEZE-INCOMPLETE)$/.test(entry?.code ?? '') }
function blockedReceipt(receipt, code, anchor, message) {
  receipt.blocks = ensureArray(receipt.blocks).filter((x) => !isDerived(x)); receipt.flags = ensureArray(receipt.flags).filter((x) => !isDerived(x))
  receipt.blocks.push(finding(`BLK-DETERMINISTIC-${code}`, 'block', anchor, message, 'Provide a supported, unambiguous source and rerun deterministic intake.'))
  receipt.freeze.page_range = { ...(receipt.freeze?.page_range ?? {}), frozen: false, parts: [] }
  receipt.all_frozen = false; receipt.consistency_conclusion_allowed = false; receipt.verdict = 'blocked'; receipt.verdict_label = '拒绝'; receipt.verdict_basis = `Deterministic source check HOLD: ${code}.`; receipt.handoff = { ...(receipt.handoff ?? {}), to: null }; receipt.remediation = [...ensureArray(receipt.remediation), '提供可由确定性受权源检查读取的合同原件后重新受理。']
  receipt.checks = replaceCheck(replaceCheck(receipt.checks, 'S3', 'block', message), 'S7', 'block', message)
  return { contract_intake_receipt: receipt }
}

export function evaluate(envelope) {
  if (!envelope || envelope.protocol !== PROTOCOL || !envelope.params || !Array.isArray(envelope.inputs)) fail('INVALID_SNAPSHOT_ENVELOPE')
  const { receipt_base: candidate, parts } = envelope.params
  if (!candidate?.contract_intake_receipt || !Array.isArray(parts) || !parts.length) fail('INVALID_RECEIPT_BASE')
  const receipt = structuredClone(candidate.contract_intake_receipt); receipt.freeze ??= {}; const byHash = new Map()
  for (const input of envelope.inputs) {
    if (input?.param !== 'contract_paths' || input.encoding !== 'base64' || !/^[a-f0-9]{64}$/.test(input.sha256 ?? '')) fail('INVALID_SNAPSHOT_INPUT')
    const content = Buffer.from(input.content ?? '', 'base64'); if (content.length !== input.size || sha(content) !== input.sha256) return blockedReceipt(receipt, 'SOURCE_HASH_MISMATCH', { part: 'body', page: null, quote: 'snapshot sha256 mismatch' }, 'Source snapshot identity did not match its trusted SHA-256.')
    if (byHash.has(input.sha256)) return blockedReceipt(receipt, 'DUPLICATE_SOURCE', { part: 'body', page: null, quote: input.sha256 }, 'A source snapshot SHA-256 was supplied more than once.')
    byHash.set(input.sha256, { ...input, content })
  }
  const selected = []; const seenHashes = new Set(); const seenParts = new Set()
  if (parts.length !== byHash.size) return blockedReceipt(receipt, 'PART_BINDING_INVALID', { part: 'body', page: null, quote: 'mapping count differs from snapshot count' }, 'Each supplied source snapshot must have exactly one part mapping.')
  for (const mapping of parts) { if (!/^[a-f0-9]{64}$/.test(mapping?.sha256 ?? '') || !/^(body|attachment:.+)$/.test(mapping.part ?? '') || !byHash.has(mapping.sha256) || seenHashes.has(mapping.sha256) || seenParts.has(mapping.part)) return blockedReceipt(receipt, 'PART_BINDING_INVALID', { part: 'body', page: null, quote: 'duplicate or invalid SHA-bound part mapping' }, 'Each snapshot and each content part must have one unambiguous mapping.'); seenHashes.add(mapping.sha256); seenParts.add(mapping.part); selected.push({ part: mapping.part, input: byHash.get(mapping.sha256) }) }
  const scopeParts = receipt.scope?.parts
  if (!Array.isArray(scopeParts) || scopeParts.length !== seenParts.size || new Set(scopeParts.map((part) => part?.id)).size !== scopeParts.length || scopeParts.some((part) => typeof part?.id !== 'string' || !seenParts.has(part.id))) return blockedReceipt(receipt, 'SCOPE_PARTS_INVALID', { part: 'body', page: null, quote: 'scope.parts does not exactly match snapshot part mappings' }, 'Declare each submitted body or attachment part exactly once before deterministic checking.')
  let sources
  try { sources = selected.map(({ part, input }) => ({ part, text: sourceText(input) })) } catch (error) { return blockedReceipt(receipt, 'SOURCE_UNSUPPORTED', { part: 'body', page: null, quote: String(error.message) }, 'Source bytes are unsupported, dynamically paginated, encrypted, or not strict UTF-8 Markdown.') }
  const pages = sources.map(({ part, text: value }) => evaluatePart(part, value)); const blocks = [], flags = []
  for (const result of pages) {
    const src = sources.find((x) => x.part === result.part); const anchor = sourceAnchor(result.part, src.text, result.markers?.[0]?.offset ?? 0)
    if (result.budgetExceeded) return blockedReceipt(receipt, 'PAGE_BUDGET', anchor, 'The declared page total exceeds the deterministic page budget.')
    if (result.absent) { flags.push(finding('FLG-PAGINATION-ABSENT', 'flag', anchor, `No static page marker was found for ${result.part}.`, 'Provide a source with static physical page marks.')); continue }
    if (result.totalConflict) blocks.push(finding('BLK-PAGE-TOTAL-CONFLICT', 'block', anchor, `${result.part} declares conflicting page totals.`, 'Provide one consistent page-total sequence.', 'page-discontinuity'))
    if (result.duplicated.length) blocks.push(finding('BLK-PAGE-DUPLICATE', 'block', anchor, `${result.part} duplicates page ${result.duplicated.join(', ')}.`, 'Provide each declared page exactly once.', 'page-discontinuity'))
    if (result.missing.length || result.unexpected.length) blocks.push(finding('BLK-PAGE-INCOMPLETE', 'block', anchor, `${result.part} is not the declared complete page set.`, 'Provide the complete declared page sequence.', 'page-discontinuity'))
  }
  let mismatch = false
  try { for (const { part, text: value } of sources) { let pairs = 0; for (const expression of amountPairs) for (const match of value.matchAll(expression)) { pairs++; const [upper, arabic] = expression === amountPairs[0] ? [match[1], match[2]] : [match[2], match[1]]; if (upperCents(upper) !== parseCents(arabic)) { mismatch = true; flags.push(finding('FLG-AMOUNT-IN-WORDS-MISMATCH', 'flag', sourceAnchor(part, value, match.index), 'Paired uppercase and Arabic amounts differ.', 'Confirm and align the paired amount expressions.', 'amount-in-words-mismatch')) } } if (pairs === 0 && /(?:\bSAY\b|大写\s*[:：]?|人民币\s*[零壹贰叁肆伍陆柒捌玖])/.test(value)) fail('AMOUNT_PAIR_UNSUPPORTED') } } catch (error) { return blockedReceipt(receipt, 'AMOUNT_UNCERTAIN', { part: 'body', page: null, quote: String(error.message) }, 'A paired amount could not be interpreted exactly.') }
  const partyBlocked = ensureArray(receipt.blocks).some((entry) => /^BLK-PARTY-/.test(entry?.code ?? ''))
  receipt.blocks = ensureArray(receipt.blocks).filter((x) => !isDerived(x)).concat(blocks); receipt.flags = ensureArray(receipt.flags).filter((x) => !isDerived(x)).concat(flags)
  receipt.freeze.page_range = { ...(receipt.freeze.page_range ?? {}), frozen: !blocks.length && !pages.some((p) => p.absent), parts: pages.map(({ markers, totalConflict, absent, ...safe }) => safe) }
  receipt.checks = replaceCheck(replaceCheck(receipt.checks, 'S3', blocks.length ? 'block' : flags.some((f) => f.code === 'FLG-PAGINATION-ABSENT') ? 'conditional' : 'pass'), 'S7', partyBlocked ? 'block' : mismatch ? 'flag' : 'pass')
  const f = receipt.freeze; receipt.all_frozen = Boolean(f.master_version?.frozen && f.page_range?.frozen && f.attachment_manifest?.frozen && f.execution_status?.frozen); receipt.consistency_conclusion_allowed = receipt.all_frozen
  if (receipt.blocks.some((x) => x.code.startsWith('BLK-'))) { receipt.verdict = 'blocked'; receipt.verdict_label = '拒绝'; receipt.handoff = { ...(receipt.handoff ?? {}), to: null } } else if (receipt.flags.length || !receipt.all_frozen) { receipt.verdict = 'conditional'; receipt.verdict_label = '条件通过' } else { receipt.verdict = 'passed'; receipt.verdict_label = '通过' }
  receipt.verdict_basis = 'S3/S7 and four-freeze AND were recomputed from authorized snapshots; other receipt facts remain source-anchored Agent observations.'
  return { contract_intake_receipt: receipt }
}

async function main() { try { const raw = await new Promise((resolve, reject) => { let data = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (x) => { data += x }); process.stdin.on('end', () => resolve(data)); process.stdin.on('error', reject) }); const output = evaluate(JSON.parse(raw)); process.stdout.write(JSON.stringify({ success: true, output })); } catch (error) { process.stderr.write(String(error?.message ?? error)); process.exitCode = 1 } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
