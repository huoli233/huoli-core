# 生命状态规范

本规范定义生命状态的唯一事实来源、一条心跳与三处出口，是 [qq-vitals](../qq-vitals/README.md) 的验收依据：状态文件里的那份字段是唯一事实，算出来的量只在一处算、算完写回，提示词、回复条数、主动性、面板都只读它，任何一方不得另算一套公式；心跳按 `beatMs` 结算并原子落盘；三处出口必须全部接上，缺一处这套身体就只是动画。

本规范里的每个数值都是一个 Config 字段：字段名 + 默认值 + 可被 `Config.tuning` 逐项覆盖，默认值只允许在 `DEFAULTS` 出现一次，别处只许读 `Tuning`。除 `core_temp` 用摄氏度外，生理字段取值 `0~1` 并在写回前 clamp；时间戳统一为 Unix 毫秒，与 `*Ms` 型参数同单位。状态文件内容为 `{"version": 1, "state": {...}}`，位置由 `Config.file` 指定，缺省为数据根目录下的 `data/qq-vitals.json`。

## 状态字段

字段默认值取自 `DEFAULTS.baseline`，可用 `Config.tuning.baseline.<字段名>` 覆盖；“状态”列指本仓当前实现里该字段是否存在。算出来的量、标签与时间戳不属于 `baseline`，各自有独立的初值规则。

### 五个基础递质

| 字段 | 含义 | 默认值 | 状态 |
|---|---|---|---|
| `dopamine` | 想要、兴奋、被夸 | 0.50 | 已实现 |
| `oxytocin` | 亲近、黏人、被安抚 | 0.45 | 已实现 |
| `cortisol` | 压力、小脾气 | 0.20 | 已实现 |
| `serotonin` | 情绪稳定、满足 | 0.65 | 已实现 |
| `noradrenaline` | 精力、警觉 | 0.45 | 已实现 |

### 神经-体液轴

| 字段 | 含义 | 默认值 | 状态 |
|---|---|---|---|
| `crh` | 促肾上腺皮质激素释放激素 | 0.15 | 已实现 |
| `acth` | 促肾上腺皮质激素 | 0.15 | 已实现 |
| `adrenaline` | 肾上腺素（急性） | 0.05 | 已实现 |
| `acetylcholine` | 乙酰胆碱（副交感） | 0.45 | 已实现 |
| `endorphin` | 内啡肽（满足、镇痛） | 0.45 | 已实现 |
| `vasopressin` | 加压素（占有，兼抗利尿） | 0.30 | 已实现 |
| `melatonin` | 褪黑素（昼夜） | 0.0 | 已实现 |

### 代谢与体液

| 字段 | 含义 | 默认值 | 状态 |
|---|---|---|---|
| `ghrelin` | 胃饥饿素 | 0.30 | 已实现 |
| `leptin` | 瘦素（饱腹） | 0.55 | 已实现 |
| `glucose` | 血糖（缩到零到一） | 0.65 | 已实现 |
| `insulin` | 胰岛素 | 0.12 | 已实现 |
| `glucagon` | 胰高血糖素 | 0.10 | 已实现 |
| `hunger` | 饥饿（体感） | 0.35 | 已实现 |
| `thirst` | 口渴（体感） | 0.25 | 已实现 |
| `osmolality` | 血浆渗透压 | 0.35 | 已实现 |
| `blood_volume` | 血容量 | 0.85 | 已实现 |
| `angiotensin` | 血管紧张素 | 0.10 | 已实现 |
| `fluid_queue` | 待排尿的水队列 | 0.0 | 已实现 |

### 内环境

| 字段 | 含义 | 默认值 | 状态 |
|---|---|---|---|
| `adenosine` | 睡眠压力（腺苷） | 0.20 | 已实现 |
| `core_temp` | 体温（摄氏度） | 36.6 | 已实现 |
| `fever` | 发烧程度 | 0.0 | 已实现 |
| `cytokines` | 免疫反应 | 0.0 | 已实现 |
| `pain` | 疼痛 | 0.0 | 已实现 |

### 情绪状态机

| 字段 | 含义 | 默认值 | 状态 |
|---|---|---|---|
| `anger` | 急性愤怒 | 0.0 | 已实现 |
| `resentment` | 记仇 | 0.0 | 已实现 |
| `soothe` | 被哄程度 | 0.0 | 已实现 |
| `fear` | 急性惊吓 | 0.0 | 已实现 |
| `worry` | 担心对方 | 0.0 | 已实现 |
| `dread` | 存在性恐惧 | 0.0 | 已实现 |
| `mortality` | 死亡威胁 | 0.0 | 已实现 |
| `negative_heat` | 负面热度（衰减用） | 0.0 | 已实现 |
| `positive_heat` | 正面热度（衰减用） | 0.0 | 已实现 |

九个字段都在 `types.ts`，写回在 `react.ts`，回落与耦合在 `drift.ts` / `derive.ts`；情绪薄层（混合层）另在 `emotion.ts`。

### 周期与睡眠

| 字段 | 含义 | 默认值 | 状态 |
|---|---|---|---|
| `cycle_dom` | 每月开经日 | 5 | 已实现 |
| `cycle_day` | 当前周期第几天 | 0 | 已实现 |
| `cycle_len` | 本月周期长度（28~31） | 0 | 已实现 |
| `cycle_phase` | 经期、卵泡期、排卵期、黄体期、经前期 | 空串 | 已实现 |
| `estrogen` | 雌激素 | 0.35 | 已实现 |
| `progesterone` | 孕激素 | 0.20 | 已实现 |
| `cramps` | 痛经 | 0.0 | 已实现 |
| `asleep` | 是否睡着 | 否 | 已实现 |
| `sleep_kind` | 夜睡或午睡 | 空串 | 已实现 |
| `wake_after` | 预计醒来时刻 | 0 | 已实现 |
| `groggy_until` | 迷糊到什么时候 | 0 | 已实现 |

睡眠另有三个字段一起落盘：`sleep_state` 取 `awake`、`sleeping`、`waking` 三态，`asleep` 只是它睡着那一态的影子、读回来按三态重算；`woken_at` 记被消息吵醒的时刻，`nap_at` 记上一次午睡的开始时刻，用来判当天已经睡过。

### 算出来的量与标签

`energy`、`valence`、`irritability`、`clinginess`、`loneliness`、`dominance` 由 `derive()` 写回，初值 0.5、0.5、0、0、0、0.5；`emotion_level` 初值为“平静”，`emotion_candidates` 初值为空数组；`proactive_bias` 从 `proactiveBiasStart` 1.0 起逐条相乘、夹到 `biasMin` 与 `biasMax` 之间再由 `biasUnit` 折成 0~1 的读数，`post_want` 从 `postStart` 0.3 起相乘后夹到 0~1，两者都落进状态文件的 `DERIVED_FIELDS`，已实现。

### 时间戳与标记

