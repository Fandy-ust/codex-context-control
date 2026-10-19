# 官方队列与额度保护：0.22.1 研究记录

日期：2026-10-19。只做文档与本机代码只读研究，没有操作真实聊天、删除队列或发送测试任务。

## 结论

技术上有实验接入的可能，但目前没有找到公开、稳定的“冻结整个官方待发送队列并保留全部内容”接口。0.22.1 继续使用本工具自己的队列，不会宣称已经控制官方队列。

本机桌面实现确实保留待发送消息，并支持暂停原因；因此不需要通过“删除官方队列、之后重新创建”实现暂停。要产品化，还需要验证所有窗口与客户端之间的合并、重启、恢复、错误确认及竞态。

## 公开接口能做什么

[官方 App Server 文档](https://developers.openai.com/codex/app-server) 提供 `thread/resume`、`turn/start`、`turn/interrupt` 等接口；`model/list` 返回真实模型、思考程度与输入类型。文档没有列出专门的用户消息队列暂停/恢复接口。

`turn/interrupt` 针对当前轮次。它不能单独证明某个其他前端不会紧接着提交下一条消息，因此不能把它等同于“整条官方队列已冻结”。

0.22.1 使用后台 `thread/resume` 解决必须点击聊天窗口才能发起任务的问题。只选择唯一且支持协议的接入桥；聊天忙碌时等待，明确开启时可接管当前轮次。没有强制切换用户的 Codex 页面。

## 本机桌面代码证据

只读检查的版本：`OpenAI.Codex_26.1013.4894.0_x64__2p2nqsd0c76g0/app/resources/app.asar`。

在 `.vite/build/src-DsLVGakC.js` 中发现：

- `thread-follower-set-queued-follow-ups-state`：把完整待发送状态传给拥有聊天的客户端。
- `thread-follower-remove-queued-message`、`thread-follower-clear-queued-messages`：删除操作。保护功能不应调用这两种操作。
- `thread-queued-followups-changed`：待发送状态同步。
- `acceptFromFollower`：接收队列变更，并特意保留提交结果未知的消息。
- 消息具有 `pausedReason`；收到 `turnCompleted` 且状态为 `interrupted` 时，队列协调器会给消息加暂停原因。选择下一项时会检查该字段。
- 队列还有 `requiresReplayAdmission` 和 replay admission 机制，说明自动重放是客户端协调器的职责。
- `thread-follower-interrupt-turn` 带 `expectedTurnId`；`user-stop` 还处理 thread goal 暂停。它是桌面私有 IPC，不是公开稳定的 App Server 队列 API。

这些是当前 Windows 构建中的实现细节，不构成跨版本保证；也未证明当前 macOS 构建完全相同。

参考项目 `C:/Users/20222/Documents/ChatGPT/photo/quota-monitor/desktop.mjs` 使用 Codex 桌面 IPC 发现 owner、跟随状态并中断指定轮次，验证了无需点击聊天窗口即可协作的方向。该项目没有提供一个已经验证的完整官方队列冻结契约；本次没有复制其 UI 或修改它的文件。

## 后续实验方案与验证点

1. 在唯一 owner 上读取官方队列与当前轮次；完整保留消息 ID、顺序、附件、模型设置和结果未知项。
2. 在额度软保护线到达前阻止下一条自动重放，而让当前轮次结束。需要原子或可确认的 hold 操作；覆盖整个旧快照会有丢失其他窗口新增消息的风险。
3. 硬保护线只中断精确匹配的轮次，并确认所有待发送项仍然存在且没有自动发起新轮次。
4. 恢复时只移除本工具设置的暂停，保留用户手动暂停和错误状态；重新核对额度与保留比例。
5. 验证重启、owner 转移、多窗口、并发编辑、跨平台及升级后的协议变化。

在这些验证完成前，不启用私有接口的队列状态改写，也不通过拦截所有 `turn/start` 假装冻结官方队列：那会一并阻止用户本来应当保留额度的手动输入。
