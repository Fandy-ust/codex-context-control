# 接入故障排查 / Connection troubleshooting

“看到聊天和上下文统计”不等于该聊天已被实时接入；历史数据可以来自本机缓存。先核对管理器版本、聊天的接入状态和最近请求时间。

## 检测到多个接入进程

同一个聊天登记在多个接入进程中时，管理器会保护性禁用上下文修改。可能是两个客户端真实同时加载，也可能是升级前的旧进程仍存活。

先等任务结束，再完整退出旧客户端并重开。0.26.3 为两端共用的接入核心加入退出清理，但已经运行在内存中的旧版本不会自动获得这段修复。如果仍冲突，应根据运行路径、版本和父进程检查残留，而不是反复安装。关闭管理器窗口只会隐藏界面，不会结束 Codex 的工作进程。

## 等待聊天接入或窗口信息

在 Codex 中进入该聊天。若刚切换上下文拓展，需重新启动客户端以加载对应的模型目录。只有显示“窗口已确认”后，才能把读回值视为这次设置已生效；“已保存”“等待下一轮确认”和“连接正常”是不同状态。

## 更新后暂时使用原生启动（0.26.6）

运行时变化后，管理器先在隔离目录验证启动握手及自己的配置覆盖；失败时保留设置，本次原生启动不启用增强。查看 `context-manager doctor` 的 `runtimeCompatibility` 和接入日志中的 `wrapper.runtime_checked`。失败记录冷却 60 秒，之后下次启动再验证；运行时或管理器版本变化会重新验证。该记录只代表最近一次检查，实际接入仍以当前聊天状态为准。

`--print-startup-config`、proxy 和未知启动命令直接交给原生 CLI，不代表整体接入失败。已经发送的聊天或队列任务不会为了恢复增强而自动重复执行。安排重启前先结束正在进行的任务。

## English

From 0.26.6, changed runtimes are checked in an isolated home before enhancements start. Failed checks preserve preferences and use native startup, with a 60-second retry cooldown. Inspect `runtimeCompatibility` in `context-manager doctor` and `wrapper.runtime_checked` in integration logs. Startup-policy reads and unknown command shapes pass through normally. Requests are never replayed to recover enhancements.

Cached history can remain visible while a chat has no unique live connection. A multiple-process warning can mean two active clients or an old runtime left behind by an earlier version. After work finishes, fully quit the old client and reopen it. Version 0.26.3 cleans up runtimes that it owns when the client disconnects, but already-running older processes retain their old behavior. Inspect process versions, paths and parent processes if the conflict remains. Closing the manager window only hides its interface.
