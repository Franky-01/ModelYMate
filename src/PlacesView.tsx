import {useEffect,useMemo,useState} from 'react';
import {MapPin} from 'lucide-react';
import {fmt} from './core.mjs';
import {groupedPlaces} from './insights.mjs';

export default function PlacesView({c,ActivityList,Modal,Card,PageHeading}:any){
  const [search,setSearch]=useState(''),[selected,setSelected]=useState<string|null>(null),[alias,setAlias]=useState(''),[limit,setLimit]=useState(80);
  const groups=useMemo(()=>groupedPlaces(c.drives,c.charges,c.aliases),[c.drives,c.charges,c.aliases]);
  const current=groups.find(g=>g.name===selected);
  const visible=useMemo(()=>groups.filter(g=>[g.name,...g.originals].join(' ').toLowerCase().includes(search.toLowerCase())),[groups,search]);
  useEffect(()=>setLimit(80),[search]);
  function saveAlias(){if(!current||!alias.trim())return;const next={...c.aliases};current.originals.forEach((name:string)=>next[name]=alias.trim());if(c.save('aliases',next)){setSelected(alias.trim());c.notify('地点别名已保存');}}
  return <><PageHeading eyebrow="PLACES" title="常去的地方" subtitle={`${c.done.drives&&c.done.charges?'全部历史':'已载入的部分历史'} · 别名只影响本应用显示；原始地址与轨迹保持不变`}/>
  <label className="search-field"><input aria-label="搜索地点" placeholder="搜索地点或别名" value={search} onChange={e=>setSearch(e.target.value)}/></label>
  <Card><div className="place-list">{visible.slice(0,limit).map(g=><button key={g.name} onClick={()=>{setSelected(g.name);setAlias(g.name);}}><MapPin size={20}/><span><strong>{c.hideAddress?'地点已隐藏':g.name}</strong><small>{g.drives.length} 次相关行程 · {g.charges.length} 次充电</small><small>{g.parking.length} 段可推算停车 · {fmt(g.parkingMinutes)} 分</small></span><span><strong>{fmt(g.added)} kWh</strong><small>{g.addedCount}/{g.charges.length} 条电量有效</small></span></button>)}</div>{!visible.length&&<p className="empty">{search?'没有匹配地点':'尚无地点记录'}</p>}{visible.length>limit&&<button className="button secondary" onClick={()=>setLimit(n=>n+80)}>继续显示地点（{limit}/{visible.length}）</button>}</Card>
  <p className="muted small">停车时间是相邻已载入行程、上一终点与下一起点相同情况下的间隔估计，可能包含未记录的移动。未知头尾、不同地点、重叠时间不计；不代表完整驻车记录或驻车耗电。</p>
  {current&&<Modal title={c.hideAddress?'地点记录':current.name} onClose={()=>setSelected(null)}>{!c.hideAddress&&<><label className="field">地点别名<input aria-label="地点别名" maxLength={80} value={alias} onChange={e=>setAlias(e.target.value)}/></label><p className="muted small">使用同一别名可合并地点展示。包含 {current.originals.length} 个原始地址。</p><div className="button-row"><button className="button" disabled={!alias.trim()} onClick={saveAlias}>保存别名</button><button className="button secondary" onClick={()=>{const next={...c.aliases};current.originals.forEach((name:string)=>delete next[name]);if(c.save('aliases',next))setSelected(null);}}>恢复原始名称</button></div></>}
    <h3>可推算的停车间隔</h3>{current.parking.length?current.parking.slice(0,80).map((p:any)=><p className="muted small" key={p.before+'-'+p.after}>{new Date(p.start).toLocaleString('zh-CN')} → {new Date(p.end).toLocaleString('zh-CN')} · {fmt(p.minutes)} 分（估计）</p>):<p className="muted small">没有满足条件的相邻记录</p>}
    <ActivityList limit={80} rows={[...current.drives.map((r:any)=>({...r,kind:'drive'})),...current.charges.map((r:any)=>({...r,kind:'charge'}))].sort((a,b)=>Date.parse(b.start_date)-Date.parse(a.start_date))}/>
  </Modal>}</>;
}
