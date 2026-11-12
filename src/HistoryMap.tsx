import {useEffect,useMemo,useState} from 'react';
import type {Config,J} from './api';
import MapView from './Map';
import {useDriveDetails,type DetailAPI} from './drive-loader';
import {date,localDay} from './core.mjs';
import {buildRoadFrequency,chargeMapPoints} from './history-map.mjs';

export default function HistoryMap({api,config,carID,drives,charges,units={},hideAddress=false}:{api:DetailAPI;config:Config;carID:number;drives:J[];charges:J[];units?:J;hideAddress?:boolean}){
 const [view,setView]=useState('day'),[selected,setSelected]=useState(localDay(new Date())),[color,setColor]=useState('standard'),[limit,setLimit]=useState(100),[roadFrequency,setRoadFrequency]=useState(false),[selectedCharge,setSelectedCharge]=useState<number|null>(null),[chargeLimit,setChargeLimit]=useState(30);
 const rows=useMemo(()=>view==='day'?drives.filter(r=>date(r.start_date)&&localDay(date(r.start_date))===selected):drives,[view,selected,drives]);
 const ids=useMemo(()=>view==='charges'?[]:rows.slice(0,limit).map(r=>r.drive_id),[view,rows,limit]),loader=useDriveDetails(api,carID,ids);
 const paths=useMemo(()=>loader.drives.map(d=>d.samples.map((p:any)=>[p.longitude,p.latitude])),[loader.drives]),samples=useMemo(()=>loader.drives.map(d=>d.samples),[loader.drives]);
 const speeds=useMemo(()=>samples.flatMap(p=>p.map((v:any)=>v.speed===null?null:v.speed*(units.unit_of_length==='mi'?1.609344:1))),[samples,units.unit_of_length]),elevations=useMemo(()=>samples.flatMap(p=>p.map((v:any)=>v.elevation)),[samples]);
 const relevantCharges=useMemo(()=>view==='day'?charges.filter(r=>date(r.start_date)&&localDay(date(r.start_date))===selected):charges,[charges,view,selected]);
 const markers=useMemo(()=>chargeMapPoints(relevantCharges,{hideAddress}),[relevantCharges,hideAddress]);
 const frequency=useMemo(()=>roadFrequency&&view==='history'?buildRoadFrequency(loader.drives,{maxCells:1500}):null,[roadFrequency,view,loader.drives]);
 const noPaths=useMemo(()=>[],[]);
 useEffect(()=>{setLimit(100);setSelectedCharge(null);setChargeLimit(30);},[view,selected]);
 const charge=relevantCharges.find(r=>r.charge_id===selectedCharge);
 return <section className="history-map" aria-label="历史地图"><div className="map-toolbar"><div className="segmented">{[['day','一天'],['history','历史足迹'],['charges','充电地图']].map(([v,label])=><button key={v} className={view===v?'selected':''} onClick={()=>setView(v)}>{label}</button>)}</div>{view==='day'&&<input aria-label="地图日期" type="date" value={selected} onChange={e=>setSelected(e.target.value)}/>}</div>
  {view!=='charges'&&<div className="map-toolbar"><div className="segmented">{[['standard','路线'],['speed','速度'],['elevation','海拔']].map(([v,label])=><button key={v} className={color===v?'selected':''} onClick={()=>setColor(v)}>{label}</button>)}</div>{view==='history'&&<label className="map-check"><input type="checkbox" checked={roadFrequency} onChange={e=>setRoadFrequency(e.target.checked)}/>路段频次</label>}</div>}
  <div className="map-toolbar"><span className="small muted" role="status">{view==='charges'?`${markers.length}/${relevantCharges.length} 次充电有定位`:`轨迹 ${loader.completed}/${ids.length} 段 · 当前载入历史共 ${rows.length} 段`}{loader.loading?' · 正在读取…':''}</span>{loader.loading?<button onClick={loader.cancel}>取消读取</button>:(loader.failed.length>0||loader.completed<ids.length)&&<button onClick={loader.retry}>重试未完成轨迹</button>}</div>
  <MapView config={config} paths={view==='charges'?noPaths:paths} routeSamples={view==='charges'?noPaths:samples} speeds={speeds} elevations={elevations} colorMode={color} markers={markers} onMarkerSelect={id=>setSelectedCharge(Number(id))} frequency={frequency?.cells??noPaths} fillGaps={view==='day'} full/>
  {charge&&<div className="map-charge-summary"><strong>{hideAddress?'充电地点已隐藏':charge.address||'充电记录'}</strong><p className="small muted">{new Date(charge.start_date).toLocaleString('zh-CN')} · 充入 {typeof charge.charge_energy_added==='number'&&charge.charge_energy_added>=0?charge.charge_energy_added.toFixed(1):'—'} kWh</p><button className="text-button" onClick={()=>{window.location.hash=`detail/${charge.charge_id}/charge`;}}>查看这次充电</button></div>}
  {view==='charges'&&<div className="inline-actions" aria-label="地图充电记录">{markers.slice(0,chargeLimit).map((m:{id?:number|string;label?:string},i:number)=><button className="button secondary" key={m.id} onClick={()=>setSelectedCharge(Number(m.id))}>{hideAddress?`充电 ${i+1}`:m.label}</button>)}{markers.length>chargeLimit&&<button className="text-button" onClick={()=>setChargeLimit(n=>n+30)}>继续显示充电地点</button>}</div>}
  {view!=='charges'&&rows.length>limit&&<button className="secondary" onClick={()=>setLimit(value=>value+100)}>再读取 {Math.min(100,rows.length-limit)} 段轨迹</button>}
  {loader.failed.length>0&&<p className="warning">{loader.failed.length} 段读取失败，地图覆盖不完整，可重试。</p>}
  <p className="small muted">{view==='charges'?'仅显示已载入充电记录中有坐标的地点；重叠点可能来自同一充电站。':view==='history'?'仅覆盖已成功读取的轨迹。每段行程在同一网格只计一次，数字表示经过的行程数；定位缺口不计入道路。':'按行程独立绘制，充电位置以闪电标记。'}{frequency?.truncated?' 频次显示已达到 1500 网格上限，为部分覆盖。':''}</p>
 </section>;
}
