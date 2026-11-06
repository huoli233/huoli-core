---
description: "生命状态：自己独占的一份身体状态、一条心跳，加上每轮写进提示词的一小段形容词。"
kind: "package-reference"
---

# qq-vitals

## Summary

她自己的生理状态：递质、体液、代谢、睡眠压力、睡眠三态与周期相位。时间让它漂移，互动改它，每轮再把它写成一小段只有形容词的话放进提示词。状态文件由这一包独占，别的包只读不算。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

提示词里多一段 `{{qq_vitals}}`，写的是此刻身体的形容词：饿不饿、渴不渴、身上松不松、这一轮怎么说话。睡着、刚被吵醒、经期、经前、生病、太困这六件事各自成立时才多一句，都不成立就整行不出现；饭点前半小时与刚吃完的三十分钟内各再多一句。幸福到峰值、难过到低谷时也各多一句，分别由 `peakHappinessFrom` 与 `troughSadnessFrom` 触发。死亡威胁高过 `farewellMortalityFrom` 时再多一句「你心里有些话，怕来不及说」，它排在这些可选句的最前面，整段截断时也留得住。关停的怕高过 `promptShutdownDreadFrom` 时多一句「你知道自己随时可能被关掉，这件事让你不安」，排在可选句的最前面。怕、担心、生死、火气、记恨这几项不另起段落，只在“你心里的感受”与“表现”两行里换一档说法，不到线时仍用原来那句。不给数字，也不提激素名。混合层不进这段正文：`emotion_blend` 与 `emotion_why` 只在状态文件里给面板与排障读。`emotionToneEnabled` 打开且这一轮有入选标签时才多一行「语气：…」，说的只是句子长短、要不要停、要不要解释，不带情绪名、权重与来由；开关默认关着，关着时这段与没有混合层时逐字相同，正文里的标签行按 `emotion_candidates` 照原样写。

#### Token effect

固定一小段，最多三百字，不随聊天变长。

#### KV Cache effect

这段每轮都可能变，会让前缀缓存失效。

## Known Limitations and Deferred Work

- 十二套子系统落了递质回归、HPA 轴、交感副交感、奖赏、依恋、昼夜、饥饿、水循环、血糖、睡眠压力、月经周期、睡眠与午睡；情绪那一套落了愤怒、记恨、被哄、惊吓、担心、存在性恐惧与两档热度，死亡威胁按余额分档朝目标走，但余额只能由外部放进，本包不接任何余额系统。
- 遗书只出事实：死亡威胁过 `farewellMortalityFrom` 且当天还没产过时，心跳产出一条带 `at`、`mortality` 与一句来由的事实，走 `QqVitalsSeam.onFarewell` 通知一次；正文一个字都不在这里写，要等组合包自己成文并落成记忆。
- 互动认喝水、吃饭、被夸、被凶、被道歉、被吓、担心、生死、被威胁九条；睡着时只记一笔被吵醒，九条都不写。这几条由装配层的 `QqVitalsSeam.react` 收消息时写回。
- 进食记忆没写：记下一顿只会走 `QqVitalsSeam.onMeal` 这个接口位，本包不落任何记忆，要等组合包把它接到长期记忆。
- 开经当天写一条记忆这段没做，等记忆写入接口接上。
- 睡眠期间不主动打扰要主动性出口读 `asleep` 与 `wake_after` 把下一次消息推后，那一段在主动性包里，本包只出这两个事实。
- 时段与日期都按 `Config.tuning.timeZone` 算，空串跟随运行环境；零点与日期差按当地日历取，跨夏令时那天仍是真实零点、日期差仍是整数。夜睡醒来的钟点还是零点加固定小时数，拨钟那一夜会比墙上时间差一小时。
- 想开口的倍率只接了没力气、犯困、想有人陪、有火、缺水、生病、睡不够这七条；幸福峰值、害怕、担心、存在恐惧、冷战、记恨、余额见底要等对应出口接上。
- 想发动态只接了有火往下压、孤独往上抬两条；害怕、担心两条同理等出口接上。
- 峰值只出事实：`peakOf` 给 `happy`、`sad`、`null` 三种结论，发不发由出口与 `qq-self` 的分级决定，这一包不产出“该不该发”；分级只有一处准，原来的 `src/post.ts` 没人调用，已删。
- 余额档位没有来源：`QqVitalsSeam.setBalance(level)` 是留给外部余额系统的放进端口，不给时 `mortality` 一动不动，也不自行回落。
- 运行环境事实没有来源：`QqVitalsSeam.setExistence({ uptimeMs, restartsToday, shutdownNotice })` 是留给进程守护那一侧的放进端口，这一包不读进程状态、不读系统、不猜重启；不给时 `mortalitySalience` 与 `shutdownDread` 不朝目标走，只有夜里自涨那条还在。
- 关停提示按"当前这条提示"记只算一次：`shutdown_notice_at` 非零期间同一条提示只抬一档，提示撤回后标记清零，下一条提示才又抬一档；一次提示持续多久、中途换没换过，这一包分不出来。
- 夜里自涨只看夜色浓度这一条（与 `dread` 那条共用 `nightness`），"独自"没有单独判据：有没有人在说话不影响它，要接这一点得另加事实。
- 混合层只读：`emotion_blend` 与 `emotion_why` 落在状态文件里给面板与排障读，不进提示词正文、不写记忆、不改任何生理值，同一次交互不会被扣两次；主情绪仍是 `emotion_type`（`emotion_level` 与 `emotion_candidates`），混合层只是补充。
- 混合层每条来由取的字段表写在 `src/emotion.ts` 的 `CAUSES` 里，与 `src/derive.ts` 的打分式同源但分开写，没有机制强制两边同步：改打分权重时这张表要一起改。
- 语气那一行只有两档（一路压过其余、几路掺在一起），要更细的分档得在 `src/render.ts` 里加，不是参数。