| 字段 | 含义 | 初值 | 状态 |
|---|---|---|---|
| `last_update` | 上次结算时刻 | 装配时刻 | 已实现 |
| `last_msg` | 上次收到消息时刻 | 装配时刻 | 已实现 |
| `last_meal` | 上次进食时刻 | 装配时刻 | 已实现 |
| `last_drink` | 上次喝水时刻，兼喝水冷却起点 | 0 | 已实现 |
| `last_drink_at` | 上次喝水时刻 | 0 | 已实现 |
| `last_taste_at` | 上次尝到东西的时刻 | 0 | 已实现 |
| `drink_mem_at` | 喝水记忆写回去重窗口 | 0 | 已实现 |
| `fluid_applied_at` | 水队列结算时刻 | 0 | 已实现 |
| `praise_applied_at` | 被夸写回时刻 | 0 | 已实现 |
| `anger_applied_at` | 被凶写回时刻 | 0 | 已实现 |
| `last_drink_name` | 上次喝到的名字 | 空串 | 已实现 |
| `last_taste` | 上次尝到的记录 | 空 | 已实现 |
| `last_user_text` | 上次收到的原文 | 空串 | 已实现 |

## 漂移与反应

### 调用时机

读即结算：任何出口调用 `read()` 或 `render()` 时，先跑 `drift()` 再跑 `derive()`，所以读到的永远是此刻的身体，不需要调用方自己补算。心跳每 `beatMs` 复用同一条链路并落盘一次，落盘是心跳的职责，读路径不写盘。

反应只发生一次：`react()` 在收到一条用户消息时被调用一次，调用后必须把结果写回状态仓，否则同一句话会在两个入口各减一次。接线在组合包里：入站消息先按消息编号去重，只对有正文的消息调一次 `react()`，再交给注意力收件箱；戳一戳与纯位置内容（只有图片或表情）不动身体。

### 步长与上限

| 字段 | 默认值 | 单位 | 判据 |
|---|---|---|---|
| `beatMs` | 60000 | 毫秒 | 心跳间隔 |
| `startDelayMs` | 20000 | 毫秒 | 装配后首拍延迟 |
| `hoursCap` | 24 | 小时 | 单次结算的最大时长 |
| `minDriftHours` | 1/60 | 小时 | 小于此值时只把 `last_update` 前移，不动任何生理量 |
| `metabolicRate` | 1.0 | 倍率 | 水损失系数，先夹到 0.75~1.7 |
| `nightDarkFrom` | 22 | 小时 | 夜色升到全黑的起点 |
| `nightDarkUntil` | 7 | 小时 | 夜色结束的时刻 |
| `timeZone` | 空串 | IANA 时区名 | 算时段与日期用的时区，空串跟随运行环境 |
| `lateNightFrom` | 0.6 | 浓度 | 夜色浓度过这条线算深夜 |
| `lateNightPraiseGain` | 1.5 | 倍率 | 深夜被夸时兴奋那三项的加成 |
| `nightRamp` | 2 | 小时 | 两端斜坡宽度 |
| `melatoninFrom` | 21 | 小时 | 褪黑素开始上升的时刻 |
| `melatoninUntil` | 7 | 小时 | 褪黑素回落到零的时刻 |

结算步长固定为 `hours = clampRange((at - last_update) / 3600000, 0, hoursCap)`；所有“按半衰期靠近”用 `follow(x, target, τ, hours) = x + (target - x) * (1 - 0.5 ** (hours / τ))`，所有“半衰”用 `decay(x, hours, half) = x * 0.5 ** (hours / half)`，所有只取正部的项用 `above(x) = max(0, x)`。

### 结算内容

下表每行是一个子系统的结算规则，规则里的常数即该规则的系数；系数集中在 `Tuning`，默认值等于提取前的字面量。

| 子系统 | 结算规则 | 状态 |
|---|---|---|
| 递质回归 | 向 `0.50 - 0.16 * night`、`0.45 + 0.04 * night`、`0.65 - 0.12 * night`、`naBase - 0.10 * night` 靠近，τ 取 0.45（夜色浓度 ≥ 0.6）或 0.75；皮质醇不在此列 | 已实现 |
| 去甲时段基线 | `0~6` 点 0.22、`6~9` 点 0.45、`9~12` 点 0.72、`12~14` 点 0.55、`14~18` 点 0.70、`18~22` 点 0.60、其余 0.35 | 已实现，字面量 |
| HPA 轴 | `load = clamp(0.55 * cortisol + 0.25 * 低血糖 + 0.20 * 高饥饿)`；`feedback = 1 - 0.70 * clamp((cortisol - 0.55) / 0.45)`；crh τ 0.15、acth τ 0.45、cortisol τ 1.20，目标 `0.15 + 0.80 * acth` 再乘催产素缓冲 `1 - 0.35 * clamp((oxytocin - 0.40) / 0.60)` | 已实现，字面量 |
| 交感与副交感 | `adrenaline` 目标 `0.05 + 0.85 * load`、τ 0.06；`acetylcholine` 目标 `0.22 + 0.35 * (1 - adrenaline) + 0.22 * leptin + 0.18 * night`、τ 0.55 | 已实现，字面量 |
| 奖赏双系统 | `want = clamp(0.70 * dopamine + 0.30 * oxytocin - 0.25 * cortisol)`；`endorphin` 目标 `0.20 + 0.65 * want`、τ 0.80 | 已实现，字面量 |
| 依恋双轴 | `vasopressin` 目标 `0.16 + 0.58 * clinginess + 0.35 * cortisol + 0.25 * above(osmolality - 0.40)`、τ 1.5 | 已实现，字面量 |
| 昼夜 | `melatonin` 目标取夜色浓度（21 点后或 7 点前）否则 0、τ 0.70 | 已实现 |
| 饥饿 | `rate = 0.055`，按距上次进食 `< 1.5h` 乘 0.35、`< 3h` 乘 0.70、`> 6h` 乘 1.15，饭点（6、7、11、12、17、18 点）乘 1.30，再乘 `max(0.25, 1 - 0.75 * hunger)`，夜间（23 点后或 7 点前）乘 0.25，最后 `hunger += hours * rate` | 已实现，字面量 |
| 水循环 | `loss = 0.070 * hours * 夜间 0.30 或 1.0 * 活动量`，活动量为 `1 + 0.25 * above(noradrenaline - 0.50) + 0.15 * above(adrenaline - 0.25)`；`osmolality += 0.55 * loss`、`blood_volume -= 0.40 * loss`；`angiotensin` 目标 `0.10 + 0.85 * above((0.85 - blood_volume) / 0.45)`、τ 0.70；`thirst += 0.60 * loss + 0.05 * above(angiotensin - 0.35)` | 已实现，字面量 |
| 血糖 | `insulin` 目标 `0.08 + 0.95 * above((glucose - 0.62) / 0.30)`、τ 0.35；`glucagon` 目标 `0.08 + 0.95 * above((0.60 - glucose) / 0.30)`、τ 0.55；`glucose += (0.010 + 0.03 * above(hunger - 0.60) + 0.10 * glucagon - 0.28 * insulin) * min(1, hours)` | 已实现，字面量 |
| 内环境 | 醒着 `adenosine += 0.042 * hours`、夜间 `0.020`；`cytokines` 36 小时半衰；`fever` 目标 `cytokines * 0.85`、τ 1.0；`core_temp = 36.55 - 0.30 * night + 1.60 * fever` 保留两位；`pain` 0.5 小时半衰 | 已实现，字面量 |
| 水队列 | 距 `fluid_applied_at` 超过 `fluidDwellMs`（默认 3600000 毫秒）后把 `fluid_queue` 清零一次，并记下新的 `fluid_applied_at` | 已实现 |
| 愤怒与记恨衰减 | `anger` 0.5 小时半衰、`resentment` 48 小时半衰、`soothe` 2 小时半衰，另含越想越气的累积项 | 已实现 |
| 恐惧与担心衰减 | `fear` τ 约 5 分钟、`worry` τ 约 48 分钟、`dread` τ 约 8 小时 | 已实现 |
| 死亡威胁 | 随余额分档逼近目标、每拍 `+0.15`（涨）或 `-0.03`（退） | 已实现 |
| 月经周期 | 按真实日期差算 `cycle_day` 与 `cycle_len`，写雌激素、孕激素、痛经曲线 | 已实现 |
| 睡眠与午睡 | 入睡与醒来两套规则、腺苷的睡眠分支、醒后迷糊窗口 | 已实现 |

