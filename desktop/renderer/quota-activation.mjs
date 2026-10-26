import {localActivationTime} from '../../src/core/activation-schedule.mjs';
export function activationView(value,draft,{e,t}){
  const s=value??{},c=draft??s.config??{},r=s.recommendation,j=s.job;
  const mode=c.scheduleMode??(c.scheduledAt?'once':'off'),time=c.scheduleTime??(c.scheduledAt?localActivationTime(c.scheduledAt):'08:00');
  return `<section class="card stack"><h2>${e(t('额度启动','Quota activation'))}</h2>
    <h3>${e(t('Credits 使用保护','Credits protection'))}</h3>
    <label class="row between">${e(t('套餐额度耗尽时通知','Notify when plan quota is exhausted'))}<input id="activation-credits-notifications" class="switch" role="switch" type="checkbox" ${c.creditsNotificationsEnabled!==false?'checked':''}></label>
    <label class="stack">${e(t('触发条件','Trigger'))}<select id="activation-credits-trigger"><option value="both" ${c.creditsTrigger!=='either'?'selected':''}>${e(t('5 小时和每周额度都为 0','Both 5-hour and weekly quotas reach 0'))}</option><option value="either" ${c.creditsTrigger==='either'?'selected':''}>${e(t('任意一项额度为 0','Either quota reaches 0'))}</option></select></label>
    <label class="row between">${e(t('触发时停止全部当前任务（每轮一次）','Stop all current tasks once per exhaustion episode'))}<input id="activation-credits-stop" class="switch" role="switch" type="checkbox" ${c.stopOnCreditsEnabled?'checked':''}></label>
    <p class="tiny muted">${e(t('仅对已接入管理器的会话生效；暂停所有队列并请求中断当前任务。额度恢复后重新启用下一轮保护。额度为 0 不代表已实际扣除 Credits。','Applies to connected sessions only. Pause all queues and request interruption of current tasks once; quota recovery rearms protection. Zero quota does not prove a Credits charge.'))}</p>
    <p data-activation-credits-status class="tiny" role="status">${e(t(s.creditsProtection?.result?.message??''))}</p><hr>
    <label class="row between">${e(t('额度重置系统通知','Quota reset notifications'))}<input id="activation-notifications" class="switch" role="switch" type="checkbox" ${c.notificationsEnabled!==false?'checked':''}></label>
    <p class="tiny muted">${e(t('5 小时、每周额度重置时提醒；同时重置合并通知。需保持管理器在后台运行，并允许系统通知。无需开启自动发消息。','Notify when 5-hour or weekly quotas reset; simultaneous resets are combined. Keep the manager running and allow system notifications. Automatic messages are not required.'))}</p>
    <p class="tiny muted">${e(t('使用 GPT-6 Luna 发送独立短消息，收到回复即停止，每次最多尝试 3 次。','Send an isolated short message with GPT-6 Luna, stop on the first reply, and try at most 3 times.'))}</p>
    <label class="row between">${e(t('周额度重置后自动启动','Activate after weekly reset'))}<input id="activation-weekly" class="switch" role="switch" type="checkbox" ${c.weeklyEnabled?'checked':''}></label>
    <label class="stack">${e(t('重置时间容差（分钟）','Reset tolerance (minutes)'))}<input id="activation-tolerance" type="number" min="1" max="60" value="${e(c.toleranceMinutes??10)}"></label>
    <p class="tiny muted">${e(t('以新到期时间接近当前时间 + 7 天确认周重置；预约启动则检查 + 5 小时。','Verify weekly activation near now + 7 days; scheduled activation checks now + 5 hours.'))}</p>
    <label class="stack">${e(t('预约方式','Schedule'))}<select id="activation-mode"><option value="off" ${mode==='off'?'selected':''}>${e(t('不预约','Off'))}</option><option value="daily" ${mode==='daily'?'selected':''}>${e(t('每天重复','Every day'))}</option><option value="once" ${mode==='once'?'selected':''}>${e(t('仅明天一次','Tomorrow only'))}</option></select></label>
    <label class="stack">${e(t('触发时间（本机时间）','Time (local)'))}<input id="activation-time" type="time" value="${e(time)}" ${mode==='off'?'disabled':''}></label>
    <p class="tiny muted">${e(t('单次只在明天的指定时间执行；每天重复会在下一个指定时间开始，之后每天执行。电脑需保持唤醒、服务运行；错过超过 15 分钟不补发，当天错过不影响后续每日预约。','Tomorrow only runs once tomorrow. Every day starts at the next chosen time and repeats daily. Keep the computer awake and service running; occurrences missed by over 15 minutes are skipped without cancelling future days.'))}</p>
    <p data-activation-schedule class="tiny muted">${s.config?.scheduledAt?e(t('已保存的下次预约：{0}','Saved next activation: {0}',new Date(s.config.scheduledAt).toLocaleString())):''}</p>
    <div class="row wrap"><button data-action="activation-save">${e(t('保存设置','Save settings'))}</button><button data-action="activation-run" ${s.busy||['waiting','running','verifying'].includes(j?.status)?'disabled':''}>${e(t('立即启动一次','Activate now'))}</button><button data-action="activation-cancel">${e(t('停止并取消预约','Stop and cancel schedule'))}</button></div>
    <div data-activation-status role="status" class="tiny">${e(j?`${j.status} · ${j.attempts}/3 · ${t(j.message??'')}`:t('尚未执行探测','No probe yet'))}</div><div data-activation-recommendation>
    <hr><h3>${e(t('起床前提前多久','How long before waking'))}</h3>
    <p>${e(r?.leadHours!=null?t('建议提前 {0} 小时触发','Activate {0} hours before waking',r.leadHours):t('有效历史不足，至少需要 3 个有足够用量的周期。','Not enough history: at least 3 cycles with sufficient usage are required.'))}</p>
    ${r?.leadHours!=null?`<p class="tiny muted">${e(t('近期 {0} 个周期，预计活跃使用 {1} 小时用完；建议范围提前 {2}–{3} 小时。','Across {0} recent cycles, estimated active use is {1} hours; suggested lead range is {2}–{3} hours.',r.sampleCount,r.consumptionHours,r.leadMinHours,r.leadMaxHours))}</p>`:''}
    <p class="tiny muted">${e(t('按近 21 天、最多 10 个周期估算：提前量 = 5 小时 − 预计用完时间。由你按起床时间设置预约，不保证实际耗尽时间。','Based on up to 10 cycles in 21 days: lead time = 5 hours minus estimated consumption time. Set your schedule from your wake-up time; actual usage varies.'))}</p>
    </div></section>`;
}
