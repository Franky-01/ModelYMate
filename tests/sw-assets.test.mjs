import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
const source=await fs.readFile(new URL('../public/sw.js',import.meta.url),'utf8');
const expected={'/assets/vehicle.glb':'fictional-current-model','/assets/Atelier.hdr':'fictional-current-light','/assets/vehicle.audit.json':'fictional-current-audit','/assets/vehicles/modelx-2020/model.glb':'fictional-x','/assets/vehicles/model3-2024/model.glb':'fictional-3'};
const hashes=Object.fromEntries(Object.entries(expected).map(([url,bytes])=>[url,createHash('sha256').update(bytes).digest('hex')]));
const key=r=>new URL(typeof r==='string'?r:r.url,'https://fixture.invalid').pathname;
async function fixture(options={}){
 const stores=options.stores??new Map(),handlers={},reads=[],blockedWrites=options.blockedWrites??new Set(),pending=new Set();let offline=options.offline??false;
 const caches={keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),open:async name=>{if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return{match:async request=>data.get(key(request))?.clone(),put:async(request,response)=>{if(blockedWrites.has(name))throw new DOMException('Cache quota exceeded','QuotaExceededError');data.set(key(request),response.clone());}};}};
 const patched=source.replace(/const VERSION='[^']+';/,"const VERSION='modelymate-pwa-new';").replace(/const ASSET_CACHE='[^']+';/,"const ASSET_CACHE='modelymate-assets-v1-current';").replace(/const ASSET_DIGESTS=\{[^\n]*\};/,`const ASSET_DIGESTS=${JSON.stringify(hashes)};`);
 vm.runInNewContext(patched,{self:{location:new URL('https://fixture.invalid'),addEventListener:(name,handler)=>handlers[name]=handler,clients:{claim:async()=>{}}},caches,crypto:webcrypto,URL,Uint8Array,fetch:async request=>{reads.push(key(request));if(offline)throw new Error('offline');return new Response(expected[key(request)]??'other');}});
 const waitUntil=promise=>{pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));};
 return{caches,stores,handlers,reads,blockedWrites,setOffline:value=>offline=value,idle:async()=>{while(pending.size)await Promise.all([...pending]);},activate:async()=>{let work;handlers.activate({waitUntil:p=>work=p});await work;},fetch:async url=>{let response;handlers.fetch({request:new Request('https://fixture.invalid'+url),respondWith:p=>response=p,waitUntil});return response?await response:null;}};
}
test('SW upgrades copy only matching model bytes before retiring the old app cache',async()=>{
 const f=await fixture(),old=await f.caches.open('modelymate-pwa-old'),unrelated=await f.caches.open('other-app');
 await old.put('/assets/vehicle.glb',new Response(expected['/assets/vehicle.glb']));await old.put('/assets/Atelier.hdr',new Response('different old light bytes'));await unrelated.put('/assets/vehicle.audit.json',new Response(expected['/assets/vehicle.audit.json']));
 await f.activate();const current=await f.caches.open('modelymate-assets-v1-current');
 assert.equal(await (await current.match('/assets/vehicle.glb')).text(),expected['/assets/vehicle.glb']);assert.equal(await current.match('/assets/Atelier.hdr'),undefined);assert.equal(await current.match('/assets/vehicle.audit.json'),undefined);
 assert.equal(f.stores.has('modelymate-pwa-old'),false);assert.equal(f.stores.has('other-app'),true);assert.deepEqual(f.reads,[]);
 assert.equal(await (await f.fetch('/assets/vehicle.glb')).text(),expected['/assets/vehicle.glb']);assert.deepEqual(f.reads,[]);
 assert.equal(await (await f.fetch('/assets/Atelier.hdr')).text(),expected['/assets/Atelier.hdr']);assert.deepEqual(f.reads,['/assets/Atelier.hdr']);
});
test('SW leaves live APIs, authentication, map responses and non-GET requests outside caching',async()=>{
 const f=await fixture();for(const path of ['/pwa-api/teslamate/cars','/auth/login','/_AMapService/tile'])assert.equal(await f.fetch(path),null);
 let called=false;f.handlers.fetch({request:new Request('https://fixture.invalid/assets/vehicle.glb',{method:'POST'}),respondWith:()=>called=true});assert.equal(called,false);assert.deepEqual(f.reads,[]);
});

