# qq-pacing

## Summary

说话的规矩：一段话拆成几条、条与条之间隔多久、今天还能说几句。同一句刚说过就不再发。

## Model Experience

### Prompt content

#### What the model sees

这一行不注册工具，只改发送行为；拆句结果由 `splitSpeech` 给出，提示词里看不到。

#### Token effect

拆句按字数算，不额外消耗。

#### KV Cache effect

不影响。

## Known Limitations and Deferred Work

- 额度按小时和按天各一个上限，没有按群分别设。
- 间隔是按时长估的，没考虑对方正在打字。
