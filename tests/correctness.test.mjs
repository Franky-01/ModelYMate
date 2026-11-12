import test from 'node:test';
import assert from 'node:assert/strict';
import {chargeCalibration,calibratedDriveEnergy,healthSession,referenceBatteryHealth,loadReferenceHealth} from '../src/battery.mjs';
import {telemetrySamples,analyzeDriving,inspectDriveRoute} from '../src/telemetry.mjs';
import {driveEfficiency,aggregateEfficiency,driveSamples,isTelemetryGap,driveRoute,mergeHealthCharges} from '../src/core.mjs';
import {interpolatedChart} from '../src/data-quality.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≠ ${b}`);
const stamp=s=>new Date(Date.parse('2026-10-01T00:00:00Z')+s*1000).toISOString();
const charge=(id,day,values,end=100)=>({charge_id:id,start_date:`2026-10-${day}T00:00:00Z`,end_date:`2026-10-${day}T01:00:00Z`,battery_details:{end_battery_level:end},charge_details:values.map(([rated,usable,battery],i)=>({date:`2026-10-${day}T00:${String(i%60).padStart(2,'0')}:00Z`,usable_battery_level:usable,battery_level:battery??usable,battery_info:{rated_battery_range:rated}}))});
const record=(distance,rangeStart,rangeEnd,extra={})=>({odometer_details:{odometer_distance:distance},battery_details:{is_sufficiently_precise:true,reduced_range:false},range_rated:{start_range:rangeStart,end_range:rangeEnd},...extra});
const ps=values=>values.map(([seconds,speed,extra={}],sourceIndex)=>({date:stamp(seconds),speed,latitude:31,longitude:121,...extra,sourceIndex}));

