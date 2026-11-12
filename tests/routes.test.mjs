import {test} from 'node:test';
import assert from 'node:assert/strict';
import {driveSamples,replayPosition,routeGapThreshold} from '../src/core.mjs';
import {acceptableRoadPath,activeRecordedGap,createGapRouter,recordedDisplayPlan,roadPathPosition,roadPathProfile,shortestDrivingPath,splitRecordedPath} from '../src/routes.mjs';

const row=(seconds,longitude=121.4)=>({date:new Date(Date.UTC(2026,9,14)+seconds*1000).toISOString(),latitude:31.2,longitude,speed:20,power:8,elevation:4});
const samples=rows=>driveSamples({drive_details:rows});
const path=p=>p.map(p=>[p.longitude,p.latitude]);
const result=(from,to)=>({routes:[{distance:100,steps:[{path:[from,to]}]}]});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('display decimation retains both sides of every source gap and all original samples',()=>{
 const samples=Array.from({length:100000},(_,i)=>({t:i*1000,sourceIndex:i<513?i:i+1})),path=samples.map((_,i)=>[121+i*.0000001,31]);
 const plan=recordedDisplayPlan(path,samples,2400),indexes=plan.runs.flatMap(r=>r.indexes);
 assert.equal(path.length,100000);assert.equal(samples[513].sourceIndex,514);assert.equal(plan.runs.length,2);
 assert(indexes.includes(512));assert(indexes.includes(513));assert(indexes.includes(99999));assert(indexes.length<2410);
});
test('planned replay gaps are isolated by path and drive even when timestamps overlap',()=>{
 const gaps=[{pathIndex:0,driveID:10,startTime:0,endTime:100},{pathIndex:1,driveID:20,startTime:0,endTime:100}];
 assert.equal(activeRecordedGap(gaps,50,1,20),gaps[1]);assert.equal(activeRecordedGap(gaps,50,1,10),undefined);
 assert.equal(activeRecordedGap(gaps,100,1,20),undefined);
});
test('road estimate validation rejects detached, excessive detour and impossible-speed paths',()=>{
 const from=[121.4,31.2],to=[121.401,31.2];
 assert.equal(acceptableRoadPath([from,to],from,to,0,10000),true);
 assert.equal(acceptableRoadPath([[120,30],to],from,to,0,10000),false);
 assert.equal(acceptableRoadPath([from,[121.5,31.3],to],from,to,0,100000),false);
 assert.equal(acceptableRoadPath([from,to],from,to,0,100),false);
});

