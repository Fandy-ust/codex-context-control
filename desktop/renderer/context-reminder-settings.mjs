import {DEFAULT_REMINDER_CONFIG,CONTEXT_REMINDER_FIELDS} from '../../src/core/context-reminder-config.mjs';

export function contextReminderSettings(reminders,draft,{e,t,busy=false,available=true,expanded=false,dirty=false,preview=''}){
  const config=draft??reminders?.config??DEFAULT_REMINDER_CONFIG;
  const fields=[['minIntervalSeconds','状态变化最短间隔（秒）',0,3600],['intervalSeconds','常规提醒最短间隔（秒）',0,3600],['toolCalls','累计工具调用次数',1,1000],['growthTokens','上下文增量（tokens，0 为关闭）',0,1000000],['maxIntervalSeconds','最长提醒间隔（秒）',1,3600]];
  return `<div class="content"><section class="card stack"><label class="row between" for="context-reminders"><h2>${e(t('工作中提醒上下文状态'))}</h2><input type="checkbox" id="context-reminders" class="switch" ${reminders?.enabled?'checked':''} ${busy||!available?'disabled':''}></label><p class="tiny muted">${e(t('默认关闭。工具执行后按上下文变化补充短状态，压缩后重新提醒；不打断当前轮次，也不自动扩容或压缩。'))}</p><p class="tiny muted" role="status">${e(t(reminders?.message||'上下文提醒已关闭'))}</p><p class="tiny muted">${e(t('开启后请在 Codex 设置的 Hooks 中审核并信任新增 Hook，已运行的会话可能需要重新打开。提醒会占用少量上下文；暂不覆盖所有工具。'))}</p>${reminders?.error?`<p class="tiny error">${e(reminders.error)}</p>`:''}
    <label class="row between" for="context-reminders-all"><span>${e(t('为所有聊天开启自动管理'))}</span><input type="checkbox" id="context-reminders-all" class="switch" ${reminders?.allChats?'checked':''} ${busy||!available||!reminders?.enabled?'disabled':''}></label>
    <p class="tiny muted">${e(t('默认关闭，需逐个开启。打开后现有和新聊天默认开启，仍可在单个聊天中关闭。'))}</p>
    <label class="row between" for="context-reminders-notifications"><span>${e(t("上下文管理开发通知"))}</span><input type="checkbox" id="context-reminders-notifications" class="switch" ${reminders?.operationNotifications?'checked':''} ${busy||!available?'disabled':''}></label>
    <p class="tiny muted">${e(t("默认关闭。发送状态提醒，或 CLI 请求扩容、压缩时显示系统通知。"))}</p>
    <details id="context-reminder-experiment" class="reminder-experiment" ${expanded?'open':''}><summary>${e(t('实验参数'))}${dirty?` · ${e(t('尚未保存'))}`:''}</summary><div class="stack reminder-experiment-body">
    <p class="tiny muted">${e(t('参数保存在本机，保存后从下一次 Hook 调用生效。可以关闭提醒后先编辑和预览。'))}</p>
    <label class="stack tiny" for="reminder-prompt">${e(t('英文提示词'))}<textarea id="reminder-prompt" class="reminder-editor" rows="8" maxlength="12000" spellcheck="false">${e(config.prompt)}</textarea></label>
    <p class="tiny muted">${e(t('完整提示词在启用后的首个有效 Hook、手动提交和压缩后发送；后续工具提醒只发送状态。'))}</p>
    <label class="stack tiny" for="reminder-template">${e(t('上下文信息嵌入格式'))}<textarea id="reminder-template" class="reminder-editor" rows="9" maxlength="12000" spellcheck="false">${e(config.template)}</textarea></label>
    <details><summary class="tiny">${e(t('可用占位符'))}</summary><p class="tiny muted reminder-fields">${CONTEXT_REMINDER_FIELDS.map(field=>`<code>{${e(field)}}</code>`).join(' · ')}</p><p class="tiny muted">${e(t('使用 _raw 字段可生成 JSON 数字；未知值为 null。模板只进行文本替换，不执行代码。'))}</p></details>
    <h3>${e(t('嵌入频率'))}</h3><div class="reminder-frequency">${fields.map(([key,label,min,max])=>`<label class="stack tiny" for="reminder-${key}">${e(t(label))}<input id="reminder-${key}" data-reminder-frequency="${key}" type="number" min="${min}" max="${max}" step="1" value="${e(config.frequency[key])}"></label>`).join('')}</div>
    <p class="tiny muted">${e(t('新轮次和压缩后始终提醒。工具完成后：状态变化满足最短间隔，或达到常规间隔且满足调用次数或增量条件，或达到最长间隔时注入。不会为提醒单独启动轮次。'))}</p>
    <div class="row wrap"><button data-action="reminder-preview" ${busy||!available?'disabled':''}>${e(t('预览嵌入内容'))}</button><button data-action="reminder-defaults" ${busy?'disabled':''}>${e(t('恢复默认参数'))}</button><button data-action="reminder-reload" ${busy?'disabled':''}>${e(t('重新载入'))}</button><span class="grow"></span><button class="primary" data-action="reminder-save" ${busy||!available?'disabled':''}>${e(t('保存实验参数'))}</button></div>
    ${preview?`<p class="tiny muted">${e(t('预览不会发送给模型；缺少观测时显示 unknown。'))}</p><pre class="reminder-preview" tabindex="0">${e(preview)}</pre>`:''}
    </div></details></section></div>`;
}
