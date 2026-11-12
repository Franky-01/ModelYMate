import {memo,useId,useMemo,useState} from 'react';
import {fmt,number} from './core.mjs';
import {chartSegments,nearestChartIndex,interpolatedChart} from './data-quality.mjs';
type Point={x:number;y:number|null;sourceIndex?:number;stopped?:boolean};
function Chart({points,label,unit='',color='#68d5b0',onSelect,gapMs,interpolate=false,maxInterpolationGapMs=30000}:{points:Point[];label:string;unit?:string;color?:string;onSelect?:(index:number)=>void;gapMs?:number;interpolate?:boolean;maxInterpolationGapMs?:number}){
 const id=useId().replaceAll(':',''),[selected,setSelected]=useState<number|null>(null);
 const data=useMemo(()=>{
  const clean=points.filter(p=>number(p.x)!==null&&number(p.y)!==null);if(!clean.length)return null;
  let minX=Infinity,maxX=-Infinity,minY=0,maxY=-Infinity;for(const p of points){if(Number.isFinite(p.x)){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);}}for(const p of clean){minY=Math.min(minY,p.y!);maxY=Math.max(maxY,p.y!);}
  const x=(v:number)=>36+(v-minX)/Math.max(1,maxX-minX)*548,y=(v:number)=>148-(v-minY)/Math.max(1,maxY-minY)*126;
  const plan=interpolate?interpolatedChart(points,{maxInterpolationGapMs}):null;
  const segments=plan?.segments??chartSegments(points,250,gapMs);
  const path=segments.map((run:Point[])=>run.map((p,i)=>(i?'L':'M')+x(p.x).toFixed(2)+','+y(p.y!).toFixed(2)).join(' ')).join(' ');
  return{clean,minX,maxX,minY,maxY,x,y,path,plan,isolated:segments.filter((r:Point[])=>r.length===1).map((r:Point[])=>r[0])};
 },[points,gapMs,interpolate,maxInterpolationGapMs]);
 if(!data)return <div className="chart-empty">暂无{label}采样</div>;
 const selectedPoint=selected===null||!Number.isFinite(points[selected]?.x)?null:points[selected],axis=(x:number)=>data.maxX-data.minX>=86400000?new Date(x).toLocaleDateString('zh-CN',{year:'2-digit',month:'numeric',day:'numeric'}):new Date(x).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
 return <div className="chart" role="group" aria-label={label+'图表'}><div className="chart-label"><span>{label}</span><strong>{selectedPoint?fmt(selectedPoint.y):fmt(data.maxY)} <small>{unit}</small></strong></div><svg viewBox="0 0 600 180" aria-label={label} onPointerDown={e=>{const b=e.currentTarget.getBoundingClientRect(),target=data.minX+Math.max(0,Math.min(1,((e.clientX-b.left)/b.width*600-36)/548))*(data.maxX-data.minX);const i=nearestChartIndex(points,target);if(i===null)return;setSelected(i);onSelect?.(i);}}>
 <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".25"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs>
 {[0,.5,1].map(v=><g key={v}><line x1="36" x2="584" y1={22+v*126} y2={22+v*126} stroke="currentColor" opacity=".09"/><text x="2" y={26+v*126} fill="currentColor" opacity=".4" fontSize="10">{fmt(data.maxY-v*(data.maxY-data.minY),0)}</text></g>)}
 {data.path.split('M').filter(Boolean).map((p,i)=>{const coords=p.trim().split(/[L, ]+/).map(Number);return <path key={'f'+i} d={'M'+p+`L${coords[coords.length-2]},148 L${coords[0]},148 Z`} fill={`url(#${id})`}/>;})}
 <path d={data.path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
 {data.plan?.bridges.map((bridge:Point[],i:number)=><path key={'estimate'+i} data-estimated="true" d={bridge.map((p,j)=>(j?'L':'M')+data.x(p.x)+','+data.y(p.y!)).join(' ')} fill="none" stroke={color} strokeOpacity=".65" strokeWidth="2" strokeDasharray="6 5"/>)}
 {data.isolated.map((p:Point,i:number)=><circle key={i} cx={data.x(p.x)} cy={data.y(p.y!)} r="3" fill={color}/>)}
 {selectedPoint&&number(selectedPoint.y)!==null&&<g><line x1={data.x(selectedPoint.x)} x2={data.x(selectedPoint.x)} y1="20" y2="148" stroke={color} strokeDasharray="3 5"/><circle cx={data.x(selectedPoint.x)} cy={data.y(selectedPoint.y!)} r="4" fill={color}/></g>}
 <text x="36" y="174" fill="currentColor" opacity=".4" fontSize="10">{axis(data.minX)}</text><text x="584" y="174" textAnchor="end" fill="currentColor" opacity=".4" fontSize="10">{axis(data.maxX)}</text>
 </svg>{interpolate&&<p className="chart-estimate-note"><span>实线 · 记录</span><span>┄ 虚线 · 估算</span>{data.plan?.longGaps?' · 长空档保留缺口':''}</p>}{onSelect&&<div className="chart-picker"><label htmlFor={id+'-select'}>{data.maxX-data.minX>=86400000?'选择日期':'选择时间'}<strong>{selectedPoint?axis(selectedPoint.x):'拖动下方滑块'}</strong></label><input id={id+'-select'} className="chart-keyboard" aria-label={label+'采样选择'} aria-valuetext={selectedPoint?axis(selectedPoint.x)+'，'+fmt(selectedPoint.y)+' '+unit:'尚未选择'} type="range" min="0" max={Math.max(0,points.length-1)} value={Math.min(selected??0,points.length-1)} onChange={e=>{const i=Number(e.target.value);setSelected(i);onSelect(i);}}/><div className="chart-picker-ends"><span>{axis(data.minX)}</span><span>{axis(data.maxX)}</span></div><p>拖动滑块或点按曲线查看{data.maxX-data.minX>=86400000?'当天记录':'对应采样'}{selectedPoint?.y===null?' · 此处数据不足':''}</p></div>}</div>;
}
export default memo(Chart);
