import * as THREE from 'three';
import type { HingeAudit, PreparedVehicle, VehicleAudit, WheelAudit } from './vehicle-types';
import { createVehicleYield } from './vehicle-yield';

type ModelSId = 'models-2013' | 'models-2021';
type Plane = [number, number, number, number];
type Vertex = number[];
type Region = { key: string; planes: Plane[]; min: THREE.Vector3; max: THREE.Vector3 };
type Channel = { name: string; size: number; offset: number };
type Surface = { mesh: THREE.Mesh; sourceName: string; material: THREE.Material; box: THREE.Box3; wheel?: string; steering?: string };
type Work = { pause: () => Promise<void>; geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material> };

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const sideNames = ['driverFront', 'passengerFront', 'driverRear', 'passengerRear'] as const;

function boxRegion(key: string, min: number[], max: number[], extra: Plane[] = []): Region {
  return { key, min: V(min[0], min[1], min[2]), max: V(max[0], max[1], max[2]), planes: [
    [-1, 0, 0, min[0]], [1, 0, 0, -max[0]], [0, -1, 0, min[1]], [0, 1, 0, -max[1]],
    [0, 0, -1, min[2]], [0, 0, 1, -max[2]], ...extra,
  ] };
}

/** Presentation cuts follow the side openings; they do not claim factory rigging. */
function panelRegions(id: ModelSId): Region[] {
  const early = id === 'models-2013';
  const half = early ? .88 : .87;
  const regions = [
    boxRegion('chargePort', early ? [-1.1, .80, 2.08] : [-1.0, .84, 2.03], early ? [-.80, .99, 2.38] : [-.77, .99, 2.31]),
    early ? boxRegion('frunk', [-.80,.59,-2.48],[.80,1.12,-1.24],[[0,-1,.27,1.25],[1,0,-.21,-1.08],[-1,0,-.21,-1.08]])
      : boxRegion('frunk', [-.80, .61, -2.48], [.80, 1.10, -1.04], [[0, -1, .17, 1.058]]),
    boxRegion('trunk', [-.74, early ? .62 : .87, 1.20], [.74, 1.48, 2.50],early?[[1,0,-.09,-.46],[-1,0,-.09,-.46]]:[]),
  ];
  for (const [index, key] of sideNames.entries()) {
    const side = index % 2 === 0 ? -1 : 1;
    const rear = index >= 2;
    const min = [side < 0 ? -1.14 : .53, .29, rear ? .20 : -.99];
    const max = [side < 0 ? -.53 : 1.14, early ? 1.36 : 1.125, rear ? 1.26 : .20];
    // The inner cut stays outside seats and the centre console. At the top it follows the inward glass rake.
    const extra: Plane[] = [[-side, -.25, 0, half]];
    if (!rear) extra.push([0, .80, -1, -1.76]);
    else extra.push([0, .72, 1, -2.15]);
    regions.push(boxRegion(key, min, max, extra));
  }
  return regions;
}

function distance(v: Vertex, p: Plane) { return v[0] * p[0] + v[1] * p[1] + v[2] * p[2] + p[3]; }
function cut(poly: Vertex[], plane: Plane): [Vertex[], Vertex[]] {
  const inside: Vertex[] = [], outside: Vertex[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = distance(a, plane), db = distance(b, plane);
    const ai = da <= 1e-7, bi = db <= 1e-7;
    (ai ? inside : outside).push(a);
    if (ai !== bi) {
      const t = da / (da - db), intersection = a.map((value, k) => value + (b[k] - value) * t);
      inside.push(intersection); outside.push(intersection);
    }
  }
  return [inside, outside];
}

