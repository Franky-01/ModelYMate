import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
let processHandle,upstream,base;
const calls=[];
before(async()=>{
 upstream=http.createServer((req,res)=>{calls.push({url:req.url,auth:req.headers.authorization});res.setHeader('content-type','application/json');if(req.headers.authorization!=='Bearer test-only')return res.writeHead(401).end('{"error":"unauthorized"}');res.end(JSON.stringify({data:{cars:[{car_id:1}]}}));});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','Path'])if(process.env[key])env[key]=process.env[key];
 processHandle=spawn(process.execPath,['server/server.mjs'],{env:{...env,MODELYMATE_SKIP_ENV_FILES:'true',SITE_AUTH_MODE:'legacy',SESSION_COOKIE_SECURE:'true',NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',TESLAMATE_BASE_URL:'https://private.example',TESLAMATE_INTERNAL_URL:`http://127.0.0.1:${upstream.address().port}`,TESLAMATE_AUTHORIZATION:'Bearer test-only',TESLAMATE_AUTHORIZATION_FILE:'',TRUST_TAILSCALE_PROXY:'true',TRUSTED_PROXY_IPS:'127.0.0.1',TAILSCALE_ALLOWED_LOGIN:'owner-test',AMAP_KEY:'public-test-key',AMAP_SECURITY_CODE:'server-only-test-code'},stdio:['ignore','pipe','pipe']});
 // The app emits its chosen port for the test harness.
 const address=await new Promise((resolve,reject)=>{processHandle.stdout.on('data',b=>{const match=String(b).match(/127\.0\.0\.1:(\d+)/);if(match)resolve(match[1]);});processHandle.on('exit',code=>reject(new Error('server exited '+code)));});base=`http://127.0.0.1:${address}`;
});
after(async()=>{processHandle?.kill();await new Promise(r=>upstream.close(r));});
test('configuration never returns server map secret or upstream authorization',async()=>{const r=await fetch(base+'/pwa-api/config'),text=await r.text(),j=JSON.parse(text);assert.equal(j.authenticated,false);assert.equal(j.amapReady,true);assert(!text.includes('server-only-test-code'));assert(!text.includes('test-only'));});
test('only matching owner identity can read telemetry through trusted proxy',async()=>{for(const login of [null,'someone-else']){const r=await fetch(base+'/pwa-api/teslamate/cars',{headers:login?{'tailscale-user-login':login}:{}});assert.equal(r.status,401);}const r=await fetch(base+'/pwa-api/teslamate/cars',{headers:{'tailscale-user-login':'owner-test'}});assert.equal(r.status,200);assert.equal((await r.json()).data.cars[0].car_id,1);});
test('whitelist rejects vehicle commands, global arbitrary routes, and all mutations',async()=>{const headers={'tailscale-user-login':'owner-test'};for(const p of ['cars/1/wake_up','cars/1/command/unlock','http://example.com','cars/1/../token']){const r=await fetch(base+'/pwa-api/teslamate/'+p,{headers});assert.equal(r.status,403);}assert.equal((await fetch(base+'/pwa-api/teslamate/cars',{method:'POST',headers})).status,405);});
test('client cannot override configured upstream and auth stays server-side',async()=>{const r=await fetch(base+'/pwa-api/teslamate/cars?page=2&show=50&baseURL=https://evil.example',{headers:{'tailscale-user-login':'owner-test'}});assert.equal(r.status,200);const last=calls.at(-1);assert.equal(last.url,'/api/v1/cars?page=2&show=50');assert.equal(last.auth,'Bearer test-only');});
test('session verifies origin and credentials; cookie is opaque HttpOnly Secure and logout removes access',async()=>{
 const bad=await fetch(base+'/pwa-api/session',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify({authorization:'Bearer test-only'})});assert.equal(bad.status,403);
 const r=await fetch(base+'/pwa-api/session',{method:'POST',headers:{'content-type':'application/json','x-forwarded-proto':'https'},body:JSON.stringify({authorization:'Bearer test-only'})});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Secure/);assert(!cookie.includes('test-only'));const headers={cookie:cookie.split(';')[0]};assert.equal((await fetch(base+'/pwa-api/teslamate/cars',{headers})).status,200);await fetch(base+'/pwa-api/session',{method:'DELETE',headers});assert.equal((await fetch(base+'/pwa-api/teslamate/cars',{headers})).status,401);
});
