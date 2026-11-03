# qq-continuity

## Summary

收尾与回想：这段收在哪、下次怎么接、事后觉得聊得怎么样。
收尾不是潜水，被叫到还会醒。

## Model Experience

### Prompt content

#### What the model sees

一个工具 `note_reflection`。收尾留的话由上层读出来放进提示词。

#### Token effect

每次最多读回几条回想，每条三百字以内。

#### KV Cache effect

回想进提示词的话会让前缀变化。

## Known Limitations and Deferred Work

- 收尾只留一句话，不留整段摘要。
- 事后的回想还没有喂回提示词。