test('reference health hand calculation: daily weighted 500/480, current 490, health 98%',()=>{
  const raw=[charge(1,'01',[[500,100],[450,90]]),charge(2,'02',[[480,100],[240,50]])],before=structuredClone(raw);
  const h=referenceBatteryHealth(raw.map(r=>healthSession(r,'km')),{kwhPerKm:.2},{complete:true});
  assert.deepEqual(h.series.map(p=>p.range_km),[500,480]);assert.equal(h.current_range,490);assert.equal(h.max_range,500);assert.equal(h.battery_health_percentage,98);assert.equal(h.current_capacity,98);assert.equal(h.sampleCount,4);assert.equal(h.complete,true);assert.deepEqual(raw,before);
});
test('reference health excludes non-full/incomplete/invalid points and never replaces usable zero',()=>{
  const records=[charge(1,'01',[[500,100],[200,0,50],[300,null,60],[-10,100]]),charge(2,'02',[[999,100]],99),{...charge(3,'03',[[999,100]]),end_date:null}];
  const h=referenceBatteryHealth(records.map(r=>healthSession(r,'km')),{});
  assert.equal(h.sampleCount,2);assert.equal(h.rejectedSamples,2);assert.equal(h.current_range,500);assert.equal(h.current_capacity,null);assert.equal(h.battery_health_percentage,100);
  const empty=referenceBatteryHealth([],{});assert.equal(empty.battery_health_percentage,null);assert.equal(empty.max_range,null);
});
test('reference health normalizes miles, uses the newest 100 and caps percentage at 100',()=>{
  const r=charge(1,'01',Array.from({length:101},(_,i)=>[i===0?100:300,100]));r.charge_details.forEach((p,i)=>p.date=new Date(Date.parse(r.start_date)+i*1000).toISOString());
  const h=referenceBatteryHealth([healthSession(r,'mi')],{kwhPerKm:.2});
  assert.equal(h.currentSampleCount,100);assert.equal(h.current_range,482.8);assert.equal(h.battery_health_percentage,100);
  assert.equal(referenceBatteryHealth([healthSession(r,'unknown')],{}).sampleCount,0);
});
test('calibration is a weighted recorded ratio, not a guessed battery capacity',()=>{
  const rows=[{end_date:stamp(30),charge_energy_added:20,range_rated:{start_range:100,end_range:200}},{end_date:stamp(60),charge_energy_added:40,range_rated:{start_range:100,end_range:300}},{end_date:null,charge_energy_added:99,range_rated:{start_range:0,end_range:500}}];
  const c=chargeCalibration(rows,'km',{complete:true});close(c.kwhPerKm,.2);assert.equal(c.count,2);assert.equal(c.complete,true);
  close(calibratedDriveEnergy(record(25,300,280),'km',c).kwh,4);
  assert.equal(calibratedDriveEnergy({...record(25,300,280),battery_details:{}},'km',c),null);
  assert.equal(calibratedDriveEnergy(record(25,300,280),'unknown',c),null);
  assert.equal(chargeCalibration([],'km').kwhPerKm,null);
});
test('net energy takes priority; fallback estimates and distance weighting have explicit sources',()=>{
  const c={kwhPerKm:.2,count:2,complete:true},a=record(10,300,290),b=record(90,300,255);
  const annotated=[a,b].map(r=>({...r,energyEstimate:calibratedDriveEnergy(r,'km',c)}));
  const avg=aggregateEfficiency(annotated,'km');close(avg.consumption,11);assert.equal(avg.estimated,true);assert.equal(avg.coverage.valid,2);
  const known=driveEfficiency({...a,energy_consumed_net:4,consumption_net:300},'km',c);assert.equal(known.energy,4);assert.equal(known.consumption,40);assert.equal(known.estimated,false);
  assert.equal(driveEfficiency(a,'km').energy,null);assert.equal(driveEfficiency(a,'km',c).estimated,true);
  const partial=aggregateEfficiency([...annotated,record(20,100,90)],'km');close(partial.consumption,11);assert.equal(partial.coverage.partial,true);
});
test('known TeslaMateAPI mile consumption transform is undone and signed regeneration retained',()=>{
  const mi=1.609344,reading={odometer_details:{odometer_distance:100/mi},consumption_net:200/mi};
  close(driveEfficiency(reading,'mi').energy,20);close(driveEfficiency(reading,'mi').consumption,20);
  close(driveEfficiency({odometer_details:{odometer_distance:10},energy_consumed_net:-.5},'km').consumption,-5);
});
test('health loading is bounded, retains successful cache and recovers partial failure',async()=>{
  const records=[charge(1,'01',[[500,100]]),charge(2,'02',[[480,100]])],cache=new Map();let calls=0,active=0,peak=0,fail=true;
  const fetch=async id=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;if(id===2&&fail)throw Error('fixture');return {charge:records.find(r=>r.charge_id===id),units:{unit_of_length:'km'}};};
  const first=await loadReferenceHealth(records,'km',fetch,{cache,complete:true,concurrency:2});assert.equal(first.missingSessions,1);assert.equal(first.complete,false);assert.ok(peak<=2);
  fail=false;const recovered=await loadReferenceHealth(records,'km',fetch,{cache,complete:true});assert.equal(calls,3);assert.equal(recovered.complete,true);assert.equal(recovered.sampleCount,2);assert.equal(cache.size,2);
  assert.ok([...cache.values()].every(r=>!('latitude'in r)&&!('address'in r)));
  const controller=new AbortController();controller.abort();await assert.rejects(loadReferenceHealth(records,'km',fetch,{signal:controller.signal}),{name:'AbortError'});
});
test('health refresh uses latest charge rows, retains older baseline and declares a missed new interval',()=>{
  const units={unit_of_length:'km'},old=Array.from({length:20},(_,i)=>({charge_id:i+1,start_date:stamp(i),battery_details:{end_battery_level:80}}));
  const head=Array.from({length:50},(_,i)=>({charge_id:i+1,start_date:stamp(i),battery_details:{end_battery_level:100}}));
  const overlap=mergeHealthCharges(old,{charges:head,units},units,true);assert.equal(overlap.complete,true);assert.equal(overlap.charges.length,50);assert.equal(overlap.charges.find(r=>r.charge_id===1).battery_details.end_battery_level,100);
  const missed=mergeHealthCharges(old,{charges:head.map(r=>({...r,charge_id:r.charge_id+100})),units},units,true);assert.equal(missed.complete,false);assert.equal(missed.charges.length,70);
  assert.equal(mergeHealthCharges(old,{charges:head,units},units,false).complete,false);
  assert.equal(mergeHealthCharges(old,{charges:head.slice(0,3),units},units,true).charges.length,3);
  assert.throws(()=>mergeHealthCharges(old,{charges:head,units:{unit_of_length:'mi'}},units,true));
  assert.throws(()=>mergeHealthCharges(old,{charges:head},units,true));
});
test('measured acceleration/braking fixture gives one merged event each, in km and mi',()=>{
  const fixture=ps([[0,0],[1,12],[2,24],[3,36],[4,36],[5,22],[6,8],[7,0]]),samples=telemetrySamples({drive_details:fixture});
  const a=analyzeDriving(samples,'km');assert.equal(a.accel,1);assert.equal(a.brake,1);assert.equal(a.valid,7);assert.equal(a.coverage,1);
  const miles=analyzeDriving(samples.map(p=>({...p,speed:p.speed/1.609344})),'mi');assert.equal(miles.accel,1);assert.equal(miles.brake,1);
});
test('same-second samples never gain fake one-second durations and sparse data is insufficient',()=>{
  const duplicates=telemetrySamples({drive_details:ps([[0,0],[0,12],[0,24],[0,36],[1,36],[2,36]])});
  const a=analyzeDriving(duplicates,'km');assert.equal(a.same,3);assert.equal(a.valid,2);assert.equal(a.accel,1);
  assert.equal(analyzeDriving(duplicates.filter(p=>p.t===duplicates[0].t),'km').accel,null);
  const sparse=analyzeDriving(telemetrySamples({drive_details:ps([[0,0],[60,60],[120,0]])}),'km');assert.equal(sparse.rating,'数据不足');assert.equal(sparse.accel,null);
  const noGPS=telemetrySamples({drive_details:ps([[0,0],[1,12],[2,24]],).map(p=>({...p,longitude:null}))});assert.equal(analyzeDriving(noGPS,'km').accel,1);
  assert.equal(analyzeDriving(noGPS,'km',{durationMs:120000}).accel,null);
});
test('health daily buckets declare and respect the chosen timezone at midnight',()=>{
  const records=[charge(1,'01',[[500,100]]),{...charge(2,'02',[[480,100]]),start_date:'2026-10-01T20:00:00Z'}].map(r=>healthSession(r,'km'));
  const utc=referenceBatteryHealth(records,{}, {timeZone:'UTC'}),cn=referenceBatteryHealth(records,{}, {timeZone:'Asia/Shanghai'});
  assert.equal(utc.sampleDays,1);assert.equal(cn.sampleDays,2);assert.equal(cn.timeZone,'Asia/Shanghai');
});
test('stable-time route ordering no longer turns valid reordered points into source gaps',()=>{
  const raw=ps([[0,0],[2,10],[1,5],[2,11],[3,12]]),before=structuredClone(raw),samples=driveSamples({drive_details:raw});
  assert.deepEqual(samples.map(p=>p.sourceIndex),[0,2,1,3,4]);for(let i=1;i<samples.length;i++)assert.equal(isTelemetryGap(samples[i-1],samples[i]),false);assert.deepEqual(raw,before);
  const missing=driveSamples({drive_details:ps([[0,0],[1,5,{longitude:null}],[2,10]])});assert.equal(isTelemetryGap(missing[0],missing[1]),true);
});
test('isolated impossible GPS excursion is hidden only from derived display, plausible turns survive',()=>{
  const raw=ps([[0,10],[1,10,{longitude:123}],[2,10,{longitude:121.0001}],[3,10,{longitude:121.0002}]]),before=structuredClone(raw);
  const plan=driveRoute({drive_details:raw});assert.equal(plan.isolatedSpikes,1);assert.deepEqual(plan.samples.map(p=>p.sourceIndex),[0,2,3]);assert.deepEqual(raw,before);
  const turn=driveSamples({drive_details:ps([[0,30],[10,30,{longitude:121.001}],[20,30,{longitude:121,latitude:31.001}]])});assert.equal(inspectDriveRoute(turn).isolatedSpikes,0);
});
test('curve interpolation bridges short missing samples but never long/parked gaps or mutates evidence',()=>{
  const rows=[{x:0,y:0},{x:1000,y:10},{x:2000,y:null},{x:3000,y:30},{x:200000,y:40}],before=structuredClone(rows);
  const p=interpolatedChart(rows);assert.equal(p.bridges.length,1);assert.equal(p.longGaps,1);assert.deepEqual(p.bridges[0].map(p=>p.x),[1000,3000]);assert.deepEqual(rows,before);
  assert.equal(interpolatedChart([{x:0,y:0,stopped:true},{x:20000,y:10,stopped:true}]).bridges.length,0);
  assert.equal(interpolatedChart(rows,{maxInterpolationGapMs:0}).bridges.length,0);
});
