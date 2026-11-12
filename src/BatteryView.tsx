import {useMemo} from 'react';
import {Battery,RefreshCw} from 'lucide-react';
import Chart from './Chart';
import {batteryHealth,fmt,positive} from './core.mjs';

export default function BatteryView({c,PageHeading,Card,Metric,ErrorMessage,HistoryLoader}:any){
  const h=c.health??{},percentage=batteryHealth(h),factor=c.units.unit_of_length==='mi'?1/1.609344:1;
  const rangePoints=useMemo(()=>(h.series??[]).map((p:any)=>({x:Date.parse(p.day+'T12:00:00'),y:p.range_km*factor})),[h.series,factor]);
  return <><PageHeading eyebrow="BATTERY" title="电池健康" subtitle="与已记录的满电续航峰值比较"><button className="button secondary" disabled={c.healthBusy||c.loadingHistory} onClick={()=>c.readHealth(undefined,true)}><RefreshCw size={17}/>{c.healthBusy?'正在读取满充采样…':'刷新健康数据'}</button></PageHeading>
    <ErrorMessage message={c.healthError}/>
    <Card className="battery-hero"><div className="large-health-ring" style={{'--health':(percentage??0)+'%'} as any}><Battery size={40}/><strong>{fmt(percentage)}<small>%</small></strong></div><div><h2>{percentage===null?'暂无足够的满充记录':'满电续航健康估算'}</h2><p>{c.healthBusy?'正在读取满充记录…':'相对已记录续航的估算，受温度与标定影响。'}</p>{!h.complete&&<p className="muted small">充电历史覆盖有限。</p>}</div></Card>
    <div className="detail-grid summary-grid"><Metric label="当前满电续航" value={positive(h.current_range)!==null?h.current_range*factor:null} unit={c.units.unit_of_length}/><Metric label="记录中的续航峰值" value={positive(h.max_range)!==null?h.max_range*factor:null} unit={c.units.unit_of_length}/><Metric label="标定容量估算" value={positive(h.current_capacity)} unit="kWh"/></div>
    <Card title="历史满电续航"><Chart label="满电续航" unit={c.units.unit_of_length} gapMs={36*3600000} points={rangePoints}/></Card>
    <details className="card advanced-details"><summary>数据详情</summary><p>{h.sampleCount??0} 个有效采样 · {h.sampleDays??0} 个满充日 · {h.sessionCount??0}/{h.totalSessions??0} 个满充过程</p><p>按充电开始日归组（{h.timeZone??'当前设备时区'}），使用 Σ额定续航 ÷ Σ可用电量 × 100；单位统一为 km 后计算。</p><p>参考 my-tesla 的满充算法：当前满电续航 ÷ 每日满电续航峰值 × 100%，最高显示 100%。可用电量缺失时采用该点的电量，0% 不参与外推。</p><p>这是相对现有记录的估计，受温度、电量标定与历史覆盖影响，不代表与新车化学容量的比值。容量另用充电记录 Σ充入电量 ÷ Σ额定续航增量标定；没有有效标定时保持未知。</p><Metric label="充电标定" value={h.calibration?.kwhPerKm!=null?h.calibration.kwhPerKm*100:null} unit="kWh/100km" note={`${h.calibration?.count??0} 条有效充电记录`}/><a className="text-button" href="https://github.com/kinopico-zhang/my-tesla/blob/c1210ef0e65db22a745476f332af9300a10dbbb1/app/tesla/repository/charging/battery_health.py" target="_blank" rel="noreferrer">my-tesla · MIT · 算法来源</a></details>{h.method&&!h.complete&&c.done.charges&&<button className="button secondary" onClick={()=>c.loadHistory('charges',true)}>有新记录间隔，重新载入充电历史</button>}<HistoryLoader/>
  </>;
}
