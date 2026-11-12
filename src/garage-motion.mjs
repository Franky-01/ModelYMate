const smooth=p=>p*p*(3-2*p);
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
export const ENTRY_DURATION=2.25;
const DRIFT_BEZIER=[[3.2,7],[3.1,4.8],[-1,1.3],[0,0]];
function driftPoint(t) {
  const a=(1-t)**3,b=3*(1-t)**2*t,c=3*(1-t)*t**2,d=t**3;
  return {x:DRIFT_BEZIER[0][0]*a+DRIFT_BEZIER[1][0]*b+DRIFT_BEZIER[2][0]*c+DRIFT_BEZIER[3][0]*d,
    z:DRIFT_BEZIER[0][1]*a+DRIFT_BEZIER[1][1]*b+DRIFT_BEZIER[2][1]*c+DRIFT_BEZIER[3][1]*d};
}
const DRIFT_ARC=(()=>{
  const points=[{t:0,distance:0}];let last=driftPoint(0),distance=0;
  for(let i=1;i<=256;i++){const t=i/256,point=driftPoint(t);distance+=Math.hypot(point.x-last.x,point.z-last.z);points.push({t,distance});last=point;}
  return points;
})();
export const ENTRY_ARC_LENGTH=DRIFT_ARC[DRIFT_ARC.length-1].distance;
export function driftPose(distance) {
  const target=clamp(distance,0,ENTRY_ARC_LENGTH);
  let high=DRIFT_ARC.findIndex(point=>point.distance>=target);if(high<=0)high=1;
  const before=DRIFT_ARC[high-1],after=DRIFT_ARC[high];
  const t=before.t+(after.t-before.t)*(target-before.distance)/(after.distance-before.distance);
  const progress=target/ENTRY_ARC_LENGTH,straighten=smooth(clamp((progress-.35)/.65,0,1));
  return {...driftPoint(t),yaw:(1-straighten)*(.95+.25*Math.sin(Math.PI*progress))};
}
export function arrivalDistance(elapsed) {
  const t=clamp(elapsed,0,ENTRY_DURATION),acceleration=.225,deceleration=.6;
  const cruise=ENTRY_DURATION-acceleration-deceleration,speed=ENTRY_ARC_LENGTH/(cruise+(acceleration+deceleration)/2);
  if(t<acceleration){const p=t/acceleration;return speed*acceleration*(p**3-.5*p**4);}
  if(t-acceleration<cruise)return speed*(acceleration/2+t-acceleration);
  const p=clamp((t-acceleration-cruise)/deceleration,0,1);
  return Math.min(ENTRY_ARC_LENGTH,speed*(acceleration/2+cruise+deceleration*(p-p**3+.5*p**4)));
}
// Display choreography: initiate the turn, countersteer through the slide, catch it and park.
// It is tied to arc progress, independent of frame rate, and is not vehicle telemetry.
const STEERING_KEYS=[[0,.26],[.08,.34],[.3,-.48],[.58,-.36],[.82,.13],[1,0]];
export function driftSteering(distance) {
  const progress=clamp(distance/ENTRY_ARC_LENGTH,0,1);
  for(let i=1;i<STEERING_KEYS.length;i++) {
    const [end,to]=STEERING_KEYS[i],[start,from]=STEERING_KEYS[i-1];
    if(progress<=end)return from+(to-from)*smooth((progress-start)/(end-start));
  }
  return 0;
}
export function frontWheelSteering(steer,wheelX,wheelbase) {
  if(Math.abs(steer)<1e-8)return 0;
  const sign=Math.sign(steer),radius=wheelbase/Math.tan(Math.abs(steer));
  // The inner front wheel turns a little more than the outer wheel.
  return sign*Math.atan(wheelbase/Math.max(.1,radius+sign*wheelX));
}
