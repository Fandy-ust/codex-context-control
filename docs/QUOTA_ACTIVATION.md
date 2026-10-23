# 额度启动与重置通知 / Quota activation and reset notifications

从「设置 → 额度启动」配置。这些功能使用现有 Codex 账户与额度；管理器需要保持在托盘／菜单栏运行。

## 系统通知

“额度重置系统通知”默认开启，独立于自动发消息。确认 5 小时额度重置、每周额度重置时分别提醒；约 20 秒内相邻的两个重置合并成一条。首次读取、切换账户及只有倒计时归零不算重置证据；已通知事件会去重。

Mac 首次需允许系统通知；Windows 使用普通安装版的开始菜单身份。系统专注／勿扰模式可能不显示横幅。

## 自动探测与预约

周重置后的自动启动默认关闭。开启后使用独立的 GPT-6 Luna 短对话，要求只回复 OK，收到回复即停止；每次最多尝试 3 次。该操作使用账户额度。以新到期时间接近探测时刻 + 7 天确认周启动；手动或预约启动检查 + 5 小时，默认容差为 10 分钟。

一次性预约使用本机日期和时间；不会自动唤醒电脑。电脑需保持唤醒、服务需运行；错过超过 15 分钟的预约不会补发。通过“停止并取消预约”结束待执行任务。服务异常中断后的不确定发送不会自动重放。

## 提前量建议

根据当前账户近 21 天、最多 10 个有足够用量的周期估算：提前量 = 5 小时 − 活跃使用耗尽时间。至少有 3 个有效周期才显示建议，排除长时间未观测的间隔。只建议起床前提前多久，不猜测你的作息；例如估计 3 小时用完，则建议提前约 2 小时，再由你填写预约时间。

这是历史估算，模型、任务和空闲时间都会影响实际消耗。

## English

Open **Settings → Quota activation**. Native reset reminders are enabled by default and do not require automatic messages. They distinguish 5-hour, weekly and combined resets; allow system notifications and keep the manager running.

Automatic weekly activation is opt-in. It sends an isolated GPT-6 Luna “OK” probe, stops on the first response and attempts at most three times. One-time schedules use local computer time, require an awake computer and skip runs missed by more than fifteen minutes. The wake-up recommendation uses recent account-specific usage to suggest a relative lead time, not a fixed clock time.
