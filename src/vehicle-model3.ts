import * as THREE from 'three';
import type {PreparedVehicle, VehicleAudit, HingeAudit, WheelAudit} from './vehicle-types';

type Model3ID = 'model3-2018' | 'model3-2024';
type Part = 'body' | 'driverFront' | 'passengerFront' | 'driverRear' | 'passengerRear' | 'frunk' | 'trunk' | 'chargePort' | 'wheelFL' | 'wheelFR' | 'wheelRL' | 'wheelRR';
type Piece = {geometry: THREE.BufferGeometry; name: string; material: THREE.Material; ancestors: string[]};
type Island = {indices: number[]; bounds: THREE.Box3};
const wheelParts: Part[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
const panelParts: Part[] = ['driverFront', 'passengerFront', 'driverRear', 'passengerRear', 'frunk', 'trunk', 'chargePort'];
const normal = new THREE.Vector3();

/** Compact an index selection without discarding normals, UVs, colors or tangents. */
function selectedGeometry(source: THREE.BufferGeometry, selected: number[]) {
  const indices: number[] = [], originals: number[] = [], remap = new Map<number, number>();
  for (const old of selected) {
    let next = remap.get(old);
    if (next === undefined) {next = originals.length; remap.set(old, next); originals.push(old);}
    indices.push(next);
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const values = new Float32Array(originals.length * attribute.itemSize);
    for (let i = 0; i < originals.length; i++) for (let c = 0; c < attribute.itemSize; c++) values[i * attribute.itemSize + c] = attribute.getComponent(originals[i], c);
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
  geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** Keep authored index seams. Position welding would join the Highland trunk to its bumper. */
function islands(geometry: THREE.BufferGeometry): Island[] {
  const positions = geometry.getAttribute('position'), index = geometry.index;
  const parents = Int32Array.from({length: positions.count}, (_, i) => i);
  const find = (n: number): number => {while (parents[n] !== n) {parents[n] = parents[parents[n]]; n = parents[n];} return n;};
  const union = (a: number, b: number) => {a = find(a); b = find(b); if (a !== b) parents[b] = a;};
  const at = (i: number) => index ? index.getX(i) : i;
  const count = index?.count ?? positions.count;
  for (let i = 0; i < count; i += 3) {union(at(i), at(i + 1)); union(at(i), at(i + 2));}
  const result = new Map<number, Island>();
  const point = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    const root = find(at(i)); let island = result.get(root);
    if (!island) {island = {indices: [], bounds: new THREE.Box3()}; result.set(root, island);}
    for (let k = 0; k < 3; k++) {const j = at(i + k); island.indices.push(j); island.bounds.expandByPoint(point.fromBufferAttribute(positions, j));}
  }
  return [...result.values()];
}

/** Split a lens on its charging-flap seam; all interpolated vertex attributes survive. */
function clipFlap(source: THREE.BufferGeometry, planes: THREE.Plane[]): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const names = Object.keys(source.attributes), attributes = names.map(n => source.getAttribute(n));
  const offsets: number[] = []; let stride = 0;
  for (const a of attributes) {offsets.push(stride); stride += a.itemSize;}
  const p = offsets[names.indexOf('position')], idx = source.index;
  const inside: number[] = [], outside: number[] = [];
  const read = (i: number) => attributes.flatMap(a => Array.from({length: a.itemSize}, (_, c) => a.getComponent(i, c)));
  const emit = (polygon: number[][], destination: number[]) => {for (let j = 1; j + 1 < polygon.length; j++) destination.push(...polygon[0], ...polygon[j], ...polygon[j + 1]);};
  const distance = (v: number[], plane: THREE.Plane) => plane.normal.x * v[p] + plane.normal.y * v[p + 1] + plane.normal.z * v[p + 2] + plane.constant;
  for (let i = 0; i < (idx?.count ?? source.attributes.position.count); i += 3) {
    let polygon = [0, 1, 2].map(k => read(idx ? idx.getX(i + k) : i + k));
    for (const plane of planes) {
      if (!polygon.length) break;
      const keep: number[][] = [], reject: number[][] = [];
      for (let k = 0; k < polygon.length; k++) {
        const a = polygon[k], b = polygon[(k + 1) % polygon.length], da = distance(a, plane), db = distance(b, plane);
        (da <= 1e-8 ? keep : reject).push(a);
        if ((da < -1e-8 && db > 1e-8) || (da > 1e-8 && db < -1e-8)) {
          const t = da / (da - db), crossing = a.map((v, n) => v + (b[n] - v) * t);
          keep.push(crossing); reject.push(crossing);
        }
      }
      if (reject.length >= 3) emit(reject, outside);
      polygon = keep;
    }
    if (polygon.length >= 3) emit(polygon, inside);
  }
  const build = (data: number[]) => {
    const g = new THREE.BufferGeometry(), count = data.length / stride;
    names.forEach((name, a) => {
      const size = attributes[a].itemSize, values = new Float32Array(count * size);
      for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) values[i * size + k] = data[i * stride + offsets[a] + k];
      g.setAttribute(name, new THREE.BufferAttribute(values, size));
    });
    if (g.getAttribute('normal')) g.normalizeNormals();
    g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  };
  return [build(inside), build(outside)];
}

