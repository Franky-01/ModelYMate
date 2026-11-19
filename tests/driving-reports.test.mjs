import test from 'node:test';
import assert from 'node:assert/strict';
import {drivingReport, milestones} from '../src/driving-reports.ts';
const now = new Date(2026, 10, 19, 14);
const drive = (id, day, distance, speed) => ({
  drive_id:id, start_date:new Date(2026,10,day,9).toISOString(), duration_min:15,
  odometer_details:{odometer_distance:distance}, speed_avg:speed, speed_max:speed
});

test('driving report compares adjacent local periods only with complete distance coverage', () => {
  const rows = [drive(1,19,5,0), drive(2,19,5,30), drive(3,19,2,60), drive(4,19,0,90), drive(5,18,8,null)];
  const report = drivingReport(rows, [], 'km', 1, now, true);
  assert.equal(report.distanceChange,50);
  assert.equal(report.representative.drive_id,1);
  assert.deepEqual(report.bands.map(b=>b.count),[1,1,1,1]);
  assert.equal(report.groups['2026-11-19'].length,4);
  for (const input of [[rows,0,true],[rows,1,false],[[...rows,drive(6,18,null,20)],1,true],[[...rows,{start_date:'invalid'}],1,true]]) {
    assert.equal(drivingReport(input[0], [], 'km', input[1], now, input[2]).distanceChange,null);
  }
});

test('milestones retain stable winners across trips and charges and distinguish missing from zero on the heatmap', () => {
  const rows = [drive(1,18,8,40),drive(2,18,null,40),drive(3,19,0,null)];
  const result = milestones(rows, [{charge_id:1,duration_min:15,charge_energy_added:0}], 'mi');
  assert.equal(result.top[0].record,rows[0]);
  assert.equal(result.top[1].record,rows[0]);
  assert.equal(result.top[2].kind,'drive');
  assert.equal(result.top[4].record,undefined);
  assert.equal(result.byDay.get('2026-11-18').distance,null);
  assert.deepEqual(result.byDay.get('2026-11-18').rows,rows.slice(0,2));
  assert.equal(result.byDay.get('2026-11-19').distance,0);
  assert.equal(result.values.distance,8*1.609344);
  assert.equal(result.values.longest,result.values.distance);
  assert.equal(result.earliest,Date.parse(rows[0].start_date));
});