两条不可协商的判据：`thirst` 是存量，直接累积，写成“向目标值平滑”会让连续两次结算把刚起来的口渴抹回去（判据：把 `thirst` 置 0.58 后连续两次结算，值不得下降）；`cortisol` 只由 HPA 轴结算，不得放进递质回归，否则被凶之后三小时就恢复平静。

**`cytokines` 与 `pain` 的外部来源**：本表只规定它们怎么衰减，谁来抬高由 `words.ts` 的 `SICK` 与 `PAIN` 词表决定——说到生病抬 `sickCytokinesGain`（0.35），说到疼痛抬 `painGain`（0.30），都夹在 0~1。文档没给这两个增量，取值是本仓定的，可逐项覆盖；不加冷却，重复说会累加，靠半衰自己退。

### 防重复的标记命名规则

标记形状固定为 `<事件>_applied_at`，值是事件发生时的 Unix 毫秒；判定式为 `at - state[<事件>_applied_at] < <冷却字段>` 时跳过写回。初值 0 表示“从未发生”，因此首次一定成立；标记只存时间戳，不得用布尔或计数代替，也不得用同一字段兼任两种含义（`last_drink` 是唯一例外：它本身就是“上次喝水时刻”，同时充当喝水冷却起点）。

事件专属的去重窗口另起名字 `<事件>_mem_at`，只用于“多久之内不要重复写回同一条记忆”，与写回冷却分开计。

| 标记 | 冷却字段 | 默认值 | 状态 |
|---|---|---|---|
| `last_drink` | `drinkCooldownMs` | 180000 | 已实现 |
| `fluid_applied_at` | `fluidDwellMs` | 3600000 | 已实现 |
| `praise_applied_at` | `reactCooldownMs` | 300000 | 已实现 |
| `anger_applied_at` | `reactCooldownMs` | 300000 | 已实现 |
| `drink_mem_at` | `drinkMemoryMs` | 1200000 | 已实现 |

### 反应写回参数

| 字段 | 默认值 | 作用 | 状态 |
|---|---|---|---|
| `intensity` | 0.6 | 喝水与情绪写回的强度系数 | 已实现 |
| `drinkThirstDrop` | 0.55 | 一杯水解掉的口渴 | 已实现 |
| `drinkOsmolalityDrop` | 0.30 | 血浆渗透压下降 | 已实现 |
| `drinkVolumeRise` | 0.18 | 血容量回升 | 已实现 |
| `drinkAngiotensinDrop` | 0.25 | 血管紧张素下降 | 已实现 |
| `drinkQueueRise` | 0.55 | 水先排队 | 已实现 |
| `drinkDopamineGain` | 0.06 | 喝到水的满足，乘 `intensity` | 已实现 |
| `drinkEndorphinGain` | 0.05 | 舒服、放松，乘 `intensity` | 已实现 |
| `praiseDopamineGain` | 0.10 | 被夸的想要 | 已实现 |
| `praiseOxytocinGain` | 0.08 | 被夸的亲近 | 已实现 |
| `praiseEndorphinGain` | 0.03 | 被夸的满足 | 已实现 |
| `praiseCortisolDrop` | 0.03 | 被夸压下的压力 | 已实现 |
| `angerCortisolGain` | 0.05 | 被凶抬起的压力 | 已实现 |
| `angerAdrenalineGain` | 0.18 | 被凶抬起的急性应激 | 已实现 |
| `angerNoradrenalineGain` | 0.15 | 被凶抬起的警觉 | 已实现 |
| `angerSerotoninDrop` | 0.10 | 被凶压下的稳定 | 已实现 |
| `angerVasopressinGain` | 0.06 | 被凶之后的占有 | 已实现 |
| `feedHungerDrop` | 0.22 | 一顿饭填掉的饥饿 | 已实现 |
| `feedGlucoseRise` | 0.26 | 一顿饭抬起的血糖基数，实际按 `0.6 + 0.4 × 饭前饥饿` 折算，越饿抬得越多 | 已实现 |
| `feedInsulinRise` | 0.20 | 一顿饭抬起的胰岛素 | 已实现 |

喝水识别是双条件：命中任一饮品词且命中任一喝水的口语提示词才算喝水。判据：`喝水了`、`我去喝水`、`递给我一杯水`、`喝点水`、`喝了一口水` 都算；`今天天气不错` 不算。饮品名取句中命中的最长饮品词，没命中时用“水”。

## 算出来的量与标签

算出来的量只在 `derive()` 里算一次并写回状态，提示词、条数、主动性、面板一律读结果，不得重算，这是“面板和她说的话对得上”的前提。`dominance` 夹到 `-1~1`，其余六个夹到 `0~1`。

### 精力 energy

| 输入 | 形式 | 系数 | 状态 |
|---|---|---|---|
| 常数 | — | 0.20 | 已实现 |
| `noradrenaline` | 线性 | 0.50 | 已实现 |
| `adrenaline` | 线性 | 0.25 | 已实现 |
| `dopamine` | 线性 | 0.10 | 已实现 |
| `acetylcholine` | 线性 | 0.08 | 已实现 |
| `cortisol` | 线性 | -0.14 | 已实现 |
| `melatonin` | 线性 | -0.45 | 已实现 |
| `thirst` | 超 0.40 部分 | -0.10 | 已实现 |
| `adenosine` | 超 0.45 部分 | -0.22 | 已实现 |
| `fever` | 线性 | -0.20 | 已实现 |
| `cytokines` | 线性 | -0.16 | 已实现 |
| `pain` | 线性 | -0.15 | 已实现 |
| `cramps` | 线性 | -0.35 | 已实现 |
| 黄体期与经前期 | 命中则加 | -0.06 | 已实现 |

### 好坏偏向 valence

