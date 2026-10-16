# 在 Mac 上安装

首发测试包支持 Apple Silicon（M 系列）、macOS 14 或更新版本。需要已安装 Codex / ChatGPT 桌面客户端；完整功能在 Codex 0.160.0 验证。Intel 暂不包含在首发包内。

## 普通使用者

1. 从[GitHub Releases](https://github.com/Fandy-ust/codex-context-control/releases)取得有权访问的版本，或向项目所有者取得 ZIP，然后解压。草稿仅供维护者复核，尚未公开发布。
2. 打开 `Install Context Manager.app`，点击「安装 / 更新」。
3. 完整退出并重开 Codex。菜单栏自动出现 Context Manager 的圆环与三条横线图标。
4. 若需要 Hook stats，在 Codex 的 `/hooks` 审核新增 hook。主面板和预算控制不依赖 hook 信任。

无需安装开发工具，无需申请 Developer ID。安装器把运行环境复制到稳定的本地支持目录；删掉安装器不会影响使用。不会把签名的 Codex 应用改成修改版。

当前私有测试包使用本地签名，**尚未 Developer ID 签名、公证**。如果 macOS 阻止打开，确认包来自项目所有者、校验文件匹配后，先尝试打开，再去「系统设置 → 隐私与安全 → 仍要打开」。受管理的 Mac 可能限制这种例外；遵守该设备的管理策略。[Apple 官方说明](https://support.apple.com/en-us/102445)

不要运行关闭 Gatekeeper 的全局命令。校验和只能发现传输损坏或与发布文件不一致，不能代替发布者身份验证。

## 安装位置

- 应用：`~/Applications/Codex Context Control.app`
- 控制代码与状态：`~/Library/Application Support/CodexContextControl`
- 内置运行环境：上述目录的 `runtime/`，使用不可变版本文件名
- 新增 Stop hook：`~/.codex/hooks.json`，保留其他 hooks 并备份

代码和应用先复制到临时目录，完成后再替换现有目录；复制失败保留旧安装。预算、备份和现有开关设置保留。

## 获取、更新与移除

仓库目前私有。受邀协作者可以取得 Actions 构建产物；其他授权测试者可由所有者直接提供 ZIP，不需要 GitHub 账号下载源码。

更新：打开新版安装器，选择「安装 / 更新」。连接桥接升级后需重开 Codex；界面会保留实际状态与等待生效的区别。

移除：安装器内选择「移除安装」。应用、自动接入及本项目 hook 被移除，预算和备份保留。也可使用源码中的卸载命令。

首次安装包不包含约 478 MB 的可选修复运行时；普通预算、统计、拓展功能不需要它。

## 图标更新

应用与安装器使用同一份彩色图标；菜单栏使用圆环与三条横线的单色版本，自动适应系统外观，并保留实时用量圆环。菜单栏不是缩小后的彩色 App 图标。

新版安装器会结束旧菜单栏进程后再替换应用、启动新版。只在 Finder 中更换 App 图标，不会改变代码绘制的菜单栏图形。无需重置整个系统图标缓存。