function partition(poly: Vertex[], region: Region): { inside: Vertex[]; outside: Vertex[][] } {
  let inside = poly;
  const outside: Vertex[][] = [];
  for (const plane of region.planes) {
    if (!inside.length) break;
    let min = Infinity, max = -Infinity;
    for (const vertex of inside) { const d = distance(vertex, plane); min = Math.min(min, d); max = Math.max(max, d); }
    if (max <= 1e-7) continue;
    if (min > 1e-7) { outside.push(inside); inside = []; break; }
    const split = cut(inside, plane); inside = split[0];
    if (split[1].length >= 3) outside.push(split[1]);
  }
  return { inside, outside };
}

function intersectsTriangle(a: Vertex, b: Vertex, c: Vertex, r: Region) {
  return !(Math.max(a[0], b[0], c[0]) < r.min.x || Math.min(a[0], b[0], c[0]) > r.max.x ||
    Math.max(a[1], b[1], c[1]) < r.min.y || Math.min(a[1], b[1], c[1]) > r.max.y ||
    Math.max(a[2], b[2], c[2]) < r.min.z || Math.min(a[2], b[2], c[2]) > r.max.z);
}

async function splitSurface(surface: Surface, regions: Region[], work: Work) {
  const geometry = surface.mesh.geometry;
  const names = ['position', ...Object.keys(geometry.attributes).filter(name => name !== 'position')];
  let stride = 0;
  const channels: Channel[] = names.map(name => { const size = geometry.getAttribute(name).itemSize; const result = { name, size, offset: stride }; stride += size; return result; });
  const buffers = new Map<string, number[]>();
  const read = (index: number) => {
    const result: number[] = [];
    for (const channel of channels) {
      const attr = geometry.getAttribute(channel.name);
      result.push(attr.getX(index));
      if (channel.size > 1) result.push(attr.getY(index));
      if (channel.size > 2) result.push(attr.getZ(index));
      if (channel.size > 3) result.push(attr.getW(index));
    }
    return result;
  };
  const emit = (key: string, poly: Vertex[]) => {
    let out = buffers.get(key); if (!out) { out = []; buffers.set(key, out); }
    for (let n = 1; n < poly.length - 1; n++) {
      const a = poly[0], b = poly[n], c = poly[n + 1];
      const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
      const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
      if (Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx) < 1e-11) continue;
      out.push(...a, ...b, ...c);
    }
  };
  const count = geometry.index?.count ?? geometry.attributes.position.count;
  for (let start = 0; start < count; start += 384) {
    await work.pause();
    for (let i = start, end = Math.min(start + 384, count); i < end; i += 3) {
    const a = read(geometry.index ? geometry.index.getX(i) : i);
    const b = read(geometry.index ? geometry.index.getX(i + 1) : i + 1);
    const c = read(geometry.index ? geometry.index.getX(i + 2) : i + 2);
    let remaining: Vertex[][] = [[a, b, c]];
    for (const region of regions) {
      if (!remaining.length) break;
      if (!intersectsTriangle(a, b, c, region)) continue;
      const next: Vertex[][] = [];
      for (const polygon of remaining) {
        const part = partition(polygon, region);
        if (part.inside.length >= 3) emit(region.key, part.inside);
        next.push(...part.outside);
      }
      remaining = next;
    }
    for (const polygon of remaining) emit('fixed', polygon);
    }
  }
  const parts: { key: string; mesh: THREE.Mesh }[] = [];
  for (const [key, values] of buffers) {
    if (!values.length) continue;
    const result = new THREE.BufferGeometry(), count = values.length / stride;
    work.geometries.add(result);
    for (const channel of channels) {
      const array = new Float32Array(count * channel.size);
      for (let start = 0; start < count; start += 2048) {
        await work.pause();
        for (let i = start, end = Math.min(start + 2048, count); i < end; i++) {
          for (let k = 0; k < channel.size; k++) array[i * channel.size + k] = values[i * stride + channel.offset + k];
        }
      }
      result.setAttribute(channel.name, new THREE.BufferAttribute(array, channel.size));
    }
    const normal = result.getAttribute('normal'), vector = new THREE.Vector3();
    for (let start = 0; start < normal.count; start += 2048) {
      await work.pause();
      for (let i = start, end = Math.min(start + 2048, normal.count); i < end; i++) {
        vector.fromBufferAttribute(normal, i).normalize(); normal.setXYZ(i, vector.x, vector.y, vector.z);
      }
    }
    await work.pause(); result.computeBoundingBox();
    await work.pause(); result.computeBoundingSphere();
    const mesh = new THREE.Mesh(result, surface.material);
    mesh.name = `${surface.mesh.name}__${key}`;
    mesh.userData = { ...surface.mesh.userData, sourceName: surface.sourceName, panel: key };
    parts.push({ key, mesh });
  }
  geometry.dispose(); work.geometries.delete(geometry);
  return parts;
}

