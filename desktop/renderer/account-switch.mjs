import {accountQuotaSummary} from './sidebar-quota.mjs';

export async function switchSavedAccount(api,{id,name}){
  const reply=await api.invoke('confirm-account-switch',{name});if(!reply?.confirmed)return null;
  return api.invoke('account-switch',{action:'switch',id,confirmed:true,...(reply.force===true?{force:true}:{})});
}

export function accountSwitchView(s,{e,t,pool,language='zh'}){
  const text=(zh,en)=>e(t(zh,en));if(!s)return `<div class="content">${text('正在读取账号…','Loading accounts…')}</div>`;
  const disabled=s.busy?'disabled':'';
  const status={starting:t('正在准备官方授权…','Preparing official sign-in…'),waiting:t('请在浏览器中完成授权','Complete sign-in in your browser'),completed:t('账号已安全保存','Account saved securely'),failed:t('账号授权未完成，请重试','Sign-in did not complete; please retry'),switched:t('账号已切换','Account switched')};
  return `<div class="content"><section class="card stack"><h2>${text('账号切换','Account switching')}</h2>
  <p class="muted">${text('每个账号首次通过官方网页授权，登录状态仅在本机加密保存。切换前请暂停队列并退出 Codex、CLI 和 IDE 会话；切换后可重新打开 Codex。','Authorize each account on the official sign-in page. Credentials are encrypted on this device. Pause queues and exit Codex, CLI and IDE sessions before switching, then reopen Codex.')}</p>
  <label class="stack">${text('账号简称（可选）','Account name (optional)')}<input id="login-name" maxlength="40" placeholder="${text('例如：工作账号','For example: Work')}"></label>
  <div class="row wrap"><button class="primary" data-action="login-add" ${disabled}>${text('浏览器授权添加','Add with browser sign-in')}</button><button data-action="login-embedded" ${disabled}>${text('应用内授权（实验）','In-app sign-in (experimental)')}</button><button data-action="login-capture" ${disabled}>${text('保存当前登录','Save current sign-in')}</button>${s.busy?`<button data-action="login-cancel">${text('取消授权','Cancel sign-in')}</button>`:''}</div>
  <p class="tiny muted">${text('切换将启用 Codex 文件登录模式，并保留现有配置与聊天历史。应用内登录不兼容时，请改用系统浏览器。','Switching enables Codex file-based sign-in and preserves configuration and chat history. Use the system browser if in-app sign-in is incompatible.')}</p>
  <div class="state-card" role="status">${e(s.job?.error||status[s.job?.status]||t('添加账号后即可选择切换','Add an account to switch between saved sign-ins'))}</div>
  ${s.restartRequired?`<p class="tiny">${text('账号已切换，请重新打开 Codex','Account switched; reopen Codex')}</p>`:''}
  <div class="stack">${(s.profiles||[]).map(p=>`<section class="state-card stack" data-login-profile="${e(p.id)}"><div class="account-card-head"><div class="account-card-info stack"><div class="row between"><strong>${e(p.name||p.email)}</strong>${p.id===s.activeId?`<span class="tiny muted">${text('上次选择','Last selected')}</span>`:''}</div><span class="tiny muted">${e(p.email)} · ${e(p.plan||'ChatGPT')}</span><span class="tiny muted">${text('工作区','Workspace')}: ${e(p.workspace)}</span></div><div class="account-card-quota ${p.quota?.current===false?'sidebar-account inactive':''}" data-login-quota="${e(p.id)}">${accountQuotaSummary({quota:p.quota,pool,t,escape:e,language})}</div></div><div class="row wrap"><input data-login-name="${e(p.id)}" maxlength="40" value="${e(p.name||'')}" placeholder="${e(p.email)}" aria-label="${text('账号简称','Account name')}"><button data-action="login-rename" data-id="${e(p.id)}" ${disabled}>${text('保存名称','Save name')}</button><button class="primary" data-action="login-switch" data-id="${e(p.id)}" data-name="${e(p.name||p.email)}" ${disabled}>${text('切换并打开 Codex','Switch and open Codex')}</button><button data-action="login-remove" data-id="${e(p.id)}" ${disabled}>${text('移除保存的登录','Remove saved sign-in')}</button></div></section>`).join('')||`<p class="muted">${text('尚未保存可切换的登录账号','No switchable sign-ins saved yet')}</p>`}</div></section></div>`;
}
