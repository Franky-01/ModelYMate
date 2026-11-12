import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Budget,proxyIPs,siteOrigin,boundedResponse} from '../server/security.mjs';
import {fixtureEnv} from './fixture-env.mjs';

test('security configuration fails closed for missing proof, bad proxy lists and non-HTTPS origin',()=>{
  for(const overrides of [{SITE_AUTH_MODE:'wrong'},{SITE_AUTH_MODE:'forward-auth'},
    {TRUST_TAILSCALE_PROXY:'true'},{TRUSTED_PROXY_IPS:'0.0.0.0/0'},
    {SITE_PUBLIC_ORIGIN:'http://fixture.example'},{SITE_PUBLIC_ORIGIN:'https://fixture.example/path'},
    {SESSION_COOKIE_SECURE:'false'}]){
    const r=spawnSync(process.execPath,['server/server.mjs'],{env:fixtureEnv(overrides),timeout:3000});
    assert.notEqual(r.status,0);assert.equal(r.error,undefined);assert(!r.stdout.toString().includes('ModelYMate PWA http'));
  }
  assert.deepEqual([...proxyIPs('::ffff:127.0.0.1, ::1')],['127.0.0.1','::1']);
  assert.equal(siteOrigin('https://fixture.example:8443/'),'https://fixture.example:8443');
});
test('bounded limiter expires windows and refuses unbounded identity allocation',()=>{
  const b=new Budget(2,1000,1);assert.equal(b.take('a',0),true);assert.equal(b.take('a',1),true);
  assert.equal(b.take('a',2),false);assert.equal(b.take('b',2),false);assert.equal(b.take('b',1000),true);
});
test('response ceilings reject both declared size and chunked oversized bodies',async()=>{
  await assert.rejects(boundedResponse(new Response('large',{headers:{'content-length':'1000'}}),10));
  await assert.rejects(boundedResponse(new Response('large'),3));
  assert.equal((await boundedResponse(new Response('ok'),3)).toString(),'ok');
});
