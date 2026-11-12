import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fixtureEnv} from './fixture-env.mjs';

const origin='https://car.fixture.example:8443',owner='fixture-owner',proxyToken='fixture-proxy-credential-for-local-tests-only';
const headers={host:new URL(origin).host,'x-forwarded-proto':'https','x-modelymate-user':owner,'x-modelymate-proxy-token':proxyToken};
const readPaths=['cars','cars/1','cars/1/status','cars/1/battery-health','cars/1/updates','cars/1/drives','cars/1/drives/1','cars/1/charges','cars/1/charges/current','cars/1/charges/1','globalsettings'];

async function fixture(t,overrides={}) {
  const calls=[];
  const upstream=http.createServer((req,res)=>{
    calls.push({url:req.url,authorization:req.headers.authorization});
    res.setHeader('content-type','application/json');
    if(req.headers.authorization!=='Bearer fixture-only')return res.writeHead(401).end('{}');
    res.end(JSON.stringify({data:{cars:[{car_id:1,name:'Simulated Model Y'}]}}));
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const env=fixtureEnv({SITE_AUTH_MODE:'forward-auth',SITE_PUBLIC_ORIGIN:origin,SITE_AUTH_ALLOWED_USER:owner,
    SITE_AUTH_PROXY_TOKEN:proxyToken,TRUSTED_PROXY_IPS:'127.0.0.1',
    TESLAMATE_INTERNAL_URL:'http://127.0.0.1:'+upstream.address().port,...overrides});
  const child=spawn(process.execPath,['--import',new URL('./map-fetch-fixture.mjs',import.meta.url).href,'server/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
  t.after(async()=>{
    if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
    upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));
  });
  const port=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Local fixture did not start')),6000);
    child.stdout.on('data',bytes=>{const match=String(bytes).match(/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timeout);resolve(Number(match[1]));}});
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Fixture exited: '+code));});
  });
  function request(target,{method='GET',headers:requestHeaders={},body,localAddress='127.0.0.1'}={}){
    return new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port,path:target,method,headers:body===undefined?requestHeaders:{'content-length':Buffer.byteLength(body),...requestHeaders},localAddress},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString('utf8')}));
      });
      req.setTimeout(5000,()=>req.destroy(new Error('Local request timeout')));req.on('error',reject);req.end(body);
    });
  }
  return {request,calls,port,child};
}

