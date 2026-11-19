import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {copyFile,mkdir,mkdtemp,open,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {fixtureEnv} from './fixture-env.mjs';

test('static HTTP delivery uses the selected representation for GET and HEAD',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'modelymate-static-'));
  const serverDir=path.join(root,'server'),assets=path.join(root,'dist','assets');
  let child,exit;
  t.after(async()=>{
    if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await exit;}
    await rm(root,{recursive:true,force:true});
  });
  await mkdir(serverDir);
  await mkdir(assets,{recursive:true});
  for(const name of ['server.mjs','security.mjs']){
    await copyFile(new URL('../server/'+name,import.meta.url),path.join(serverDir,name));
  }
  const shell=Buffer.from('<html>local fixture</html>'),plain=Buffer.from('local fixture model '.repeat(200));
  const compressed=gzipSync(plain),model='/assets/model-abcdefgh.glb';
  await writeFile(path.join(root,'dist','index.html'),shell);
  await writeFile(path.join(assets,'model-abcdefgh.glb'),plain);
  await writeFile(path.join(assets,'model-abcdefgh.glb.gz'),compressed);
  const large=await open(path.join(assets,'large.glb'),'w');
  try{await large.truncate(16*1024*1024);}finally{await large.close();}

  child=spawn(process.execPath,[path.join(serverDir,'server.mjs')],{env:fixtureEnv(),stdio:['ignore','pipe','pipe']});
  exit=once(child,'exit');
  const port=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Local static fixture timed out')),6000);
    child.stdout.on('data',data=>{
      const address=String(data).match(/127\.0\.0\.1:(\d+)/);
      if(address){clearTimeout(timeout);resolve(Number(address[1]));}
    });
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Local static fixture exited: '+code));});
  });
  function request(target,method='GET',acceptEncoding){
    return new Promise((resolve,reject)=>{
      const headers=acceptEncoding===undefined?{}:{'accept-encoding':acceptEncoding};
      const req=http.request({host:'127.0.0.1',port,path:target,method,headers},async response=>{
        try{
          const chunks=[];
          for await(const chunk of response)chunks.push(chunk);
          resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)});
        }catch(error){reject(error);}
      });
      req.setTimeout(5000,()=>req.destroy(new Error('Local static request timed out')));
      req.on('error',reject);
      req.end();
    });
  }
  await t.test('body bytes and lengths match identity, gzip, and weighted negotiation',async()=>{
    for(const [accept,expected] of [
      [undefined,plain],['',plain],['gzip;q=0',plain],['not-gzip',plain],['br',plain],
      ['gzip;q=0.1, identity;q=1',plain],['*;q=1, gzip;q=0',plain],
      ['GZIP',compressed],['*',compressed],['gzip;q=0.2',compressed],['gzip, identity;q=0',compressed]
    ]){
      const get=await request(model,'GET',accept),head=await request(model,'HEAD',accept);
      assert.equal(get.status,200);
      assert.equal(head.status,200);
      assert.deepEqual(get.body,expected);
      assert.equal(head.body.length,0);
      for(const key of ['content-type','cache-control','content-encoding','vary','content-length']){
        assert.equal(head.headers[key],get.headers[key],key);
      }
      assert.equal(get.headers['content-encoding'],expected===compressed?'gzip':undefined);
      assert.equal(get.headers['content-length'],String(expected.length));
      assert.equal(get.headers['content-type'],'model/gltf-binary');
      assert.match(get.headers['cache-control'],/immutable/);
      assert.equal(get.headers.vary,'Accept-Encoding');
    }
  });
  await t.test('missing assets and unavailable encodings preserve SPA navigation',async()=>{
    for(const method of ['GET','HEAD']){
      for(const target of ['/assets','/assets/not-built-12345678.js','/sw.js']){
        const missing=await request(target,method);
        assert.equal(missing.status,404);
        assert.equal(missing.headers['cache-control'],'no-store');
      }
      for(const [target,header] of [[model,'gzip;q=0, identity;q=0'],['/','identity;q=0, gzip'],[model,'*;q=0']]){
        const unavailable=await request(target,method,header);
        assert.equal(unavailable.status,406);
        assert.equal(unavailable.body.length,0);
        assert.equal(unavailable.headers.vary,'Accept-Encoding');
      }
    }
    const route=await request('/records/recent','GET','gzip');
    assert.equal(route.status,200);
    assert.deepEqual(route.body,shell);
    assert.equal(route.headers['cache-control'],'no-cache');
    assert.equal(route.headers['content-encoding'],undefined);
  });
  await t.test('aborting a model download keeps the server available',async()=>{
    await new Promise((resolve,reject)=>{
      const req=http.get({host:'127.0.0.1',port,path:'/assets/large.glb'},response=>{
        response.once('data',chunk=>{
          assert.ok(chunk.length<Number(response.headers['content-length']));
          response.destroy();
        });
        response.once('close',resolve);
        response.once('error',reject);
      });
      req.setTimeout(5000,()=>req.destroy(new Error('Local model request timed out')));
      req.once('error',reject);
    });
    assert.deepEqual((await request(model)).body,plain);
  });
});
