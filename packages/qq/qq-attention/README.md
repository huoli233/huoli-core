# qq-attention

## Summary

一个群里的注意力：看消息、等消息、划走、收尾、设唤醒，五个动作。
状态存在自己的文件里，重启不丢。工具只读事实、只发事件，不替模型决定要不要说话。

## Model Experience

### Prompt content

#### What the model sees

五个工具 `read_messages`、`wait_for_messages`、`mark_read`、`close_conversation`、`set_wake_config` 的名称与参数；工具返回的消息列表、读水位、等待结果、收尾确认。

#### Token effect

每次调用只把要看的那些消息带进上下文，条数有上限；等待结果只带回新到的消息。

#### KV Cache effect

不影响提示词前缀，工具调用与结果是追加的。

## Known Limitations and Deferred Work

- 状态存在自己的文件里，还没接进会话日志。
- 消息缓冲只在内存里，重启后要从会话记录重新灌。
- 还没在真 QQ 号上跑过。