function roleMaterial(original: THREE.Material, sourceName: string, id: ModelSId, tire: boolean, work: Work) {
  const material = original.clone();
  work.materials.add(material);
  const before = original.name;
  material.userData = { ...original.userData, sourceMaterialName: before };
  if (id === 'models-2013') {
    if (/bod_0$/.test(sourceName)) material.name = 'exterior_paint';
    else if (before === 'Material.002') material.name = 'glass';
    else if (before === 'Material.007') material.name = 'tire_rubber';
    else if (before === 'Rims') material.name = 'wheel_finish';
    else if (before === 'Material.006') material.name = 'brake_rotor';
    else if (/_int_0$/.test(sourceName)) material.name = 'interior_leather';
    else if (before === 'glass' && !sourceName.startsWith('oriol_')) material.name = 'lamp_lens';
  } else {
    if (/Pearl_White_Multi_Coat/.test(before)) material.name = 'exterior_paint';
    else if (/Windows$/.test(before)) material.name = 'glass';
    else if (tire) material.name = 'tire_rubber';
    else if (/Rims$/.test(before)) material.name = 'wheel_finish';
    else if (/ceramic_brake/.test(before)) material.name = 'brake_rotor';
    else if (/Interior$|koja_3|alc__/.test(before)) material.name = 'interior_leather';
  }
  const physical = material as THREE.MeshStandardMaterial;
  if (physical.isMeshStandardMaterial) {
    if (material.name === 'interior_leather') { physical.color.set('#bdb7aa'); physical.roughness = .86; physical.metalness = 0; }
    if (material.name === 'glass') { physical.color.set('#83949b'); physical.transparent = true; physical.opacity = .25; physical.depthWrite = false; physical.roughness = .12; physical.metalness = .03; }
    if (material.name === 'tire_rubber') { physical.color.set('#151719'); physical.roughness = .94; physical.metalness = 0; }
    if (material.name === 'exterior_paint') { physical.color.set('#a9acaf'); physical.roughness = .27; physical.metalness = .65; }
    if (id === 'models-2013' && before === 'Material.004') { physical.color.set('#101318'); physical.metalness = .30; }
  }
  material.side = THREE.DoubleSide;
  material.shadowSide = THREE.BackSide;
  return material;
}

