import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

const color = (value: number) => new THREE.Color().setRGB(value, value, value, THREE.SRGBColorSpace);

// The source combines seats, wheel, dashboard and console in one cabin mesh.
// Assign finishes to whole connected pieces while retaining their geometry.
function cabinFinish(bounds: THREE.Box3) {
  const {min, max} = bounds;
  if (max.z < -.38 && min.x < -.2 && min.y > .95 && max.y < 1.28) return 2;
  if (max.y > 1.48 || min.y > 1.37) return 3;
  if (min.z > -.56 && max.z < 1.4 && min.y >= .54 && max.y > .64 && min.x > -.7 && max.x < .7) {
    if (min.x > -.15 && max.x < .15 && max.z < 0) return 0;
    return 1;
  }
  return 0;
}

export function configureCabinGlass(material: THREE.MeshPhysicalMaterial, nodeName: string) {
  // Split door mirrors must remain opaque reflectors.
  if (nodeName.startsWith('Plane050_Mesh036')) return false;
  const roof = nodeName === 'Plane023_Mesh067';
  material.color.setRGB(.34, .38, .40, THREE.SRGBColorSpace);
  material.metalness = .02; material.roughness = roof ? .21 : .12;
  material.transparent = true; material.opacity = roof ? .48 : .22;
  material.depthWrite = false; material.side = THREE.DoubleSide;
  material.forceSinglePass = true;
  material.clearcoat = .28; material.clearcoatRoughness = .16;
  material.envMapIntensity = .4;
  return true;
}

export function makeCenterDisplayTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#141c22'; ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = '#202b33'; ctx.fillRect(8, 8, 226, 260);
  // Static artwork: no invented speed, range, location or vehicle state.
  ctx.fillStyle = '#c0cbd0';
  ctx.beginPath(); ctx.moveTo(106, 63); ctx.quadraticCurveTo(122, 52, 138, 63);
  ctx.lineTo(153, 102); ctx.lineTo(158, 193); ctx.quadraticCurveTo(122, 213, 86, 193);
  ctx.lineTo(91, 102); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#384850'; ctx.beginPath(); ctx.moveTo(104, 92); ctx.lineTo(140, 92);
  ctx.lineTo(149, 123); ctx.lineTo(95, 123); ctx.closePath(); ctx.fill();
  ctx.fillRect(98, 133, 48, 39); ctx.fillRect(94, 184, 55, 8);
  ctx.fillStyle = '#0d141a'; for (const x of [81, 157]) {ctx.fillRect(x, 108, 7, 28); ctx.fillRect(x, 169, 7, 26);}
  ctx.fillStyle = '#25323c'; for (const y of [8, 96, 184]) {ctx.beginPath(); ctx.roundRect(246, y, 258, 76, 8); ctx.fill();}
  ctx.fillStyle = '#a8b9c3'; ctx.font = '22px sans-serif'; ctx.fillText('♪', 263, 55);
  ctx.strokeStyle = '#8499a5'; ctx.lineWidth = 3;
  for (const y of [36, 124, 212]) {ctx.beginPath(); ctx.moveTo(302, y); ctx.lineTo(473, y); ctx.moveTo(302, y + 17); ctx.lineTo(425, y + 17); ctx.stroke();}
  ctx.fillStyle = '#0d141a'; ctx.fillRect(0, 276, 512, 44);
  ctx.fillStyle = '#9cabb5'; for (let x = 35; x < 500; x += 73) {ctx.beginPath(); ctx.arc(x, 298, 5, 0, Math.PI * 2); ctx.fill();}
  const texture = new THREE.CanvasTexture(canvas); texture.name = 'garage-center-display-artwork';
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 2;
  return texture;
}

