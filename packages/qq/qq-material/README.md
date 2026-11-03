# qq-material

## Summary

素材：群里在聊什么、在跟谁说话、有人没接的话、心里惦记着的事。惦记的事由模型自己写、自己删，放久了自动过期。

## Model Experience

### Prompt content

#### What the model sees

两个工具 `write_thought` 与 `drop_thought`。素材本身由上层拼进提示词。

#### Token effect

每条惦记的事最多两百字，同时最多留五十条。

#### KV Cache effect

素材进提示词的话会随内容变化，可能让前缀缓存失效。

## Known Limitations and Deferred Work

- 话题和提问只取最近一条像样的句子，没有真正的话题切分。
- 惦记的事不跟记忆打通，说过以后要手动删。
