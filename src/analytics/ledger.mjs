import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {canonicalLocalPath, pathInside} from '../local-path.mjs';
import {DAY} from '../core/quota-statistics.mjs';

const RETENTION = 366 * DAY;
const MAX_RECORD = 1024 * 1024;
const text = (value, max = 160) => typeof value === 'string' && value.length <= max && !/[\r\n]/.test(value) ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function quotaWindow(value) {
  if (!value || !Number.isFinite(value.usedPercent ?? value.used_percent)) return null;
  return {used: value.usedPercent ?? value.used_percent, minutes: value.windowDurationMins ?? value.window_minutes, reset: value.resetsAt ?? value.resets_at};
}
export function projectQuota(bucket, {at, scope = 'history', bucketId = 'codex'} = {}) {
  const windows = [quotaWindow(bucket?.primary), quotaWindow(bucket?.secondary)].filter(Boolean);
  const weekly = windows.find(w => w.minutes === 10080), five = windows.find(w => w.minutes === 300);

  const valid = w => w && w.used >= 0 && w.used <= 100 && Number.isSafeInteger(w.reset) && w.reset > 0 && w.reset < 8640000000000;
  const wk = valid(weekly) ? weekly : null, fh = valid(five) ? five : null;
  const raw=bucket?.creditBalance ?? bucket?.credits?.balance;
  const credits=bucket?.unlimitedCredits===true||bucket?.credits?.unlimited===true?null:typeof raw==='number'||typeof raw==='string'&&/^\d+(?:\.\d+)?$/.test(raw.trim())?Number(raw):null;
  const balance=Number.isFinite(credits)&&credits>=0?credits:null;
  if (!wk && !fh && balance==null) return null;
  return {at, scope, bucket: text(bucketId) || 'codex', weeklyUsed: wk?.used ?? null, weeklyReset: wk?.reset ?? null,
    fiveUsed: fh?.used ?? null, fiveReset: fh?.reset ?? null,credits:balance};
}
const snapshotId = value => JSON.stringify([value.scope,value.bucket,Math.floor(value.at/60000),value.weeklyReset,value.fiveReset,value.weeklyUsed,value.fiveUsed,value.credits??null]);
function nativeRows(home) {
  let db;
  try {
    const file = fs.readdirSync(home).filter(n => /^state_\d+\.sqlite$/.test(n)).sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]))[0];
    if (!file) return [];
    db = new DatabaseSync(path.join(home, file), {readOnly: true});
    const cols = new Set(db.prepare('PRAGMA table_info(threads)').all().map(p => p.name));
    if (!cols.has('id') || !cols.has('rollout_path')) return [];
    const fields = ['id', 'rollout_path', 'cwd', 'name'].filter(f => cols.has(f));
    const order = cols.has('updated_at') ? ' ORDER BY updated_at DESC' : '';
    return db.prepare('SELECT ' + fields.join(',') + ' FROM threads' + order + ' LIMIT 10000').all();
  } catch {return [];} finally {db?.close();}
}

