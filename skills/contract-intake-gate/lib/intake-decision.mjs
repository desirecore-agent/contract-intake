const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const deny = (reason) => ({ startO2: false, reason })

/**
 * Pure admission decision for an already parsed, same-byte receipt.
 * The caller must obtain validationReport from the trusted validator invocation,
 * not an agent-authored sidecar, and derive expected hashes from the actual bytes
 * that it read and parsed. This helper does not authenticate tool provenance or
 * invoke the runtime; fixture tests of it are not live-dispatch evidence.
 */
export function decideReceiptAdmission(input) {
  if (!isObject(input)) return deny('input_invalid')
  const { toolSuccess, validationReport, receipt, expectedDocumentSha256, expectedSchemaSha256 } = input
  if (toolSuccess !== true) return deny('validator_tool_failed')
  if (!isObject(validationReport) || typeof validationReport.valid !== 'boolean') return deny('validator_report_invalid')
  if (validationReport.valid !== true) return deny('schema_invalid')
  if (!isDigest(expectedDocumentSha256) || !isDigest(expectedSchemaSha256)
      || !isDigest(validationReport.document_sha256) || !isDigest(validationReport.schema_sha256)) return deny('validation_binding_missing')
  if (expectedDocumentSha256 !== validationReport.document_sha256
      || expectedSchemaSha256 !== validationReport.schema_sha256) return deny('validation_digest_mismatch')
  if (!isObject(receipt) || receipt.serialization_status !== 'valid') return deny('serialization_not_valid')
  if (receipt.verdict !== 'passed' && receipt.verdict !== 'conditional') return deny('business_blocked')
  if (receipt.handoff?.to !== 'contract-review-lead') return deny('handoff_not_to_lead')
  return { startO2: true, reason: 'admitted' }
}