async function editableGeometry(source: THREE.BufferGeometry, work: Work) {
  const geometry = source.clone();
  work.geometries.add(geometry);
  // Meshopt uses normalized integer positions. Bake decoded floating-point values before applying metre-space transforms.
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const values = new Float32Array(attribute.count * attribute.itemSize);
    for (let start = 0; start < attribute.count; start += 2048) {
      await work.pause();
      for (let i = start, end = Math.min(start + 2048, attribute.count); i < end; i++) {
        values[i * attribute.itemSize] = attribute.getX(i);
        if (attribute.itemSize > 1) values[i * attribute.itemSize + 1] = attribute.getY(i);
        if (attribute.itemSize > 2) values[i * attribute.itemSize + 2] = attribute.getZ(i);
        if (attribute.itemSize > 3) values[i * attribute.itemSize + 3] = attribute.getW(i);
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
  return geometry;
}

function nativePlaidPanel(surface: Surface): string | undefined {
  const number = Number(surface.sourceName.replace('Surface_', ''));
  if (number === 94) return 'frunk';
  if ([12, 13, 39, 97, 101, 106, 127, 176, 177, 191, 192, 206, 216, 217, 223, 224, 225, 232, 266].includes(number)) return 'trunk';
  if ([128, 129, 132, 133].includes(number)) return 'fixed';
  const side = surface.box.getCenter(new THREE.Vector3()).x < 0 ? 'driver' : 'passenger';
  if ([69, 70, 109, 110, 130, 131, 280, 281, 283].includes(number)) return `${side}Front`;
  if ([72, 73, 80, 81, 98, 99, 134, 135, 276, 277, 278, 279, 284, 285].includes(number)) return `${side}Rear`;
  if (surface.material.name === 'interior_leather') return 'fixed';
  const center = surface.box.getCenter(new THREE.Vector3()), size = surface.box.getSize(new THREE.Vector3());
  if (Math.abs(center.x) > .6 && size.z < .32 && size.y > .55 && center.z > 0 && center.z < .45) return 'fixed';
  return undefined;
}

async function earlyParts(surface: Surface, regions: Region[], work: Work) {
  const name=surface.sourceName;
  if(name.startsWith('isteven_'))return [{key:'fixed',mesh:surface.mesh}];
  if(/VidreDarrera|Matricula001|Box013/.test(name))return [{key:'trunk',mesh:surface.mesh}];
  const front=/PortaDavant|Plane013_vidre|Box005_|Box010_|Box031_/.test(name);
  const rear=/Object003_|Plane012_vidre|Box011_|Object002_/.test(name);
  if(front||rear){
    const half=front?'Front':'Rear';
    return splitSurface(surface,[boxRegion(`driver${half}`,[-2,-1,-4],[0,3,4]),boxRegion(`passenger${half}`,[0,-1,-4],[2,3,4])],work);
  }
  if(/Plane005_metalic_0/.test(name)){
    const parts=await splitSurface(surface,[...regions.filter(r=>['frunk','trunk','chargePort'].includes(r.key)),
      boxRegion('cargoLiner',[-.70,.30,-2.28],[.70,1.0,-1.24]),
    ],work);
    for(const part of parts)if(part.key==='cargoLiner'){
      const material=(part.mesh.material as THREE.MeshStandardMaterial).clone();material.name='cargo_liner';material.color.set('#171b1d');material.metalness=0;material.roughness=.93;
      work.materials.add(material);
      part.mesh.material=material;part.key='fixed';
    }
    for(const part of parts)if(part.key==='fixed'&&(part.mesh.material as THREE.Material).name==='exterior_paint'){
      const material=(part.mesh.material as THREE.Material).clone();material.side=THREE.FrontSide;part.mesh.material=material;
      work.materials.add(material);
    }
    return parts;
  }
  if(/Plane018_/.test(name))return splitSurface(surface,regions.filter(r=>r.key==='trunk'||r.key==='chargePort'),work);
  return [{key:'fixed',mesh:surface.mesh}];
}

function addEarlyDoorCards(scene: THREE.Group, pivots: Map<string,THREE.Group>, id: ModelSId) {
  const leather=new THREE.MeshStandardMaterial({name:'interior_leather',color:'#bdb7aa',roughness:.88,metalness:0});
  const trim=new THREE.MeshStandardMaterial({name:'door_trim',color:'#25282b',roughness:.75,metalness:.05});
  for(const [index,key]of sideNames.entries()){
    const side=index%2===0?-1:1,rear=index>=2,z0=rear?.28:-.81,z1=rear?1.18:.12;
    const shape=new THREE.Shape();shape.moveTo(-z0,.42);shape.lineTo(-z1+.08,.39);shape.lineTo(-z1,.86);shape.lineTo(-z1,.95);shape.lineTo(-z0,.91);shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:.025,bevelEnabled:true,bevelSegments:2,bevelSize:.025,bevelThickness:.012,curveSegments:3});
    geometry.rotateY(Math.PI/2);geometry.translate(side*.91-.0125,0,0);
    const panel=new THREE.Mesh(geometry,leather);panel.name=`${id}__${key}-door-card`;panel.userData.generatedLiner=true;scene.add(panel);scene.updateMatrixWorld(true);pivots.get(key)!.attach(panel);
    for(const [name,dimensions,position,material]of [
      ['armrest',[.085,.065,.43],[side*.855,.70,(z0+z1)/2],leather],
      ['handle',[.04,.022,.17],[side*.847,.82,z0+.23],trim],
      ['pocket',[.045,.12,.58],[side*.875,.49,(z0+z1)/2],trim],
    ] as const){
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(...dimensions),material);mesh.name=`${id}__${key}-${name}`;mesh.position.fromArray(position);mesh.userData.generatedLiner=true;scene.add(mesh);scene.updateMatrixWorld(true);pivots.get(key)!.attach(mesh);
    }
  }
}

