# qq-memory

## Summary

记事情：刚发生、这段经历、长期印象、私下的事，四层。
会慢慢变淡，一次只降一档，淡到底就把正文清掉，只留个记录。被找出来会重新变清楚。

## Model Experience

### Prompt content

#### What the model sees

两个工具 `memory_append` 与 `memory_query`。找的时候返回日期、内容、还有多清楚。

#### Token effect

只把找到的那几条带进上下文，条数有上限，可以不填关键词。

#### KV Cache effect

不影响提示词前缀。

## Known Limitations and Deferred Work

- 找记忆只按字面重合和重要度排，没有向量检索。
- 全部记忆装在一个文件里，条数多了要换存储。
- 重要度只在写入时算一次，之后不会自动重评。