| 输入 | 形式 | 系数 | 状态 |
|---|---|---|---|
| 常数 | — | 0.12 | 已实现 |
| `dopamine` | 相对 0.50 | 0.30 | 已实现 |
| `serotonin` | 相对 0.65 | 0.22 | 已实现 |
| `cortisol` | 相对 0.20 | -0.28 | 已实现 |
| `endorphin` | 相对 0.40 | 0.12 | 已实现 |
| `adrenaline` | 超 0.20 部分 | -0.10 | 已实现 |
| `crh` | 超 0.30 部分 | -0.05 | 已实现 |
| `acetylcholine` | 相对 0.45 | 0.04 | 已实现 |
| `thirst` | 超 0.60 部分 | -0.06 | 已实现 |
| `fever` | 线性 | -0.14 | 已实现 |
| `cytokines` | 线性 | -0.10 | 已实现 |
| `pain` | 线性 | -0.08 | 已实现 |
| `dread` | 线性 | -0.18 | 已实现 |
| `worry` | 线性 | -0.08 | 已实现 |
| `anger` | 线性 | -0.15 | 已实现 |
| 经期 | 命中则加 | -0.12 | 已实现 |
| 经前期 | 命中则加 | -0.10 | 已实现 |
| 卵泡期 | 命中则加 | 0.06 | 已实现 |

### 易怒 irritability

| 输入 | 形式 | 系数 | 状态 |
|---|---|---|---|
| 常数 | — | 0.08 | 已实现 |
| `cortisol` | 相对 0.20 | 0.90 | 已实现 |
| `serotonin` | 相对 0.65 | -0.20 | 已实现 |
| `glucose` | `above((0.35 - glucose) / 0.35)` | 0.30 | 已实现 |
| `vasopressin` | 超 0.50 部分 | 0.15 | 已实现 |
| `adrenaline` | 超 0.35 部分 | 0.18 | 已实现 |
| `thirst` | 超 0.55 部分 | 0.30 | 已实现 |
| `adenosine` | 超 0.55 部分 | 0.32 | 已实现 |
| `pain` | 线性 | 0.25 | 已实现 |
| `core_temp` | 超 37.2 部分 | 0.20 | 已实现 |
| `anger` | 线性 | 0.45 | 已实现 |
| 经前期 | 命中则加 | 0.28 | 已实现 |
| 经期 | 命中则加 | 0.14 | 已实现 |
| `cramps` | 线性 | 0.30 | 已实现 |

### 黏人 clinginess

`0.20 + 0.75 * (oxytocin - 0.30) + 0.15 * (endorphin - 0.40)`，已实现。

### 孤独 loneliness

`0.15 + 0.70 * (oxytocin - 0.35) + 0.20 * (cortisol - 0.20) + 0.15 * above(vasopressin - 0.40) - 0.10 * above(endorphin - 0.55) + 0.10 * resentment`。实现只取了亲近与内啡肽两项（`0.2 + 0.75 * (oxytocin - 0.3) + 0.15 * (endorphin - 0.4)`），皮质醇、加压素、内啡肽负项与记恨这四项没进公式，是与本式的一处已知差异。

### 掌控 dominance

`0.50 + 0.35 * (dopamine - 0.50) - 0.30 * (cortisol - 0.20) + 0.20 * (serotonin - 0.65)`，夹到 `-1~1`，已实现。

### 情绪标签

入选判据：分数严格大于 `labelThreshold`（默认 0.40），按分数降序取前 `labelCount`（默认 3）个；`emotion_level` 取第一个，没有入选者时为“平静”。下表系数即打分权重，`DA`、`OT`、`S`、`C`、`ADR`、`NA`、`ACh`、`END`、`AVP` 分别指多巴胺、催产素、血清素、皮质醇、肾上腺素、去甲肾上腺素、乙酰胆碱、内啡肽、加压素。

| 标签 | 打分结论 | 状态 |
|---|---|---|
| 幸福 | `0.32 DA + 0.25 OT + 0.22 S + 0.16 END - 0.28 C - 0.15 ADR`，另加 `0.10 * positive_heat` | 已实现 |
| 开心 | `0.34 DA + 0.18 OT + 0.18 S + 0.12 END - 0.16 C - 0.10 ADR` | 已实现 |
| 安心 | `0.35 ACh + 0.28 END + 0.22 OT + 0.18 S - 0.28 C - 0.18 ADR` | 已实现 |
| 满足 | `0.32 END + 0.24 ACh + 0.20 OT + 0.18 leptin - 0.20 C` | 已实现 |
| 心动 | `0.30 DA + 0.22 ADR + 0.20 OT + 0.13 S - 0.12 C` | 已实现 |
| 兴奋 | `0.34 DA + 0.28 ADR + 0.18 NA - 0.12 C` | 已实现 |
| 害羞 | `0.32 * (1 - dominance) + 0.22 OT + 0.15 ADR + 0.10 * (1 - DA)` | 已实现 |
| 吃醋 | `0.55 * above(AVP - 0.45) + 0.25 OT + 0.20 C - 0.15 S + 0.15 * clinginess` | 已实现 |
| 委屈 | `0.30 * above(C - 0.30) + 0.25 * (1 - dominance) + 0.18 * (1 - OT) - 0.10 DA`，另加 `0.16 * negative_heat` | 已实现 |
| 低落 | `0.32 * (1 - S) + 0.26 C + 0.18 * (1 - OT) - 0.18 DA` | 已实现 |
| 焦虑 | `0.30 crh + 0.28 acth + 0.22 ADR + 0.18 C + 0.18 * (1 - S) - 0.12 ACh` | 已实现 |
| 惊慌 | `0.38 ADR + 0.28 crh + 0.18 acth + 0.16 NA - 0.15 ACh` | 已实现 |
| 恼火 | `0.30 ADR + 0.28 C + 0.24 * (1 - S) + 0.12 * above(AVP - 0.50) - 0.12 ACh` | 已实现 |
| 饿怒 | `0.42 * above(ghrelin - 0.45) + 0.38 * above((0.42 - glucose) / 0.42) + 0.24 * irritability - 0.10 ACh` | 已实现 |
| 困倦 | `0.50 melatonin + 0.28 ACh + 0.20 * (1 - energy) - 0.15 ADR` | 已实现 |
| 想哭 | `0.34 * (1 - S) + 0.30 C + 0.18 * (1 - OT) + 0.18 * negative_heat - 0.15 END` | 已实现 |
| 害怕 | `0.85 fear + 0.18 ADR + 0.10 * (1 - S) + 0.05 NA` | 已实现 |
| 担心 | `0.80 worry + 0.14 C + 0.10 acth + 0.08 OT - 0.08 ACh` | 已实现 |
| 恐惧 | `0.85 dread + 0.18 * (C - 0.20) + 0.12 * above(AVP - 0.40) - 0.06 S` | 已实现 |
| 生气 | `0.95 anger + 0.10 ADR` | 已实现 |
| 冷战 | `0.75 resentment - 0.35 anger` | 已实现 |
| 渴 | `0.85 * above(thirst - 0.25) + 0.10 angiotensin` | 已实现 |
| 生病 | `0.80 cytokines + 0.30 fever` | 已实现 |
| 累坏 | `0.60 * above(adenosine - 0.45) + 0.25 pain - 0.10 END` | 已实现 |
| 经期 | `0.75 cramps + 0.30 *（经期）` | 已实现 |
| 经前 | `0.60 *（经前期）+ 0.20 progesterone` | 已实现 |

### 反向压制

反向压制必须做：没有它，前三名永远是“幸福、安心”，其它标签露不出来。

