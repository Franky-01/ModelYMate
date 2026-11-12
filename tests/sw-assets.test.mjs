import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
const source=await fs.readFile(new URL('../public/sw.js',import.meta.url),'utf8');
const expected={'/assets/vehicle.glb':'fictional-current-model','/assets/Atelier.hdr':'fictional-current-light','/assets/vehicle.audit.json':'fictional-current-audit'};
const hashes=Object.fromEntries(Object.entries(expected).map(([url,bytes])=>[url,createHash('sha256').update(bytes).digest('hex')]));
const key=r=>new URL(typeof r==='string'?r:r.url,'https://fixture.invalid').pathname;
async function fixture(){
 const stores=new Map(),handlers={},reads=[];
 const caches={keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),open:async name=>{if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return{match:async request=>data.get(key(request))?.clone(),put:async(request,response)=>data.set(key(request),response.clone())};}};
 const patched=source.replace(/const VERSION='[^']+';/,"const VERSION='modelymate-pwa-new';").replace(/const ASSET_CACHE='[^']+';/,"const ASSET_CACHE='modelymate-assets-v1-current';").replace(/const ASSET_DIGESTS=\{[^\n]*\};/,`const ASSET_DIGESTS=${JSON.stringify(hashes)};`);
 vm.runInNewContext(patched,{self:{location:new URL('https://fixture.invalid'),addEventListener:(name,handler)=>handlers[name]=handler,clients:{claim:async()=>{}}},caches,crypto:webcrypto,URL,Uint8Array,fetch:async request=>{reads.push(key(request));return new Response(expected[key(request)]??'other');}});
 return{caches,stores,handlers,reads,activate:async()=>{let work;handlers.activate({waitUntil:p=>work=p});await work;},fetch:async url=>{let response;handlers.fetch({request:new Request('https://fixture.invalid'+url),respondWith:p=>response=p});return response?await response:null;}};
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
