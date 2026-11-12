import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ENTRY_ARC_LENGTH,ENTRY_DURATION,arrivalDistance,driftPose,driftSteering,frontWheelSteering} from '../src/garage-motion.mjs';

test('original 2.25 second drift path and parked pose stay exact',()=>{
  assert.equal(ENTRY_DURATION,2.25);
  assert(Math.abs(ENTRY_ARC_LENGTH-7.93225576327524)<1e-12);
  assert.deepEqual(driftPose(0),{x:3.2,z:7,yaw:.95});
  assert.deepEqual(driftPose(ENTRY_ARC_LENGTH),{x:0,z:0,yaw:0});
  assert.equal(arrivalDistance(ENTRY_DURATION),ENTRY_ARC_LENGTH);
  for(const fps of [30,60,120]){
    let last=0;for(let frame=0;frame<=Math.ceil(ENTRY_DURATION*fps);frame++){
      const distance=arrivalDistance(frame/fps);assert(distance>=last);assert(distance<=ENTRY_ARC_LENGTH);last=distance;
    }
  }
});
test('front wheel choreography initiates, countersteers, catches and smoothly returns to zero',()=>{
  assert(driftSteering(0)>0);
  assert(driftSteering(ENTRY_ARC_LENGTH*.3)<-.4);
  assert(driftSteering(ENTRY_ARC_LENGTH*.82)>0);
  assert.equal(driftSteering(ENTRY_ARC_LENGTH),0);
  let previous=driftSteering(0);
  for(let i=1;i<=1000;i++){
    const value=driftSteering(ENTRY_ARC_LENGTH*i/1000);
    assert(Number.isFinite(value));assert(Math.abs(value)<=.5);assert(Math.abs(value-previous)<.007);previous=value;
  }
});
test('source front axle identification and inner/outer steering geometry are correct',()=>{
  const audit=JSON.parse(readFileSync(new URL('../public/assets/vehicle.audit.json',import.meta.url),'utf8'));
  const fronts=audit.wheels.filter(w=>w.axle==='front'),rears=audit.wheels.filter(w=>w.axle==='rear');
  assert.equal(fronts.length,2);assert.equal(rears.length,2);assert(fronts.every(w=>w.center[2]<0));
  const wheelbase=Math.abs(fronts[0].center[2]-rears[0].center[2]);
  const left=fronts.find(w=>w.center[0]<0),right=fronts.find(w=>w.center[0]>0);
  assert(frontWheelSteering(.34,left.center[0],wheelbase)>frontWheelSteering(.34,right.center[0],wheelbase));
  assert(Math.abs(frontWheelSteering(-.48,right.center[0],wheelbase))>Math.abs(frontWheelSteering(-.48,left.center[0],wheelbase)));
  for(const wheel of fronts){assert.equal(frontWheelSteering(0,wheel.center[0],wheelbase),0);assert(Math.abs(frontWheelSteering(-.48,wheel.center[0],wheelbase))<.6);}
});