// Dedicated numeric ledger. No messages, prompt text, tool arguments, account
// emails, auth tokens or original history rewrites are stored here.
export class QuotaLedger {
  constructor({file, home, now = Date.now} = {}) {
    this.file = file;this.home = home;this.now = now;this.progress = {files: 0, pending: 0, unreadable: 0, bytesRead: 0};
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    this.db = new DatabaseSync(file);fs.chmodSync(file, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, source TEXT NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS requests_time ON requests(at);
      CREATE INDEX IF NOT EXISTS requests_source ON requests(source);
      CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, source TEXT NOT NULL, scope TEXT NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS snapshots_time ON snapshots(at);
      CREATE INDEX IF NOT EXISTS snapshots_source ON snapshots(source);`);
    const schema = this.db.prepare('SELECT value FROM meta WHERE key=?').get('schema');
    if (schema && schema.value !== '1') {this.db.close();throw Error('Unsupported quota ledger version');}
    this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('schema', '1');
    // Revisit existing files once to backfill the longer cost history and write counts.
    if(this.metadata('costHistoryVersion')!==1){this.db.exec('DELETE FROM sources');this.setMetadata('costHistoryVersion',1);}
    if(this.metadata('quotaSamplingVersion')!==2){
      // Rekey saved observations before rescanning, so backfilled JSONL rows
      // enrich history without duplicating the previous minute-level reading.
      this.db.exec('BEGIN');
      try{
        const insert=this.db.prepare('INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?)'),remove=this.db.prepare('DELETE FROM snapshots WHERE id=?');
        for(const row of this.db.prepare('SELECT * FROM snapshots').all()){
          const value=JSON.parse(row.data),key=snapshotId(value);
          if(key!==row.id){insert.run(key,row.source,row.scope,row.at,row.data);remove.run(row.id);}
        }
        this.db.exec('DELETE FROM sources');this.setMetadata('quotaSamplingVersion',2);this.db.exec('COMMIT');
      }catch(error){this.db.exec('ROLLBACK');throw error;}
    }
    this.putSource = this.db.prepare('INSERT OR REPLACE INTO sources VALUES (?,?)');
    this.putRequest = this.db.prepare("INSERT INTO requests VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE requests.source=excluded.source AND json_extract(requests.data,'$.written') IS NULL AND json_extract(excluded.data,'$.written') IS NOT NULL");
    this.putQuota = this.db.prepare('INSERT INTO snapshots VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET at=excluded.at,data=excluded.data WHERE excluded.at>=snapshots.at');
  }
  metadata(key) {const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);return row ? JSON.parse(row.value) : null;}
  setMetadata(key, value) {this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key, JSON.stringify(value));}
  snapshot(value, source = 'live') {
    if (!value || !Number.isFinite(value.at) || value.at < this.now() - RETENTION || value.at > this.now() + 60000) return;
    // Preserve every distinct observed reading within a minute. Only identical
    // readings coalesce; do not overwrite a 1 pp change or a credit change.
    const id = snapshotId(value);
    this.putQuota.run(id, source, value.scope, value.at, JSON.stringify(value));
  }
  recordLive({scope, buckets, at}) {
    if (!/^(account:[a-f0-9]{32}|unidentified)$/.test(scope)) return;
    for (const bucket of buckets || []) this.snapshot(projectQuota(bucket, {scope, at, bucketId: bucket.id}));
    this.setMetadata('currentScope', scope);this.prune();
  }
  consume(event, source, offset) {
    const at = Date.parse(event.timestamp), p = event.payload || {};
    if (event.type === 'turn_context' && text(p.model)) source.model = p.model;
    if (event.type === 'event_msg' && p.type === 'thread_settings_applied' && text(p.thread_settings?.model)) source.model = p.thread_settings.model;
    if (!Number.isFinite(at) || at < this.now() - RETENTION || at > this.now() + 60000) return;
    if (event.type === 'token_usage_record') {
      // Copied fork history must not become newly billed child requests.
      if (p.thread_id && p.thread_id !== source.id) return;
      const usage = p.usage || {}, input = count(usage.input_tokens), output = count(usage.output_tokens);
      if (input == null || output == null) return;
      const id = text(p.response_id, 240);
      // A response ID is required for deduplication across rollouts and rescans.
      if (!id) {source.unidentifiedRequests = (source.unidentifiedRequests || 0) + 1;return;}
      const rawCached = count(usage.cached_input_tokens), cached = rawCached != null && rawCached <= input ? rawCached : null;
      const record = {id, at, thread: source.id, model: source.model || null, project: source.project, name: source.name,
        input, output, cached, written:count(usage.cache_write_input_tokens)};
      this.putRequest.run(id, source.id, at, JSON.stringify(record));
    }
    if (event.type === 'event_msg' && p.type === 'token_count') {
      const limits = p.rate_limits;
      if (limits) this.snapshot(projectQuota(limits, {at, bucketId: limits.limit_id}), source.id);
    }
  }
  scan({rows = null, budget = 16 * 1024 * 1024} = {}) {
    if(!fs.existsSync(this.home))return this.progress;
    const list = rows || nativeRows(this.home), root = canonicalLocalPath(this.home), cutoff = this.now() - RETENTION;
    const known = new Map(this.db.prepare('SELECT id,data FROM sources').all().map(p => [p.id, JSON.parse(p.data)]));
    let remaining = budget, files = 0, pending = 0, unreadable = 0, bytesRead = 0;
    // Resume the first incomplete source before starting another large file.
    list.sort((a, b) => Number(known.get(b.id)?.pending || false) - Number(known.get(a.id)?.pending || false));
    for (const row of list) {
      if (!text(row.id, 180) || !row.rollout_path) continue;
      let file, stat;
      try {file = canonicalLocalPath(row.rollout_path);if (!pathInside(root, file) || !file.endsWith('.jsonl')) continue;stat = fs.statSync(file);if (!stat.isFile() || stat.mtimeMs < cutoff) continue;} catch {unreadable++;continue;}
      files++;
      const old = known.get(row.id), fingerprint = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      if (old?.fingerprint === fingerprint && !old.pending) continue;
      if (remaining <= 0) {pending++;continue;}
      const append = old?.file === file && old.dev === stat.dev && old.ino === stat.ino && stat.size >= old.size && (old.pending || stat.size > old.size);
      const source = append ? {...old} : {id: row.id, file, dev: stat.dev, ino: stat.ino, offset: 0, model: null, dropping: false};
      source.name = text(row.name, 120);source.project = text(path.basename(row.cwd || ''), 160) || '未分类';
      let handle;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        // Rollbacks and compaction do not refund already observed consumption.
        // Restart the file cursor after replacement, but retain the numeric ledger.
        handle = fs.openSync(file, 'r');let waiting = false;
        while (source.offset < stat.size && remaining > 0) {
          const buffer = Buffer.alloc(Math.min(MAX_RECORD, stat.size - source.offset));
          const length = fs.readSync(handle, buffer, 0, buffer.length, source.offset);
          if (!length) {waiting = true;break;}
          const block = buffer.subarray(0, length);remaining -= length;bytesRead += length;
          let begin = 0;
          if (source.dropping) {const end = block.indexOf(10);if (end < 0) {source.offset += length;continue;}begin = end + 1;source.dropping = false;}
          let end;
          while ((end = block.indexOf(10, begin)) >= 0) {
            const line = block.subarray(begin, end);
            // Most history consists of messages. Only parse the narrow event
            // families needed by the ledger; raw text never leaves this scope.
            const prefix = line.subarray(0, 320).toString('utf8');
            if (/"type"\s*:\s*"(turn_context|token_usage_record|event_msg)"/.test(prefix)) {
              try {this.consume(JSON.parse(line.toString('utf8')), source, source.offset + begin);} catch {source.invalidRecords = (source.invalidRecords || 0) + 1;}
            }
            begin = end + 1;
          }
          if (begin) source.offset += begin;
          else if (length === MAX_RECORD) {source.offset += length;source.dropping = true;}
          else {waiting = true;break;}
        }
        source.size = stat.size;source.fingerprint = fingerprint;source.pending = !waiting && source.offset < stat.size;
        if (source.pending) pending++;
        this.putSource.run(row.id, JSON.stringify(source));this.db.exec('COMMIT');
      } catch {this.db.exec('ROLLBACK');unreadable++;} finally {if (handle != null) fs.closeSync(handle);}
    }
    this.progress = {files, pending, unreadable, bytesRead};this.setMetadata('progress', this.progress);this.prune();return this.progress;
  }
  prune() {
    if (this.lastPrune && this.now() - this.lastPrune < HOUR) return;
    this.lastPrune = this.now();const cutoff = this.now() - RETENTION;
    this.db.prepare('DELETE FROM requests WHERE at<?').run(cutoff);this.db.prepare('DELETE FROM snapshots WHERE at<?').run(cutoff);
    for (const table of ['requests', 'snapshots']) this.db.exec(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} ORDER BY at DESC LIMIT -1 OFFSET 250000)`);
    this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
  }
  read(days = 84) {
    const cutoff = this.now() - Math.min(366, Math.max(1, days)) * DAY;
    return {requests: this.db.prepare('SELECT data FROM requests WHERE at>=? ORDER BY at').all(cutoff).map(p => JSON.parse(p.data)),
      snapshots: this.db.prepare('SELECT data FROM snapshots WHERE at>=? ORDER BY at').all(cutoff).map(p => JSON.parse(p.data)),
      currentScope: this.metadata('currentScope'), progress: this.metadata('progress') || this.progress};
  }
  close() {this.db.close();}
}
const HOUR = 3600000;
