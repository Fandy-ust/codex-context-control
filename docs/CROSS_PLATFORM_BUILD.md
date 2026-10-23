# 双平台构建与发布

当前整合版本共用一个版本号与业务核心，Mac 使用 SwiftUI/AppKit，Windows 使用 Electron 与原生启动器。两端界面可以不同，核心行为以 [功能一致性表](FEATURE_PARITY.md) 为准。目录与协作约定见 [开发说明](MULTIPLATFORM_DEVELOPMENT.md) 和 [CONTRIBUTING](../CONTRIBUTING.md)。

## 本地开发

```sh
npm ci
npm run check:architecture
npm run test:ci
npm run build
```

Mac 不需要下载 Electron，可改用 `npm ci --ignore-scripts`。构建前需要 Xcode 命令行工具；`npm run package:mac -- --release --use-built-panel` 生成 DMG。Windows x64 需要匹配架构的 Node 和系统 .NET Framework 编译器；`build:win` 直接输出独立 Setup.exe，`package:win:update` 另生成 OTA ZIP。

版本来自根目录 `package.json`，不要在各平台单独修改产品版本。控制接口变更后运行 `npm run generate:contracts` 并提交生成的 Swift 文件；构建会拒绝未同步的接口。

## GitHub 验证

PR、main 提交和手动 **checks** 运行以下检查，测试不能在发布时跳过：

| 环境 | 必须通过的检查 |
| --- | --- |
| Linux / Node 22 | 核心边界、协议生成、单元及服务测试 |
| macOS 26 / Node 22 | 原生编译、全部适用测试、DMG 打包和安装器校验 |
| Windows / Node 24 | 全部适用测试、EXE/ZIP 构建、UI 加载、隔离安装、同版本代码替换、跨版本升级、OTA 和卸载 |

工作流统一复用 `_build-desktop.yml`，避免独立发布脚本逐渐漏掉检查。**Build Windows and macOS** 可手动选择分支；**Package macOS** 保留旧入口，但同样要求双平台检查。

Windows 安装/更新检查使用仅提供版本查询的测试运行时，在临时目录执行，不需要登录 Codex。它们不代表真实 Codex Desktop 接入、Computer Use 或人工视觉验收已经通过。真实机器仍按 [Windows 验收表](WINDOWS_UI_CHECKLIST.md) 检查。

产物：`context-manager-macos-arm64` 包含 Mac DMG；`context-manager-windows-x64` 包含 Windows Setup.exe、OTA ZIP 及校验文件。普通用户只需要对应系统的安装文件。

## 发布

日常 main 推送和 PR 只验证。准备发布时，将根目录 `package.json` 与锁文件版本一起更新，提交到 main，再推送 `v<version>-preview.1` 标签。Actions 会自动并行构建两端、运行检查、创建草稿、上传文件，最后发布到 Releases；无需手动创建草稿。也可以手动运行 **Build Windows and macOS** 并勾选发布。

Mac 和 Windows 始终共用一个产品版本。即使只修改某个平台的 UI，也统一提升补丁号（例如 0.19.6 → 0.19.7），同时发布两端。UI 不另设公开版本号；内部 buildId 仅用于识别重编译。

用户下载一个 Mac DMG 或一个 Windows Setup.exe 即可。Windows ZIP 是 OTA 使用的更新包，不是普通用户安装的必需文件。只有两端检查都通过才发布，不覆盖已经公开的同版本 Release。

- `update.json` 保留 schema 1，供已安装的 0.18.x Mac 客户端继续升级。
- `update-v2.json` 用 schema 2 按系统和架构选择更新包。
- 生成清单时重新校验实际文件大小、哈希与文件名；不把只有一个平台的包发布为完整更新。
- 客户端自动检查，用户点击后安装；预算、缓存、语言和界面偏好保留。旧程序文件在确认未使用后回收。

发布前确认 README 两端下载入口都指向最新发布页，在 `docs/releases/<version>-summary.md` 写关键摘要，在 `docs/releases/<version>.md` 写完整说明；发布工作流内嵌摘要、链接全文。日常测试使用保留 7 天的 Actions artifacts；历史版本按[保留规则](RELEASE_POLICY.md)维护，不为每次试验编译创建公开 Release。
