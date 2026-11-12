import test from 'node:test';
import assert from 'node:assert/strict';
import {loadReferenceHealth} from '../src/battery.mjs';
const records=Array.from({length:4},(_,i)=>({charge_id:i+1,start_date:`2026-10-0${i+1}T00:00:00Z`,end_date:`2026-10-0${i+1}T01:00:00Z`,battery_details:{end_battery_level:100}}));
const detail=r=>({charge:{...r,charge_details:[{date:r.start_date,usable_battery_level:100,battery_info:{rated_battery_range:480}}]},units:{unit_of_length:'km'}});
test('health requests are sequential by default, including real-sized response work',async()=>{
 let active=0,peak=0;const calls=[];
 const result=await loadReferenceHealth(records,'km',async id=>{calls.push(id);peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,2));active--;return detail(records[id-1]);},{complete:true});
 assert.equal(peak,1);assert.deepEqual(calls,[1,2,3,4]);assert.equal(result.sampleCount,4);assert.equal(result.complete,true);
});
test('first timeout stops the queue, retains valid cache, and manual retry only reads missing sessions',async()=>{
 const cache=new Map(),calls=[];let broken=true;
 const fetch=async id=>{calls.push(id);if(id===2&&broken)throw Object.assign(Error('fictional timeout'),{kind:'timeout'});return detail(records[id-1]);};
 const partial=await loadReferenceHealth(records,'km',fetch,{cache,complete:true});
 assert.deepEqual(calls,[1,2]);assert.equal(partial.failureKind,'timeout');assert.equal(partial.missingSessions,3);assert.equal(partial.sampleCount,1);assert.equal(partial.complete,false);assert.equal(cache.size,1);
 broken=false;const recovered=await loadReferenceHealth(records,'km',fetch,{cache,complete:true});
 assert.deepEqual(calls,[1,2,2,3,4]);assert.equal(recovered.complete,true);assert.equal(recovered.failureKind,null);
});
test('caller cancellation never becomes health failure or starts queued work',async()=>{
 const controller=new AbortController(),calls=[];
 await assert.rejects(loadReferenceHealth(records,'km',async id=>{calls.push(id);controller.abort();return detail(records[id-1]);},{signal:controller.signal}),{name:'AbortError'});
 assert.deepEqual(calls,[1]);
});
