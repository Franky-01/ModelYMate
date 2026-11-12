import test from 'node:test';
import assert from 'node:assert/strict';
import {chargingPresentation} from '../src/charging.mjs';
const now=Date.parse('2026-10-16T02:00:00Z'),stamp=new Date(now).toISOString(),s=(state='charging',power=7,extra={})=>({state,date:stamp,charging_details:{charger_power:power,plugged_in:true,...extra}});
test('positive charging power animates both charging state and explicit mapped charger state',()=>{
 assert.equal(chargingPresentation(s(),now,now).animate,true);
 assert.equal(chargingPresentation(s('parked',7,{charging_state:'Charging'}),now,now).phase,'charging');
 assert.equal(chargingPresentation(s('charging',7,{date:stamp}),now,now).power,7);
});
test('pause, complete, disconnect, offline and stale states cannot animate as charging',()=>{
 for(const [row,phase] of [[s('charging',0),'paused'],[s('charging',7,{charging_state:'Stopped'}),'paused'],[s('charging',7,{charging_state:'Complete'}),'complete'],[s('charging',7,{charging_state:'Disconnected'}),'unplugged'],[s('offline',7),'offline'],[{...s(),date:new Date(now-60000).toISOString()},'history']]){const p=chargingPresentation(row,now,now);assert.equal(p.phase,phase);assert.equal(p.animate,false);}
 assert.equal(chargingPresentation(s(),now-60000,now).animate,false);
});
test('missing or invalid power does not become zero or imply active energy transfer',()=>{
 for(const power of [undefined,null,NaN,-1]){const row=s();row.charging_details.charger_power=power;const p=chargingPresentation(row,now,now);assert.equal(p.power,null);assert.equal(p.phase,'reported');assert.equal(p.animate,false);}
 const unknown={state:'charging',charging_details:{charger_power:7}};const p=chargingPresentation(unknown,now,now);assert.equal(p.animate,true);assert.equal(p.sourceUnknown,true);
 assert.equal(chargingPresentation({charging_details:{charger_power:7}},now,now).animate,false);
});
test('a current session can corroborate fresh real charging but ended or old sessions never animate',()=>{
 const current={is_charging:true,charge_details:[{date:stamp,charger_details:{charger_power:5}}]};
 assert.equal(chargingPresentation({state:'parked'},now,now,current,now).animate,true);
 assert.equal(chargingPresentation({state:'parked'},now,now,{...current,end_date:stamp},now).phase,'complete');
 assert.equal(chargingPresentation({state:'parked'},now,now,{...current,charge_details:[{date:new Date(now-60000).toISOString(),charger_details:{charger_power:5}}]},now).animate,false);
 assert.equal(chargingPresentation(s('offline'),now,now,current,now).animate,false);
 const paused={...current,is_charging:false,charge_details:[{date:stamp,charger_details:{charger_power:0}}]};assert.equal(chargingPresentation({...s(),date:new Date(now-1000).toISOString()},now-1000,now,paused,now).phase,'paused');
});