function addFrunkLiner(scene: THREE.Group, id: ModelSId) {
  const material = new THREE.MeshStandardMaterial({ name: 'cargo_liner', color: '#171b1d', roughness: .93, metalness: 0, side: THREE.DoubleSide });
  // Static shallow luggage tub and rear firewall close the otherwise empty imported engine bay.
  const panels = [
    {name:'floor',size:[1.38,.035,1.10],center:[0,.36,-1.70]},
    {name:'left',size:[.035,.38,1.10],center:[-.69,.54,-1.70]},
    {name:'right',size:[.035,.38,1.10],center:[.69,.54,-1.70]},
    {name:'front',size:[1.38,.33,.035],center:[0,.52,-2.24]},
    id === 'models-2013' ? {name:'firewall',size:[1.48,.54,.035],center:[0,.63,-1.29]}
      : {name:'firewall',size:[1.53,.62,.035],center:[0,.67,-1.12]},
  ];
  for (const panel of panels) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...panel.size as [number,number,number]),material);
    mesh.name = `${id}__frunk-liner-${panel.name}`; mesh.position.fromArray(panel.center);
    mesh.userData.generatedLiner = true; scene.add(mesh);
  }
  if(id==='models-2013'){
    const cargo=[{name:'floor',size:[1.04,.04,.70],center:[0,.45,1.70]},
      {name:'left',size:[.035,.22,.70],center:[-.52,.57,1.70]},
      {name:'right',size:[.035,.22,.70],center:[.52,.57,1.70]},
      {name:'backrest',size:[1.04,.22,.035],center:[0,.57,1.35]}];
    for(const panel of cargo){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...panel.size as [number,number,number]),material);mesh.name=`${id}__cargo-liner-${panel.name}`;mesh.position.fromArray(panel.center);mesh.userData.generatedLiner=true;scene.add(mesh);}
  }
}

