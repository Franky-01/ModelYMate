// Formula adapted from my-tesla, Copyright (c) 2026 kinopico, MIT.
// Pinned reference: c1210ef0e65db22a745476f332af9300a10dbbb1.
// See public/licenses/my-tesla-MIT.txt. No fixed battery capacity/efficiency.
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const positive=v=>finite(v)&&v>0;
const time=v=>typeof v==='string'?Date.parse(v):NaN;
const round=(v,n=1)=>Math.round((v+Number.EPSILON)*10**n)/10**n;
const kmFactor=unit=>unit==='km'?1:unit==='mi'?1.609344:null;

// Same filters and ratio of sums as reference charge_efficiency (kWh/km).
export function chargeCalibration(charges,unit,{complete=false}={}) {
  const factor=kmFactor(unit);let energy=0,range=0,count=0;
  if(factor!==null)for(const r of charges){
    const start=r.range_rated?.start_range,end=r.range_rated?.end_range;
    if(!Number.isFinite(time(r.end_date))||!finite(r.charge_energy_added)||r.charge_energy_added<=1||!finite(start)||!finite(end)||(end-start)*factor<=1)continue;
    energy+=r.charge_energy_added;range+=(end-start)*factor;count++;
  }
  return {kwhPerKm:range>0?energy/range:null,count,total:charges.length,energyKwh:count?energy:null,rangeKm:count?range:null,complete,source:'recorded-charges'};
}

export function calibratedDriveEnergy(row,unit,calibration){
  const factor=kmFactor(unit),b=row.battery_details??{},start=row.range_rated?.start_range,end=row.range_rated?.end_range;
  if(factor===null||!positive(calibration?.kwhPerKm)||b.is_sufficiently_precise!==true||b.reduced_range===true||!finite(start)||!finite(end)||start<end||start<0||end<0)return null;
  return {kwh:(start-end)*factor*calibration.kwhPerKm,source:'charge-calibrated-rated-range',chargeCount:calibration.count,complete:calibration.complete};
}

// Keep only required health fields in the in-memory cache; no addresses or GPS.
export function healthSession(record,unit){
  const factor=kmFactor(unit);
  return {charge_id:record.charge_id,start_date:record.start_date,end_date:record.end_date,battery_details:{end_battery_level:record.battery_details?.end_battery_level},
    charge_details:factor===null?[]:(record.charge_details??[]).map(p=>({date:p.date,battery_level:p.battery_level,usable_battery_level:p.usable_battery_level,rated_km:finite(p.battery_info?.rated_battery_range)?p.battery_info.rated_battery_range*factor:null}))};
}

// Daily peak uses sum(rated)/sum(usable SOC), current uses the newest 100
// samples, ordered by session end then sample date. Retain repeated timestamps.
export function referenceBatteryHealth(sessions,calibration,{complete=false,totalSessions=sessions.length,missingSessions=0,timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone}={}){
  const days=new Map(),samples=[];let qualified=0,rejected=0;
  const calendar=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  for(const r of sessions){
    if(r.battery_details?.end_battery_level!==100||!Number.isFinite(time(r.end_date)))continue;
    const d=new Date(r.start_date);
    if(!Number.isFinite(d.getTime()))continue;
    const parts=Object.fromEntries(calendar.formatToParts(d).map(p=>[p.type,p.value])),day=`${parts.year}-${parts.month}-${parts.day}`;
    let valid=0;
    for(const [index,p] of (r.charge_details??[]).entries()){
      // coalesce means only absent usable SOC falls back; 0 is not missing.
      const level=p.usable_battery_level??p.battery_level,rated=p.rated_km;
      if(!positive(level)||level>100||!positive(rated)||!Number.isFinite(time(p.date))){rejected++;continue;}
      const bucket=days.get(day)??{rated:0,level:0,count:0};bucket.rated+=rated;bucket.level+=level;bucket.count++;days.set(day,bucket);
      samples.push({end:time(r.end_date),t:time(p.date),index,range:rated*100/level});valid++;
    }
    if(valid)qualified++;
  }
  const series=[...days].sort(([a],[b])=>a.localeCompare(b)).map(([day,v])=>({day,range_km:round(v.rated/v.level*100),samples:v.count}));
  samples.sort((a,b)=>b.end-a.end||b.t-a.t||b.index-a.index);
  const newest=samples.slice(0,100),current=newest.length?round(newest.reduce((s,p)=>s+p.range,0)/newest.length):null;
  const peak=series.length?Math.max(...series.map(p=>p.range_km)):null,coefficient=calibration?.kwhPerKm;
  const percentage=current!==null&&peak>0?Math.min(100,round(current/peak*100)):null;
  return {method:'my-tesla-full-charge-v1',battery_health_percentage:percentage,current_range:current,max_range:peak,
    current_capacity:current!==null&&positive(coefficient)?round(current*coefficient):null,max_capacity:peak!==null&&positive(coefficient)?round(peak*coefficient):null,
    series,timeZone,sampleCount:samples.length,currentSampleCount:newest.length,sampleDays:series.length,sessionCount:qualified,totalSessions,missingSessions,rejectedSamples:rejected,complete:complete&&missingSessions===0,calibration};
}

/** @param {any[]} charges @param {string} unit @param {(id:number, signal?:AbortSignal)=>Promise<any>} fetchDetail @param {{signal?:AbortSignal,cache?:Map<string,any>,complete?:boolean,concurrency?:number}} options */
export async function loadReferenceHealth(charges,unit,fetchDetail,{signal,cache=new Map(),complete=false,concurrency=1}={}){
  const eligible=charges.filter(r=>r.battery_details?.end_battery_level===100&&Number.isFinite(time(r.end_date)));
  let cursor=0,failed=false,failureKind=null;
  const sessions=[];
  async function worker(){while(cursor<eligible.length&&!signal?.aborted&&!failed){
    const r=eligible[cursor++],key=String(r.charge_id)+'.'+r.end_date;
    try{
      let session=cache.get(key);
      if(!session){const payload=await fetchDetail(r.charge_id,signal);if(signal?.aborted)break;if(!payload?.charge||!Array.isArray(payload.charge.charge_details))throw Error('充电采样不完整');
        session=healthSession(payload.charge,payload.units?.unit_of_length);cache.set(key,session);}
      sessions.push(session);
    }catch(e){if(signal?.aborted)break;failed=true;failureKind=['timeout','interrupted','network','http','data','service'].includes(e?.kind)?e.kind:'data';}
  }}
  await Promise.all(Array.from({length:Math.min(eligible.length,Math.max(1,concurrency))},worker));
  if(signal?.aborted)throw Object.assign(new Error('已取消健康数据读取'),{name:'AbortError'});
  return {...referenceBatteryHealth(sessions,chargeCalibration(charges,unit,{complete}),{complete,totalSessions:eligible.length,missingSessions:eligible.length-sessions.length}),failureKind};
}
