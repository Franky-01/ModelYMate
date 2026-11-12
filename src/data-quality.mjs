// Observation time is never a substitute for a vehicle sample timestamp.
export function telemetryFreshness(status, received, now=Date.now()) {
  const candidates=[status?.driving_details?.date,status?.car_geodata?.date,status?.date,status?.timestamp];
  let source=null;
  for(const value of candidates){
    const t=typeof value==='string'&&/(Z|[+-]\d{2}:?\d{2})$/i.test(value)?Date.parse(value):typeof value==='number'&&Number.isFinite(value)?(value<1e12?value*1000:value):NaN;
    if(Number.isFinite(t)&&t>0){source=t;break;}
  }
  const reason=typeof received!=='number'||!Number.isFinite(received)||received<=0?'unread':!Number.isFinite(now)||now<received||source!==null&&source>now+5000?'clock':now-received>30000?'disconnected':source===null?'unknown':now-source>30000?'stale':'fresh';
  return {source,received,fresh:reason==='fresh',reason,label:({unread:'尚未读取',clock:'时间待核对',disconnected:'等待连接',unknown:'源时间未知',stale:'历史车况',fresh:'车况已更新'})[reason]};
}

export function fieldCoverage(values){
  const valid=values.filter(x=>typeof x==='number'&&Number.isFinite(x)).length;
  return {valid,total:values.length,partial:valid<values.length};
}
export function coverageText(c){return !c||!c.total?'暂无记录':`${c.partial?'部分数据 · ':''}${c.valid}/${c.total} 条有效`;}

// Split before simplifying. Endpoints and bucket extrema survive; raw input stays intact.
export function chartSegments(points,budget=250,maxGap){
  const intervals=[];
  for(let i=1;i<points.length;i++){const dt=points[i].x-points[i-1].x;if(dt>0&&Number.isFinite(dt))intervals.push(dt);}
  intervals.sort((a,b)=>a-b);
  const threshold=maxGap??Math.min(120000,Math.max(30000,(intervals[Math.floor(intervals.length/2)]??0)*3));
  const runs=[];let run=[],previous=null;
  for(let i=0;i<points.length;i++){
    const p=points[i],valid=Number.isFinite(p.x)&&typeof p.y==='number'&&Number.isFinite(p.y);
    const gap=previous&&(p.x-previous.x>threshold||p.x<previous.x||Number.isInteger(p.sourceIndex)&&Number.isInteger(previous.sourceIndex)&&p.sourceIndex!==previous.sourceIndex+1);
    if(!valid||gap){if(run.length)runs.push(run);run=[];}
    if(valid)run.push(i);previous=valid?p:null;
  }
  if(run.length)runs.push(run);
  const stride=Math.max(1,Math.ceil(points.length/Math.max(1,budget/2)));
  return runs.map(r=>{
    if(r.length<=4||stride===1)return r.map(index=>({...points[index],index}));
    const keep=new Set([r[0],r.at(-1)]);
    for(let i=1;i<r.length-1;i+=stride){let low=r[i],high=r[i];for(let j=i;j<Math.min(r.length-1,i+stride);j++){if(points[r[j]].y<points[low].y)low=r[j];if(points[r[j]].y>points[high].y)high=r[j];}keep.add(low);keep.add(high);}
    return [...keep].sort((a,b)=>a-b).map(index=>({...points[index],index}));
  });
}

// Null y still names a selectable date; invalid timestamps never win a hit test.
export function nearestChartIndex(points,target){
  if(!Number.isFinite(target))return null;
  let nearest=null,distance=Infinity;
  for(let i=0;i<points.length;i++){
    if(!Number.isFinite(points[i].x))continue;
    const next=Math.abs(points[i].x-target);
    if(next<distance){nearest=i;distance=next;}
  }
  return nearest;
}

// SVG straight segments are linear interpolation, never synthetic measurements.
// Only short, bounded gaps can be joined; long/parked gaps remain blank.
export function interpolatedChart(points,{budget=250,maxInterpolationGapMs=30000}={}){
  const intervals=[];
  for(let i=1;i<points.length;i++){const dt=points[i].x-points[i-1].x;if(dt>0&&dt<=30000)intervals.push(dt);}
  intervals.sort((a,b)=>a-b);
  const usual=intervals[Math.floor((intervals.length-1)/2)]??1000,recordedLimit=Math.min(30000,Math.max(5000,usual*3));
  const runs=[],bridges=[];let run=[],previous=null,missing=false,longGaps=0;
  for(let i=0;i<points.length;i++){
    const p=points[i];
    if(!Number.isFinite(p.x)||typeof p.y!=='number'||!Number.isFinite(p.y)){missing=true;if(run.length)runs.push(run);run=[];continue;}
    const point={...p,index:i},dt=previous?point.x-previous.x:0;
    const parkedGap=!!previous&&dt>5000&&p.stopped===true&&previous.stopped===true;
    const gap=!!previous&&(missing||dt>recordedLimit||p.breakBefore===true||parkedGap);
    if(gap){
      if(run.length)runs.push(run);run=[];
      if(dt>0&&dt<=maxInterpolationGapMs&&p.breakBefore!==true&&!parkedGap&&!(dt>recordedLimit&&(p.stopped||previous.stopped)))bridges.push([previous,point]);else longGaps++;
    }
    if(previous&&dt<0){if(run.length)runs.push(run);run=[];longGaps++;}
    run.push(point);previous=point;missing=false;
  }
  if(run.length)runs.push(run);
  const stride=Math.max(1,Math.ceil(points.length/Math.max(1,budget/2)));
  return {segments:runs.map(r=>{
    if(r.length<=4||stride===1)return r;
    const keep=new Set([0,r.length-1]);
    for(let i=1;i<r.length-1;i+=stride){let lo=i,hi=i;for(let j=i;j<Math.min(r.length-1,i+stride);j++){if(r[j].y<r[lo].y)lo=j;if(r[j].y>r[hi].y)hi=j;}keep.add(lo);keep.add(hi);}
    return [...keep].sort((a,b)=>a-b).map(i=>r[i]);
  }),bridges,longGaps,recordedLimit,maxInterpolationGapMs};
}

export function dailySeries(rows,metric,days=0,now=new Date()){
  const end=new Date(now);end.setHours(0,0,0,0);
  if(!Number.isFinite(end.getTime()))return [];
  const dated=rows.flatMap(r=>{
    const timestamp=typeof r.start_date==='string'?Date.parse(r.start_date):NaN;
    return Number.isFinite(timestamp)?[{record:r,date:new Date(timestamp)}]:[];
  });
  let start=new Date(end);
  if(Number.isInteger(days)&&days>0)start.setDate(start.getDate()-days+1);
  else for(const row of dated){const d=new Date(row.date);d.setHours(0,0,0,0);if(d<start)start=d;}
  const key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const grouped=new Map();
  for(const {record:r,date:d} of dated){const k=key(d),a=grouped.get(k)??[];a.push(typeof metric==='function'?metric(r):metric==='distance'?r.odometer_details?.odometer_distance:r.charge_energy_added);grouped.set(k,a);}
  const result=[];
  for(const d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    const values=grouped.get(key(d))??[],valid=values.filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0);
    result.push({x:d.getTime(),key:key(d),y:valid.length&&valid.length===values.length?valid.reduce((a,b)=>a+b,0):null,valid:valid.length,total:values.length});
  }
  return result;
}
