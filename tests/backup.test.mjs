import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKUP_KINDS, MAX_BACKUP_BYTES, RECOVERY_KEY, validateBackup, parseBackup, serializeBackup, createBackup, backupCounts, restoreBackup, recoverRestore, restoreSnapshotInfo, undoRestore, createBackupReader} from '../src/backup.mjs';

const key = kind => `modelymate.demo.1.${kind}`;
function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {data, operations:[], fail:null, getItem(k) { if(this.fail?.('get', k)) throw new Error('Storage unavailable'); return data.get(k) ?? null; }, setItem(k,v) { this.operations.push(['set',k]); if(this.fail?.('set', k)) throw new Error('QuotaExceededError'); data.set(k,String(v)); }, removeItem(k) { this.operations.push(['remove',k]); if(this.fail?.('remove', k)) throw new Error('Storage unavailable'); data.delete(k); }};
}
const envelope = data => ({format:'ModelYMate-local', version:1, scope:'demo', carID:1, exportedAt:'2026-10-15T12:00:00Z', data});
const contents = () => ({journals:{1:{category:'通勤',subcategory:'测试',note:'合成备注',driver:'甲'}}, costs:{2:{amount:0,currency:'CNY',source:'manual'},3:{amount:12.34,currency:'USD',source:'estimate',rate:.2,basis:'电网用电量'}}, rules:[{id:'r1',name:'测试站',latitude:31,longitude:121,radius:100,rate:.6,currency:'CNY',timezone:'Asia/Shanghai',periods:[{days:[1,2],start:1320,end:480,rate:.3}]}], trips:[{id:'t1',title:'测试旅途',note:'合成',driveIDs:[1,5,2]}], health:[{day:'2026-10-15',percentage:95.4,capacity:72.1}], automaticPricing:true, aliases:{'原始地点':'测试别名'}, drivers:['甲','乙']});

