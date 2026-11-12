import * as THREE from 'three';
import type {PreparedVehicle} from './vehicle-types';
import {createVehicleYield} from './vehicle-yield';

/** CPU-side geometry/image estimate; the template is never uploaded to a GPU. */
export function vehicleTemplateBytes(root: THREE.Object3D) {
  const buffers = new Set<ArrayBufferLike>(), images = new Set<object>();
  let bytes = 0;
  const count = (array: ArrayBufferView) => {if (!buffers.has(array.buffer)) {buffers.add(array.buffer); bytes += array.buffer.byteLength;}};
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const attribute of [node.geometry.index, ...Object.values(node.geometry.attributes), ...Object.values(node.geometry.morphAttributes).flat()]) {
      if (!attribute) continue;
      count('data' in attribute ? attribute.data.array : attribute.array);
    }
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) for (const value of Object.values(material)) {
      if (!(value instanceof THREE.Texture)) continue;
      const image = value.image;
      if (!image || images.has(image)) continue;
      images.add(image);
      if (ArrayBuffer.isView(image.data)) count(image.data);
      else bytes += Math.max(0, (image.width || 0) * (image.height || 0) * 4);
    }
  });
  return bytes;
}

/** Every caller owns its mutable hierarchy, buffers, materials and texture state.
 * Decoded image pixels are immutable and may be shared, as in Texture.clone().
 * No caller's disposal or cabin-index edit can affect the retained template.
 */
export async function cloneVehicleTemplate(template: PreparedVehicle, signal: AbortSignal): Promise<PreparedVehicle> {
  signal.throwIfAborted();
  const cooperate = createVehicleYield(signal), scene = template.scene.clone(true);
  const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const materials = new Map<THREE.Material, THREE.Material>(), textures = new Map<THREE.Texture, THREE.Texture>();
  const meshes: THREE.Mesh[] = [];
  scene.traverse(node => {if (node instanceof THREE.Mesh) meshes.push(node);});
  try {
    for (const node of meshes) {
      let geometry = geometries.get(node.geometry);
      if (!geometry) {geometry = node.geometry.clone(); geometry.userData = structuredClone(node.geometry.userData); geometries.set(node.geometry, geometry);}
      node.geometry = geometry;
      const cloneMaterial = (source: THREE.Material) => {
        let material = materials.get(source);
        if (material) return material;
        material = source.clone(); materials.set(source, material);
        for (const [key, value] of Object.entries(material)) if (value instanceof THREE.Texture) {
          let texture = textures.get(value);
          if (!texture) {
            texture = value.clone();
            texture.source = new THREE.Source(value.source.data);
            texture.needsUpdate = true; textures.set(value, texture);
          }
          (material as unknown as Record<string, unknown>)[key] = texture;
        }
        return material;
      };
      node.material = Array.isArray(node.material) ? node.material.map(cloneMaterial) : cloneMaterial(node.material);
      await cooperate();
    }
    signal.throwIfAborted();
    return {...template, scene, audit: structuredClone(template.audit), chargeSocket: template.chargeSocket?.clone()};
  } catch (error) {
    // Unprocessed nodes still reference the template; release only new copies.
    geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
    scene.clear(); throw error;
  }
}
