import {useEffect,useMemo,useRef,useState} from 'react';
import {driveRoute} from './core.mjs';
import {loadDriveBatch} from './replay.mjs';
import type {J} from './api';

export type DetailAPI=(path:string,signal?:AbortSignal)=>Promise<J>;
type LoadedDrive={driveID:number;samples:ReturnType<typeof driveRoute>['samples']};
type Entry={status:'fulfilled';payload:LoadedDrive}|{status:'rejected';error:string};
const emptyEntries:Record<number,Entry>={};
export function useDriveDetails(api:DetailAPI,carID:number,ids:number[]){
 const idsKey=useMemo(()=>ids.join(','),[ids]),[revision,setRevision]=useState(0);
 const owner=useMemo(()=>({api,carID}),[api,carID]);
 const batch=useMemo(()=>({owner,idsKey,revision}),[owner,idsKey,revision]);
 const cache=useRef({owner,entries:{} as Record<number,Entry>}),request=useRef<AbortController|null>(null);
 const manualCancel=useRef(false);
 useEffect(()=>{manualCancel.current=false;},[owner,idsKey]);
 const [published,setPublished]=useState({owner,entries:emptyEntries});
 const [progress,setProgress]=useState({batch,loading:true,cancelled:false,completed:0});
 useEffect(()=>{
  if(cache.current.owner!==owner)cache.current={owner,entries:{}};
  let alive=true;const controller=new AbortController();request.current=controller;
  const entries=cache.current.entries;
  const wanted=new Map<number,number>();
  let completed=0;
  for(const id of ids){
   if(entries[id]?.status==='fulfilled')completed++;
   else wanted.set(id,(wanted.get(id)??0)+1);
  }
  const publish=()=>{if(alive)setPublished({owner,entries:{...entries}});};
  const load=async()=>{
   if(document.visibilityState!=='visible'){
    setProgress({batch,loading:false,cancelled:true,completed});return;
   }
   setProgress({batch,loading:wanted.size>0,cancelled:false,completed});
   await loadDriveBatch([...wanted.keys()],async(id:number,signal:AbortSignal)=>{
    const payload=await api(`cars/${carID}/drives/${id}`,signal);
    if(signal.aborted)throw new DOMException('已取消加载','AbortError');
    // Store the derived route once per response. Paging and retrying other
    // drives can reuse these samples without retaining the raw API payload.
    return {driveID:id,samples:driveRoute(payload.drive??{}).samples};
   },{
    signal:controller.signal,concurrency:3,onResult:(result:Entry & {id:number})=>{
     if(!alive||controller.signal.aborted)return;
     entries[result.id]=result;
     if(result.status==='fulfilled')completed+=wanted.get(result.id)??0;
     // Publish progress, not route geometry. Map/timeline stay stable throughout
     // a batch, including slow responses and retries of a partially loaded trip.
     setProgress({batch,loading:true,cancelled:false,completed});
    }
   } as any);
   if(alive){publish();setProgress({batch,loading:false,cancelled:controller.signal.aborted,completed});}
  };
  const visibility=()=>{if(manualCancel.current||!ids.some(id=>entries[id]?.status!=='fulfilled'))return;if(document.visibilityState==='hidden')controller.abort();else if(alive)setRevision(v=>v+1);};
  document.addEventListener('visibilitychange',visibility);void load();
  return()=>{alive=false;controller.abort();document.removeEventListener('visibilitychange',visibility);};
 },[batch]);
 const entries=published.owner===owner?published.entries:emptyEntries;
 const drives=useMemo(()=>ids.flatMap(id=>entries[id]?.status==='fulfilled'?[entries[id].payload]:[]),[entries,idsKey]);
 const failed=useMemo(()=>ids.filter(id=>entries[id]?.status==='rejected'),[entries,idsKey]);
 return {drives,loading:progress.batch!==batch||progress.loading,cancelled:progress.batch===batch&&progress.cancelled,completed:progress.batch===batch?progress.completed:drives.length,total:ids.length,failed,cancel:()=>{manualCancel.current=true;request.current?.abort();},retry:()=>{manualCancel.current=false;setRevision(v=>v+1);}};
}
