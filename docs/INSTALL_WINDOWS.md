# Windows 安装与开发

当前分支提供 Windows 11 x64 本地预览版，产品基线为 0.17.2。包含独立 Node、Electron 界面、原生启动器和所需依赖；使用者不需要安装 Node 或开发工具。此预览包未做发布者代码签名，也尚未发布到 GitHub Releases。

## 安装

1. 下载 `Context-Manager-0.17.2-windows-x64-Setup.exe`，只需要这一个文件，不需要旁边放 `payload/`。
2. 双击 `Setup.exe`，选择「安装 / 更新」。安装器先校验并解压内置程序，再安装到当前用户；完成后自动清理临时解压目录，不需要修改 Codex 安装文件。安装成功后可以删除下载的 EXE。
3. 当前工作结束后，**完整退出并重新打开 Codex**。已经运行的桌面进程不会因为安装完成就自动更换运行时。
4. 在右下角系统托盘点击圆环图标。Windows 可能把它收在 `^` 折叠区，可在系统任务栏设置中选择显示。
5. 进入聊天，观察连接状态与实际用量。需要 Hook stats 时，在 Codex 自己的 `/hooks` 中审核本项目新增的 Hook。

首次激活时，若正常重开仍未读到新的用户环境，退出并重新登录 Windows 后再打开。诊断中应区分用户环境已登记、桥接已连接和下一轮窗口已确认；这些不是同一个状态。

安装器创建用户级 `CODEX_CLI_PATH` 登记、开始菜单入口和卸载信息。已有其他自定义 `CODEX_CLI_PATH` 时会保留并报告冲突。它追加自己的 Stop hook，不修改其他 hooks，也不代写信任记录。

也保留 ZIP 分发格式，供更新器与开发调试使用。选择 ZIP 时需完整解压并保留 `Install Context Manager.exe` 与同级 `payload/`；单文件 `Setup.exe` 已将这些程序文件内置，无需额外解压。

## 使用

左键托盘打开紧凑聊天概览，右键打开主窗口或退出管理界面。悬停聊天行可直接调整容量；拖动不保存，点击应用才提交。移出行、取消或关闭小面板会丢弃草稿。

主窗口提供双滑块、1K 微调、容量/比例预设、预检、逐聊天应用、停止自动应用、原生压缩、全局默认、上下文拓展和统计图。关闭主窗口保留托盘；退出管理界面不会结束 Codex 或正在生成的请求。

在侧栏或托盘右键菜单打开「设置」，可自定义唤起主窗口的全局快捷键，默认 **Ctrl + Shift + M**。支持录制按键、直接输入、恢复默认和禁用；组合被其他程序占用时会提示，并保留原来可用的快捷键。管理器驻留托盘时生效，完全退出后不再响应。快捷键偏好单独保存在数据目录的 `ui-settings.json`，更新时保留。

「合成数据预览」只显示三个示例聊天，不代表聊天数量限制。正常使用运行 `npm run dev:win`（不带 `--demo`），或在预览顶部点击「查看真实聊天」。预览与本地模式使用独立偏好；切换到真实模式后再保存日常使用的快捷键。

实际窗口和草稿分开显示。生成中的预算调整等待轮次结束，之后还需一次正常请求读回才能确认。新聊天使用全局默认，fork 继承父聊天预算。上下文拓展开关沿用当前上游实现；920K 不代表所有模型服务端都保证接受相同容量。

## 安装目录

| 内容 | 默认目录 |
| --- | --- |
| 不可变程序版本 | `%LOCALAPPDATA%\Programs\ContextManager\versions\<version>-<hash>` |
| 预算、缓存、偏好与诊断 | `%LOCALAPPDATA%\CodexContextControl` |
| 原生启动器及配置 | 数据目录的 `bin\<hash>\` |
| Codex 数据 | 沿用 `CODEX_HOME`；默认 `%USERPROFILE%\.codex` |

支持现有 `CONTEXT_CONTROL_HOME`、`CONTEXT_CONTROL_CODEX_HOME`、`CONTEXT_CONTROL_REAL_CODEX` 覆盖。`CONTEXT_CONTROL_APPLICATIONS` 可覆盖程序安装目录，主要用于隔离测试。

数据目录使用当前用户/SYSTEM 的 Windows ACL。本地管道进行双向随机挑战认证；UI 的后端请求由 Electron 主进程发出，凭据不传给 renderer。

## 更新与卸载

「检查更新」只选择 Windows 当前架构的包；上游只有 macOS 包时不会下载它。安装更新需要用户点击，下载后检查字节数、SHA-256、版本、架构和完整文件清单。

在「设置 → 应用」或原安装器中卸载。卸载只撤销自己的环境登记和 Hook，保留预算、缓存、偏好与备份。仍有 Codex 进程或桥接使用程序时，保留对应文件；完整退出 Codex 后可再次执行卸载以清理。卸载后残留进程若仍继承旧入口，新调用只透传原版运行时。

直接运行新版 `Setup.exe` 即可更新，无需先卸载。开始菜单和管理器入口切到新版，预算、快捷键与其他偏好保留。程序按不可变目录安装，升级前保留一份轻量配置快照；升级时目前不自动删除旧版目录，以免影响仍在使用的桥接。不要手动删除正在使用的版本目录；回退时同样使用安装器并核对数据 schema。

## 从源码构建

需要 Windows 11 x64、Node 22.13+（本机测试为 24.18.0）以及系统自带的 .NET Framework C# 编译器。需要与目标架构匹配的 Node/Electron。构建会取得当前 Node 对应的 LICENSE，并缓存在 `build/licenses/`。

```powershell
npm ci
npm test
npm run build:win
npm run package:win
```

`build:win` 输出 `build/Context-Manager-0.17.2-windows-x64/`。`package:win` 输出独立的 `build/Context-Manager-0.17.2-windows-x64-Setup.exe`、同名 `.sha256`，以及更新器使用的 ZIP 和校验文件。分发给使用者时只需发送 `Setup.exe`。构建包含应用图标和版本信息，沿用已有品牌源图。

单文件安装器使用系统 .NET Framework 的[程序集内置资源](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/resources)封装压缩包，运行时通过[资源流](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.assembly.getmanifestresourcestream)读取。解压前验证 SHA-256，解压时拒绝越界路径和符号链接；内部仍复用同一套安装/升级脚本。

```powershell
# 使用合成状态查看 UI；不登记接入，不修改真实预算
npm run dev:win -- --demo

# 隐藏窗口加载检查，不代替视觉验收
npm run test:win:ui-smoke

# 构建后，在隔离目录检查安装/跨版本服务替换/卸载
node scripts/test-win-package.mjs

# 只复制一个 EXE 到中文/空格目录，验证解压、重复安装、跨版本升级、卸载和临时文件清理
npm run test:win:setup

# 打 ZIP 后，用本地模拟下载检查更新全流程和坏包拒绝
node scripts/test-win-update.mjs
```

运行真实 Windows 内核的本地集成测试时，显式设置 `CONTEXT_CONTROL_TEST_CODEX` 为目标 `codex.exe` 后执行 `npm test`。测试使用隔离 Codex home 和回环模拟模型服务，不使用真实模型额度。

ARM64 产物需要在相应环境单独构建验证；WSL、远程宿主和 macOS 原生编译不属于本次 Windows x64 本机验证结果。完整证据见 [兼容性记录](WINDOWS_COMPATIBILITY.md)。UI 人工验收见 [Windows UI 检查清单](WINDOWS_UI_CHECKLIST.md)。
