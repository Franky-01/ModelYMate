import test from 'node:test';
import assert from 'node:assert/strict';
import {
  number, nonNegative, positive, percent, validCoordinate, coordinate,
  decode, mergePage, driveEfficiency, aggregateEfficiency, driveSamples,
  driveAnalysis, replayPosition, chargeSamples, chargeSummary, doorSignals, motionSpeed,
  batteryHealth, periodRows, stats, effectiveCost, costSummary, dailyCostSeries, estimatePrice,
  validateRule, csvCell, exportCSV,
} from '../src/core.mjs';

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `expected finite number, received ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
};
const baseTime = Date.parse('2026-10-14T04:00:00Z');
const units = { unit_of_length: 'km', unit_of_temperature: 'C' };
const drive = (id, distance, energy, extras = {}) => ({
  drive_id: id,
  start_date: '2026-10-14T04:00:00Z',
  odometer_details: { odometer_distance: distance },
  ...(energy === undefined ? {} : { energy_consumed_net: energy }),
  ...extras,
});
const rawPoint = (seconds, speed, extras = {}) => ({
  date: new Date(baseTime + seconds * 1000).toISOString(),
  latitude: 31.2, longitude: 121.4, speed, ...extras,
});
const samples = rows => driveSamples({ drive_details: rows });
const priceRule = (extras = {}) => ({
  id: 'home', name: '家', latitude: 31.2, longitude: 121.4,
  radius: 200, currency: 'CNY', rate: 0.8, timezone: 'Asia/Shanghai',
  periods: [], ...extras,
});
const charge = (extras = {}) => ({
  charge_id: 1, latitude: 31.2, longitude: 121.4,
  start_date: '2026-10-14T15:00:00Z',
  charge_energy_added: 10, charge_energy_used: 12, ...extras,
});

test('numeric fields distinguish missing, invalid and genuine zero', () => {
  for (const value of [null, undefined, '', '0', false, true, NaN, Infinity, -Infinity]) {
    assert.equal(number(value), null);
  }
  assert.equal(number(0), 0);
  assert.equal(number(-12), -12);
  assert.equal(nonNegative(-1), null);
  assert.equal(nonNegative(0), 0);
  assert.equal(positive(0), null);
  assert.equal(percent(0), 0);
  assert.equal(percent(100), 100);
  assert.equal(percent(101), null);
});

test('HTTP 200 business errors take precedence over an otherwise valid data object', () => {
  assert.throws(() => decode({ error: 'query failed', data: { cars: [] } }), /query failed/);
  assert.throws(() => decode({ error: { code: 7 }, data: { cars: [] } }));
  assert.deepEqual(decode({ error: null, data: { cars: [] } }), { cars: [] });
});

test('decode rejects unauthenticated HTTP and malformed envelopes', () => {
  for (const status of [301, 401, 403, 404, 500]) {
    assert.throws(() => decode({ data: { cars: [] } }, status));
  }
  for (const payload of [null, {}, { data: null }, { data: [] }, { data: 'login page' }]) {
    assert.throws(() => decode(payload));
  }
});

test('history null is an empty page, while absent or non-array history is a schema error', () => {
  const existing = [{ drive_id: 1 }];
  const result = mergePage(existing, { drives: null, units: { unit_of_length: 'mi' } }, 'drives', units);
  assert.deepEqual(result.rows, existing);
  assert.deepEqual(result.units, units);
  assert.equal(result.done, true);
  assert.throws(() => mergePage([], {}, 'drives'));
  assert.throws(() => mergePage([], { drives: {} }, 'drives'));
});

test('pagination de-duplicates both existing records and repeated IDs inside one page', () => {
  const original = [{ drive_id: 1, value: 'original' }];
  const incoming = { drives: [{ drive_id: 1 }, { drive_id: 2 }, { drive_id: 2 }, { drive_id: 3 }], units };
  const result = mergePage(original, incoming, 'drives', units);
  assert.deepEqual(result.rows.map(r => r.drive_id), [1, 2, 3]);
  assert.equal(result.rows[0].value, 'original');
  assert.deepEqual(original, [{ drive_id: 1, value: 'original' }]);
  assert.equal(incoming.drives.length, 4);
});

test('pagination rejects invalid IDs rather than silently publishing incomplete history', () => {
  for (const id of [undefined, null, 0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => mergePage([], { drives: [{ drive_id: id }], units }, 'drives'));
  }
});

test('pagination stops repeated pages without appending duplicate history', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ drive_id: i + 1 }));
  const result = mergePage(rows, { drives: rows, units }, 'drives', units);
  assert.deepEqual(result.rows, rows);
  assert.equal(result.done, true);
});

test('a nonempty page cannot change a known distance unit', () => {
  assert.throws(() => mergePage([{ drive_id: 1 }], {
    drives: [{ drive_id: 2 }], units: { ...units, unit_of_length: 'mi' },
  }, 'drives', units));
});

test('history never aggregates known and missing distance units', () => {
  assert.throws(() => mergePage([{ drive_id: 1 }], {
    drives: [{ drive_id: 2 }], units: { unit_of_temperature: 'C' },
  }, 'drives', units));
  assert.throws(() => mergePage([{ drive_id: 1 }], {
    drives: [{ drive_id: 2 }], units,
  }, 'drives', {}));
});

test('history protects energy and currency units as well as distance', () => {
  for (const [key, first, second] of [
    ['unit_of_energy', 'kWh', 'Wh'], ['currency', 'CNY', 'USD'],
  ]) {
    assert.throws(() => mergePage([{ charge_id: 1 }], {
      charges: [{ charge_id: 2 }], units: { ...units, [key]: second },
    }, 'charges', { ...units, [key]: first }));
  }
});

test('WGS coordinates preserve valid boundaries and exclude sentinel or invalid values', () => {
  assert.equal(validCoordinate(31.2, 121.4), true);
  assert.equal(validCoordinate(90, -180), true);
  assert.equal(validCoordinate(0, 121.4), true);
  for (const [latitude, longitude] of [
    [0, 0], [91, 121], [31, -181], [NaN, 121], [31, Infinity], [null, 121], ['31', 121],
  ]) assert.equal(validCoordinate(latitude, longitude), false);
  assert.deepEqual(coordinate({ location: { latitude: 31.2, longitude: 121.4 } }), [121.4, 31.2]);
  assert.equal(coordinate({ location: null }), null);
});

test('door signals distinguish absent and non-boolean telemetry from confirmed closed', () => {
  const unknown = doorSignals(null);
  assert.equal(Object.keys(unknown).length, 7);
  assert.ok(Object.values(unknown).every(value => value === null));
  const partial = doorSignals({ car_status: { driver_front_door_open: true, trunk_open: false, frunk_open: 0 } });
  assert.equal(partial.driverFront, true);
  assert.equal(partial.trunk, false);
  assert.equal(partial.frunk, null);
  assert.equal(partial.passengerFront, null);
  // Null is the contract used by the scene to retain its last confirmed pose.
  assert.equal(doorSignals({ car_status: {} }).driverFront, null);
});

test('door aliases work and charging_details owns the charge-port signal', () => {
  const result = doorSignals({
    car_status: { front_left_door_open: true, rear_right_door_open: false, charge_port_open: false },
    charging_details: { charge_port_door_open: true },
  });
  assert.equal(result.driverFront, true);
  assert.equal(result.passengerRear, false);
  assert.equal(result.chargePort, true);
});

test('garage motion requires recent driving telemetry and stops for P, zero, missing and offline', () => {
  const moving = { date: new Date(baseTime).toISOString(), state: 'driving', driving_details: { speed: 18, shift_state: 'D' } };
  close(motionSpeed(moving, units, baseTime, baseTime + 30000), 5);
  assert.equal(motionSpeed(moving, units, baseTime, baseTime + 30001), 0);
  assert.equal(motionSpeed(moving, units, baseTime + 1, baseTime), 0);
  assert.equal(motionSpeed(moving, units, null, baseTime), 0);
  for (const state of ['offline', 'parked', 'charging', 'asleep']) {
    assert.equal(motionSpeed({ ...moving, state }, units, baseTime, baseTime), 0);
  }
  for (const speed of [0, -1, null, NaN]) {
    assert.equal(motionSpeed({ ...moving, driving_details: { speed, shift_state: 'D' } }, units, baseTime, baseTime), 0);
  }
  assert.equal(motionSpeed({ ...moving, driving_details: { speed: 18, shift_state: 'P' } }, units, baseTime, baseTime), 0);
  assert.equal(motionSpeed(moving, {}, baseTime, baseTime), 0);
});

test('reverse motion and mph conversion use SI velocity, with a presentation speed cap', () => {
  const reverse = { date: new Date(baseTime).toISOString(), state: 'driving', driving_details: { speed: 10, shift_state: 'R' } };
  close(motionSpeed(reverse, { unit_of_length: 'mi' }, baseTime, baseTime), -4.4704);
  assert.equal(motionSpeed({ ...reverse, driving_details: { speed: 100, shift_state: 'D' } }, units, baseTime, baseTime), 8);
});

test('audited TeslaMateAPI mile-scaled consumption is restored to Wh/km before integration', () => {
  const result = driveEfficiency(drive(1, 100, undefined, { consumption_net: 200/1.609344 }), 'mi');
  close(result.energy, 32.18688);
  close(result.consumption, 20);
  assert.equal(result.estimated, false);
});

test('SOC and mileage alone do not invent energy assumptions', () => {
  const soc = driveEfficiency(drive(1, 20, undefined, { battery_details: { start_battery_level: 90, end_battery_level: 80 } }), 'km');
  assert.equal(soc.energy, null);
  assert.equal(soc.estimated, false);
  const mileage = driveEfficiency(drive(2, 20, undefined, { battery_details: {} }), 'km');
  assert.equal(mileage.energy, null);
  assert.equal(mileage.estimated, false);
  const bare = driveEfficiency(drive(3, 20), 'km');
  assert.equal(bare.energy, null);
  assert.equal(bare.estimated, false);
});

test('measured zero energy is retained and cannot be replaced by a nominal estimate', () => {
  const result = driveEfficiency(drive(1, 20, 0, { battery_details: { start_battery_level: 90, end_battery_level: 80 } }));
  assert.equal(result.energy, 0);
  assert.equal(result.consumption, 0);
  assert.equal(result.estimated, false);
});

test('range achievement is gated by explicit precision, un-reduced range and known units', () => {
  const fixture = drive(1, 50, 10, {
    battery_details: { is_sufficiently_precise: true, reduced_range: false },
    range_rated: { start_range: 400, end_range: 300 },
  });
  close(driveEfficiency(fixture).achievement, 50);
  for (const battery_details of [
    {}, { is_sufficiently_precise: false },
    { is_sufficiently_precise: true, reduced_range: true },
  ]) assert.equal(driveEfficiency({ ...fixture, battery_details }).achievement, null);
  assert.equal(driveEfficiency(fixture, '').achievement, null);
  assert.equal(driveEfficiency({ ...fixture, range_rated: { start_range: 400, end_range: 400 } }).achievement, null);
});

test('aggregate efficiency uses matched numerator/denominator totals, not mean percentages', () => {
  const rows = [
    drive(1, 10, 1, { battery_details: { is_sufficiently_precise: true, start_battery_level: 90, end_battery_level: 85 }, range_rated: { start_range: 400, end_range: 390 } }),
    drive(2, 90, 18, { battery_details: { is_sufficiently_precise: true, start_battery_level: 85, end_battery_level: 75 }, range_rated: { start_range: 390, end_range: 210 } }),
  ];
  const result = aggregateEfficiency(rows);
  close(result.achievement, 100 / 190 * 100);
  close(result.distancePerPercent, 100 / 15);
  close(result.consumption, 19);
  assert.equal(result.validRangeCount, 2);
  const withInvalidRange = aggregateEfficiency([...rows, drive(3, 1000, undefined)]);
  close(withInvalidRange.achievement, result.achievement);
  close(withInvalidRange.consumption, result.consumption);
});

test('sample parsing keeps source indexes and stable order at identical timestamps', () => {
  const result = samples([
    rawPoint(1, 10, { detail_id: 0 }),
    rawPoint(0, 20, { detail_id: 0 }),
    rawPoint(0, 30, { detail_id: 0 }),
    rawPoint(0, 40, { latitude: 0, longitude: 0 }),
    rawPoint(2, null, { power: -12, elevation: null }),
  ]);
  assert.deepEqual(result.map(p => p.sourceIndex), [1, 2, 0, 4]);
  assert.equal(result.at(-1).speed, null);
  assert.equal(result.at(-1).power, -12);
  assert.equal(result.at(-1).elevation, null);
});

test('same-second speed samples cannot fabricate positive elapsed time or harsh events', () => {
  const result = driveAnalysis(samples([rawPoint(0, 0), rawPoint(0, 36), rawPoint(0, 36)]), 'km');
  assert.equal(result.valid, 0);
  assert.equal(result.same, 2);
  assert.equal(result.accel, null);
  assert.equal(result.brake, null);
  assert.equal(result.rating, '数据不足');
});

test('driving analysis does not bridge removed source rows, long gaps or missing speeds', () => {
  const removed = samples([rawPoint(0, 0), rawPoint(1, 0, { latitude: 0, longitude: 0 }), rawPoint(2, 100)]);
  assert.equal(driveAnalysis(removed, 'km').valid, 0);
  const missing = driveAnalysis(samples([rawPoint(0, 0), rawPoint(1, null), rawPoint(2, 100)]), 'km');
  assert.equal(missing.accel, null);
  const gap = driveAnalysis(samples([rawPoint(0, 0), rawPoint(31, 100)]), 'km');
  assert.equal(gap.gaps, 1);
  assert.equal(gap.accel, null);
  const unknown = driveAnalysis(samples([rawPoint(0, 0), rawPoint(1, 20), rawPoint(2, 20)]), 'unknown');
  assert.equal(unknown.valid, 0);
  assert.equal(unknown.brake, null);
});

test('harsh-driving events merge near crossings and retain separated events with dense coverage', () => {
  const acceleration = driveAnalysis(samples([
    rawPoint(0, 0), rawPoint(1, 40), rawPoint(2, 40),
    rawPoint(3, 80), rawPoint(4, 80),rawPoint(5,80),rawPoint(6,80),rawPoint(7,80),rawPoint(8, 80), rawPoint(9, 120), rawPoint(10, 120),
  ]), 'km');
  assert.equal(acceleration.accel, 2);
  const braking = driveAnalysis(samples([
    rawPoint(0, 120), rawPoint(1, 80), rawPoint(2, 80),
    rawPoint(3, 40),rawPoint(4,40),rawPoint(5,40),rawPoint(6,40),rawPoint(7,40), rawPoint(8, 40), rawPoint(9, 0), rawPoint(10, 0),
  ]), 'km');
  assert.equal(braking.brake, 2);
});

test('replay interpolates ordinary intervals but holds through a telemetry outage', () => {
  const ordinary = samples([rawPoint(0, 10), rawPoint(10, 20, { longitude: 121.5 })]);
  close(replayPosition(ordinary, 5000).longitude, 121.45);
  close(replayPosition(ordinary, -1000).longitude, 121.4);
  close(replayPosition(ordinary, 20000).longitude, 121.5);
  const outage = samples([rawPoint(0, 10), rawPoint(121, 20, { longitude: 121.5 })]);
  assert.equal(replayPosition(outage, 60000).longitude, 121.4);
  assert.equal(replayPosition(outage, 120999).longitude, 121.4);
  assert.equal(replayPosition(outage, 121000).longitude, 121.5);
  assert.equal(replayPosition([], 0), null);
});

test('replay resolves the later recorded position at equal timestamps without fabricated timing', () => {
  const points = samples([rawPoint(0, 10), rawPoint(0, 20, { longitude: 121.5 }), rawPoint(1, 30, { longitude: 121.6 })]);
  assert.equal(replayPosition(points, 0).longitude, 121.5);
});

test('charge summary retains zero power and weights samples by elapsed time', () => {
  const result = chargeSummary({ charge_energy_added: 30, charge_energy_used: 35, charge_details: [
    { date: rawPoint(0).date, charger_details: { charger_power: 0 } },
    { date: rawPoint(30).date, charger_details: { charger_power: 20 } },
    { date: rawPoint(120).date, charger_details: { charger_power: 10 } },
  ] });
  close(result.average, (10 * 30 + 15 * 90) / 120);
  close(result.efficiency, 30 / 35 * 100);
  assert.equal(result.loss, 5);
  assert.equal(result.peak, 20);
  assert.equal(result.points[0].power, 0);
});

test('charge mean ignores duplicate timestamps and gaps beyond 120 seconds', () => {
  const result = chargeSummary({ charge_details: [
    { date: rawPoint(0).date, charger_details: { charger_power: 0 } },
    { date: rawPoint(60).date, charger_details: { charger_power: 10 } },
    { date: rawPoint(181).date, charger_details: { charger_power: 100 } },
  ] });
  close(result.average, 5);
  const duplicates = chargeSummary({ charge_details: [
    { date: rawPoint(0).date, charger_details: { charger_power: 0 } },
    { date: rawPoint(0).date, charger_details: { charger_power: 10 } },
    { date: rawPoint(60).date, charger_details: { charger_power: 20 } },
  ] });
  close(duplicates.average, 15);
});

test('charge mean sorts timestamps but integrates only forward adjacent source rows', () => {
  const result = chargeSummary({ charge_details: [
    { date: rawPoint(120).date, charger_details: { charger_power: 20 } },
    { date: rawPoint(0).date, charger_details: { charger_power: 0 } },
    { date: rawPoint(60).date, charger_details: { charger_power: 10 } },
  ] });
  close(result.average, 5);
  assert.equal(result.sampledSeconds, 60);
  assert.deepEqual(result.points.map(p=>p.sourceIndex), [1, 2, 0]);
});

test('charge samples preserve removed-row gaps, duplicate order and raw data', () => {
  const raw={charge_details:[
    {date:rawPoint(0).date,charger_details:{charger_power:5}},
    {date:'invalid',charger_details:{charger_power:300}},
    {date:rawPoint(60).date,charger_details:{charger_power:10}},
    {date:rawPoint(60).date,charger_details:{charger_power:20}},
  ]};
  const before=JSON.stringify(raw),points=chargeSamples(raw),result=chargeSummary(raw);
  assert.deepEqual(points.map(p=>p.sourceIndex),[0,2,3]);
  assert.equal(result.average,null);
  assert.equal(result.peak,20);
  assert.equal(result.sampledSeconds,0);
  assert.equal(JSON.stringify(raw),before);
});

test('charge totals keep observed zero without inventing a valid efficiency', () => {
  const result=chargeSummary({charge_energy_added:0,charge_energy_used:0});
  assert.equal(result.added,0);assert.equal(result.used,0);
  assert.equal(result.efficiency,null);assert.equal(result.loss,null);
});

test('inconsistent or missing charger-side energy cannot imply an efficiency', () => {
  for (const fixture of [
    { charge_energy_added: 10, charge_energy_used: 9 },
    { charge_energy_added: 10, charge_energy_used: 0 },
    { charge_energy_added: 0, charge_energy_used: 10 },
    { charge_energy_added: 10 },
  ]) {
    assert.equal(chargeSummary(fixture).efficiency, null);
    assert.equal(chargeSummary(fixture).loss, null);
  }
  assert.equal(chargeSummary({ charge_details: [] }).average, null);
});

test('health may be available independently of capacity, but impossible percentages are rejected', () => {
  assert.equal(batteryHealth({ battery_health_percentage: 95, current_capacity: 0, max_capacity: 0 }), 95);
  close(batteryHealth({ current_capacity: 70, max_capacity: 75 }), 70 / 75 * 100);
  assert.equal(batteryHealth({ battery_health_percentage: 110 }), null);
  assert.equal(batteryHealth({ current_capacity: 80, max_capacity: 75 }), null);
  assert.equal(batteryHealth({ current_capacity: 0, max_capacity: 0 }), null);
});

test('seven-day periods include today and six earlier local dates, excluding missing and future dates', () => {
  const now = new Date(2026, 9, 14, 12, 0, 0);
  const at = (day, hour = 12) => new Date(2026, 9, day, hour).toISOString();
  const rows = [
    { id: 1, start_date: at(8, 0) }, { id: 2, start_date: at(14, 23) },
    { id: 3, start_date: at(7, 23) }, { id: 4, start_date: at(15, 0) }, { id: 5 },
  ];
  assert.deepEqual(periodRows(rows, 7, now).map(r => r.id), [1, 2]);
  assert.deepEqual(periodRows(rows, null, now), rows);
});

test('aggregate average speed uses only records with paired valid distance and positive duration', () => {
  const result = stats([
    drive(1, 100, 10, { duration_min: 60 }),
    drive(2, 50, 5, { duration_min: null }),
    drive(3, null, undefined, { duration_min: 30 }),
    drive(4, -1, undefined, { duration_min: -1 }),
  ], [charge({ charge_energy_added: 0 })], 'km');
  assert.equal(result.distance, 150);
  assert.equal(result.minutes, 90);
  assert.equal(result.averageSpeed, 100);
  assert.equal(result.added, 0);
  assert.equal(result.missingDistance, 2);
  assert.deepEqual(result.coverage.minutes,{valid:2,total:4,partial:true});
  assert.deepEqual(result.coverage.averageSpeed,{valid:1,total:4,partial:true});
});

test('energy totals and weighted consumption report their different paired coverage',()=>{
  const result=stats([
    drive(1,10,2,{duration_min:0}),
    drive(2,null,8,{duration_min:10}),
    drive(3,90,undefined,{duration_min:null}),
    drive(4,0,0,{duration_min:0}),
  ],[{charge_energy_added:0,duration_min:0},{charge_energy_added:null,duration_min:null}], 'km');
  assert.equal(result.energy,10);assert.equal(result.efficiency.consumption,20);
  assert.deepEqual(result.coverage.energy,{valid:3,total:4,partial:true});
  assert.deepEqual(result.coverage.consumption,{valid:1,total:4,partial:true});
  assert.deepEqual(result.efficiency.coverage,result.coverage.consumption);
  assert.equal(result.minutes,10);assert.equal(result.chargeMinutes,0);
  assert.deepEqual(result.coverage.chargeMinutes,{valid:1,total:2,partial:true});
  const unknownUnits=stats([drive(1,10,2,{duration_min:20})],[],undefined);
  assert.equal(unknownUnits.energy,2);assert.equal(unknownUnits.efficiency.consumption,null);
  assert.equal(unknownUnits.averageSpeed,null);assert.equal(unknownUnits.coverage.consumption.valid,0);
});

test('explicit local zero is free, while server zero and invalid local amounts stay unknown', () => {
  assert.equal(effectiveCost(charge({ cost: 0 }), {}), null);
  assert.deepEqual(effectiveCost(charge({ cost: 0 }), { 1: { amount: 0, currency: 'CNY' } }), {
    amount: 0, currency: 'CNY', source: 'manual',
  });
  assert.equal(effectiveCost(charge({ cost: 0 }), { 1: { amount: -1, currency: 'CNY' } }), null);
  assert.equal(effectiveCost(charge({ cost: 0 }), { 1: { amount: 0, currency: 'unknown' } }), null);
  assert.deepEqual(effectiveCost(charge({ cost: 12 }), {}), { amount: 12, currency: '未知币种', source: 'server' });
});

test('cost totals distinguish missing, free, estimated, unmatched energy and currencies',()=>{
  const rows=[
    charge({charge_id:1,charge_energy_used:10}),
    charge({charge_id:2,charge_energy_used:null,charge_energy_added:null}),
    charge({charge_id:3,charge_energy_used:20}),
    charge({charge_id:4,charge_energy_used:4}),
    charge({charge_id:5,cost:0}),
  ];
  const costs={1:{amount:0,currency:'CNY'},2:{amount:6,currency:'CNY'},3:{amount:10,currency:'CNY',source:'estimate'},4:{amount:2,currency:'USD'}};
  const summary=costSummary(rows,costs),cny=summary.groups.CNY,usd=summary.groups.USD;
  assert.deepEqual(summary.coverage,{valid:4,total:5,partial:true});
  assert.equal(summary.missingCount,1);
  assert.equal(cny.actual,6);assert.equal(cny.estimated,10);assert.equal(cny.averagePrice,10/30);
  assert.deepEqual(cny.coverage,{valid:3,total:4,partial:true});
  assert.deepEqual(cny.pairedCoverage,{valid:2,total:4,partial:true});
  assert.equal(usd.actual,2);assert.equal(usd.estimated,null);assert.equal(usd.averagePrice,.5);
  assert.equal(costSummary([charge({cost:5})]).groups['未知币种'].averagePrice,null);
  assert.deepEqual(costSummary([],{}),{groups:{},coverage:{valid:0,total:0,partial:false},missingCount:0});
});

test('daily costs cover the full period and leave days with unresolved costs incomplete',()=>{
  const rows=[
    charge({charge_id:1,start_date:'2026-01-01T12:00:00'}),
    charge({charge_id:2,start_date:'2026-01-01T13:00:00'}),
    charge({charge_id:3,start_date:'2026-01-02T12:00:00'}),
    charge({charge_id:4,start_date:'2026-01-02T13:00:00'}),
  ];
  const costs={1:{amount:5,currency:'CNY'},3:{amount:0,currency:'CNY'},4:{amount:8,currency:'USD'}};
  const series=dailyCostSeries(rows,costs,'CNY',7,new Date(2026,0,3));
  assert.equal(series.length,7);
  const incomplete=series.find(p=>p.key==='2026-01-01'),free=series.find(p=>p.key==='2026-01-02');
  assert.equal(incomplete.y,null);assert.equal(incomplete.valid,1);assert.equal(incomplete.total,2);
  assert.equal(free.y,0);assert.equal(free.total,1);
  assert.equal(series.at(-1).y,null);
});

test('pricing selects the nearest source-coordinate geofence and bills grid energy', () => {
  const rules = [
    priceRule({ name: '远处', latitude: 31.201, rate: 1 }),
    priceRule({ name: '近处', latitude: 31.2001, rate: 0.5 }),
  ];
  const result = estimatePrice(charge(), rules);
  assert.equal(result.rule, '近处');
  assert.equal(result.amount, 6);
  assert.equal(result.basis, '电网用电量');
  assert.equal(result.estimated, true);
  assert.ok(estimatePrice(charge({ latitude: 32 }), rules).error);
  assert.ok(estimatePrice(charge({ latitude: undefined, address: '家' }), rules).error);
});

test('pricing falls back to battery-added energy only when positive grid energy is missing', () => {
  const result = estimatePrice(charge({ charge_energy_used: 0 }), [priceRule()]);
  assert.equal(result.amount, 8);
  assert.equal(result.basis, '电池充入量');
  assert.ok(estimatePrice(charge({ charge_energy_used: null, charge_energy_added: 0 }), [priceRule()]).error);
});

test('local timezone tariffs cross midnight and use an exclusive end boundary', () => {
  const rule = priceRule({ periods: [{ days: [3], start: 22 * 60, end: 6 * 60, rate: 0.4 }] });
  assert.equal(validateRule(rule), null);
  // Wednesday 23:00 in Asia/Shanghai.
  assert.equal(estimatePrice(charge({ start_date: '2026-10-14T15:00:00Z' }), [rule]).amount, 4.8);
  // Thursday 05:59 still belongs to Wednesday's overnight tariff.
  assert.equal(estimatePrice(charge({ start_date: '2026-10-14T21:59:00Z' }), [rule]).amount, 4.8);
  // Thursday 06:00 is excluded from that tariff.
  assert.equal(estimatePrice(charge({ start_date: '2026-10-14T22:00:00Z' }), [rule]).amount, 9.6);
});

test('rule validation detects overnight overlaps across the week boundary', () => {
  const rule = priceRule({ periods: [
    { days: [0], start: 23 * 60, end: 60, rate: 0.3 },
    { days: [1], start: 30, end: 90, rate: 0.4 },
  ] });
  assert.ok(validateRule(rule));
  assert.ok(estimatePrice(charge({ start_date: '2026-10-11T16:45:00Z' }), [rule]).error);
});

test('rules reject invalid radius, timezone, currency and tariff values', () => {
  for (const extras of [
    { radius: 19 }, { radius: 501 }, { radius: NaN }, { radius: Infinity },
    { rate: -1 }, { currency: 'CN' }, { currency: 'cny' }, { timezone: 'No/Such_Zone' },
    { periods: [{ days: [7], start: 0, end: 60, rate: 1 }] },
    { periods: [{ days: [1], start: 60, end: 60, rate: 1 }] },
  ]) assert.ok(validateRule(priceRule(extras)), `invalid rule accepted: ${JSON.stringify(extras)}`);
});

test('CSV quoting preserves text, while formula-like prefixes are neutralized after whitespace', () => {
  assert.equal(csvCell('a,"b"\nnext'), '"a,""b""\nnext"');
  assert.equal(csvCell(null), '""');
  for (const value of ['=SUM(1,2)', '+1', '-1', '@A1', '   =SUM(1,2)', ' \t+1']) {
    assert.equal(csvCell(value), `"'${value.replaceAll('"', '""')}"`);
  }
});

function parseCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\r' || ch === '\n') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (row.length || cell.length) { row.push(cell); rows.push(row); }
  return rows;
}

test('export retains source values and annotations, separates manual cost and omits estimated net energy', () => {
  const originalDrive = drive(8, 20, undefined, {
    start_address: '原始英文地址', end_address: 'A,"B"',
    battery_details: { start_battery_level: 90, end_battery_level: 80 },
  });
  const originalCharge = charge({ cost: 0 });
  const before = JSON.stringify([originalDrive, originalCharge]);
  const csv = exportCSV([originalDrive], [originalCharge], units, {
    8: { category: '个人', subcategory: '买菜', note: '=formula\n第二行' },
  }, { 1: { amount: 0, currency: 'CNY', source: 'manual' } });
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const rows = parseCSV(csv);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.length === 23));
  assert.equal(rows[1][20], '未知');
  assert.equal(rows[1][22], '已载入历史');
  assert.equal(rows[1][4], '原始英文地址');
  assert.equal(rows[1][5], 'A,"B"');
  assert.equal(rows[1][11], '');
  assert.equal(rows[1][19], "'=formula\n第二行");
  assert.equal(rows[2][14], '0');
  assert.equal(rows[2][15], 'CNY');
  assert.equal(rows[2][16], 'manual');
  assert.equal(JSON.stringify([originalDrive, originalCharge]), before);
});
