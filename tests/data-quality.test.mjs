import test from 'node:test';
import assert from 'node:assert/strict';
import {telemetryFreshness,chartSegments,dailySeries,coverageText,nearestChartIndex} from '../src/data-quality.mjs';
import {motionSpeed,stats,exportCSV} from '../src/core.mjs';
const now=Date.parse('2026-10-15T12:00:00Z');
test('frozen upstream, missing sample time and clock skew cannot masquerade as live motion',()=>{
 const s={date:new Date(now-600000).toISOString(),state:'driving',driving_details:{speed:18}};
 assert.equal(telemetryFreshness(s,now,now).reason,'stale');
 assert.equal(motionSpeed(s,{unit_of_length:'km'},now,now),0);
 assert.equal(telemetryFreshness({...s,date:undefined,state_since:new Date(now).toISOString()},now,now).reason,'unknown');
 assert.equal(telemetryFreshness({...s,date:new Date(now+60000).toISOString()},now,now).reason,'clock');
 assert.equal(telemetryFreshness({...s,date:new Date(now).toISOString()},now,now).fresh,true);
 assert.equal(telemetryFreshness({...s,date:new Date(now).toISOString()},now,now+31000).fresh,false);
 assert.equal(motionSpeed({...s,date:new Date(now).toISOString()},{unit_of_length:'km'},now,now),5);
});
test('partial totals retain zero and reveal independent coverage',()=>{
 const v=stats([{odometer_details:{odometer_distance:10},energy_consumed_net:0},{odometer_details:{odometer_distance:20}}],[{charge_energy_added:0},{}],'km');
 assert.equal(v.energy,0);assert.equal(v.added,0);assert.equal(v.distance,30);
 assert.deepEqual(v.coverage.energy,{valid:1,total:2,partial:true});assert.match(coverageText(v.coverage.energy),/部分/);
});
test('100k chart retains single missing sample, extrema, same-time records and source gaps',()=>{
 const p=Array.from({length:100000},(_,i)=>({x:now+i*1000,y:i===501?null:i===504?-100:i===505?900:2,sourceIndex:i}));
 const before=JSON.stringify(p),runs=chartSegments(p);
 assert.equal(runs.length,2);assert.equal(runs[0].at(-1).index,500);assert.equal(runs[1][0].index,502);
 assert.ok(runs.flat().some(x=>x.y===-100));assert.ok(runs.flat().some(x=>x.y===900));assert.equal(JSON.stringify(p),before);
 assert.equal(chartSegments([{x:1,y:1,sourceIndex:0},{x:1,y:2,sourceIndex:1},{x:2,y:3,sourceIndex:5}]).length,2);
 assert.equal(chartSegments([{x:now,y:1},{x:now+180000,y:2}]).length,2);
});
test('all/90 day series includes historical dates across the year boundary',()=>{
 const rows=[{start_date:'2025-12-20T12:00:00',odometer_details:{odometer_distance:10}},{start_date:'2026-02-05T12:00:00',odometer_details:{odometer_distance:20}}];
 const all=dailySeries(rows,'distance',0,new Date(2026,1,5));assert.equal(all[0].key,'2025-12-20');assert.equal(all.at(-1).key,'2026-02-05');assert.equal(all.filter(x=>x.y!==null).length,2);
 assert.equal(dailySeries(rows,'distance',90,new Date(2026,1,5)).length,90);
});
test('private CSV excludes addresses, free text and driver while retaining measured values',()=>{
 const csv=exportCSV([{drive_id:1,start_address:'SecretHome',end_address:'SecretWork',energy_consumed_net:2}],[],{unit_of_length:'km'},{1:{note:'SecretNote',subcategory:'SecretSub',driver:'SecretDriver'}},{},{private:true,partial:true});
 for(const secret of ['SecretHome','SecretWork','SecretNote','SecretSub','SecretDriver'])assert.ok(!csv.includes(secret));
 assert.match(csv,/已载入部分历史/);
});

test('freshness requires a finite receipt and an explicitly zoned source sample',()=>{
 const status={date:'2026-10-15T12:00:00Z'};
 for(const receipt of [null,undefined,NaN,Infinity,'1792065600000',0,-1])assert.equal(telemetryFreshness(status,receipt,now).reason,'unread');
 assert.equal(telemetryFreshness(status,now,now-1).reason,'clock');
 assert.equal(telemetryFreshness(status,now,NaN).reason,'clock');
 assert.equal(telemetryFreshness({date:'2026-10-15T12:00:00'},now,now).reason,'unknown');
 assert.equal(telemetryFreshness({timestamp:now/1000},now,now).fresh,true);
 assert.equal(telemetryFreshness({timestamp:now},now,now).fresh,true);
 const frozenDriving={...status,driving_details:{date:new Date(now-60000).toISOString()}};
 assert.equal(telemetryFreshness(frozenDriving,now,now).reason,'stale');
});

test('daily series keeps cross-year dates separate and never treats a missing date as 1970',()=>{
 const rows=[
  {start_date:null,odometer_details:{odometer_distance:800}},
  {start_date:'bad',odometer_details:{odometer_distance:900}},
  {start_date:'2025-01-01T12:00:00',odometer_details:{odometer_distance:10}},
  {start_date:'2026-01-01T12:00:00',odometer_details:{odometer_distance:20}},
  {start_date:'2026-01-01T13:00:00',odometer_details:{odometer_distance:null}},
  {start_date:'2026-01-02T12:00:00',odometer_details:{odometer_distance:0}},
 ];
 const series=dailySeries(rows,'distance',0,new Date(2026,0,2));
 assert.equal(series[0].key,'2025-01-01');assert.equal(series[0].y,10);
 assert.equal(series.find(p=>p.key==='2026-01-01').y,null);
 assert.deepEqual(series.find(p=>p.key==='2026-01-01'),{x:new Date(2026,0,1).getTime(),key:'2026-01-01',y:null,valid:1,total:2});
 assert.equal(series.at(-1).y,0);
 assert.equal(dailySeries([{start_date:null}],'distance',0,new Date(2026,0,2)).length,1);
 assert.deepEqual(dailySeries(rows,'distance',90,new Date('bad')),[]);
});

test('chart hit testing skips invalid timestamps while retaining empty days',()=>{
 const points=[{x:NaN,y:10},{x:10,y:1},{x:20,y:null},{x:30,y:3}];
 assert.equal(nearestChartIndex(points,19),2);
 assert.equal(nearestChartIndex(points,29),3);
 assert.equal(nearestChartIndex([{x:Infinity,y:1}],0),null);
 assert.equal(nearestChartIndex(points,NaN),null);
});

test('simplification retains every gap boundary even when that exceeds the point budget',()=>{
 const points=Array.from({length:1000},(_,i)=>({x:now+i*1000,y:i%2===0?i:null}));
 const runs=chartSegments(points,20);
 assert.equal(runs.length,500);
 assert.ok(runs.every(run=>run.length===1));
 assert.equal(runs[499][0].index,998);
});
