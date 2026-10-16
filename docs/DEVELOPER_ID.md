# Developer ID 与正式分发

没有 Developer ID 仍可做本地开发和向授权测试者提供预览包；首次可能需要手动允许打开。使用者不需要购买开发者会员。

要正式分发并减少系统拦截，发布者需要 Apple Developer Program、Developer ID Application 证书和 notarization。不是 Mac App Store 上架流程。

## 办理

1. 用开启双重认证的 Apple Account 加入 Apple Developer Program，完成身份验证和付款。目前官方年费为 99 USD，地区价格以结算页为准。个人可按个人身份注册；组织需要合法主体及相应验证资料。注册、付款由账号持有人本人操作。[Apple 注册说明](https://developer.apple.com/help/account/membership/program-enrollment/)
2. Account Holder 在 Certificates, Identifiers & Profiles 中新增 **Developer ID Application**，按向导生成并上传 CSR，下载 `.cer` 后双击导入钥匙串。当前 `.app` 安装器用 Application 证书；若改做 `.pkg`，还需要 Developer ID Installer。[Apple 证书说明](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
3. 用证书签名，启用 Hardened Runtime，提交 Apple 公证，再将票据附到应用。此仓库提供对应打包和公证脚本。[Apple Developer ID 分发说明](https://developer.apple.com/developer-id/)

私钥保存在钥匙串。不要把 Apple 密码、私钥或带密码的证书发到聊天，也不要提交仓库。当前流程优先使用本机钥匙串，不要求上传签名私钥到 GitHub。

## 本项目接入

```sh
export CONTEXT_CONTROL_SIGN_IDENTITY='Developer ID Application: 你的签名身份 (TEAMID)'
npm run package:mac -- --release

# 先按 notarytool 的交互指引在本机钥匙串配置凭据。
# 这里仅传已存在的 profile 名称，不把密码写在脚本中。
export CONTEXT_CONTROL_NOTARY_PROFILE='context-manager-notary'
node scripts/notarize-mac.mjs
```

打包器先签内置 Node 和原生面板，再生成内容校验清单并签安装器。公证脚本要求 Apple 返回 Accepted，附票据、验证后重打 ZIP 并更新 SHA-256。

没有证书时可以运行普通 `npm run package:mac` 生成预览包。当前开发机没有 Developer ID 身份，签名／公证分支尚未实测；不能把本地签名验证当作 Apple 公证通过。
