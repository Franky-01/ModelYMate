// TeslaMate data rules shared by UI and regression tests. Missing is never zero.
import {telemetryFreshness,fieldCoverage,dailySeries} from './data-quality.mjs';
import {calibratedDriveEnergy} from './battery.mjs';
import {analyzeDriving,telemetrySamples,inspectDriveRoute} from './telemetry.mjs';
export const number = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
export const nonNegative = v => number(v) !== null && v >= 0 ? v : null;
export const positive = v => number(v) !== null && v > 0 ? v : null;
export const percent = v => number(v) !== null && v >= 0 && v <= 100 ? v : null;
const numberFormats = new Map();
export function fmt(v, digits = 1) {
  if (number(v) === null) return '—';
  // Bound the cache to ordinary precision values. Let Intl keep its existing
  // coercion/range semantics for other values instead of normalizing them here.
  if (!Number.isInteger(digits) || digits < 0 || digits > 20)
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(v);
  let formatter = numberFormats.get(digits);
  if (!formatter) { formatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }); numberFormats.set(digits, formatter); }
  return formatter.format(v);
}
export const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v) : null;
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', month: 'short', day: 'numeric' });
// Read local calendar fields each time, then format them with reusable UTC
// formatters. Device time-zone changes still apply without rebuilding Intl for
// every visible row; the neutral leap year also preserves February 29.
const localDisplayDate = d => Date.UTC(2000, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
export const time = v => { const d = date(v); return d ? timeFormat.format(localDisplayDate(d)) : '—'; };
export const day = v => { const d = date(v); return d ? dayFormat.format(localDisplayDate(d)) : '日期未知'; };
export const localDay = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const stateText = s => ({driving:'行驶中', charging:'充电中', parked:'已停好', asleep:'已休眠', offline:'离线', online:'在线', suspended:'暂停采集'}[s] ?? '状态未知');
export const validCoordinate = (lat, lng) => number(lat) !== null && number(lng) !== null && Math.abs(lat)<=90 && Math.abs(lng)<=180 && (lat !== 0 || lng !== 0);
export function coordinate(v) {
  const loc=v?.location ?? v;
  return validCoordinate(loc?.latitude, loc?.longitude) ? [loc.longitude, loc.latitude] : null;
}
export function decode(payload, status=200) {
  if (status<200 || status>=300) throw new Error(({401:'连接验证失败，请检查认证信息。',403:'没有访问权限。',404:'当前服务不支持此功能。'}[status]) ?? `服务暂时无法访问（${status}）。`);
  if (payload?.error != null) throw new Error(typeof payload.error==='string' ? payload.error : '服务返回错误。');
  if (!payload?.data || typeof payload.data!=='object' || Array.isArray(payload.data)) throw new Error('收到的数据格式不正确。');
  return payload.data;
}
export function mergePage(old, payload, kind, previousUnits={}) {
  if (!Object.hasOwn(payload,kind) || (payload[kind]!==null && !Array.isArray(payload[kind]))) throw new Error('历史记录格式不正确。');
  const rows=payload[kind] ?? [], key=kind==='drives'?'drive_id':'charge_id';
  if(rows.some(r=>!Number.isSafeInteger(r?.[key])||r[key]<=0))throw new Error('历史记录含有无效的编号。');
  const known=new Set(old.map(r=>r[key]));
  const added=rows.filter(r=>Number.isSafeInteger(r[key]) && r[key]>0 && !known.has(r[key]) && known.add(r[key]));
  const units=rows.length ? {...previousUnits,...payload.units} : previousUnits;
  if (rows.length && old.length && ['unit_of_length','unit_of_temperature','unit_of_energy','currency','unit_of_currency'].some(k=>(previousUnits[k]??null)!==(payload.units?.[k]??null))) throw new Error('记录单位发生变化，请刷新后重试。');
  return { rows:[...old,...added], units, done: rows.length<50 || (rows.length>0 && added.length===0) };
}
// Refresh health inputs without discarding a previously loaded historical peak.
// If a wholly new full page no longer overlaps known history, report incomplete.
export function mergeHealthCharges(existing,payload,previousUnits={},wasComplete=false){
  const first=mergePage([],payload,'charges',{}),unit=payload.units?.unit_of_length;
  if(first.rows.length&&(!['km','mi'].includes(unit)||existing.length&&unit!==previousUnits.unit_of_length))throw new Error('充电记录的距离单位缺失或发生变化，请刷新记录后重试。');
  if(first.done)return {charges:first.rows,units:first.rows.length?first.units:previousUnits,complete:true};
  const known=new Set(existing.map(r=>r.charge_id)),merged=new Map(existing.map(r=>[r.charge_id,r]));
  for(const row of first.rows)merged.set(row.charge_id,row);
  return {charges:[...merged.values()].sort((a,b)=>(Date.parse(b.start_date)||0)-(Date.parse(a.start_date)||0)),units:first.units,complete:wasComplete&&first.rows.some(r=>known.has(r.charge_id))};
}
export function driveEfficiency(r, length='km', calibration) {
  const known=['km','mi'].includes(length), dist=known ? positive(r.odometer_details?.odometer_distance) : null;
  const b=r.battery_details ?? {}, rr=r.range_rated ?? {};
  const precise=b.is_sufficiently_precise===true && b.reduced_range!==true;
  const loss=precise && positive(rr.start_range)!==null && nonNegative(rr.end_range)!==null && rr.start_range>rr.end_range ? rr.start_range-rr.end_range : null;
  const socLoss=percent(b.start_battery_level)!==null && percent(b.end_battery_level)!==null && b.start_battery_level>b.end_battery_level ? b.start_battery_level-b.end_battery_level : null;
  const km=dist===null ? null : dist*(length==='mi'?1.609344:1);
  // The audited TeslaMateAPI converts consumption_net with kilometersToMiles
  // when mi is selected (rather than converting Wh/km to Wh/mi). Undo that
  // legacy transform. Prefer net kWh whenever present; never average ratios.
  const wh=number(r.consumption_net),whPerKm=wh===null||!known?null:wh*(length==='mi'?1.609344:1);
  let energy=number(r.energy_consumed_net),estimated=false,source=energy!==null?'source-net-energy':'unknown';
  if(energy===null&&whPerKm!==null&&km>0){energy=whPerKm*km/1000;source='source-consumption';}
  if(energy===null){const estimate=r.energyEstimate??calibratedDriveEnergy(r,length,calibration);if(estimate&&number(estimate.kwh)!==null){energy=estimate.kwh;estimated=true;source=estimate.source;}}
  const consumption=energy!==null&&km>0?energy/km*100:whPerKm!==null?whPerKm/10:null;
  return { distance:dist, energy, estimated,source, consumption, loss, socLoss, achievement:dist!==null && loss>0?dist/loss*100:null, distancePerPercent:dist!==null && socLoss>0?dist/socLoss:null };
}
export function aggregateEfficiency(rows, unit='km') {
  const v=rows.map(r=>driveEfficiency(r,unit)), match=v.filter(x=>x.achievement!==null), soc=v.filter(x=>x.distancePerPercent!==null), energy=v.filter(x=>x.energy!==null && x.distance!==null);
  const sum=(a,k)=>a.reduce((s,x)=>s+x[k],0), ratio=(a,b,scale=1)=>b>0?a/b*scale:null;
  return {achievement:ratio(sum(match,'distance'),sum(match,'loss'),100), distancePerPercent:ratio(sum(soc,'distance'),sum(soc,'socLoss')), consumption:ratio(sum(energy,'energy'),sum(energy,'distance')*(unit==='mi'?1.609344:1),100), estimated:energy.some(x=>x.estimated), validRangeCount:match.length,coverage:fieldCoverage(v.map(x=>x.energy!==null&&x.distance!==null?x.energy:null))};
}
export function driveSamples(r) {
  const rows=telemetrySamples(r),invalidPrefix=[0];
  for(const p of r.drive_details??[])invalidPrefix.push(invalidPrefix.at(-1)+(!date(p.date)||!validCoordinate(p.latitude,p.longitude)?1:0));
  const valid=rows.filter(p=>validCoordinate(p.latitude,p.longitude));
  return valid.map((p,i)=>{const previous=valid[i-1];return {...p,sequenceIndex:i,routeBreakBefore:!!previous&&p.sourceIndex>previous.sourceIndex&&p.t>previous.t&&invalidPrefix[p.sourceIndex]>invalidPrefix[previous.sourceIndex+1]};});
}
export function driveRoute(r){return inspectDriveRoute(driveSamples(r),(r.drive_details??[]).length);}
export function haversine(a,b) {
  const rad=v=>v*Math.PI/180, dlat=rad(b[1]-a[1]), dlng=rad(b[0]-a[0]);
  const h=Math.sin(dlat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dlng/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function driveAnalysis(points, unit, options={}) {
  return analyzeDriving(points,unit,options);
}
const gapThresholds = new WeakMap();
export function routeGapThreshold(points) {
  if (gapThresholds.has(points)) return gapThresholds.get(points);
  const intervals=[];
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],dt=b.t-a.t;
    if(dt>0 && !b.routeBreakBefore) intervals.push(dt);
  }
  intervals.sort((a,b)=>a-b);
  // Accommodate normally sparse logging without mistaking every sample for an outage.
  const median=intervals.length?intervals[Math.floor((intervals.length-1)/2)]:0;
  const threshold=Math.min(120000,Math.max(30000,median*3));
  gapThresholds.set(points,threshold);
  return threshold;
}
export function isTelemetryGap(a,b,threshold=120000) {
  return b.t-a.t>threshold || b.routeBreakBefore===true || (b.routeBreakBefore===undefined&&Number.isInteger(a.sourceIndex) && Number.isInteger(b.sourceIndex) && b.sourceIndex!==a.sourceIndex+1);
}
export function replayPosition(points, elapsed) {
  if(!points.length)return null;
  const target=points[0].t+elapsed;
  let lo=0,hi=points.length-1;
  while(lo<hi){const m=Math.ceil((lo+hi)/2);if(points[m].t<=target)lo=m;else hi=m-1;}
  const a=points[lo],b=points[lo+1],gap=b?b.t-a.t:0;
  if(!b || gap<=0)return {...a,gap:false};
  if(isTelemetryGap(a,b,routeGapThreshold(points)) && target>a.t)return {...a,gap:true,speed:null,power:null,elevation:null,inside:null,outside:null};
  const x=Math.min(1,Math.max(0,(target-a.t)/gap));
  return {...a,t:target,gap:false,longitude:a.longitude+(b.longitude-a.longitude)*x,latitude:a.latitude+(b.latitude-a.latitude)*x};
}
export function chargeSamples(r) {
  return (r.charge_details ?? []).flatMap((p,sourceIndex)=>{
    const sampleDate=date(p?.date);
    return sampleDate?[{...p,sourceIndex,t:sampleDate.getTime(),power:nonNegative(p.charger_details?.charger_power)}]:[];
  }).sort((a,b)=>a.t-b.t||a.sourceIndex-b.sourceIndex);
}
export function chargeSummary(r) {
  const added=nonNegative(r.charge_energy_added),used=nonNegative(r.charge_energy_used),points=chargeSamples(r);
  let powerSeconds=0,seconds=0;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],s=(b.t-a.t)/1000;if(s>0&&s<=120&&b.sourceIndex===a.sourceIndex+1&&a.power!==null&&b.power!==null){powerSeconds+=(a.power+b.power)/2*s;seconds+=s;}}
  const powers=points.map(p=>p.power).filter(p=>p!==null);
  return {added,used,efficiency:added>0&&used>=added?added/used*100:null,loss:added>0&&used>=added?used-added:null,peak:powers.length?powers.reduce((a,b)=>Math.max(a,b),-Infinity):null,average:seconds>0?powerSeconds/seconds:null,sampledSeconds:seconds,points};
}
export const DOORS=[['driverFront','左前门',['driver_front_door_open','front_left_door_open','left_front_door_open']],['passengerFront','右前门',['passenger_front_door_open','front_right_door_open','right_front_door_open']],['driverRear','左后门',['driver_rear_door_open','rear_left_door_open','left_rear_door_open']],['passengerRear','右后门',['passenger_rear_door_open','rear_right_door_open','right_rear_door_open']],['frunk','前备箱',['frunk_open','front_trunk_open']],['trunk','后备箱',['trunk_open','rear_trunk_open']],['chargePort','充电口',['charge_port_door_open','charge_port_open']]];
export function doorSignals(status) {
  return Object.fromEntries(DOORS.map(([id,,keys])=>{
    const pools=id==='chargePort'?[status?.charging_details,status?.car_status,status]:[status?.car_status,status];
    for(const pool of pools)for(const k of keys)if(typeof pool?.[k]==='boolean')return[id,pool[k]];
    return[id,null];
  }));
}
export function motionSpeed(s,units,received,now=Date.now()) {
  if(!s || !telemetryFreshness(s,received,now).fresh || s.state!=='driving' || s.driving_details?.shift_state==='P')return 0;
  const speed=positive(s.driving_details?.speed),unit=units?.unit_of_length;
  if(speed===null || !['km','mi'].includes(unit))return 0;
  return Math.min(8,speed*(unit==='mi'?.44704:1/3.6))*(s.driving_details?.shift_state==='R'?-1:1);
}
export function batteryHealth(h) {
  if(positive(h?.battery_health_percentage)!==null && h.battery_health_percentage<=100)return h.battery_health_percentage;
  if(positive(h?.current_capacity)!==null && positive(h?.max_capacity)!==null && h.current_capacity<=h.max_capacity)return h.current_capacity/h.max_capacity*100;
  if(positive(h?.current_range)!==null && positive(h?.max_range)!==null && h.current_range<=h.max_range)return h.current_range/h.max_range*100;
  return null;
}
export function periodRows(rows,days,now=new Date()) {
  if(!days)return rows;
  const start=new Date(now);start.setHours(0,0,0,0);start.setDate(start.getDate()-days+1);
  const end=new Date(now);end.setHours(24,0,0,0);
  return rows.filter(r=>date(r.start_date) && date(r.start_date)>=start && date(r.start_date)<end);
}
export function stats(drives,charges,unit) {
  unit=['km','mi'].includes(unit)?unit:'';
  const distance=drives.map(r=>nonNegative(r.odometer_details?.odometer_distance)),duration=drives.map(r=>nonNegative(r.duration_min)),energy=drives.map(r=>driveEfficiency(r,unit));
  const sum=a=>a.some(x=>x!==null)?a.reduce((s,x)=>s+(x??0),0):null;
  const speedRows=drives.filter(r=>nonNegative(r.odometer_details?.odometer_distance)!==null&&positive(r.duration_min)!==null);
  const speedTime=sum(speedRows.map(r=>r.duration_min));
  const added=charges.map(r=>nonNegative(r.charge_energy_added)),chargeMinutes=charges.map(r=>nonNegative(r.duration_min));
  const efficiency=aggregateEfficiency(drives,unit);
  return {distance:sum(distance),minutes:sum(duration),energy:sum(energy.map(e=>e.energy)),estimated:energy.some(e=>e.estimated),added:sum(added),chargeMinutes:sum(chargeMinutes),driveCount:drives.length,chargeCount:charges.length,averageSpeed:unit&&speedTime>0?sum(speedRows.map(r=>r.odometer_details.odometer_distance))/(speedTime/60):null,efficiency,missingDistance:distance.filter(x=>x===null).length,coverage:{distance:fieldCoverage(distance),minutes:fieldCoverage(duration),energy:fieldCoverage(energy.map(e=>e.energy)),consumption:efficiency.coverage,averageSpeed:fieldCoverage(drives.map(r=>unit&&nonNegative(r.odometer_details?.odometer_distance)!==null&&positive(r.duration_min)!==null?r.duration_min:null)),added:fieldCoverage(added),chargeMinutes:fieldCoverage(chargeMinutes)}};
}
export function effectiveCost(r,costs) {
  const local=costs?.[String(r.charge_id)];
  if(local&&nonNegative(local.amount)!==null&&/^[A-Z]{3}$/.test(local.currency))return {...local,source:local.source??'manual'};
  return positive(r.cost)!==null ? {amount:r.cost,currency:'未知币种',source:'server'} : null;
}
export function costSummary(charges,costs={}) {
  const values=charges.map(r=>({record:r,cost:effectiveCost(r,costs)})),coverage=fieldCoverage(values.map(v=>v.cost?.amount??null)),missingCount=coverage.total-coverage.valid,groups={};
  for(const {record,cost} of values){
    if(!cost)continue;
    const g=groups[cost.currency]??={actual:null,estimated:null,count:0,actualCount:0,estimatedCount:0,energy:0,pairedCost:0,pairedCount:0};
    const kind=cost.source==='estimate'?'estimated':'actual';
    g[kind]=(g[kind]??0)+cost.amount;g[kind+'Count']++;g.count++;
    const energy=positive(record.charge_energy_used)??positive(record.charge_energy_added);
    if(energy!==null){g.energy+=energy;g.pairedCost+=cost.amount;g.pairedCount++;}
  }
  for(const [currency,g] of Object.entries(groups)){
    // Costs with an unknown value cannot be assigned to any one currency yet.
    const total=g.count+missingCount;
    g.coverage={valid:g.count,total,partial:g.count<total};
    g.pairedCoverage={valid:g.pairedCount,total,partial:g.pairedCount<total};
    g.averagePrice=currency!=='未知币种'&&g.energy>0?g.pairedCost/g.energy:null;
  }
  return {groups,coverage,missingCount};
}
export function dailyCostSeries(charges,costs,currency,days=0,now=new Date()) {
  const rows=charges.filter(r=>{const cost=effectiveCost(r,costs);return !cost||cost.currency===currency;});
  return dailySeries(rows,r=>effectiveCost(r,costs)?.amount??null,days,now);
}
export function estimatePrice(record,rules) {
  const point=coordinate(record);if(!point)return {error:'此记录没有坐标。'};
  const candidates=rules.filter(r=>validCoordinate(r.latitude,r.longitude)&&haversine(point,[r.longitude,r.latitude])<=r.radius).sort((a,b)=>haversine(point,[a.longitude,a.latitude])-haversine(point,[b.longitude,b.latitude]));
  const rule=candidates[0];if(!rule)return{error:'没有匹配的电价地点。'};
  const start=date(record.start_date);if(!start)return{error:'缺少起充时间。'};
  let parts;try{parts=new Intl.DateTimeFormat('en-US',{timeZone:rule.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(start);}catch{return{error:'地点时区无效。'};}
  const part=k=>parts.find(p=>p.type===k)?.value,weekday=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(part('weekday')),minute=Number(part('hour'))*60+Number(part('minute'));
  const matching=(rule.periods??[]).filter(p=>{
    if(p.start<p.end)return p.days.includes(weekday)&&minute>=p.start&&minute<p.end;
    return (p.days.includes(weekday)&&minute>=p.start)||(p.days.includes((weekday+6)%7)&&minute<p.end);
  });
  if(matching.length>1)return{error:'分时电价时段重叠。'};
  const rate=matching.length?matching[0].rate:rule.rate,grid=positive(record.charge_energy_used),added=positive(record.charge_energy_added),energy=grid??added;
  if(energy===null)return{error:'缺少充电电量。'};
  if(nonNegative(rate)===null || !/^[A-Z]{3}$/.test(rule.currency))return{error:'电价或币种无效。'};
  return{amount:Math.round(energy*rate*100)/100,currency:rule.currency,source:'estimate',rule:rule.name,rate,basis:grid!==null?'电网用电量':'电池充入量',estimated:true};
}
export function validateRule(r) {
  if(!r.name?.trim()||!validCoordinate(r.latitude,r.longitude)||number(r.radius)===null||r.radius<20||r.radius>500||nonNegative(r.rate)===null||!/^[A-Z]{3}$/.test(r.currency))return'请填写有效的地点、坐标、20–500 米半径、电价和三位币种。';
  try{new Intl.DateTimeFormat('en-US',{timeZone:r.timezone});}catch{return'请输入有效的地点时区。';}
  const occupancy=new Set();
  for(const p of r.periods??[]){if(!Array.isArray(p.days)||!p.days.length||p.days.some(d=>!Number.isInteger(d)||d<0||d>6)||!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.start>=1440||p.end<0||p.end>1440||p.start===p.end||nonNegative(p.rate)===null)return'分时电价填写不完整。';
    for(const d of p.days){const length=p.end>p.start?p.end-p.start:1440-p.start+p.end;for(let m=0;m<length;m++){const k=(d*1440+p.start+m)%10080;if(occupancy.has(k))return'分时电价时段不能重叠。';occupancy.add(k);}}}
  return null;
}
export function csvCell(v) {let s=String(v??'');if(/^[=+@\-]/.test(s.trimStart())||/^[\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function exportCSV(drives,charges,units,journals={},costs={},options={}) {
  const head=['类型','ID','开始时间','结束时间','起点','终点','距离','距离单位','时长分钟','起始电量%','结束电量%','净能量kWh','充入量kWh','电网用电kWh','金额','币种','费用来源','分类','子分类','备注'];
  const d=drives.map(r=>{const j=journals[r.drive_id]??{},e=driveEfficiency(r,units.unit_of_length);return['行程',r.drive_id,r.start_date,r.end_date,r.start_address,r.end_address,r.odometer_details?.odometer_distance,units.unit_of_length,r.duration_min,r.battery_details?.start_battery_level,r.battery_details?.end_battery_level,e.estimated?'':e.energy,'','','','','',j.category,j.subcategory,j.note];});
  const c=charges.map(r=>{const cost=effectiveCost(r,costs);return['充电',r.charge_id,r.start_date,r.end_date,r.address,r.address,'',units.unit_of_length,r.duration_min,r.battery_details?.start_battery_level,r.battery_details?.end_battery_level,'',r.charge_energy_added,r.charge_energy_used,cost?.amount,cost?.currency,cost?.source,'','',''];});
  if(options.private)for(const row of [...d,...c]){row[4]='';row[5]='';row[18]='';row[19]='';}
  head.push('能量来源','司机','覆盖范围');
  for(let i=0;i<d.length;i++)d[i].push(driveEfficiency(drives[i],units.unit_of_length).energy===null?'未知':driveEfficiency(drives[i],units.unit_of_length).estimated?'充电记录标定估算（能量未导出）':number(drives[i].energy_consumed_net)!==null?'源净能量':'源能耗×距离',options.private?'':journals[drives[i].drive_id]?.driver??'',options.partial?'已载入部分历史':'已载入历史');
  for(const row of c)row.push('源充电记录','',options.partial?'已载入部分历史':'已载入历史');
  return '\uFEFF'+[head,...d,...c].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export const ACHIEVEMENTS=[['驾驶 1,000 km','distance',1000,'km'],['驾驶 10,000 km','distance',10000,'km'],['驾驶 50,000 km','distance',50000,'km'],['完成 10 次行程','drives',10,'次'],['完成 100 次行程','drives',100,'次'],['完成 500 次行程','drives',500,'次'],['完成 10 次充电','charges',10,'次'],['完成 100 次充电','charges',100,'次'],['完成 500 次充电','charges',500,'次'],['充入 1,000 kWh','added',1000,'kWh'],['单次行程 300 km','longest',300,'km']];
