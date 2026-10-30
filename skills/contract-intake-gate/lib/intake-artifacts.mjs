import path from 'node:path'

function pathApi(value) {
  if (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && path.win32.isAbsolute(value)) return path.win32
  if (path.posix.isAbsolute(value)) return path.posix
  throw new TypeError('canonicalRoot must be an absolute POSIX, drive-letter, or UNC path')
}

function safeId(value, name) {
  if (typeof value !== 'string' || value.length === 0 || /[\\/]/.test(value) || value === '.' || value === '..') {
    throw new TypeError(`${name} must be one path-safe segment`)
  }
  return value
}

export function buildIntakeArtifactPaths({ canonicalRoot, intakeId }) {
  const api = pathApi(canonicalRoot)
  const id = safeId(intakeId, 'intakeId')
  const directory = api.join(canonicalRoot, 'intake')
  return {
    receipt: api.join(directory, `${id}.receipt.yaml`),
    detail: api.join(directory, `${id}.detail.yaml`),
    validation: api.join(directory, `${id}.validation.json`),
  }
}

export function createValidationSidecar({ intakeId, documentPath, schemaPath, format, documentSha256, schemaSha256, toolSuccess, validationReport }) {
  safeId(intakeId, 'intakeId')
  pathApi(documentPath)
  pathApi(schemaPath)
  if (!['yaml', 'json'].includes(format)) throw new TypeError('format must be yaml or json')
  if (!/^[a-f0-9]{64}$/.test(documentSha256) || !/^[a-f0-9]{64}$/.test(schemaSha256)) throw new TypeError('full sha256 values are required')
  const reportShapeValid = validationReport !== null && typeof validationReport === 'object'
    && typeof validationReport.valid === 'boolean'
    && /^[a-f0-9]{64}$/.test(validationReport.document_sha256 ?? '')
    && /^[a-f0-9]{64}$/.test(validationReport.schema_sha256 ?? '')
    && /^[a-f0-9]{64}$/.test(validationReport.report_sha256 ?? '')
    && typeof validationReport.code === 'string'
    && typeof validationReport.profile === 'string'
    && typeof validationReport.version === 'string'
    && validationReport.format === format
  const digestMatch = reportShapeValid
    && validationReport.document_sha256 === documentSha256
    && validationReport.schema_sha256 === schemaSha256
  const diagnostics = []
  if (toolSuccess === true && !reportShapeValid) diagnostics.push({ code: 'validator_report_invalid' })
  if (reportShapeValid && validationReport.document_sha256 !== documentSha256) diagnostics.push({ code: 'document_sha256_mismatch', expected: documentSha256, actual: validationReport.document_sha256 })
  if (reportShapeValid && validationReport.schema_sha256 !== schemaSha256) diagnostics.push({ code: 'schema_sha256_mismatch', expected: schemaSha256, actual: validationReport.schema_sha256 })
  if (reportShapeValid && validationReport.valid === false) diagnostics.push({ code: validationReport.code, pointer: validationReport.pointer ?? null })
  return {
    sidecar_version: 'intake-validation-v1',
    intake_id: intakeId,
    document: { path: documentPath, sha256: documentSha256, format },
    schema: { path: schemaPath, sha256: schemaSha256 },
    tool_success: toolSuccess === true,
    validator_report_sha256: reportShapeValid ? validationReport.report_sha256 : null,
    schema_valid: toolSuccess === true && digestMatch && validationReport.valid === true,
    diagnostics,
  }
}

export function validateRerunIdentity({ previous, next }) {
  if (!previous || !next) return { valid: false, reason: 'missing_identity' }
  try {
    safeId(previous.intakeId, 'previous.intakeId'); safeId(next.intakeId, 'next.intakeId')
  } catch { return { valid: false, reason: 'identity_invalid' } }
  if (previous.intakeId === next.intakeId) return { valid: false, reason: 'intake_id_reused' }
  if (!/^[a-f0-9]{64}$/.test(previous.receiptSha256 ?? '') || next.previousReceiptSha256 !== previous.receiptSha256) {
    return { valid: false, reason: 'previous_receipt_not_preserved' }
  }
  let previousRoot, nextRoot
  try {
    const previousApi = pathApi(previous.canonicalRoot), nextApi = pathApi(next.canonicalRoot)
    previousRoot = previousApi.normalize(previous.canonicalRoot)
    nextRoot = nextApi.normalize(next.canonicalRoot)
  } catch { return { valid: false, reason: 'root_not_absolute' } }
  if (previousRoot === nextRoot) return { valid: false, reason: 'run_root_reused' }
  return { valid: true }
}
