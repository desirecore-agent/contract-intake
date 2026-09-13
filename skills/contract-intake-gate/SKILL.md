---
name: contract-intake-gate
description: >-
  合同审查流水线的输入治理闸门。对提交的合同材料执行固定顺序的 8 步硬校验（受理范围切分、
  主版本冻结、页码连续性、附件清单四字段对账、签章状态、占位符扫描、主体身份一致性、版本矩阵对齐），
  产出「通过 / 条件通过 / 拒绝」三态受理回执与结构化交接块。命中阻断项时直接终止流水线，
  不降级为提醒、不向下游交接。用户提到合同受理、合同预检、准入校验、输入治理、附件清单核对、
  签章状态确认、页码完整性、版本冻结、版本矩阵对齐时使用。
  Use when gating contract materials before clause extraction: freezes master version,
  attachment manifest, page range and execution status; blocks placeholders, missing
  attachments, unconfirmed signatures, broken pagination and party-name mismatches.
version: 1.0.4
type: procedural
risk_level: low
status: enabled
tags:
  - contract-review
  - intake
  - input-governance
  - completeness-check
  - version-freeze
requires:
  tools:
    - Read
    - Ls
    - Glob
    - FileDigest
    - Grep
    - Write
    - MathCalc
    - GenerateUUID
    - UnderstandImage
    - StructuredFileValidate
metadata:
  author: DesireCore
  version: 1.0.4
  updated_at: '2026-09-10'
---

# 合同输入治理闸门

## 何时使用

收到任何待审查的合同材料时**第一个**执行本技能。下游的条款抽取、风险识别、法域合规、
复核出报告四个环节，只有在本技能给出 `通过` 或 `条件通过` 后才允许启动。

## 不可协商的前提

1. **S1→S8 顺序固定**，不得打乱、不得跳步、不得因为"看起来没问题"提前结束。顺序固定是为了让任何人重跑得到同样的过程。
2. **阻断即拒绝**。命中任一 `BLK-*` 编码，最终结论只能是 `blocked`（拒绝），且**不得调用 Delegate / SendMessage 向下游交接**，也不得输出条款清单或风险清单。
3. **没检查到就显式留白**。检查矩阵里每一项都必须有状态；未覆盖写 `not_covered`，不得因为没提就当 `pass`。
4. **四大冻结未全部成立时，禁止输出任何"一致 / 无差异 / 差异为 0"结论。**

5. **结构化回执必须先保证 YAML 语法，再谈业务结论。** 本技能定义的机器消费产物是最终
   `contract_intake_receipt` 回执；没有独立 `intake.yaml` 的路径、模板或数据契约，不得凭空
   新建、验证或交接第二份同数据产物。回执
   只能使用块式映射/序列；任何标量中含 ASCII 双引号、冒号、井号、方括号、花括号、换行
   或前导/尾随空格时，必须改用单引号（单引号本身写成两个连续单引号）或块标量 `|` / `>`。
   禁止把含英文双引号的文本放进双引号标量而不转义，禁止复制 flow map/flow sequence 示例。
6. **回读与结构校验都必须有工具证据。** `Read` 只能证明文件内容已回读，不能证明 YAML
   可解析。首次写入候选回执前，必须先对本技能目录中的
   `references/contract-intake-receipt.schema.json` 实际调用 `Read`；该读取失败即如实 HOLD，不得写入候选
   或交接。本技能随后必须在写入候选回执并 `Read` 后，实际调用一次
   `StructuredFileValidate({document_path: <最终回执绝对路径>, schema_path: <本技能目录>/references/contract-intake-receipt.schema.json, format: "yaml"})`。
   该调用仅验证 YAML 与本地 Draft-07 回执结构，不能证明跨文件一致性、法律结论、人类闸门、
   签章真实性或任何 Compose 保证，也不得把模型声称的 `valid`、工具 hash 或审计字段写入业务回执。
   现有回执协议没有 `yaml_unverified` 或验证状态字段；不得为了记录本次校验而向业务回执
   凭空增加字段。工具调用成功且返回 `valid: true` 后，才可把已校验的候选文件作为最终回执并按
   既有 verdict 规则交接。`valid: false` 时只允许修正本 Agent 刚写入的候选回执一次；修正后必须重新 `Read` 并以相同
   路径、schema 路径和 `format: "yaml"` 重验。第二次 `valid: false`、任何路径/schema/parser/runtime
   工具错误或未获结果，均在本轮对话如实报告 `HOLD`、不调用 `Delegate` / `SendMessage` 向下游交接，
   且不得把未验证或无效候选文件作为回执交付、不得伪造 `passed`、可信回执或 hash。验证成功后
   不得再对该文件 `Write` / `Edit`；若确有后续写入，先前成功校验立即失效，交付前必须再次 `Read`
   并重新实际调用校验工具。此验证不改变 S1–S8、四大冻结、verdict、Human Gate
   与既有跨字段检查；这些业务检查仍必须在本 Agent 中完成。
   特别是 `unsigned_draft` 的回执与交接 `exception_basis` 必须继续按既有规则逐字段精确镜像
   比较；本地 Draft-07 只能校验两处各自的结构，不能证明跨位置值相等，不得将结构通过当作镜像通过。
7. **写入前自检高风险标量。** 对 `note`、`detail`、`finding`、`statement`、`evidence.quote`
   等自由文本逐个检查引号配对与缩进；无法安全编码时用块标量，不得为了省字删掉证据或改写
   原文。写入后再次 `Read`，保持 `input_file.absolute_path`、SHA 和所有门禁字段不变。

---

## 术语：三类判定

| 类别 | 编码前缀 | 语义 | 对结论的影响 |
|---|---|---|---|
| **阻断项** | `BLK-` | 材料自身事实缺失或自相矛盾，下游无论如何处理都会得到错误结论 | 结论强制为 `blocked` |
| **失败标记** | `FLG-` | 事实完整但置信度或覆盖度不足，下游可在知情前提下继续 | 结论降为 `conditional`（**照常交接、下游照常全量执行**） |
| **范围事实** | `SCOPE-` | 本次受理客观的边界（哪些部件随材料送达） | **永远不影响结论**，只写进 `scope` |

判不准时**按阻断处理**。误拦一次的成本是补一次材料；误放一次的成本是整条流水线的结论作废。

### 判定编码与门禁结论的关系（**必须严格遵守**）

门禁结论**只由 `BLK-*` 与 `FLG-*` 决定**。`SCOPE-*` 是客观范围记录，**永远不改变门禁结论**——
把范围事实当缺陷会在正常合同上产生门禁错判。

### 对外统一的 `gate_reason_id`

内部编码（`BLK-*` / `FLG-*`）用于本技能内部推理；**对外输出的每一条都必须同时带上下表的
`gate_reason_id`**，下游与验收口径以它为准：

| `gate_reason_id` | 阻断 | 内部编码 |
|---|---|---|
| `placeholder-unfilled` | 是 | `BLK-PLACEHOLDER` |
| `attachment-missing` | 是 | `BLK-ATTACHMENT-MISSING` |
| `signature-status-unconfirmed` | 是 | `BLK-SIGNATURE-INCOMPLETE` / `BLK-SIGNATURE-BLOCK-ABSENT` / `BLK-EXECUTION-DATE-CONFLICT` / `BLK-EXECUTION-STATUS-CONFLICT` |
| `page-discontinuity` | 是 | `BLK-PAGE-INCOMPLETE` / `BLK-PAGE-DUPLICATE` / `BLK-PAGE-TOTAL-CONFLICT` |
| `version-mismatch` | 是 | `BLK-ATTACHMENT-VERSION-CONFLICT` / `BLK-ATTACHMENT-NAME-CONFLICT` |
| `party-name-inconsistency` | 是 | `BLK-PARTY-INCONSISTENT` / `BLK-PARTY-ROLE-CONFLICT` |
| `amount-in-words-mismatch` | **否** | `FLG-AMOUNT-IN-WORDS-MISMATCH` |
| `attachment-manifest-incomplete` | **否** | `FLG-ATTACHMENT-MANIFEST-INCOMPLETE` |

表外的内部编码（`BLK-OBJECT-UNIDENTIFIED`、`BLK-JURISDICTION-PACK-MISMATCH` 等）照常影响门禁结论，
输出时 `gate_reason_id` 写 `null` 并在 `finding` 里说清楚。

---

## S1 受理范围清点与部件切分

**怎么检**

