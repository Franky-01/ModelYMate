import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import * as THREE from 'three';
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
const yieldURL=moduleURL(await fs.readFile(new URL('../src/vehicle-yield.ts',import.meta.url),'utf8'));
const source=(await fs.readFile(new URL('../src/vehicle-template.ts',import.meta.url),'utf8')).replace("from 'three'",`from '${import.meta.resolve('three')}'`).replace("from './vehicle-yield'",`from '${yieldURL}'`);
const {cloneVehicleTemplate,vehicleTemplateBytes}=await import(moduleURL(source));
function fixture(){
 const geometry=new THREE.BoxGeometry(2,1,3),texture=new THREE.DataTexture(new Uint8Array(16),2,2),material=new THREE.MeshStandardMaterial({map:texture});
 const scene=new THREE.Group();scene.add(new THREE.Mesh(geometry,material),new THREE.Mesh(geometry,material));
 scene.children[1].position.x=3;
 return{scene,audit:{nodeCount:2,geometryCount:2,triangles:24,hinges:[{stateKey:'frunk',name:'lid',axis:[1,0,0],openRadians:1,durationSeconds:.5}],wheels:[],groundingTranslation:[0,0,0]},chargeSocket:new THREE.Vector3(1,2,3),nativeMaterials:true};
}
test('separate scenes own mutable buffers, materials, texture state and audit; retain authored sharing within a scene',async()=>{
 const template=fixture(),signal=new AbortController().signal,a=await cloneVehicleTemplate(template,signal),b=await cloneVehicleTemplate(template,signal);
 const original=template.scene.children[0],one=a.scene.children[0],two=b.scene.children[0];
 assert.notEqual(one.geometry,original.geometry);assert.notEqual(one.geometry,two.geometry);
 assert.equal(a.scene.children[1].geometry,one.geometry);assert.equal(a.scene.children[1].material,one.material);
 assert.deepEqual(one.geometry.attributes.position.array,original.geometry.attributes.position.array);
 assert.notEqual(one.geometry.attributes.position.array,original.geometry.attributes.position.array);
 assert.notEqual(one.material,original.material);assert.notEqual(one.material.map,original.material.map);assert.notEqual(one.material.map.source,original.material.map.source);assert.notEqual(one.material.map.source,two.material.map.source);
 assert.equal(one.material.map.image,original.material.map.image,'immutable decoded pixels may be shared');
 const sourceVersion=original.material.map.source.version;one.material.map.needsUpdate=true;assert.equal(original.material.map.source.version,sourceVersion);
 const pixels=one.material.map.image;one.material.map.image={width:1,height:1,data:new Uint8Array(4)};assert.equal(original.material.map.image,pixels);
 one.geometry.attributes.position.setXYZ(0,99,99,99);one.geometry.clearGroups();one.material.color.set('red');one.material.map.offset.x=.5;one.position.x=12;a.audit.hinges[0].axis[0]=9;a.chargeSocket.x=9;
 assert.notEqual(original.geometry.attributes.position.getX(0),99);assert.notEqual(two.geometry.attributes.position.getX(0),99);
 assert.notEqual(original.material.color.getHexString(),'ff0000');assert.equal(original.material.map.offset.x,0);assert.equal(two.position.x,0);assert.equal(template.audit.hinges[0].axis[0],1);assert.equal(b.chargeSocket.x,1);
 let originalDisposals=0;for(const x of [original.geometry,original.material,original.material.map])x.addEventListener('dispose',()=>originalDisposals++);
 one.geometry.dispose();one.material.dispose();one.material.map.dispose();assert.equal(originalDisposals,0);
});
test('template budget counts shared buffers and decoded images once and excludes duplicate meshes',()=>{
 const template=fixture(),bytes=vehicleTemplateBytes(template.scene),mesh=template.scene.children[0];
 const buffers=new Set([mesh.geometry.index.array.buffer,...Object.values(mesh.geometry.attributes).map(a=>a.array.buffer),mesh.material.map.image.data.buffer]);
 assert.equal(bytes,[...buffers].reduce((n,b)=>n+b.byteLength,0));
 template.scene.add(mesh.clone());assert.equal(vehicleTemplateBytes(template.scene),bytes);
});
test('aborted scene copies reject without releasing or changing template resources',async()=>{
 const template=fixture(),controller=new AbortController();controller.abort();
 let disposed=0;template.scene.children[0].geometry.addEventListener('dispose',()=>disposed++);
 await assert.rejects(cloneVehicleTemplate(template,controller.signal),{name:'AbortError'});assert.equal(disposed,0);assert.equal(template.scene.children.length,2);
});
