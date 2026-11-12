import {useEffect, useRef, useState} from 'react';
import {BACKUP_KINDS, BACKUP_LABELS, createBackup, restoreBackup, backupCounts, serializeBackup, restoreSnapshotInfo, undoRestore, createBackupReader} from './backup.mjs';
import {storageProblem, recoveryProblem, retryRecovery} from './storage';

function downloadBackup(backup:any) {
  const blob = new Blob([serializeBackup(backup)], {type:'application/json'});
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ModelYMate-${backup.carID}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
}
type Props = {scope:string;carID:number;notify:(message:string)=>void;onRestored?:()=>void};
type Snapshot = {createdAt:string;kinds:string[]} | null;
export default function LocalData({scope, carID, notify, onRestored}:Props) {
  const [backup, setBackup] = useState<any>(null), [selected, setSelected] = useState<string[]>([]);
  const [exportKinds, setExportKinds] = useState<string[]>([...BACKUP_KINDS]);
  const [error, setError] = useState(''), [mapped, setMapped] = useState(false), [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false), [snapshot, setSnapshot] = useState<Snapshot>(null), [confirmUndo, setConfirmUndo] = useState(false);
  const reader = useRef(createBackupReader()), busyRef = useRef(false);
  const consumedBackup = useRef<any>(null), consumedSnapshot = useRef<Snapshot>(null);
  const mismatch = backup && (backup.scope !== scope || backup.carID !== carID);
  useEffect(()=>{
    reader.current.cancel();
    setBackup(null); setSelected([]); setMapped(false); setReading(false); setError(''); setConfirmUndo(false);
    try { setSnapshot(restoreSnapshotInfo(localStorage, scope, carID) as Snapshot); }
    catch (e) { setSnapshot(null); setError((e as Error).message); }
    return ()=>reader.current.cancel();
  }, [scope, carID]);
  async function read(file?:File) {
    if (busyRef.current) return;
    setBackup(null); setSelected([]); setError(''); setMapped(false); setReading(!!file);
    const result = await reader.current.read(file);
    if (result.status === 'cancelled') return;
    setReading(false);
    if (result.status === 'error') setError(result.error!);
    else { setBackup(result.backup); setSelected(Object.keys(result.backup.data)); }
  }
  function finish(message:string) {
    notify(message);
    if (onRestored) {
      onRestored();
      setSnapshot(restoreSnapshotInfo(localStorage, scope, carID) as Snapshot);
      setBackup(null); setConfirmUndo(false);
    } else window.location.reload();
  }
  function restore(undo = false) {
    if (busyRef.current || reading || (undo ? consumedSnapshot.current === snapshot : consumedBackup.current === backup)) return;
    busyRef.current = true; setBusy(true); setError('');
    reader.current.cancel();
    try {
      if (undo) { undoRestore(localStorage, scope, carID); consumedSnapshot.current = snapshot; }
      else {
        if (!backup || !selected.length || mismatch && !mapped) return;
        restoreBackup(localStorage, backup, scope, carID, selected);
        consumedBackup.current = backup;
      }
      retryRecovery();
      finish(undo ? '已撤销上次恢复' : '所选资料已恢复；可在此撤销上次恢复');
    } catch (e) { retryRecovery(); setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  }
  if (recoveryProblem()) return <section className="card"><h2>资料恢复尚未完成</h2><p role="alert">{recoveryProblem()}</p><button className="button" onClick={()=>{if (retryRecovery()) { if (onRestored) onRestored(); else window.location.reload(); } else setError(storageProblem());}}>重试恢复原资料</button>{error && <p role="alert">{error}</p>}</section>;
  return <section className="card">
    <div className="card-heading"><h2>本机资料备份与恢复</h2></div>
    <p className="muted small">仅包含当前来源、当前车辆的下列资料；不包含车辆原始历史、登录信息、全局外观和车库设置。通过文件手动迁移到其他设备，不会自动同步。文件含地点与备注，请妥善保管。</p>
    <fieldset className="backup-preview" disabled={busy}><legend>选择导出范围</legend>
      {BACKUP_KINDS.map(kind=><label key={kind} className="backup-choice"><input type="checkbox" checked={exportKinds.includes(kind)} onChange={()=>setExportKinds(v=>v.includes(kind) ? v.filter(k=>k !== kind) : [...v, kind])}/>{BACKUP_LABELS[kind as keyof typeof BACKUP_LABELS]}</label>)}
    </fieldset>
    <div className="button-row">
      <button className="button secondary" disabled={busy || !exportKinds.length} onClick={()=>{setError('');try { downloadBackup(createBackup(localStorage, scope, carID, exportKinds)); notify('已请求下载，请确认文件已保存'); } catch (e) { setError((e as Error).message); }}}>导出所选资料</button>
      <label className="button secondary">选择备份<input aria-label="导入资料备份" className="backup-file" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void read(file);}}/></label>
    </div>
    {reading && <p role="status">正在校验备份…</p>}
    {storageProblem() && <p role="alert" className="error-banner">{storageProblem()}</p>}
    {error && <p role="alert" className="error-banner">{error}</p>}
    {backup && <div className="backup-preview">
      <p>备份日期 {new Date(backup.exportedAt).toLocaleString('zh-CN')} · 车辆 {backup.carID}</p>
      {backupCounts(backup).map((row:any)=><label key={row.kind} className="backup-choice"><input type="checkbox" disabled={busy} checked={selected.includes(row.kind)} onChange={()=>setSelected(v=>v.includes(row.kind) ? v.filter(k=>k !== row.kind) : [...v, row.kind])}/>{row.label}<span>{row.kind === 'automaticPricing' ? (row.count ? '开启' : '关闭') : `${row.count} 项`}</span></label>)}
      <p className="muted small">所选范围将替换当前车辆的资料，未选范围保留。本机保留一份最近恢复前快照，可撤销这次恢复；下一次恢复会替换该快照。建议先导出并确认文件已保存。</p>
      {mismatch && <label className="backup-choice"><input type="checkbox" disabled={busy} checked={mapped} onChange={e=>setMapped(e.target.checked)}/>来源或车辆编号不同；我确认这些资料属于当前车辆，并导入到车辆 {carID}</label>}
      <div className="button-row"><button className="button" disabled={busy || reading || !selected.length || !!mismatch && !mapped} onClick={()=>restore()}>恢复所选资料</button><button className="text-button" disabled={busy} onClick={()=>{reader.current.cancel();setBackup(null);setSelected([]);setMapped(false);setError('');}}>取消</button></div>
    </div>}
    {snapshot && <div className="backup-preview"><p>最近恢复前快照 · {new Date(snapshot.createdAt).toLocaleString('zh-CN')}</p><p className="muted small">可还原：{snapshot.kinds.map(k=>BACKUP_LABELS[k as keyof typeof BACKUP_LABELS]).join('、')}。撤销会替换这些范围内恢复之后的新编辑，请先导出需要保留的资料。</p>
      {!confirmUndo ? <button className="button secondary" disabled={busy || reading} onClick={()=>setConfirmUndo(true)}>撤销上次恢复…</button> : <div className="button-row"><button className="button" disabled={busy || reading} onClick={()=>restore(true)}>确认还原恢复前资料</button><button className="text-button" disabled={busy} onClick={()=>setConfirmUndo(false)}>取消撤销</button></div>}
    </div>}
  </section>;
}
