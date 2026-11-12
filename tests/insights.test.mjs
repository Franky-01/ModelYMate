import test from 'node:test';
import assert from 'node:assert/strict';
import {filterRecords,parkingEstimates,groupedPlaces,driveDistribution,chargeDistributions} from '../src/insights.mjs';
const drive=(id,start,end,from,to,distance=10)=>({drive_id:id,start_date:start,end_date:end,start_address:from,end_address:to,odometer_details:{odometer_distance:distance},duration_min:20});

test('charging filters require explicit type; sorting keeps unknown values last',()=>{
 const rows=[{charge_id:1,start_date:'bad',duration_min:null,charger_details:{charger_power:250}},{charge_id:2,start_date:'2026-01-01',duration_min:0,fast_charger_info:{fast_charger_present:false}},{charge_id:3,start_date:'2026-01-02',duration_min:90,fast_charger_info:{fast_charger_present:true}}];
 assert.deepEqual(filterRecords([],rows,{}, {}, {}, {charger:'unknown'}).map(r=>r.charge_id),[1]);
 assert.deepEqual(filterRecords([],rows,{}, {}, {}, {charger:'fast'}).map(r=>r.charge_id),[3]);
 assert.deepEqual(filterRecords([],rows,{}, {}, {}, {sort:'oldest'}).map(r=>r.charge_id),[2,3,1]);
 assert.deepEqual(filterRecords([],rows,{}, {}, {}, {sort:'duration'}).map(r=>r.charge_id),[3,2,1]);
});

test('charging distributions preserve valid zero and separate field coverage',()=>{
 const result=chargeDistributions([{start_date:'2026-01-01T00:00:00Z',duration_min:0,battery_details:{start_battery_level:0}},{start_date:'bad',duration_min:-1,battery_details:{start_battery_level:101}},{duration_min:60,battery_details:{start_battery_level:100}}]);
 assert.deepEqual(result.map(r=>[r.valid,r.total]),[[2,3],[2,3],[1,3]]);
 assert.equal(result[0].bands[0].count,1);assert.equal(result[0].bands.at(-1).count,1);
 assert.equal(result[1].bands[0].count,1);assert.equal(result[1].bands.at(-1).count,1);
});
test('filters intersect driver, aliases, distance, dates and cost without treating missing as zero',()=>{
 const d=[drive(1,'2025-01-01T00:00:00Z','2025-01-01T01:00:00Z','Old','B'),drive(2,'2026-01-01T00:00:00Z',null,'A','B',null)];
 const journals={1:{driver:'张',category:'通勤'}};
 assert.deepEqual(filterRecords(d,[],journals,{}, {Old:'家'}, {search:'家',driver:'张',distanceMin:1}).map(r=>r.drive_id),[1]);
 assert.equal(filterRecords(d,[],journals,{}, {},{distanceMax:0}).length,0);
 assert.equal(filterRecords(d,[],journals,{}, {},{start:'2026-01-01'}).length,1);
 const charges=[{charge_id:1},{charge_id:2}],costs={1:{source:'manual',amount:0,currency:'CNY'}};
 assert.equal(filterRecords([],charges,{},costs,{}, {cost:'manual'})[0].charge_id,1);
 assert.equal(filterRecords([],charges,{},costs,{}, {cost:'missing'})[0].charge_id,2);
});
test('parking uses adjacent valid bounded records and explicit aliases; unknown endpoints do not count',()=>{
 const d=[drive(1,'2026-01-01T00:00Z','2026-01-01T01:00Z','A','B'),drive(2,'2026-01-01T03:00Z','2026-01-01T04:00Z','B2','A'),drive(3,'2026-01-01T05:00Z',null,'X','B')];
 assert.equal(parkingEstimates(d).length,0);
 const parking=parkingEstimates(d,{B:'家',B2:'家'});assert.equal(parking.length,1);assert.equal(parking[0].minutes,120);
 assert.equal(parkingEstimates([d[0],{...d[1],start_date:'2026-01-01T00:30Z'}],{B:'家',B2:'家'}).length,0);
});
test('place aggregation deduplicates same-place round trips and preserves missing energy',()=>{
 const d=[drive(1,'2026-01-01T00:00Z','2026-01-01T01:00Z','A','A')];
 const groups=groupedPlaces(d,[{charge_id:1,address:'A',charge_energy_added:null},{charge_id:2,address:'B',charge_energy_added:0}]);
 assert.equal(groups[0].drives.length,1);assert.equal(groups[0].added,null);assert.equal(groups[1].added,0);
});
test('distance distribution converts miles only with known units and keeps coverage',()=>{
 const d=[{odometer_details:{odometer_distance:10}},{odometer_details:{odometer_distance:null}}];
 assert.equal(driveDistribution(d,'mi').bands[1].count,1);assert.equal(driveDistribution(d,'mi').valid,1);assert.equal(driveDistribution(d,'').valid,0);
});
