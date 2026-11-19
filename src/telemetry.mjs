// Pure derived views; original samples, order, duplicate times and GPS stay intact.
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const median=values=>{const a=values.slice().sort((x,y)=>x-y),n=a.length;return n?(a[Math.floor(n/2)]+a[Math.floor((n-1)/2)])/2:null;};
const distance=(a,b)=>{const r=Math.PI/180,dlat=(b.latitude-a.latitude)*r,dlng=(b.longitude-a.longitude)*r,h=Math.sin(dlat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dlng/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));};

export function telemetrySamples(record){
  return (record.drive_details??[]).flatMap((p,sourceIndex)=>{
    const t=typeof p.date==='string'?Date.parse(p.date):NaN;
    return Number.isFinite(t)?[{...p,sourceIndex,t,speed:finite(p.speed)&&p.speed>=0?p.speed:null,power:finite(p.power)?p.power:null,elevation:finite(p.elevation)?p.elevation:null,inside:finite(p.climate_info?.inside_temp)?p.climate_info.inside_temp:null,outside:finite(p.climate_info?.outside_temp)?p.climate_info.outside_temp:null}]:[];
  }).sort((a,b)=>a.t-b.t||a.sourceIndex-b.sourceIndex);
}

export function analyzeDriving(points,unit,{accelerationThreshold=2.5,brakingThreshold=3,maxIntervalSeconds=3,mergeMs=3000,durationMs=0}={}){
  const factor=unit==='km'?1/3.6:unit==='mi'?0.44704:null,groups=[];let same=0,missing=0;
  for(const p of points){if(!finite(p.t))continue;const last=groups.at(-1);if(last?.t===p.t){last.speeds.push(p.speed);same++;}else groups.push({t:p.t,speeds:[p.speed]});}
  const series=groups.map(g=>{const speeds=g.speeds.filter(s=>finite(s)&&s>=0);return {t:g.t,speed:speeds.length?median(speeds):null};});
  // Reject only an isolated, large speed spike with agreeing neighbours.
  for(let i=1;i<series.length-1;i++){
    const a=series[i-1],b=series[i],c=series[i+1];
    if(factor!==null&&[a.speed,b.speed,c.speed].every(finite)&&b.t-a.t<=3000&&c.t-b.t<=3000&&Math.abs(c.speed-a.speed)*factor<1.5&&Math.abs(b.speed-(a.speed+c.speed)/2)*factor>8){b.speed=null;missing++;}
  }
  const events=[];let valid=0,gaps=0,observedMs=0,possibleMs=0,invalid=0;const intervals=[];
  for(let i=1;i<series.length;i++){
    const a=series[i-1],b=series[i],dt=(b.t-a.t)/1000;
    if(dt>0)possibleMs+=dt*1000;
    if(factor===null||!finite(a.speed)||!finite(b.speed)||dt<=0||dt>maxIntervalSeconds){if(dt>maxIntervalSeconds)gaps++;continue;}
    const acc=(b.speed-a.speed)*factor/dt;
    if(Math.abs(acc)>12){invalid++;continue;}
    valid++;observedMs+=dt*1000;intervals.push(dt);
    const kind=acc>=accelerationThreshold?'accel':acc<=-brakingThreshold?'brake':null;
    if(kind){const last=events.at(-1);if(last?.kind===kind&&a.t-last.end<=mergeMs){last.end=b.t;last.peak=Math.max(last.peak,Math.abs(acc));}else events.push({kind,start:a.t,end:b.t,peak:Math.abs(acc)});}
  }
  possibleMs=Math.max(possibleMs,finite(durationMs)&&durationMs>0?durationMs:0);
  const coverage=possibleMs>0?observedMs/possibleMs:0,sufficient=valid>=2&&coverage>=0.6;
  const accel=sufficient?events.filter(e=>e.kind==='accel').length:null,brake=sufficient?events.filter(e=>e.kind==='brake').length:null;
  return {valid,same,gaps,missing,invalid,coverage,observedMs,possibleMs,medianInterval:median(intervals),accel,brake,events:sufficient?events:[],accelerationThreshold,brakingThreshold,maxIntervalSeconds,rating:!sufficient?'数据不足':accel+brake===0?'未检出急加减速':accel+brake<=2?'平稳驾驶':accel+brake<=5?'注意平顺':'建议改善'};
}

// A GPS spike is hidden only when BOTH legs imply >70m/s, the neighbours
// reconnect plausibly, and the excursion exceeds 200m. No road snapping.
export function inspectDriveRoute(samples,rawCount=samples.length){
  const visible=[];
  let reversed=0,duplicates=0,isolatedSpikes=0,jumpBreaks=0,omitted=false,nextDistance=0;
  for(let i=0;i<samples.length;i++){
    const previous=samples[i-1],current=samples[i],next=samples[i+1];
    const previousDistance=nextDistance;
    nextDistance=next?distance(current,next):0;
    if(previous){
      if(current.sourceIndex<previous.sourceIndex)reversed++;
      if(current.t===previous.t)duplicates++;
    }
    // Use original neighbours for spike detection, even if the preceding
    // sample was omitted. Most GPS steps need only the one adjacent distance.
    if(previous&&next&&previousDistance>200&&nextDistance>200){
      const ab=(current.t-previous.t)/1000,bc=(next.t-current.t)/1000,ac=(next.t-previous.t)/1000;
      if(ab>=0&&bc>=0&&ac>0&&ac<=120&&previousDistance/Math.max(1,ab)>70&&nextDistance/Math.max(1,bc)>70){
        const direct=distance(previous,next);
        if(direct/ac<=55&&direct<Math.min(previousDistance,nextDistance)/3){isolatedSpikes++;omitted=true;continue;}
      }
    }
    const row={...current,routeBreakBefore:current.routeBreakBefore||omitted},last=visible.at(-1);
    if(last){
      const metres=omitted?distance(last,row):previousDistance,dt=(row.t-last.t)/1000;
      if(metres>200&&dt>=0&&metres/Math.max(1,dt)>70){row.routeBreakBefore=true;row.gpsJumpBefore=true;jumpBreaks++;}
    }
    visible.push(row);omitted=false;
  }
  return {samples:visible,invalid:Math.max(0,rawCount-samples.length),sameTime:duplicates,reordered:reversed,isolatedSpikes,jumpBreaks};
}
