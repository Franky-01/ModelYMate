import {recordedDisplayPlan} from './routes.mjs';

export function videoMime(Recorder){
  if(!Recorder?.isTypeSupported)return null;
  return ['video/mp4;codecs=avc1.42E01E','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'].find(type=>Recorder.isTypeSupported(type))??null;
}

export function exportGeometry(samplePaths,maxPoints=1800){
  const count=samplePaths.reduce((n,p)=>n+p.length,0),runs=[];let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const samples of samplePaths){
    const path=samples.map(p=>[p.longitude,p.latitude]);
    for(const p of path){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}
    const plan=recordedDisplayPlan(path,samples,Math.max(2,Math.floor(maxPoints*path.length/Math.max(1,count))));
    for(const run of plan.runs)runs.push(run.indexes.map(i=>path[i]));
  }
  const middle=(minY+maxY)/2*Math.PI/180,scaleX=Math.cos(middle),width=(maxX-minX)*scaleX,height=maxY-minY;
  const scale=560/Math.max(.0001,width,height);
  const project=p=>[360+(p[0]-(minX+maxX)/2)*scaleX*scale,470-(p[1]-(minY+maxY)/2)*scale];
  return {runs:runs.map(run=>run.map(project)),count};
}