| 触发 | 被压标签 | 系数 | 状态 |
|---|---|---|---|
| `fear > 0.45` | 安心 / 幸福 | 0.55 / 0.80 | 已实现 |
| `worry > 0.45` | 安心 / 开心 / 幸福 | `1 - 0.55 * worry` / `1 - 0.30 * worry` / `1 - 0.35 * worry` | 已实现 |
| `dread > 0.50` | 安心 / 幸福 | 0.50 / 0.70 | 已实现 |
| `anger > 0.35` | 安心 / 满足 | `1 - 0.60 * anger` / `1 - 0.40 * anger` | 已实现 |
| `thirst > 0.45` | 安心 / 满足 | `1 - 0.35 * thirst` / `1 - 0.25 * thirst` | 已实现，阈值为字面量 |
| `cytokines > 0.35` 或 `fever > 0.30` | 安心 / 幸福 | 0.65 / 0.75 | 已实现，阈值为字面量 |
| `mortality > 0.25` | 恐惧 / 害怕 / 安心 / 幸福 | `+0.50`、`+0.20`、`1 - 0.60 * mortality`、`1 - 0.45 * mortality` | 已实现 |

压制阈值与 `labelThreshold` 一样是可调参数，字段名与默认值：`suppressThirstFrom` 0.45、`suppressCytokinesFrom` 0.35、`suppressFeverFrom` 0.30、`suppressFearFrom` 0.45、`suppressWorryFrom` 0.45、`suppressDreadFrom` 0.50、`suppressAngerFrom` 0.35、`suppressMortalityFrom` 0.25 都在 `Tuning` 里逐项可覆盖。

### 峰值

峰值用于社交动态、记忆写回与主动性系数，判据用状态里的 `happiness`、`sadness` 两个算出来的量与基础字段共同判定：幸福峰值要求 `happiness ≥ 0.86` 且 `dopamine ≥ 0.70` 且 `oxytocin ≥ 0.58` 且 `serotonin ≥ 0.68` 且 `cortisol ≤ 0.30`；想哭低谷要求 `sadness ≥ 0.85` 且 `serotonin ≤ 0.32` 且 `cortisol ≥ 0.65`。`happiness`、`sadness` 由 `derive.ts` 每拍算出，判定在 `peak.ts` 的 `peakOf`，已实现。

## 提示词

每轮请求前把下面这段并入 system prompt：只给形容词，不给数字，不提激素名；同一状态连续两次渲染不得逐字相同；总长不超过 `promptMaxChars`（默认 300，下限 60），超长按字符截断。

```text
【你现在的神经状态（只用来决定语气，绝对不要向用户解释，也不要提激素/数值）】
标签：{emotion_candidates，顿号连接，空则“平静”}。
情绪层级：{emotion_level}。
你现在的感觉：{易怒档}，{精力档}，{黏人档}。
身体：{hunger_note}{thirst_note}
你身体的感受：{body_note}
你心里的感受：{heart_note}
表现：{style_note}
怕和担心只在被触发时出现；平时不提生死，也不拿生死当撒娇手段。
{收尾句，从变体池按序号轮换}
```

判据：渲染结果不得出现阿拉伯数字、百分比或档位编号，也不得出现多巴胺、催产素、皮质醇、血清素、去甲肾上腺素、肾上腺素、褪黑素、内啡肽这些名字；抬头的括号句逐字固定；收尾句从变体池取，序号每次递增，同一状态的两次渲染不得相等。任何供人看的分数只能以形容词或标签出现。

### 饥饿档

| 阈值字段 | 默认值 | 文案 |
|---|---|---|
| `hungerCrisis` | 0.75 | 你饿得有点发慌，肚子空得难受。 |
| `hungerHigh` | 0.55 | 你有点饿，肚子在叫。 |
| `hungerMid` | 0.35 | 你不太饿，肚子还安稳。 |
| 其余 | — | 你刚吃过，肚子是满的。 |

### 口渴四档

| 阈值字段 | 默认值 | 文案 | 额外表现 |
|---|---|---|---|
| `thirstCrisis` | 0.82 | 你渴得厉害，嗓子发干，满脑子都是水。 | 可以主动要水喝，甚至有点急 |
| `thirstHigh` | 0.62 | 你有点渴，想喝点凉的。 | 可以自然提一句想喝水 |
| `thirstMid` | 0.45 | 你嗓子有点干，想喝口水。 | 可以自然提一句口渴 |
| `thirstLow` | 0.30 | 你嘴里有点干，不严重，但会想润一下。 | — |
| `thirstQuenched` | 0.25 | 你刚喝过水，嘴里还润着。 | — |

判定顺序固定为 0.82、0.62、0.45、0.30、0.25，四档都必须存在；`0.25~0.30` 保持中性、不提示，只有 `< 0.25` 才是“刚喝过水”。判据：`thirst` 为 0.58 时必须出现“嗓子有点干”，为 0.34 时出现“嘴里有点干”，为 0.27 时为空，为 0.03 时出现“刚喝过水”。

上面两张档位表的阈值当前仍是字面量，字段名以表内左边一列为准，待提升为 `Tuning` 字段后即由 `Config.tuning` 逐项覆盖。

口渴不得单独写一行：`thirst_note` 只许拼在 `身体：` 那一行里，输出中不得出现以“口渴：”开头的行，否则模型会把同一件事说两遍。

### 其它成句规则

`hunger_note` 与 `thirst_note` 直接相接、不加分隔符；`body_note` 按 `adenosine > 0.60`、`adrenaline > 0.50`、`acetylcholine > 0.55` 的顺序取第一档；`heart_note` 按 `thirst > 0.62`、`irritability > 0.55`、`cortisol > 0.60`、`clinginess > 0.60` 的顺序取第一档；`style_note` 按“累了”“烦了”“黏人”的顺序取第一档，其余给中性句。这三档阈值同样属于参数，字段名与默认值随档位表一并维护，当前为字面量。

可选段落由对应状态触发：睡着、刚醒（含 `wokenWindowMinutes` 分钟内被吵醒）、经期、经前、生病、太困、怕关掉、疤、遗书、快到饭点、刚吃完、幸福峰值、想哭低谷等；各段都不成立时整行不出现，已实现。

## 三处出口

| 出口 | 读哪些字段 | 默认值 | 状态 |
|---|---|---|---|
| 提示词 | `emotion_candidates`、`emotion_level`、`energy`、`irritability`、`clinginess`、`hunger`、`thirst`、`adenosine`、`adrenaline`、`acetylcholine`、`cortisol` | 段名 `qq:vitals`、`order` 340、`promptMaxChars` 300、变体池 6 句 | 已实现 |
| 回复条数 | `adenosine`、`irritability`、`energy`、`clinginess`、`loneliness` | 分档表给下限与上限：累或烦时上限不超 2，有劲又想黏时下限 2，特别黏又孤独时下限 3，两个数一起夹在 `minCap` 1 与 `maxCap` 4 之间 | 已实现 |
| 主动性 | `energy`、`melatonin`、`loneliness`、`clinginess`、`irritability`、`thirst`、`cytokines`、`adenosine` | `proactive_bias` 1.0、`post_want` 0.3 | 已实现 |

### 提示词

