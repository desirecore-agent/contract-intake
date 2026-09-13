---
name: contract-intake-deterministic-check
description: 从受权快照计算 S3 与 S7.2 并原子输出回执。
risk_level: low
requires_confirmation: false
executor: script
script:
  runtime: node
  command: s3-s7.mjs
  args: []
  io:
    protocol: snapshot-v1
    input_path_params:
      - contract_paths
    output_path_param: output_path
    max_input_bytes: 1048576
    max_total_input_bytes: 4194304
    max_output_bytes: 1048576
input_schema:
  type: object
  additionalProperties: false
  required:
    - contract_paths
    - output_path
    - receipt_base
    - parts
  properties:
    contract_paths:
      oneOf:
        - type: string
        - type: array
          minItems: 1
          maxItems: 16
          items:
            type: string
      description: Authorized contract sources; snapshot-v1 removes paths before script execution.
    output_path:
      type: string
      description: Authorized create-only final receipt destination; snapshot-v1 removes it before script execution.
    receipt_base:
      type: object
      description: Candidate receipt facts from S1, S2, S4-S6 and S8. The script overwrites S3 and S7.2 amount results plus derived verdict fields.
    parts:
      type: array
      minItems: 1
      maxItems: 16
      description: Each snapshot SHA-256 bound to its S1 content part; no filesystem path is accepted.
      items:
        type: object
        additionalProperties: false
        required: [sha256, part]
        properties:
          sha256: { type: string, pattern: '^[a-f0-9]{64}$', description: SHA-256 returned for the exact authorized snapshot. }
          part: { type: string, pattern: '^(body|attachment:.+)$', description: S1 content part label bound to that exact snapshot SHA-256. }
metadata:
  author: DesireCore
  version: "1.0.0"
  provider_type: script
---

# Deterministic S3/S7 receipt writer

The script receives only snapshot-v1 stdin. It verifies each snapshot SHA-256, requires the receipt scope part IDs to equal the snapshot mappings, parses supported Markdown or bounded static DOCX bytes, recomputes S3, S7.2, four-freeze AND and the mechanical verdict, then returns one JSON receipt. Platform writes that JSON atomically to the authorized output slot. It never opens or resolves caller paths; nested source text remains candidate facts, not path authority. It uses no network, shell, subprocesses, third-party dependencies, or candidate S3/S7.2 outcomes.

Unsupported, ambiguous, encrypted, macro-enabled, externally-related, dynamic-page DOCX content, invalid UTF-8 Markdown, or a hash mismatch is a typed blocked receipt/HOLD outcome. JSON output is valid YAML, but structural validation remains a separate required gate.
