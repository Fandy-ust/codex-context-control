# 多账号切换可行性研究

日期：2026-10-25，Asia/Taipei。范围：方案研究，未更换登录状态、读取真实凭据或实现切号。

## 结论

可以设计用户主动触发的账号选择器，但没有足够依据承诺“零封号”或量化各方案的封号概率。应分别评估平台使用规则、凭据安全、客户端兼容性和任务一致性。官方支持某种认证能力，不代表允许用多个账号规避限制，也不证明任意第三方桌面改造得到支持。

对本项目，建议先验证“官方登录 + 每账号独立状态 + 空闲时切换或重启”的方案。保留原生桌面 UI 的热切换需要单独验证，不能从 CLI 的隔离能力直接推导。

## 官方依据

1. [Codex Authentication](https://learn.chatgpt.com/docs/auth)：支持 ChatGPT 登录和 API key；登录信息可存在操作系统凭据库或 CODEX_HOME 下的 auth.json；正常使用时由 Codex 自动刷新。auth.json 应当按密码保护。
2. [Environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables)：CODEX_HOME 适用于 CLI、IDE extension、app-server、installers，改变配置、认证、日志和会话等状态根目录。它不是只切换账号的开关；该表没有承诺整个桌面应用的全部状态都随它隔离。
3. [Windows desktop](https://learn.chatgpt.com/docs/app/windows)：Windows 应用默认与原生 Windows Codex 共用用户 .codex 目录。需要考虑已打开的桌面、CLI 与 IDE 的共享认证影响。
4. [Sign in with ChatGPT: Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)：在该自建应用认证流程中，允许管理多个账号注册及选择已有账号；每份注册的 client ID 和凭据要保持对应，激活前验证身份；同一会话的刷新应串行，保存新返回的 Token。此文不是官方桌面热切换接口说明。
5. [SIWC Overview](https://developers.openai.com/siwc/token-sharing-open-source)：文档面向开源及本地托管应用的 ChatGPT plan usage，另有付费或远程托管接入路径；主机标识应稳定。
6. [SIWC Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) 和 [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)：自建应用可按文档授权后将 Token 提供给自己的 app-server；应用负责更新 Token 并重启进程。该方案有工具和请求参数限制，并不自动获得原生桌面的全部功能。

以上来源没有提供本项目第三方切号的封号统计，也没有给出安全切换频率。技术隔离不能替代适用条款及组织策略核对。

## 本机与仓库证据

- 当前内置运行时为 codex-cli 0.164.0-alpha.11.1。只读取了 --version 与 login --help；帮助提供 login/status/device-auth 等入口，没有列出账号列表或 switch 子命令。这不足以证明其他界面或内部接口不存在切号能力。
- src/paths.mjs 在进程加载时确定单个 codexHome；src/account-quota.mjs 与 src/quota-probe.mjs 将这个目录传给新 app-server 进程。
- 当前账号列表和统计身份不包含可切换登录所需的授权。拥有邮箱、账号哈希或历史额度不等于持有该账号的有效会话。
- 当前管理器的多账号展示是观测和统计能力，尚非多账号认证管理器。

## 方案比较

| 方案 | 使用体验 | 技术取舍 | 建议 |
| --- | --- | --- | --- |
| 调用原生登录流程，必要时用户完成浏览器授权 | 点击后可能仍需选择账号/验证 | 自行持有凭据最少；已登录桌面是否随 CLI 更新仍需验证 | 最保守的初始能力 |
| 每账号独立 CODEX_HOME，由官方运行时登录和维护会话 | 初次分别授权，之后选择已有环境；可能需要重启 | CLI/app-server 有文档基础；需验证凭据库隔离、共享服务、桌面状态和历史策略 | 优先做隔离可行性验证 |
| 备份并覆盖同一个 auth.json | 看似直接切换 | 凭据库模式可能不读取此文件；运行中缓存、刷新轮换、旧快照、进程争写会导致不一致 | 不作为默认方案 |
| 本项目按 SIWC 接入自有账号选择器及 app-server | 可自主管理已授权账号 | 文档直接描述多账号；开发和功能迁移成本大，不等价于切换现有原生窗口 | 长期架构选项 |

此表比较认证实现和兼容成本，不是封号概率排序。

## 推荐的交互与实现边界

1. 账号卡片新增“切换到此账号”。仅由用户主动触发，不把额度不足、429、验证失败或账号停用作为自动换号重试信号。
2. 添加账号时打开官方认证页；由用户完成密码、MFA 或设备码授权。已保存会话失效时回到认证流程。
3. 为每个账号维护独立认证与运行时状态。优先让官方运行时维护自己的认证；若选择 SIWC，则严格按每份注册维护自己的 client ID、身份和凭据。
4. 切换前等待任务与压缩结束、暂停启动新队列任务，并暂停本管理器的额度轮询及自动探测。不会自动重放已经提交的任务。
5. 获取切换锁，停止或重新建立需要更换身份的连接；不能只改环境变量后假定已有进程已更新身份。无法协调的外部 CLI/IDE 会话应明确提示影响范围。
6. 启动目标环境，完成必要授权，通过官方账号读取验证账号与工作区，再刷新额度、移动“当前登录”标签、恢复队列。身份不符或验证失败就停止；回退到仍有效的旧环境，不能盲目恢复旧 Token 文件。
7. 默认隔离会话历史，项目代码可共用。不要为保持同一聊天而直接复制共享可写 SQLite 数据库。跨账号续聊须另行明确设计及验证。
8. 凭据仅在本机受保护存储，不纳入当前数值统计云同步、不进入日志或仓库。Windows DPAPI/macOS Keychain 的具体组合需结合实际认证存储验证。

## 实现前验证清单

- 隔离目录是否确实对应不同的文件凭据或凭据库条目；不能只看到两个目录就认定认证已隔离。
- 桌面窗口、后台服务和共享运行时是否读取同一认证，以及何时重新加载。
- 桌面是否支持目标启动参数、是否被单实例机制转交给已运行窗口，以及其他桌面登录状态是否独立。
- 切换失败、登录过期、账号工作区不匹配时能否保留旧环境且不泄露凭据。
- 正在运行的任务、待执行队列、压缩、额度自动探测及统计归属能否一致暂停和恢复。
- Windows 与 macOS 分别验证。CLI 成功不代表桌面成功；本次未使用真实账号执行切换实验。

建议首版定位为“用户主动选择账号并安全重连”，接受必要的重启和重新授权；不要承诺运行中无感热切换。若主要目标是持续增加可用额度，应先核对订阅、付费额度或 API 等官方容量路径，不能把上述认证设计当成使用规则许可。

## 补充：内嵌浏览器与 GitHub 同类项目

调研日期同上。以下是公开仓库 README 与官方授权文档级别的比较，未安装这些工具、未提供真实凭据，也未完成源码或发布包安全审计。GitHub 未认证 API 返回限流，项目文件树获取未完成；不能将作者的安全说明视为已经审计的事实。

### 浏览器授权的实现方式

可以由应用自动创建 OAuth 请求、启动回调监听器、打开授权页、接收回调并验证身份。登录页上的密码、MFA 和首次授权由用户完成，不需要通过注入页面脚本才能建立授权。

[官方 Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) 写明打开系统浏览器。对于已有动态注册的重新授权，可以提供与账号对应的 id_token_hint/login_hint；文档描述的返回登录流程可减少账号选择步骤。id_token_hint 只是账号提示，不代表当前会话有效，也不能绕过必要身份验证。

因此建议系统浏览器为默认授权入口，应用内部显示登录进度和成功结果。内嵌 WebView 可作为另行验证的兼容性选项；尚无依据把它称为降低封号概率的措施。浏览器 Cookie 分区与 OAuth Token 管理是两种隔离，不能用前者替代后者。

这些第三方项目多数管理 Codex 原生登录或 auth.json，不能直接等同于 SIWC 自有 client_id 注册流程；网页登录成功也不能证明已打开的原生桌面窗口更新了身份。

### 可参考项目

| 项目 | README 描述的实现 | 对本仓库的参考价值与边界 |
| --- | --- | --- |
| [unkdevv/codex-switcher](https://github.com/unkdevv/codex-switcher) | Windows WinUI 3/.NET 10；一次性 WebView2 打开 codex app-server 提供的 OAuth URL；DPAPI 账号库；关闭进程后写回当前凭据、原子替换、失败回退并重开 | 最接近“内置浏览器添加账号”的设想。需要区分该项目实现与官方推荐系统浏览器流程。仓库声明 MIT。 |
| [ralphkrauss/codex-account-switcher](https://github.com/ralphkrauss/codex-account-switcher) | CLI profile；每账号独立 CODEX_HOME、认证、会话和 app-server 状态；file 凭据模式；进程生命周期锁；弃用多处复制 Token 的旧方案 | 最值得参考账号隔离、单写入者和刷新冲突处理。不是现有原生桌面窗口热切换的证明。仓库声明 MIT。 |
| [Lampese/codex-switcher](https://github.com/Lampese/codex-switcher) | Tauri 桌面应用；Windows/macOS/Linux；OAuth 添加、账号命名、托盘切换、额度统计；运行中会话阻止切换及关闭恢复流程 | 接近完整产品形态，可参考账号卡片和操作状态。包含的额度预热等其他功能不必随账号切换一起引入。 |
| [naveenshaji/codex-account-switcher](https://github.com/naveenshaji/codex-account-switcher) | macOS Swift 菜单栏；app-server OAuth；原子写入 auth.json；明确要求重启/新会话生效 | 可参考原生 Mac 交互和运行时集成。当前 README 说明凭据已从旧 Keychain 方案迁移到受权限保护的本机文件，不应误称为当前仍使用钥匙串加密。 |
| [ndycode/codex-multi-auth](https://github.com/ndycode/codex-multi-auth) | CLI OAuth 账号池、诊断及可选 wrapper；包含本机代理和运行中账号路由 | 能力范围更大，但代理与自动轮换不是本项目保守手动切号方案的必要依赖。 |

优先参考 unkdevv 的登录窗口/切换事务、ralphkrauss 的凭据所有权隔离，以及 Lampese 的账号管理交互；引用或移植源码前仍需按实际版本核对许可证和具体实现。