function materialRole(original: THREE.Material, id: Model3ID) {
  const name = original.name;
  if (id === 'model3-2018') {
    if (/^primary(?:\.|$)/i.test(name)) return 'exterior_paint';
    if (/^glass\./i.test(name)) return 'glass';
    if (name === 'wheels.3') return 'tire_rubber';
    if (/^wheels\.[126]$/.test(name)) return 'wheel_finish';
    if (name === 'wheels.4') return 'brake_rotor';
    if (/Seat_Leather/i.test(name)) return 'interior_leather';
  } else {
    if (name === 'ext_carpaint' || name === 'int_carpaint') return 'exterior_paint';
    if (name === 'EXT_Window' || name === 'INT_Window') return 'glass';
    if (name === 'Tyre') return 'tire_rubber';
    if (name === 'RIM_2' || name === 'material') return 'wheel_finish';
    if (name === 'Brake_Disc') return 'brake_rotor';
    if (/^int_leather/.test(name)) return 'interior_leather';
  }
  return name;
}

function prepareMaterials(original: THREE.Material, id: Model3ID, cache: Map<string, THREE.Material>) {
  const key = original.uuid;
  let result = cache.get(key); if (result) return result;
  result = original.clone(); result.userData = {...original.userData, originalName: original.name};
  result.name = materialRole(original, id);
  const m = result as THREE.MeshStandardMaterial;
  // The source's double-sided wheels otherwise shadow their own thin, adjoining faces.
  m.shadowSide = THREE.BackSide;
  if (result.name === 'exterior_paint') {m.map = null; m.metalness = .45; m.roughness = .25; m.color.set('#b7bdc6');}
  if (result.name === 'glass') {m.color.set('#c7d5df'); m.transparent = true; m.opacity = .24; m.depthWrite = false; m.metalness = .08; m.roughness = .12; m.side = THREE.DoubleSide;}
  if (/Headlight_Glass|Taillight_Glass/.test(original.name)) {m.transparent = true; m.opacity = .55; m.depthWrite = false; m.roughness = .18;}
  if (id === 'model3-2018' && original.name === 'tembus_red.0') {m.transparent = true; m.opacity = .28; m.depthWrite = false; m.roughness = .12;}
  if (result.name === 'interior_leather') {m.metalness = 0; m.roughness = .8;}
  if (result.name === 'tire_rubber') {m.metalness = 0; m.roughness = .88;}
  if (id === 'model3-2024' && result.name === 'wheel_finish') {
    // Separate painted inserts from alloy spokes; their authored geometry is retained.
    m.map = null; m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; m.aoMap = null;
    m.side = THREE.FrontSide; m.color.set(original.name === 'RIM_2' ? '#22262b' : '#91979e');
    m.metalness = original.name === 'RIM_2' ? .15 : .65; m.roughness = .42;
  }
  if (/LCDs|INT_Screen/.test(original.name)) {m.emissive.set('#ffffff'); m.emissiveMap = m.map; m.emissiveIntensity = .25; m.roughness = .5;}
  cache.set(key, result); return result;
}

function nativePart(ancestors: string[]): Part {
  const mapping: Record<string, Part> = {door_lf_dummy: 'driverFront', door_rf_dummy: 'passengerFront', door_lr_dummy: 'driverRear', door_rr_dummy: 'passengerRear', bonnet_dummy: 'frunk', boot_dummy: 'trunk'};
  return ancestors.map(n => mapping[n]).find(Boolean) ?? 'body';
}

function corner(center: THREE.Vector3): Part {return center.z < 0 ? (center.x < 0 ? 'wheelFL' : 'wheelFR') : (center.x < 0 ? 'wheelRL' : 'wheelRR');}

