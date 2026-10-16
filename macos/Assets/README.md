# 图标资源

- `ContextManager.svg`：设计源文件。
- `ContextManager.png`：README 和预览使用的导出图。
- `ContextManager.icns`：macOS App 与安装器使用的导出图。

三者应保持一致。`scripts/build-mac.mjs` 按 ICNS 内容哈希命名 bundle 内的资源，并写入 `CFBundleIconFile`；这样新图标不会重复使用旧资源名。安装器复制构建好的同一份图标，不维护第二份设计。

菜单栏是 `macos/ContextMenu.swift` 中 `managerStatusImage` 绘制的单色圆环与三条横线。它是独立的 22pt 模板图形，适配明暗菜单栏，外环反映运行中聊天的最高用量。更新品牌轮廓时同步更新这里；没有活跃用量时不绘制虚构进度。

安装更新会先结束旧菜单栏进程、替换应用，再启动新进程；不修改 Codex 的图标或签名，也不清除全系统图标缓存。
