import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {Budget,proxyIPs,peerIP,loopback,positiveInteger,siteOrigin,verifyForwardAuth,sameOrigin,mapTarget,boundedResponse} from './security.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.env.MODELYMATE_SKIP_ENV_FILES!=='true'&&process.env.NODE_ENV!=='test'){
  for(const name of ['.env','.env.local']){try{const content=await readFile(path.join(root,name),'utf8');for(const row of content.split(/\r?\n/)){const match=row.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].replace(/^['"]|['"]$/g,'');}}catch{}}
}
const base=process.env.TESLAMATE_BASE_URL??'https://teslamate.example.invalid';
const internal=process.env.TESLAMATE_INTERNAL_URL;
const port=Number(process.env.PORT??5180),host=process.env.HOST??'127.0.0.1';
const key=process.env.AMAP_KEY??'',jscode=process.env.AMAP_SECURITY_CODE??'';
let authorization=process.env.TESLAMATE_AUTHORIZATION??'';
if(process.env.TESLAMATE_AUTHORIZATION_FILE){try{authorization=(await readFile(process.env.TESLAMATE_AUTHORIZATION_FILE,'utf8')).trim();}catch{console.error('Unable to read configured authorization file.');}}
const authMode=process.env.SITE_AUTH_MODE??'legacy';
if(!['legacy','forward-auth'].includes(authMode))throw new Error('Invalid site authentication mode.');
const publicOrigin=process.env.SITE_PUBLIC_ORIGIN?siteOrigin(process.env.SITE_PUBLIC_ORIGIN):'';
const trustedIPs=proxyIPs(process.env.TRUSTED_PROXY_IPS),allowedLogin=process.env.TAILSCALE_ALLOWED_LOGIN??'';
const trusted=process.env.TRUST_TAILSCALE_PROXY==='true';
let proxyToken=process.env.SITE_AUTH_PROXY_TOKEN??'';
if(process.env.SITE_AUTH_PROXY_TOKEN_FILE)proxyToken=(await readFile(process.env.SITE_AUTH_PROXY_TOKEN_FILE,'utf8')).trim();
const forwardAuth={ips:trustedIPs,user:process.env.SITE_AUTH_ALLOWED_USER??'',token:proxyToken,origin:publicOrigin};
if(authMode==='forward-auth'&&(!publicOrigin||!forwardAuth.user||trustedIPs.size===0||proxyToken.length<32||/[\r\n]/.test(proxyToken)))throw new Error('Forward authentication requires an HTTPS origin, user, explicit proxy IPs and a strong proxy credential.');
if(authMode==='legacy'&&trusted&&trustedIPs.size===0)throw new Error('Tailscale proxy authentication requires explicit trusted IPs.');
const secureCookie=process.env.SESSION_COOKIE_SECURE!=='false';
if(!secureCookie&&(!loopback(host)||process.env.NODE_ENV==='production'))throw new Error('Insecure cookies are only permitted for local development.');
const ttl=positiveInteger(process.env.SESSION_TTL_SECONDS,28800,86400)*1000;
const idle=positiveInteger(process.env.SESSION_IDLE_SECONDS,1800,86400)*1000;
const sessions=new Map(),scope=createHash('sha256').update(base).digest('hex').slice(0,16);
const loginBudget=new Budget(10),vehicleBudget=new Budget(240);
const mapMinuteBudget=new Budget(positiveInteger(process.env.MAP_RATE_PER_MINUTE,30,60));
const mapDailyBudget=new Budget(positiveInteger(process.env.MAP_DAILY_LIMIT,200,500),86400000);
const allowed=/^(cars(?:\/\d+(?:\/(?:status|battery-health|updates|drives(?:\/\d+)?|charges(?:\/(?:current|\d+))?))?)?|globalsettings)$/;
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.glb':'model/gltf-binary','.hdr':'application/octet-stream'};
const json=(res,status,payload)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));};
function sessionID(req){const entries=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith('modelymate_session='));if(entries.length!==1)return null;const id=entries[0].slice(19);return /^[a-f0-9]{64}$/.test(id)?id:null;}
function session(req){const id=sessionID(req),s=sessions.get(id),now=Date.now();if(s&&s.expires>now&&s.seen+idle>now){s.seen=now;return s;}if(id)sessions.delete(id);return null;}
function bearer(req){
  if(authMode==='forward-auth')return verifyForwardAuth(req,forwardAuth)?authorization:'';
  const s=session(req);if(s)return s.authorization;
  if(trusted&&allowedLogin&&trustedIPs.has(peerIP(req.socket.remoteAddress))&&req.headers['tailscale-user-login']===allowedLogin)return authorization;
  return '';
}
function cookie(value,maxAge){return 'modelymate_session='+value+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+maxAge+(secureCookie?'; Secure':'');}
function rejectRate(res){res.setHeader('Retry-After','60');return json(res,429,{error:'请求过于频繁，请稍后重试。'});}
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)throw new Error('too large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
export function normalizeBase(input){const u=new URL(input);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw new Error('Invalid HTTPS endpoint.');u.pathname=u.pathname.replace(/\/+$/,'').replace(/\/api(?:\/v1)?$/,'')+'/api/v1/';return u;}
normalizeBase(base);
function upstream(tail){if(!internal)return new URL(tail,normalizeBase(base));const u=new URL(internal);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new Error('Invalid configured upstream.');u.pathname=u.pathname.replace(/\/+$/,'').replace(/\/api(?:\/v1)?$/,'')+'/api/v1/';return new URL(tail,u);}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','SAMEORIGIN');
  try{
    const url=new URL(req.url,'http://localhost'),p=url.pathname;
    // Public mode has no legacy-cookie or unsigned Tailscale-header fallback.
    if(authMode==='forward-auth'&&!verifyForwardAuth(req,forwardAuth))return json(res,401,{error:'请先登录网站并完成验证。'});
    if(/^\/(?:api(?:\/|$)|grafana(?:\/|$)|mqtt(?:\/|$)|internal(?:\/|$)|auth(?:\/|$))/.test(p))return json(res,404,{error:'此入口不可用。'});
    if(p==='/pwa-api/config'&&req.method==='GET')return json(res,200,{amapKey:key,amapReady:!!key&&!!jscode,backendConfigured:!!authorization,authenticated:authMode==='forward-auth'||!!bearer(req),scope,baseURL:base,authMode,loginURL:authMode==='forward-auth'?'/auth/':'',logoutURL:authMode==='forward-auth'?'/auth/logout':''});
    if(p==='/pwa-api/session'&&authMode==='forward-auth')return json(res,405,{error:'请在网站登录页管理会话。'});
    if(p==='/pwa-api/session'&&req.method==='POST'){
      if(!sameOrigin(req,publicOrigin||(secureCookie?'https://':'http://')+req.headers.host))return json(res,403,{error:'访问来源不正确。'});
      if(!loginBudget.take())return rejectRate(res);
      if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'请求格式不正确。'});
      let input;try{input=await body(req);}catch{return json(res,400,{error:'请求内容不正确。'});}
      const auth=String(input?.authorization??'').trim();
      if(!auth || /[\r\n]/.test(auth) || auth.length>4096)return json(res,400,{error:'请输入完整认证信息。'});
      const target=upstream('cars'),response=await fetch(target,{headers:{Authorization:auth,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(25000)});
      if(!response.ok)return json(res,response.status,{error:'连接验证失败。'});
      const payload=JSON.parse((await boundedResponse(response,1048576)).toString('utf8'));if(payload.error || !Array.isArray(payload.data?.cars))return json(res,502,{error:'服务返回的数据不正确。'});
      sessions.delete(sessionID(req));
      for(const[id,s]of sessions)if(s.expires<=Date.now()||s.seen+idle<=Date.now())sessions.delete(id);
      if(sessions.size>=128)return json(res,503,{error:'会话暂时已满，请稍后重试。'});
      const id=randomBytes(32).toString('hex'),now=Date.now();sessions.set(id,{authorization:auth,expires:now+ttl,seen:now});
      res.setHeader('Set-Cookie',cookie(id,ttl/1000));
      return json(res,200,{ok:true});
    }
    if(p==='/pwa-api/session'&&req.method==='DELETE'){
      if(!sameOrigin(req,publicOrigin||(secureCookie?'https://':'http://')+req.headers.host))return json(res,403,{error:'访问来源不正确。'});
      sessions.delete(sessionID(req));res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true});
    }
    if(p.startsWith('/pwa-api/teslamate/')){
      if(req.method!=='GET')return json(res,405,{error:'不支持此操作。'});
      const tail=p.slice('/pwa-api/teslamate/'.length);if(!allowed.test(tail))return json(res,403,{error:'不支持此数据路径。'});
      const auth=bearer(req);if(!auth)return json(res,401,{error:'请先连接你的 TeslaMate 服务。'});
      if(!vehicleBudget.take())return rejectRate(res);
      const target=upstream(tail);for(const k of ['page','show','startDate','endDate']){if(url.searchParams.has(k))target.searchParams.set(k,url.searchParams.get(k));}
      const response=await fetch(target,{headers:{Authorization:auth,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(25000)});
      if(!response.headers.get('content-type')?.includes('json'))return json(res,502,{error:'车辆服务暂时没有返回有效数据。'});
      const payload=JSON.parse((await boundedResponse(response,32*1048576)).toString('utf8'));return json(res,response.status,payload);
    }
    if(p.startsWith('/_AMapService/')){
      if(req.method!=='GET')return json(res,405,{error:'不支持此操作。'});
      if(!bearer(req))return json(res,401,{error:'请先登录后使用地图。'});
      if(!key||!jscode)return json(res,503,{error:'地图尚未配置。'});
      let target;try{target=mapTarget(p.slice('/_AMapService/'.length),url.searchParams);}catch{return json(res,400,{error:'不支持此地图请求。'});}
      if(!mapMinuteBudget.take()||!mapDailyBudget.take())return rejectRate(res);
      target.searchParams.set('key',key);target.searchParams.set('jscode',jscode);
      const response=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(12000)}),data=await boundedResponse(response,2*1048576);
      const callback=url.searchParams.get('callback');
      res.writeHead(response.status,{'content-type':callback?'application/javascript; charset=utf-8':'application/json; charset=utf-8','cache-control':'no-store'});return res.end(data);
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'不支持此操作。'});
    let filename=path.resolve(root,'dist','.'+decodeURIComponent(p));const publicRoot=path.resolve(root,'dist');
    if(!filename.startsWith(publicRoot+path.sep)&&filename!==publicRoot)return json(res,403,{error:'访问被拒绝。'});
    let info;try{info=await stat(filename);if(info.isDirectory())throw new Error();}catch{filename=path.join(publicRoot,'index.html');info=await stat(filename);}
    const type=mime[path.extname(filename)]??'application/octet-stream',immutable=p.startsWith('/assets/')&&/[-.][\w-]{8,}\./.test(p);
    res.setHeader('Content-Type',type);res.setHeader('Cache-Control',p==='/sw.js'?'no-cache':immutable?'private, max-age=31536000, immutable':'no-cache');
    if(req.method==='HEAD'){res.writeHead(200);return res.end();}
    if(req.headers['accept-encoding']?.includes('gzip')){try{await stat(filename+'.gz');res.setHeader('Content-Encoding','gzip');res.setHeader('Vary','Accept-Encoding');res.writeHead(200);return createReadStream(filename+'.gz').pipe(res);}catch{}}
    res.writeHead(200);createReadStream(filename).pipe(res);
  }catch(error){json(res,502,{error:error?.name==='TimeoutError'?'连接超时，请重试。':'服务暂时无法访问，请检查连接。'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;
if(process.env.NODE_ENV!=='test'){server.listen(port,host,()=>console.log('ModelYMate PWA http://'+host+':'+server.address().port));const timer=setInterval(()=>{for(const[id,s]of sessions)if(s.expires<Date.now()||s.seen+idle<Date.now())sessions.delete(id);},60000);timer.unref();}
export {server};
