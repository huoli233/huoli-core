# qq-bundle

## Summary

把 QQ 机器人的各个零件装到一起：说话规矩、每天整理、每轮步数上限。
挂上这一行，前面九个包就都起来了。

## Model Experience

### Prompt content

#### What the model sees

提示词末尾多一段说话规矩；每轮走多少步由 `maxSteps` 管，超了就停。

#### Token effect

规矩那段是固定的，几百字；步数上限防止一路空转。

#### KV Cache effect

规矩那段固定在末尾，不影响前面的缓存。

## Known Limitations and Deferred Work

- 每天整理是每小时看一眼时间，不是真正的定时器。
- 压缩只调了参数，没有换成聊天口吻的摘要。
- 十个包的数据文件各自一个，还没统一到一处。
