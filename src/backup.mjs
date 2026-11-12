import {validateRule} from './core.mjs';

export const BACKUP_KINDS = ['journals', 'costs', 'rules', 'trips', 'health', 'automaticPricing', 'aliases', 'drivers'];
export const BACKUP_LABELS = {journals:'分类与备注', costs:'充电费用', rules:'电价规则', trips:'旅途编组', health:'健康快照', automaticPricing:'自动估算设置', aliases:'地点别名', drivers:'司机名单'};
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export const RECOVERY_KEY = 'modelymate.restore-recovery.v1';
const defaults = {journals:{}, costs:{}, rules:[], trips:[], health:[], automaticPricing:false, aliases:{}, drivers:[]};
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, n) => typeof v === 'string' && v.length <= n;
const scopeID = v => text(v, 200) && v.length > 0 && !/[\u0000-\u001f]/.test(v);
const id = v => Number.isSafeInteger(v) && v > 0;
const finite = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const dateTime = v => text(v, 40) && Number.isFinite(Date.parse(v));
const storeKey = (scope, carID, kind) => `modelymate.${scope}.${carID}.${kind}`;
const undoKey = (scope, carID) => storeKey(scope, carID, 'restoreUndo');
function check(ok, message) { if (!ok) throw new Error(message); }
function safeTree(value, depth = 0) {
  check(depth <= 12, '备份层级过深');
  if (value && typeof value === 'object') for (const [key, v] of Object.entries(value)) {
    check(!['__proto__', 'prototype', 'constructor'].includes(key), '备份含有不安全的字段');
    safeTree(v, depth + 1);
  }
}
function validKinds(kinds, available = BACKUP_KINDS) {
  return Array.isArray(kinds) && kinds.length > 0 && kinds.every(k => available.includes(k)) && new Set(kinds).size === kinds.length;
}
export function validateBackup(input) {
  check(object(input) && input.format === 'ModelYMate-local' && input.version === 1, '不支持的备份格式或版本');
  safeTree(input);
  check(scopeID(input.scope) && id(input.carID) && dateTime(input.exportedAt), '备份身份或时间无效');
  check(object(input.data) && validKinds(Object.keys(input.data)), '备份包含无法识别或空的数据范围');
  for (const [kind, value] of Object.entries(input.data)) {
    const err = BACKUP_LABELS[kind] + '格式不正确';
    if (kind === 'automaticPricing') { check(typeof value === 'boolean', err); continue; }
    if (['journals', 'costs', 'aliases'].includes(kind)) check(object(value) && Object.keys(value).length <= 100000, err);
    else check(Array.isArray(value) && value.length <= (kind === 'health' ? 366 : 10000), err);
    if (kind === 'journals') for (const [key, v] of Object.entries(value)) {
      check(/^[1-9]\d*$/.test(key) && id(Number(key)) && object(v), err);
      for (const k of ['category', 'subcategory', 'note', 'driver']) if (v[k] !== undefined) check(text(v[k], k === 'note' ? 2000 : 80), err);
    }
    if (kind === 'costs') for (const [key, v] of Object.entries(value)) {
      check(/^[1-9]\d*$/.test(key) && id(Number(key)) && object(v) && finite(v.amount) && /^[A-Z]{3}$/.test(v.currency) && ['manual', 'estimate'].includes(v.source ?? 'manual'), err);
      if (v.rate !== undefined) check(finite(v.rate), err);
    }
    if (kind === 'rules') {
      const ids = new Set();
      for (const r of value) {
        check(object(r) && text(r.id, 100) && r.id.length > 0 && !ids.has(r.id) && text(r.name, 80) && r.name.trim().length > 0 && text(r.timezone, 100) && r.timezone.length > 0 && Array.isArray(r.periods) && r.periods.every(object) && !validateRule(r), err);
        ids.add(r.id);
      }
    }
    if (kind === 'trips') {
      const ids = new Set();
      for (const t of value) {
        check(object(t) && text(t.id, 100) && t.id.length > 0 && !ids.has(t.id) && text(t.title, 80) && t.title.trim().length > 0 && (t.note === undefined || text(t.note, 500)) && Array.isArray(t.driveIDs) && t.driveIDs.length > 0 && t.driveIDs.length <= 200 && t.driveIDs.every(id) && new Set(t.driveIDs).size === t.driveIDs.length, err);
        ids.add(t.id);
      }
    }
    if (kind === 'health') {
      const days = new Set();
      for (const h of value) {
        check(object(h) && text(h.day, 10) && /^\d{4}-\d{2}-\d{2}$/.test(h.day) && Number.isFinite(Date.parse(h.day)) && new Date(h.day).toISOString().slice(0, 10) === h.day && !days.has(h.day) && finite(h.percentage) && h.percentage <= 100 && (h.capacity == null || finite(h.capacity)), err);
        days.add(h.day);
      }
    }
    if (kind === 'aliases') for (const [key, v] of Object.entries(value)) check(text(key, 500) && key.length > 0 && text(v, 80) && v.trim().length > 0, err);
    if (kind === 'drivers') check(value.every(v => text(v, 80) && v.trim().length > 0) && new Set(value).size === value.length, err);
  }
  return input;
}
export function parseBackup(raw) {
  check(typeof raw === 'string' && new TextEncoder().encode(raw).length <= MAX_BACKUP_BYTES, '备份超过 5 MB，无法导入');
  let input;
  try { input = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { throw new Error('无法读取 JSON 备份'); }
  return validateBackup(input);
}
export function serializeBackup(backup) {
  validateBackup(backup);
  const raw = JSON.stringify(backup);
  check(new TextEncoder().encode(raw).length <= MAX_BACKUP_BYTES, '资料超过 5 MB，请减少勾选的导出范围');
  return raw;
}
export function createBackup(storage, scope, carID, kinds = BACKUP_KINDS) {
  check(scopeID(scope) && id(carID), '目标车辆无效');
  check(validKinds(kinds), '请选择有效导出范围');
  check(storage.getItem(RECOVERY_KEY) === null, '有未完成的资料恢复，请先重试恢复原资料');
  const data = {};
  for (const kind of kinds) {
    const raw = storage.getItem(storeKey(scope, carID, kind));
    try { data[kind] = raw === null ? structuredClone(defaults[kind]) : JSON.parse(raw); }
    catch { throw new Error(BACKUP_LABELS[kind] + '无法读取，原资料已保留；可取消该范围后导出其他资料'); }
  }
  const backup = {format:'ModelYMate-local', version:1, scope, carID, exportedAt:new Date().toISOString(), data};
  serializeBackup(backup);
  return backup;
}
export function backupCounts(b) {
  return Object.entries(b.data).map(([kind, v]) => ({kind, label:BACKUP_LABELS[kind], count:typeof v === 'boolean' ? (v ? 1 : 0) : Object.keys(v).length}));
}

function validEntries(entries, scope, carID) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > BACKUP_KINDS.length) return false;
  const keys = new Set();
  return entries.every(entry => {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [key, value] = entry;
    const validKey = typeof key === 'string' && (scope === undefined
      ? /^modelymate\..+\.[1-9]\d*\.(journals|costs|rules|trips|health|automaticPricing|aliases|drivers)$/.test(key)
      : BACKUP_KINDS.some(kind => key === storeKey(scope, carID, kind)));
    if (!validKey || keys.has(key) || (value !== null && typeof value !== 'string')) return false;
    keys.add(key);
    return true;
  });
}
function readRecovery(raw) {
  let record;
  try { record = JSON.parse(raw); } catch { throw new Error('恢复记录无法读取，原记录已保留'); }
  check(object(record), '恢复记录无效');
  if (record.version === undefined) {
    check(validEntries(record.entries), '恢复记录无效');
  } else {
    check(record.version === 2 && scopeID(record.scope) && id(record.carID) && validEntries(record.entries, record.scope, record.carID) && (record.previousUndo === null || typeof record.previousUndo === 'string'), '恢复记录无效');
  }
  return record;
}
function applyEntries(storage, entries) {
  for (const [key, value] of entries) {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  }
}
export function recoverRestore(storage) {
  const raw = storage.getItem(RECOVERY_KEY);
  if (raw === null) return false;
  const recovery = readRecovery(raw);
  applyEntries(storage, recovery.entries);
  if (recovery.version === 2) applyEntries(storage, [[undoKey(recovery.scope, recovery.carID), recovery.previousUndo]]);
  storage.removeItem(RECOVERY_KEY);
  return true;
}
function readUndo(storage, scope, carID) {
  check(scopeID(scope) && id(carID), '目标车辆无效');
  const raw = storage.getItem(undoKey(scope, carID));
  if (raw === null) return null;
  let snapshot;
  try { snapshot = JSON.parse(raw); } catch { throw new Error('最近恢复前快照无法读取，原记录已保留'); }
  check(object(snapshot) && snapshot.format === 'ModelYMate-restore-undo' && snapshot.version === 1 && snapshot.scope === scope && snapshot.carID === carID && dateTime(snapshot.createdAt) && validEntries(snapshot.entries, scope, carID), '最近恢复前快照无效，原记录已保留');
  return snapshot;
}
export function restoreSnapshotInfo(storage, scope, carID) {
  const snapshot = readUndo(storage, scope, carID);
  return snapshot ? {createdAt:snapshot.createdAt, kinds:snapshot.entries.map(([key]) => key.slice(key.lastIndexOf('.') + 1))} : null;
}
function transaction(storage, scope, carID, values, isUndo) {
  recoverRestore(storage);
  const entries = values.map(([key]) => [key, storage.getItem(key)]);
  const previousUndo = storage.getItem(undoKey(scope, carID));
  // Reserve durable rollback space before the first data change. Quota failure here leaves all data intact.
  storage.setItem(RECOVERY_KEY, JSON.stringify({version:2, scope, carID, entries, previousUndo}));
  try {
    applyEntries(storage, values);
    if (isUndo) storage.removeItem(undoKey(scope, carID));
    else storage.setItem(undoKey(scope, carID), JSON.stringify({format:'ModelYMate-restore-undo', version:1, scope, carID, createdAt:new Date().toISOString(), entries}));
    storage.removeItem(RECOVERY_KEY); // Commit point: interrupted work rolls back on startup.
  } catch {
    try { recoverRestore(storage); }
    catch { throw new Error('恢复中断，原资料恢复记录仍保留；已暂停保存，请释放浏览器空间后重试恢复。'); }
    throw new Error('未完成恢复，已还原原资料。请检查浏览器存储空间或访问权限后重试。');
  }
  return values.length;
}
export function restoreBackup(storage, backup, scope, carID, kinds) {
  serializeBackup(backup);
  check(scopeID(scope) && id(carID), '目标车辆无效');
  check(validKinds(kinds, Object.keys(backup.data)), '请选择有效恢复范围');
  return transaction(storage, scope, carID, kinds.map(kind => [storeKey(scope, carID, kind), JSON.stringify(backup.data[kind])]), false);
}
export function undoRestore(storage, scope, carID) {
  recoverRestore(storage);
  const snapshot = readUndo(storage, scope, carID);
  check(snapshot !== null, '没有可以撤销的恢复');
  return transaction(storage, scope, carID, snapshot.entries, true);
}

// Tie asynchronous File.text() results to the latest selection and cancel on unmount.
export function createBackupReader() {
  let sequence = 0;
  return {
    cancel() { sequence++; },
    async read(file) {
      const request = ++sequence;
      if (!file) return {status:'cancelled'};
      try {
        check(Number.isFinite(file.size) && file.size <= MAX_BACKUP_BYTES, '备份超过 5 MB，无法导入');
        const raw = await file.text();
        if (request !== sequence) return {status:'cancelled'};
        return {status:'ready', backup:parseBackup(raw)};
      } catch (error) {
        if (request !== sequence) return {status:'cancelled'};
        return {status:'error', error:error instanceof Error ? error.message : '无法读取备份文件'};
      }
    }
  };
}
