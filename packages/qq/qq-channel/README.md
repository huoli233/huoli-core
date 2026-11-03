# qq-channel

## Summary

接 QQ：连上去、收消息、把要说的话发出去。收到的消息翻成入站交给注意力；要发的走说话规矩拆句再送出去。

## Model Experience

### Prompt content

#### What the model sees

两个工具 `send_message` 与 `send_reaction`。说明里讲了长话会被拆开、说完就结束这一轮。

#### Token effect

发出去的内容不留在上下文里；工具只回一个成功标志和条数。

#### KV Cache effect

不影响提示词前缀。

## Known Limitations and Deferred Work

- 只用一种连法，没做反向连接。
- 图片、语音这些只翻成占位文字，没有真的处理。
- 还没在真 QQ 号上跑过。