function highlandPart(island: Island, originalMaterial: string, sourceName: string): Part {
  const b = island.bounds, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
  const side = c.x < 0 ? 'driver' : 'passenger';
  // The side lens and its black backing are distinct authored islands, not an overlay.
  if (/Black_Glass|Body_Black|EXT_Taillight_Glass|Lights/.test(originalMaterial) && b.max.x < -.70 && b.min.z > 1.75 && b.max.z < 2.12 && b.min.y > .76 && b.max.y < 1.06) return 'chargePort';
  if (/^(Tyre|RIM_2|material|Brake_Disc)$/.test(originalMaterial)) return corner(c);
  // Carpaint's four door skins have actual seams; retain those index boundaries.
  if (originalMaterial === 'ext_carpaint' && sourceName === 'Object_32') {
    if (Math.abs(c.x) > .70 && s.x < .36 && s.z < 1.30 && b.min.y > .22 && b.max.y < 1.09 && c.z > -.97 && c.z < 1.35) return `${side}${c.z < .19 ? 'Front' : 'Rear'}` as Part;
    if (Math.abs(c.x) > .90 && c.z < -.45 && c.z > -.85 && b.min.y > .9) return `${side}Front` as Part;
    if (b.min.x > -.76 && b.max.x < .76 && b.max.z < -1.08 && b.min.z > -2.30 && b.min.y > .62) return 'frunk';
  }
  // The rear bumper is a different index island despite coincident seam vertices.
  if (originalMaterial === 'ext_carpaint' && sourceName === 'Object_33') {
    if (b.min.y > .63 && Math.max(Math.abs(b.min.x), Math.abs(b.max.x)) < .79) return 'trunk';
    return 'body';
  }
  // Interior lid liners and attached hardware, excluding the stationary tubs/floors.
  if (/int_carpaint|int_chrome|ext_carpaint|EXT_Chrome_Badge/.test(originalMaterial) && b.max.z < -1.08 && b.min.z > -2.31 && b.min.y > .63 && Math.max(Math.abs(b.min.x), Math.abs(b.max.x)) < .76) return 'frunk';
  if (/int_carpaint|int_chrome|EXT_PLATE|EXT_Chrome_Badge|int_plastic/.test(originalMaterial) && b.min.z > 1.52 && b.min.y > .63 && Math.max(Math.abs(b.min.x), Math.abs(b.max.x)) < .79 && s.z < .90) return 'trunk';
  if (/EXT_Taillight_Glass|Black_Glass|Lights|Taillight_Detail|Body_Black|ext_plastic/.test(originalMaterial) && b.min.z > 2.02 && b.min.y > .65 && b.max.y < 1.10 && Math.max(Math.abs(b.min.x), Math.abs(b.max.x)) < .72) return 'trunk';
  // Individual door glass/trim/liners. Long sill, roof, A/B/C pillars and cabin stay fixed.
  const doorMaterial = /EXT_Window|INT_Window|ext_carpaint_black|int_carpaint|int_leather|int_plastic|int_chrome|int_grille|int_rubbertrim|Mirror|INT_LED|Lights/.test(originalMaterial);
  if (doorMaterial && Math.abs(c.x) > .62 && b.min.y > .25 && b.max.y < 1.39 && s.x < .39 && s.z < 1.35) {
    if (b.min.z > -.99 && b.max.z < .36 && c.z < .22) return `${side}Front` as Part;
    if (b.min.z > .18 && b.max.z < 1.34 && c.z > .24) return `${side}Rear` as Part;
  }
  // Mirrors follow the front door, including glass/chrome rather than only their painted shells.
  if (Math.abs(c.x) > .9 && c.z < -.45 && c.z > -.85 && b.min.y > .9 && s.z < .3) return `${side}Front` as Part;
  return 'body';
}

