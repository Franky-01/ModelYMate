import {useEffect,useRef,useState} from 'react';
import {Download,Square} from 'lucide-react';
import {exportGeometry,videoMime} from './replay-export.mjs';

function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export default function ReplayExport({samples,title='行程回放',hideAddress=false}:{samples:any[][];title?:string;hideAddress?:boolean}){
 const [includeRoute,setIncludeRoute]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[message,setMessage]=useState(''),job=useRef<AbortController|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;const pause=()=>{if(document.visibilityState!=='visible')job.current?.abort();};document.addEventListener('visibilitychange',pause);return()=>{alive.current=false;job.current?.abort();document.removeEventListener('visibilitychange',pause);};},[]);
 useEffect(()=>{job.current?.abort();setIncludeRoute(false);},[hideAddress]);
 useEffect(()=>{job.current?.abort();},[samples]);
 function scene(){
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=960;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('此浏览器无法生成图片。');
  const geometry=includeRoute&&!hideAddress?exportGeometry(samples):null;
  const draw=(fraction:number)=>{
   ctx.fillStyle='#11191e';ctx.fillRect(0,0,720,960);ctx.fillStyle='#83dfbd';ctx.font='24px sans-serif';ctx.fillText('ModelYMate',48,64);ctx.fillStyle='#edf3f3';ctx.font='bold 42px sans-serif';ctx.fillText(title,48,132);ctx.fillStyle='#91a7ad';ctx.font='22px sans-serif';ctx.fillText(`${samples.length} 段行程 · ${geometry?.count??samples.reduce((n,p)=>n+p.length,0)} 个定位采样`,48,180);
   if(geometry){ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';const total=geometry.runs.reduce((n,run)=>n+run.length,0),visible=Math.round(total*fraction);let shown=0,last:number[]|null=null;for(const run of geometry.runs){ctx.strokeStyle='#314b4d';ctx.beginPath();run.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();ctx.strokeStyle='#76dcb7';ctx.beginPath();for(let i=0;i<run.length&&shown<visible;i++,shown++){const p=run[i];i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]);last=p;}ctx.stroke();}if(last){ctx.fillStyle='#f4d785';ctx.beginPath();ctx.arc(last[0],last[1],7,0,Math.PI*2);ctx.fill();}}
   else {ctx.fillStyle='#1e3339';ctx.fillRect(48,270,624,350);ctx.fillStyle='#b7cecf';ctx.font='28px sans-serif';ctx.fillText('地点与轨迹未包含',220,445);}
   ctx.fillStyle='#35474b';ctx.fillRect(48,788,624,4);ctx.fillStyle='#83dfbd';ctx.fillRect(48,788,624*fraction,4);ctx.fillStyle='#81989e';ctx.font='19px sans-serif';ctx.fillText('记录轨迹示意 · 不含底图与道路补线',48,850);ctx.fillText('用真实记录，留住每一程。',48,896);
  };return {canvas,draw};
 }
 async function png(){if(job.current)return;const controller=new AbortController();job.current=controller;setBusy(true);try{setMessage('');const {canvas,draw}=scene();draw(1);const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(controller.signal.aborted)throw new Error('已取消图片导出。');if(!blob)throw new Error('图片生成失败，请重试。');if(alive.current){download(blob,'ModelYMate-回放.png');setMessage('图片已生成，请在浏览器中保存。');}}catch(e){if(alive.current)setMessage((e as Error).message);}finally{if(job.current===controller)job.current=null;if(alive.current)setBusy(false);}}
 async function video(){
  if(job.current)return;const mime=videoMime(globalThis.MediaRecorder);if(!mime||!HTMLCanvasElement.prototype.captureStream){setMessage('此浏览器暂不支持视频导出，可保存 PNG 图片。');return;}
  const controller=new AbortController();job.current=controller;setBusy(true);setProgress(0);setMessage('');let stream:MediaStream|undefined,frame=0,timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const {canvas,draw}=scene();draw(0);stream=canvas.captureStream(12);const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1600000}),chunks:BlobPart[]=[];
   const output=new Promise<Blob>((resolve,reject)=>{
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onerror=()=>reject(new Error('视频生成失败，可改为保存 PNG。'));
    recorder.onstop=()=>controller.signal.aborted?reject(new Error('已取消视频导出。')):resolve(new Blob(chunks,{type:mime}));
    controller.signal.addEventListener('abort',()=>{if(recorder.state!=='inactive')recorder.stop();else reject(new Error('已取消视频导出。'));},{once:true});
   });
   recorder.start(500);const start=performance.now(),duration=12000;let previous=0;
   const tick=(now:number)=>{if(controller.signal.aborted||recorder.state==='inactive')return;const ratio=Math.min(1,(now-start)/duration);if(now-previous>=80||ratio===1){draw(ratio);previous=now;if(alive.current)setProgress(Math.round(ratio*100));}if(ratio<1)frame=requestAnimationFrame(tick);else recorder.stop();};frame=requestAnimationFrame(tick);
   timer=setTimeout(()=>controller.abort(),18000);const blob=await output;if(blob.size===0)throw new Error('此浏览器未生成有效视频，可保存 PNG。');if(alive.current){download(blob,`ModelYMate-回放.${mime.includes('mp4')?'mp4':'webm'}`);setMessage('12 秒视频已生成，请在浏览器中保存。');}
  }catch(e){if(alive.current)setMessage((e as Error).message);}finally{cancelAnimationFrame(frame);clearTimeout(timer);stream?.getTracks().forEach(track=>track.stop());if(job.current===controller)job.current=null;if(alive.current)setBusy(false);}
 }
 return <div className="replay-export"><label className="map-check"><input type="checkbox" checked={includeRoute&&!hideAddress} disabled={hideAddress||busy} onChange={e=>setIncludeRoute(e.target.checked)}/>分享中包含轨迹</label><div className="inline-actions"><button onClick={png} disabled={busy}><Download size={15}/>保存 PNG</button>{busy?<button onClick={()=>job.current?.abort()}><Square size={14}/>取消导出 {progress}%</button>:<button onClick={video}>导出 12 秒视频</button>}</div><p className="small muted" role="status">{message||'默认不包含地点和轨迹；视频只在本机生成，格式由浏览器支持决定。'}</p></div>;
}