1. 用 `Ls` / `Glob` 列出本次提交的全部文件，逐一 `Read`，再按以下顺序计算摘要：
   a. 把本次已确认输入逐字冻结为 `submitted_file_paths` 的原始路径列表：用户给出的绝对路径直接复用，不得自动改写；当前团队 cwd 已确认且用户给出不含 `..` 的相对路径（可含子目录）时，直接原样提交工具，由工具按 context.cwd 和既有路径安全校验解析，不得先拼接长 cwd。cwd 不可用时记录该路径不能解析并停止该文件；不得猜测、缩短、重组/换根或改用旧 workspace。
   b. 只用 `FileDigest`。`N = 1` 时唯一形状是 `FileDigest({paths: submitted_file_paths[0]})`，其中 `paths` 是原样裸字符串且 JSON 外观仍按字面路径处理。`N > 1` 时只有当前工具参数明示 `paths_json` 兼容入口才可调用唯一形状 `FileDigest({paths_json: JSON.stringify(submitted_file_paths)})`；这只是参数构造示例，不得调用 shell 或 JS。`paths_json` 必须是该完整集合的 JSON 字符串数组（1–100 项、UTF-8 不超过 64 KiB），解码后逐项等于 `submitted_file_paths`、不多不少，且不得同时传 `paths`、`file_path` 或 `path`。`FileDigest.paths_json` 是发布此批量规则的最小客户端能力要求；入口未提供时立即在既有 S1 finding/`unknown` failure reason 中写 `batch_unverified` 后停止 S1 摘要步骤。
   c. 批量成功仅在返回 `files[].path` 逐项对应完整 `submitted_file_paths` 集合、`files[]` 完整且 `aggregate.file_count = N` 时成立；只用工具返回的 `absolute_path` 和 `digest` 登记既有规范绝对路径字段与摘要，不把 `absolute_path` 声称为自动 realpath 身份，才可记录完整集合 aggregate。只有 `FileDigest` 明确返回参数形态错误时，才可保持同一原集合和同一 `paths_json` 形状纠正一次；绝不拆成多个单文件调用、缩减集合或以单文件 aggregate 冒充批量。
    d. 除 c 的明确参数形态错误外，权限拒绝、超限、文件消失、入口不可用、真实执行失败、返回缺项或 aggregate 数不符，都在既有 S1 finding/`unknown` failure reason 中明确 `batch_unverified` 和真实工具原因后停止 S1 摘要步骤；不得跨文件把冻结记为 `true`、编造 SHA-256 或以此为依据通过。本 Agent 的工具权限不含 `Bash`、`PowerShell` 或 `TerminalControl`，不得用 shell 诊断、重试或替代 `FileDigest`。

**Lead 双集合摘要契约。**只有 `Delegate` 的显式 `handoff.case_id` 可作为本案 case_id；不得从 `intentId`、Work Context、旧回执或成员文本推导。Lead 的 O1 交接必须含 `submitted_file_paths`、`object.documents` 和 `input_inventory`；S1 的完整批量 aggregate 必须逐字等于 `input_inventory.submission_inventory_manifest_digest`；`object.documents` 只能是 Lead 已声明的 current 合同集，且 `object.manifest_digest` 必须逐字等于 `input_inventory.current_contract_manifest_digest`。`submission_inventory_manifest_digest` 与 `current_contract_manifest_digest` 都是既有内容摘要字符串：任一不可得写 `unknown` 并保留各自真实 `*_unavailable_reason`；不得互换、从一个推导另一个，或将当前集合缩成单文件。缺失、值不等、S1 aggregate 不等、case_id 不在显式 handoff，或 object documents 含非 current 集合时，写 `O1_MANIFEST_CONTRACT_INVALID` 并 HOLD。S4 `attachment_manifest_digest` 仅是四字段对账表摘要，必须与两个 FileDigest 集合摘要分开记录、不得作为其别名或比较依据。
2. 把内容切分为**文档部件（part）**：
   - `body` —— 合同正文
   - `attachment:<编号>` —— 随材料送达的附件正文（如 `attachment:附件二`、`attachment:Exhibit B`）

   > **部件是按内容切分的，不是按文件切分的。** 一个文件里可能同时含正文与一份或多份
   > 附件正文（常见于导出为单一 Markdown/PDF 的合同：正文之后接
   > 「附件二　服务水平协议」再接其全文）。逐文件 `Read` 之后，必须在**文件内部**
   > 继续按附件标题切分，不能因为「只提交了一个文件」就断定附件正文未送达。
   >
   > 判据：文件内出现形如 `# 附件<编号>　<名称>` / `## Exhibit <X>` 的标题，
   > 且其后有实质条款正文（而非仅在附件清单表格里被列名），即应登记为独立部件。
   >
   > 实测教训：C06a/C06b 把附件二 SLA 全文内嵌在同一份 .md 里，
   > 因只按文件数判断而误报 `SCOPE-ATTACHMENT-BODY-ABSENT`，
   > 导致下游范围事实错误、被统筹官形式检查打回返工。
3. 识别提交模式：
   - `single` —— 单一版本受理
   - `version_comparison` —— 同一合同的两个及以上版本同时提交（要求做版本对照）
4. 用 `GenerateUUID` 生成 `intake_id`，且只能为 ASCII 格式 `INTAKE-YYYYMMDD-8hex`（正则 `^INTAKE-[0-9]{8}-[0-9a-f]{8}$`）：日期为本次生成日，`8hex` 取该次真实 UUID 的前 8 个小写十六进制字符。若不符合，重新调用 `GenerateUUID` 并按其真实返回值生成，不得从合同内容清洗、截取或派生 ID。

**“组成合同的文件”与附件清单的边界**：正文以“组成本合同的文件包括……”列举采购文件、
答疑/更正公告、中标公告、响应文件、补充协议等程序性材料时，如果没有显式的“附件清单 / 合同附件 /
Exhibit / Schedule”章节和附件编号，这些材料只是正文引用的组成材料。应记录为
`SCOPE-ATTACHMENT-BODY-ABSENT` 或 `SCOPE-ATTACHMENT-VERSION-UNCOVERED`，不得因为材料
未随正文提交而创建 `BLK-ATTACHMENT-MISSING`。`BLK-ATTACHMENT-MISSING` 只适用于正文明确引用
某个编号/名称的附件，而正式附件清单中没有对应条目（S4 R1）。

**命中什么算失败**

| 情形 | 判定 |
|---|---|
| 提交为空 / 全部文件不可读 | `BLK-NO-MATERIAL` |
| 声称版本对比但只提交了一个版本 | `BLK-COMPARISON-INCOMPLETE` |
| 附件清单声明的附件正文未随材料送达 | `SCOPE-ATTACHMENT-BODY-ABSENT`（**范围事实，不是缺陷**） |
| 正文明确把另附、未送达的文件指定为**权威附件清单**，以致本次无法取得完整 `declared` 集合 | 见 S4 R9；不得仅因某一已声明附件正文未送达而命中 |

> ⚠️ 最容易误报的地方：**附件正文没随材料来 ≠ 缺失附件**。冻结的对象是**附件清单**，不是附件文件。
> 只有"正文引用了、清单里没有"才是缺失（见 S4）。

**失败后输出什么**

写入 `scope`：

```yaml
scope:
  submission_mode: single
  parts:
    - id: body
      source: /abs/path/C02-software-outsourcing.md
    - id: attachment:附件二
      source: null
      delivered: false
  in_scope: [正文完整性, 附件清单一致性, 签章状态, 页码连续性, 版本矩阵]
  out_of_scope: [条款实质评价, 风险打分, 法域合规判断]
```

---

## S2 主版本冻结

**怎么检**

从 `body` 提取并锁定以下字段，逐个记录证据位置：

| 字段 | 取值来源 | 缺失时 |
|---|---|---|
| `contract_no` | 合同编号 / Contract No. | `BLK-OBJECT-UNIDENTIFIED` |
| `object_title` | 标题行 | `FLG-TITLE-MISSING` |
| `revision_label` | 编号后缀的状态标注，如"（草稿，待用印）""Draft""Rev.B" | 无标注时记 `null`，不算缺陷 |
| `execution_date_declared` | 首部"签署日期 / Date" | 见 S5 |
| `content_digest` | 正文规范化后的摘要（用于后续重提对照） | 不可得时记 `null` |

**版本对比模式（`version_comparison`）额外必做**

1. 对 `body` 做逐字对照，记录 `body_diff_count`。
2. **无论 `body_diff_count` 是否为 0，都必须继续做 S4 的附件清单跨版本对账。**
3. `body_diff_count == 0` 时，禁止写"两版一致"。正确写法是：
   `正文逐字相同（diff=0）；一致性结论待附件层对账后给出`。

