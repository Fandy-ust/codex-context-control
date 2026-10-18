import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {root, codexHome} from './paths.mjs';

export function createQuotaAnalyticsService({home = root, historyHome = codexHome, timeout = 60000} = {}) {
  let worker, sequence = 0, salt, closed = false, scanPending, reportPending;
  const pending = new Map();
  const stop = error => {for (const item of pending.values()) {clearTimeout(item.timer);item.reject(error);}pending.clear();worker?.terminate();worker = null;};
  function ensureWorker() {
    if (closed) throw Error('Analytics service closed');
    if (worker) return worker;
    const instance = worker = new Worker(new URL('./analytics/worker.mjs', import.meta.url), {workerData: {file: path.join(home, 'quota-history.sqlite'), home: historyHome}, resourceLimits: {maxOldGenerationSizeMb: 256}, execArgv: []});
    worker.on('message', reply => {const item = pending.get(reply.id);if (!item) return;pending.delete(reply.id);clearTimeout(item.timer);reply.error ? item.reject(Error(reply.error)) : item.resolve(reply.result);if (!pending.size) worker?.unref();});
    worker.on('error', () => {if(worker===instance)stop(Error('额度历史读取失败，请刷新重试'));});
    worker.on('exit', () => {if(worker!==instance)return;if (pending.size) stop(Error('额度统计进程已退出，请重试'));worker = null;});
    worker.unref();return worker;
  }
  function call(action, params) {
    if (pending.size >= 8) return Promise.reject(Error('额度统计正在处理，请稍后刷新'));
    return new Promise((resolve, reject) => {
      const w = ensureWorker(), id = ++sequence;
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
    close: () => {closed = true;stop(Error('Analytics service closed'));}
  };
}
