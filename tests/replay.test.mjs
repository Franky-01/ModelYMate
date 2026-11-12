import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildReplayTimeline,loadDriveBatch,multiReplayPosition,replayElapsedAt} from '../src/replay.mjs';
import {buildRoadFrequency,chargeMapPoints} from '../src/history-map.mjs';
import {exportGeometry,videoMime} from '../src/replay-export.mjs';
const point=(t,i=0,longitude=121.4,latitude=31.2)=>({t,sourceIndex:i,longitude,latitude,speed:30,power:5});
const drive=(driveID,start,end)=>({driveID,samples:[point(start),point(end,1,121.401)]});

test('retrying an earlier missing drive preserves the source cursor instead of rewinding',()=>{
 const old=buildReplayTimeline([drive(2,120000,140000)]),cursor=multiReplayPosition(old,8000);
 const full=buildReplayTimeline([drive(1,0,10000),drive(2,120000,140000)]);
 const moved=multiReplayPosition(full,replayElapsedAt(full,cursor));
 assert.equal(moved.driveID,2);assert.equal(moved.time,128000);
 assert.equal(replayElapsedAt(buildReplayTimeline([]),cursor,8000),0);
});

test('continuous replay sorts a copy and compresses only the interval between drives',()=>{
 const drives=[drive(2,3600000,3660000),drive(1,0,60000)],before=structuredClone(drives);
 const timeline=buildReplayTimeline(drives);
 assert.equal(timeline.duration,180000);assert.equal(timeline.parkingMs,3540000);
 assert.equal(timeline.drives[0].driveID,1);assert.equal(timeline.drives[0].pathIndex,1);
 assert.equal(multiReplayPosition(timeline,90000).phase,'parking');
 assert.equal(multiReplayPosition(timeline,90000).speed,null);
 assert.equal(multiReplayPosition(timeline,150000).driveID,2);
 assert.equal(multiReplayPosition(timeline,150000).pathIndex,0);
 assert.equal(buildReplayTimeline(drives,{compressParking:false}).duration,3660000);
 assert.deepEqual(drives,before);
});
test('overlapping and same-second drives stay separate without invented parking',()=>{
 const timeline=buildReplayTimeline([drive(1,0,10000),drive(2,5000,15000),{driveID:3,samples:[point(15000),point(15000,1)]}]);
 assert.equal(timeline.segments.length,3);assert.equal(timeline.parkingMs,0);
 assert.equal(multiReplayPosition(timeline,11000).driveID,2);
 assert.equal(multiReplayPosition(timeline,20000).driveID,3);
 assert.equal(multiReplayPosition(buildReplayTimeline([]),0),null);
});
test('telemetry outages retain unknown telemetry and the original coordinate',()=>{
 const samples=[point(0),point(1000,1),point(90000,2,121.5),point(91000,3,121.6)];
 const result=multiReplayPosition(buildReplayTimeline([{driveID:1,samples}]),45000);
 assert.equal(result.gap,true);assert.equal(result.speed,null);assert.equal(result.longitude,121.4);
});
test('detail reader limits concurrency, reports partial failures, and does not refetch successes on caller retry',async()=>{
 let active=0,peak=0;const called=[];
 const fetch=async id=>{called.push(id);active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,4));active--;if(id===2)throw new Error('offline');return {drive:{drive_id:id}};};
 const result=await loadDriveBatch([1,2,3,4,4],fetch,{concurrency:2});
 assert.equal(peak,2);assert.equal(result.results.length,4);assert.deepEqual(result.pending,[]);
 const failed=result.results.filter(r=>r.status==='rejected').map(r=>r.id);assert.deepEqual(failed,[2]);
 await loadDriveBatch(failed,async id=>{called.push(id);return {drive:{drive_id:id}};});
 assert.deepEqual(called,[1,2,3,4,2]);
});
test('cancellation prevents queued work and ignores late success even if fetch ignores its signal',async()=>{
 const controller=new AbortController(),called=[],delivered=[];
 const pending=loadDriveBatch([1,2,3],async id=>{called.push(id);await new Promise(r=>setTimeout(r,30));return {};},{signal:controller.signal,concurrency:1,onResult:r=>delivered.push(r)});
 setTimeout(()=>controller.abort(),3);const result=await pending;
 assert.deepEqual(called,[1]);assert.deepEqual(delivered,[]);assert.equal(result.cancelled,true);assert.deepEqual(result.pending,[1,2,3]);
});
test('bounded timeout handles a fetch that never resolves',async()=>{
 const result=await loadDriveBatch([1,2],()=>new Promise(()=>{}),{concurrency:2,timeoutMs:5});
 assert.equal(result.results.filter(r=>r.status==='rejected').length,2);assert.match(result.results[0].error,/超时/);
});
test('road frequency counts a drive once per grid rather than its sample density',()=>{
 const sparse={driveID:1,samples:[point(0),point(1000,1)]},dense={driveID:2,samples:Array.from({length:100},(_,i)=>point(i*1000,i))};
 const result=buildRoadFrequency([sparse,dense]);assert.equal(result.cells.length,1);assert.equal(result.cells[0].count,2);
});
test('frequency does not bridge a removed source row and signals bounded coverage',()=>{
 const gap={driveID:1,samples:[point(0),point(1000,2,121.42)]};
 assert.equal(buildRoadFrequency([gap]).cells.length,2);
 const bounded=buildRoadFrequency([gap],{maxCells:1});assert.equal(bounded.cells.length,1);assert.equal(bounded.truncated,true);
});
test('charging map excludes unknown coordinates and honors name privacy',()=>{
 const result=chargeMapPoints([{charge_id:1,latitude:31,longitude:121,address:'私密家址',charge_energy_added:0},{charge_id:2,latitude:null,longitude:121}],{hideAddress:true});
 assert.equal(result.length,1);assert.equal(result[0].label,'充电记录');assert.equal(result[0].energy,0);
});
test('export geometry preserves gaps and never mutates samples',()=>{
 const input=[[point(0),point(1000,1),point(2000,3,121.42),point(3000,4,121.43)]],before=structuredClone(input);
 const result=exportGeometry(input);assert.equal(result.runs.length,2);assert.equal(result.count,4);assert.deepEqual(input,before);
});
test('video capability selection has an explicit unsupported result',()=>{
 assert.equal(videoMime(undefined),null);assert.equal(videoMime({isTypeSupported:()=>false}),null);
 assert.equal(videoMime({isTypeSupported:value=>value==='video/webm'}),'video/webm');
});