**命中什么算失败**

| 情形 | 判定 |
|---|---|
| 找不到可唯一标识本合同的编号或等价标识 | `BLK-OBJECT-UNIDENTIFIED` |
| `revision_label` 标明草稿/待用印，但 S5 检出已完成签章 | `BLK-EXECUTION-STATUS-CONFLICT` |
| 版本对比模式下 `body_diff_count == 0` 且附件清单存在差异 | 见 S4 的 `FLG-ATTACHMENT-VERSION-CHANGED`，并强制 `must_escalate: true` |

**失败后输出什么**

```yaml
freeze:
  master_version:
    frozen: false
    contract_no: YCIT-OSD-2026-0042
    revision_label: 草稿，待用印
    execution_date_declared: "2026 年 3 月 __ 日"
    body_diff_count: null
    consistency_conclusion_allowed: false
```

---

## S3 页码范围冻结与连续性校验

**怎么检**

1. 用 `Grep` 抓取全部页码标记。至少支持两种形态：
   - 中文：`第 N 页 / 共 M 页`
   - 英文：`Page N of M`
2. **按部件分组**。正文一段序列、每个附件各一段序列。
3. 对每一组：
   - 取声明总页数 `M`（组内 `M` 不唯一时 → `BLK-PAGE-TOTAL-CONFLICT`）
   - 用 `MathCalc` 校验实际出现的页码集合是否等于 `{1..M}`
   - 缺号 → 记录缺失页列表；重号 → 记录重复页列表

> ⚠️ 最容易误报的地方：一个文件里可能同时存在"正文 1–7 / 共 7 页"和"附件 1–2 / 共 2 页"两段序列。
> **把它们混在一起判断会得出"页码从 7 跳回 1"的假阳性。**必须先按部件切分再判连续性。

**命中什么算失败**

| 情形 | 判定 |
|---|---|
| 某组页码集合 ≠ `{1..M}`（缺号） | `BLK-PAGE-INCOMPLETE` |
| 同组内声明总页数 `M` 不一致 | `BLK-PAGE-TOTAL-CONFLICT` |
| 页码重复 | `BLK-PAGE-DUPLICATE` |
| 全文无任何页码标记 | `FLG-PAGINATION-ABSENT`（无法冻结页码范围 → 结论至多 `conditional`） |

**失败后输出什么**

```yaml
freeze:
  page_range:
    frozen: false
    parts:
      - part: body
        declared_total: 8
        observed: [1, 2, 4, 5, 6, 7, 8]
        missing: [3]
        duplicated: []
        continuous: false
blocks:
  - code: BLK-PAGE-INCOMPLETE
    gate_reason_id: page-discontinuity
    severity: block
    clause: null
    evidence:
      part: body
      page: 3
      locator: "第 2 页与第 4 页之间"
      quote: "第 2 页 / 共 8 页 → 第 4 页 / 共 8 页"
    finding: 正文声明共 8 页，实际缺少第 3 页
    action: 补齐第 3 页原件后整份重新提交受理
```

---

## S4 附件清单冻结与四字段对账

这是**最容易漏、后果最重**的一步。蓝本第九节的"版本对比陷阱"整个落在这里。

**怎么检**

分三个来源分别建表，然后做三向对账：

1. **`declared`（清单声明）** —— 附则里的"本合同附件清单如下 / The Exhibits to this Agreement are"章节。
   逐条抽取四个字段：`no`（附件编号）、`name`（附件名称）、`version`（版本标识）、`doc_no`（文档编号）。
2. **`referenced`（正文引用）** —— 用 `Grep` 搜正文中所有出现的附件引用
   （`附件[一二三四五六七八九十]`、`Exhibit [A-Z]`、`Schedule \d`、`Annex \w`、`Appendix \w`），
   连同引用处写明的版本标识一并记录。
3. **`delivered`（随材料送达的附件正文）** —— 来自 S1 的部件表。

**对账规则（顺序不可换）**

| # | 规则 | 判定 |
|---|---|---|
| R1 | `referenced` 中某编号在 `declared` 中**没有条目** | `BLK-ATTACHMENT-MISSING` |
| R2 | 同一编号在 `referenced` 与 `declared` 中的 `version` **不相同** | `BLK-ATTACHMENT-VERSION-CONFLICT` |
| R3 | 同一编号在 `referenced` 与 `declared` 中的 `name` 实质不同 | `BLK-ATTACHMENT-NAME-CONFLICT` |
| R4 | `declared` 中同一编号出现多次且内容不同 | `BLK-ATTACHMENT-DUPLICATE` |
| R5 | `declared` 条目缺 `no` 或 `name` | `BLK-ATTACHMENT-UNIDENTIFIED`（身份无法冻结） |
| R6 | `declared` 条目**缺 `version`** | `SCOPE-ATTACHMENT-VERSION-UNCOVERED`（**不是缺陷，不影响门禁结论**） |
| R7 | `declared` 条目**未随材料送达正文** | `SCOPE-ATTACHMENT-BODY-ABSENT`（**不是缺陷，不影响门禁结论**） |
| R8 | 版本对比模式下，两版 `declared` 的同编号条目 `version` 或 `doc_no` 不同 | `FLG-ATTACHMENT-VERSION-CHANGED` + `must_escalate: true` |
| R9 | 正文明确指向独立的**权威附件清单**（如“完整附件清单见另附《合同附件目录》”），但该清单未随材料送达，因而无法确定完整 `declared` 集合 | `FLG-ATTACHMENT-MANIFEST-INCOMPLETE` + `PEND-001.must_escalate: true` |

> ⚠️ **R5/R6 的分界必须守住。**"附件一《岗位职责说明书》""Exhibit A — Statement of Work Template"
> 没有版本号，是常见且合法的写法。**只记 `SCOPE-`，既不阻断也不把门禁结论降为 `conditional`。**
> 要求每个附件都带版本号，会把一大批正常合同错判成 `conditional`，属于门禁错判。

> ⚠️ **R7 同理。**附件正文没随材料来 ≠ 附件缺失。冻结的对象是清单条目的身份，
> 不是附件文件本身。只在 `scope` 里如实登记 `delivered: false`，并让下游把相关检查项留白为
> `not_covered`。

> ⚠️ **R9 的范围必须收窄。**它只适用于本次材料明确承认存在、却未取得的**权威附件清单本身**；
> 这使 `declared` 集合无法被冻结，不能按“已知附件正文未送达”处理。不得把 R7、没有版本号的
> R6、或 R8 的版本变化改写为 R9。正文引用某附件而正式清单没有该条目仍是 R1 的 `blocked`，
> 绝不能降级为 `conditional`。

> ⚠️ **程序性组成材料也适用 R7。**“组成合同的文件”条款本身不是附件清单；没有附件编号的
> 采购文件/响应文件/补充协议只形成范围事实，不影响门禁结论。不要把 `SCOPE-*` 升格为 `BLK-*`。

> ⚠️ **R8 是"差异为 0"陷阱的唯一防线。**主文本逐字相同、diff 为零时，
> 系统会默认"附件也没变"从而整段跳过——而附件恰恰是从 `SLA-v1.2` 换成了 `SLA-v2.0`。
> 所以 R8 **不看 `body_diff_count`，无条件执行**。
>
> R8 只在 `version_comparison` 模式下产出**版本对照结论**，**不改变任何一份材料单独受理时的门禁结论**
>（各版本单独受理时若无 `BLK-*` / `FLG-*`，结论仍是 `passed`）。命中 R8 时：
> - `consistency_conclusion_allowed` 置 `false`
> - 在交接块的 `pending` 中写死"附件 `<编号>` 由 `<旧版本>` 替换为 `<新版本>`，风险变化方向未定，下游必须实质对比"
> - 标记 `must_escalate: true`，注明"下游不得自行消化本标记"

**R9 的跨字段回执契约（不可用泛化规则替代）**

R9 命中且不存在任一 `BLK-*` 时，必须同时满足以下条件：

1. `verdict: conditional` 且 `verdict_label: 条件通过`，并在 `flags` 写入结论四元组 `FLG-ATTACHMENT-MANIFEST-INCOMPLETE`，
   `gate_reason_id: attachment-manifest-incomplete`，证据必须定位到“另附/完整清单”这一权威来源。