async function prepareSurfaces(source: THREE.Group, id: ModelSId, work: Work): Promise<{ surfaces: Surface[]; wheels: WheelAudit[] }> {
  source.updateMatrixWorld(true);
  const originalBounds = new THREE.Box3().setFromObject(source);
  const size = originalBounds.getSize(new THREE.Vector3());
  const center = originalBounds.getCenter(new THREE.Vector3());
  const length = id === 'models-2013' ? 4.978 : 5.021;
  const scale = length / size.z;
  const normalize = new THREE.Matrix4().makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI))
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -originalBounds.min.y, -center.z));
  const surfaces: Surface[] = [];
  const meshes: THREE.Mesh[] = [];
  source.traverse(object => {if (object instanceof THREE.Mesh) meshes.push(object);});
  for (const object of meshes) {
    await work.pause();
    const geometry = await editableGeometry(object.geometry, work);
    let matrix = object.matrixWorld.clone();
    // The heritage artist posed both front wheels. Cancel that local yaw before the runtime steering pivot is added.
    const wheelGroup = object.parent;
    if (id === 'models-2013' && wheelGroup && /^(wheel|cal)(001)?$/.test(wheelGroup.name)) {
      const position = wheelGroup.getWorldPosition(new THREE.Vector3());
      const axis = V(1, 0, 0).transformDirection(wheelGroup.matrixWorld);
      let yaw = Math.atan2(axis.z, axis.x);
      if (yaw > Math.PI / 2) yaw -= Math.PI; if (yaw < -Math.PI / 2) yaw += Math.PI;
      const straighten = new THREE.Matrix4().makeTranslation(position.x, position.y, position.z)
        .multiply(new THREE.Matrix4().makeRotationY(yaw))
        .multiply(new THREE.Matrix4().makeTranslation(-position.x, -position.y, -position.z));
      matrix = straighten.multiply(matrix);
    }
    await work.pause(); geometry.applyMatrix4(normalize.clone().multiply(matrix));
    await work.pause(); geometry.computeBoundingBox();
    const box = geometry.boundingBox!.clone(), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const name = object.name;
    const original = (Array.isArray(object.material) ? object.material[0] : object.material) as THREE.Material;
    const tire = id === 'models-2013' ? original.name === 'Material.007' || original.name === 'tire_rubber' : /dinghyblack/.test(original.name) && Math.abs(c.x) > .7 && c.y < .5 && s.y > .60 && s.z > .60;
    const number = Number(name.replace('Surface_', ''));
    const rolling = id === 'models-2013' ? /^(isteven_)?wheel/.test(name) : tire || /Rims$|ceramic_brake/.test(original.name) || [242, 244, 257, 258, 259, 260].includes(number);
    const caliper = id === 'models-2013' ? /^(isteven_)?cal/.test(name) : [261, 262, 263, 264].includes(number);
    const quadrant = `${c.x < 0 ? 'driver' : 'passenger'}-${c.z < 0 ? 'front' : 'rear'}`;
    const wheel = rolling ? quadrant : undefined, steering = caliper ? quadrant : undefined;
    const material = roleMaterial(original, name, id, tire, work);
    if (caliper) material.name = 'brake_caliper';
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `${id}__${name}`;
    mesh.userData = { ...object.userData, sourceName: name, tire };
    surfaces.push({ mesh, sourceName: name, material, box, wheel, steering });
  }
  const wheels: WheelAudit[] = [];
  for (const key of ['driver-front', 'passenger-front', 'driver-rear', 'passenger-rear']) {
    const members = surfaces.filter(surface => surface.wheel === key);
    const tires = members.filter(surface => surface.mesh.userData.tire);
    if (tires.length !== 1) throw new Error(`${id}: expected one tire for ${key}, received ${tires.length}`);
    const b = tires[0].box, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    wheels.push({ name: `${id}__wheel-${key}`, components: members.map(surface => surface.mesh.name), steeringComponents: surfaces.filter(surface => surface.steering === key).map(surface => surface.mesh.name), center: c.toArray(), radiusMetres: s.y / 2, axle: key.endsWith('front') ? 'front' : 'rear' });
  }
  return { surfaces, wheels };
}

