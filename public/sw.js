const VERSION='modelymate-pwa-991c5c9d7b6bdfaf';
const ASSET_CACHE='modelymate-assets-v1-1e754931fdae5b25';
const ASSET_DIGESTS={"/assets/Atelier.hdr":"727a0fbc11e55000658a8fbad36979b5ee7ce12accce45a0aa41f90b6324bac6","/assets/vehicle.glb":"1d0176ede3732815ecdbc0e5482ff055b8dd64cfb433487dcedb98d2ce2d39d7","/assets/vehicle.audit.json":"4ac4a7778eba543f72eb18ce179e63b4ca156d8bfd84ed7b8d837ba2bccd68c1","/assets/vehicles/model3-2018/LICENSE.md":"38b286ec996f4025afe65ae9dfef73006cfe36476e412da2da21984becdb278c","/assets/vehicles/model3-2018/model.glb":"ded7e293adc672053075f31102170c5e597c5bb5c90f4073194ce4fd4b13928c","/assets/vehicles/model3-2024/LICENSE.md":"daec91824b2b606f36fdc5f82b838b1f5d7239296e5e9cb5fdba05c6fb3718b4","/assets/vehicles/model3-2024/model.glb":"12d0c1a1fa68f227ef8fef812c7564b8e761002d70a63396cf608e57cde466f9","/assets/vehicles/models-2013/ATTRIBUTION.txt":"4f2020707a513d83984a58e163f8bcdf9ec95b75d2d2a3fc0febd16475c2c6ef","/assets/vehicles/models-2013/LICENSE.txt":"a71dd247d16e6f3d4efa126a07ee09858cd048583544610948b47dc7d18fb586","/assets/vehicles/models-2013/model.glb":"45a84ac0ebc3bb06cd681507ed095bf15a82f253e246a994689eeb33aecf6289","/assets/vehicles/models-2013/PROVENANCE.json":"21950c752e139c85752d0a7c68521f5684cc1c2660e70d1eb4da999c66d85fa9","/assets/vehicles/models-2021/ATTRIBUTION.txt":"a4ef87396218bf1aaa6ad45fc8395aa7d45a3a662572e37918f703d9b60df1ba","/assets/vehicles/models-2021/LICENSE.txt":"61394a5954c144b2f90d48dc51630a284dd7f9225c88b11b3649c2a066ff728b","/assets/vehicles/models-2021/model.glb":"aacb635327152c5e076265c57a584e30723a669f990d0771374cd6dc5017eb37","/assets/vehicles/models-2021/PROVENANCE.json":"c4108c16fc713d1d808467c949fa26302202011e7f456da8d43c387ab3196a4c","/assets/vehicles/modelx-2020/ATTRIBUTION.txt":"f55e48175002984b31b676038515212dfc60261fe4d3820388470d3ed2e2bf74","/assets/vehicles/modelx-2020/CC-BY-4.0.txt":"9e5f1b3c610b9c2da5c313bf81d577a7d1acec686bdb0384edefa6df0f90cd94","/assets/vehicles/modelx-2020/model.glb":"69ea9889fbb3d5c1b194aeecaf88a68b35d64acff602adc7808593d3ecfb0169","/assets/vehicles/modely-2021/ATTRIBUTION.txt":"5f87216cfa4b0066928df6da4a06fe7e215b74b0fb33044a6dc55ff64b20c553","/assets/vehicles/modely-2021/CC-BY-4.0.txt":"9e5f1b3c610b9c2da5c313bf81d577a7d1acec686bdb0384edefa6df0f90cd94","/assets/vehicles/modely-2021/model.glb":"6c0eb5be88e506ff8351503d3a2b5c5665350282315a4de02522ee468e4dbbbf"};
const ownCache=name=>name.startsWith('modelymate-pwa-')||name.startsWith('modelymate-assets-v1-');
const cacheable=response=>response.ok&&!response.redirected&&!/no-store/i.test(response.headers.get('cache-control')||'');
async function matchesDigest(response,expected){
 if(!response||!cacheable(response))return false;
 try{const digest=await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer());
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')===expected;
 }catch{return false;}
}
async function cachedResponse(name,request){
 try{return await(await caches.open(name)).match(request);}catch{return undefined;}
}
async function putResponse(name,request,response,expected){
 // Quota/storage failure must never replace a successful network response.
 try{if(expected&&!await matchesDigest(response,expected))return false;
  await(await caches.open(name)).put(request,response);return true;
 }catch{return false;}
}
function retainWork(event,promise){
 const work=promise.catch(()=>{});event.waitUntil?.(work);
}
async function previousAsset(url,expected,keys){
 // No in-memory migration state is needed: a newly started worker can recover
 // the identical bytes directly from a retained cache while completely offline.
 try{keys??=await caches.keys();}catch{return null;}
 for(const name of keys){
  if(name===ASSET_CACHE||!ownCache(name))continue;
  const response=await cachedResponse(name,url);
  if(await matchesDigest(response,expected))return{name,response};
 }
 return null;
}
async function migrateAssets(){
 const keys=await caches.keys(),retained=new Set();
 for(const [url,expected] of Object.entries(ASSET_DIGESTS)){
  if(await matchesDigest(await cachedResponse(ASSET_CACHE,url),expected))continue;
  const previous=await previousAsset(url,expected,keys);if(!previous)continue;
  // Keep the only usable copy if the new cache cannot accept it. Activation
  // may still complete; fetch can read this digest-checked old entry directly.
  if(!await putResponse(ASSET_CACHE,url,previous.response.clone(),expected))retained.add(previous.name);
 }
 return retained;
}

const SHELL=['/','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(async c=>{for(const url of SHELL){const r=await fetch(url,{redirect:'error'});if(r.ok&&!/no-store/i.test(r.headers.get('cache-control')||''))await c.put(url,r);}}));});
self.addEventListener('activate',event=>{event.waitUntil(migrateAssets().then(async retained=>{
 const keys=await caches.keys();await Promise.all(keys.filter(name=>ownCache(name)&&name!==VERSION&&name!==ASSET_CACHE&&!retained.has(name)).map(name=>caches.delete(name)));
 }).then(()=>self.clients.claim()));});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();if(event.data==='GET_VERSION')event.ports[0]?.postMessage({version:VERSION});});
self.addEventListener('fetch',event=>{
 const u=new URL(event.request.url);
 // API responses, auth, location requests and third-party map tiles are never persisted.
 if(event.request.method!=='GET'||u.origin!==self.location.origin||u.pathname==='/auth'||u.pathname.startsWith('/auth/')||u.pathname.startsWith('/pwa-api/')||u.pathname.startsWith('/_AMapService/'))return;
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).then(response=>{
  if(cacheable(response))retainWork(event,putResponse(VERSION,'/',response.clone()));return response;
 }).catch(()=>caches.match('/')));return;}
 if(u.pathname.startsWith('/assets/')||u.pathname.startsWith('/icons/'))event.respondWith((async()=>{
  const expected=Object.hasOwn(ASSET_DIGESTS,u.pathname)?ASSET_DIGESTS[u.pathname]:null,name=expected?ASSET_CACHE:VERSION;
  const cached=await cachedResponse(name,event.request);
  if(cached&&(!expected||await matchesDigest(cached,expected)))return cached;
  if(expected){
   const previous=await previousAsset(u.pathname,expected);
   if(previous){retainWork(event,putResponse(name,u.pathname,previous.response.clone(),expected));return previous.response;}
  }
  const response=await fetch(event.request);
  if(cacheable(response))retainWork(event,putResponse(name,event.request,response.clone(),expected));
  return response;
 })());
});