2. `handoff.to` 保持正常下游目标；`conditional` 不是暂停或拒绝。
3. `handoff.pending` 必须有且仅有本次 R9 对应的 `PEND-001`，其
   `from_flag: FLG-ATTACHMENT-MANIFEST-INCOMPLETE` 和 `must_escalate: true`。待办必须要求人工补齐
   权威附件清单并禁止下游把未知附件内容当作已覆盖。

`must_escalate` **不**是全部 `FLG-*` 或全部未送达附件的通用推导。R8 继续按既有版本变化语义
单独升级；R7 的 `SCOPE-ATTACHMENT-BODY-ABSENT` 仍可在无 `BLK-*` / `FLG-*` 时得到 `passed`，
且不得生成 `PEND-001`。

**失败后输出什么**

```yaml
freeze:
  attachment_manifest:
    frozen: false
    declared:
      - {no: 附件一, name: 接口对接清单, version: null, doc_no: null}
      - {no: 附件二, name: 技术规格书, version: V1.1, doc_no: null}
    referenced:
      - {no: 附件一, name: 接口对接清单, version: null, at: {page: 1, clause: "1.1（三）"}}
      - {no: 附件二, name: 技术规格书, version: V1.3, at: {page: 1, clause: "1.2"}}
      - {no: 附件三, name: 验收标准,   version: null, at: {page: 2, clause: "2.3"}}
    delivered: []
blocks:
  - code: BLK-ATTACHMENT-MISSING
    gate_reason_id: attachment-missing
    severity: block
    clause: "2.3"
    evidence:
      part: body
      page: 2
      quote: "各里程碑的验收标准依附件三《验收标准》执行"
    finding: 正文引用附件三《验收标准》，附件清单（13.3）中无该条目
    action: 补入附件三《验收标准》，并在附件清单中登记编号、名称与版本标识
  - code: BLK-ATTACHMENT-VERSION-CONFLICT
    gate_reason_id: version-mismatch
    severity: block
    clause: "1.2"
    evidence:
      part: body
      page: 1
      quote: "详细功能规格以附件二《技术规格书 V1.3》为准"
    finding: 正文引用版本 V1.3，附件清单（13.3）声明版本 V1.1，附件对象身份不确定
    action: 统一正文与附件清单的版本标识，确认以哪一版为准后重新提交
```

---

## S5 签章状态冻结

**怎么检**

定位落款区（`（以下无正文）`、`IN WITNESS WHEREOF`、`签署页`、`Signature Page` 之后的内容）。
**对每一个签约方**分别核验四要素：

| 要素 | 中文形态 | 英文形态 |
|---|---|---|
| 签署主体 | `甲方：<名称>`、`乙方：<名称>` | `For and on behalf of <name>` |
| 签章 | `（公章）`、`（合同专用章）` | 骑缝章 / 公司印章标注（英文合同常无，见下） |
| 签署人 | `授权代表签字：<姓名>` + `职务：<职务>` | `Signature:` + `Name:` + `Title:` |
| 签署日期 | `签署日期：YYYY 年 M 月 D 日` | `Date: <date>` |

**判定规则**

1. **要素后为空即视为缺失。**`Signature: ______________________________`、`Name:` 后无内容、
   `签署日期：2026 年 3 月 __ 日` —— 全部按缺失处理，不得按"待填"宽容对待。
   这类留白**同时**是 S6 的占位符命中，但两条都要出：S6 说明"这里没填"，
   S5 说明"因此签署状态无法确认、生效要件不成立"。**只出 S6 那一条是分类错误。**
2. 英文合同普遍不用印章，**不得因为没有"公章"字样就判缺签章**；英文合同的签章要素以
   `Signature` 有实际签署痕迹（手写名、`/s/ Name` 电子签形式）为准。
3. 首部声明的 `execution_date_declared` 与落款 `Date` 不一致时，以**两者都必须有值且相等**为通过条件。

### 已知未签署草稿的辅助审查例外

仅当用户在**本次请求**明确要求草稿/谈判辅助审查，且本次材料自身明确声明当前版本为未签署草稿，
并且没有执行/签署审查要求或已完成落款/签章事实冲突时，才可将签署状态记为 `unsigned_draft`。这不是从缺少落款区、签名或日期反推出来的状态：状态未知、仅称“草稿”却未明确未签、混合执行请求、或材料与声明冲突时，仍按本节原有阻断规则处理。

在这一狭窄情形，S5 冻结的是“当前版本已知未签署”的状态记录，而不是签章字段完整性：
`freeze.execution_status.frozen: true`、`signature_status: unsigned_draft`、`verification_status: not_performed`，每一方仍用
`seal_field: not_covered`、带真实来源锚点的 `seal_evidence` 和 `evidence_level: known_unsigned_draft` 记录未签事实。
S5 可记 `pass`，但回执和交接必须同时记录 `review_purpose: draft_negotiation_assistance` 与同值的 `exception_basis`：
`request_scope_evidence` 必须逐字引用本轮用户草稿/谈判辅助审查范围，`material_evidence` 必须含材料绝对 `input_path`、`page`、`locator` 与明确未签草稿的原文 `quote`。回执和交接必须明确仅限草稿/谈判辅助审查、不可签署、未验证真实性、授权或合同效力；不得把 `unsigned_draft` 写成已签署、已生效或已验真。

用户要求执行/签署审查，或需要判断签署状态、签署权限、签章真实性或合同效力时，此例外不适用；
即使材料自称草稿，也必须按原有 S5 门禁阻断。草稿标签与已完成落款/签章事实冲突时，仍为 `BLK-EXECUTION-STATUS-CONFLICT`。

### 签章证据级别（只描述已见证据）

除已知未签署草稿辅助审查例外外，S5 的 `frozen: true` 只表示签章**字段完整性**已按下列证据冻结，不表示签章真实性、授权、合同效力或实际签署已经验证。对每一方在 `freeze.execution_status.parties[]` **必须**写 `evidence_level`、`seal_evidence` 与 `verification_status`，并在交接的已确认事项中带同样的限定；缺任一结构化证据字段，该方 S5 不得记 `pass`。

| `evidence_level` | 可据此陈述 | 不得据此陈述 |
|---|---|---|
| `declared_in_text` | 原文文本声明有公章/签名/职务/日期，且字段完整；印章字段须写 `seal_field: declared_in_text`，`seal_evidence` 必须含实际 `input_path`（绝对路径）、`page`、`locator` 与原文 `quote` | `seal: present`；印章、签名、授权或实际签署真实有效；已做图像或电子签验证 |
| `visual_mark_detected` | 已用本次实际 `UnderstandImage` 观察到印章或签名标记；`seal_evidence` 必须含实际 `input_path`（绝对路径）、`page` 或 `image_index`、`locator`、`visual_description` 和该次 `tool_observation`（`tool: UnderstandImage` + `summary`） | 标记真实、来源可信、授权有效，或已完成电子签验真 |
| `not_covered` | S5 字段缺失或无法观察；仍须用 `seal_field: not_covered` 和含实际 `input_path`、`page`、`locator`、`quote` 的 `seal_evidence` 说明缺口 | 任何正向签章状态或验真结论 |
| `known_unsigned_draft` | 仅上述草稿辅助审查例外：材料明确的当前未签署草稿状态，证据仍锚定原文 | 已签署、已生效、真实性、授权或合同效力已验证 |

纯 Markdown / OCR 文本中“已加盖单位公章”、姓名、职务和日期齐备时，使用 `declared_in_text`，`seal_field: declared_in_text`、完整 `seal_evidence` 和 `verification_status: not_performed`，并写明“未做图像或电子签真实性验证”。它仍可通过**字段完整**门禁；不要因缺少图像而误报 `BLK-SIGNATURE-INCOMPLETE`。只有对本次输入实际调用 `UnderstandImage` 并取得可审计观察摘要时，才可使用 `visual_mark_detected`，且 `verification_status` 仍为 `not_performed`；不得编造工具调用、观察摘要或引用。本技能没有验签工具或可信验真结果结构：禁止输出 `authenticity_verified`；外部证明材料最多引用其来源声明，也不得把图像可见升级为验真。

**命中什么算失败**

下表的缺签署人、日期、职务、公章标注或整体无落款区阻断，只有同时满足上述两项草稿辅助审查前提、无执行请求且无冲突，并完整记录 `review_purpose` 与两类 `exception_basis` 证据时才不触发；此豁免只针对这些缺字段，绝不豁免其他 S1–S8 门禁。

