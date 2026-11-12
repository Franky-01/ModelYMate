import {useEffect,useMemo,useRef,useState} from 'react';
import {driveRoute} from './core.mjs';
import {loadDriveBatch} from './replay.mjs';
import type {J} from './api';

export type DetailAPI=(path:string,signal?:AbortSignal)=>Promise<J>;
const emptyEntries:Record<number,J>={};
export function useDriveDetails(api:DetailAPI,carID:number,ids:number[]){
 const idsKey=ids.join(','),[revision,setRevision]=useState(0);
 const owner=useMemo(()=>({api,carID}),[api,carID]);
 const batch=useMemo(()=>({owner,idsKey,revision}),[owner,idsKey,revision]);
 const cache=useRef({owner,entries:{} as Record<number,J>}),request=useRef<AbortController|null>(null);
 const manualCancel=useRef(false);
 useEffect(()=>{manualCancel.current=false;},[owner,idsKey]);
 const [published,setPublished]=useState({owner,entries:emptyEntries});
 const [progress,setProgress]=useState({batch,loading:true,cancelled:false,completed:0});
 useEffect(()=>{
  if(cache.current.owner!==owner)cache.current={owner,entries:{}};
  let alive=true;const controller=new AbortController();request.current=controller;
  const entries=cache.current.entries,completed=()=>ids.filter(id=>entries[id]?.status==='fulfilled').length;
  const publish=()=>{if(alive)setPublished({owner,entries:{...entries}});};
  const load=async()=>{
   if(document.visibilityState!=='visible'){
    setProgress({batch,loading:false,cancelled:true,completed:completed()});return;
   }
   const wanted=ids.filter(id=>entries[id]?.status!=='fulfilled');
   setProgress({batch,loading:wanted.length>0,cancelled:false,completed:completed()});
   await loadDriveBatch(wanted,(id:number,signal:AbortSignal)=>api(`cars/${carID}/drives/${id}`,signal),{
    signal:controller.signal,concurrency:3,onResult:(result:any)=>{
     if(!alive||controller.signal.aborted)return;
     entries[result.id]=result;
     // Publish progress, not route geometry. Map/timeline stay stable throughout
     // a batch, including slow responses and retries of a partially loaded trip.
     setProgress({batch,loading:true,cancelled:false,completed:completed()});
    }
   } as any);
   if(alive){publish();setProgress({batch,loading:false,cancelled:controller.signal.aborted,completed:completed()});}
  };
  const visibility=()=>{if(manualCancel.current||!ids.some(id=>entries[id]?.status!=='fulfilled'))return;if(document.visibilityState==='hidden')controller.abort();else if(alive)setRevision(v=>v+1);};
  document.addEventListener('visibilitychange',visibility);void load();
  return()=>{alive=false;controller.abort();document.removeEventListener('visibilitychange',visibility);};
 },[batch]);
 const entries=published.owner===owner?published.entries:emptyEntries;
 const drives=useMemo(()=>ids.flatMap(id=>{const value=entries[id];return value?.status==='fulfilled'?[{driveID:id,samples:driveRoute(value.payload.drive??{}).samples,record:value.payload.drive??{}}]:[];}),[entries,idsKey]);
 return {drives,loading:progress.batch!==batch||progress.loading,cancelled:progress.batch===batch&&progress.cancelled,completed:progress.batch===batch?progress.completed:drives.length,total:ids.length,failed:ids.filter(id=>entries[id]?.status==='rejected'),cancel:()=>{manualCancel.current=true;request.current?.abort();},retry:()=>{manualCancel.current=false;setRevision(v=>v+1);}};
}
