import test from 'node:test';
import assert from 'node:assert/strict';
import {request,responseJSON,RequestFailure} from '../src/request.ts';

const json=()=>new Response('{"value":0}',{headers:{'content-type':'application/json'}});
const kind=expected=>error=>error instanceof RequestFailure&&error.kind===expected;

test('request works without AbortSignal.timeout and preserves actual zero',async t=>{
 t.mock.method(AbortSignal,'timeout',()=>{throw new Error('Unavailable browser API');});
 t.mock.method(globalThis,'fetch',async()=>json());
 assert.deepEqual(await request('/fictional',responseJSON),{value:0});
});
test('deadline bounds missing response headers and aborts the underlying request',async t=>{
 let signal;t.mock.method(globalThis,'fetch',async(_,init)=>{signal=init.signal;return new Promise(()=>{});});
 await assert.rejects(request('/fictional',responseJSON,{timeoutMs:15}),kind('timeout'));assert.equal(signal.aborted,true);
});
test('deadline includes a body stalled after HTTP 200 and still allows retry',async t=>{
 let stalled=true;t.mock.method(globalThis,'fetch',async()=>stalled?{ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:()=>new Promise(()=>{})}:json());
 await assert.rejects(request('/fictional',responseJSON,{timeoutMs:15}),kind('timeout'));stalled=false;
 assert.equal((await request('/fictional',responseJSON)).value,0);
});
test('caller cancellation is distinct from a timeout even when fetch ignores abort',async t=>{
 const controller=new AbortController();t.mock.method(globalThis,'fetch',async()=>new Promise(()=>{}));
 const pending=request('/fictional',responseJSON,{signal:controller.signal});controller.abort();await assert.rejects(pending,kind('cancelled'));
});
test('pre-cancelled reads never issue an HTTP request',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>json()),controller=new AbortController();controller.abort();
 await assert.rejects(request('/fictional',responseJSON,{signal:controller.signal}),kind('cancelled'));assert.equal(fetch.mock.callCount(),0);
});
test('Safari transport AbortError is an interruption, not caller cancellation',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new DOMException('Fetch is aborted','AbortError');});
 await assert.rejects(request('/fictional',responseJSON),error=>kind('interrupted')(error)&&/连接中断/.test(error.message));
});
test('connection failures, native timeouts, HTTP failures and invalid JSON remain distinct',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('Failed to fetch');});
 await assert.rejects(request('/fictional',responseJSON),kind('network'));
 fetch.mock.mockImplementation(async()=>{throw new DOMException('deadline','TimeoutError');});await assert.rejects(request('/fictional',responseJSON),kind('timeout'));
 fetch.mock.mockImplementation(async()=>new Response('<html>failure</html>',{status:503,headers:{'content-type':'text/html'}}));await assert.rejects(request('/fictional',responseJSON),e=>kind('http')(e)&&e.status===503);
 fetch.mock.mockImplementation(async()=>new Response('<html>wrong body</html>',{headers:{'content-type':'text/html'}}));await assert.rejects(request('/fictional',responseJSON),kind('data'));
 fetch.mock.mockImplementation(async()=>new Response('{broken',{headers:{'content-type':'application/json'}}));await assert.rejects(request('/fictional',responseJSON),kind('data'));
});
test('successful reads remove caller abort listeners and clear the deadline',async t=>{
 const controller=new AbortController(),add=t.mock.method(controller.signal,'addEventListener'),remove=t.mock.method(controller.signal,'removeEventListener');let internal;
 t.mock.method(globalThis,'fetch',async(_,init)=>{internal=init.signal;return json();});
 await request('/fictional',responseJSON,{signal:controller.signal,timeoutMs:15});assert.equal(add.mock.callCount(),1);assert.equal(remove.mock.callCount(),1);
 controller.abort();await new Promise(r=>setTimeout(r,25));assert.equal(internal.aborted,false);
});
test('wall clock deadline is checked after a suspended page resumes',async t=>{
 const events=new EventTarget();globalThis.window=events;t.after(()=>{delete globalThis.window;});let now=100;t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>new Promise(()=>{}));const pending=request('/fictional',responseJSON,{timeoutMs:25000});
 now+=26000;events.dispatchEvent(new Event('pageshow'));await assert.rejects(pending,kind('timeout'));
});