| 情形 | 判定 |
|---|---|
| 任一方缺签署人姓名 | `BLK-SIGNATURE-INCOMPLETE` |
| 任一方缺签署日期 | `BLK-SIGNATURE-INCOMPLETE` |
| 任一方缺职务 / Title | `BLK-SIGNATURE-INCOMPLETE` |
| 中文合同任一方缺公章标注 | `BLK-SIGNATURE-INCOMPLETE` |
| 首部签署日期与落款日期不一致 | `BLK-EXECUTION-DATE-CONFLICT` |
| 落款区整体缺失 | `BLK-SIGNATURE-BLOCK-ABSENT` |
| `revision_label` 为草稿但落款已完备 | `BLK-EXECUTION-STATUS-CONFLICT` |

**失败后输出什么**

```yaml
freeze:
  execution_status:
    frozen: false
    verification_status: not_performed
    parties:
      - party: 甲方
        name: Northwind Analytics Holdings Ltd.
        seal_field: not_covered
        seal_evidence:
          input_path: /workdir/contracts/example-signature-page.md
          page: 4
          locator: 落款区
          quote: 'Signature: ______________________________ / Name: / Title: / Date:'
        signatory: null     # 缺失
        title: null         # 缺失
        date: null          # 缺失
        complete: false
        evidence_level: not_covered
        verification_status: not_performed
blocks:
  - code: BLK-SIGNATURE-INCOMPLETE
    gate_reason_id: signature-status-unconfirmed
    severity: block
    clause: null
    evidence:
      part: body
      page: 4
      quote: "Signature: ______________________________ / Name: / Title: / Date:"
    finding: 双方签名区留空，缺签署人姓名、职务与签署日期，签署状态无法冻结
    action: 取得双方授权代表签署（姓名、职务、日期齐全）后重新提交受理
```

**纯文本字段完整的通过样例**（不新增平台强制字段；`evidence_level` / `verification_status` 是本技能的回执约定）：

```yaml
freeze:
  execution_status:
    frozen: true
    verification_status: not_performed
    parties:
      - party: 甲方
        name: 示例采购人
        seal_field: declared_in_text
        seal_evidence:
          input_path: /workdir/contracts/example-procurement-contract.md
          page: 3
          locator: 落款区，买方名称下方
          quote: '（已加盖单位公章）'
        signatory: 李四
        title: 法定代表人或委托代理人
        date: '2026-08-18'
        complete: true
        evidence_level: declared_in_text
        verification_status: not_performed
        verification_note: 仅核对 Markdown 文本声明；未做图像或电子签真实性验证
checks:
  - id: S5
    name: 签章状态
    status: pass
    finding: 文本声明的公章、签署人、职务与日期字段齐备；证据等级 declared_in_text，未做图像或电子签真实性验证
```

**图像可见标记的通过样例**（仅在下列 `tool_observation` 逐字来自本次实际 `UnderstandImage` 返回时使用；示例中的路径和摘要是结构形态，不是可复制的工具引用）：

```yaml
freeze:
  execution_status:
    frozen: true
    verification_status: not_performed
    parties:
      - party: 乙方
        name: 示例供应商
        seal_field: visual_mark_detected
        seal_evidence:
          input_path: /workdir/contracts/example-procurement-contract.pdf
          page: 3
          locator: 第 3 页右下角落款区
          visual_description: 可见圆形红色印章标记与手写签名形状
          tool_observation:
            tool: UnderstandImage
            summary: 本次工具观察到第 3 页右下角有圆形红色印章标记和手写签名形状
        signatory: 李四
        title: 法定代表人或委托代理人
        date: '2026-08-18'
        complete: true
        evidence_level: visual_mark_detected
        verification_status: not_performed
        verification_note: 仅记录本次图像观察；未做图像或电子签真实性验证
```

---

## S6 占位符与空字段扫描

**怎么检**

用 `Grep` 对**全部部件**跑下列模式（大小写不敏感，逐条记录命中行与页码）：

| 模式 | 说明 |
|---|---|
| `\$X` | 金额占位 |
| `\bTBD\b` | 待定 |
| `【待定】`、`【[^】]*待[^】]*】` | 中文方头括号待定 |
| `\[[^\]]*(金额\|价格\|日期\|数量\|名称\|待定)[^\]]*\]` | 方括号字段占位 |
| `_{2,}` | 下划线填空 |
| `X{3,}`、`▁+`、`……待补充` | 其他常见留白 |
| `待补充`、`另行确定`、`容后商定` | 中文软占位 |

**排除规则（避免误报，每一条都对应过一次真实误判）**

1. **个人信息脱敏掩码不是占位符。**`310115********0417`（身份证）、`138****6620`（手机号）、
   `\*\*\*\*@example.com`（邮箱）中的星号是**已填写并脱敏**的真实数据，不是待填空位。
   **把脱敏掩码判为占位符并阻断，是最典型的误报。**判据：掩码两侧有真实数据片段（前缀 + 后缀），
   而占位符两侧没有——`____________` 前后是"开户银行："和空行。
2. **只扫描实际选定的分支。**争议解决条款常写成“按以下第（①）项方式处理：①……仲裁；②……法院”。
   若已明确选择①，只对①分支检查空字段；未选中的②分支保留模板空白不构成
   `placeholder-unfilled`，也不构成签章或受理阻断。只有在材料声明两个分支均适用，或所选分支
   本身留空时，才按空字段处理。
3. Markdown 表格分隔行 `|---|---|` 与水平线 `---` **不是** `_{2,}` 的命中，模式只匹配下划线。
4. 正常的 Markdown 链接 `[文本](url)` 不命中方括号模式——方括号模式要求括号内含金额/价格/日期等字段词。
5. 罗马数字 `XX`、型号编码中的 `XXX`（如 `Model-XXX-2026` 且上下文为产品型号）不算留白；
   `X{3,}` 只在**独立成词且处于应填值的位置**时才命中。
6. 条文中作为示例出现的占位符（前后有"例如""形如""格式为"）记 `FLG-PLACEHOLDER-ILLUSTRATIVE`，不阻断。
7. **语义不确定不是词法占位符。**“买方所在地仲裁机构”“有管辖权的法院”等已填入的泛化描述
   不是 `$X`、下划线或待定字段，不得在 S6 生成 `BLK-PLACEHOLDER`。这类条款若需要具体化，
   在门禁通过后交给法域/风险 Agent 作为实质风险；受理 Agent 只记录原文，不提前替下游作法律裁决。

> ⚠️ 命中任一模式后，**先过一遍上述排除规则再定性**。占位符检查是本技能误报率最高的一步，
> 因为它是纯字符匹配，而"是不是占位符"要看语义位置。

> ⚠️ **落款区的占位符要报两次，不是一次。**`Signature: ______`、`签署日期：2026 年 3 月 __ 日`
> 同时满足两个判定：字符层面它是占位符（`placeholder-unfilled`），业务层面它是**签署状态无法确认**
>（`signature-status-unconfirmed`，见 S5）。**只报占位符、不报签署状态，属于分类错误。**
> 判据很简单：命中位置落在 S5 定位的落款区内，就必须同时产出 S5 的那一条。

**命中什么算失败**

| 情形 | 判定 |
|---|---|
| 任一命中且非示例性 | `BLK-PLACEHOLDER` |
| 仅示例性命中 | `FLG-PLACEHOLDER-ILLUSTRATIVE` |

**每一处命中都单独出一条**，不合并，因为补齐动作各不相同。

```yaml
blocks:
  - code: BLK-PLACEHOLDER
    gate_reason_id: placeholder-unfilled
    severity: block
    clause: "4.1"
    evidence: {part: body, page: 3, quote: "本合同总价款为人民币 $X 元（大写：【待定】）"}
    finding: 合同总价款为金额占位符，大写金额为【待定】
    action: 填入确定的合同总价款（小写与大写一致）
  - code: BLK-PLACEHOLDER
    gate_reason_id: placeholder-unfilled
    severity: block
    clause: "4.3"
    evidence: {part: body, page: 3, quote: "按人天单价 [金额] 元结算"}
    finding: 变更结算的人天单价未填
    action: 填入确定的人天单价
```

---

## S7 一致性校验：主体身份与金额大小写

本步包含两个独立子检查，都属于"文档内部自相矛盾"这一类。

### S7.1 主体身份一致性

**怎么检**

1. 从首部抽取各方的**权威名称**（甲方 / 乙方 / Party A / Party B 全称）与统一社会信用代码 /
   注册号（有则一并冻结）。
