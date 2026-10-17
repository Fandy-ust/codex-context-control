# Context Manager

[English](README.md) | **简体中文**

<img src="macos/Assets/ContextManager.png" width="112" alt="Context Manager 图标">

macOS 菜单栏里的 Codex 上下文管理器：按聊天调整预算，查看用量、缓存与费用估算。

**0.16.0 · Apple Silicon · macOS 14+ · 测试版**

## 演示视频

https://github.com/user-attachments/assets/412c24ac-a4cc-4220-92f8-7ad2291558b5

[下载 1080p 演示视频（MP4，约 175 MB）](https://github.com/Fandy-ust/codex-context-control/releases/download/demo-2026-10-17/context-manager-demo-1080p.mp4) · [演示发布页](https://github.com/Fandy-ust/codex-context-control/releases/tag/demo-2026-10-17)

1920 × 1080 · 4 分 27 秒，展示菜单栏控制与上下文管理操作。[观看英文演示](README.md#demo)。

## 下载与安装

[GitHub Releases / 测试包](https://github.com/Fandy-ust/codex-context-control/releases) · [完整安装指南](docs/INSTALL_MAC.md) · [更新记录](CHANGELOG.md)

**[下载 0.16.0 中英版 · Apple Silicon（ZIP，约 49 MB）](https://github.com/Fandy-ust/codex-context-control/releases/download/v0.16.0-preview.1/Context-Manager-0.16.0-macos-arm64.zip)** · [版本说明](https://github.com/Fandy-ust/codex-context-control/releases/tag/v0.16.0-preview.1)

仓库与中英版预览安装包均已公开，可直接下载。演示视频在单独的发布页；安装 App 请使用上方链接。

1. 获取 `Context-Manager-0.16.0-macos-arm64.zip` 并解压。
2. 打开 **Install Context Manager.app**，点击「安装 / 更新」。
3. 首次安装后完整退出并重开 Codex；菜单栏出现圆环图标。
4. 点击圆环即可查看聊天或打开主窗口。Hook stats 可另外在 Codex 的 `/hooks` 中审核启用。

无需安装 Node、npm、Homebrew 或 Xcode。需要事先安装 Codex / ChatGPT 桌面客户端；目前完整验证的 Codex 运行时是 **0.160.0**。

测试包尚未使用 Developer ID 签名与 Apple 公证。确认来源后，按 macOS「隐私与安全」提示允许打开；使用者无需购买开发者会员。[系统提示与兼容性](docs/INSTALL_MAC.md)

## 语言

App 和安装器内可选择「自动（按时区）／中文／English」，切换立即生效并保存。自动模式对中国大陆、香港、澳门、台湾的时区使用中文，其他时区使用英文。按时区名称判断，不把所有 UTC+8 地区都当作中文。手动选择优先，预算和聊天名称不随语言改变。

## 功能

- **逐聊天预算**：1K 精度，区分实际读回值与待应用目标。
- **全局默认**：新聊天沿用设置；fork 继承父聊天，已有聊天独立保存。
- **可选上下文拓展**：最高 920K，最晚 904K 压缩；关闭则遵守原生上限。
- **上下文详情**：输入、缓存、费用估算、响应速度与压缩事件，共享图表时间轴。
- **流畅交互**：后台聚合、缓存复用、鼠标事件合并；悬停时延后刷新。
- **聊天概览**：运行中优先，其余按真实活动时间排列，保留最近完成的聊天。
- **可选提前压缩修复**：独立开关及额外运行时下载，不占主安装包体积。

新安装默认关闭拓展；升级保留预算与开关。920K 是本地控制上限，并非所有服务端模型的容量保证。切换已运行的核心模式后需重开 Codex。

## 更新与卸载

运行新版安装器，选择「安装 / 更新」。安装器会替换并重启菜单栏应用；桥接更新需要重开 Codex。预算、开关与备份保留。下载的安装器可以删除。

卸载：再次打开安装器，选择「移除安装」。预算与备份保留。

## 文档

| 使用 | 开发与维护 |
| --- | --- |
| [安装与更新](docs/INSTALL_MAC.md) | [开发指南](docs/DEVELOPMENT.md) |
| [详细功能](docs/FEATURES.md) | [架构](docs/ARCHITECTURE.md) |
| [上下文拓展](docs/CONTEXT_EXTENSION.md) | [打包与发布](docs/RELEASING.md) |
| [隐私](docs/PRIVACY.md) | [图标维护](macos/Assets/README.md) |
| [图表与性能](docs/CHART-PERFORMANCE.md) | [性能调度](docs/PERFORMANCE.md) |
| [更新记录](CHANGELOG.md) | [压力测试与修复](docs/STRESS_TEST_2026-10-17.md) |

## 本地开发

开发需要 Node.js 22.13+ 与 Apple Command Line Tools。

```sh
npm ci --ignore-scripts
npm test
npm run build:mac
npm run install:local
```

打包：提交变更并保持工作树干净，运行 `npm run package:mac -- --release`。GitHub Actions 的 **macOS installer** 工作流也可构建并验证安装包；它不会自动发布 Release。

安装包包含固定版本、校验过的 Node 及生产依赖，不包含账号凭据、聊天记录、个人配置或大型修复核心。

这是独立工具，与 OpenAI 无隶属关系。项目使用 [MIT 许可证](LICENSE)，允许使用、修改、商用与分发，按许可保留版权及许可声明；[第三方组件](THIRD_PARTY_NOTICES.md)按各自许可证提供。
