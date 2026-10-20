# 多设备云同步配置

[English](en/CLOUD_SYNC.md) · [返回 README](../README.zh-CN.md)

Windows、macOS 均在 **设置 → 云同步** 配置，支持 GitHub 私有仓库和 Secret Gist。两端直接调用 GitHub HTTPS API，无需安装 Git、执行 Git Push、运行 Actions 或自建服务器。建议 5 台左右设备使用专用私有仓库。

## 1. 选择同步方式

| 项目 | 私有仓库（推荐） | Secret Gist |
| --- | --- | --- |
| 访问控制 | 读取需要仓库授权 | 获得链接的人可以读取文件 |
| 本软件上传内容 | 始终加密 | 始终加密 |
| 配置项 | `owner/repository` | Gist ID |
| Fine-grained PAT 权限 | 指定专用仓库，Contents: Read and write | 用户权限 Gists: Read and write |
| 适合 | 长期记录、多台设备 | 轻量同步、快速试用 |

私有仓库须事先创建，不能使用公开仓库。Gist 可以在软件内点击“创建 Secret Gist”，或通过下面的 CLI 创建；软件拒绝公开 Gist。只支持 github.com，不支持 GitHub Enterprise 自定义域名。

## 2. 第一台设备：界面配置

1. 安装包含云同步功能的版本，启动 Context Manager；在“账户额度”刷新一次，确认已登录正确的 Codex 账号。
2. 在 GitHub 创建一个专用私有仓库，例如 `your-name/context-manager-sync`。在 GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens** 创建令牌，只授权这个仓库的 **Contents: Read and write**。组织仓库可能需要组织管理员批准。不要把 Token 填成 Codex API Key。
3. 进入软件 **设置 → 云同步**，开启“启用云同步”，选择“GitHub 私有仓库”，填写 `your-name/context-manager-sync` 和 GitHub Token。使用 Gist 时，选择 Secret Gist，填写 Gist ID 或点击创建按钮；对应令牌需要 Gists 读写权限。
4. 点击“生成随机密钥”，**先复制到密码管理器**。所有设备必须使用同一密钥，至少 16 个字符，建议使用生成的 64 位随机十六进制字符串。保存后软件不回显密钥，其他设备需从你保存的位置取得。
5. 从下拉框选择 **仅手动、5、15、30、60 分钟**；“自定义”支持 **5–1440 分钟**。默认 15 分钟。勾选启动同步时，程序启动后尽快尝试；仅手动模式不会自动同步。驻留服务需要运行，电脑睡眠或软件完全退出时不会同步。
6. 旧版日志无法可靠确认历史请求属于哪个账号。只有确认本机未归属历史都属于当前账号时，才勾选“一次性纳入历史”。不确定时留空；之后可识别的新请求自动归属。该操作只给尚未归属的 Token 记录绑定当前账号，不会改写 Codex 聊天日志，也不会把未知账号的旧额度快照强行归入账号。
7. 点击“保存同步设置”，再点击“立即同步”。“最近同步”和设备数量表示成功；错误显示在同一位置。“立即同步”使用已保存的配置，编辑后应先保存。

Token 和同步密钥保存在 **Windows 当前用户 DPAPI 加密文件 / macOS 登录钥匙串**。首次访问钥匙串可能出现系统授权窗口。配置文件只保存目的地、设备 ID 和开关等非密钥设置；界面、CLI 状态和云端不返回凭据。

## 3. 第二至第五台设备

在每台设备独立安装、登录同一个 Codex 账号，填写**同一个仓库或 Gist ID、同一个同步密钥**。GitHub Token 可以各设备不同，只需均有目的地权限。保存并同步，等待另一台也同步一次后，双方看到的统计会收敛。

不要复制整份 Context Manager 应用数据目录：每台设备自动生成独立设备 ID，只写自己的索引和文件。重装产生新设备 ID 后，重复的响应仍按 response ID 去重，但旧设备历史会继续作为独立来源存在。若要移除退役设备，先在所有设备关闭同步，再删除其云端 manifest；下次同步会移除对应导入来源，原设备再次上线会重新发布。不要删除其他设备仍在使用的文件。

