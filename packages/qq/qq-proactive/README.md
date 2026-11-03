# qq-proactive

## Summary

主动开口：先攒理由、再打分、再过闸门，最后先给人看再发。
默认是关的。开了以后夜里也不吵人。

## Model Experience

### Prompt content

#### What the model sees

这一行不注册工具；攒住的想说话可以用 `preview` 先看，再由上层决定要不要放进提示词。

#### Token effect

每条攒住的只说一句，最多带一条进上下文。

#### KV Cache effect

不影响。

## Known Limitations and Deferred Work

- 打分还是几个乘数的组合，没有让模型参与排序。
- 闸门里的间隔是随机区间，不是按对方活跃程度自适应。
- 还没接真 QQ 试过。