test('additional models remain on demand and retain independent cached bytes',async()=>{
 const f=await fixture();await f.activate();assert.deepEqual(f.reads,[]);
 const x='/assets/vehicles/modelx-2020/model.glb',three='/assets/vehicles/model3-2024/model.glb';
 assert.equal(await(await f.fetch(x)).text(),expected[x]);
 // Cache writes are queued after the response is served.
 await f.idle();
 assert.equal(await(await f.fetch(x)).text(),expected[x]);assert.deepEqual(f.reads,[x]);
 const cache=await f.caches.open('modelymate-assets-v1-current');assert.equal(await cache.match(three),undefined);
 assert.equal(await(await f.fetch(three)).text(),expected[three]);assert.deepEqual(f.reads,[x,three]);
});

test('quota failure retains identical old model bytes and cold workers read them offline',async()=>{
 const f=await fixture(),oldName='modelymate-assets-v1-previous',currentName='modelymate-assets-v1-current';
 const x='/assets/vehicles/modelx-2020/model.glb',three='/assets/vehicles/model3-2024/model.glb',old=await f.caches.open(oldName);
 await old.put(x,new Response(expected[x]));await old.put(three,new Response('obsolete different model bytes'));
 f.blockedWrites.add(currentName);await f.activate();
 assert.equal(f.stores.has(oldName),true,'a matching model must survive failed migration');
 assert.equal(await(await f.caches.open(currentName)).match(x),undefined);
 assert.deepEqual(f.reads,[],'migration must not download any unselected model');
 // A fresh VM has no migration bookkeeping from activate; only CacheStorage remains.
 const restarted=await fixture({stores:f.stores,blockedWrites:f.blockedWrites,offline:true});
 assert.equal(await(await restarted.fetch(x)).text(),expected[x]);await restarted.idle();
 assert.deepEqual(restarted.reads,[],'valid retained bytes are available with no network attempt');
 assert.equal(restarted.stores.has(oldName),true,'failed lazy promotion must not discard the old copy');
 await assert.rejects(restarted.fetch(three),/offline/,'mismatched bytes in that same retained cache must not be served');
 assert.deepEqual(restarted.reads,[three]);
 for(const pathname of ['/pwa-api/teslamate/cars','/auth/login','/_AMapService/tile'])assert.equal(await restarted.fetch(pathname),null);
});

test('retained models promote after space returns and stale current-cache bytes are rejected',async()=>{
 const x='/assets/vehicles/modelx-2020/model.glb',oldName='modelymate-assets-v1-previous',currentName='modelymate-assets-v1-current';
 const f=await fixture(),old=await f.caches.open(oldName),current=await f.caches.open(currentName);
 await old.put(x,new Response(expected[x]));await current.put(x,new Response('incorrect current-cache bytes'));
 f.setOffline(true);
 assert.equal(await(await f.fetch(x)).text(),expected[x]);await f.idle();
 assert.equal(await(await current.match(x)).text(),expected[x]);assert.deepEqual(f.reads,[]);
 await f.activate();assert.equal(f.stores.has(oldName),false,'only retire the old copy after a valid replacement exists');
 assert.equal(await(await f.fetch(x)).text(),expected[x]);
});

test('cache quota failures do not fail successful network responses or enqueue API writes',async()=>{
 const f=await fixture(),x='/assets/vehicles/modelx-2020/model.glb';
 f.blockedWrites.add('modelymate-assets-v1-current');f.blockedWrites.add('modelymate-pwa-new');
 assert.equal(await(await f.fetch(x)).text(),expected[x]);
 assert.equal(await(await f.fetch('/assets/app-test.js')).text(),'other');
 await f.idle();
 assert.equal(await(await f.caches.open('modelymate-assets-v1-current')).match(x),undefined);
 assert.equal(await(await f.caches.open('modelymate-pwa-new')).match('/assets/app-test.js'),undefined);
 assert.equal(await f.fetch('/pwa-api/config'),null);assert.deepEqual(f.reads,[x,'/assets/app-test.js']);
});
