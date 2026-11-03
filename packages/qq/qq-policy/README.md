# qq-policy

## Summary

全仓唯一的一张表：半衰期、松弛常数、记忆保留度、清晰度五档。谁要淡忘，都来这里取参数，不许自己写。

## Model Experience

### Prompt content

#### What the model sees

这一行不注册任何工具；`HALF_LIFE_MS` 与 `TAU_MS` 两张表供别的包读，不往提示词里写东西。

#### Token effect

没有额外消耗。

#### KV Cache effect

不影响。

## Known Limitations and Deferred Work

- 表里的数值是估的，还没有真实使用数据校准。
- 只覆盖单机单进程场景。
