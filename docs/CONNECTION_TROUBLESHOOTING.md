# 接入故障排查 / Connection troubleshooting

“看到聊天和上下文统计”不等于该聊天已被实时接入；历史数据可以来自本机缓存。先核对管理器版本、聊天的接入状态和最近请求时间。

## 检测到多个接入进程

同一个聊天登记在多个接入进程中时，管理器会保护性禁用上下文修改。可能是两个客户端真实同时加载，也可能是升级前的旧进程仍存活。

先等任务结束，再完整退出旧客户端并重开。0.26.3 为两端共用的接入核心加入退出清理，但已经运行在内存中的旧版本不会自动获得这段修复。如果仍冲突，应根据运行路径、版本和父进程检查残留，而不是反复安装。关闭管理器窗口只会隐藏界面，不会结束 Codex 的工作进程。

## 等待聊天接入或窗口信息

在 Codex 中进入该聊天。若刚切换上下文拓展，需重新启动客户端以加载对应的模型目录。只有显示“窗口已确认”后，才能把读回值视为这次设置已生效；“已保存”“等待下一轮确认”和“连接正常”是不同状态。

## English

Cached history can remain visible while a chat has no unique live connection. A multiple-process warning can mean two active clients or an old runtime left behind by an earlier version. After work finishes, fully quit the old client and reopen it. Version 0.26.3 cleans up runtimes that it owns when the client disconnects, but already-running older processes retain their old behavior. Inspect process versions, paths and parent processes if the conflict remains. Closing the manager window only hides its interface.