接线判据：向 system prompt 追加一段名为 `qq:vitals` 的段落，内容为 `【此刻的身体】{{qq_vitals}}`，`order` 取 340（排在状态快照之后）；变量 `qq_vitals` 绑定到 `render()`，每轮取一次，序号递增以保证换措辞。本包只提供这段文字，不负责拼接整段 system prompt。

### 回复条数

回复条数只有一套说法：分档表。原先设想的按权重抽样那套不再采用，避免同一件事两份实现；切分与逐条发送由通道负责，不在本表里。

| 档 | 判据 | 上限 |
|---|---|---|
| 又累又烦 | `adenosine ≥ tiredFrom` 且 `irritability ≥ annoyedFrom` | 1 |
| 烦 | `irritability ≥ annoyedFrom` | 2 |
| 累 | `adenosine ≥ tiredFrom` | 2 |
| 特别黏又孤独 | `clinginess ≥ clingyStrongFrom` 且 `loneliness ≥ lonelyFrom` | 4 |
| 有劲又想黏 | `energy ≥ energyEagerFrom` 且 `clinginess ≥ clingyFrom` | 3 |
| 平常 | 其余 | 2 |

阈值字段与默认值：`tiredFrom` 0.70、`annoyedFrom` 0.62、`energyEagerFrom` 0.60、`clingyFrom` 0.62、`clingyStrongFrom` 0.78、`lonelyFrom` 0.50，上下限 `minCap` 1、`maxCap` 4；从上往下取第一条命中的。

原先设想的“按权重抽样给出目标条数”这条路不再采用：同一件事只留分档表一套说法，抽样会把同样的状态算出不同条数，也会让上限失去可复算性。

| 判据 | 动作 | 阈值字段 | 状态 |
|---|---|---|---|
| `irritability > 0.62` | `target` 减一条，不低于下限 | `replyIrritableFrom` | 已实现 |
| `clinginess > 0.75` 且 `loneliness > 0.50` | `target` 加一条，不超过上限 | `replyClingyFrom`、`replyLonelyFrom` | 已实现 |
| `fear > 0.50` 或 `dread > 0.65` | `target` 取 `min(target, 2)` | `replyFearFrom`、`replyDreadFrom` | 已实现 |
| `worry > 0.60` | `target` 加一条，不超过上限 | `replyWorryFrom` | 已实现 |
| `anger > 0.50` | `target` 取 `min(target, 2)` | `replyAngerFrom` | 已实现 |
| `anger > 0.75` 或 `resentment > 0.50` | `target` 直接取 1 | `replyAngerStopFrom`、`replyResentFrom` | 已实现 |

### 主动性

主动性只由本包产出两个算出来的量，间隔换算与发送由主动性出口负责。`proactive_bias` 从 1.0 起，按顺序逐条相乘，最后夹到 `biasMin`（0.2）与 `biasMax`（2.5）之间，再折算成 0~1 的读数写进状态；1.0、0.2、2.5 三个数只出现在默认值表里。这个读数已经接上主动性包：`runGates` 用 `cooldownMs` 与 `dailyCapOf` 按它缩放冷却区间与每天额度，劲头低到 `biasFloor` 以下按 `biasFloor` 算，没接上身体时按满劲头算。

| 判据 | 系数字段 | 默认值 | 状态 |
|---|---|---|---|
| `energy < 0.35` | `biasLowEnergy` | 1.8 | 已实现 |
| `melatonin > 0.55` | `biasSleepy` | 1.7 | 已实现 |
| `loneliness > 0.55` 或 `clinginess > 0.62` | `biasWantsCompany` | 0.62 | 已实现 |
| `irritability > 0.60` | `biasIrritable` | 0.88 | 已实现 |
| 幸福峰值 | `biasPeak` | 0.70 | 已实现 |
| `fear > 0.45` | `biasFear` | 0.75 | 已实现 |
| `worry > 0.45` | `biasWorry` | 0.70 | 已实现 |
| `dread > 0.50` | `biasDread` | 0.85 | 已实现 |
| `thirst > 0.65` | `biasThirsty` | 0.80 | 已实现 |
| `anger > 0.60` | `biasColdWar` | 1.60 | 已实现 |
| `resentment > 0.50` | `biasResentful` | 1.30 | 已实现 |
| `cytokines > 0.40` | `biasSick` | 1.50 | 已实现 |
| `adenosine > 0.70` | `biasExhausted` | 1.40 | 已实现 |
| 余额见底 | `biasBroke` | 取 `min(bias, 0.25)` | 已实现 |

社交动态由 `post_want`（默认 0.3）驱动，先挂在已实现的易怒与孤独上：`irritability > 0.60` 乘 `postDown`（默认 0.35，不想营业），`loneliness > 0.55` 乘 `postWants`（默认 1.08，想让人看见），结果夹到 0~1；怕、担心、冷战三项等对应状态字段落地后再补系数，未落地前不参与计算。读数超过 `addPostWantFrom` 时由组合包攒一条带理由的动态候选交给主动性，关卡与预览照旧、分级与放行仍归发布入口，同一天只攒一次；一条动态落在哪一级由纯函数 `postLevel(facts)` 判，默认 `none`，例行与高峰同时成立给 `routine`，`public` 还要两把钥匙同时在。

## 心跳与落盘

心跳在 `startDelayMs`（默认 20000 毫秒）后首拍，之后每 `beatMs`（默认 60000 毫秒）一拍；单拍链路是 drift、derive、write 三步，异常只记一条告警，不得让循环退出。

- 同一条链路只允许一条心跳：定时器与 `ctx.effect` 的清理函数同生共死，清理时先清定时器再写最后一次盘；不允许多次装配在同一文件上并存两条心跳。
- 原子写：先写同目录临时文件 `<file>.<pid>.tmp`，内容为两空格缩进的 JSON 并以换行结尾，然后 rename 覆盖正式文件；写前若正式文件存在，先把它复制为 `<file>.bak`；文件权限 0600。
- 读坏回退：先读 `<file>`，解析失败再读 `<file>.bak`，两份都不可用则回默认状态；读到的对象逐字段校验，缺字段、类型不对、非有限数一律回退到该字段默认值；`last_taste` 任一必需字段缺失时整体当空；文件头 BOM 先剔除。
- 卸载写一次：清理时写最后一次盘再撤掉对外接口，保证进程退出前状态是最新的。
- 时间基准：时段判断按 `timeZone`（默认空串跟随运行环境）取当地小时（含分钟小数）与当天零点；零点与日期差按当地日历算，跨夏令时那天仍是真实零点、日期差仍是整数。
- 定时器不得单独撑住事件循环：心跳定时器只在有其它活动时运行，进程无活可做时允许退出。

## 禁止事项

