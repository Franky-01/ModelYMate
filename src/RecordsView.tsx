import {useEffect,useMemo,useState} from 'react';
import {Download,MapPin,RefreshCw,Route,Search} from 'lucide-react';
import {date,localDay,stats,exportCSV,fmt} from './core.mjs';
import {coverageText} from './data-quality.mjs';
import {filterRecords,driveDistribution} from './insights.mjs';
import DateRange from './DateRange';
import EnergyEstimateNote from './EnergyEstimateNote';

export default function RecordsView({c,RecordRow,Metric,Card,PageHeading,Modal}:any){
  const [filters,setFilters]=useState<any>({kind:'all'}),[visible,setVisible]=useState(80),[selected,setSelected]=useState<number[]>([]),[bulk,setBulk]=useState('通勤'),[bulkDriver,setBulkDriver]=useState(''),[exporting,setExporting]=useState(false),[includePrivate,setIncludePrivate]=useState(false);
  const rows=useMemo(()=>filterRecords(c.drives,c.charges,c.journals,c.costs,c.aliases,filters),[c.drives,c.charges,c.journals,c.costs,c.aliases,filters]);
  const summary=useMemo(()=>stats(rows.filter(r=>r.kind==='drive'),rows.filter(r=>r.kind==='charge'),c.units.unit_of_length),[rows,c.units.unit_of_length]);
  const distribution=useMemo(()=>driveDistribution(rows.filter(r=>r.kind==='drive'),c.units.unit_of_length),[rows,c.units.unit_of_length]);
  const driverNames=Array.from(new Set<string>([...c.drivers,...Object.values(c.journals).map((j:any)=>j.driver).filter(Boolean)]));
  const recordedDays=useMemo(()=>[...c.drives,...c.charges].flatMap(r=>{const d=date(r.start_date);return d?[localDay(d)]:[];}).sort(),[c.drives,c.charges]);
  useEffect(()=>{setVisible(80);setSelected([]);},[filters]);
  const groups=new Map<string,any[]>();for(const r of rows.slice(0,visible)){const d=date(r.start_date),key=d?localDay(d):'日期未知';if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(r);}
  function set(key:string,value:string){setFilters((f:any)=>({...f,[key]:value}));}
  function exportFile(){const csv=exportCSV(rows.filter(r=>r.kind==='drive'),rows.filter(r=>r.kind==='charge'),c.units,c.journals,c.costs,{private:c.hideAddress||!includePrivate,partial:!c.done.drives||!c.done.charges});const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='ModelYMate-记录.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);setExporting(false);c.notify('已发起 CSV 下载');}
  function applyBulk(){const next={...c.journals};selected.forEach(id=>next[id]={...next[id],category:bulk,...(bulkDriver?{driver:bulkDriver}:{})});if(c.save('journals',next)){setSelected([]);c.notify('分类与司机已保存');}}
  return <><PageHeading eyebrow="ACTIVITY" title="每一程，都有记录" subtitle={`${rows.length} 条符合筛选 · ${!c.done.drives||!c.done.charges?'已载入的部分历史':'全部历史已载入'}`}>
    <button className="icon-button" aria-label="刷新记录" disabled={c.loadingHistory} onClick={()=>{c.loadHistory('drives',true);c.loadHistory('charges',true);}}><RefreshCw size={18}/></button>
    <button className="button secondary" onClick={()=>c.navigate('map')}><MapPin size={17}/>地图</button><button className="button secondary" onClick={()=>c.navigate('trips')}><Route size={17}/>旅途</button><button className="button secondary" onClick={()=>{setIncludePrivate(false);setExporting(true);}}><Download size={17}/>CSV</button>
  </PageHeading>
  <div className="records-tools"><div className="segmented">{[['all','全部'],['drive','行程'],['charge','充电']].map(([id,label])=><button key={id} className={filters.kind===id?'selected':''} onClick={()=>set('kind',id)}>{label}</button>)}</div><label className="search-field"><Search size={17}/><input aria-label="搜索地点或备注" placeholder="地点、别名、司机或备注" value={filters.search??''} onChange={e=>set('search',e.target.value)}/></label></div>
  <DateRange start={filters.start} end={filters.end} earliest={recordedDays[0]} latest={recordedDays.at(-1)} now={c.clock} onChange={(start,end)=>setFilters((f:any)=>({...f,start,end}))}/>
  <details className="card filter-details"><summary>更多筛选与统计</summary><div className="filter-grid">
    <label>司机<select aria-label="筛选司机" value={filters.driver??''} onChange={e=>set('driver',e.target.value)}><option value="">全部司机</option>{driverNames.map(n=><option key={n}>{n}</option>)}</select></label>
    <label>分类<select aria-label="筛选分类" value={filters.category??''} onChange={e=>set('category',e.target.value)}><option value="">全部分类</option>{['未分类','通勤','个人','商务'].map(n=><option key={n}>{n}</option>)}</select></label>
    {(['distanceMin','distanceMax','minutesMin','minutesMax'] as const).map((key,i)=><label key={key}>{['最短距离','最长距离','最短时长（分）','最长时长（分）'][i]}{i<2?`（${c.units.unit_of_length??'未知单位'}）`:''}<input aria-label={['最短距离','最长距离','最短时长','最长时长'][i]} type="number" min="0" value={filters[key]??''} onChange={e=>set(key,e.target.value)}/></label>)}
    <label>充电费用<select aria-label="筛选费用来源" value={filters.cost??'all'} onChange={e=>set('cost',e.target.value)}>{[['all','全部'],['manual','手工费用'],['server','源费用'],['estimate','规则估算'],['missing','费用未知']].map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label><button className="button secondary" onClick={()=>setFilters({kind:'all'})}>清除筛选</button>
    <label>充电类型<select aria-label="筛选充电类型" value={filters.charger??'all'} onChange={e=>set('charger',e.target.value)}>{[['all','全部类型'],['fast','明确快充'],['regular','明确非快充'],['unknown','类型未知']].map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
    <label>排序<select aria-label="记录排序" value={filters.sort??'newest'} onChange={e=>set('sort',e.target.value)}>{[['newest','最新在前'],['oldest','最早在前'],['distance','行程距离'],['duration','记录时长'],['energy','充入电量']].map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
  </div><p className="muted small">司机、分类和距离筛选适用于行程；费用与充电类型筛选适用于充电。组合筛选取交集。上游未提供充电类型时保留未知，不按功率推测。</p>
    <div className="detail-grid"><Metric label="筛选里程" value={summary.distance} unit={c.units.unit_of_length} note={coverageText(summary.coverage.distance)}/><Metric label="平均能耗" value={summary.efficiency.consumption} unit="kWh/100km" note={coverageText(summary.coverage.consumption)+(summary.efficiency.estimated?' · 充电标定估算':'')}/><Metric label="驾驶时长" value={summary.minutes} unit="分" note={coverageText(summary.coverage.minutes)}/><Metric label="充入电量" value={summary.added} unit="kWh" note={coverageText(summary.coverage.added)}/></div>
    {summary.efficiency.estimated&&<EnergyEstimateNote calibration={c.calibration}/>}
    <p className="muted small">单程距离分布 · {distribution.valid}/{distribution.total} 条有效</p><div className="distribution">{distribution.bands.map(b=><div key={b.label}><span>{b.label}</span><i><b style={{width:(distribution.valid?b.count/distribution.valid*100:0)+'%'}}/></i><strong>{b.count} 次</strong></div>)}</div>
  </details>
  {filters.start&&filters.end&&filters.start>filters.end&&<p role="alert" className="error-banner">开始日期不能晚于结束日期。</p>}
  {selected.length>0&&<div className="bulk-bar"><span>已选择 {selected.length} 段</span><select aria-label="批量分类" value={bulk} onChange={e=>setBulk(e.target.value)}>{['未分类','通勤','个人','商务'].map(v=><option key={v}>{v}</option>)}</select><select aria-label="批量司机" value={bulkDriver} onChange={e=>setBulkDriver(e.target.value)}><option value="">保留原司机</option>{driverNames.map(n=><option key={n}>{n}</option>)}</select><button className="text-button" onClick={applyBulk}>应用分类</button><button className="text-button" onClick={()=>setSelected([])}>取消选择</button></div>}
  {(c.historyErrors.drives||c.historyErrors.charges)&&<p role="alert" className="error-banner">{c.historyErrors.drives||c.historyErrors.charges}</p>}
  {[...groups].map(([day,items])=><section className="day-group" key={day}><h2>{day}<span>{items.length} 条记录</span></h2><div className="card record-list">{items.map(r=><RecordRow key={r.kind+(r.drive_id??r.charge_id)} record={r} kind={r.kind} select={r.kind==='drive'?()=>setSelected(old=>old.includes(r.drive_id)?old.filter(x=>x!==r.drive_id):[...old,r.drive_id]):undefined} selected={selected.includes(r.drive_id)}/>)}</div></section>)}
  {!rows.length&&<Card><p className="empty">{c.loadingHistory||c.busy?'正在读取记录…':c.error?'暂时无法读取，请重新连接':'这个范围还没有记录'}</p></Card>}
  <div className="load-more">{rows.length>visible&&<button className="button secondary" onClick={()=>setVisible(v=>v+80)}>显示更多已载入记录（{visible}/{rows.length}）</button>}{!c.done.drives&&<button className="button secondary" disabled={c.loadingHistory} onClick={()=>c.loadHistory('drives')}>加载更多行程</button>}{!c.done.charges&&<button className="button secondary" disabled={c.loadingHistory} onClick={()=>c.loadHistory('charges')}>加载更多充电</button>}</div>
  {exporting&&<Modal title="导出筛选记录" onClose={()=>setExporting(false)}><p>导出当前筛选的全部 {rows.length} 条已载入记录，含各项数据来源与覆盖范围。</p><label className="share-privacy"><input type="checkbox" checked={includePrivate&&!c.hideAddress} disabled={c.hideAddress} onChange={e=>setIncludePrivate(e.target.checked)}/>包含地点与备注（可能识别私人位置）</label><p className="muted small">默认隐藏地点与备注。CSV 不含原始 GPS 轨迹。</p><button className="button" onClick={exportFile}>下载 CSV</button></Modal>}
  </>;
}