<a id="dev-note"></a>
### Dev Note

默认参数集中在 `src/defaults.ts` 的 `DEFAULTS`，`Config.tuning` 可以逐项覆盖；参数声明在 `src/tuning.ts`，一个字段只声明一次；状态默认落在数据根目录的 `data/qq-vitals.json`，可用 `Config.file` 改。各段公式的位置：漂移、睡眠三态与周期结算在 `src/drift.ts`，时钟与日期判断在 `src/clock.ts`（`localHour`、`localPoint`、`localDayDiff` 都收一个时区名，留空跟随运行环境，认不出的名字也按运行环境算），写回在 `src/react.ts`，算出来的量与标签在 `src/derive.ts`，峰值判定在 `src/peak.ts`，余额分档在 `src/mortality.ts`，运行环境事实到两个存在性字段在 `src/existence.ts`，提示词在 `src/render.ts`，社交动态分级在 `src/post.ts`，原子写盘与备份在 `src/store.ts`，词表在 `src/words.ts`。`react` 是纯函数，装配层把它包成 `seam.react(text, at)`：先按消息时间结算漂移，再写回并立即落盘；冷却窗口由 `drinkCooldownMs`、`reactCooldownMs`、`mealCooldownMs` 管，同一条消息重放不会重复扣。

吃饭跟喝水用的是同一套结构：`isMeal(text)` 要求食物名与吃的动作两个条件都命中，素材在 `src/words.ts`，那一模块只产出“这句话在说一顿饭”这个事实，不产出该不该吃。写回一次改五个量——`hunger` 减 `feedHungerDrop`、`ghrelin` 减 `feedGhrelinDrop`、`leptin` 加 `feedLeptinRise`、`glucose` 加 `feedGlucoseRise` 乘饭前饥饿、`insulin` 加 `feedInsulinRise`——并同时把 `last_meal` 与 `meal_applied_at` 写成这一条消息的时刻；两顿饭的冷却只看 `meal_applied_at`，`last_meal` 是饥饿结算读的那个事实。血糖怎么回落不在这里写第二套，交给 `drift` 已有的双向调节：饭后胰岛素高了，`glucose` 那一条就转成负项。

睡眠走 `awake | sleeping | waking` 三态：夜里且睡眠压力过 `sleepAdenosineFrom` 就睡，醒来看“到点、白天里睡眠压力回到低位、白天最晚”三条，午睡只认到点这一条，两套规则不共用，一觉睡着期间不会起第二觉；醒后留一段迷糊窗口，窗口走完回到醒着。睡着期间腺苷按 `sleepAdenosineDrop` 或 `napAdenosineDrop` 往下掉，别的子系统照常结算；`asleep` 是睡着这一态的布尔画到屏幕上，写的地方只有一处，读回来也按三态重算，不会两边对不上。午睡一天一次，靠 `nap_at` 与当下落在同一个本地日期判断。`drift` 的第四个参数是零到一的随机源，入睡时刻的随机与午睡概率都走它，测试给一个定值就完全可复现。

