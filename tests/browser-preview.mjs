// Isolated, loopback-only UI fixture. No environment files, credentials or external requests.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {demoResponse} from '../src/demo.mjs';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
const mock=fileURLToPath(new URL('./mock-amap.js',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.hdr':'application/octet-stream','.png':'image/png','.svg':'image/svg+xml'};
function fixture(apiPath) {
  const data=demoResponse(apiPath);
  if(data.drive){
    const start=new Date(2026,9,14,9,18).getTime(),rows=data.drive.drive_details;
    data.drive.start_date=new Date(start).toISOString();data.drive.end_date=new Date(start+179*5000).toISOString();data.drive.duration_min=179*5/60;
    data.drive.drive_details=rows.map((p,i)=>({...p,date:new Date(start+(i===11?10:i)*5000).toISOString(),longitude:i>=40&&i<=65?null:p.longitude}));
  }
  if(data.cars)for(const car of data.cars)car.name='模拟 Model Y';
  return data;
}
http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1:5186');
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    if(url.pathname==='/pwa-api/config'){res.end(JSON.stringify({amapKey:'local-mock',amapReady:true,backendConfigured:true,authenticated:true,scope:'qa-gap-fixture',baseURL:'http://127.0.0.1:5186'}));return;}
    if(url.pathname.startsWith('/pwa-api/teslamate/')){res.end(JSON.stringify({data:fixture(url.pathname.slice('/pwa-api/teslamate/'.length)+url.search)}));return;}
    if(url.pathname==='/qa-map.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(mock));return;}
    if(url.pathname==='/sw.js'){res.writeHead(404);res.end('{}');return;}
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root)||!path.extname(file)){res.writeHead(404);res.end('{}');return;}
    let content=await readFile(file);
    if(path.extname(file)==='.html')content=Buffer.from(content.toString().replace('<head>',`<head><script src="/qa-map.js"></script>`));
    res.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');res.end(content);
  }catch{res.writeHead(404);res.end('{}');}
}).listen(5186,'127.0.0.1',()=>console.log('Simulated browser fixture: http://127.0.0.1:5186/?qa=1 (no real AMap or TeslaMate)'));
