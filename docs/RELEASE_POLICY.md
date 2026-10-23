# 版本与下载管理 / Release policy

## 保留范围

- 保留最新 5 个公开普通版本的完整安装包、自动更新包、校验文件和更新清单。
- 额外保留关键回退版本：0.23.5（旧文档引用与历史回退）、0.19.6（共用核心与双平台基线）、0.16.2（早期 Mac 轻量版），以及演示视频 Release。
- `latest` 始终指向当前推荐版本。删除历史 Release 不删除 Git 标签；原发布说明先归档到 [历史索引](releases/archive/index.md)。
- 过期草稿可以清理。草稿完整元数据仅备份在维护者本机的 `build/release-backups/`，不会自动公开。
- 不自动定期删除 Release。维护前先检查保留计划和文档引用；最新版本、自动更新文件与关键回退包不能拆开清理。

## 发布节奏

日常提交、PR 和试验编译使用 Actions artifacts，保存 7 天。测试包不必逐个创建公开 Release。累计有意义的修复或功能后，再通过标签或手动勾选 `publish_release` 发布；Windows 与 macOS 都验证通过后才公开。

Release 正文保留平台下载入口、关键变化、必要的升级说明与详细变更链接。关键摘要写入 `docs/releases/<version>-summary.md`，完整说明写入 `docs/releases/<version>.md`；发布工作流只内嵌摘要，并链接完整说明。具体实现和完整历史放在 CHANGELOG、`docs/releases/` 或归档索引，避免每个版本重复长篇安装说明。

现有 `v<version>-preview.1` 标签继续保留，避免破坏更新清单和旧下载链接。普通版与 Lab 的安装身份独立；标签包含 `preview.1` 不代表普通版使用 Lab 数据目录。

## 维护命令

```sh
node scripts/maintain-releases.mjs            # 只读计划 / dry run
node scripts/maintain-releases.mjs --archive  # 本地备份元数据并归档历史说明
node scripts/maintain-releases.mjs --apply    # 重新读取计划、备份后删除旧 Release，保留 tags
```

需要有仓库写入权限的 GitHub CLI 登录。执行 `--apply` 前应先审核并提交归档文件；删除附件后原下载链接不再可用，归档元数据不包含二进制安装包备份。

## English summary

Keep the latest five normal public builds, the explicitly pinned fallback milestones, and the demo release. Preserve Git tags and archive historical notes before deleting retired releases. Development artifacts expire after seven days; public releases require an explicit publish action and successful builds on both platforms. Cleanup is manual and defaults to a read-only plan. Never remove the current update feeds or split a retained release's installer/checksum/update assets.
