// Browser-only AMap simulator for integration QA. Never shipped in dist.
(() => {
  localStorage.setItem('modelymate.demo','false');
  localStorage.setItem('modelymate.qa-gap-fixture.1.trips',JSON.stringify([{id:'qa-trip',title:'模拟断点旅途',note:'虚构数据',driveIDs:[1,2],createdAt:'2026-10-14T00:00:00Z'}]));
  const audit={calls:[],maps:0,destroyed:0};
  const ns='http://www.w3.org/2000/svg';
  const write=()=>{const output=document.getElementById('qa-map-audit');if(output)output.textContent=JSON.stringify(audit);};
  document.addEventListener('DOMContentLoaded',()=>{
    const badge=document.createElement('div');badge.textContent='本地模拟验收 · 数据、底图和导航响应均为虚构';badge.style.cssText='position:fixed;top:0;right:0;z-index:9999;background:#3f3220;color:#f6d795;padding:5px 12px;font:11px sans-serif;pointer-events:none';document.body.append(badge);
    const output=document.createElement('output');output.id='qa-map-audit';output.hidden=true;document.body.append(output);write();
  });
  class Polyline {constructor(options){this.options=options;}}
  class Marker {
    constructor(options){this.options=options;this.position=options.position;}
    setPosition(position){this.position=position;this.owner?.draw();}
  }
  class Map {
    constructor(host){this.host=host;this.overlays=[];this.host.style.background='#11212a';audit.maps++;write();}
    add(overlay){overlay.owner=this;this.overlays.push(overlay);this.draw();}
    on(){}
    setFitView(){this.bounds=null;this.draw();}
    setCenter(){this.draw();}
    destroy(){this.host.replaceChildren();audit.destroyed++;write();}
    draw(){
      const points=this.overlays.flatMap(o=>o.options.path??[o.position]).filter(Boolean);
      if(!points.length)return;
      if(!this.bounds){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);this.bounds=[Math.min(...xs)-.002,Math.max(...xs)+.002,Math.min(...ys)-.002,Math.max(...ys)+.002];}
      const [minX,maxX,minY,maxY]=this.bounds,xy=p=>[(p[0]-minX)/(maxX-minX)*900+50,450-(p[1]-minY)/(maxY-minY)*400];
      const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 1000 500');svg.setAttribute('preserveAspectRatio','none');svg.style.cssText='position:absolute;inset:0;width:100%;height:100%';
      for(let i=0;i<20;i++){const line=document.createElementNS(ns,'path');line.setAttribute('d',`M ${i*60} 0 L ${i*60-150} 500 M 0 ${i*40} L 1000 ${i*40+100}`);line.setAttribute('stroke','#1f3844');line.setAttribute('stroke-width','2');svg.append(line);}
      for(const overlay of this.overlays){
        if(overlay.options.path){const line=document.createElementNS(ns,'path');line.setAttribute('d',overlay.options.path.map((p,i)=>(i?'L ':'M ')+xy(p).join(' ')).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke',overlay.options.strokeColor);line.setAttribute('stroke-width','5');if(overlay.options.strokeStyle==='dashed')line.setAttribute('stroke-dasharray','10 7');svg.append(line);}
        else{const circle=document.createElementNS(ns,'circle'),[x,y]=xy(overlay.position);circle.setAttribute('cx',x);circle.setAttribute('cy',y);circle.setAttribute('r',overlay.options.content?.includes('vehicle-map-marker')?'8':'3');circle.setAttribute('fill','#a4f3d1');svg.append(circle);}
      }
      this.host.replaceChildren(svg);
      this.host.dataset.qaMap=JSON.stringify({lines:this.overlays.filter(o=>o.options.path).map(o=>({path:o.options.path,color:o.options.strokeColor,style:o.options.strokeStyle})),markers:this.overlays.filter(o=>!o.options.path).map(o=>o.position)});
    }
  }
  class Driving {
    constructor(options){this.options=options;}
    search(from,to,callback){
      audit.calls.push({from,to,policy:this.options.policy});write();
      setTimeout(()=>{
        if(new URLSearchParams(location.search).has('mapFail')){callback('error','SIMULATED_UNAVAILABLE');return;}
        const bend=[from[0],to[1]];
        callback('complete',{routes:[{distance:100,steps:[{path:[from,bend,to]}]}]});
      },100);
    }
    clear(){}
  }
  window.AMap={Map,Marker,Polyline,Driving,DrivingPolicy:{LEAST_DISTANCE:2},plugin(_name,ready){ready();}};
})();
