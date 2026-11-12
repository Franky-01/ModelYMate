// Explicit demo fixtures, never combined with a live connection.
const units={unit_of_length:'km',unit_of_temperature:'°C',unit_of_pressure:'bar'};
const today=new Date();today.setHours(9,18,0,0);
function startAt(days,hour=9){const d=new Date(today);d.setDate(d.getDate()-days);d.setHours(hour,18,0,0);return d.toISOString();}
export const demoDrives=Array.from({length:34},(_,i)=>{
  const km=Number((8+(i*17%81)+.6).toFixed(1)),soc=Math.max(2,Math.round(km/4.7)),start=startAt(Math.floor(i/2),i%2?18:9),minutes=Math.round(km/1.04);
  return {drive_id:i+1,start_date:start,end_date:new Date(Date.parse(start)+minutes*60000).toISOString(),start_address:i%2?'张江科学城':'世纪公园',end_address:i%2?'世纪公园':'张江科学城',duration_min:minutes,speed_avg:km/(minutes/60),speed_max:68+i%41,energy_consumed_net:Number((km*(.138+i%4*.006)).toFixed(2)),consumption_net:138+i%4*6,odometer_details:{odometer_distance:km},battery_details:{start_battery_level:86-i%12,end_battery_level:86-i%12-soc,is_sufficiently_precise:true,reduced_range:false},range_rated:{start_range:410,end_range:410-km*.96},outside_temp_avg:23,inside_temp_avg:24};
});
export const demoCharges=Array.from({length:8},(_,i)=>{
  const start=startAt(i*4,20),added=31+i*1.8;
  return{charge_id:i+1,start_date:start,end_date:new Date(Date.parse(start)+65*60000).toISOString(),address:i%3?'家用充电桩':'浦东超级充电站',latitude:31.21732,longitude:121.54224,charge_energy_added:added,charge_energy_used:added/0.935,cost:0,duration_min:65,battery_details:{start_battery_level:24,end_battery_level:80},range_rated:{start_range:111,end_range:371},outside_temp_avg:22};
});
export const demoStatus={display_name:'我的 Model Y',state:'parked',state_since:startAt(0),odometer:12486,battery_details:{battery_level:79,usable_battery_level:79,rated_battery_range:342,ideal_battery_range:355},car_status:{locked:true,doors_open:false,windows_open:false,sentry_mode:false,healthy:true,driver_front_door_open:false,passenger_front_door_open:false,driver_rear_door_open:false,passenger_rear_door_open:false,frunk_open:false,trunk_open:false},charging_details:{plugged_in:false,charge_port_door_open:false,charge_limit_soc:80,charger_power:0,charger_voltage:0,charger_actual_current:0},driving_details:{speed:0,shift_state:'P'},climate_details:{inside_temp:24,outside_temp:23,is_climate_on:false},tpms_details:{tpms_pressure_fl:2.7,tpms_pressure_fr:2.7,tpms_pressure_rl:2.8,tpms_pressure_rr:2.8},car_geodata:{geofence:'世纪公园',location:{latitude:31.21732,longitude:121.54224}},car_versions:{version:'2026.32.3',update_available:false}};
export function demoResponse(path) {
  const clean=path.split('?')[0];
  if(clean==='cars')return{cars:[{car_id:1,name:'我的 Model Y',car_details:{model:'Model Y',trim_badging:'Long Range',vin:'演示数据'},teslamate_stats:{total_drives:34,total_charges:8}}]};
  if(clean==='globalsettings')return{settings:{teslamate_units:units}};
  const m=clean.match(/^cars\/(\d+)(?:\/(.*))?$/),tail=m?.[2];
  if(!tail)return{car:{car_id:1,car_name:'我的 Model Y'},units};
  if(tail==='status')return{status:structuredClone(demoStatus),units,car:{car_id:1,car_name:'我的 Model Y'}};
  if(tail==='drives')return{drives:demoDrives,units};
  if(tail==='charges')return{charges:demoCharges,units};
  if(tail==='charges/current')return{charge:null,units};
  if(tail==='battery-health')return{battery_health:{battery_health_percentage:96.5,current_capacity:72.1,max_capacity:74.7,current_range:433,max_range:449},units};
  if(tail==='updates')return{updates:[{update_id:1,start_date:startAt(9),end_date:startAt(9),version:'2026.32.3'},{update_id:2,start_date:startAt(32),end_date:startAt(32),version:'2026.26.4'}]};
  if(tail?.startsWith('drives/')){
    const r=demoDrives.find(r=>r.drive_id===Number(tail.split('/')[1]))??demoDrives[0];
    return{units,drive:{...r,drive_details:Array.from({length:180},(_,i)=>({detail_id:i+1,date:new Date(Date.parse(r.start_date)+i*r.duration_min*60000/179).toISOString(),longitude:121.54224+i/179*.035,latitude:31.21732+Math.sin(i/179*Math.PI)*.012,speed:Math.max(0,55+26*Math.sin(i*.13)-Math.abs(90-i)/8),power:Math.sin(i*.18)*18+8,elevation:7+Math.sin(i*.05)*3,battery_level:r.battery_details.start_battery_level-(r.battery_details.start_battery_level-r.battery_details.end_battery_level)*i/179,climate_info:{inside_temp:24+Math.sin(i*.03),outside_temp:23+Math.cos(i*.03)}}))}};
  }
  if(tail?.startsWith('charges/')){
    const r=demoCharges.find(r=>r.charge_id===Number(tail.split('/')[1]))??demoCharges[0];
    return{units,charge:{...r,charge_details:Array.from({length:66},(_,i)=>({detail_id:i+1,date:new Date(Date.parse(r.start_date)+i*60000).toISOString(),battery_level:24+56*i/65,charge_energy_added:r.charge_energy_added*i/65,outside_temp:22,charger_details:{charger_power:i>60?10:Math.max(20,48-i*.37),charger_voltage:220,charger_actual_current:32,charger_phases:3},battery_info:{battery_heater_on:false}}))}};
  }
  throw new Error('演示中没有这条记录。');
}