export function prepareModel3(source: THREE.Group, id: Model3ID): PreparedVehicle {
  source.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(source), center = box.getCenter(new THREE.Vector3());
  const scale = (id === 'model3-2018' ? 4.69 : 4.72) / box.getSize(new THREE.Vector3()).z;
  const transform = new THREE.Matrix4().makeRotationY(id === 'model3-2024' ? Math.PI : 0)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  const scene = new THREE.Group(); scene.name = id;
  const groups = new Map<Part, THREE.Group>();
  for (const part of ['body', ...panelParts, ...wheelParts] as Part[]) {const group = new THREE.Group(); group.name = `${id}-${part}`; groups.set(part, group); scene.add(group);}
  const materials = new Map<string, THREE.Material>(), pieces: Piece[] = [];
  const steeringComponents = new Map<Part, string[]>(wheelParts.map(part => [part, []]));
  const nativePivots = new Map<Part, THREE.Vector3>();
  source.traverse(object => {
    const part = nativePart([object.name]);
    if (part !== 'body') nativePivots.set(part, object.getWorldPosition(new THREE.Vector3()).applyMatrix4(transform));
    if (!(object instanceof THREE.Mesh)) return;
    if (Array.isArray(object.material)) throw new Error('Model 3 source unexpectedly contains a multi-material mesh.');
    const geometry = object.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(transform, object.matrixWorld));
    geometry.computeBoundingBox();
    const ancestors: string[] = []; for (let current: THREE.Object3D | null = object; current; current = current.parent) ancestors.push(current.name);
    pieces.push({geometry, name: object.name, material: object.material, ancestors});
  });
  const tireCenters = new Map<Part, THREE.Vector3>();
  if (id === 'model3-2024') {
    const tireBounds = new Map<Part, THREE.Box3>();
    for (const piece of pieces) if (piece.material.name === 'Tyre') for (const island of islands(piece.geometry)) {
      const part = corner(island.bounds.getCenter(new THREE.Vector3()));
      const bounds = tireBounds.get(part) ?? new THREE.Box3(); bounds.union(island.bounds); tireBounds.set(part, bounds);
    }
    for (const [part, bounds] of tireBounds) tireCenters.set(part, bounds.getCenter(new THREE.Vector3()));
  }
  let serial = 0;
  const add = (part: Part, geometry: THREE.BufferGeometry, piece: Piece) => {
    if (!geometry.attributes.position.count) {geometry.dispose(); return;}
    const mesh = new THREE.Mesh(geometry, prepareMaterials(piece.material, id, materials));
    mesh.name = `${id}-${piece.name}-${serial++}`;
    mesh.userData = {originalName: piece.name, originalMaterial: piece.material.name, articulatedPart: part};
    mesh.castShadow = mesh.material.name !== 'glass'; mesh.receiveShadow = true;
    groups.get(part)!.add(mesh); return mesh;
  };
  for (const piece of pieces) {
    const buckets = new Map<Part, number[]>(), position = piece.geometry.attributes.position;
    const isCaliper = piece.material.name === (id === 'model3-2018' ? 'wheels.0' : 'Caliper');
    const append = (part: Part, indices: number[]) => {const bucket = buckets.get(part) ?? []; for (const i of indices) bucket.push(i); buckets.set(part, bucket);};
    if (id === 'model3-2018') {
      const basePart = nativePart(piece.ancestors);
      if (/^wheels/.test(piece.name)) {
        const index = piece.geometry.index, c = new THREE.Vector3();
        for (let i = 0; i < (index?.count ?? position.count); i += 3) {
          const ids = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k); c.set(0, 0, 0);
          for (const v of ids) c.add(normal.fromBufferAttribute(position, v)); c.multiplyScalar(1 / 3);
          append(corner(c), ids);
        }
      } else if (basePart === 'body' && /^(black_lights_black_lights|tembus_belakang)/.test(piece.name)) {
        const planes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), .755), new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.985), new THREE.Plane(new THREE.Vector3(0, 0, -1), 1.735)];
        const [flap, fixed] = clipFlap(piece.geometry, planes);
        add('chargePort', flap, piece); add('body', fixed, piece); piece.geometry.dispose(); continue;
      } else {add(basePart, piece.geometry, piece); continue;}
    } else {
      for (const island of islands(piece.geometry)) {
        const center = island.bounds.getCenter(new THREE.Vector3()), wheel = corner(center);
        if (piece.material.name === 'RIM_2') {
          const tire = tireCenters.get(wheel)!;
          // The source's outer black inserts intersect its complete alloy spokes.
          // Keep its real hub cover/badge, and show the original uncovered alloy wheel.
          if (Math.hypot(center.y - tire.y, center.z - tire.z) > .12) continue;
        }
        append(isCaliper ? wheel : highlandPart(island, piece.material.name, piece.name), island.indices);
      }
    }
    for (const [part, indices] of buckets) {
      const mesh = add(isCaliper ? 'body' : part, selectedGeometry(piece.geometry, indices), piece);
      // The runtime attaches these to steering pivots, outside their rolling children.
      if (isCaliper && mesh) steeringComponents.get(part)!.push(mesh.name);
    }
    piece.geometry.dispose();
  }
  scene.updateMatrixWorld(true);
  const panelBounds = new Map<Part, THREE.Box3>();
  for (const part of panelParts) {
    const group = groups.get(part)!, bounds = new THREE.Box3().setFromObject(group);
    if (bounds.isEmpty()) throw new Error(`${id}: the real ${part} geometry could not be resolved.`);
    panelBounds.set(part, bounds);
  }
  const pivots: Record<string, THREE.Vector3> = {};
  for (const part of panelParts) {
    const b = panelBounds.get(part)!, c = b.getCenter(new THREE.Vector3());
    if (id === 'model3-2018' && nativePivots.has(part)) pivots[part] = nativePivots.get(part)!.clone();
    else if (part === 'frunk') pivots[part] = new THREE.Vector3(0, b.max.y - .015, b.max.z - .015);
    else if (part === 'trunk') pivots[part] = new THREE.Vector3(0, b.max.y - .04, b.min.z + .015);
    else if (part === 'chargePort') pivots[part] = new THREE.Vector3(c.x, b.max.y, c.z);
    else pivots[part] = new THREE.Vector3(part.startsWith('driver') ? b.min.x + .04 : b.max.x - .04, .73, b.min.z + .025);
  }
  const hinges: HingeAudit[] = panelParts.map(part => ({
    stateKey: part, name: groups.get(part)!.name,
    axis: part === 'frunk' || part === 'trunk' ? [1, 0, 0] : part === 'chargePort' ? [0, 0, 1] : [0, 1, 0],
    openRadians: part === 'frunk' ? .82 : part === 'trunk' ? -1.12 : part === 'chargePort' ? -1.3 : (part.startsWith('driver') ? -1 : 1) * (part.endsWith('Front') ? 1.02 : .96),
    durationSeconds: part === 'frunk' || part === 'trunk' ? 1.15 : .55,
  }));
  for (const part of panelParts) {
    const group = groups.get(part)!, pivot = pivots[part];
    group.position.copy(pivot);
    group.traverse(object => {if (object instanceof THREE.Mesh) object.geometry.translate(-pivot.x, -pivot.y, -pivot.z);});
  }
  const wheels: WheelAudit[] = wheelParts.map((part, index) => {
    const group = groups.get(part)!, b = new THREE.Box3().setFromObject(group);
    if (b.isEmpty()) throw new Error(`${id}: missing real ${part} geometry.`);
    const c = b.getCenter(new THREE.Vector3());
    const meshes: string[] = []; group.traverse(object => {if (object instanceof THREE.Mesh) meshes.push(object.name);});
    return {name: `${id}-wheel-pivot-${index}`, components: meshes, steeringComponents: steeringComponents.get(part), center: c.toArray(), radiusMetres: b.getSize(new THREE.Vector3()).y / 2, axle: part.endsWith('FL') || part.endsWith('FR') ? 'front' : 'rear'};
  });
  const flap = panelBounds.get('chargePort')!, socket = flap.getCenter(new THREE.Vector3()); socket.x = flap.max.x + .006;
  // Fixed recess sits behind the original moving lens and is concealed when closed.
  const socketMaterial = new THREE.MeshStandardMaterial({name: 'charging_socket', color: '#101216', roughness: .8});
  const recess = new THREE.Mesh(new THREE.CylinderGeometry(.046, .046, .014, 24), socketMaterial);
  recess.name = `${id}-charging-socket`; recess.rotation.z = Math.PI / 2; recess.position.copy(socket); scene.add(recess);
  scene.updateMatrixWorld(true);
  const audit: VehicleAudit = {nodeCount: 0, geometryCount: 0, triangles: 0, hinges, wheels, groundingTranslation: [0, 0, 0]};
  scene.traverse(object => {
    object.userData.sourceNodeIndex = audit.nodeCount++;
    if (object instanceof THREE.Mesh) {audit.geometryCount++; audit.triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;}
  });
  scene.userData.vehicleModel = id;
  scene.userData.sourceCredit = id === 'model3-2018' ? 'Tesla 2018 Model 3 by Ameer Studio, CC BY 4.0' : '2024 Tesla Model 3 + Interior by tonielpro520, CC BY 4.0; CabinWise copy';
  return {scene, audit, chargeSocket: new THREE.Vector3(flap.min.x - .012, socket.y, socket.z), nativeMaterials: true};
}
