import {useMemo,useState,type ComponentType} from 'react';
import {Coins,MapPin} from 'lucide-react';
import Chart from './Chart';
import {costSummary,dailyCostSeries,fmt,localDay,periodRows,stats} from './core.mjs';
import {coverageText} from './data-quality.mjs';
import {groupedPlaces,chargeDistributions} from './insights.mjs';

type Props={c:any;PageHeading:ComponentType<any>;PeriodSelector:ComponentType<any>;Card:ComponentType<any>;Metric:ComponentType<any>;ActivityList:ComponentType<any>;HistoryLoader:ComponentType<any>};
type CostGroup={actual:number|null;estimated:number|null;count:number;actualCount:number;estimatedCount:number;energy:number;pairedCost:number;pairedCount:number;averagePrice:number|null;coverage:{valid:number;total:number;partial:boolean};pairedCoverage:{valid:number;total:number;partial:boolean}};

export default function CostReportView({c,PageHeading,PeriodSelector,Card,Metric,ActivityList,HistoryLoader}:Props){
  const [period,setPeriod]=useState<number>(c.route.id??30),[placeLimit,setPlaceLimit]=useState(30),[ledgerLimit,setLedgerLimit]=useState(100);
  const today=localDay(new Date(c.clock??Date.now()));
  const charges=useMemo(()=>periodRows(c.charges,period,new Date(c.clock??Date.now())),[c.charges,period,today]);
  const drives=useMemo(()=>periodRows(c.drives,period,new Date(c.clock??Date.now())),[c.drives,period,today]);
  const totals=useMemo(()=>costSummary(charges,c.costs),[charges,c.costs]);
  const groups=Object.entries(totals.groups) as [string,CostGroup][];
  const driving=useMemo(()=>stats(drives,[],c.units.unit_of_length),[drives,c.units.unit_of_length]);
  const daily=useMemo(()=>Object.fromEntries(Object.keys(totals.groups).map(currency=>[currency,dailyCostSeries(charges,c.costs,currency,period,new Date(c.clock??Date.now()))])),[charges,c.costs,totals,period,today]);
  const places=useMemo(()=>groupedPlaces([],charges,c.aliases).map((p:any)=>({...p,cost:costSummary(p.charges,c.costs)})),[charges,c.aliases,c.costs]);
  const ledger=useMemo(()=>charges.map((r:any)=>({...r,kind:'charge'})).sort((a:any,b:any)=>(Date.parse(b.start_date)||0)-(Date.parse(a.start_date)||0)),[charges]);
  const complete=c.done.drives&&c.done.charges;
  const distributions=useMemo(()=>chargeDistributions(charges),[charges]);
  const drivingPrice=groups.length===1&&groups[0][1].averagePrice!==null?groups[0]:null;
  const changePeriod=(value:number)=>{setPeriod(value);setPlaceLimit(30);setLedgerLimit(100);};

  return <>
    <PageHeading eyebrow="CHARGING & COST" title="充电与费用复盘" subtitle={`${period?`最近 ${period} 天`:'全部记录'} · ${charges.length} 次充电 · ${complete?'全部历史已载入':'基于已载入历史'}`}>
      <PeriodSelector value={period} onChange={changePeriod}/>
    </PageHeading>
    {c.historyErrors.charges&&<div className="error-banner" role="alert">{c.historyErrors.charges}</div>}
    <p className="muted small" style={{marginBottom:20}}>{coverageText(totals.coverage)}。{totals.missingCount>0?`另有 ${totals.missingCount} 次费用待补。`:''}已记录费用与规则估算分开，币种不互相换算；平均电价仅使用费用、电量同时已知的记录。</p>
    <div className="currency-grid" style={{marginBottom:20}}>
      {groups.map(([currency,g])=><Card key={currency} title={currency}>
        <div className="detail-grid">
          <Metric label={g.coverage.partial?'已记录费用（部分）':'已记录费用'} value={g.actual} unit={currency} note={`${g.actualCount} 次已记录`}/>
          <Metric label="规则估算" value={g.estimated} unit={currency} note={`${g.estimatedCount} 次估算`}/>
          <Metric label="配对平均电价" value={g.averagePrice} unit={currency+'/kWh'} note={coverageText(g.pairedCoverage)}/>
          <Metric label="费用记录" value={g.count} unit="次" note={coverageText(g.coverage)}/>
        </div>
        <Chart gapMs={36*3600000} label="每日充电费用" unit={currency} points={daily[currency]}/>
        <p className="muted small">日图含规则估算；无记录或有待补费用的日期留空。覆盖条数不含其他已知币种。</p>
      </Card>)}
      {!groups.length&&<Card><div className="empty"><Coins size={27}/><p>尚未记录充电费用</p></div></Card>}
    </div>
    <Card title="充电习惯"><div className="charge-distributions">{distributions.map(d=><section key={d.label}><h3>{d.label}</h3><p className="muted small">{d.valid}/{d.total} 条有效 · {period?`最近 ${period} 天`:'全部已载入记录'}</p><div className="distribution">{d.bands.map(b=><div key={b.label}><span>{b.label}</span><i><b style={{width:(d.valid?b.count/d.valid*100:0)+'%'}}/></i><strong>{b.count} 次</strong></div>)}</div></section>)}</div></Card>
    {drivingPrice&&<Card title="行驶电费估算">
      <Metric label={driving.coverage.energy.partial?'已知行程电费估算（部分）':'本期行驶电费估算'} value={driving.energy===null?null:driving.energy*drivingPrice[1].averagePrice!} unit={drivingPrice[0]} note={`净能量：${coverageText(driving.coverage.energy)} · 电价：${coverageText(drivingPrice[1].pairedCoverage)}`}/>
      <p className="muted small" style={{marginTop:16}}>行程源净能量 × 本期配对平均电价，未分配实际充电账单。缺失行程能量不补零，未知费用不计入平均电价。{!complete?'当前历史尚未全部载入。':''}</p>
    </Card>}
    <Card title="充电地点排行">
      <p className="muted small">按地点别名合并展示，保留原始充电记录；次数不是停车次数。</p>
      <div className="place-list">
        {places.slice(0,placeLimit).map((p:any)=><div key={p.name}>
          <MapPin size={18}/>
          <span><strong>{c.hideAddress?'地点已隐藏':p.name}</strong><small>{p.charges.length} 次 · {p.addedCount<p.charges.length?'部分充入量 ':''}{fmt(p.added)} kWh · {p.addedCount}/{p.charges.length} 条有效</small></span>
          <span>{(Object.entries(p.cost.groups) as [string,CostGroup][]).map(([currency,g])=><small key={currency}>{g.coverage.partial?'部分 ':''}{fmt((g.actual??0)+(g.estimated??0))} {currency}{g.estimatedCount>0?'（含估算）':''}</small>)}<small>{coverageText(p.cost.coverage)}</small></span>
        </div>)}
      </div>
      {!places.length&&<div className="empty"><MapPin size={27}/><p>这个周期还没有充电地点</p></div>}
      {places.length>placeLimit&&<button className="button secondary" onClick={()=>setPlaceLimit(n=>n+30)}>继续显示地点（{placeLimit}/{places.length}）</button>}
    </Card>
    <Card title="充电账本">
      <ActivityList rows={ledger} limit={ledgerLimit}/>
      {ledger.length>ledgerLimit&&<button className="button secondary" onClick={()=>setLedgerLimit(n=>n+100)}>继续显示记录（{ledgerLimit}/{ledger.length}）</button>}
    </Card>
    <HistoryLoader/>
  </>;
}
