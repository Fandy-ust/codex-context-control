# Multi-device cloud sync

[中文完整指南](../CLOUD_SYNC.md) · [README](../../README.md)

Open **Settings → Cloud sync** on Windows or macOS. Both clients use the same shared service and GitHub HTTPS API. No Git installation, Git Push, Actions deployment or self-hosted server is required. A dedicated private repository is recommended for approximately five personal devices.

## Storage and permissions

| Provider | Destination | Recommended token permissions |
| --- | --- | --- |
| Private repository | `owner/context-manager-sync` | Fine-grained PAT restricted to that repository; Contents: Read and write |
| Secret Gist | Gist ID | User Gists: Read and write; a classic token with `gist` also works |

Create the private repository first. The app rejects public repositories and public Gists. A Secret Gist can still be read by anyone with its link, so **both providers always encrypt statistics**. Only github.com is supported.

## Set up the first device

1. Refresh Account quota to identify the correct signed-in Codex account.
2. Open Settings → Cloud sync, enable sync, choose a provider, and enter the repository or Gist ID and GitHub Token. For Gist, you may use **Create Secret Gist** after entering a token.
3. Generate a random sync key. All devices need the same nonempty key; there is no minimum length. Saved credentials stay visibly masked and marked Saved. Copy Token / Copy key remain available after saving and reopening settings.
4. Choose **Manual only**, **5 / 15 / 30 / 60 minutes**, or **Custom** (5–1440 minutes). Default: 15 minutes. Startup sync is optional; manual mode never runs automatically. The service must be running and the computer awake.
5. Leave the legacy-history checkbox off unless you can confirm **all unassigned local token history belongs to the current Codex account**. This one-time claim binds only unassigned token records; unknown historical quota readings remain separate. New attributable requests are included automatically.
6. Click **Enable and sync / Save and sync** to save the current form and start sync. You may also save without starting it. Check Last sync, device count and any error. The button uses current form values; empty credential fields retain saved values. Starting a background operation is not confirmation that it completed.

Credentials are stored using current-user Windows DPAPI or macOS login Keychain. The first Keychain operation may ask for OS permission. Routine state responses and CLI output never return the token or key. Explicit copy decrypts the selected credential to the local clipboard.

## Add other devices

Install independently on each device and sign in to the same Codex account. Use the **same destination and sync key**. Tokens may differ if each has access. Sync on both sides once more to converge.

Keep each device's generated ID; do not clone the entire application data folder. A reinstalled device may have a new ID, but duplicated response IDs are still counted once. To retire a device, disable sync everywhere before removing its cloud manifest. The next sync removes that imported source; an active retired device will publish again. The service accepts up to 20 device manifests and is intended for a small personal deployment. Gist list limits cause an explicit error rather than silently missing devices.

## CLI setup for scripts and agents

Use GitHub CLI to create the remote storage, then the Context Manager CLI to configure the local service. Keep credentials out of chat, command-line arguments, tracing and printed output. Prefer a dedicated fine-grained PAT; `gh auth token` may have broader scopes.

Installed launcher paths:

- Windows: `%LOCALAPPDATA%\CodexContextControl\bin\context-manager.cmd`
- macOS: `~/Library/Application Support/CodexContextControl/bin/context-manager`
- Source checkout: `node src/cli.mjs`

### Windows PowerShell

```powershell
gh auth login --hostname github.com --web
$owner = gh api user --jq .login
gh repo create "$owner/context-manager-sync" --private --add-readme
$cm = "$env:LOCALAPPDATA\CodexContextControl\bin\context-manager.cmd"
$githubToken = gh auth token --hostname github.com
$syncKey = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
# Save this key in your password manager for the other devices.
$syncKey | Set-Clipboard
@{enabled=$true;provider='repository';repository="$owner/context-manager-sync";
  token=$githubToken;key=$syncKey;intervalMinutes=15;startup=$true;claimLegacy=$false
} | ConvertTo-Json -Compress | & $cm global sync-configure --input -
& $cm global sync-now
& $cm global sync-status
Remove-Variable githubToken, syncKey
```

Skip creation if your repository already exists. On other devices, retrieve the saved key instead of generating another.

### macOS

