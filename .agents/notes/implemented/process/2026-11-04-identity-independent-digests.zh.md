# Agent Note: 为封印记录提供与身份无关的内容寻址

Status: implemented

[English](2026-11-04-identity-independent-digests.md) | 中文

## 问题

若干门禁判断记录是否可信的办法，是从内容重新推导哈希：持久化 schema 的摘要与节点键、冻结 Agent Note 归档清单、其双语一致性记录里的 blob 哈希，以及锁定已接受持久化确认记录的定稿检查点。这些哈希材料都把项目身份带了两遍：一遍是版本化的哈希域前缀，一遍是内容里的身份词素（例如会话标题 LLM 请求的持久化事件字面量、以及归档正文里写出的包名与环境变量名）。因此项目改名一次性让所有记录摘要失效。持久化类型本身没有变化，变的只是它们的写法。四条 `doc-sync` 门禁同时变红——`verify-persistence-changes`、`verify-persistence-releases`、`verify-persistence-formats`、`verify-archived-agent-notes`——对没人想动的记录报出 `key does not match its subgraph digest`、`schema digest mismatch`、`sealed content hash changed`。

显而易见的修补都比缺陷本身更糟。重新计算冻结语料的哈希，恰好会毁掉封印存在的意义，而 `docs/persistence-changes/**` 与 `.agents/notes/archived/**` 是任何后续改动都不得改写的冻结历史。提升格式版本号则是在宣称一次从未发生的持久化格式变更。跳过门禁或把当前失败的路径加进白名单，会让它们在下一次真正的变更上不再生效——而封印正是为了抓住那种变更。

## 决策

每一条封印记录的内容寻址都与身份无关。唯一一份封闭词表——[`scripts/identity-vocabulary.ts`](../../../../scripts/identity-vocabulary.ts)——列出每个身份词素的当前写法与封印里已有的写法，`restoreSealedIdentity` 把一份产物改写回它的封印写法。记录的写法以十六进制编码保存，因此退役的项目名不会重新出现在源码里；映射是幂等的：封印内容原样通过。

凡是要与记录中的哈希比对的地方，都先还原封印写法：

- [`schemaDigest`](../../../../scripts/persistence-schema-model.ts) 在还原身份写法之后对版本化哈希域和规范图求哈希，因此一份 schema 的指纹能跨改名存活，并继续等于 `docs/persistence-changes/**`、`historical-formats/v*.schema.json` 与 `releases/*.schema.json` 中记录的摘要。
- 规范节点编号同样由还原后的签名推导，因为指纹靠节点在最小化图中的位置来命名节点；缺了这一步，一个字面量改名就会让本来同构的图重新排序，并改变每一层祖先的摘要。
- 归档清单封印、双语一致性记录的 Git blob 哈希、定稿检查点里的记录摘要都按还原后的内容比对，因此冻结语料能按已提交的字节通过校验。

新记录由同一批函数写入。身份词表保持封闭：新增一条写法是一次需要评审的门禁改动，而不是改个包名的自动后果。

## 指纹仍然区分的差异

任何不是身份词素的差异都会改变摘要：属性的存在与可选性、联合成员、字面量、元组元数、索引签名、源码兼容策略，以及规范结构。[`persistence-schema-model.spec.ts`](../../../../scripts/persistence-schema-model.spec.ts) 钉住已提交历史记录的原始类型指纹，证明同一结构在持久化字面量的两种写法下指纹相同，并证明一个超出身份词素的字面量差异仍会改变它。[`archived-agent-notes.spec.ts`](../../../../scripts/archived-agent-notes.spec.ts) 证明改名后的三元组仍然满足按封印文本记录的封印，而在同一文件里多加一句话会报出 `sealed content hash changed`。

## 备选方案

**同时按当前域与前任域校验历史。** 这是最初的尝试：记录摘要只要匹配任一域前缀就接受。它无法校验整个语料。已有八份提交过的 schema 快照在内容层面也带着改过名的字面量（持久化事件载荷里的 `dsh-session-title-llm` 变成了 `huoli-session-title-llm`），因此它们的节点键在两种域前缀下都与内容不一致；而且域前缀本身就是身份词素，不是一个独立的开关。双域校验还得再给内容这一半补一套未写入文档的机制。

**重新封印冻结语料。** 重新生成 `manifest.json`、一致性记录与 schema 快照，一个提交就能让四条门禁全绿。它同时抹掉了「归档后没有任何笔记被改动」这条只增不改的证据，并改写了评审引用的历史。[Agent Note 规则](../../README.zh.md)明令禁止，持久化历史受到同样的冻结。

**声明新的格式版本。** 版本提升能让新的域前缀摘要与旧的共存且双方都不必改写，但记录下来的这次迁移会宣称一次从未发生的持久化格式变更，而且此后每个读者都得查一张改名表，才能解释同一套类型词汇的两个版本。

**带明确理由跳过受影响的产物。** 如果没有忠实的比对办法，把 `verify-archived-agent-notes` 降级为可跳过门禁是兜底方案。它会让 2,778 份冻结产物——全部归档 Agent Note——在归档重新封印之前失去防篡改证据，因此在还原写法比对复现全部产物之后被否决。

## 影响

改名不再让记录摘要、封印、一致性记录哈希与定稿检查点失效：四条门禁按已提交的语料全部通过，`verify-archived-agent-notes` 重新校验全部 2,778 份冻结产物。评审仍然能发现对归档笔记的内容改动或持久化类型变更，因为被规范化掉的只有身份词素。

代价是只在身份写法上不同的两个持久化字面量会得到相同指纹。这正是想要的读法——产品改名不是持久化格式变更——但这也意味着词表是做出该判断的唯一位置，因此往词表里加一条，需要像放宽任何门禁那样接受评审。

冻结历史一个字都没有被改写：`docs/persistence-changes/**` 与 `.agents/notes/archived/**` 与已提交版本逐字节相同。当前生成产物由生成器重新生成了一次，因为它们的摘要是当前状态的投影而不是记录：`docs/persistence-schema.json`、`docs/persistence-catalog.md`、`docs/persistence-catalog.zh.md` 及其一致性记录。验证跑了 `verify-persistence-changes`、`verify-persistence-releases`、`verify-persistence-formats`、`verify-archived-agent-notes` 以及 `scripts` 下的单元测试。
