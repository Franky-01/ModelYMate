import {Gauge} from 'lucide-react';
import {fmt,positive} from './core.mjs';
import {telemetryFreshness} from './data-quality.mjs';

export default function TirePressure({status,units,received,now}:{status:any;units:any;received:number|null;now:number}){
  const tpms=status?.tpms_details??{},unit=['bar','psi','kPa'].includes(units?.unit_of_pressure)?units.unit_of_pressure:null;
  const freshness=telemetryFreshness(tpms,received,now),age=received?Math.max(0,now-received):null;
  const sampled=freshness.source?new Date(freshness.source).toLocaleString('zh-CN'):null;
  return <section className="card tire-home" aria-label="四轮胎压"><div className="card-heading"><h2><Gauge size={18}/>四轮胎压</h2><span className="muted small">{unit??'单位未知'}</span></div><div className="tire-home-grid">{[['左前','fl'],['右前','fr'],['左后','rl'],['右后','rr']].map(([label,key])=>{const value=positive(tpms['tpms_pressure_'+key]),warning=tpms['tpms_soft_warning_'+key]===true;return <div key={key} className={warning?'tire-warning':''}><span>{label}</span><strong>{unit&&value!==null?fmt(value,unit==='bar'?2:1):'—'}</strong><small>{warning?'车辆胎压提示':value===null?'暂无读数':unit?'':'单位待确认'}</small></div>;})}</div><p className="muted small">{sampled?`胎压采样：${sampled}${freshness.fresh?'':' · 历史读数'}`:'胎压采样时间未知 · 仅展示最近读数'}<br/>{received?`网页读取：${new Date(received).toLocaleTimeString('zh-CN')}${age!==null&&age>30000?' · 连接数据已陈旧':''}`:'尚未读取车况'}</p></section>;
}
