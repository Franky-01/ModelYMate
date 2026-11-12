import {useId} from 'react';
import {CalendarDays} from 'lucide-react';
import {localDay} from './core.mjs';

export default function DateRange({start='',end='',earliest,latest,onChange,now=Date.now()}:{start?:string;end?:string;earliest?:string;latest?:string;onChange:(start:string,end:string)=>void;now?:number}){
  const id=useId(),today=localDay(new Date(now));
  function quick(days:number){if(!days){onChange('','');return;}const d=new Date(now);d.setDate(d.getDate()-days+1);onChange(localDay(d),today);}
  function selected(days:number){if(!days)return !start&&!end;const d=new Date(now);d.setDate(d.getDate()-days+1);return start===localDay(d)&&end===today;}
  const first=start||earliest||'',last=end||latest||'';
  const field=(kind:'start'|'end',value:string)=> <label className="range-date-field" htmlFor={id+'-'+kind}><span>{kind==='start'?'开始日期':'结束日期'}</span><span className="date-input-shell"><time className="date-visible-value" dateTime={value||undefined} aria-hidden="true">{value?value.replaceAll('-','/'):'不限日期'}</time><CalendarDays size={16} aria-hidden="true"/><input id={id+'-'+kind} aria-label={kind==='start'?'开始日期':'结束日期'} aria-describedby={id+'-range'} type="date" value={value} max={kind==='start'?(end||undefined):undefined} min={kind==='end'?(start||undefined):undefined} onChange={e=>onChange(kind==='start'?e.target.value:start,kind==='end'?e.target.value:end)}/></span></label>;
  return <fieldset className="date-range"><legend>选择日期范围</legend><div className="date-range-fields">{field('start',first)}{field('end',last)}</div><div className="date-shortcuts" aria-label="快捷日期范围">{[[1,'今天'],[7,'近 7 天'],[30,'近 30 天'],[0,'全部日期']].map(([days,label])=><button type="button" className="text-button" key={days} aria-pressed={selected(Number(days))} onClick={()=>quick(Number(days))}>{label}</button>)}</div><p id={id+'-range'} role="status" className="date-range-summary">{!start&&!end?'全部已载入日期':'已选日期范围'} · 含起止日<span className="sr-only">：{first||'最早记录'} 至 {last||'最新记录'}，点按日期框选择日期</span></p></fieldset>;
}