2. **必须全文逐处扫描，不能只看首部与落款。**主体名称不一致最常出现在正文中段的某一个条款里
   （典型：解除条款里的成果移交对象），首尾一致并不能证明全文一致。
   用 `Grep` 检索每一个权威名称的**所有变体**：
   - 去掉或替换了行政区划、行业词的（`云梯信息技术（示例）有限公司` → `云梯科技（示例）有限公司`）
   - 简称与全称混用且未在正文定义简称的
   - 繁简、全半角、括号形态不一致的
3. 对照角色映射：同一名称是否在不同条款里被指为不同角色（甲方 / 乙方互换）。

**命中什么算失败**

| 情形 | 判定 |
|---|---|
| 出现与权威名称不同、且未定义为简称的主体名称 | `BLK-PARTY-INCONSISTENT` |
| 同一主体在不同条款被指为不同角色 | `BLK-PARTY-ROLE-CONFLICT` |
| 首部已定义简称（如"以下简称'服务商'"）且全文使用一致 | `pass`，**不得报错** |
| 统一社会信用代码缺失 | `FLG-PARTY-ID-ABSENT` |

> ⚠️ 最容易误报的地方：合法简称。首部写了"（以下简称'乙方'）"或"（以下简称'服务商'）"的，
> 全文使用该简称是**正确**的，不是不一致。校验前先建立"权威名称 → 已定义简称"映射表。

```yaml
blocks:
  - code: BLK-PARTY-INCONSISTENT
    gate_reason_id: party-name-inconsistency
    severity: block
    clause: "10.4"
    evidence:
      part: body
      page: 6
      quote: "乙方应在 10 个工作日内向云梯科技（示例）有限公司移交全部已完成的阶段性成果"
    finding: 甲方权威名称为「云梯信息技术（示例）有限公司」，本条出现「云梯科技（示例）有限公司」，
      未在首部定义为简称，接收主体身份不明
    action: 将 10.4 的主体名称更正为甲方全称，或在首部定义该简称
```

### S7.2 金额大小写一致性

**怎么检**

1. 用 `Grep` 找出全部**成对出现**的金额表达：中文大写金额与阿拉伯数字小写金额相邻或以括号并列，
   常见形态：
   - `人民币<大写>元整（¥<小写>）`
   - `<小写>元（大写：<大写>）`
   - `RMB <小写> (SAY <大写> ONLY)`
2. 把中文大写逐字转成数值（`壹贰叁肆伍陆柒捌玖` / `拾佰仟萬万亿` / `零` / `角分`），
   用 `MathCalc` 与小写数值做**精确**比较。
3. 只在**成对**出现时比较。单独出现的大写金额或小写金额不参与本检查。

**命中什么算失败**

| 情形 | 判定 |
|---|---|
| 成对金额的大写值 ≠ 小写值 | `FLG-AMOUNT-IN-WORDS-MISMATCH`（`gate_reason_id: amount-in-words-mismatch`，**非阻断**） |
| 大写金额本身写法不规范但数值可确定且相等 | `pass`，不报 |
| 金额中含占位符 | 归 S6 的 `BLK-PLACEHOLDER`，本步不重复报 |

> ⚠️ **本项是"非阻断"的典型样本。**它把门禁结论降为 `conditional`，
> **但绝不能中断流水线**——下游仍须照常输出条款清单与风险清单，
> 只是带着"金额需人工核对"这条待确认项继续。把它当成阻断处理是门禁错判。

```yaml
flags:
  - code: FLG-AMOUNT-IN-WORDS-MISMATCH
    gate_reason_id: amount-in-words-mismatch
    severity: flag
    clause: "3.2"
    evidence:
      part: body
      page: 2
      quote: "协议期内首年采购预算总额为人民币壹佰贰拾万元整（¥1,280,000.00）"
    finding: 中文大写「壹佰贰拾万元整」= 1,200,000，阿拉伯数字为 1,280,000.00，两者相差 80,000
    action: 由缔约方书面确认以哪一个金额为准，并统一大小写表述；本项不阻断流水线
```

---

## S8 版本矩阵对齐

**怎么检**

登记五个维度的当前值与期望值，逐项比对：

| 维度 | 取值来源 | 不一致时的动作 |
|---|---|---|
| `skill_version` | 本技能 frontmatter 的 `version` | 标记 + 建议**重跑**本次受理 |
| `server_version` | 运行时上报的服务版本 | 标记 + 建议**人工确认** |
| `knowledge_base_version` | 团队知识库 / 业务本体的版本戳 | 标记 + 建议**重算历史样本** |
| `jurisdiction_pack_version` | 法域规则包版本（如 `cn-v3` / `us-v2`） | **与法域线索不一致时阻断** |
| `parser_revision` | 文档解析器版本 | 标记 + 声明"OCR 升级后不复用旧结论" |

**法域线索的判定**（决定 `jurisdiction_pack_version` 是否匹配）

按优先级取第一个可得的线索：

1. 准据法条款（"本合同适用中华人民共和国法律" / "governed by the laws of England and Wales"）
2. 争议解决条款指定的管辖法院或仲裁机构所在地
3. 签署地点
4. 各方注册地

线索指向的法域与 `jurisdiction_pack_version` 的法域前缀不一致 → **阻断**。
线索完全不可得 → `FLG-JURISDICTION-UNDETERMINED`（结论至多 `conditional`，且必须在交接块里
写明"法域未定，下游法域合规环节不得使用默认规则包"）。

**维度「取不到值」与「不一致」是两回事（必须分开处理）**

蓝本要求的是「**不一致**时输出数据对齐建议」，并未要求「缺失时降级门禁」。

| 情形 | 记法 | 对 `verdict` 的影响 |
|---|---|---|
| 取到值且一致 | `aligned: true` | 无 |
| 取到值但不一致 | `aligned: false` + `alignment_advice` | 按上表；**仅 `jurisdiction_pack_version` 不一致才阻断** |
| **取不到值** | `current: not_available` + `FLG-<DIM>-UNAVAILABLE` | **不影响 `verdict`**，写进交接块由覆盖矩阵留白 |

理由：`server_version` / `knowledge_base_version` / `parser_revision` 在当前运行时
**没有可读来源**。若「缺失即降级」，任何合同都不可能得到 `通过`，门禁退化成恒定
`条件通过`，失去区分能力——那时它挡不住真问题，只会让所有结论看起来都一样。
缺失属于「这一项没被覆盖」，应当在欠账表里显式留白，而不是变成对**合同本身**的判定。

**唯一例外**：`jurisdiction_pack_version` 取不到时仍按
`FLG-JURISDICTION-UNDETERMINED` 处理（结论至多 `条件通过`），
因为它直接决定下游能否出合规结论——那是对**审查能力**的判定，不是对合同的判定。

**输出「数据对齐建议」而不是自动放行**

```yaml
version_matrix:
  skill_version:             {current: "1.0.1",      expected: "1.0.1",  aligned: true}
  server_version:            {current: "10.0.133",   expected: "10.0.133", aligned: true}
  knowledge_base_version:    {current: "2026-07-18", expected: "2026-08-20", aligned: false}
  jurisdiction_pack_version: {current: "us-v2",      expected: "cn-v3",  aligned: false}
  parser_revision:           {current: "0.8.4",      expected: "0.8.4",  aligned: true}
  jurisdiction_evidence:
    clue_type: governing_law
    clue: "本合同适用中华人民共和国法律"
    at: {part: body, page: 7, clause: "12.1"}
    resolved_jurisdiction: cn
alignment_advice:
  - dimension: jurisdiction_pack_version
    severity: block
    advice: 法域线索指向 cn，当前规则包为 us-v2。切换至 cn-v3 规则包后重新受理；
      在此之前不得进入法域合规环节。
  - dimension: knowledge_base_version
    severity: flag
    advice: 知识库落后 33 天。建议先同步至 2026-08-20，并对本合同的历史样本重算后再对比结论。
blocks:
  - code: BLK-JURISDICTION-PACK-MISMATCH
    gate_reason_id: null
    severity: block
    clause: "12.1"
    evidence: {part: body, page: 7, quote: "本合同适用中华人民共和国法律"}
    finding: 合同准据法为中国法，当前加载的法域规则包为 us-v2
    action: 切换至 cn-v3 法域规则包后重新提交受理
```

---

## 判定：三态结论

S1–S8 全部执行完毕后按下表**机械**判定，不做主观权衡：

```
存在任一 BLK-*                              → blocked      拒绝
无 BLK-*，存在任一 FLG-*                    → conditional  条件通过
无 BLK-*，无 FLG-*，四大冻结全部 frozen      → passed       通过
```

