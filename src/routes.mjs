import {haversine,isTelemetryGap,routeGapThreshold} from './core.mjs';

// Indexes refer to the original samples, so color data and duplicate timestamps stay aligned.
export function splitRecordedPath(path,samples=[]) {
  if(!path.length)return {runs:[],gaps:[]};
  const runs=[],gaps=[],threshold=routeGapThreshold(samples);
  let start=0;
  if(samples.length===path.length)for(let i=1;i<path.length;i++) {
    if(!isTelemetryGap(samples[i-1],samples[i],threshold))continue;
    runs.push({start,end:i-1});
    gaps.push({before:i-1,after:i,startTime:samples[i-1].t,endTime:samples[i].t,...(samples[i].gpsJumpBefore?{gpsJump:true}:{})});
    start=i;
  }
  runs.push({start,end:path.length-1});
  return {runs,gaps};
}

// Display-only selection, after splitting. Original GPS and source indexes are untouched.
// Run endpoints always survive, including both sides of a missing-data gap.
export function recordedDisplayPlan(path,samples=[],maxPoints=2400) {
  const {runs,gaps}=splitRecordedPath(path,samples);
  const available=Math.max(2,Math.floor(maxPoints));
  const step=Math.max(1,Math.ceil(path.length/available));
  return {gaps,runs:runs.map(run=>{
    const indexes=[run.start];
    for(let i=run.start+step;i<run.end;i+=step)indexes.push(i);
    if(run.end!==run.start)indexes.push(run.end);
    return {...run,indexes};
  })};
}

export function activeRecordedGap(gaps,time,pathIndex=0,driveID) {
  return gaps.find(g=>g.pathIndex===pathIndex && (driveID===undefined||g.driveID===driveID) && time>g.startTime&&time<g.endTime);
}

// A route is only a display estimate. Reject implausible service geometry;
// keep the original gap if endpoints, speed, or detour do not support it.
export function acceptableRoadPath(path,from,to,startTime,endTime) {
  if(!Array.isArray(path)||path.length<2||path.some(p=>!lngLat(p)))return false;
  if(haversine(from,path[0])>120||haversine(to,path.at(-1))>120)return false;
  const direct=haversine(from,to),length=roadPathProfile([from,...path,to]).total;
  if(length>Math.max(direct*5,direct+1500))return false;
  const seconds=(endTime-startTime)/1000;
  return !(seconds>0&&length/seconds>70);
}

export function roadPathProfile(path) {
  const distances=[0];
  for(let i=1;i<path.length;i++)distances.push(distances[i-1]+haversine(path[i-1],path[i]));
  return {path,distances,total:distances[distances.length-1]??0};
}
export function roadPathPosition(profile,fraction) {
  const {path,distances,total}=profile;
  if(!path.length)return null;
  if(path.length===1||total===0)return [...path[0]];
  const target=Math.max(0,Math.min(1,fraction))*total;
  let lo=1,hi=path.length-1;
  while(lo<hi){const mid=Math.floor((lo+hi)/2);if(distances[mid]<target)lo=mid+1;else hi=mid;}
  const a=path[lo-1],b=path[lo],length=distances[lo]-distances[lo-1];
  const p=length>0?(target-distances[lo-1])/length:0;
  return [a[0]+(b[0]-a[0])*p,a[1]+(b[1]-a[1])*p];
}

function lngLat(point) {
  const value=Array.isArray(point)?point:[point?.getLng?.()??point?.lng,point?.getLat?.()??point?.lat];
  return Number.isFinite(value[0])&&Number.isFinite(value[1])&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90?[value[0],value[1]]:null;
}
export function shortestDrivingPath(result) {
  // LEAST_DISTANCE is requested; select the shortest if the service returns alternatives.
  const routes=[...(result?.routes??[])].sort((a,b)=>Number(a.distance)-Number(b.distance));
  for(const route of routes) {
    const points=(route.steps??[]).flatMap(step=>step.path??[]),path=[];
    let invalid=false;
    for(const point of points){const p=lngLat(point);if(!p){invalid=true;break;}const last=path[path.length-1];if(!last||p[0]!==last[0]||p[1]!==last[1])path.push(p);}
    if(!invalid&&path.length>=2)return path;
  }
  return null;
}

// Browser memory only: no coordinates or planned routes are stored on disk.
// Deduplicate requests across route/speed/elevation views and limit AMap concurrency.
export function createGapRouter(AMap,{timeoutMs=12000,concurrency=2,maxEntries=128,ttlMs=600000,failureTtlMs=30000}={}) {
  const cache=new Map(),queue=[];
  let active=0,plugin=null;
  function loadDriving() {
    if(AMap.Driving)return Promise.resolve(true);
    if(plugin)return plugin;
    plugin=new Promise(resolve=>{
      const timer=setTimeout(()=>{plugin=null;resolve(false);},timeoutMs);
      try{AMap.plugin('AMap.Driving',()=>{clearTimeout(timer);const ok=!!AMap.Driving;if(!ok)plugin=null;resolve(ok);});}
      catch{clearTimeout(timer);plugin=null;resolve(false);}
    }).then(ok=>{if(!ok)plugin=null;return ok;});
    return plugin;
  }
  async function search(from,to) {
    if(!await loadDriving())return null;
    return new Promise(resolve=>{
      let driving,finished=false;
      const finish=path=>{if(finished)return;finished=true;clearTimeout(timer);try{driving?.clear();}catch{}resolve(path);};
      const timer=setTimeout(()=>finish(null),timeoutMs);
      try {
        driving=new AMap.Driving({policy:AMap.DrivingPolicy.LEAST_DISTANCE,extensions:'base',hideMarkers:true});
        driving.search(from,to,(status,result)=>finish(status==='complete'?shortestDrivingPath(result):null));
      }catch{finish(null);}
    });
  }
  function drain() {
    while(active<concurrency && queue.length) {
      const entry=queue.shift();
      if(entry.signals.every(signal=>signal?.aborted)){cache.delete(entry.key);entry.resolve(null);continue;}
      active++;
      search(entry.from,entry.to).then(path=>{
        entry.settled=true;entry.expires=Date.now()+(path?ttlMs:failureTtlMs);entry.resolve(path);
      }).catch(()=>{cache.delete(entry.key);entry.resolve(null);}).finally(()=>{active--;drain();});
    }
  }
  /** @param {number[]} from @param {number[]} to @param {AbortSignal | undefined} signal */
  function route(from,to,signal) {
    if(signal?.aborted)return Promise.resolve(null);
    const key=from.join(',')+'>'+to.join(',');
    const existing=cache.get(key);
    if(existing && (!existing.settled||existing.expires>Date.now())){existing.signals.push(signal);return existing.promise;}
    cache.delete(key);
    for(const [key,entry] of cache)if(entry.settled && (entry.expires<=Date.now()||cache.size>=maxEntries))cache.delete(key);
    const entry={key,from:[...from],to:[...to],signals:[signal],settled:false,expires:0,promise:null,resolve:null};
    entry.promise=new Promise(resolve=>{entry.resolve=resolve;});
    cache.set(key,entry);queue.push(entry);drain();
    return entry.promise;
  }
  return route;
}