```bash
gh auth login --hostname github.com --web
owner="$(gh api user --jq .login)"
gh repo create "$owner/context-manager-sync" --private --add-readme
export CM_SYNC_REPO="$owner/context-manager-sync"
CM="$HOME/Library/Application Support/CodexContextControl/bin/context-manager"
# Hidden input: enter the shared key saved in your password manager.
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

These examples require Node.js. `sync-now` starts a background operation and returns immediately. Poll `sync-status` until `running` is false, then inspect `lastSuccess` and `error`.

### Gist alternative

```bash
# Only when your existing gh session lacks gist authorization:
gh auth refresh --hostname github.com --scopes gist
printf '%s\n' 'Context Manager encrypted statistics' | gh gist create --desc 'Context Manager sync' -
```

Use the final component of the returned URL as `gistId`, and change the configuration to `provider: "gist"`. Do not use `--public`. Other fields and commands remain the same. A created Gist initially contains only the harmless seed text.

## Data semantics

- Only allowlisted fields are shared: response IDs, timestamps, model and token counts (input, cached read, cache write, output), plus valid quota observations. No messages, titles, project paths, raw logs or credentials are uploaded. Cost is recalculated from merged token records and the app's price table.
- A keyed HMAC of Codex account identity separates accounts without uploading authentication account IDs or tokens (display emails and quota summaries are encrypted in the directory). Plan changes do not create another cloud account. An account change during a session blocks sync until you disable and reconfigure it for the new account.
- Identical response IDs count once. A more complete record wins; equally complete conflicting records use a deterministic tie-breaker, never addition. Requests missing response IDs are not invented.
- Account quota percentages are observations and are **never summed across devices**. Observations feed the existing cycle normalization and forecast logic. Missing logs and sampling differences remain limitations.
- Each device owns independent encrypted shards and publishes its manifest only after its files are uploaded. Changes are partitioned by month and type, at most 2000 records per shard. Unchanged shards are not uploaded. Repository writes check SHA and retry conflicts. Reads must all validate before a local import transaction commits; failure retains the previous successful import and triggers backoff.
- Local SQLite stays independent. Imported records live in a separate table and are never re-exported. Disabling sync restores local-only reports; cloud data stays intact.
- Keys are derived using scrypt; AES-256-GCM authenticates content and its account/device/file context. Lost keys cannot recover cloud history. Changing the shared key creates a new logical namespace; update all devices and republish.
- Active statistics retain 366 days. Obsolete device shards are pruned, but GitHub revision history may retain older ciphertext. Private repositories suit sustained history better than Gists.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Mac sync button is grey even after filling the form | Install 0.24.1 and use Enable and sync / Save and sync; missing fields show an explicit error |
| Clicking Cloud sync stays on General | Install 0.24.0 or later; the tab routing was fixed |
| Account identity unavailable | Refresh valid Codex account quota and retry |
| 401 / 404 | Check token expiration, account permissions and destination |
| 403 / 429 | Check Contents/Gists write access, organization approval and rate limits; let backoff run |
| Wrong key / corrupt data | Check the same key on every device; do not edit cloud files |
| Codex account changed | Disable, verify the new account and legacy ownership, then reconfigure |
| No increase in totals | Check both devices' successful sync times, account, key and date filters; duplicate IDs should not increase totals |
| Transient missing file during pruning | Retry with the latest manifest; partial imports are not committed |

This feature synchronizes numeric analytics and account display/quota summaries, not chats, queues, context budgets or skills. OAuth login is not part of this implementation.

Official references: [Gist API](https://docs.github.com/en/rest/gists/gists), [repository Contents API](https://docs.github.com/en/rest/repos/contents), [token permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens), [gh repo create](https://cli.github.com/manual/gh_repo_create), [gh gist create](https://cli.github.com/manual/gh_gist_create).


## Accounts and devices (0.24.2)

One repository/Gist and sync key can serve multiple Codex accounts. Account IDs take precedence over email; model and plan changes remain the same account. An encrypted discovery directory shares anonymous account identifiers and device names, with encrypted display emails and quota summaries from 0.27.3; login credentials stay local.

In Cloud sync, name this device, choose Current account (default), All accounts, or Selected accounts, and check the devices included in cost/token totals. Participate in sync pauses future uploads/downloads per account while keeping imported history available. Preferences apply to this device only and never delete cloud history. The displayed device timestamp is the last snapshot publication, not a heartbeat. Unassigned history stays hidden until explicitly enabled; only claim legacy history if its ownership is certain. Update every device to 0.24.2 for account discovery.

## Account names, sidebar quota and deletion

Use **Settings → Cloud sync → Accounts and devices** to manage remembered accounts, even with cloud sync disabled.

- Save an optional account name (up to 40 characters). Clear it to use the email label. Names are shared in encrypted summaries; an explicit name on the receiving device takes precedence.
- **Show quota in sidebar** saves immediately and is independent of statistics and sync selections. Show any number of accounts or hide them all. The signed-in account appears first; inactive components use muted colors.
- Inactive accounts retain their last observed quota, Credits and exact reset timestamps across switches and restarts. Countdowns continue, then show “Waiting for quota refresh”; future reset cycles are never inferred.
- **Delete account and statistics** asks for confirmation and clears this account’s local quota cache, credit baselines, quota history, token/cost statistics and downloaded sync statistics. Other accounts remain intact. Deleted historical data is suppressed on rescan and reimport. Codex stays signed in; original cloud files, other devices and Codex chat logs remain. A signed-in account is detected again and can collect new data.
