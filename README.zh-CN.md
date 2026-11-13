# Context Manager

Context Manager 是 Codex 桌面客户端的本地辅助工具，支持 macOS 和 Windows。可以为每个聊天设置上下文预算、查看用量与额度，并按 5 小时和每周额度窗口安排任务队列。

[English](README.md)

## 安装或更新

先安装 Codex 桌面客户端，再从[最新发布页](https://github.com/Fandy-ust/codex-context-control/releases/latest)下载对应的安装包。

| 平台 | 安装方式 | 系统要求 |
| --- | --- | --- |
| macOS | 打开 DMG，运行 **Install Context Manager.app** | Apple Silicon · macOS 14+ |
| Windows | 运行 **Setup.exe** | Windows 11 · x64 |

安装或更新后完整退出并重开 Codex，再从 Mac 菜单栏或 Windows 系统托盘打开 Context Manager。Windows 手动安装请用 Setup.exe；发布页的 ZIP 用于自动更新。

[Mac 安装说明](docs/INSTALL_MAC.md) · [Windows 安装说明](docs/INSTALL_WINDOWS.md) · [变更记录](CHANGELOG.md) · [历史安装包](docs/releases/archive/index.md)

## 功能

- **上下文：**为每个聊天设置可用窗口和压缩阈值，也可设置新聊天默认值。可选的上下文拓展最高提供 920K 本地预算，切换后需重开 Codex。实际模型容量和压缩时机仍取决于运行时。[压缩与计量说明](docs/COMPACTION_COMPENSATION.md)
- **额度和队列：**查看剩余额度、Credits 与重置时间，安排任务并配置重置通知。额度显示复用已连接客户端的观测。[额度分析](docs/QUOTA_ANALYTICS.md)
- **用量：**查看上下文、缓存 token、费用估算和实测响应速度。[使用指南](docs/FEATURES.md) · [可选加密同步](docs/CLOUD_SYNC.md)

https://github.com/user-attachments/assets/412c24ac-a4cc-4220-92f8-7ad2291558b5

## CLI、Skill 和项目策略

[Context Manager CLI](docs/CLI.md) 与桌面面板共用本地服务。用 `context-manager chat show current --summary` 查看当前聊天的状态摘要。预算变更在安全的回合边界应用，主动请求的原生压缩等聊天空闲后执行。

可以在项目根目录的 `AGENTS.md` 自行定义上下文策略：哪些证据要保留、何时看余量、何时扩容或压缩，以及怎么验收任务。策略指导 Agent 做决策；CLI 提供读数并执行支持的操作。[配套 Skill](skills/context-manager/SKILL.md) 可选，见[安装说明](docs/CLI.md#配套-skill)。

按需查询，复用仍然有效的读数。CLI 向本地服务发请求；桌面服务还会在后台处理额度、队列和聊天元数据。详见[运行与资源验收](docs/RUNTIME-VALIDATION.md)和[接入故障排查](docs/CONNECTION_TROUBLESHOOTING.md)。

[构建与发布](docs/CROSS_PLATFORM_BUILD.md) · [参与协作](CONTRIBUTING.md) · [隐私](docs/PRIVACY.md) · [MIT 许可](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md)

独立项目，与 OpenAI 无隶属关系。
