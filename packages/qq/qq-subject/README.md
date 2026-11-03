# qq-subject

## Summary

自己的状态：心情、精力、无聊、想说话，加上跟谁熟不熟。每轮写成一小段话放进提示词，最多三百字。

## Model Experience

### Prompt content

#### What the model sees

提示词里多一段 `{{qq_self}}`，写清心情、精力、无聊、想说话，以及跟当前这个人的熟悉度。

#### Token effect

固定占一小段，最多三百字，不随聊天变长。

#### KV Cache effect

这段内容每轮都可能变，会让前缀缓存失效。

## Known Limitations and Deferred Work

- 提示词那边拿不到当前会话，只能按“最近说话的那个群”来写。
- 状态改变只有粗粒度加减，没有按事件类型细分。
