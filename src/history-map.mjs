import {coordinate,nonNegative} from './core.mjs';
import {splitRecordedPath} from './routes.mjs';

const R=6378137;
function grid(point,size){const lng=point[0]*Math.PI/180,lat=Math.max(-85,Math.min(85,point[1]))*Math.PI/180;return [Math.floor(R*lng/size),Math.floor(R*Math.log(Math.tan(Math.PI/4+lat/2))/size)];}
function center(x,y,size){return [(x+.5)*size/R*180/Math.PI,(2*Math.atan(Math.exp((y+.5)*size/R))-Math.PI/2)*180/Math.PI];}

// Each drive votes once per cell. Repeated samples and stationary dwell add no frequency.
// Only recorded adjacent segments traverse cells; gaps are never counted as driven roads.
export function buildRoadFrequency(drives,{cellMeters=120,maxCells=12000}={}) {
  const size=Math.max(50,Math.min(2000,cellMeters)),cells=new Map();let truncated=false;
  for(const drive of drives){
    const seen=new Set(),path=drive.samples.map(p=>[p.longitude,p.latitude]);
    const visit=(x,y)=>{const key=x+','+y;if(seen.has(key))return;seen.add(key);let cell=cells.get(key);if(!cell){if(cells.size>=maxCells){truncated=true;return;}cell={key,point:center(x,y,size),count:0};cells.set(key,cell);}cell.count++;};
    for(const run of splitRecordedPath(path,drive.samples).runs){
      let before=null;
      for(let i=run.start;i<=run.end;i++){
        const current=grid(path[i],size);visit(...current);
        if(before){const steps=Math.max(Math.abs(current[0]-before[0]),Math.abs(current[1]-before[1]));
          // Very distant adjacent coordinates are not evidence of the intervening road.
          if(steps<=250)for(let j=1;j<steps;j++)visit(Math.round(before[0]+(current[0]-before[0])*j/steps),Math.round(before[1]+(current[1]-before[1])*j/steps));
        }
        before=current;
      }
    }
  }
  return {cells:[...cells.values()],cellMeters:size,truncated,driveCount:drives.length};
}

export function chargeMapPoints(charges,{hideAddress=false}={}) {
  return charges.flatMap(row=>{const point=coordinate(row);return point?[{id:row.charge_id,point,label:hideAddress?'充电记录':row.address||'充电记录',energy:nonNegative(row.charge_energy_added)}]:[];});
}
