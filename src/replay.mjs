import {replayPosition} from './core.mjs';

// Independently implemented for ModelYMate. Segments never connect separate drives.
export function buildReplayTimeline(drives,{compressParking=true,parkingLimitMs=60000}={}) {
  const ordered=drives.map((drive,pathIndex)=>({...drive,pathIndex})).filter(d=>d.samples?.length)
    .sort((a,b)=>a.samples[0].t-b.samples[0].t||a.pathIndex-b.pathIndex);
  const segments=[];let cursor=0,previous=null,drivingMs=0,parkingMs=0;
  for(const drive of ordered){
    const start=drive.samples[0].t,end=drive.samples.at(-1).t;
    if(previous&&start>previous.end){
      const actual=start-previous.end,duration=compressParking?Math.min(actual,Math.max(0,parkingLimitMs)):actual;
      segments.push({kind:'parking',start:cursor,end:cursor+duration,sourceStart:previous.end,sourceEnd:start,drive:previous.drive});
      cursor+=duration;parkingMs+=actual;
    }
    const duration=Math.max(0,end-start);
    segments.push({kind:'drive',start:cursor,end:cursor+duration,sourceStart:start,sourceEnd:end,drive});
    cursor+=duration;drivingMs+=duration;previous={end,drive};
  }
  return {segments,duration:cursor,drivingMs,parkingMs,drives:ordered};
}

export function multiReplayPosition(timeline,elapsed) {
  if(!timeline.segments.length)return null;
  const target=Math.max(0,Math.min(timeline.duration,elapsed));
  const segment=timeline.segments.find(s=>target<s.end)??timeline.segments.at(-1);
  const fraction=segment.end>segment.start?(target-segment.start)/(segment.end-segment.start):1;
  const time=segment.sourceStart+(segment.sourceEnd-segment.sourceStart)*fraction;
  const drive=segment.drive;
  const position=segment.kind==='parking'?{...drive.samples.at(-1),speed:null,power:null,elevation:null,gap:false}:replayPosition(drive.samples,time-drive.samples[0].t);
  return {...position,time,phase:segment.kind,driveID:drive.driveID,pathIndex:drive.pathIndex,intervalMs:segment.kind==='parking'?segment.sourceEnd-segment.sourceStart:0};
}

export function replayElapsedAt(timeline,position,fallback=0){
  const segment=position&&timeline.segments.find(s=>s.kind===position.phase&&s.drive.driveID===position.driveID);
  if(!segment)return Math.max(0,Math.min(timeline.duration,fallback));
  const span=segment.sourceEnd-segment.sourceStart;
  const ratio=span>0?Math.max(0,Math.min(1,(position.time-segment.sourceStart)/span)):1;
  return segment.start+(segment.end-segment.start)*ratio;
}

/** Bounded read-only requests; callers retain successful entries when retrying failures. */
export async function loadDriveBatch(ids,fetchDetail,{signal,concurrency=3,timeoutMs=15000,onResult=()=>{}}={}) {
  const unique=[...new Set(ids)],results=[];let next=0;
  async function worker(){
    while(next<unique.length&&!signal?.aborted){
      const id=unique[next++],controller=new AbortController();let timer,abort;
      const failure=new Promise((_,reject)=>{
        abort=()=>{controller.abort();reject(Object.assign(new Error('已取消加载'),{name:'AbortError'}));};
        signal?.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>{controller.abort();reject(new Error('读取超时，请重试。'));},timeoutMs);
      });
      try {
        const payload=await Promise.race([fetchDetail(id,controller.signal),failure]);
        if(signal?.aborted)break;
        const result={id,status:'fulfilled',payload};results.push(result);onResult(result);
      }catch(error){
        if(signal?.aborted)break;
        const result={id,status:'rejected',error:error instanceof Error?error.message:'读取失败，请重试。'};results.push(result);onResult(result);
      }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }
  }
  await Promise.all(Array.from({length:Math.min(unique.length,Math.max(1,Math.min(4,concurrency)))},worker));
  return {results,cancelled:!!signal?.aborted,pending:unique.filter(id=>!results.some(r=>r.id===id))};
}
