import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {configureCabinGlass, restoreCabin} from '../src/garage-interior.ts';

const bytes = await readFile(new URL('../public/assets/vehicle.glb', import.meta.url));
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const cabin = gltf.scene.getObjectByName('Interior_Mesh042');
const geometry = cabin.geometry;
const originalIndex = Array.from(geometry.index.array);
const hash = array => createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
const originalAttributes = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, hash(attribute.array)]));
const originalTransform = cabin.matrix.toArray();
const originalHinges = gltf.scene.children.map(node => ({name: node.name, matrix: node.matrix.toArray()}));
const restored = restoreCabin(gltf.scene, null);

test('cabin visibility preserves every original triangle, winding, attribute and transform', () => {
  const triangles = indices => Array.from({length: indices.length / 3}, (_, i) => indices.slice(i * 3, i * 3 + 3).join(',')).sort();
  assert.deepEqual(triangles(Array.from(geometry.index.array)), triangles(originalIndex));
  assert.deepEqual(Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, hash(attribute.array)])), originalAttributes);
  assert.deepEqual(cabin.matrix.toArray(), originalTransform);
  assert.equal(restored.sourceTriangles, 6965);
  assert.deepEqual(gltf.scene.children.filter(node => node.name !== 'garage-cabin-details').map(node => ({name: node.name, matrix: node.matrix.toArray()})), originalHinges);
});

test('the actual original front/rear seats and steering wheel receive readable separate finishes', () => {
  const materialAt = (x, y, z) => {
    const p = geometry.attributes.position, point = new THREE.Vector3(x, y, z); let best = Infinity, material;
    for (const group of geometry.groups) for (let i = group.start; i < group.start + group.count; i++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(p, geometry.index.getX(i));
      const distance = vertex.distanceToSquared(point);
      if (distance < best) {best = distance; material = cabin.material[group.materialIndex].name;}
    }
    return material;
  };
  for (const x of [-.39, .39]) {
    assert.equal(materialAt(x, 1.1, .26), 'cabin-seat-upholstery');
    assert.equal(materialAt(x, 1.32, 1.1), 'cabin-seat-upholstery');
    assert.equal(materialAt(x, .67, .52), 'cabin-seat-upholstery');
  }
  assert.equal(materialAt(-.4, 1.26, -.45), 'cabin-steering-leather');
  assert.ok(restored.seatTriangles > 2500); assert.ok(restored.steeringTriangles >= 512);
  assert.equal(restored.materialGroups, 4);
});

test('windows are see-through without turning mirrors transparent or adding a transmission pass', () => {
  for (const name of ['Plane011_Mesh009', 'Plane011_Mesh009__door_driver_front', 'Plane011_Mesh009__door_passenger_rear', 'Plane023_Mesh067']) {
    const material = new THREE.MeshPhysicalMaterial();
    assert.equal(configureCabinGlass(material, name), true);
    assert.equal(material.transparent, true); assert.ok(material.opacity > 0 && material.opacity < .5);
    assert.equal(material.depthWrite, false); assert.equal(material.transmission, 0); assert.equal(material.forceSinglePass, true);
  }
  for (const side of ['driver', 'passenger']) {
    const material = new THREE.MeshPhysicalMaterial();
    assert.equal(configureCabinGlass(material, `Plane050_Mesh036__door_${side}_front`), false);
    assert.equal(material.transparent, false); assert.equal(material.opacity, 1);
  }
});

test('center display stays attached to the body and does not add duplicate seats or steering geometry', () => {
  const display = gltf.scene.getObjectByName('garage-center-display');
  assert.equal(display.parent.parent, gltf.scene);
  assert.equal(display.children.length, 2);
  assert.equal(gltf.scene.getObjectByName('garage-center-display-surface').material.toneMapped, false);
  assert.equal(gltf.scene.getObjectByName('garage-cabin-soft-fill').castShadow, false);
  assert.equal(gltf.scene.getObjectByName('Interior_Mesh042'), cabin);
  let addedTriangles = 0;
  gltf.scene.getObjectByName('garage-cabin-details').traverse(node => {if (node.isMesh) addedTriangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;});
  assert.ok(addedTriangles < 500, `Additional detail triangles: ${addedTriangles}`);
});