test('versioned backup round-trips every scoped data kind without global settings', () => {
  const values = contents(), s = storage(Object.fromEntries(Object.entries(values).map(([k,v])=>[key(k),JSON.stringify(v)])));
  s.setItem('modelymate.garage', '{"paint":"red"}');
  s.setItem('modelymate.other.2.journals', '{"7":{"note":"other car"}}');
  const b = parseBackup(serializeBackup(createBackup(s,'demo',1)));
  assert.deepEqual(b.data, values);
  assert.deepEqual(Object.keys(b.data), BACKUP_KINDS);
  assert.equal(backupCounts(b).find(v=>v.kind==='costs').count,2);
  assert.ok(!JSON.stringify(b).includes('other car'));
  assert.ok(!JSON.stringify(b).includes('paint'));
});
test('selected export does not read excluded damaged data and defaults only absent values', () => {
  const s = storage({[key('journals')]:'{broken',[key('drivers')]:'["甲"]'});
  assert.throws(()=>createBackup(s,'demo',1),/分类与备注无法读取/);
  assert.deepEqual(createBackup(s,'demo',1,['drivers','costs']).data,{drivers:['甲'],costs:{}});
  assert.equal(s.getItem(key('journals')),'{broken');
  assert.throws(()=>createBackup(s,'demo',1,[]),/范围/);
  assert.throws(()=>createBackup(s,'demo',1,['drivers','drivers']),/范围/);
});
test('invalid versions, ranges, unsafe keys, malformed values and JSON are rejected', () => {
  for (const invalid of [{...envelope({drivers:[]}),version:2},envelope({}),envelope({unknown:[]}),envelope({journals:{0:{note:'bad'}}}),envelope({costs:{1:{amount:-1,currency:'CNY'}}}),envelope({trips:[{id:'t',title:'Trip',driveIDs:[1,1]}]}),envelope({health:[{day:'2026-02-30',percentage:90}]}),envelope({health:[{day:'2026-99-01',percentage:90}]}),envelope({drivers:['甲','甲']}),envelope({aliases:{place:''}})]) assert.throws(()=>validateBackup(invalid));
  assert.throws(()=>parseBackup('{'),/JSON/);
  assert.throws(()=>parseBackup(JSON.stringify(envelope({journals:JSON.parse('{"1":{"__proto__":{"polluted":true}}}')}))),/不安全/);
  assert.equal({}.polluted,undefined);
  assert.deepEqual(parseBackup('\uFEFF'+JSON.stringify(envelope({drivers:[]}))).data,{drivers:[]});
});
test('rule validation rejects unnamed rules, bad timezones, null periods and overlap', () => {
  const rule = contents().rules[0];
  for (const changed of [{name:''},{timezone:''},{timezone:'Invalid/Test'},{periods:[null]},{periods:[rule.periods[0],rule.periods[0]]}]) assert.throws(()=>validateBackup(envelope({rules:[{...rule,...changed}]})));
});
test('UTF-8 byte limit applies to import, export and direct restore before mutation', () => {
  const b = envelope({journals:Object.fromEntries(Array.from({length:900},(_,i)=>[i+1,{note:'测'.repeat(2000)}]))});
  const raw = JSON.stringify(b);
  assert.ok(raw.length < MAX_BACKUP_BYTES);
  assert.ok(Buffer.byteLength(raw) > MAX_BACKUP_BYTES);
  assert.throws(()=>serializeBackup(b),/5 MB/);
  assert.throws(()=>parseBackup(raw),/5 MB/);
  const s = storage();assert.throws(()=>restoreBackup(s,b,'demo',1,['journals']),/5 MB/);assert.equal(s.operations.length,0);
});
test('partial restore preserves other cars, sources and ranges and can be undone after reload', () => {
  const original = '{ "7": {"note":"before"} }';
  const s = storage({[key('journals')]:original,[key('costs')]:'{}','modelymate.live.1.journals':'{"8":{}}','modelymate.demo.2.journals':'{"9":{}}'});
  assert.equal(restoreBackup(s,envelope(contents()),'demo',1,['journals','drivers']),2);
  assert.deepEqual(JSON.parse(s.getItem(key('journals'))),contents().journals);
  assert.equal(s.getItem(key('costs')),'{}');
  assert.equal(s.getItem('modelymate.live.1.journals'),'{"8":{}}');
  assert.equal(s.getItem('modelymate.demo.2.journals'),' {"9":{}}'.trim());
  assert.equal(s.getItem(RECOVERY_KEY),null);
  assert.deepEqual(restoreSnapshotInfo(s,'demo',1).kinds,['journals','drivers']);
  assert.equal(recoverRestore(s),false);
  assert.equal(undoRestore(s,'demo',1),2);
  assert.equal(s.getItem(key('journals')),original);
  assert.equal(s.getItem(key('drivers')),null);
  assert.equal(restoreSnapshotInfo(s,'demo',1),null);
  assert.throws(()=>undoRestore(s,'demo',1),/没有可以撤销/);
});
test('quota failure reserving recovery marker leaves all original bytes untouched', () => {
  const s = storage({[key('drivers')]:'["before"]'}), before = [...s.data];
  s.fail=(op,k)=>op==='set'&&k===RECOVERY_KEY;
  assert.throws(()=>restoreBackup(s,envelope({drivers:['after']}),'demo',1,['drivers']));
  assert.deepEqual([...s.data],before);
});
test('failure during any mutation or commit rolls back data and the preceding undo snapshot', () => {
  for (const failed of [key('journals'),key('drivers'),key('restoreUndo'),RECOVERY_KEY]) {
    const s = storage({[key('journals')]:'{"5":{}}',[key('drivers')]:'["before"]'});
    restoreBackup(s,envelope({drivers:['prior']}),'demo',1,['drivers']);
    const before = [...s.data].sort(), op = failed===RECOVERY_KEY?'remove':'set';
    let fired=false;
    s.fail=(operation,k)=>{if(!fired&&operation===op&&k===failed){fired=true;return true;}return false;};
    assert.throws(()=>restoreBackup(s,envelope({journals:{1:{note:'new'}},drivers:['after']}),'demo',1,['journals','drivers']),/已还原/);
    assert.equal(fired,true);
    assert.deepEqual([...s.data].sort(),before);
  }
});
test('persistent interruption retains durable marker and recovers exact values on next startup', () => {
  const s = storage({[key('journals')]:'{ "5": {} }',[key('drivers')]:'["before"]'});
  s.fail=(op,k)=>op==='set'&&k===key('drivers');
  assert.throws(()=>restoreBackup(s,envelope({journals:{1:{}},drivers:['after']}),'demo',1,['journals','drivers']),/恢复中断/);
  assert.ok(s.getItem(RECOVERY_KEY));
  assert.throws(()=>createBackup(s,'demo',1),/未完成/);
  s.fail=null;
  assert.equal(recoverRestore(s),true);
  assert.equal(s.getItem(key('journals')),'{ "5": {} }');assert.equal(s.getItem(key('drivers')),'["before"]');assert.equal(s.getItem(RECOVERY_KEY),null);
});
test('legacy interrupted records recover, but invalid records are rejected before any writes', () => {
  const s = storage({[key('journals')]:'{}',[RECOVERY_KEY]:JSON.stringify({entries:[[key('journals'),'{"1":{}}']]})});
  assert.equal(recoverRestore(s),true);assert.equal(s.getItem(key('journals')),'{"1":{}}');
  for (const entries of [[[key('journals'),'{}'],['modelymate.authMode','"x"']],[[key('journals'),'{}'],[key('journals'),null]],[[key('journals'),{}]]]) {
    const invalid = storage({[RECOVERY_KEY]:JSON.stringify({entries})});
    assert.throws(()=>recoverRestore(invalid),/无效/);assert.equal(invalid.operations.length,0);assert.ok(invalid.getItem(RECOVERY_KEY));
  }
});
test('undo snapshot failure preserves restored data and allows retry', () => {
  const s=storage({[key('drivers')]:'["before"]'});
  restoreBackup(s,envelope({drivers:['after']}),'demo',1,['drivers']);
  let fired=false;s.fail=(op,k)=>{if(!fired&&op==='remove'&&k===key('restoreUndo')){fired=true;return true;}return false;};
  assert.throws(()=>undoRestore(s,'demo',1),/已还原/);assert.equal(s.getItem(key('drivers')),'["after"]');assert.ok(restoreSnapshotInfo(s,'demo',1));
  s.fail=null;undoRestore(s,'demo',1);assert.equal(s.getItem(key('drivers')),'["before"]');
});
test('corrupt undo snapshots and cross-scope entries never modify user data', () => {
  for (const raw of ['{broken',JSON.stringify({format:'ModelYMate-restore-undo',version:1,scope:'demo',carID:1,createdAt:'2026-10-15T12:00:00Z',entries:[['modelymate.other.2.drivers','[]']]})]) {
    const s=storage({[key('restoreUndo')]:raw,[key('drivers')]:'["safe"]'});
    assert.throws(()=>undoRestore(s,'demo',1));assert.equal(s.getItem(key('drivers')),'["safe"]');assert.equal(s.operations.length,0);
  }
});
test('slow old file and stale failures cannot replace a newer valid selection', async () => {
  const reader=createBackupReader();let resolve,reject;
  const slow=reader.read({size:1,text:()=>new Promise(r=>resolve=r)});
  const current=await reader.read({size:1,text:async()=>JSON.stringify(envelope({drivers:['new']}))});
  resolve(JSON.stringify(envelope({drivers:['old']})));
  assert.equal((await slow).status,'cancelled');assert.deepEqual(current.backup.data.drivers,['new']);
  const failing=reader.read({size:1,text:()=>new Promise((_,r)=>reject=r)});
  await reader.read({size:1,text:async()=>JSON.stringify(envelope({drivers:['latest']}))});
  reject(new Error('stale failure'));assert.equal((await failing).status,'cancelled');
});
test('file cancellation, unmount and oversized selection never apply parsed data', async () => {
  const reader=createBackupReader();let resolve;
  const slow=reader.read({size:1,text:()=>new Promise(r=>resolve=r)});
  reader.cancel();resolve(JSON.stringify(envelope({drivers:['old']})));assert.equal((await slow).status,'cancelled');
  assert.equal((await reader.read()).status,'cancelled');
  assert.equal((await reader.read({size:MAX_BACKUP_BYTES+1,text:()=>{throw new Error('should not read');}})).status,'error');
  assert.match((await reader.read({size:1,text:async()=>'{broken'})).error,/JSON/);
});