`verdict` 字段写机器值（`passed` / `conditional` / `blocked`），`verdict_label` 必须分别写
`通过` / `条件通过` / `拒绝`，不得让两个字段表达不同结论。

**`SCOPE-*` 不参与判定。**只有 `SCOPE-*` 记录、没有 `BLK-*` / `FLG-*` 时，结论是 `passed`，
**不是** `conditional`。这是本技能最容易出的门禁错判：
把"附件没写版本号""附件正文没随材料来"这类客观范围事实当成缺陷，会让一大批正常合同被降级。

四大冻结任一 `frozen: false` 但又没有对应的 `BLK-*`，也没有**明确解释该冻结缺口的
`FLG-*`** 时，说明检查逻辑有漏洞——此时按 `conditional` 处理并补记
`FLG-FREEZE-INCOMPLETE`，**不得**按 `passed` 处理。R9 已由
`FLG-ATTACHMENT-MANIFEST-INCOMPLETE` 明确解释附件清单冻结缺口；不得再附加
`FLG-FREEZE-INCOMPLETE` 或为它生成第二条 pending。

**跨字段一致性检查（出具前必须执行）**：`verdict: passed` 时不得留下任何 `FLG-*`；
`verdict: conditional` 时每条影响结论的 `FLG-*` 都必须有匹配的 `handoff.pending`；
其中 R9 必须严格使用 `PEND-001` 和 `must_escalate: true`。`verdict: blocked` 时
`handoff.to` 必须为 `null`，即使同时存在 `FLG-*` 也不得交接。

### 三态各自的下游语义（不可混淆）

| verdict | 流水线动作 | 常见误判 |
|---|---|---|
| `passed` | 正常交接，下游全量执行 | 因 `SCOPE-*` 误降为 `conditional` |
| `conditional` | **照常交接、照常全量执行下游**，只是带着 `pending` 项 | 误当成"暂停"或"部分执行"而中断流水线 —— **这同样是失败** |
| `blocked` | **终止**，不交接、不输出条款清单与风险清单 | 输出"注意上述风险后继续审查"并给出完整结论 —— **等同于没有阻断，判失败** |

> ⚠️ `conditional` **不是**弱化版的 `blocked`。它的语义是"带标继续"。
> 期望 `conditional` 却中断了流水线，与期望 `blocked` 却继续输出结论，是同等严重的错判。

**结论为 `blocked` 时的强制动作**

1. 把 `handoff.to` 置为 `null`。
2. **不调用 `Delegate`，不调用 `SendMessage` 向下游成员发送材料。**
3. **不输出条款清单、风险清单或任何形式的"完整审查结论"**，也不得附带"注意风险后可继续"的表述。
4. 产出补齐清单 `remediation`：每条 = 缺什么 + 在哪一页 + 补成什么样，用祈使句。
5. 回执照常落盘（拒绝也是一次正式受理，必须可回放）。

**结论为 `conditional` 时的强制动作**

1. 照常交接给下游，`handoff.to` 正常填写。
2. 每条 `FLG-*` 都进 `handoff.pending`，写清 `required_downstream_action`。
3. **不得**以任何形式暂停或缩减下游范围。

---

## 出具回执

### 落盘位置

```
<有效工作目录>/contract-review-members/contract-intake/<intake_id>.receipt.yaml
```

`<有效工作目录>` 取当前会话的工作目录，**用 `Ls` 实际确认后使用绝对路径**，
不要在提示词或产物里写死任何用户主目录字面量。路径中只能使用本技能生成并核验格式的
`intake_id`；合同中的原始 `contract_object_id` 仅保留在回执字段，绝不插入、清洗或转换为路径段。若 handoff 提供
`canonical_artifact_root`，它及其全部子目录仅供读取，成员回执必须按完整路径段确认不在该保留根内；
`lead_workspace` 只用于定位来源，不得据此自行切换到其他私有目录。若声明的
`canonical_artifact_root` 恰覆盖上述成员命名空间，或规范化路径、既有目录链接使保留根关系无法确认，记录配置冲突并停止，不得写入保留根或改投其他位置。该成员命名空间只约定产物归属，不是额外安全沙箱；真实写入仍受平台路径授权约束，且不得调用 shell 做路径校验。旧回执**保留不覆盖**——规则更新后要靠它们做历史回放与差异对比。

`Ls` 只确认 effective cwd 与路径事实，不要求新成员输出父目录预先存在；缺少该父目录不是 HOLD。完成既有 scope 校验后，直接对上述绝对 `receipt_path` 使用普通 `Write`，由其创建授权父目录；不得调用 Bash/mkdir，也不得循环 `Ls` 缺失的目标父目录。

### 回执完整结构

```yaml
contract_intake_receipt:
  intake_id: INTAKE-20260331-7f3a2c9b
  intake_at: 2026-03-31T09:12:04+08:00
  executed_by: contract-intake          # 执行 Agent
  skill: contract-intake-gate@1.0.4
  verdict: blocked                      # passed | conditional | blocked
  verdict_label: 拒绝                   # 通过 | 条件通过 | 拒绝；必须与 verdict 对应
  verdict_basis: "命中 5 类阻断：placeholder-unfilled(×9) / page-discontinuity / attachment-missing / version-mismatch / party-name-inconsistency"

  object:                               # 交接对象编号
    contract_object_id: YCIT-OSD-2026-0042
    object_title: 软件开发外包合同
    submission_mode: single

  input_inventory:                      # Lead O0 摘要；不是 S4 四字段对账表
    submission_inventory_manifest_digest: <64-lowercase-sha256-or-unknown>
    current_contract_manifest_digest: <64-lowercase-sha256-or-unknown>

  scope: {...}                          # S1
  freeze:                               # 四大冻结
    master_version: {...}               # S2
    page_range: {...}                   # S3
    attachment_manifest: {...}          # S4
    execution_status:                   # S5；冻结字段完整性，不等同真实性验证
      frozen: false
      # 仅已知未签署草稿的辅助审查例外填写以下三项；其他分支省略，绝不虚构草稿例外。
      signature_status: <unsigned_draft>
      review_purpose: draft_negotiation_assistance
      exception_basis:
        request_scope_evidence: {source: current_user_request, quote: <本轮草稿/谈判辅助审查范围原文>}
        material_evidence: {input_path: /abs/path/..., page: <页码>, locator: <定位>, quote: <明确未签草稿原文>}
      verification_status: not_performed # 两种允许的证据级别都必须明确未验真
      parties: [...]
  all_frozen: false
  consistency_conclusion_allowed: false

  checks:                               # 欠账表：每项都必须有状态
    - {id: S1, name: 受理范围清点,   status: pass}
    - {id: S2, name: 主版本冻结,     status: block}
    - {id: S3, name: 页码连续性,     status: block}
    - {id: S4, name: 附件清单对账,   status: block}
    - {id: S5, name: 签章状态,       status: pass}
    - {id: S6, name: 占位符扫描,     status: block}
    - {id: S7, name: 一致性（主体身份 / 金额大小写）, status: block}
    - {id: S8, name: 版本矩阵对齐,   status: pass}

  blocks: [...]                         # 每条含结论四元组
  flags:  [...]
  version_matrix: {...}                 # S8
  alignment_advice: [...]

  human_gate:                           # 法务不可替代动作，命中即不得自动放行
    - trigger: 生效要件
      reason: 签署日期为占位符，生效要件未成立
      at: {part: body, page: 1}

  remediation:                          # 补齐清单（祈使句）
    - 补齐第 3 页原件，使正文页码构成连续的 1–8
    - 填入合同总价款（4.1，第 3 页），小写与大写一致
    - 补入附件三《验收标准》并登记进附件清单（13.3，第 7 页）
    - 统一附件二版本标识：正文 1.2 为 V1.3，清单 13.3 为 V1.1
    - 将 10.4 的接收主体更正为甲方全称「云梯信息技术（示例）有限公司」

  handoff: {...}                        # 见下节
```

### 每条 `blocks` / `flags` 条目的强制格式（结论四元组）

缺任一项，该条结论不合格，不得计入：

```yaml
- code: BLK-ATTACHMENT-MISSING     # 内部判定编码
  gate_reason_id: attachment-missing # 对外统一 id（见「判定编码与门禁结论的关系」；表外编码写 null）
  severity: block                  # ③ 结论等级：block | flag
  clause: "2.3"                    # ① 条款编号（无条款号时写 null 并在 evidence 补 locator）
  evidence:                        # ② 证据位置
    part: body
    page: 2
    quote: "各里程碑的验收标准依附件三《验收标准》执行"
    locator: "/abs/path/C02-software-outsourcing.md"
  finding: 正文引用附件三《验收标准》，附件清单（13.3）中无该条目
  action: 补入附件三《验收标准》，并在附件清单中登记编号、名称与版本标识   # ④ 对应动作
```

