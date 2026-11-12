import {recoverRestore, RECOVERY_KEY} from './backup.mjs';

export function createStoreAccess(getStorage:()=>Storage) {
  let recoveryChecked = false, recoveryError = '', lastError = '';
  const damaged = new Map<string, string>();
  const observed = new Map<string, string|null>(), unreadable = new Set<string>();
  const recoveryMessage = '资料恢复尚未完成，已暂停保存。请保留恢复记录，释放浏览器空间后重试。';
  function retryRecovery() {
    try {
      recoverRestore(getStorage());
      recoveryChecked = true;
      recoveryError = '';
      lastError = '';
      return true;
    } catch {
      recoveryChecked = false;
      recoveryError = recoveryMessage;
      return false;
    }
  }
  function storageProblem() {
    return recoveryError || lastError || (damaged.size ? '部分本机资料无法读取，已保留原值并暂停覆盖。请导出其他范围，再用有效备份恢复受影响范围。' : unreadable.size ? '部分本机资料尚未重新读取，已暂停旧内容保存。请重新读取本机资料后再编辑。' : '');
  }
  function readStore<T>(key:string, fallback:T):T {
    const fullKey = 'modelymate.' + key;
    try {
      if (!recoveryChecked && !recoveryError) retryRecovery();
      const raw = getStorage().getItem(fullKey);
      // A failed recovery can leave a partially restored value readable. It is
      // useful for display, but must not become a new write baseline yet.
      if (recoveryError) unreadable.add(fullKey);
      else { observed.set(fullKey, raw); unreadable.delete(fullKey); }
      if (raw === null) { damaged.delete(fullKey); return fallback; }
      try {
        const result = JSON.parse(raw);
        if (result === null || typeof result !== typeof fallback || Array.isArray(result) !== Array.isArray(fallback)) throw new Error('Invalid stored data');
        damaged.delete(fullKey);
        return result;
      } catch {
        damaged.set(fullKey, raw);
        return fallback;
      }
    } catch {
      unreadable.add(fullKey);
      lastError = '浏览器无法读取本机资料，尚未覆盖原资料。请检查浏览器存储权限后重试。';
      return fallback;
    }
  }
  function writeStore(key:string, value:unknown) {
    const fullKey = 'modelymate.' + key;
    try {
      const storage = getStorage();
      // Do not save stale in-memory values after an interrupted restore; retry and reload explicitly.
      if (storage.getItem(RECOVERY_KEY) !== null) { recoveryChecked = false; recoveryError = recoveryMessage; return false; }
      // Once access/recovery failed, only an explicit recovery and successful
      // read may unblock saving. Automatic retry here would save old defaults.
      if (recoveryError || (!recoveryChecked && !retryRecovery())) return false;
      if (unreadable.has(fullKey) || damaged.has(fullKey)) return false;
      if (observed.has(fullKey) && storage.getItem(fullKey) !== observed.get(fullKey)) {
        unreadable.add(fullKey);
        lastError = '本机资料已恢复或在其他页面更新，已暂停旧内容保存。请重新读取资料后再编辑。';
        return false;
      }
      const raw = JSON.stringify(value);
      if (raw === undefined) throw new Error('Value cannot be serialized');
      storage.setItem(fullKey, raw);
      observed.set(fullKey, raw);
      lastError = '';
      return true;
    } catch {
      lastError = '浏览器存储空间不足或不可访问，资料未保存。请先导出备份，再检查空间与存储权限。';
      return false;
    }
  }
  return {retryRecovery, storageProblem, recoveryProblem:()=>recoveryError, readStore, writeStore};
}
const browserStore = createStoreAccess(()=>localStorage);
export const {retryRecovery, storageProblem, recoveryProblem, readStore, writeStore} = browserStore;
export type GarageSettings = {paint:string;finish:string;livery:string;environment:string;rain:boolean;arrival:boolean;vehicleModels?:Record<string,string>};
export const garageDefaults:GarageSettings = {paint:'pearl',finish:'gloss',livery:'plain',environment:'studio',rain:false,arrival:true};
export function scopedKey(scope:string, car:number, kind:string) { return `${scope}.${car}.${kind}`; }
