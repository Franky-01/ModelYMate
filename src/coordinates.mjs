import transform from 'coordtransform';
// Convert only the display coordinates. TeslaMate's GPS samples remain unchanged.
// coordtransform 2.1.2, MIT, https://github.com/wandergis/coordtransform
const cache=new Map();
export function projectGPSPoints(points){
 if(cache.size>50000)cache.clear();
 return points.map(p=>{
  if(!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>90)throw new Error('定位坐标无效。');
  const key=p.join(',');let projected=cache.get(key);
  if(!projected){projected=transform.wgs84togcj02(p[0],p[1]);cache.set(key,projected);}
  return [...projected];
 });
}
