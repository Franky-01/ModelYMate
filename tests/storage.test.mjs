import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoreAccess} from '../src/storage.ts';
import {RECOVERY_KEY} from '../src/backup.mjs';

function fixture(initial={}) {
  const data=new Map(Object.entries(initial));
  const storage={fail:false,getItem:k=>data.get(k)??null,setItem(k,v){if(this.fail)throw new Error('QuotaExceededError');data.set(k,v);},removeItem(k){if(this.fail)throw new Error('Access denied');data.delete(k);}};
  return {data,storage,access:createStoreAccess(()=>storage)};
}
test('valid zero, false and empty values survive and absent values use defaults',()=>{
  const {access}=fixture();
  for (const [key,value,fallback] of [['number',0,99],['bool',false,true],['list',[],[1]],['object',{}, {a:1}]]) {assert.equal(access.writeStore(key,value),true);assert.deepEqual(access.readStore(key,fallback),value);}
  assert.equal(access.readStore('missing',4),4);
});
test('damaged JSON or wrong shape remains untouched when fallback is rendered and saved',()=>{
  for(const raw of ['{broken','null','42','[]']) {
    const {access,data}=fixture({'modelymate.demo.1.journals':raw});
    assert.deepEqual(access.readStore('demo.1.journals',{}),{});
    assert.equal(access.writeStore('demo.1.journals',{1:{note:'new'}}),false);
    assert.equal(data.get('modelymate.demo.1.journals'),raw);assert.match(access.storageProblem(),/原值/);
    assert.equal(access.writeStore('demo.1.drivers',['A']),true);
    data.set('modelymate.demo.1.journals','{"2":{}}');
    assert.deepEqual(access.readStore('demo.1.journals',{}),{2:{}});assert.equal(access.writeStore('demo.1.journals',{3:{}}),true);
  }
});
test('startup rollback completes before reads return and recovers absent keys',()=>{
  const {access,data}=fixture({'modelymate.demo.1.drivers':'["after"]',[RECOVERY_KEY]:JSON.stringify({entries:[['modelymate.demo.1.drivers','["before"]'],['modelymate.demo.1.costs',null]]})});
  assert.deepEqual(access.readStore('demo.1.drivers',[]),['before']);assert.equal(data.has(RECOVERY_KEY),false);assert.equal(access.storageProblem(),'');
});
test('failed startup rollback blocks all writes until explicit recovery succeeds',()=>{
  const {access,storage,data}=fixture({'modelymate.demo.1.drivers':'["after"]',[RECOVERY_KEY]:JSON.stringify({entries:[['modelymate.demo.1.drivers','["before"]']]})});
  storage.fail=true;
  assert.deepEqual(access.readStore('demo.1.drivers',[]),['after']);assert.equal(access.writeStore('demo.1.costs',{}),false);assert.match(access.recoveryProblem(),/暂停保存/);assert.ok(data.has(RECOVERY_KEY));
  storage.fail=false;assert.equal(access.retryRecovery(),true);assert.deepEqual(access.readStore('demo.1.drivers',[]),['before']);assert.equal(access.writeStore('demo.1.costs',{}),true);
});
test('a newly interrupted restore blocks already-mounted stale state until retry',()=>{
  const {access,storage,data}=fixture({'modelymate.demo.1.drivers':'["before"]'});
  assert.deepEqual(access.readStore('demo.1.drivers',[]),['before']);
  storage.setItem(RECOVERY_KEY,JSON.stringify({entries:[['modelymate.demo.1.drivers','["before"]']]}));storage.setItem('modelymate.demo.1.drivers','["partial"]');
  assert.equal(access.writeStore('demo.1.drivers',['stale edit']),false);assert.equal(data.get('modelymate.demo.1.drivers'),'["partial"]');
  assert.equal(access.retryRecovery(),true);assert.deepEqual(access.readStore('demo.1.drivers',[]),['before']);
  assert.equal(access.writeStore('demo.1.drivers',['edited after reread']),true);
});
test('corrupt recovery marker is retained and all saves fail closed',()=>{
  const {access,data}=fixture({[RECOVERY_KEY]:'{broken','modelymate.demo.1.drivers':'["original"]'});
  assert.deepEqual(access.readStore('demo.1.drivers',[]),['original']);assert.equal(access.writeStore('demo.1.drivers',[]),false);assert.equal(data.get(RECOVERY_KEY),'{broken');assert.equal(access.retryRecovery(),false);
});
test('quota and serialization failures return false without claiming data was saved',()=>{
  const {access,storage,data}=fixture({'modelymate.demo.1.drivers':'["original"]'});
  access.readStore('demo.1.drivers',[]);storage.fail=true;
  assert.equal(access.writeStore('demo.1.drivers',['new']),false);assert.equal(data.get('modelymate.demo.1.drivers'),'["original"]');assert.match(access.storageProblem(),/未保存/);
  storage.fail=false;assert.equal(access.writeStore('invalid',undefined),false);assert.equal(data.has('modelymate.invalid'),false);
  assert.equal(access.writeStore('demo.1.drivers',['saved']),true);assert.equal(access.storageProblem(),'');
});
test('unavailable browser storage cannot cause a silent fresh overwrite',()=>{
  let unavailable=true;const data=new Map([['modelymate.demo.1.drivers','["original"]']]);
  const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const access=createStoreAccess(()=>{if(unavailable)throw new Error('SecurityError');return storage;});
  assert.deepEqual(access.readStore('demo.1.drivers',[]),[]);assert.equal(access.writeStore('demo.1.drivers',[]),false);
  unavailable=false;assert.equal(access.writeStore('demo.1.drivers',[]),false);assert.equal(data.get('modelymate.demo.1.drivers'),'["original"]');
  assert.equal(access.retryRecovery(),true);assert.deepEqual(access.readStore('demo.1.drivers',[]),['original']);
});

test('recovery retry alone cannot authorize writing a value from a failed read',()=>{
  let unavailable=true;const {storage,data}=fixture({'modelymate.demo.1.drivers':'["original"]'});
  const access=createStoreAccess(()=>{if(unavailable)throw new Error('SecurityError');return storage;});
  access.readStore('demo.1.drivers',[]);
  unavailable=false;assert.equal(access.retryRecovery(),true);
  assert.equal(access.writeStore('demo.1.drivers',[]),false);
  assert.equal(data.get('modelymate.demo.1.drivers'),'["original"]');
  assert.deepEqual(access.readStore('demo.1.drivers',[]),['original']);
  assert.equal(access.writeStore('demo.1.drivers',['new edit']),true);
});

test('restore and other-tab changes reject stale writes until the affected key is reread',()=>{
  const {access,storage,data}=fixture({'modelymate.demo.1.drivers':'["before"]'});
  access.readStore('demo.1.drivers',[]);
  storage.setItem('modelymate.demo.1.drivers','["restored"]');
  assert.equal(access.writeStore('demo.1.drivers',['stale']),false);
  assert.equal(data.get('modelymate.demo.1.drivers'),'["restored"]');
  assert.match(access.storageProblem(),/重新读取/);
  assert.equal(access.retryRecovery(),true);
  assert.equal(access.writeStore('demo.1.drivers',['still stale']),false);
  assert.deepEqual(access.readStore('demo.1.drivers',[]),['restored']);
  assert.equal(access.writeStore('demo.1.drivers',['edited']),true);
});