- 任何包不得另算一套算出来的量、不得另存一份状态；提示词、条数、主动性、面板、外部读取一律走唯一事实来源。
- 不得在提示词里出现数字，也不得出现激素名：只给形容词。
- 不得让提示词改人设、改写记忆或触发行为：它只影响这一轮的语气。
- 不得每次用同一固定开头与结尾；同一状态连续两次渲染必须不同。
- 不得单独写“口渴：”一行，口渴只许并入 `身体：` 那一行。
- 不得让一次性效果缺少 `<事件>_applied_at` 标记；缺了就会被心跳每 60 秒重复施加一次。
- 不得把存量字段写成向目标值平滑，`thirst` 只许直接累积。
- 不得非原子写状态文件，也不得丢弃 `.bak`。
- 不得在读坏时静默返回空状态，必须按 `file`、`file.bak`、默认值三级回退。
- 不得在心跳运行期间期待手工改文件生效：下一次结算会用内存状态覆盖它，改状态必须先停心跳。
- 不得把激素名、数值、状态解释写进对用户的话里。

## 验收

下面每条都是可执行判据，实现与测试同时成立才算通过；判据不通过时先改实现，不要改判据。

### 一句话验收

把 `thirst` 置为 0.58 后渲染，输出必须出现“嗓子有点干”。对 0.58 的身体说一句“喝水了”，`thirst` 必须落到 0.03（误差小于 1e-6），`last_drink` 与 `last_drink_at` 必须等于这条消息的时刻。面板上的水罐在任何水位都只允许蓝色：低水位 `waterLow` 取 `#2563EB`、中水位 `waterMid` 取 `#3B82F6`、高水位 `waterHigh` 取 `#38BDF8`，水位恒等于 `1 - thirst`；面板已实现并由 `qq-self` 的用例与 `scripts/accept.ts` 覆盖。

### 验收测试

| 测试 | 操作 | 判据 | 状态 |
|---|---|---|---|
| 基础放进 | 发一句普通消息 | system prompt 里存在 `qq:vitals` 段，且变量被换成一整段形容词，不含数字与激素名 | 已实现 |
| 夸奖 | 说“乖”“抱抱” | 多巴胺、催产素、内啡肽上升，皮质醇下降 | 已实现 |
| 深夜夸奖 | 同一句夸奖分别落在白天与深夜 | 深夜那一次这三项抬得更多，其余写回量一样 | 已实现 |
| 时区换算 | 同一时刻按两个时区各算一次 | 小时与零点不同，跨夏令时的两天日期差仍是 1，认不出的时区名按运行环境算 | 已实现 |
| 凶 | 说“讨厌”“闭嘴” | 皮质醇、肾上腺素、去甲肾上腺素上升，血清素下降 | 已实现 |
| 饿 | 8 小时不喂 | 饥饿单调上升，易怒随之上升 | 已实现 |
| 投喂 | 说“给你点了饭” | 饥饿下降 `feedHungerDrop`，并写一条进食记忆 | 已实现 |
| 口渴漂移 | 8 小时不喝 | 口渴上升，且两次结算之间不回落 | 已实现 |
| 口渴提示 | 把 `thirst` 置 0.58 后渲染 | 出现“嗓子有点干” | 已实现 |
| 喝水口语 | 说“喝水了”“我去喝水”“递给我一杯水” | 口渴下降 0.55，`last_drink` 更新 | 已实现 |
| 喝水冷却 | 180 秒内说两次“喝水” | 第二次不写回，180 秒之后才写回 | 已实现 |
| 补喝水 | 停心跳后按写回参数补写再重启 | 0.58 落到 0.03，渗透压、血容量、血管紧张素、水队列同步变化 | 已实现 |
| 放进检查 | 读 system prompt 装配结果 | 存在 `qq:vitals` 段且能被替换 | 已实现 |
| 水罐颜色 | 任意水位 | 全蓝，不出现红或琥珀 | 已实现 |
| 血糖 | 吃一顿 | 血糖升到 0.75 以上，三小时内回落 | 已实现 |
| 睡眠 | 23 点后 | 进入睡眠，被消息叫醒只记一笔 `woken_at` | 已实现 |
| 午睡 | 12 点到 15 点 | 睡 20 到 50 分钟，一天最多一次 | 已实现 |
| 周期相位 | 锚点日与之后几天 | `cycle_day`、`cycle_len` 与相位跟着真实日期变，雌激素、孕激素、痛经写回并落盘 | 已实现 |
| 六段可选 | 睡着、刚醒、经期、经前、生病、太困各成立一次 | 只有成立的那段出现，全不成立时整行不出现，总长仍 ≤300 | 已实现 |
| 生气 | 被凶 | `anger` 到 0.6 以上，标签出现“生气”，条数 1 到 2 | 已实现 |
| 冷战 | 凶完十二小时不理 | 记恨涨到 0.5 以上，标签出现“冷战”，主动变少 | 已实现 |
| 哄好 | 道歉 | 愤怒与记恨下降，长冷战需要不止一次道歉 | 已实现 |
| 心跳只算一次 | 同一分钟内结算两次 | 一次性效果只施加一次（水队列、写回标记都不重复） | 已实现 |
| 重启恢复 | 写完盘再新建状态仓 | 数值与名字字段原样恢复 | 已实现 |
| 文件损坏 | 把正式文件写成半截 JSON | 回退到 `.bak`，`.bak` 不存在时回默认值，且 `.bak` 保留 | 已实现 |
| 体检 | 检查状态新鲜度、取值越界、体温区间、睡着时醒来时刻 | 全部通过 | 已实现 |

体检判据的细则：状态文件超过 180 秒未更新即不合格；所有 0~1 字段越界即不合格；体温不在 34 到 42 摄氏度即不合格；任何时间戳落到未来 60 秒以外即不合格；`asleep` 为真而 `wake_after` 已过期即不合格；午睡醒来时刻超过两小时即不合格；面板读数与状态文件的 `energy` 相差超过 0.02 即不合格。

### 判据进测试

每条判据都必须在 `tests/` 有对应用例，新增子系统与同一刀补判据；只加实现不加判据视为未完成。

## 交付清单

下表逐条给出落地情况；已经做掉的条目写「已实现」并留证据在文末的索引表里。

