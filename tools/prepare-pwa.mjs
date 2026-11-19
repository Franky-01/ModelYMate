import {createReadStream} from 'node:fs';
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {VEHICLE_MODELS} from '../src/vehicle-catalog.mjs';

const release = createHash('sha256');
const baseAssets = ['Atelier.hdr', 'vehicle.glb', 'vehicle.audit.json'].map(name => '/assets/' + name);
const required = new Set([...baseAssets, ...VEHICLE_MODELS.map(model => '/assets/' + model.asset)]);
const digests = new Map();

async function visit(directory) {
  const entries = await readdir(directory, {withFileTypes:true});
  for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
    const file = directory + '/' + entry.name;
    if (entry.isDirectory()) { await visit(file); continue; }
    if (file === 'public/sw.js') continue;
    release.update(file);
    const url = file.startsWith('public/') ? file.slice('public'.length) : '';
    if (url.startsWith('/assets/vehicles/') || required.has(url)) {
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(file)) {
        release.update(chunk);
        digest.update(chunk);
      }
      digests.set(url, digest.digest('hex'));
    } else {
      release.update(await readFile(file));
    }
  }
}

for (const dir of ['src','public','server']) await visit(dir);
for (const file of ['index.html','package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.json']) {
  release.update(file).update(await readFile(file));
}
for (const url of required) {
  if (!digests.has(url)) throw new Error('Missing required vehicle asset: ' + url);
}
// Keep the on-demand asset cache stable across shell-only releases.
const assets = Object.fromEntries([...baseAssets.map(url => [url, digests.get(url)]), ...digests]);
const manifest = JSON.stringify(assets);
const assetCache = 'modelymate-assets-v1-' + createHash('sha256').update(manifest).digest('hex').slice(0,16);

const source = await readFile('public/sw.js', 'utf8');
const generatedHeader = /^const VERSION='[^'\r\n]*';\r?\nconst ASSET_CACHE='[^'\r\n]*';\r?\nconst ASSET_DIGESTS=\{[^\r\n]*\};/;
if (!generatedHeader.test(source)) throw new Error('Missing service worker manifest header');
// Worker-only changes also invalidate the shell, without hashing the previous generated version.
release.update(source.replace(generatedHeader, ''));
const version = 'modelymate-pwa-' + release.digest('hex').slice(0,16);
const header = ["const VERSION='" + version + "';", "const ASSET_CACHE='" + assetCache + "';", 'const ASSET_DIGESTS=' + manifest + ';'];
const output = source.replace(generatedHeader, () => header.join(source.includes('\r\n') ? '\r\n' : '\n'));
if (output !== source) await writeFile('public/sw.js', output);
console.log('PWA cache version ' + version);
