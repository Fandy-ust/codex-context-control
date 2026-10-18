import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {root, codexHome} from './paths.mjs';

export function createQuotaAnalyticsService({home = root, historyHome = codexHome, timeout = 60000, idleMs = 30000} = {}) {
  let worker, sequence = 0, salt, closed = false, scanPending, reportPending, idleTimer;
  let retiring = Promise.resolve();
  const pending = new Map();
  function retire() {
    clearTimeout(idleTimer);
    const instance = worker;if (!instance) return retiring;
    worker = null;instance.ref();
    const exited = new Promise(resolve => {
      const done=()=>{clearTimeout(timer);resolve();};
      const timer = setTimeout(() => {void instance.terminate().finally(done);}, 2000);timer.unref();
      instance.once('exit', done);
      try{instance.postMessage({id: 0, action: 'close'});}catch{void instance.terminate().finally(done);}
    });
    retiring = Promise.all([retiring, exited]).then(() => {});
    return retiring;
  }
  const stop = error => {clearTimeout(idleTimer);for (const item of pending.values()) {clearTimeout(item.timer);item.reject(error);}pending.clear();return retire();};
  async function ensureWorker() {
    clearTimeout(idleTimer);
    if (closed) throw Error('Analytics service closed');
    await retiring;
    if (closed) throw Error('Analytics service closed');
    if (worker) return worker;
    const instance = worker = new Worker(new URL('./analytics/worker.mjs', import.meta.url), {workerData: {file: path.join(home, 'quota-history.sqlite'), home: historyHome}, resourceLimits: {maxOldGenerationSizeMb: 256}, execArgv: []});
    worker.on('message', reply => {const item = pending.get(reply.id);if (!item) return;pending.delete(reply.id);clearTimeout(item.timer);reply.error ? item.reject(Error(reply.error)) : item.resolve(reply.result);if (!pending.size){worker?.unref();idleTimer=setTimeout(()=>{void retire();},idleMs);idleTimer.unref();}});
    worker.on('error', error => {if(worker===instance)stop(Error('额度历史读取失败，请刷新重试',{cause:error}));});
    worker.on('exit', () => {if(worker!==instance)return;worker=null;if (pending.size) stop(Error('额度统计进程已退出，请重试'));});
    worker.unref();return worker;
  }
  async function call(action, params) {
    const w = await ensureWorker();
    if (closed) throw Error('Analytics service closed');
    if (pending.size >= 8) return Promise.reject(Error('额度统计正在处理，请稍后刷新'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {stop(Error('额度统计耗时过长，请稍后重试'));}, timeout);timer.unref();
      pending.set(id, {resolve, reject, timer});w.ref();w.postMessage({id, action, params});
    });
  }
  function accountScope(account) {
    const identity = account?.id || account?.email;
    if (typeof identity !== 'string' || !identity.trim()) return 'unidentified';
    if (!salt) {
      fs.mkdirSync(home, {recursive: true, mode: 0o700});const file = path.join(home, 'quota-history.key');
      try {fs.writeFileSync(file, crypto.randomBytes(32), {flag: 'wx', mode: 0o600});} catch (error) {if (error.code !== 'EEXIST') throw error;}
      salt = fs.readFileSync(file);if (salt.length !== 32) throw Error('Invalid quota history key');
    }
    return 'account:' + crypto.createHmac('sha256', salt).update(JSON.stringify([account.type, identity.trim().toLowerCase(), account.planType || null])).digest('hex').slice(0, 32);
  }
  return {
    record: async ({buckets, account, at}) => {const scope=accountScope(account);await call('record',{buckets,scope,at});return scope;},
    scan: () => scanPending ||= call('scan').finally(() => {scanPending = null;}),
    report: params => {
      const key = JSON.stringify(params || {});
      if (reportPending?.key === key) return reportPending.task;
      const task = call('report', params).finally(() => {if (reportPending?.task === task) reportPending = null;});reportPending = {key, task};return task;
    },
    close: () => {closed = true;return stop(Error('Analytics service closed'));}
  };
}
