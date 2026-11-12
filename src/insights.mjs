import {date,localDay,nonNegative,percent,effectiveCost,driveEfficiency} from './core.mjs';

export function placeName(original,aliases={},fallback=original){
  const value=Object.hasOwn(aliases,original??'')?aliases[original]:null;
  return typeof value==='string'&&value.trim()?value.trim():fallback??'';
}

export function filterRecords(drives,charges,journals={},costs={},aliases={},filters={}){
  return [...drives.map(r=>({...r,kind:'drive'})),...charges.map(r=>({...r,kind:'charge'}))].filter(r=>{
    const d=date(r.start_date),j=journals[r.drive_id]??{},cost=r.kind==='charge'?effectiveCost(r,costs):null;
    const text=[r.start_address,r.end_address,r.address,j.note,j.category,j.subcategory,j.driver,...[r.start_address,r.end_address,r.address].map(a=>placeName(a,aliases))].join(' ').toLowerCase();
    if(filters.kind&&filters.kind!=='all'&&r.kind!==filters.kind)return false;
    if(filters.search&&!text.includes(filters.search.toLowerCase()))return false;
    if(filters.start&&(!d||localDay(d)<filters.start)||filters.end&&(!d||localDay(d)>filters.end))return false;
    if(filters.driver&&(r.kind!=='drive'||(j.driver??'')!==filters.driver))return false;
    if(filters.category&&(r.kind!=='drive'||(j.category??'未分类')!==filters.category))return false;
    for(const [key,value] of [['distance',r.kind==='drive'?nonNegative(r.odometer_details?.odometer_distance):null],['minutes',nonNegative(r.duration_min)]]){
      const min=filters[key+'Min'],max=filters[key+'Max'];
      if(min!==undefined&&min!==''&&(value===null||value<Number(min)))return false;
      if(max!==undefined&&max!==''&&(value===null||value>Number(max)))return false;
    }
    if(filters.cost&&filters.cost!=='all'&&(r.kind!=='charge'||(filters.cost==='missing'?!!cost:cost?.source!==filters.cost)))return false;
    if(filters.charger&&filters.charger!=='all'&&(r.kind!=='charge'||chargeType(r)!==filters.charger))return false;
    return true;
  }).sort((a,b)=>{
    const value=r=>filters.sort==='distance'?nonNegative(r.odometer_details?.odometer_distance):filters.sort==='duration'?nonNegative(r.duration_min):filters.sort==='energy'?nonNegative(r.charge_energy_added):(date(r.start_date)?.getTime()??null);
    const x=value(a),y=value(b);
    if(x===null)return y===null?0:1;if(y===null)return -1;
    return filters.sort==='oldest'?x-y:y-x;
  });
}

export function chargeType(row){
  const value=row.fast_charger_info?.fast_charger_present;
  return value===true?'fast':value===false?'regular':'unknown';
}

// List fields only: no inferred charger type from peak power and no extra reads.
export function chargeDistributions(charges){
  const definitions=[
    {label:'起充电量',value:r=>percent(r.battery_details?.start_battery_level),bands:[['0–20%',0,20],['20–50%',20,50],['50–80%',50,80],['80–100%',80,101]]},
    {label:'充电时长',value:r=>nonNegative(r.duration_min),bands:[['<30 分',0,30],['30–60 分',30,60],['≥60 分',60,Infinity]]},
    {label:'起充时段（当前设备时区）',value:r=>date(r.start_date)?.getHours()??null,bands:[['0–6 时',0,6],['6–12 时',6,12],['12–18 时',12,18],['18–24 时',18,24]]}
  ];
  return definitions.map(({label,value,bands})=>{
    const counts=bands.map(([label,min,max])=>({label,min,max,count:0}));let valid=0;
    for(const row of charges){const v=value(row);if(v===null)continue;const band=counts.find(b=>v>=b.min&&v<b.max);if(band){valid++;band.count++;}}
    return {label,bands:counts,valid,total:charges.length};
  });
}

// A parking estimate requires two adjacent recorded drives with matching places.
// Unknown edges, overlaps, missing end times and different places never become parking.
export function parkingEstimates(drives,aliases={}){
  const sorted=drives.filter(r=>date(r.start_date)).slice().sort((a,b)=>Date.parse(a.start_date)-Date.parse(b.start_date));
  const result=[];
  for(let i=1;i<sorted.length;i++){
    const previous=sorted[i-1],next=sorted[i],end=date(previous.end_date),start=date(next.start_date);
    const endPlace=placeName(previous.end_address,aliases),startPlace=placeName(next.start_address,aliases);
    if(!end||!start||!endPlace||endPlace!==startPlace||end>start||end<date(previous.start_date))continue;
    const minutes=(start-end)/60000;
    if(minutes>0)result.push({place:endPlace,minutes,start:end.toISOString(),end:start.toISOString(),before:previous.drive_id,after:next.drive_id,estimated:true});
  }
  return result;
}

export function groupedPlaces(drives,charges,aliases={}){
  const result=new Map();
  function group(original){const name=placeName(original,aliases)||'地点待定位';if(!result.has(name))result.set(name,{name,originals:new Set(),drives:[],charges:[],parking:[],added:null,addedCount:0});const g=result.get(name);if(original)g.originals.add(original);return g;}
  for(const r of drives){const seen=new Set();for(const original of [r.start_address,r.end_address]){if(!original)continue;const g=group(original);if(!seen.has(g.name)){g.drives.push(r);seen.add(g.name);}}}
  for(const r of charges){const g=group(r.address);g.charges.push(r);const energy=nonNegative(r.charge_energy_added);if(energy!==null){g.added=(g.added??0)+energy;g.addedCount++;}}
  for(const p of parkingEstimates(drives,aliases)){const g=result.get(p.place);if(g)g.parking.push(p);}
  return [...result.values()].map(g=>({...g,originals:[...g.originals],parkingMinutes:g.parking.length?g.parking.reduce((s,p)=>s+p.minutes,0):null})).sort((a,b)=>b.drives.length+b.charges.length-a.drives.length-a.charges.length);
}

export function driveDistribution(drives,units){
  const bands=[{label:'短途 <10 km',min:0,max:10,count:0},{label:'中途 10–50 km',min:10,max:50,count:0},{label:'长途 ≥50 km',min:50,max:Infinity,count:0}];
  let valid=0,energyValid=0;
  for(const r of drives){const d=nonNegative(r.odometer_details?.odometer_distance);if(d!==null&&['km','mi'].includes(units)){valid++;const km=d*(units==='mi'?1.609344:1);bands.find(b=>km>=b.min&&km<b.max).count++;}if(driveEfficiency(r,units).consumption!==null)energyValid++;}
  return {bands,valid,total:drives.length,energyValid};
}