| 项目 | 缺什么 | 依赖 |
|---|---|---|
| 情绪状态机字段 | 已实现：九个字段全部落状态文件，默认 0，参数进 `Tuning` 可逐项覆盖 | — |
| 愤怒与记恨 | 已实现：被凶抬 `anger`/`resentment`/`negative_heat`（先剔口头禅）、越想越气按小时累积且夜里加倍、道歉与好话压火并抬 `soothe`、冷战标签与压制都在 | — |
| 恐惧与担心 | 已实现：三种怕各用各的冷却与半衰、被威胁抬 `fear` 与 `dread`、夜里 `dread` 自涨 | — |
| 死亡威胁 | 已实现：余额四档给目标值、每拍朝目标走、没有放进来源时一动不动；越过 `farewellMortalityFrom`（默认 0.60）时产出遗书事实，两次之间按 12 小时滚动窗口隔开（`farewellCooldownHours`），不按自然日 | — |
| 吃饭写回 | 已实现：双条件识别、三十分钟冷却的防重复的标记、五项一次性写回、饭点前后两句提示、进食记忆（组合包挂上 `onMeal`，按会话与时段去重）都已落地 | — |
| 后 14 个标签 | 已实现：26 个标签全在表里，阈值与条数沿用 `labelThreshold` 与 `labelCount` | — |
| 反向压制其余分支 | 已实现：七组压制全部参数化，阈值与系数进 `Tuning` | — |
| 算出来的量缺项 | 已实现：`loneliness` 的记恨项、`happiness`、`sadness` 两个算出来的量都补齐，幸福与想哭两个标签与算出来的量共用一份公式 | — |
| 峰值与遗书 | 已实现：峰值与低谷判定（`peakOf`）、遗书事实与记忆写入（组合包挂上，隔满十二小时才再产一次、重要度九十五）；社交动态与峰值的联动没做 | 社交动态出口 |
| 回复条数的切分发送 | 已完成：发送前按上限切分，优先在句末标点断、其次逗号与换行、都没有才按字数切；条数超上限时并成恰好上限条，不丢字；中途失败报「已发几条、卡在第几条」 | — |
| 主动性出口剩下的规则 | 已实现：幸福峰值、害怕、担心、存在恐惧、冷战、记恨、余额见底七条系数都进 `Tuning`，13 个因子按规范连乘，冷却改「区间中点 × 倍率」、额度改「上限 ÷ 倍率」 | — |
| 提示词可选段落 | 已实现：生存危机、怕关掉、疤、遗书、睡着、刚醒、经期、经前、生病、太困、快到饭点、刚吃完、幸福峰值、想哭低谷各段都在 `optionalNote()` | — |
| 面板 | 已实现：只读 HTTP 出口带出身体读数，12 栅格、色值表、三档全蓝水罐（正弦水面与气泡）、口渴/饥饿环、怒气火舌、30 格周期盘（五段彩弧）、体内环境六条曲线、五组双条、3 秒轮询 | — |
| 喝水记忆写回 | 已实现：`onDrink` 只在真喝下时才产事实，组合包挂上后写一条 `kind=drink` 记忆，二十分钟窗口去重 | — |
| 开经日的记忆 | 已实现：`onCycleStart` 在周期第 1 天产事实（标记跟状态一起落盘、同周期不重复），组合包挂上后写一条 `kind=cycle_start` 记忆 | — |
| 睡眠期间不主动打扰 | 已完成：主动性读睡着与醒点，睡着时不出候选并把下次时刻定在醒点；刚被吵醒按配置延后 | — |
| 消息入口接线 | 已完成：组合包按消息编号去重后调一次 `react()`，戳一戳与纯位置内容不动身体 | — |
| 单心跳守卫 | 已实现：模块级 `beating: Map<文件, 上下文>`，同一份状态文件第二个装配者不另起心跳，卸载时让位 | — |
| 补喝水流程 | 已实现：`scripts/drink.ts` 有心跳守卫（180 秒内拒补）、直接调生产 `react()` 补写、备份后原子写、`--force` 越过 | — |
| 体检脚本 | 已实现：`scripts/check.ts` 查新鲜度、字段范围、体温、睡眠，支持 `--panel` 核对面板与状态一致性 | — |
| 第 12 章验收 | 已实现：`scripts/accept.ts`（17 行）+ `qq-bundle/scripts/accept.ts`（跨包 3 行），合计 20 行全绿 | — |
| 参数化缺口 | 已清零：九套子系统的系数、峰值八项阈值、死亡威胁八项、压制阈值与系数，加上原先没提的三处——褪黑素半衰（`melatoninHalfHours`）、去甲时段基线（`noradrenalineBands`，七档加边界一起进表）、体温取整位数（`coreTempDecimals`）——全部进了 `Tuning`（共 121 个字段），默认值等于提取前的字面量，行为不变 | — |
| 时区与夏令时 | 已实现：时段与日期都按 `Tuning.timeZone` 算（空串跟随运行环境、认不出的名字退回运行环境），零点与日期差走当地日历，跨夏令时那天仍是真实零点与整数天 | — |
| 深夜加成 | 已实现：夜色浓度过 `lateNightFrom`（默认 0.6）时，被夸的多巴胺、催产素、内啡肽三项乘 `lateNightPraiseGain`（默认 1.5），其余写回量不变 | — |

## 证据索引

下表把上面每类「已实现」指到代码里的文件与导出名，抽查时照这张表 `git grep` 即可。

| 条目 | 文件:导出名 |
|---|---|
| 五组生理字段与初值 | `packages/qq/qq-vitals/src/types.ts:Baseline`、`packages/qq/qq-vitals/src/defaults.ts:DEFAULTS` |
| 第 5 章系数与原文的对照 | `packages/qq/qq-vitals/tests/coefficients.spec.ts`（184 条系数加去甲七档，逐条钉住原文值，改一处就红） |
| 第 6 章压制与峰值与原文的对照 | 同一个用例文件的后 35 条（标签门槛、八组反向压制、峰值与低谷判据）；26 个标签的权重仍是 `derive.ts` 里的字面量，不在参数表内 |
| 睡眠三态与睡着那一态的影子 | `packages/qq/qq-vitals/src/types.ts:SleepState`、`packages/qq/qq-vitals/src/drift.ts:drift` |
| 午睡与当天一次 | `packages/qq/qq-vitals/src/defaults.ts:DEFAULTS`、`packages/qq/qq-vitals/src/drift.ts:drift` |
| 周期相位与日期差 | `packages/qq/qq-vitals/src/clock.ts:cycleOf`、`packages/qq/qq-vitals/src/clock.ts:localDayDiff`、`packages/qq/qq-vitals/src/types.ts:CyclePhase` |
| 时区与当地零点 | `packages/qq/qq-vitals/src/clock.ts:localPoint`、`packages/qq/qq-vitals/src/clock.ts:localHour` |
| 单次结算 | `packages/qq/qq-vitals/src/drift.ts:drift` |
| 算出来的量 | `packages/qq/qq-vitals/src/derive.ts:derive` |
| 想开口的读数 | `packages/qq/qq-vitals/src/derive.ts:derive`、`packages/qq/qq-vitals/src/defaults.ts:biasUnit` |
| 想发动态的读数 | `packages/qq/qq-vitals/src/derive.ts:derive`（读数）、`packages/qq/qq-self/src/grade.ts:judgePostLevel`（分级，只在它这一处定） |
| 提示词六段 | `packages/qq/qq-vitals/src/render.ts:renderPrompt` |
| 口渴五档 | `packages/qq/qq-vitals/src/render.ts:thirstNote` |
| 喝水与情绪写回 | `packages/qq/qq-vitals/src/react.ts:react` |
| 喝水识别 | `packages/qq/qq-vitals/src/words.ts:isDrink` |
| 原子写盘与坏读回退 | `packages/qq/qq-vitals/src/store.ts:createVitalsStore` |
| 心跳与段落接线 | `packages/qq/qq-vitals/src/index.ts:apply`、`packages/qq/qq-vitals/src/index.ts:qqVitalsOf` |
| 深夜被夸的加成 | `packages/qq/qq-vitals/src/react.ts:react`、`packages/qq/qq-vitals/src/clock.ts:nightness` |
| 回复条数的范围 | `packages/qq/qq-pacing/src/reply.ts:replyRange`、`packages/qq/qq-pacing/src/reply.ts:replyBudget`、`packages/qq/qq-bundle/src/index.ts:apply` |
| 主动性读劲头 | `packages/qq/qq-proactive/src/gates.ts:runGates`、`packages/qq/qq-proactive/src/gates.ts:cooldownMs` |