当前面向个人少量设备，最多接受 20 个设备索引；大量历史建议私有仓库。GitHub 仍有 API 速率、文件数量及存储限制。达到 Gist 文件列表限制时会明确报错，不会悄悄只合并部分设备；可以改用私有仓库并让各设备重新发布。

## 4. 通过 GitHub CLI 配置，供 AI 或脚本使用

以下命令会创建你自己账号下的存储资源。先安装 GitHub CLI，并执行登录。**不要将 Token 或同步密钥贴到聊天里，不要在命令参数中写明文凭据**；下面使用进程内变量和标准输入。请不要让 AI 打印变量、开启 shell tracing 或记录 stdin。

### Windows PowerShell：私有仓库

```powershell
gh auth login --hostname github.com --web
gh auth status
$owner = gh api user --jq .login
gh repo create "$owner/context-manager-sync" --private --add-readme
gh repo view "$owner/context-manager-sync" --json visibility

$cm = "$env:LOCALAPPDATA\CodexContextControl\bin\context-manager.cmd"
$githubToken = gh auth token --hostname github.com
$syncKey = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
# 在本机复制到密码管理器，供其余设备使用；不会输出到终端。
$syncKey | Set-Clipboard
$config = @{
  enabled = $true
  provider = 'repository'
  repository = "$owner/context-manager-sync"
  token = $githubToken
  key = $syncKey
  intervalMinutes = 15
  startup = $true
  claimLegacy = $false
}
$config | ConvertTo-Json -Compress | & $cm global sync-configure --input -
& $cm global sync-now
& $cm global sync-status
Remove-Variable githubToken, syncKey, config
```

`gh auth token` 使用 CLI 当前已有授权，往往比专用 fine-grained PAT 权限更广。最小权限方案是用界面填入只授权同步仓库的 PAT。已有同名仓库时跳过创建，不要删除或覆盖它。第二台设备从密码管理器取回第一台密钥，不能再生成不同密钥。

### macOS：私有仓库

```bash
gh auth login --hostname github.com --web
owner="$(gh api user --jq .login)"
gh repo create "$owner/context-manager-sync" --private --add-readme
export CM_SYNC_REPO="$owner/context-manager-sync"
CM="$HOME/Library/Application Support/CodexContextControl/bin/context-manager"
# 在密码管理器生成并保存随机密钥，然后隐藏输入；所有设备使用同一个。
read -r -s CM_SYNC_KEY
export CM_SYNC_KEY
node --input-type=module -e '
import {execFileSync} from "node:child_process";
const token=execFileSync("gh",["auth","token","--hostname","github.com"],{encoding:"utf8"}).trim();
process.stdout.write(JSON.stringify({enabled:true,provider:"repository",repository:process.env.CM_SYNC_REPO,token,key:process.env.CM_SYNC_KEY,intervalMinutes:15,startup:true,claimLegacy:false}));
' | "$CM" global sync-configure --input -
unset CM_SYNC_KEY CM_SYNC_REPO
"$CM" global sync-now
"$CM" global sync-status
```

上例需要 Node.js；在源码目录也可以把安装后的启动器替换为 `node src/cli.mjs`。`sync-now` 启动后台同步并立即返回，查询 `sync-status` 的 `running`、`lastSuccess` 和 `error` 确认完成，不要将“已开始”当成“已成功”。

### Gist：使用 gh 创建存储

```powershell
# 仅当当前 gh 登录缺少 gist 权限时，补充授权：
gh auth refresh --hostname github.com --scopes gist
$gistUrl = 'Context Manager encrypted statistics' | gh gist create --desc 'Context Manager sync' -
$gistId = ($gistUrl.Trim() -split '/')[-1]
# 将上面的配置对象改成：provider='gist'，gistId=$gistId。
# 不使用 --public；其余 Token、密钥、间隔和 sync-configure 步骤相同。
```

macOS 对应创建命令为 `printf '%s\n' 'Context Manager encrypted statistics' | gh gist create --desc 'Context Manager sync' -`，取输出 URL 最后一段作为 ID。Gist 的创建不会上传任何本机统计；配置保存并启用后才同步。

