export function decideReceiptAdmission({ toolSuccess, validationReport, receipt }) {
  const schemaValid = toolSuccess === true && validationReport?.valid === true
  const serialized = receipt?.serialization_status === 'valid'
  const businessMayContinue = receipt?.verdict !== 'blocked'
  return {
    startO2: schemaValid && serialized && businessMayContinue && receipt?.handoff?.to === 'contract-review-lead',
    reason: !toolSuccess ? 'validator_tool_failed'
      : validationReport?.valid !== true ? 'schema_invalid'
        : !serialized ? 'serialization_not_valid'
          : !businessMayContinue ? 'business_blocked'
            : receipt?.handoff?.to !== 'contract-review-lead' ? 'handoff_not_to_lead'
              : 'admitted',
  }
}