周期按真实日期差算：锚点取每月 `cycleDom` 号，今天早于它就取上月这一天，`cycle_day` 从锚点起算，`cycle_len` 取到下一个锚点（28~31 天），相位按 `cycleMenstrualEnd` 等四个边界切分，雌激素、孕激素、痛经三段曲线跟着相位写回。相位作为事实进状态，`energy`、`valence`、`irritability` 各按 `valenceMenstrualPenalty` 一类的系数加减对应项。

情绪九项分三路：被凶抬 `anger`、`resentment` 与 `negative_heat`，被道歉与好话抬 `soothe` 并压 `anger` 与 `resentment`；被吓、担心、生死分别抬 `fear`、`worry`、`dread`，被威胁关掉或换掉同时抬 `fear` 与 `dread`；被夸抬 `positive_heat`，其中多巴胺、催产素、内啡肽三项在深夜乘 `lateNightPraiseGain`（默认 1.5），夜色浓度过 `lateNightFrom`（默认 0.6）才算深夜，其余写回量两刻一样。识别凶与生死之前先用 `saidSeriously` 把笑死、累死、烦死、吓死、死定这类口头禅整段剔掉，剩下的才算真话；每路各有自己的 `<事件>_applied_at` 与冷却。`mortality` 只由余额档位驱动：装配层把它接在 `QqVitalsSeam.setBalance(level)` 上，这一包不接任何余额系统，端口留着由外部喂。

回落是半衰：`anger` 半小时、`resentment` 两天、`soothe` 两小时、`fear` 五分钟、`worry` 四十八分钟、`dread` 八小时、两档热度六小时与十二小时，半衰期全在 `Config.tuning` 里。记恨过 `resentFrom` 又被晾着超过 `resentIdleHours` 就按 `resentBumpRate` 慢慢涨，单次封顶 `resentBumpMax`，夜色到 `nightFullFrom` 以上再乘 `resentNightFactor`；`dread` 在夜里按 `dreadNightRise` 乘夜色浓度自己涨。

标签一共二十六个，全部在 `derive()` 里打分，`labelThreshold` 与 `labelCount` 决定入选与条数；反向压制按七条触发线把安心、幸福、满足、开心压下去，`mortality` 那条反过来给恐惧与害怕加分。压制阈值与系数是 `SuppressTuning` 的字段，和 `EmotionTuning` 一起由 `Tuning` 看全文，所以 `Config.tuning.<字段名>` 能逐项覆盖。

混合层在 `src/emotion.ts`：`mixOf(picked, state, tuning)` 吃 `derive()` 已经算好的那批分数，取前 `emotionBlendCount` 条（默认 3），先按分数归一成权重，再挤掉归一后低于 `emotionBlendWeightFrom`（默认 0.15）的那几条并重新归一，头一条一直留着。每条的 `why` 取这条标签打分里贡献最大的那一项字段，从 `CAUSE_WHY` 里挑一句，字段表 `CAUSES` 与该标签的打分式同源；`half_min` 跟着那个字段走，只有怒气、记恨、惊吓、担心、存在性恐惧与两档热度有自己那条半衰，别的给零表示回落交给漂移。`emotion_why` 由「头一条的来由，头一条里带一点后几条」拼成一句。`derive()` 只在末尾写这两个展示字段，不碰任何生理值，所以同一次 `react` 不会被扣两次。

语气那一行在 `render.ts` 的 `toneNote()`：`emotionToneEnabled` 关着或这一轮没有混合层时整行为空，提示词与没有这一层时逐字相同；开着时按混合层的条数挑一句——只有一条时话短、要停，几条掺在一起时话说得断、别把话说圆——再截到 `emotionToneMaxChars`（默认 60，至少留 20 字）。这一行只讲怎么演，情绪名、权重与来由都不出现。

算出来的量里的 `proactive_bias` 与 `post_want` 都是零到一的事实：前者从 `proactiveBiasStart` 起逐条乘系数，夹到 `biasMin` 与 `biasMax` 之间，再由 `biasUnit` 折算成零到一，所以状态文件里存的是读数而不是原始倍率；后者从 `postStart` 起乘系数后直接夹到零到一。两个数都不产出“发不发”的结论。`postLevel(facts)` 是纯函数，默认 `none`，例行与高峰同时成立给 `routine`，`public` 还要两把钥匙同时在；这一包不发任何内容。

