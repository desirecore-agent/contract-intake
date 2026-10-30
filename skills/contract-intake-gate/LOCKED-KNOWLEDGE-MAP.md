# 锁定知识逐项映射（7c3f436）

下表中的“当前资源”均是成员启动时会读取的 SKILL/persona/principles 或真实 schema/tests，不是旁路归档。

| 锁定规则 | 当前实质资源 | 反例/纠正动作 | 测试 |
|---|---|---|---|
| R2 主版本冻结 | SKILL「第二步」+ freeze.main_version | 多主版本/无权威版本→阻断并索取指定版本 | locked-knowledge + schema freeze mutation |
| R3 页码连续性 | SKILL「第三步」+ freeze.pagination | 断页、重复、页码总数矛盾→阻断；无版式则保留 locator | locked-knowledge + schema freeze mutation |
| R4 附件四字段 | SKILL「第四步」+ freeze.attachment_manifest | 名称/编号/版本/交付状态逐项对账 | locked-knowledge |
| R5 签章状态 | SKILL「第五步」+ freeze.execution_status | 文本/图像/真实性分离，缺字段按对象目的处理 | receipt-contract |
| R6 占位符 | SKILL「第六步」完整白名单/误报排除 | 脱敏证件、手机、邮箱，未选模板分支和示例不得误报 | locked-knowledge |
| R7 主体一致性 | SKILL「第七步」+ party_assessments | 全称/已定义简称映射后全文扫描；required/not_applicable/unknown 分开 | consistency-contract |
| R8 五维版本矩阵 | SKILL「第八步」原表 | 主版本/附件/页码/签章/主体每维有独立纠正动作 | locked-knowledge |
| 内嵌附件正文 | SKILL 附件识别规则 | 标题式内嵌正文计 delivered，不误判缺件 | locked-knowledge |
| 补料处理 | SKILL 补料后重跑 | 任何补料触发 R1–R8 全量重跑；旧 receipt 不覆盖 | locked-knowledge |
| 稳定原因码 | SKILL 输出映射 | BLK/FLG/SCOPE 均保留 gate_reason_id | receipt fixtures + locked-knowledge |
