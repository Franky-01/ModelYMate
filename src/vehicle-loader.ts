import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {request, RequestFailure} from './request';
import {vehicleModel} from './vehicle-catalog.mjs';
import type {PreparedVehicle, VehicleModelID, VehicleAudit} from './vehicle-types';

export const vehicleAssetURL = (name:string) => `${import.meta.env.BASE_URL}assets/${name}`;

export function releaseVehicle(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      Object.values(material).forEach(value => {if (value instanceof THREE.Texture) textures.add(value);});
    }
  });
  geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
}

export async function loadVehicle(id: VehicleModelID, signal: AbortSignal): Promise<PreparedVehicle> {
  const profile = vehicleModel(id), url = vehicleAssetURL(profile.asset);
  const bytes = await request(url, response => {
    if (!response.ok) throw new RequestFailure('http', `Vehicle asset: HTTP ${response.status}`, response.status);
    return response.arrayBuffer();
  }, {signal, timeoutMs:120000});
  signal.throwIfAborted();
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, url.slice(0, url.lastIndexOf('/') + 1));
  let prepared: PreparedVehicle | undefined;
  try {
    signal.throwIfAborted();
    if (id === 'modely-2025') {
      const audit = await request(vehicleAssetURL('vehicle.audit.json'), response => {
        if (!response.ok) throw new RequestFailure('http', `Vehicle audit: HTTP ${response.status}`, response.status);
        return response.json() as Promise<VehicleAudit>;
      }, {signal, timeoutMs:120000});
      signal.throwIfAborted();
      return {scene:gltf.scene, audit, nativeMaterials:false};
    }
    if (id === 'model3-2018' || id === 'model3-2024') {
      const adapter = await import('./vehicle-model3'); signal.throwIfAborted(); prepared = adapter.prepareModel3(gltf.scene,id);
    } else if (id === 'models-2013' || id === 'models-2021') {
      const adapter = await import('./vehicle-models'); signal.throwIfAborted(); prepared = adapter.prepareModelS(gltf.scene,id);
    } else {
      const adapter = await import('./vehicle-modelxy'); signal.throwIfAborted(); prepared = adapter.prepareModelXY(gltf.scene,id);
    }
    signal.throwIfAborted();
    const states = new Set(prepared.audit.hinges.map(hinge => hinge.stateKey));
    for (const key of ['driverFront','passengerFront','driverRear','passengerRear','frunk','trunk','chargePort']) {
      if (!states.has(key)) throw new Error(`Vehicle rig missing ${key}`);
    }
    if (prepared.audit.wheels.length !== 4) throw new Error('Vehicle rig requires four independent wheels');
    // A separate UV channel keeps each source's cabin/normal maps intact while
    // aligning the selectable livery across closed doors, wings and lids.
    prepared.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(prepared.scene), point = new THREE.Vector3();
    const inverse = prepared.scene.matrixWorld.clone().invert();
    prepared.scene.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (!materials.some(material => material.name === 'exterior_paint')) return;
      const position = node.geometry.attributes.position, uv = new Float32Array(position.count * 2);
      const matrix = inverse.clone().multiply(node.matrixWorld);
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position,i).applyMatrix4(matrix);
        uv[i*2] = (point.z-bounds.min.z)/(bounds.max.z-bounds.min.z);
        uv[i*2+1] = 1-(point.y-bounds.min.y)/(bounds.max.y-bounds.min.y);
      }
      node.geometry.setAttribute('uv1',new THREE.BufferAttribute(uv,2));
    });
    return prepared;
  } catch (error) {
    releaseVehicle(prepared?.scene ?? gltf.scene);
    throw error;
  }
}
