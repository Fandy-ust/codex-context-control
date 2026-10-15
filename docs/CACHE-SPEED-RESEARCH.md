# 缓存低谷与生成速度突增核查

核查日期：2026-10-16，时区 Asia/Hong_Kong。对象是截图中第 164 次响应，完成于 03:12:03.023。

## 原始本地记录核对

| 响应 | 输入 tokens | 缓存读取 tokens | 输出 tokens | 生成用时 | 生成前间隔（记录估算） | 生成速度 |
|---|---:|---:|---:|---:|---:|---:|
| 163 | 337,873 | 336,256 | 810 | 19.045s | 1.972s | 42.53 tokens/s |
| 164 | 342,016 | 0 | 502 | 5.027s | 7.628s | 99.86 tokens/s |
| 165 | 342,671 | 341,888 | 557 | 7.304s | 1.836s | 76.26 tokens/s |

第 164 次 `token_usage_record` 明确包含 `cached_input_tokens: 0`；随后的 `token_count.last_token_usage` 也为零。不是我们的统计器用缺失值补出的零，不是把隔离测试会话混入主聊天，也没有观察到本地配置模型或服务档位切换。全段配置为 GPT-6 Astra / priority。后续速度持续较高，但这些日志不能解释后端硬件、路由、负载或最终服务档位的变化。

该次第一条生成项目的运行时开始时间为 03:11:57.996，用量记录时间为 03:12:03.023，因此 502 / 5.027 = 99.86。最近一条输入历史记录在 03:11:50.368，两者之间有 7.628 秒。若仅为对照把这一段也算进去，502 / 12.655 ≈ 39.67 tokens/s；上一请求相同算法是 810 / 21.017 ≈ 38.54。不能把原图的 99.86 理解为整个请求快了两倍。

“生成前间隔”并非服务器 TTFT：本地日志没有 HTTP 请求发送时间，它包含客户端准备、调度等时间。此处只按最近非生成输入项目的记录时间到首个生成项目开始作对照，不能冒充准确的排队、prefill 或首 token 延迟。

## 零值能否证明真实缓存完全未命中

不能。用本机 Codex 0.160.0 连接本地模拟 Responses 服务，实测如下：

| 原始响应 | 原始用量通知 | 规范化日志 |
|---|---|---|
| 不提供 input_tokens_details | 明确缺失 | cached_input_tokens = 0 |
| 明确提供 cached_tokens = 0 | 明确为零 | cached_input_tokens = 0 |
| 明确提供 cached_tokens = 40 | 明确为 40 | cached_input_tokens = 40 |

[对照记录](cache-read-probe.json)。复现：`node scripts/probe-cache-writes.mjs --read`，只调用本机模拟服务，不消耗模型额度。

源码中的 `input_tokens_details.unwrap_or_default()` 会将缺失详情块转换为默认零值。那次历史聊天没有保留 `rawResponse/completed.usageMetadata.metadata`，所以两种来源无法事后区分。这与之前“写入”字段的真实登录实验是不同字段、不同请求，不能拿之前的结果证明这次缓存读取零值可靠。

## 修正

- 图表明确命名“生成速度”，而非包含输入处理等待的端到端响应速度。
- 详情提供生成用时、生成前间隔估算，保留原始数值，不人工平滑或删除低谷。
- 缺失、非法缓存计数用 null，不转零；缺失区间断线。
- 本地日志零值用橙色空心点标记；详情说明原始响应未核实，不将它视为已证实的缓存清空。
- 时间戳反序或生成项目完成晚于用量记录时，不计算速度。

[官方缓存说明](https://developers.openai.com/api/docs/guides/prompt-caching)说明缓存减少响应开始前的输入处理时间；缓存命中与生成阶段的 tokens/s 不能直接互相推导。缓存实例路由、前缀变化等都是可能影响因素，但本次历史数据不足以锁定原因。

## 判断下一次复用的是新缓存还是旧缓存

第 165 次的缓存读取 / 第 164 次的输入 = 341,888 / 342,016 ≈ 99.96%，同时生成前间隔从 7.628 秒降到 1.836 秒。这个组合支持“未命中后恢复复用”的解释，但不是缓存对象身份的证明。缓存常常是旧前缀复用加新后缀计算，并非全写与全读二选一。请求路由、缓存键的计量范围、后台负载和旧前缀可用性也会改变观测值。

官方 [Prompt cache diagnostics](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics) 允许设置 `prompt_cache_options.comparison_response_id`，对照前一响应读取 `prompt_cache_diagnostics`。它可报告 cache_hit/cache_miss、模型/工具/服务档位/缓存键等差异，以及预计未复用 token 数。该诊断比较不改变缓存行为，也允许复用其他请求的缓存，因此不能作为“缓存来自某个唯一请求”的证明。尤其 `prompt_cache_key_changed` 可以造成 usage 计量未命中而不发生物理未命中。

核对 Codex 0.160.0 的 `ResponsesApiRequest`：有 prompt_cache_key，但没有 prompt_cache_options/comparison_response_id 字段；当前本地统计链路并未启用官方比较诊断。诊断需要随请求发送，且服务端诊断记录会过期，不能在本机事后补出这次历史请求的精确失效原因。对具体缓存身份作断言需要更多服务端证据，不能只靠 token/s。