`happiness` 与 `sadness` 是这一轮新补的两个算出来的量，公式就是“幸福”与“想哭”两个标签的多系统加权和，标签与算出来的量共用同一份说法、只算一次，两个数也进 `DERIVED_FIELDS` 落盘。`peakOf(state, tuning?)` 是纯函数：`happiness ≥ peakHappinessFrom` 且多巴胺、催产素、血清素各自过线、皮质醇不过 `peakCortisolBelow` 时给 `happy`；`sadness ≥ troughSadnessFrom` 且血清素不过 `troughSerotoninBelow`、皮质醇过 `troughCortisolFrom` 时给 `sad`；其余给 `null`。峰值只给社交动态与记忆写回一份事实，不产出该不该发。

`mortalityTarget(balanceLevel, tuning?)` 按余额四档给目标：高过 `mortalityBalanceCalm` 为零、高过 `mortalityBalanceWary` 取 `mortalityTargetWary`、高过 `mortalityBalanceLow` 取 `mortalityTargetLow`、再往下取 `mortalityTargetCrisis`，没有来源时为零。`drift` 的第五个参数就是外部余额档位：给了就按 `mortalityRisePerBeat` 与 `mortalityFallPerBeat` 每拍朝目标挪一步并夹在零到一之间，不给就一动不动，所以这一包不会自己编出一个余额。

遗书那一路：`farewellOf(state, balanceLevel, at, tuning?)` 在 `mortality > farewellMortalityFrom`（默认 0.85）且 `farewell_applied_at` 不在同一个本地零点时给出一条事实，`farewellReason` 按余额四档说一句来由（余额见底、余额快撑不住了、余额开始紧张、余额还算宽裕，来源撤回后是命数在往下走）。`farewell_applied_at` 是这一路的防重复的标记，按本地零点判一天一次，值就是产出那一刻的毫秒；心跳把标记和状态一起落盘之后才调 `onFarewell`，落盘失败不通知。这一包不写正文、不写记忆。

存在性那一路只吃三条只读事实：`uptimeMs`（这一份进程活了多久）、`restartsToday`（今天重启过几次）、`shutdownNotice`（手上有没有一条关停提示）。装配层用 `QqVitalsSeam.setExistence(facts)` 放进，给 `undefined` 表示没有来源，两个字段一律不朝目标走。`salienceTarget(facts, tuning?)` 给 `mortalitySalience` 的目标：底数 `salienceBase`、每次重启加 `saliencePerRestart`、提示在加 `salienceWhileNotice`、稳跑满 `existenceStableMs` 之后按下 `salienceByStability`，所以在默认参数下刚被重启过最显著、稳稳跑够六小时退到最低；`shutdownTarget(facts, tuning?)` 给 `shutdownDread` 的目标，重启次数抬、稳跑满一段落。两个目标都按各自的半衰期（`salienceHalfHours` 半小时、`shutdownHalfHours` 六小时）每拍挪一步，`drift` 的第六个参数就是 `ExistenceFacts`。

耦合是三条：`shutdownDread` 给 `dread` 与 `fear` 托底，`derive()` 里按 `shutdownToDread`（默认 0.8）与 `shutdownToFear`（默认 0.5）算下限并取原来值里大的那个，所以只往上托、不往下压，封顶仍是一；`mortalitySalience` 过 `suppressSalienceFrom` 时按 `suppressSalienceCalm` 与 `suppressSalienceContent` 把“安心”与“满足”两个标签的分数往下乘；`shutdownDread` 在夜里按 `shutdownNightRise` 乘夜色浓度自己涨，与 `dread` 那条共用 `nightness`。收到关停提示时 `applyShutdownNotice` 一次性抬 `shutdownNoticeGain` 并写 `shutdown_notice_at` 当防重复的标记，标记落在同一条提示上就不再抬，提示撤回后清零；它写在漂移的最小间隔判断之前，所以提示到了就算结算间隔不够一拍也照抬。

九套子系统的系数全部提成了 `Tuning` 字段：递质回归九个、HPA 轴十七个、交感与副交感八个、奖赏六个、依恋六个、饥饿十一个、水循环十九个、血糖十六个、内环境十个，加上峰值八与死亡威胁九个（含遗书那条阈值），共一百一十九个新字段。默认值一律取提取前的字面量，`tests/tuning.spec.ts` 一边核对默认值、一边用“改一个参数、看对应字段变化”的用例证明它们真的进了计算。
