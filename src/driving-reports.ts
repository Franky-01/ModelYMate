import {date, driveEfficiency, localDay, nonNegative, periodRows, positive, stats} from './core.mjs';
import {dailySeries} from './data-quality.mjs';
import type {J} from './api';

export function drivingReport(drives:J[], charges:J[], unit:string, period:number, now:Date, complete:boolean) {
  const rows:J[] = periodRows(drives, period, now);
  const summary = stats(rows, periodRows(charges, period, now), unit);
  const groups:Record<string,J[]> = {};
  const bands = ['0–30', '30–60', '60–90', '90+'].map(label => ({label, count:0}));
  let validSpeeds = 0;
  let representative:J|undefined;
  let longest = 0;
  for (const row of rows) {
    const start = date(row.start_date);
    (groups[start ? localDay(start) : '日期未知'] ??= []).push({...row, kind:'drive'});
    const distance = positive(row.odometer_details?.odometer_distance);
    if (distance !== null && distance > longest) {
      longest = distance;
      representative = row;
    }
    const speed = nonNegative(row.speed_avg);
    if (speed !== null) {
      validSpeeds++;
      bands[Math.min(3, Math.floor(speed / 30))].count++;
    }
  }

  let distanceChange:number|null = null;
  if (period > 0 && complete && rows.length && summary.missingDistance === 0) {
    const start = new Date(now);
    start.setHours(0,0,0,0);
    start.setDate(start.getDate() - period + 1);
    const previous = new Date(start);
    previous.setDate(previous.getDate() - period);
    let previousDistance = 0, comparable = true;
    for (const row of drives) {
      const time = date(row.start_date);
      if (!time) { comparable = false; break; }
      if (time < previous || time >= start) continue;
      const distance = nonNegative(row.odometer_details?.odometer_distance);
      if (distance === null) { comparable = false; break; }
      previousDistance += distance;
    }
    if (comparable && previousDistance > 0) distanceChange = ((summary.distance ?? 0) / previousDistance - 1) * 100;
  }
  return {rows, summary, groups, representative, bands, validSpeeds, distanceChange, trend:dailySeries(rows, 'distance', period, now)};
}

type TopRecord = {title:string; unit:string; value:number|null; record?:J; kind:'drive'|'charge'};

export function milestones(drives:J[], charges:J[], unit:string) {
  const entry = (title:string, unit:string):TopRecord => ({title, unit, value:null, kind:'drive'});
  const distance = entry('最长行程', unit), speed = entry('最高车速', unit === 'mi' ? 'mph' : 'km/h');
  const duration = entry('最长单次时长', '分'), energy = entry('单次行程源净能量', 'kWh');
  const added = entry('单次充入电量', 'kWh'), consumption = entry('最低净能耗', 'kWh/100km');
  function consider(item:TopRecord, value:number|null, record:J, kind:'drive'|'charge', lowest = false) {
    if (value !== null && (item.value === null || (lowest ? value < item.value : value > item.value))) {
      item.value = value;
      item.record = record;
      item.kind = kind;
    }
  }
  const years = new Set<number>();
  const byDay = new Map<string,{distance:number|null; rows:J[]}>();
  let earliest = Infinity, totalDistance = 0, totalAdded = 0;
  for (const row of drives) {
    const length = nonNegative(row.odometer_details?.odometer_distance);
    totalDistance += length ?? 0;
    const efficiency = driveEfficiency(row, unit);
    consider(distance, positive(length), row, 'drive');
    consider(speed, positive(row.speed_max), row, 'drive');
    consider(duration, positive(row.duration_min), row, 'drive');
    consider(energy, efficiency.estimated ? null : efficiency.energy, row, 'drive');
    consider(consumption, efficiency.consumption, row, 'drive', true);
    const start = date(row.start_date);
    if (!start) continue;
    earliest = Math.min(earliest, start.getTime());
    years.add(start.getFullYear());
    const key = localDay(start);
    const group = byDay.get(key) ?? {distance:0, rows:[]};
    group.rows.push(row);
    group.distance = length === null || group.distance === null ? null : group.distance + length;
    byDay.set(key, group);
  }
  for (const row of charges) {
    totalAdded += nonNegative(row.charge_energy_added) ?? 0;
    consider(duration, positive(row.duration_min), row, 'charge');
    consider(added, positive(row.charge_energy_added), row, 'charge');
  }
  const km = unit === 'mi' ? 1.609344 : 1;
  return {
    top:[distance,speed,duration,energy,added,consumption], years, byDay, earliest,
    values:{drives:drives.length, charges:charges.length, distance:totalDistance*km, added:totalAdded, longest:(distance.value ?? 0)*km} as Record<string,number>,
  };
}
