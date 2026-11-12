import {useEffect,useMemo,useState} from 'react';
import {Pause,Play} from 'lucide-react';
import type {Config} from './api';
import MapView from './Map';
import {useDriveDetails,type DetailAPI} from './drive-loader';
import {buildReplayTimeline,multiReplayPosition,replayElapsedAt} from './replay.mjs';
import {fmt} from './core.mjs';
import ReplayExport from './ReplayExport';
import PlaybackControls from './PlaybackControls';

export default function MultiReplay({api,config,carID,driveIDs,hideAddress=false}:{api:DetailAPI;config:Config;carID:number;driveIDs:number[];hideAddress?:boolean}){
 const loader=useDriveDetails(api,carID,driveIDs),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(30),[compress,setCompress]=useState(true);
 const timeline=useMemo(()=>buildReplayTimeline(loader.drives,{compressParking:compress}),[loader.drives,compress]);
 const [cursor,setCursor]=useState(()=>({timeline,elapsed:0}));
 const resolveCursor=(value:typeof cursor)=>value.timeline===timeline?value.elapsed:replayElapsedAt(timeline,multiReplayPosition(value.timeline,value.elapsed),value.elapsed);
 const elapsed=resolveCursor(cursor);
 function setElapsed(next:number|((value:number)=>number)){setCursor(value=>({timeline,elapsed:typeof next==='function'?next(resolveCursor(value)):next}));}
 const paths=useMemo(()=>loader.drives.map(d=>d.samples.map((p:any)=>[p.longitude,p.latitude])),[loader.drives]),samplePaths=useMemo(()=>loader.drives.map(d=>d.samples),[loader.drives]),loadedIDs=useMemo(()=>loader.drives.map(d=>d.driveID),[loader.drives]);
 const position=multiReplayPosition(timeline,elapsed);
 useEffect(()=>{setPlaying(false);setElapsed(0);},[api,carID,driveIDs.join(','),compress]);
 useEffect(()=>{if(loader.loading)setPlaying(false);},[loader.loading]);
 useEffect(()=>{if(!playing)return;let frame=0,last=0;const tick=(now:number)=>{if(last)setElapsed(value=>Math.min(timeline.duration,value+Math.min(100,now-last)*speed));last=now;frame=requestAnimationFrame(tick);};const pause=()=>{if(document.visibilityState!=='visible')setPlaying(false);};document.addEventListener('visibilitychange',pause);frame=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',pause);};},[playing,speed,timeline]);
 useEffect(()=>{if(elapsed>=timeline.duration)setPlaying(false);},[elapsed,timeline.duration]);
 return <section className="multi-replay" aria-label="连续行程回放">
  <div className="map-toolbar"><span className="small muted" role="status">已读取 {loader.completed}/{loader.total} 段{loader.loading?' · 正在读取…':''}{loader.cancelled?' · 已暂停读取':''}</span><div className="inline-actions">{loader.loading?<button onClick={loader.cancel}>取消读取</button>:(loader.failed.length>0||loader.completed<loader.total)&&<button onClick={loader.retry}>{loader.failed.length?`重试 ${loader.failed.length} 段`:'继续读取'}</button>}</div></div>
  {loader.failed.length>0&&<p className="warning" role="status">部分行程未读取，当前回放只包含成功的 {loader.completed} 段。</p>}
  <MapView config={config} paths={paths} routeSamples={samplePaths} driveIDs={loadedIDs} replayTime={position?.phase==='drive'?position.time:undefined} replayPathIndex={position?.pathIndex} replayDriveID={position?.driveID} point={position?[position.longitude,position.latitude]:null} full/>
  <div className="replay-controls replay-controls-modern"><PlaybackControls continuous elapsed={elapsed} duration={timeline.duration} playing={playing} disabled={loader.loading} onPlay={()=>{if(elapsed>=timeline.duration)setElapsed(0);setPlaying(!playing);}} onSeek={v=>{setPlaying(false);setElapsed(v);}} speed={speed} onSpeed={setSpeed} time={position?.time}/></div>
  <div className="map-toolbar"><span className="small">{position?new Date(position.time).toLocaleString('zh-CN'):'暂无定位记录'}{position?.phase==='parking'?` · 行程间隔 ${fmt(position.intervalMs/60000)} 分`:position?.gap?' · 定位采样缺口':''}</span><label className="map-check"><input type="checkbox" checked={compress} onChange={e=>setCompress(e.target.checked)}/>压缩停车间隔</label></div>
  <p className="small muted">各行程独立绘制；停车间隔按相邻已读取行程估计，缺失记录可能使间隔变长。压缩后每段间隔最多保留 1 分钟回放时间。</p>
  <ReplayExport samples={samplePaths} title="旅途回放" hideAddress={hideAddress}/>
 </section>;
}