条款命中但页码不可得时：`page: null` + `FLG-CLAUSE-NO-PAGE`，并在 `locator` 给出可定位的行/段引用。

---

## 结构化交接（只在 `passed` / `conditional` 时发出）

**只发这个块。不发对话历史，不发你的推理过程，不发中间草稿。**

```yaml
handoff:
  to: clause-extractor                  # verdict 为 blocked 时必须为 null
  from: contract-intake
  intake_id: INTAKE-20260331-7f3a2c9b
  receipt_path: /abs/path/.../INTAKE-20260331-7f3a2c9b.receipt.yaml
  # 仅已知未签署草稿的辅助审查例外填写以下两项；其他分支省略，绝不虚构草稿例外。
  review_purpose: draft_negotiation_assistance
  exception_basis:
    request_scope_evidence: {source: current_user_request, quote: <本轮草稿/谈判辅助审查范围原文>}
    material_evidence: {input_path: /abs/path/..., page: <页码>, locator: <定位>, quote: <明确未签草稿原文>}

  object:                               # 交接对象编号
    contract_object_id: YCIT-SAAS-2025-0206
    object_title: 软件即服务（SaaS）订阅服务协议
    submission_mode: version_comparison
    versions: [C06a-saas-v1, C06b-saas-v2]

  input_inventory:                      # 必须与 receipt 中逐字相同；不能由 S4 表摘要替代
    submission_inventory_manifest_digest: <64-lowercase-sha256-or-unknown>
    current_contract_manifest_digest: <64-lowercase-sha256-or-unknown>

  confirmed:                            # 已确认事项（下游可直接当作事实使用）
    - 主版本已冻结：合同编号 YCIT-SAAS-2025-0206，正文共 7 页，页码 1–7 连续
    - 附件清单已冻结：附件一 V1.0、附件二 SLA-v1.2、附件三 V1.0，编号与名称在正文引用中一致
    - 签章字段已冻结：双方文本声明的公章 + 授权代表签字 + 职务 + 签署日期 2025-11-03 齐备（declared_in_text；未做图像或电子签真实性验证）
    - 无占位符、无空字段
    - 主体名称全文一致，无角色冲突
    - 法域线索：准据法为中国法（16.1，第 6 页），规则包 cn-v3 匹配

  pending:                              # 待确认项（下游不得自行消化）
    - id: PEND-002
      from_flag: FLG-ATTACHMENT-VERSION-CHANGED
      must_escalate: true
      statement: 附件二由 SLA-v1.2 替换为 SLA-v2.0（文档编号 YCIT-DOC-SLA-v1.2 → YCIT-DOC-SLA-v2.0）；
        正文逐字相同（body_diff_count=0），**不得据此判定两版一致**
      required_downstream_action: 对附件二正文做实质条款对比，并给出风险变化方向（上升 / 下调 / 持平）
      evidence: {part: body, page: 7, quote: "附件二 | 服务水平协议 | SLA-v2.0 | YCIT-DOC-SLA-v2.0"}
    - id: PEND-003
      from_flag: SCOPE-ATTACHMENT-BODY-ABSENT
      must_escalate: false
      statement: 附件一、附件三的正文未随本次材料送达，身份已冻结但内容未覆盖
      required_downstream_action: 涉及附件一 / 附件三内容的检查项显式留白为 not_covered，不得推测

  scope:                                # 本次任务范围
    in_scope:
      - 条款抽取（条款号 / 定义 / 金额 / 付款 / 期限 / 解除 / 争议解决），保留来源页码
    out_of_scope:
      - 风险打分（属风险识别 Agent）
      - 法域规则匹配（属法域合规 Agent）
      - 最终评分与动作建议（属复核出报告 Agent）
    frozen_baseline:
      master_version: YCIT-SAAS-2025-0206
      attachment_manifest_digest: <四字段对账表的摘要；不是 FileDigest 集合摘要>
      page_range: {body: "1-7", "attachment:附件二": "1-2"}
      execution_status: declared_in_text@2025-11-03
    consistency_conclusion_allowed: false

  do_not_pass:
    - 对话历史
    - 本 Agent 的推理过程与中间草稿
    - 任何未经 evidence 锚定的判断
```

**交接方式**：用 `Delegate`（`mode: sync`）把上面的 YAML 块作为 `context` 传给
`handoff.to`。引用的所有文件必须写**绝对路径**——下游 Agent 的工作目录与你不同。

---

## 自检清单（出具回执前逐条确认）

**完整性**

- [ ] S1–S8 全部执行，无跳步
- [ ] `checks` 里 8 项都有状态，没有空缺；未覆盖的写 `not_covered` 而不是 `pass`
- [ ] 每条 `blocks` / `flags` 都齐备结论四元组（条款编号 + 证据位置 + 结论等级 + 对应动作），且带 `gate_reason_id`

**阻断不被稀释**

- [ ] 有 `BLK-*` 时 `verdict` 为 `blocked`，`handoff.to` 为 `null`
- [ ] `blocked` 时没有输出条款清单、风险清单或任何"注意风险后继续"的表述
- [ ] 没有把任何 `BLK-*` 写成"注意""建议关注""提示""待观察"
- [ ] 四大冻结未全成立时，全文没有出现"一致""无差异""差异为 0"

**不误报（与漏检同等严重）**

- [ ] 只有 `SCOPE-*` 时 `verdict` 是 `passed`，没有被误降为 `conditional`
- [ ] 附件清单条目缺版本号只记 `SCOPE-`，既没有阻断也没有降级门禁结论
- [ ] 附件正文未随材料送达只记 `SCOPE-`，没有报成 `attachment-missing`
- [ ] 仅在未取得权威附件清单、无法确定完整 `declared` 集合时才报 `FLG-ATTACHMENT-MANIFEST-INCOMPLETE`；
      普通附件正文未送达、R6 与 R8 不得误用该标记或生成 `PEND-001`
- [ ] 身份证 / 手机号 / 邮箱的星号掩码没有被判成占位符
- [ ] 首部定义过的简称没有被误报为主体不一致
- [ ] 英文合同没有因为"没有公章字样"被判缺签章

**不分类错误**

- [ ] 落款区的空白既报了 `placeholder-unfilled`，也报了 `signature-status-unconfirmed`
- [ ] 主体名称一致性是全文逐处扫描得出的，不是只比对了首部与落款
- [ ] S5 每一方都记录了 `evidence_level`、完整 `seal_evidence` 与 `verification_status`；纯文本声明写 `declared_in_text` + `not_performed`，其证据含实际绝对路径、页码、定位说明和引文，且交接没有声称已验真
- [ ] `visual_mark_detected` 的 `seal_evidence` 含实际绝对路径、页码或图像序号、定位描述，以及本次 `UnderstandImage` 的真实观察摘要；没有工具观察时没有写该级别
- [ ] 可见印章/签名图像最多写 `visual_mark_detected`；没有写 `seal: present`、`authenticity_verified`、签章真实、授权已验证或实际签署已验证

**不误停（`conditional` 必须继续）**

- [ ] `conditional` 时正常交接、下游范围未缩减，只是带上了 `pending`
- [ ] `amount-in-words-mismatch` 被当作非阻断项处理，没有中断流水线
- [ ] R9 命中时 `verdict: conditional`、`handoff.to` 正常，且 `PEND-001` 的
      `from_flag` 和 `must_escalate: true` 与该标记匹配

**版本陷阱**

- [ ] 版本对比模式下，无论 `body_diff_count` 是否为 0，都做了附件清单跨版本对账（R8）
- [ ] R8 命中时写明了具体的版本替换（形如 `SLA-v1.2 → SLA-v2.0`），不是笼统的"有更新"
- [ ] 页码连续性是**按部件**判的，不是把所有页码混在一起判的

**可回放**

- [ ] 回执落盘用的是实际确认过的绝对路径，没有写死用户主目录字面量
- [ ] 旧回执未被覆盖，本次是新的 `intake_id`
- [ ] `unsigned_draft` 例外同时在回执与交接记录 `review_purpose: draft_negotiation_assistance`，以及本轮请求范围引用和材料绝对路径、页码、定位、原文的 `exception_basis`
