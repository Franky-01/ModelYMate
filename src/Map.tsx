import {useEffect,useMemo,useRef,useState} from 'react';
import {MapPin,Navigation} from 'lucide-react';
import type {Config} from './api';
import {projectGPSPoints} from './coordinates.mjs';
import {haversine} from './core.mjs';
import {acceptableRoadPath,activeRecordedGap,createGapRouter,recordedDisplayPlan,roadPathPosition,roadPathProfile} from './routes.mjs';
import './map-routes.css';
let loader:Promise<any>|null=null;
declare global{interface Window{AMap:any;_AMapSecurityConfig:any;}}
export function loadMap(config:Config){
 if(!config.amapReady || !config.amapKey)return Promise.reject(new Error('地图连接尚未配置。'));
 if(window.AMap)return Promise.resolve(window.AMap);
 if(loader)return loader;
 window._AMapSecurityConfig={serviceHost:window.location.origin+'/_AMapService'};
 loader=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=`https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.amapKey)}`;const timer=setTimeout(()=>{script.remove();loader=null;reject(new Error('地图加载超时，请检查网络。'));},15000);script.onload=()=>{clearTimeout(timer);resolve(window.AMap);};script.onerror=()=>{clearTimeout(timer);script.remove();loader=null;reject(new Error('暂时无法加载地图。'));};document.head.appendChild(script);});
 return loader;
}
export async function convertCoordinates(_AMap:any,points:number[][]):Promise<number[][]>{
 // Long drives contain tens of thousands of samples, including repeated GPS positions.
 // Project in memory so map rendering and replay do not issue hundreds of service calls.
 return projectGPSPoints(points);
}
export async function chineseAddress(config:Config,point:number[]):Promise<string|null>{
 const AMap=await loadMap(config),[gcj]=await convertCoordinates(AMap,[point]);
 return new Promise(resolve=>AMap.plugin('AMap.Geocoder',()=>{new AMap.Geocoder({extensions:'base'}).getAddress(gcj,(s:string,r:any)=>resolve(s==='complete'?r.regeocode?.formattedAddress??null:null));}));
}
export type RouteSample={t:number;sourceIndex:number};
type FilledGap={pathIndex:number;driveID?:number;startTime:number;endTime:number;profile:ReturnType<typeof roadPathProfile>};
export type MapPoint={id?:number|string;point:number[];label?:string;count?:number};
const emptyPaths:number[][][]=[],emptySamples:RouteSample[][]=[],emptyValues:Array<number|null>=[];
const emptyMarkers:MapPoint[]=[],emptyIDs:number[]=[];
const routers=new WeakMap<object,ReturnType<typeof createGapRouter>>();
function gapRouter(AMap:any){let router=routers.get(AMap);if(!router){router=createGapRouter(AMap);routers.set(AMap,router);}return router;}
export default function MapView({config,paths=emptyPaths,routeSamples=emptySamples,replayTime,replayPathIndex=0,replayDriveID,driveIDs=emptyIDs,point,markers=emptyMarkers,frequency=emptyMarkers,label='',full=false,colorMode='standard',speeds=emptyValues,elevations=emptyValues,empty='暂无定位记录',fillGaps=true,active=true,onMarkerSelect}:{config:Config;paths?:number[][][];routeSamples?:RouteSample[][];replayTime?:number;replayPathIndex?:number;replayDriveID?:number;driveIDs?:number[];point?:number[]|null;markers?:MapPoint[];frequency?:MapPoint[];label?:string;full?:boolean;colorMode?:string;speeds?:Array<number|null>;elevations?:Array<number|null>;empty?:string;fillGaps?:boolean;active?:boolean;onMarkerSelect?:(id:number|string)=>void}){
 const div=useRef<HTMLDivElement>(null),map=useRef<any>(null),marker=useRef<any>(null),convertedPoint=useRef<any>(null),[error,setError]=useState(''),[ready,setReady]=useState(false),[mapRevision,setMapRevision]=useState(0);
 const selectMarker=useRef(onMarkerSelect);selectMarker.current=onMarkerSelect;
 const [filledGaps,setFilledGaps]=useState<FilledGap[]>([]),[gapInfo,setGapInfo]=useState({total:0,pending:0,filled:0,unavailable:0});
 const plans=useMemo(()=>{const total=paths.reduce((s,p)=>s+p.length,0);return paths.map((p,i)=>recordedDisplayPlan(p,routeSamples[i]??[],Math.max(2,Math.floor(2400*p.length/Math.max(1,total)))));},[paths,routeSamples]);
 const hasPosition=!!point||paths.some(p=>p.length>0)||markers.length>0||frequency.length>0;
 const activeGap=replayTime===undefined?undefined:activeRecordedGap(filledGaps,replayTime,replayPathIndex,replayDriveID);
 const nearEndpoint=!!point&&paths.length>0&&[paths[0]?.[0],paths.at(-1)?.at(-1)].some(end=>end&&haversine(point,end)<8);
 useEffect(()=>{
  setError('');setReady(false);setFilledGaps([]);setGapInfo({total:0,pending:0,filled:0,unavailable:0});
  if(!active||!div.current||!hasPosition)return;let cancelled=false,m:any;
  const abort=new AbortController();
  (async()=>{try{const AMap=await loadMap(config);if(cancelled)return;m=new AMap.Map(div.current,{zoom:14,viewMode:'2D',mapStyle:'amap://styles/dark',showLabel:true,resizeEnable:true});map.current=m;
   const overlays:any[]=[];
   const jobs:Array<{from:number[];to:number[];pathIndex:number;driveID?:number;startTime:number;endTime:number;color:string}>=[];
   const altitude=elevations.filter(v=>v!==null) as number[];
   let min=Infinity,max=-Infinity;for(const v of altitude){min=Math.min(min,v);max=Math.max(max,v);}
   let offset=0;
   const addLine=(path:number[][],color:string)=>{if(path.length<2)return;const line=new AMap.Polyline({path,strokeColor:color,strokeWeight:3,strokeOpacity:.85,strokeStyle:'solid',lineJoin:'round',lineCap:'round'});overlays.push(line);m.add(line);};
   for(let pathIndex=0;pathIndex<paths.length;pathIndex++){
    const path=paths[pathIndex];if(!path.length)continue;
    const {runs,gaps}=plans[pathIndex];
    const indexes=[...new Set(runs.flatMap(run=>run.indexes))],projected=await convertCoordinates(AMap,indexes.map(i=>path[i]));if(cancelled)return;
    const converted=new Map(indexes.map((i,j)=>[i,projected[j]]));
    const colorAt=(local:number)=>{const i=offset+local;return colorMode==='standard'?'#62d8b2':colorMode==='speed'?(speeds[i]==null?'#9298a0':speeds[i]!<20?'#ed7476':speeds[i]!<40?'#e6b760':'#62d8b2'):elevations[i]==null?'#9298a0':max>min?`hsl(${205-Math.round((elevations[i]!-min)/(max-min)*12)*170/12} 68% 61%)`:'#62d8b2';};
    for(const run of runs){
     // Individual runs may be one point after a gap. Do not turn every such
     // fragment into an unlabeled map dot; retain the point in source data.
     if(run.start===run.end)continue;
     let start=0,previous=colorAt(run.indexes[1]);
     for(let i=2;i<run.indexes.length;i++){const color=colorAt(run.indexes[i]);if(color!==previous){addLine(run.indexes.slice(start,i).map(index=>converted.get(index)!),previous);start=i-1;previous=color;}}
     addLine(run.indexes.slice(start).map(index=>converted.get(index)!),previous);
    }
    if(pathIndex===0){const closed=paths.length===1&&haversine(path[0],path.at(-1)!)<15;const mk=new AMap.Marker({position:converted.get(0),anchor:'center',content:`<div class="route-endpoint start">${closed?'起/终':'起'}</div>`,title:closed?'行程起点与终点':'行程起点'});m.add(mk);overlays.push(mk);}
    if(pathIndex===paths.length-1&&!(paths.length===1&&haversine(path[0],path.at(-1)!)<15)){const mk=new AMap.Marker({position:converted.get(path.length-1),anchor:'center',content:'<div class="route-endpoint end">终</div>',title:'行程终点'});m.add(mk);overlays.push(mk);}
    if(fillGaps)for(const gap of gaps)if(!gap.gpsJump&&gap.endTime>gap.startTime&&haversine(path[gap.before],path[gap.after])>15)jobs.push({from:converted.get(gap.before)!,to:converted.get(gap.after)!,pathIndex,driveID:driveIDs[pathIndex],startTime:gap.startTime,endTime:gap.endTime,color:colorAt(gap.before)});
    offset+=path.length;
   }
   const extraPoints=[...markers,...frequency],extraCoordinates=await convertCoordinates(AMap,extraPoints.map(p=>p.point));if(cancelled)return;
   extraPoints.forEach((item,i)=>{const count=Math.max(0,Math.round(Number(item.count)||0)),content=count?`<div class="frequency-map-dot">${count}</div>`:'<div class="charge-map-dot">ϟ</div>';const mk=new AMap.Marker({position:extraCoordinates[i],anchor:'center',content,title:item.label??(count?`${count} 段行程经过`:'充电记录')});if(item.id!==undefined)mk.on?.('click',()=>selectMarker.current?.(item.id!));m.add(mk);overlays.push(mk);});
   if(point){const[p]=await convertCoordinates(AMap,[point]);if(cancelled)return;convertedPoint.current=p;if(!nearEndpoint){const mk=new AMap.Marker({position:p,anchor:'center',content:'<div class="vehicle-map-marker"><span></span></div>'});m.add(mk);marker.current=mk;overlays.push(mk);}}
   if(overlays.length)m.setFitView(overlays,false,[48,38,48,38],paths.length?16:15);
   if(cancelled)return;setReady(true);setGapInfo({total:jobs.length,pending:jobs.length,filled:0,unavailable:0});
   let userMoved=false;const moved=()=>{userMoved=true;};m.on('dragstart',moved);m.on('zoomstart',moved);
   await Promise.all(jobs.map(async job=>{
    // Zero-duration gaps cannot be replayed, but may still have a planned display path.
    const road:any=await gapRouter(AMap)(job.from,job.to,abort.signal);
    if(cancelled)return;
    const valid=acceptableRoadPath(road,job.from,job.to,job.startTime,job.endTime);
    if(valid){
     // Service paths are already GCJ02. Never project them a second time.
     const path=[job.from,...road,job.to];addLine(path,job.color);
     setFilledGaps(old=>[...old,{pathIndex:job.pathIndex,driveID:job.driveID,startTime:job.startTime,endTime:job.endTime,profile:roadPathProfile(path)}]);
    }
    setGapInfo(old=>({...old,pending:old.pending-1,filled:old.filled+(valid?1:0),unavailable:old.unavailable+(valid?0:1)}));
   }));
   if(!cancelled&&jobs.length&&!userMoved)m.setFitView(overlays,false,[48,38,48,38],16);
  }catch(e){if(!cancelled)setError((e as Error).message);}})();
  return()=>{cancelled=true;abort.abort();m?.destroy();map.current=null;marker.current=null;convertedPoint.current=null;};
 // A moving replay marker must not rebuild the map or its full route.
 },[config.amapKey,config.amapReady,paths,routeSamples,plans,hasPosition,colorMode,speeds,elevations,markers,frequency,driveIDs,fillGaps,active,mapRevision]);
 const pointKey=point?.join(',');
 useEffect(()=>{
  if(!active||!ready||!map.current)return;
  if(!point){if(marker.current){map.current.remove?.(marker.current);marker.current=null;}convertedPoint.current=null;return;}
  let cancelled=false;loadMap(config).then(async A=>{let [p]=await convertCoordinates(A,[point]);if(cancelled||!map.current)return;if(activeGap&&replayTime!==undefined){const roadPoint=roadPathPosition(activeGap.profile,(replayTime-activeGap.startTime)/(activeGap.endTime-activeGap.startTime));if(roadPoint)p=roadPoint;}convertedPoint.current=p;if(nearEndpoint&&!activeGap){if(marker.current)map.current.remove?.(marker.current);marker.current=null;return;}if(!marker.current){marker.current=new A.Marker({position:p,anchor:'center',content:'<div class="vehicle-map-marker"><span></span></div>'});map.current.add(marker.current);}else marker.current.setPosition(p);}).catch(()=>{});return()=>{cancelled=true;};
 },[pointKey,ready,replayTime,activeGap,active,nearEndpoint]);
 const routeMessage=gapInfo.pending?'正在加载路线…':gapInfo.unavailable?'部分路线暂未加载，请稍后重试':'';
 return <div className={'map-view '+(full?'map-full':'')} data-gap-count={gapInfo.total} data-gap-filled={gapInfo.filled} data-gap-unavailable={gapInfo.unavailable}><div ref={div} className="map-surface"/>{(!hasPosition||error||!ready)&&<div className="map-placeholder"><MapPin size={26}/><span>{!hasPosition?empty:error||'正在加载高德地图…'}</span>{error&&<button className="button secondary" onClick={()=>setMapRevision(v=>v+1)}>重试地图</button>}</div>}{ready&&routeMessage&&<div className="map-route-status" role="status">{routeMessage}</div>}{label&&<div className="map-caption"><MapPin size={15}/>{label}<span>车辆报告位置</span></div>}{ready&&<button className="map-recenter" aria-label="回到车辆或轨迹" onClick={()=>{if(convertedPoint.current)map.current?.setCenter(convertedPoint.current);else map.current?.setFitView();}}><Navigation size={17}/></button>}<span className="map-attribution">高德地图</span></div>;
}
