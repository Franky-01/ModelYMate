import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {VEHICLE_MODELS} from '../src/vehicle-catalog.mjs';
const hash=createHash('sha256');
async function visit(dir){for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(dir,e.name),relative=p.split(path.sep).join('/');if(e.isDirectory())await visit(p);else if(relative!=='public/sw.js'){hash.update(relative);hash.update(await readFile(p));}}}
await visit('src');await visit('public');await visit('server');hash.update(await readFile('package.json'));
const version='modelymate-pwa-'+hash.digest('hex').slice(0,16),source=await readFile('public/sw.js','utf8');
const assets={};for(const file of ['Atelier.hdr','vehicle.glb','vehicle.audit.json'])assets['/assets/'+file]=createHash('sha256').update(await readFile('public/assets/'+file)).digest('hex');
// Keep model downloads on demand, but version every model and dependent texture.
// An incomplete catalogue is a build error, not a silently missing vehicle.
for(const model of VEHICLE_MODELS)await readFile(path.join('public/assets',model.asset));
async function modelAssets(dir){for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(dir,e.name);if(e.isDirectory())await modelAssets(p);else assets['/'+p.replaceAll('\\','/').replace(/^public\//,'')]=createHash('sha256').update(await readFile(p)).digest('hex');}}
await modelAssets('public/assets/vehicles');
const assetCache='modelymate-assets-v1-'+createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0,16);
await writeFile('public/sw.js',source.replace(/const VERSION='[^']+';/,`const VERSION='${version}';`).replace(/const ASSET_CACHE='[^']+';/,`const ASSET_CACHE='${assetCache}';`).replace(/const ASSET_DIGESTS=\{[^\n]*\};/,`const ASSET_DIGESTS=${JSON.stringify(assets)};`));
console.log('PWA cache version '+version);