test('public mode gates shell, config, service worker, model, map and all 11 telemetry paths',async t=>{
  const f=await fixture(t);
  for(const path of ['/','/manifest.webmanifest','/sw.js','/assets/vehicle.glb','/pwa-api/config','/_AMapService/v3/geocode/regeo?location=121,31',
    ...readPaths.map(path=>'/pwa-api/teslamate/'+path)]){
    for(const forgery of [{},{cookie:'modelymate_session='+'a'.repeat(64)},
      {'tailscale-user-login':owner,'remote-user':owner,'cf-access-authenticated-user-email':owner},
      {'x-modelymate-user':owner,'x-forwarded-for':'127.0.0.1','x-forwarded-proto':'https'}]){
      const r=await f.request(path,{headers:forgery});assert.equal(r.status,401,path);assert.equal(r.headers['cache-control'],'no-store');
    }
  }
  assert.equal(f.calls.length,0);
});
test('proxy proof requires exact owner, credential, source IP, HTTPS metadata and origin host',async t=>{
  const f=await fixture(t);
  for(const changed of [{'x-modelymate-user':'someone-else'},{'x-modelymate-proxy-token':'forged'},
    {'x-forwarded-proto':'http'},{host:'evil.example'},{'x-modelymate-user':owner+',another'}]){
    assert.equal((await f.request('/pwa-api/teslamate/cars',{headers:{...headers,...changed}})).status,401);
  }
  assert.equal((await f.request('/pwa-api/teslamate/cars',{headers,localAddress:'127.0.0.2'})).status,401);
  assert.equal(f.calls.length,0);
  assert.equal((await f.request('/pwa-api/teslamate/cars',{headers})).status,200);
  assert.equal(f.calls[0].authorization,'Bearer fixture-only');
});
test('verified owner retains every read route and cannot change backend or credential',async t=>{
  const f=await fixture(t);
  for(const path of readPaths)assert.equal((await f.request('/pwa-api/teslamate/'+path,{headers})).status,200);
  await f.request('/pwa-api/teslamate/cars?page=2&show=50&baseURL=https://evil.example&authorization=forged',{headers});
  assert.equal(f.calls.at(-1).url,'/api/v1/cars?page=2&show=50');
  const config=await f.request('/pwa-api/config',{headers});
  assert.equal(JSON.parse(config.text).authMode,'forward-auth');
  for(const secret of [proxyToken,'fixture-only-map-code','Bearer fixture-only'])assert(!config.text.includes(secret));
});
test('public mode disables legacy credential login and cannot route original API or Grafana',async t=>{
  const f=await fixture(t);
  for(const method of ['POST','PUT','PATCH','DELETE']){
    assert.equal((await f.request('/pwa-api/teslamate/cars',{method,headers})).status,405);
  }
  for(const method of ['POST','DELETE']){
    assert.equal((await f.request('/pwa-api/session',{method,headers,body:'{"authorization":"Bearer fixture-only"}'})).status,405);
  }
  for(const path of ['/api/v1/cars','/grafana/','/mqtt/','/auth/','/internal/authz']){
    assert.equal((await f.request(path,{headers})).status,404);
  }
  assert.equal(f.calls.length,0);
});
test('map authentication and precise policies reject nonessential services and malformed parameters',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/_AMapService/v3/geocode/regeo?location=121,31')).status,401);
  for(const path of ['toString','constructor','v3/geocode/regeo?location=121,31&constructor=value',
    'v3/weather/weatherInfo?city=1','v3/place/text?keywords=anything','v3/geocode/regeo?location=999,31',
    'v3/geocode/regeo?location=121,31&location=122,32','v3/geocode/regeo?location=121,31&callback=alert(1)',
    'v3/geocode/regeo?location=121,31&url=https://evil.example','v3/direction/driving?origin=121,31']){
    assert.equal((await f.request('/_AMapService/'+path,{headers})).status,400,path);
  }
  const r=await f.request('/_AMapService/v3/geocode/regeo?location=121,31&extensions=base&key=forged&jscode=forged',{headers});
  assert.equal(r.status,200);assert.equal(JSON.parse(r.text).serverCredentials,true);assert.equal(r.headers['cache-control'],'no-store');
  assert.equal((await f.request('/_AMapService/v3/direction/driving?origin=121,31&destination=121.1,31.1&strategy=2',{headers})).status,200);
  assert.equal((await f.request('/_AMapService/v4/map/styles?styleid=dark',{headers})).status,200);
});
test('map minute and daily ceilings cannot be reset by forged forwarded IPs',async t=>{
  const f=await fixture(t,{MAP_RATE_PER_MINUTE:'2'});
  const path='/_AMapService/v3/geocode/regeo?location=121,31';
  for(let i=0;i<2;i++)assert.equal((await f.request(path,{headers})).status,200);
  const r=await f.request(path,{headers:{...headers,'x-forwarded-for':'203.0.113.99'}});
  assert.equal(r.status,429);assert.equal(r.headers['retry-after'],'60');
  const daily=await fixture(t,{MAP_DAILY_LIMIT:'1'});
  assert.equal((await daily.request(path,{headers})).status,200);
  assert.equal((await daily.request(path,{headers})).status,429);
});
test('map response streams have a size ceiling; safe JSONP remains compatible',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/_AMapService/v3/geocode/regeo?location=121,31&appname=oversized',{headers})).status,502);
  const r=await f.request('/_AMapService/v3/geocode/regeo?location=121,31&callback=AMap.cb1',{headers});
  assert.equal(r.status,200);assert.match(r.headers['content-type'],/javascript/);assert.match(r.text,/^AMap\.cb1\(/);
});
test('simulated MFA gateway refuses anonymous, first factor, expired, revoked and stale sessions',async t=>{
  const f=await fixture(t);
  const states=new Map([['ready','two_factor'],['password','one_factor'],['expired','expired'],['revoked','revoked'],['wrong-user','other_user']]);
  const gateway=http.createServer(async(req,res)=>{
    const id=(req.headers.cookie??'').match(/fixture_sso=([^;]+)/)?.[1];
    if(states.get(id)!=='two_factor')return res.writeHead(401,{'cache-control':'no-store'}).end('{}');
    // Only gateway-owned proof is forwarded; every client identity header is replaced.
    const response=await f.request(req.url,{headers});res.writeHead(response.status,response.headers);res.end(response.text);
  });
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));});
  const address='http://127.0.0.1:'+gateway.address().port;
  for(const id of ['absent','password','expired','revoked','wrong-user']){
    const r=await fetch(address+'/pwa-api/teslamate/cars',{headers:{cookie:'fixture_sso='+id,...headers}});
    assert.equal(r.status,401,id);
  }
  assert.equal(f.calls.length,0);
  assert.equal((await fetch(address+'/pwa-api/teslamate/cars',{headers:{cookie:'fixture_sso=ready','x-modelymate-user':'forged'}})).status,200);
  states.set('ready','revoked');
  assert.equal((await fetch(address+'/pwa-api/teslamate/cars',{headers:{cookie:'fixture_sso=ready'}})).status,401);
});
test('legacy secure cookie is independent of forwarded protocol; logout uses identical protections',async t=>{
  const f=await fixture(t,{SITE_AUTH_MODE:'legacy'});
  const r=await f.request('/pwa-api/session',{method:'POST',headers:{'content-type':'application/json','x-forwarded-proto':'http'},body:'{"authorization":"Bearer fixture-only"}'});
  assert.equal(r.status,200);const cookie=r.headers['set-cookie'][0];
  assert.match(cookie,/HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800; Secure/);
  const sessionHeaders={cookie:cookie.split(';')[0]};
  assert.equal((await f.request('/pwa-api/teslamate/cars',{headers:sessionHeaders})).status,200);
  assert.equal((await f.request('/pwa-api/session',{method:'DELETE',headers:{...sessionHeaders,origin:'https://evil.example'}})).status,403);
  const logout=await f.request('/pwa-api/session',{method:'DELETE',headers:sessionHeaders});
  assert.match(logout.headers['set-cookie'][0],/Max-Age=0; Secure/);
  assert.equal((await f.request('/pwa-api/teslamate/cars',{headers:sessionHeaders})).status,401);
});
test('legacy expiry, idle timeout, reauthentication rotation and process restart invalidate cookies',async t=>{
  const f=await fixture(t,{SITE_AUTH_MODE:'legacy',SESSION_TTL_SECONDS:'2',SESSION_IDLE_SECONDS:'1'});
  async function login(cookie=''){
    const r=await f.request('/pwa-api/session',{method:'POST',headers:{'content-type':'application/json',cookie},body:'{"authorization":"Bearer fixture-only"}'});
    assert.equal(r.status,200);return r.headers['set-cookie'][0].split(';')[0];
  }
  const old=await login(),current=await login(old);
  assert.equal((await f.request('/pwa-api/teslamate/cars',{headers:{cookie:old}})).status,401);
  await new Promise(resolve=>setTimeout(resolve,1100));
  assert.equal((await f.request('/pwa-api/teslamate/cars',{headers:{cookie:current}})).status,401);
  const active=await login();
  for(let i=0;i<3;i++){await new Promise(resolve=>setTimeout(resolve,700));const status=(await f.request('/pwa-api/teslamate/cars',{headers:{cookie:active}})).status;assert.equal(status,i<2?200:401);}
  const restart=await fixture(t,{SITE_AUTH_MODE:'legacy'});
  assert.equal((await restart.request('/pwa-api/teslamate/cars',{headers:{cookie:await login()}})).status,401);
});
test('legacy login limits failed attempts and rejects malformed/cross-site session requests',async t=>{
  const f=await fixture(t,{SITE_AUTH_MODE:'legacy'});
  assert.equal((await f.request('/pwa-api/session',{method:'POST',headers:{origin:'not-a-url'},body:'{}'})).status,403);
  assert.equal((await f.request('/pwa-api/session',{method:'POST',headers:{'sec-fetch-site':'cross-site'},body:'{}'})).status,403);
  for(let i=0;i<10;i++)assert.equal((await f.request('/pwa-api/session',{method:'POST',headers:{'content-type':'application/json'},body:'{"authorization":"Bearer wrong"}'})).status,401);
  assert.equal((await f.request('/pwa-api/session',{method:'POST',headers:{'content-type':'application/json'},body:'{"authorization":"Bearer fixture-only"}'})).status,429);
});
