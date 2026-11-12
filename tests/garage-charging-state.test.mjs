import test from 'node:test';
import assert from 'node:assert/strict';
import {garageChargingState} from '../src/garage-charging-state.mjs';

const now = Date.parse('2026-10-23T02:00:00Z'), date = new Date(now).toISOString();
const charging = (extra = {}) => ({state: 'charging', date, charging_details: {plugged_in: true, charger_power: 7, ...extra}});
const inspect = status => garageChargingState(status, now, now);

test('fresh positive-power charging shows a connected cable and energy flow', () => {
  assert.deepEqual(inspect(charging()), {connected: true, animate: true, phase: 'charging', label: '正在补能'});
  assert.equal(inspect({...charging({charging_state: 'Charging'}), state: 'parked'}).animate, true);
});

test('connected, paused and complete states retain a stationary cable', () => {
  for (const [status, phase] of [
    [{...charging({charger_power: 0}), state: 'parked'}, 'connected'],
    [charging({charger_power: 0}), 'paused'],
    [charging({charging_state: 'Stopped'}), 'paused'],
    [charging({charging_state: 'Complete'}), 'complete'],
  ]) {
    const result = inspect(status);
    assert.equal(result.phase, phase);
    assert.equal(result.connected, true);
    assert.equal(result.animate, false);
  }
});

test('explicit disconnection overrides contradictory charging and completion fields', () => {
  for (const details of [{plugged_in: false}, {charging_state: 'Disconnected'}, {charging_state: 'Unplugged'}, {plugged_in: false, charging_state: 'Complete'}]) {
    assert.deepEqual(inspect(charging(details)), {connected: false, animate: false, phase: 'unplugged', label: '充电枪未连接'});
  }
});

test('charge-port door and power alone do not imply an inserted connector', () => {
  for (const details of [{charge_port_door_open: true}, {charger_power: 7}, {charge_port_door_open: true, charger_power: 7}]) {
    const result = inspect({state: 'parked', date, charging_details: details});
    assert.equal(result.connected, false);
    assert.equal(result.animate, false);
  }
  assert.equal(garageChargingState(null, null, now).connected, false);
});

test('missing or invalid power retains reported connection without fabricated energy flow', () => {
  for (const power of [undefined, null, NaN, -1, '7']) {
    const result = inspect(charging({charger_power: power}));
    assert.equal(result.connected, true);
    assert.equal(result.animate, false);
    assert.equal(result.phase, 'reported');
  }
});

test('offline, sleeping and suspended vehicles have no live cable or flow', () => {
  for (const state of ['offline', 'asleep', 'suspended']) {
    const result = inspect({...charging(), state});
    assert.equal(result.connected, false);
    assert.equal(result.animate, false);
    assert.equal(result.phase, 'offline');
  }
});

test('driving state, positive speed or drive/reverse gear reject conflicting charging reports', () => {
  for (const changes of [{state: 'driving'}, {driving_details: {speed: 1}}, {driving_details: {speed: 0, shift_state: 'D'}}, {driving_details: {speed: 0, shift_state: 'R'}}]) {
    const result = inspect({...charging(), ...changes});
    assert.equal(result.connected, false);
    assert.equal(result.animate, false);
    assert.equal(result.phase, 'driving');
  }
  assert.equal(inspect({...charging(), driving_details: {speed: 0, shift_state: 'P'}}).animate, true);
});

test('source and receipt expiry remove the cable at the shared 30-second boundary', () => {
  assert.equal(garageChargingState(charging(), now, now + 30000).animate, true);
  assert.equal(garageChargingState(charging(), now, now + 30001).connected, false);
  for (const status of [charging(), charging({charging_state: 'Complete'})]) {
    const result = garageChargingState(status, now, now + 60000);
    assert.equal(result.connected, false);
    assert.equal(result.animate, false);
    assert.equal(result.phase, 'history');
  }
  assert.equal(inspect({...charging(), date: new Date(now - 60000).toISOString()}).connected, false);
  assert.equal(inspect(charging({date: new Date(now - 60000).toISOString()})).connected, false);
});

test('unknown source time follows receipt freshness while missing receipt and clock anomalies remain hidden', () => {
  const status = charging();
  delete status.date;
  assert.equal(garageChargingState(status, now, now + 30000).animate, true);
  for (const [received, clock] of [[now, now + 30001], [null, now], [now + 1, now], [now, NaN]]) {
    assert.equal(garageChargingState(status, received, clock).connected, false);
  }
  assert.equal(inspect({...charging(), date: new Date(now + 6000).toISOString()}).connected, false);
});

test('fresh charging timestamp takes precedence over an older generic status timestamp', () => {
  assert.equal(inspect({...charging({date}), date: new Date(now - 60000).toISOString()}).animate, true);
});
