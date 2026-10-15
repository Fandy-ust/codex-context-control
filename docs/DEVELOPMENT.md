# 开发、测试与发布

## 目录

```
macos/ContextControl.swift  原生界面
macos/BudgetMath.swift      原生输入解析、可用窗口反算与压缩比例
src/bridge.mjs             JSON-RPC 透传、目标聊天队列及重新加载事务
src/daemon.mjs             本地控制服务、连接路由和认证接口
src/policy.mjs             输入与容量预检
src/budget.mjs             可用窗口/比例换算与历史预算展示
src/store.mjs              预算、可观测元数据和模型目录
src/wrapper.mjs            Codex 启动包装器
src/automatic-startup.mjs  用户 GUI 登录环境登记、诊断与恢复
src/menu-bar.mjs           菜单栏入口启动、去重与诊断
src/confirmation.mjs       模型切换后的窗口读回确认
src/runtime-selection.mjs  识别桌面父进程并使用对应包内运行时
src/cli.mjs                诊断和 hook 入口
scripts/                   编译、安装和卸载
test/                      本地模拟服务与真实运行时测试
```

Node 采用 ES modules 和标准库，没有第三方 npm 依赖。原生面板使用 SwiftUI/AppKit，由 `xcrun swiftc` 编译。macOS 应用以当前机器架构构建，最低部署目标 14.0；实际本机验证环境为 macOS 26 arm64。

## 必须保留的契约

1. 标准输出只有原有 JSON-RPC；日志只能去 stderr 或本地服务日志。
2. 反向工具调用、通知、取消和并行其他聊天保持透传。
3. 内部请求使用独立随机 ID，并截留自己的响应。
4. 活跃请求不能被预算调整自动取消；等待轮次边界。
5. 保存、提交、运行时确认必须区分。
6. 不能以累计输入 token 作为当前上下文占用，也不能把未知用量当作零。
7. 不能写入或替换用户的聊天历史、认证文件、全局窗口设置和 hook 信任记录。
8. 新版本通过测试前保持透传。

## 测试

`npm test` 运行纯策略测试及本机可用时的运行时集成测试。没有预期位置的 Codex 二进制时，集成测试会明确标为 skipped，而非通过。

```sh
CONTEXT_CONTROL_TEST_CODEX=/path/to/codex npm run test:integration
CONTEXT_CONTROL_TEST_INSTALL=1 node --test test/install.test.mjs
npm run build:mac
CONTEXT_CONTROL_TEST_INSTALL=1 CONTEXT_CONTROL_TEST_UI=1 npm test
```

集成测试使用隔离 Codex home、固定合成模型目录和回环 SSE 服务。验证：窗口实际读回、其他聊天隔离、完整持久历史、沙盒/模型/审批设置、开发者指令和动态工具保留、生成中排队、压缩阈值的真实内核行为，以及本地接口认证。没有 API key 或外部模型调用。

0.3 额外验证：700K 输入反算后真实运行时读回 700K、比例超限拒绝而不夹值、全部 1–100 可用比例下的精确整数反算、Swift 与 JS 换算/验证一致、Hook stats 的可用容量口径，以及生成中更新控制服务后的自动重连。原生换算测试只编译 Foundation 程序，不请求系统隐私权限。

原生 UI 测试使用独立安装目录和应用标识，模拟桌面连接注册，确认菜单栏对象自动建立、设置窗口未打开、重连不重复启动。0.4.1 进一步检查原生应用身份、独立服务启动，以及短命启动进程退出后入口继续运行。安装测试验证真正的 Mach-O 入口和完整包签名。诊断文件仅含进程、应用标识、菜单窗口位置/状态、设置窗口可见性和连接数。该测试需要先编译面板，再设置 `CONTEXT_CONTROL_TEST_UI=1`，不会调用真实模型；它不能替代屏幕显示的人工检查。

安装测试使用临时模拟桌面应用目录，安装两次再卸载，检查其他 hooks 和 config.toml 没有变化。它不要求测试机预装 Codex，原生面板需要时编译、已编译时复用。日常测试默认跳过此测试，需要显式开启。

macOS 自动接入测试使用随机、独立的探测环境变量与登录任务，不修改真实 `CODEX_CLI_PATH`。测试编译一个不请求隐私权限的临时应用，经普通 Launch Services 打开，确认环境继承、应用身份和父进程为 launchd，并验证重复登记、卸载和外部配置保留。完整安装测试通过 `--no-auto-start` 隔离系统登记；`--use-built-panel` 可复用此前编译的原生面板。

0.5 原生面板增加 K 级滑条计算；CLI 保持原精度。窗口反算仍精确，压缩阈值以整数 K 直接提交，不再从显示百分比反算。联动保留原始整数比，避免反复拖动造成累计舍入误差。新增原生计算测试覆盖边界和往返联动；真实桌面仅操作草稿，不提交测试预算。

## 发布前工作

- 运行全部测试及原生编译。
- 对支持的每个 runtime 单独运行集成测试，更新 `src/compatibility.mjs`。
- 在真实桌面启动路径确认桥接已连接；普通命令、Code Mode 辅助路径、取消和窗口切换正常。
- 不将 Application Support 下的状态、日志、凭据、截图中真实聊天标题或原始 RPC 内容提交仓库。
- 更新版本号、兼容矩阵和变更记录。

当前分发方式是从源码本地构建，不提供已签名/公证的跨机器应用包。后续可增加 GitHub Release 的已签名通用应用、自动更新与独立安装包。

## 开发环境覆盖

仅用于隔离测试：`CONTEXT_CONTROL_HOME`、`CONTEXT_CONTROL_CODEX_HOME`、`CONTEXT_CONTROL_REAL_CODEX`、`CONTEXT_CONTROL_CATALOG_PATH`、`CONTEXT_CONTROL_APPLICATIONS`、`CONTEXT_CONTROL_TEST_CODEX`。这些变量不改变父进程的 HOME，也不会把真实凭据复制到测试目录。
