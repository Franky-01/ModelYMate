import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
// Node strips TS but does not resolve Vite's extensionless imports. Transpile the
// actual API module and resolve its three local dependencies without a server.
let source=await fs.readFile(new URL('../src/api.ts',import.meta.url),'utf8');
for(const [from,to]of [['./request','../src/request.ts'],['./core.mjs','../src/core.mjs'],['./demo.mjs','../src/demo.mjs']])source=source.replace(`from '${from}'`,`from '${new URL(to,import.meta.url).href}'`);
const {makeAPI,getConfig}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('real API envelope with numeric SOC and range is preserved without inventing telemetry',async t=>{
 const data={status:{state:'asleep',battery_details:{battery_level:0,rated_battery_range:0}},units:{unit_of_length:'km'}};
 t.mock.method(globalThis,'fetch',async()=>response({data}));assert.deepEqual(await makeAPI(false)('cars/1/status'),data);
});
test('API never calls an error body or malformed envelope a successful read',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>response({error:'fixture unavailable'},503));
 await assert.rejects(makeAPI(false)('cars'),e=>e.kind==='http'&&e.status===503);
 fetch.mock.mockImplementation(async()=>response({error:'fixture error'}));await assert.rejects(makeAPI(false)('cars'),e=>e.kind==='service');
 fetch.mock.mockImplementation(async()=>response({cars:[]}));await assert.rejects(makeAPI(false)('cars'),e=>e.kind==='data');
});
test('no current charge is recognized only for expected statuses',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>response({error:'No current charge found.'},404));
 assert.deepEqual(await makeAPI(false)('cars/1/charges/current'),{charge:null});
 fetch.mock.mockImplementation(async()=>response({error:'No current charge found.'},503));await assert.rejects(makeAPI(false)('cars/1/charges/current'),e=>e.kind==='http');
});
test('configuration errors stay visible and a later request can recover',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>response({error:'fixture'},503));await assert.rejects(getConfig(),e=>e.kind==='http');
 fetch.mock.mockImplementation(async()=>response({data:{}}));await assert.rejects(getConfig(),e=>e.kind==='data');
 fetch.mock.mockImplementation(async()=>response({authenticated:true,backendConfigured:true,scope:'fixture-only'}));assert.equal((await getConfig()).scope,'fixture-only');
});