export function restoreCabin(model: THREE.Object3D, screenTexture: THREE.Texture | null) {
  const mesh = model.getObjectByName('Interior_Mesh042');
  if (!(mesh instanceof THREE.Mesh) || !mesh.geometry.index) throw new Error('Original vehicle cabin mesh is missing.');
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position'), index = geometry.index!;
  const parent = Array.from({length: position.count}, (_, i) => i), shared = new Map<string, number>();
  const find = (vertex: number): number => {
    while (parent[vertex] !== vertex) {parent[vertex] = parent[parent[vertex]]; vertex = parent[vertex];}
    return vertex;
  };
  const join = (a: number, b: number) => {parent[find(a)] = find(b);};
  for (let vertex = 0; vertex < position.count; vertex++) {
    const key = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)].map(v => Math.round(v * 1e5)).join(',');
    const other = shared.get(key);
    if (other !== undefined) join(vertex, other); else shared.set(key, vertex);
  }
  for (let i = 0; i < index.count; i += 3) {join(index.getX(i), index.getX(i + 1)); join(index.getX(i), index.getX(i + 2));}
  const bounds = new Map<number, THREE.Box3>(), point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const root = find(i);
    if (!bounds.has(root)) bounds.set(root, new THREE.Box3());
    bounds.get(root)!.expandByPoint(point.fromBufferAttribute(position, i));
  }
  const finishes = new Map([...bounds].map(([root, box]) => [root, cabinFinish(box)]));
  const indices: number[][] = [[], [], [], []];
  for (let i = 0; i < index.count; i += 3) {
    const output = indices[finishes.get(find(index.getX(i)))!];
    output.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
  }
  const makeMaterial = (name: string, value: number, roughness: number) => new THREE.MeshPhysicalMaterial({
    name, color: color(value), roughness, metalness: 0, side: THREE.DoubleSide,
    emissive: color(value), emissiveIntensity: .06, envMapIntensity: .8,
  });
  const materials = [makeMaterial('cabin-dashboard-trim', .13, .72), makeMaterial('cabin-seat-upholstery', .30, .78),
    makeMaterial('cabin-steering-leather', .17, .6), makeMaterial('cabin-headliner', .24, .85)];
  const previous = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mesh.material = materials;
  // Rebatch indices into four finishes. All original triangles, winding,
  // attributes and transforms survive without one draw per disconnected part.
  geometry.setIndex(indices.flat()); geometry.clearGroups();
  let start = 0;
  indices.forEach((values, material) => {if (values.length) geometry.addGroup(start, values.length, material); start += values.length;});
  previous.forEach(material => material.dispose());

  const cabin = new THREE.Group(); cabin.name = 'garage-cabin-details'; model.add(cabin);
  const display = new THREE.Group(); display.name = 'garage-center-display'; display.position.set(0, 1.115, -.59); display.rotation.x = -.12;
  const housing = new THREE.Mesh(new RoundedBoxGeometry(.372, .238, .018, 2, .007), new THREE.MeshPhysicalMaterial({
    name: 'cabin-display-bezel', color: color(.045), roughness: .32, metalness: .3,
  }));
  housing.name = 'garage-center-display-housing'; housing.castShadow = true;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(.35, .216), new THREE.MeshBasicMaterial({
    name: 'cabin-display-surface', map: screenTexture, color: 0xc0c0c0, toneMapped: false,
  }));
  face.name = 'garage-center-display-surface'; face.position.z = .0095;
  display.add(housing, face); cabin.add(display);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(.048, .09, .035), housing.material);
  stand.name = 'garage-center-display-stand'; stand.position.set(0, .96, -.61); cabin.add(stand);
  const fill = new THREE.RectAreaLight(0xffffff, 1.5, 1.05, 1.4);
  fill.name = 'garage-cabin-soft-fill'; fill.position.set(0, 1.43, .3); fill.lookAt(0, .6, .2); cabin.add(fill);
  return {sourceMesh: mesh.name, sourceTriangles: index.count / 3, components: bounds.size,
    seatTriangles: indices[1].length / 3, steeringTriangles: indices[2].length / 3,
    materialGroups: geometry.groups.length, display: display.name};
}
