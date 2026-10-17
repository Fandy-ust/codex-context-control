# 0.19.x：一个代码库构建两个系统

整合分支：`codex/cross-platform-0.19`。包含上游 0.18.0 的账户额度与 macOS 更新，以及 Windows 0.17.4 的系统适配、设置、快捷键、动画与路径修复。产品版本统一来自根目录 `package.json`。

## 目录与复用

| 部分 | 位置 | 维护方式 |
| --- | --- | --- |
| 预算、桥接、历史、费用、额度读取及缓存 | `src/` | 两端共用业务逻辑与数据接口 |
| 路径、进程、启动登记和 IPC 差异 | `src/platform/` 及平台分派模块 | 集中适配系统差异 |
| Apple 原生界面 | `macos/` | SwiftUI/AppKit 原生控件、材质与可访问性 |
| Windows 界面 | `desktop/` | Electron 主窗口、托盘与快捷键 |
| 原生启动器与安装器 | `windows/`、`packaging/` | 各平台独立编译，使用同一份核心 |

设置统一为左下角齿轮打开的居中悬浮面板，分类顺序是「通用、全局默认、账户额度、Codex 接入、快捷键」。macOS 保留本机菜单快捷键，Windows 保留可自定义的系统全局快捷键；接入的系统登记方式也分别实现。

macOS 在支持的系统与 SDK 上采用 [Liquid Glass](https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:))，较旧系统回退到系统原生材质，并尊重降低透明度设置。不会使用网页重做 Mac 界面。

额度读取、五分钟缓存、多额度池、剩余比例和重置时间共用 `src/account-quota.mjs`。两端托盘使用逐渐空心的阶梯条及百分比；Windows 为方形托盘图标重新排布，详细周期与重置时间放在托盘菜单及设置。额度为空或过期时明确显示，不伪造为零。

## 本机构建

Windows 上：

```powershell
npm ci
npm run build:win
```

输出 `build/Context-Manager-0.19.5-windows-x64-Setup.exe` 和 SHA-256。只分发 Setup.exe 即可。更新 ZIP 通过 `npm run package:win:update` 单独生成。

Apple Silicon Mac 上：

```sh
npm ci --ignore-scripts
npm run build
npm run package -- --use-built-panel
```

输出 `build/distribution/` 下的 DMG 与校验文件。开发需要 Xcode 命令行工具。安装包仍支持 macOS 14+；实际能否编译和运行以 Mac 构建与验收结果为准。

`build` / `package` 自动选择当前操作系统。Windows 的 `build` / `build:win` 默认直接输出单文件安装 EXE；`build:win:dir` 只生成中间目录，`package:win` 重新封装已有目录，`package:win:update` 显式生成更新 ZIP。macOS 的 `build:mac` / `package:mac` 入口继续保留。

## 一次同时构建两端

推送 `codex/cross-platform-*` 整合分支，即触发 **Build Windows and macOS**，两个 job 并行构建同一份提交。也支持 `v*-desktop` 标签；工作流进入默认分支后，还可从 Actions 手动选择分支运行。构建分别上传两端安装包；Windows 安装 EXE 和更新 ZIP 分成两个 artifact，日常只下载 `context-manager-windows-x64`。不自动发布 Release。`run_tests` 默认关闭，只有手动勾选时才在这个构建工作流运行回归；常规检查仍保留在主分支、PR 和手动检查工作流中。

macOS job 使用官方 [macos-26 Apple Silicon runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) 来获得现代 Apple SDK。Windows 本机无法直接调用 Apple 原生编译器，因此「同时构建」由两个操作系统的 runner 配合完成，不代表在 Windows 内交叉编译 SwiftUI。

本轮已获使用者授权，完成后推送整合分支并触发双平台编译；不直接覆盖朋友的 `main`，不自动发布 Release。按使用者要求不运行测试；最终分别记录两端的实际编译结果，不能把工作流配置等同于已生成 Mac 安装包。

## 后续更新

继续在同一代码库合并上游：先保存当前修改，再合并朋友的新提交，解决共享接口差异，分别适配界面。不要用上游整个目录覆盖 Windows 分支。每次正式构建记录产品版本、源提交及平台；只修改某个平台时也保留另一端的构建入口。

## 0.19.1 操作统一

- 以 Apple 端为基准，统一两端整体的操作顺序、命名、状态反馈和主要快捷操作，减少切换系统时的学习成本。
- 保留本轮设置面板的分类与悬浮形式，以及主页面左侧留出更多聊天空间的布局。
- Windows 向 Apple 的行为靠拢；macOS 继续使用原生 SwiftUI/AppKit、Liquid Glass、系统材质和可访问性，不把原生 UI 改成网页，也不移除平台渲染特性。
- 0.19.0 已交付。0.19.1 的实现范围及 Apple/Windows 行为对照见 [UI 操作统一](UI_PARITY.md)。
