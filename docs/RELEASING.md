# 打包与发布

## 测试安装包

```sh
npm ci --ignore-scripts
npm test
npm run package:mac
version=$(node -p "require('./package.json').version")
CONTEXT_CONTROL_TEST_INSTALLER_ZIP="$PWD/build/distribution/Context-Manager-$version-macos-arm64.zip" npm run test:distribution
```

版本取自 package.json。输出在 `build/distribution/`：安装器、ZIP、SHA-256 和 package-info.json。Node 下载版本及哈希固定在 packaging/node-runtime.json，官方归档缓存到 build/vendor。

安装包只包含生产 src、两个安装脚本、运行时修复元信息、生产依赖、预编译面板及 Node。研究探针、聊天数据、状态文件、日志、凭据和大型修复核心不打包。

## 可审查的发布构建

提交并保持工作树干净后运行：

```sh
npm run package:mac -- --release
```

构建信息记录源码提交、架构、Node 版本、签名状态与文件大小。干净树校验可防止把未提交代码误认为某个已审核提交。不要上传 `build/` 全目录，只使用该次发布的 ZIP、校验文件及 package-info.json。

GitHub 的 **macOS installer** workflow_dispatch 工作流先测试、打包，再在没有可用 PATH 开发工具的隔离环境完成安装和卸载验证，最后上传产物。不会自动创建公开 Release。

仓库保持私有；正式发布前由所有者确认分发授权范围。草稿 Release 可以用于所有者复核，未发布的草稿并不等于所有只读协作者都能下载。

## 签名、公证

参阅 [Developer ID](DEVELOPER_ID.md)。没有 Developer ID 时产物必须标为未公证测试包，不宣称普通下载首次打开已无拦截。

有证书时先通过 CONTEXT_CONTROL_SIGN_IDENTITY 重打包，再用本机 keychain profile 运行 notarize-mac.mjs。Accepted 并附票据后，需要用重打后的 ZIP 和 SHA-256 替换草稿附件。

## 发布检查

- 本机测试以及 GitHub 检查通过。
- 在 Apple Silicon、支持的 Codex 版本上验证安装、更新、卸载和重启接入。
- 安装器删除后仍能工作；预算和其他 hooks 保留。
- 确认实际签名／公证状态、兼容版本和许可证，不改变仓库可见性。
- 建议再用另一台干净 Mac 通过浏览器下载验证 Gatekeeper 体验；本机无隔离属性的解压测试不能代替这一步。

## 发布状态与附件

- 本地构建：只在维护者机器上存在，不等于可下载的 Release。
- Draft：维护者可复核与下载，普通只读协作者不能据此下载。
- 私有预发布：发布后，有仓库读取权限的用户可下载；仓库仍然私有。
- 公开发布 / Mac App Store：本项目尚未进行，不能与上述步骤混称。

每版附件仅上传同次构建的 ZIP、`.sha256`、`package-info.json`、`README-FIRST.txt`。Release 说明标出支持平台、实际签名状态、可选修复核心不包含、安装步骤和源代码提交。旧版附件保留，不把旧 ZIP 改名冒充新版。

更新图标时同时检查 App、安装器和菜单栏；参阅[图标维护](../macos/Assets/README.md)。
