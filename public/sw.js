const VERSION='modelymate-pwa-2be79288def046d4';
const ASSET_CACHE='modelymate-assets-v1-a962e3713e1a5a41';
const ASSET_DIGESTS={"/assets/Atelier.hdr":"727a0fbc11e55000658a8fbad36979b5ee7ce12accce45a0aa41f90b6324bac6","/assets/vehicle.glb":"1d0176ede3732815ecdbc0e5482ff055b8dd64cfb433487dcedb98d2ce2d39d7","/assets/vehicle.audit.json":"4ac4a7778eba543f72eb18ce179e63b4ca156d8bfd84ed7b8d837ba2bccd68c1"};
async function migrateAssets(){
 const target=await caches.open(ASSET_CACHE),keys=await caches.keys();
 for(const [url,expected] of Object.entries(ASSET_DIGESTS)){
  if(await target.match(url))continue;
  for(const key of keys){
   if(key===ASSET_CACHE||!key.startsWith('modelymate-pwa-')&&!key.startsWith('modelymate-assets-v1-'))continue;
   const cached=await (await caches.open(key)).match(url);if(!cached)continue;
   // Fixed model URLs may change in a future release. Reuse only identical bytes.
   try{const bytes=await cached.clone().arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
    if(Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')===expected){await target.put(url,cached);break;}
   }catch{}
  }
 }
}

const SHELL=['/','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(async c=>{for(const url of SHELL){const r=await fetch(url,{redirect:'error'});if(r.ok&&!/no-store/i.test(r.headers.get('cache-control')||''))await c.put(url,r);}}));});
self.addEventListener('activate',event=>{event.waitUntil(migrateAssets().then(()=>caches.keys()).then(keys=>Promise.all(keys.filter(k=>(k.startsWith('modelymate-pwa-')&&k!==VERSION)||(k.startsWith('modelymate-assets-v1-')&&k!==ASSET_CACHE)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();if(event.data==='GET_VERSION')event.ports[0]?.postMessage({version:VERSION});});
self.addEventListener('fetch',event=>{
 const u=new URL(event.request.url);
 // API responses, auth, location requests and third-party map tiles are never persisted.
 if(event.request.method!=='GET'||u.origin!==self.location.origin||u.pathname==='/auth'||u.pathname.startsWith('/auth/')||u.pathname.startsWith('/pwa-api/')||u.pathname.startsWith('/_AMapService/'))return;
 const cacheable=r=>r.ok&&!r.redirected&&!/no-store/i.test(r.headers.get('cache-control')||'');
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).then(r=>{if(cacheable(r)){const copy=r.clone();caches.open(VERSION).then(c=>c.put('/',copy));}return r;}).catch(()=>caches.match('/')));return;}
 if(u.pathname.startsWith('/assets/')||u.pathname.startsWith('/icons/')){const name=Object.hasOwn(ASSET_DIGESTS,u.pathname)?ASSET_CACHE:VERSION;event.respondWith(caches.open(name).then(c=>c.match(event.request).then(cached=>cached||fetch(event.request).then(r=>{if(cacheable(r)){const copy=r.clone();caches.open(name).then(c=>c.put(event.request,copy));}return r;}))));}
});
