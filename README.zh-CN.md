# Context Manager

在 **Mac 菜单栏 / Windows 系统托盘**管理 Codex 聊天的上下文与账户额度，最高 **920K**。

## 下载

| 平台 | 安装包 | 系统要求 |
| --- | --- | --- |
| macOS | [下载 0.20.0 · DMG](https://github.com/Fandy-ust/codex-context-control/releases/download/v0.20.0-preview.1/Context-Manager-0.20.0-macos-arm64.dmg) | Apple Silicon · macOS 14+ |
| Windows | [下载 0.20.0 · Setup.exe](https://github.com/Fandy-ust/codex-context-control/releases/download/v0.20.0-preview.1/Context-Manager-0.20.0-windows-x64-Setup.exe) | Windows 11 · x64 |

[Mac 安装说明](docs/INSTALL_MAC.md) · [Windows 安装说明](docs/INSTALL_WINDOWS.md) · [版本说明](https://github.com/Fandy-ust/codex-context-control/releases/latest) · [English](README.md)

### 安装

先安装 Codex 桌面客户端，再安装对应平台的 Context Manager。

- **Mac**：打开 DMG，运行 **Install Context Manager.app**，点击「安装 / 更新」。
- **Windows**：下载并运行 **Setup.exe**，选择「安装 / 更新」，无需解压或安装开发工具。

安装完成后完整退出并重开 Codex，点击菜单栏或系统托盘的额度图标。开启「上下文拓展」可用最高 920K，切换后需重开 Codex。

## 演示视频

https://github.com/user-attachments/assets/412c24ac-a4cc-4220-92f8-7ad2291558b5

## 功能

- **逐聊天预算**：调整上下文窗口和压缩阈值，新聊天可设默认值，分支继承父聊天预算。
- **账户额度**：显示剩余额度与重置时间，Mac 使用逐渐空心的闪电图标，Windows 适配系统托盘。
- **Credits**：侧栏余额与本机进度基准，悬停查看完整数额，可在额度设置中手动重置基准。
- **主控制面板**：两端从侧栏顶部齿轮打开设置，统一栏目和操作顺序。
- **额度分析**：Weekly 曲线、5h 贡献、Token／额度关系、效率和热力图；更多分析按趋势、换算和窗口明细展开。
- **本地缓存**：启动即显示聊天和最近用量，后台增量同步。
- **项目侧栏**：上方展开本机项目及聊天，下方「最近」实时显示全部聊天；显示项目名与接入状态，独立滚动并记住展开状态。
- **在线更新**：自动检查，点击后安装并保留预算和偏好；Windows 支持启动提示、本次跳过和自动检查开关。
- **用量统计**：查看上下文、缓存、费用估算和响应速度。

两端共用业务核心，不设 app／版本白名单，保留 Codex 官方运行时。

提前压缩修复因修改核心、缺少官方签名而影响 Computer Use，现已停用。**920K 无需修改核心，继续保留。**

[额度分析说明](docs/QUOTA_ANALYTICS.md) · [使用指南](docs/FEATURES.md) · [跨平台开发](docs/MULTIPLATFORM_DEVELOPMENT.md) · [构建与发布](docs/CROSS_PLATFORM_BUILD.md) · [参与协作](CONTRIBUTING.md) · [隐私](docs/PRIVACY.md)

[MIT 许可](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md) · 独立项目，与 OpenAI 无隶属关系。
