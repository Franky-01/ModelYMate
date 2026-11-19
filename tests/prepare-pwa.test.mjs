import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {VEHICLE_MODELS} from '../src/vehicle-catalog.mjs';

test('PWA preparation is repeatable, verifies every vehicle, and versions the shell independently', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(),'modelymate-pwa-test-'));
  t.after(()=>rm(cwd,{force:true,recursive:true}));
  const put = async (name, content) => {
    const file = path.join(cwd,name);
    await mkdir(path.dirname(file),{recursive:true});
    await writeFile(file,content);
  };
  for (const name of ['src/main.tsx','server/server.mjs','index.html','package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.json']) await put(name,name);
  const names = [...new Set(['Atelier.hdr','vehicle.audit.json',...VEHICLE_MODELS.map(m=>m.asset),'vehicles/test/texture.png'])];
  for (const name of names) await put('public/assets/'+name,name);
  await put('public/sw.js',"const VERSION='first';\nconst ASSET_CACHE='first';\nconst ASSET_DIGESTS={};\n");
  const script = fileURLToPath(new URL('../tools/prepare-pwa.mjs',import.meta.url));
  const run = async () => {
    execFileSync(process.execPath,[script],{cwd,stdio:'pipe'});
    return readFile(path.join(cwd,'public/sw.js'),'utf8');
  };
  const first = await run();
  const digests = JSON.parse(first.match(/const ASSET_DIGESTS=(.+);/)[1]);
  for (const name of names) assert.equal(digests['/assets/'+name],createHash('sha256').update(name).digest('hex'));
  assert.equal(await run(),first);
  await put('public/sw.js',first+'// New worker behavior\n');
  const updated = await run();
  assert.notEqual(updated.split('\n')[0],first.split('\n')[0]);
  assert.equal(updated.split('\n')[1],first.split('\n')[1]);
  await put('public/assets/vehicle.glb','replacement');
  assert.notEqual((await run()).split('\n')[1],updated.split('\n')[1]);
  await rm(path.join(cwd,'public/assets/vehicle.glb'));
  await assert.rejects(run,/Missing required vehicle asset/);
});
