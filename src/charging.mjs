import {telemetryFreshness} from './data-quality.mjs';
const numeric=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const state=v=>typeof v==='string'?v.toLowerCase().replace(/[\s_-]/g,''):'';
// Presentation only. It never changes charging, fetches extra telemetry, or writes data.
/** @param {any} status @param {number|null} received @param {number} [now] @param {any} [current] @param {number|null} [currentReceived] */
export function chargingPresentation(status,received,now=Date.now(),current=null,currentReceived=null){
 const s=status??{},c=s.charging_details??{},rows=current?.charge_details??[],last=rows.at(-1)??{},detail=last.charger_details??current?.charger_details??{};
 const sf=telemetryFreshness({date:c.date??s.date,timestamp:s.timestamp},received,now),cf=telemetryFreshness({date:last.date??current?.date},currentReceived,now);
 const recent=f=>f.reason==='fresh'||f.reason==='unknown';
 const statusRecent=recent(sf),currentRecent=recent(cf),currentNewer=currentRecent&&current&&(cf.source!==null&&sf.source!==null?cf.source>=sf.source:(currentReceived??0)>=(received??0)),currentHasState=currentNewer&&typeof current.is_charging==='boolean',raw=currentHasState?'':state(c.charging_state??s.charging_state),vehicle=state(s.state);
 const power=currentHasState?numeric(detail.charger_power):numeric(statusRecent?c.charger_power:undefined)??numeric(currentRecent?detail.charger_power:undefined);
 const ended=!!current?.end_date,offline=vehicle==='offline'||vehicle==='asleep'||vehicle==='suspended',disconnected=['disconnected','unplugged'].includes(raw);
 const complete=raw==='complete'||raw==='completed'||ended;
 const stopped=['stopped','nopower','starting','paused'].includes(raw)||currentHasState&&current.is_charging===false;
 const reported=currentHasState?current.is_charging===true&&!ended:vehicle==='charging'||raw==='charging'||c.is_charging===true||currentRecent&&current?.is_charging===true&&!ended;
 const connected=c.plugged_in===true||reported||complete||stopped;
 let phase='unknown';
 if(disconnected&&statusRecent)phase='unplugged';
 else if(offline)phase='offline';
 else if(complete)phase='complete';
 else if(stopped&&(statusRecent||currentRecent))phase='paused';
 else if(reported&&(statusRecent||currentRecent))phase=power!==null&&power>0?'charging':power===0?'paused':'reported';
 else if(connected&&statusRecent)phase='connected';
 else if(connected||current)phase='history';
 const label=({charging:'正在补能',paused:'充电已暂停',complete:'充电已完成',connected:'充电枪已连接',reported:'车辆报告充电中',offline:'车辆离线',unplugged:'充电枪未连接',history:'最近充电记录',unknown:'充电状态未知'})[phase];
 return {phase,label,power,animate:phase==='charging',show:connected||!!current,sourceUnknown:sf.source===null&&(!current||cf.source===null),stale:!statusRecent&&!currentRecent||offline};
}
