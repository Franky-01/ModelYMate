import {chargingPresentation} from './charging.mjs';
import {telemetryFreshness} from './data-quality.mjs';

const normalized = value => typeof value === 'string' ? value.toLowerCase().replace(/[\s_-]/g, '') : '';
const connectedPhases = new Set(['charging', 'paused', 'complete', 'connected', 'reported']);

// A cable depicts a current physical connection, so it needs stronger evidence
// than the existing charging card, which can also show historical information.
export function garageChargingState(status, received, now = Date.now()) {
  const s = status ?? {}, charge = s.charging_details ?? {}, driving = s.driving_details ?? {};
  const presentation = chargingPresentation(status, received, now);
  const result = (connected, animate, phase = presentation.phase, label = presentation.label) => ({connected, animate, phase, label});
  const vehicle = normalized(s.state), charging = normalized(charge.charging_state ?? s.charging_state);
  const freshness = telemetryFreshness({date: charge.date ?? s.date, timestamp: s.timestamp}, received, now);

  if (!['fresh', 'unknown'].includes(freshness.reason)) {
    return result(false, false, presentation.show ? 'history' : 'unknown', presentation.show ? '最近充电记录' : '充电状态未知');
  }
  if (charge.plugged_in === false || ['disconnected', 'unplugged'].includes(charging)) {
    return result(false, false, 'unplugged', '充电枪未连接');
  }
  if (['offline', 'asleep', 'suspended'].includes(vehicle)) return result(false, false, 'offline', '车辆离线');
  const speed = driving.speed, gear = normalized(driving.shift_state);
  if (vehicle === 'driving' || typeof speed === 'number' && Number.isFinite(speed) && speed > 0 || ['d', 'r'].includes(gear)) {
    return result(false, false, 'driving', '车辆行驶中');
  }

  // An open charge-port door alone is not evidence of an inserted connector.
  const connected = presentation.show && connectedPhases.has(presentation.phase);
  return result(connected, connected && presentation.animate);
}