## 5. 合并与数据边界

- 同步 response ID、时间、模型、输入／缓存读取／缓存写入／输出 Token，以及有效额度观测。只使用明确列出的数值字段；不上传聊天正文、标题、项目路径、完整日志、Codex 登录凭据或 GitHub Token。费用依据合并后的 Token 及软件现有价格表重新估算。
- 账号分组由“同步密钥 + Codex 账号标识”生成不可逆 HMAC，真实账号标识不上传；设备本机加盐指纹不直接用于跨设备关联。同一账号升级订阅方案不会变成另一云端账号。运行中切换账号会阻止继续同步，需关闭并为新账号重新配置。
- 相同 response ID 只计一次；缓存写入等字段更完整的记录优先，字段同样完整但冲突时使用固定规则选取一条，绝不将两条相加。无法识别 response ID 的请求不会伪造 ID 纳入统计。
- 5 小时／每周百分比是账号观测，**不会把设备的百分比加起来**；相同观测去重后进入已有周期归一化和预测核心。数据缺失和采样差异仍会影响估算，并不保证与官方账单一致。
- 本机 SQLite 保留独立，导入记录放在独立表，不回传导入的数据。关闭同步后报告只使用本机记录；再次同步可恢复远端来源。关闭不删除 GitHub 历史。
- 按月、类型、每片最多 2000 条记录分片，仅上传变化的分片；先上传加密数据，最后发布设备索引。读取所有设备成功且校验通过后才事务提交本地导入，失败保留上次成功数据。每台设备串行运行一个同步任务，仓库写入使用 SHA 冲突重试；失败自动退避，最小间隔 5 分钟。
- 两种存储都使用 scrypt 派生密钥和 AES-256-GCM 加密，文件绑定账号、设备和文件名，防止互换。密钥丢失无法恢复云端历史；更换密钥会创建新的逻辑同步空间，需要所有设备使用新密钥重新上传。
- 活跃统计保留最近 366 天。设备会清理自己已被替代的分片；GitHub 修订历史可能继续保留旧密文，这不等于云端历史被安全擦除。Gist 文件数量较多或历史持续增长时，请使用私有仓库。

## 6. 常见问题

| 提示／现象 | 处理 |
| --- | --- |
| 点击云同步仍停在通用页 | 安装 0.24.0 或更高版本；新版已修复标签点击入口 |
| 需先刷新 Codex 账号额度 | 在额度页刷新，确认当前账号可被识别后重试 |
| GitHub 401 / 404 | 检查 Token 是否过期，以及仓库／Gist ID、账号和访问权限 |
| GitHub 403 / 429 | 检查 Contents 或 Gists 写权限、组织审批、API 限流；等待退避重试 |
| 密钥错误／数据损坏 | 所有设备核对同一个密钥；不要手动编辑同步文件 |
| Codex 账号已变化 | 关闭同步，确认新账号和历史归属，再重新配置并开启 |
| 云端有数据，但本机数字没增加 | 检查账号、目的地、密钥、双方最近同步时间及统计日期筛选；重复 response ID 本来就不会增加总量 |
| 统计仍少于所有聊天总量 | 只有有 response ID 的账本请求能统计；旧未归属记录须显式确认，缺失日志不能推算补齐 |
| 刚删除云端分片后短暂同步失败 | 另一设备可能正在读取旧索引；下一轮会重试，不会部分覆盖统计 |

本功能同步数值统计；聊天列表、正文、任务队列、上下文预算和技能不在同步范围。当前通过共享密钥及 GitHub Token 配置，不包含 GitHub OAuth 登录流程。

## 官方资料

[GitHub Gist API](https://docs.github.com/en/rest/gists/gists) · [仓库 Contents API](https://docs.github.com/en/rest/repos/contents) · [Fine-grained PAT 权限](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens) · [gh repo create](https://cli.github.com/manual/gh_repo_create) · [gh gist create](https://cli.github.com/manual/gh_gist_create) · [gh auth refresh](https://cli.github.com/manual/gh_auth_refresh)
