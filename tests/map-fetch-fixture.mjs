// Test preload: only loopback traffic is real. All AMap traffic is replaced here.
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(['restapi.amap.com','webapi.amap.com'].includes(url.hostname)){
    if(url.searchParams.get('appname')==='oversized'){
      return Promise.resolve(new Response(new Uint8Array(2*1048576+1),{headers:{'content-type':'application/json'}}));
    }
    const body=JSON.stringify({mock:true,path:url.pathname,serverCredentials:
      url.searchParams.get('key')==='fixture-public-key'&&url.searchParams.get('jscode')==='fixture-only-map-code'});
    const callback=url.searchParams.get('callback');
    return Promise.resolve(new Response(callback?callback+'('+body+')':body,{headers:{'content-type':callback?'application/javascript':'application/json'}}));
  }
  if(url.hostname!=='127.0.0.1')throw new Error('External network disabled in test fixture.');
  return originalFetch(input,options);
};
