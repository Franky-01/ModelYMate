import {date,localDay,nonNegative,percent,effectiveCost,driveEfficiency} from './core.mjs';

export function placeName(original,aliases={},fallback=original){
  const value=Object.hasOwn(aliases,original??'')?aliases[original]:null;
  return typeof value==='string'&&value.trim()?value.trim():fallback??'';
}

export function filterRecords(drives,charges,journals={},costs={},aliases={},filters={}){
  const bound=value=>value===undefined||value===''?undefined:Number(value);
  const distanceMin=bound(filters.distanceMin),distanceMax=bound(filters.distanceMax);
  const minutesMin=bound(filters.minutesMin),minutesMax=bound(filters.minutesMax);
  const hasDistance=distanceMin!==undefined||distanceMax!==undefined;
  const hasMinutes=minutesMin!==undefined||minutesMax!==undefined;
  const outOfRange=(value,min,max)=>value===null||(min!==undefined&&value<min)||(max!==undefined&&value>max);
  const hasDates=!!(filters.start||filters.end),search=filters.search?.toLowerCase();
  const costFilter=filters.cost&&filters.cost!=='all',chargerFilter=filters.charger&&filters.charger!=='all';
  const byDate=!['distance','duration','energy'].includes(filters.sort);
  const matches=[];
  for(const [kind,records] of [['drive',drives],['charge',charges]]){
    if(filters.kind&&filters.kind!=='all'&&filters.kind!==kind)continue;
    if(kind==='drive'&&(costFilter||chargerFilter))continue;
    if(kind==='charge'&&(hasDistance||filters.driver||filters.category))continue;
    for(const row of records){
      if(hasDistance&&outOfRange(nonNegative(row.odometer_details?.odometer_distance),distanceMin,distanceMax))continue;
      if(hasMinutes&&outOfRange(nonNegative(row.duration_min),minutesMin,minutesMax))continue;
      if(chargerFilter&&chargeType(row)!==filters.charger)continue;
      if(costFilter){
        const cost=effectiveCost(row,costs);
        if(filters.cost==='missing'?!!cost:cost?.source!==filters.cost)continue;
      }
      if(search||filters.driver||filters.category){
        const journal=journals[row.drive_id]??{};
        if(filters.driver&&(journal.driver??'')!==filters.driver)continue;
        if(filters.category&&(journal.category??'未分类')!==filters.category)continue;
        if(search){
          const addresses=[row.start_address,row.end_address,row.address];
          const text=[...addresses,journal.note,journal.category,journal.subcategory,journal.driver,...addresses.map(a=>placeName(a,aliases))];
          if(!text.join(' ').toLowerCase().includes(search))continue;
        }
      }
      const start=byDate||hasDates?date(row.start_date):null;
      if(hasDates){
        if(!start)continue;
        const day=localDay(start);
        if(filters.start&&day<filters.start||filters.end&&day>filters.end)continue;
      }
      const sortValue=byDate?start?.getTime()??null:filters.sort==='distance'?nonNegative(row.odometer_details?.odometer_distance):
        filters.sort==='duration'?nonNegative(row.duration_min):nonNegative(row.charge_energy_added);
      matches.push({row,kind,sortValue});
    }
  }
  matches.sort(({sortValue:a},{sortValue:b})=>{
    if(a===null)return b===null?0:1;
    if(b===null)return -1;
    return filters.sort==='oldest'?a-b:b-a;
  });
  return matches.map(({row,kind})=>({...row,kind}));
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
  const sorted=[];
  for(const row of drives){
    const start=date(row.start_date);
    if(start)sorted.push({row,start});
  }
  sorted.sort((a,b)=>a.start.getTime()-b.start.getTime());
  const result=[];
  for(let i=1;i<sorted.length;i++){
    const {row:previous,start:previousStart}=sorted[i-1],{row:next,start}=sorted[i],end=date(previous.end_date);
    const endPlace=placeName(previous.end_address,aliases),startPlace=placeName(next.start_address,aliases);
    if(!end||!endPlace||endPlace!==startPlace||end>start||end<previousStart)continue;
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