export async function prepareModelS(source: THREE.Group, id: ModelSId, signal?: AbortSignal): Promise<PreparedVehicle> {
  const work: Work = { pause: createVehicleYield(signal), geometries: new Set(), materials: new Set() };
  const scene = new THREE.Group(); scene.name = `${id}__articulated`;
  try {
  await work.pause();
  const { surfaces, wheels } = await prepareSurfaces(source, id, work);
  const early = id === 'models-2013';
  const definitions: { stateKey: string; pivot: THREE.Vector3; angle: number; axis: number[] }[] = [
    { stateKey: 'driverFront', pivot: V(-.84, .96, early ? -.91 : -.98), angle: -1.04, axis: [0, 1, 0] },
    { stateKey: 'passengerFront', pivot: V(.84, .96, early ? -.91 : -.98), angle: 1.04, axis: [0, 1, 0] },
    { stateKey: 'driverRear', pivot: V(-.85, .95, .20), angle: -1.02, axis: [0, 1, 0] },
    { stateKey: 'passengerRear', pivot: V(.85, .95, .20), angle: 1.02, axis: [0, 1, 0] },
    { stateKey: 'frunk', pivot: V(0, early ? 1.0 : .98, early ? -1.24 : -1.04), angle: 1.08, axis: [1, 0, 0] },
    { stateKey: 'trunk', pivot: V(0, early ? 1.29 : 1.39, 1.20), angle: -1.08, axis: [1, 0, 0] },
    { stateKey: 'chargePort', pivot: early ? V(-.90, .90, 2.08) : V(-.86, .92, 2.03), angle: -1.25, axis: [0, 1, 0] },
  ];
  const pivots = new Map<string, THREE.Group>(), hinges: HingeAudit[] = [];
  for (const definition of definitions) {
    const pivot = new THREE.Group(); pivot.name = `${id}__${definition.stateKey}`; pivot.position.copy(definition.pivot); scene.add(pivot);
    pivots.set(definition.stateKey, pivot);
    hinges.push({ stateKey: definition.stateKey, name: pivot.name, axis: definition.axis, openRadians: definition.angle, durationSeconds: definition.stateKey === 'trunk' ? .85 : .6 });
  }
  const regions = panelRegions(id);
  for (const surface of surfaces) {
    await work.pause();
    if (surface.wheel || surface.steering) { scene.add(surface.mesh); continue; }
    const nativePanel = early ? undefined : nativePlaidPanel(surface);
    const plateRegion = boxRegion('trunk', [-.7,.60,2.20],[.7,1.15,2.50]);
    const parts = early ? await earlyParts(surface,regions,work) : nativePanel !== undefined ? [{key:nativePanel,mesh:surface.mesh}]
      : await splitSurface(surface, surface.sourceName === 'Surface_033' ? [plateRegion]
        : regions.filter(region => region.key !== 'frunk' && region.key !== 'trunk'),work);
    for (const { key, mesh } of parts) {
      scene.add(mesh);
      if (key !== 'fixed') { scene.updateMatrixWorld(true); pivots.get(key)!.attach(mesh); }
    }
  }
  addFrunkLiner(scene, id);
  if(early)addEarlyDoorCards(scene,pivots,id);
  await work.pause();
  for (const [key, pivot] of pivots) if (!pivot.children.length) throw new Error(`${id}: no source geometry mapped to ${key}`);
  scene.updateMatrixWorld(true);
  const portBounds = new THREE.Box3().setFromObject(pivots.get('chargePort')!);
  const chargeSocket = portBounds.getCenter(new THREE.Vector3()); chargeSocket.x = portBounds.min.x - .015;
  const audit: VehicleAudit = { nodeCount: 0, geometryCount: 0, triangles: 0, hinges, wheels, groundingTranslation: [0, 0, 0] };
  scene.traverse(node => {
    node.userData.sourceNodeIndex = audit.nodeCount++;
    if (node instanceof THREE.Mesh) { audit.geometryCount++; audit.triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3; }
  });
  scene.userData.modelIdentity = early ? 'Early Model S; 2013-era exterior, exact year not supplied by original artist' : '2021-refresh Model S Plaid; exact trim not manufacturer-verified';
  scene.userData.articulation = 'Source surfaces partitioned into presentation panels; imported cabin geometry retained';
  return { scene, audit, chargeSocket, nativeMaterials: true };
  } catch (error) {
    // An abort can arrive before a converted surface has joined the result.
    // Dispose every resource created here, including those temporary surfaces;
    // source textures and source geometry remain owned by the caller.
    scene.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      work.geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) work.materials.add(material);
    });
    work.geometries.forEach(geometry => geometry.dispose());
    work.materials.forEach(material => material.dispose());
    scene.clear();
    throw error;
  }
}