test('split only missing sections, preserving original positions and source indexes',()=>{
  const p=samples([row(0),row(1),row(2,NaN),row(3,121.401),row(4,121.402),row(200,121.41),row(201,121.411)]);
  const before=structuredClone(p),plan=splitRecordedPath(path(p),p);
  assert.deepEqual(plan.runs,[{start:0,end:1},{start:2,end:3},{start:4,end:5}]);
  assert.deepEqual(plan.gaps.map(g=>[g.before,g.after]),[[1,2],[3,4]]);
  assert.deepEqual(p,before);
});
test('same-second samples and normally sparse logging do not create false road requests',()=>{
  const p=samples([row(0),row(0),row(60),row(120),row(180)]);
  assert.equal(routeGapThreshold(p),120000);
  assert.equal(splitRecordedPath(path(p),p).gaps.length,0);
  const dense=samples([row(0),row(1),row(2),row(45),row(46)]);
  assert.equal(routeGapThreshold(dense),30000);
  assert.equal(splitRecordedPath(path(dense),dense).gaps.length,1);
});
test('long routes keep all 18164 original samples including repeated positions',()=>{
  const p=Array.from({length:18164},(_,i)=>({t:i*1000,sourceIndex:i,longitude:121.4+(i%40)*.0001,latitude:31.2}));
  const plan=splitRecordedPath(path(p),p);
  assert.deepEqual(plan.runs,[{start:0,end:18163}]);assert.equal(plan.gaps.length,0);
  assert.deepEqual(path(p)[0],path(p)[40]);
});
test('independent drives and routes without timing are never joined',()=>{
  const first=samples([row(0),row(1)]),second=samples([row(500),row(501)]);
  assert.equal(splitRecordedPath(path(first),first).gaps.length,0);
  assert.equal(splitRecordedPath(path(second),second).gaps.length,0);
  assert.deepEqual(splitRecordedPath([[1,1],[2,2]]).runs,[{start:0,end:1}]);
});
test('outage replay exposes missing telemetry instead of reusing a recorded speed',()=>{
  const p=samples([row(0),row(1),row(50,121.41),row(51,121.42)]);
  const position=replayPosition(p,25000);
  assert.equal(position.gap,true);assert.equal(position.longitude,121.4);
  for(const field of ['speed','power','elevation','inside','outside'])assert.equal(position[field],null);
  assert.equal(replayPosition(p,50000).gap,false);assert.equal(replayPosition(p,50000).speed,20);
});
test('removed invalid source rows also stop linear replay through the gap',()=>{
  const p=samples([row(0),row(1,NaN),row(2,121.42)]);
  assert.equal(replayPosition(p,1000).gap,true);
  assert.equal(replayPosition(p,1000).longitude,121.4);
});
test('parse shortest driving alternative and GCJ02 LngLat objects without transforming again',()=>{
  const p=shortestDrivingPath({routes:[{distance:200,steps:[{path:[[1,1],[3,3]]}]},{distance:100,steps:[{path:[{lng:121.4,lat:31.2},{getLng:()=>121.4,getLat:()=>31.2},{lng:121.41,lat:31.21}]}]}]});
  assert.deepEqual(p,[[121.4,31.2],[121.41,31.21]]);
  assert.equal(shortestDrivingPath({routes:[]}),null);
  assert.equal(shortestDrivingPath({routes:[{steps:[{path:[[121,31],[NaN,32]]}]}]}),null);
});
test('estimated replay follows road bends by distance, with exact ends',()=>{
  const profile=roadPathProfile([[121.4,31.2],[121.4,31.201],[121.404,31.201]]);
  assert.deepEqual(roadPathPosition(profile,0),profile.path[0]);
  assert.deepEqual(roadPathPosition(profile,1),profile.path.at(-1));
  const middle=roadPathPosition(profile,.5);
  assert.equal(middle[1],31.201);assert(middle[0]>121.4&&middle[0]<121.404);
  assert.deepEqual(roadPathPosition(roadPathProfile([[121,31],[121,31]]),.5),[121,31]);
});
test('request least-distance policy, share pending results and reuse cached road geometry',async()=>{
  const calls=[];let pluginCalls=0;
  const AMap={DrivingPolicy:{LEAST_DISTANCE:2},plugin(name,ready){pluginCalls++;assert.equal(name,'AMap.Driving');AMap.Driving=class{
    constructor(options){assert.equal(options.policy,2);}
    search(from,to,callback){calls.push([from,to]);setTimeout(()=>callback('complete',result(from,to)),5);}
    clear(){}
  };ready();}};
  const route=createGapRouter(AMap),from=[121,31],to=[121.01,31.01];
  const [a,b]=await Promise.all([route(from,to),route(from,to)]);
  assert.deepEqual(a,[from,to]);assert.deepEqual(b,a);assert.deepEqual(await route(from,to),a);
  assert.equal(calls.length,1);assert.equal(pluginCalls,1);
});
test('route requests limit concurrency and skip cancelled queued work',async()=>{
  let current=0,peak=0,calls=0;
  const AMap={DrivingPolicy:{LEAST_DISTANCE:2},Driving:class{
    search(from,to,callback){calls++;current++;peak=Math.max(peak,current);setTimeout(()=>{current--;callback('complete',result(from,to));},10);}
    clear(){}
  }};
  const route=createGapRouter(AMap,{concurrency:2}),cancel=new AbortController();
  const pending=Array.from({length:5},(_,i)=>route([121+i*.01,31],[121+i*.01,31.01],i===4?cancel.signal:undefined));
  cancel.abort();const values=await Promise.all(pending);
  assert.equal(peak,2);assert.equal(calls,4);assert.equal(values[4],null);
});
test('unavailable or timed out services return no fabricated road and permit retry',async()=>{
  let succeed=false,calls=0;
  const AMap={DrivingPolicy:{LEAST_DISTANCE:2},Driving:class{
    search(from,to,callback){calls++;if(succeed)callback('complete',result(from,to));}
    clear(){}
  }};
  const route=createGapRouter(AMap,{timeoutMs:10,failureTtlMs:1});
  assert.equal(await route([121,31],[121.1,31.1]),null);
  await pause(3);succeed=true;
  assert.deepEqual(await route([121,31],[121.1,31.1]),[[121,31],[121.1,31.1]]);
  assert.equal(calls,2);
});
test('failed plugin loading can recover on the next request',async()=>{
  let ready=false,loads=0;
  const AMap={DrivingPolicy:{LEAST_DISTANCE:2},plugin(_name,callback){
    loads++;if(ready)AMap.Driving=class{search(from,to,done){done('complete',result(from,to));}clear(){}};
    callback();
  }};
  const route=createGapRouter(AMap,{failureTtlMs:1});
  assert.equal(await route([121,31],[121.1,31.1]),null);
  await pause(3);ready=true;
  assert.deepEqual(await route([121,31],[121.1,31.1]),[[121,31],[121.1,31.1]]);
  assert.equal(loads,2);
});
