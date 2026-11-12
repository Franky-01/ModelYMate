import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type {HingeAudit, PreparedVehicle, WheelAudit} from './vehicle-types';

type XYModel = 'modelx-2020' | 'modely-2021';

/** The licensed source panels are separated offline without dropping triangles.
 * Their extras identify parts; this adapter supplies the closed mechanical pivots.
 */
export function prepareModelXY(source: THREE.Group, id: XYModel): PreparedVehicle {
  const isX = id === 'modelx-2020';
  const parts = new Map<string, THREE.Mesh[]>();
  source.name = `${id}-vehicle`;
  source.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const part = String(node.userData.vehiclePart || 'body');
    const meshes = parts.get(part) ?? [];
    meshes.push(node); parts.set(part, meshes);
    // Preserve original maps; only wheel metal receives the shared finish name.
    const rename = (original: THREE.Material) => {
      if (!part.startsWith('wheel-') || /tire_rubber|brake_rotor|Carro_Freio/.test(original.name)) return original;
      const material = original.clone() as THREE.MeshStandardMaterial;
      material.name = 'wheel_finish'; material.metalness = .82; material.roughness = .32;
      return material;
    };
    node.material = Array.isArray(node.material) ? node.material.map(rename) : rename(node.material);
  });
  source.updateMatrixWorld(true);
  const hinges: HingeAudit[] = [];
  const hinge = (part: string, stateKey: string, position: number[], axis: number[], openRadians: number, durationSeconds = .6, parent: THREE.Object3D = source, motion?: HingeAudit['motion']) => {
    const meshes = parts.get(part);
    if (!meshes?.length) throw new Error(`Vehicle ${id} is missing articulated part ${part}`);
    const pivot = new THREE.Group(); pivot.name = `${id}-${part}-hinge`;
    source.add(pivot); pivot.position.fromArray(position); source.updateMatrixWorld(true);
    for (const mesh of meshes) pivot.attach(mesh);
    if (parent !== source) parent.attach(pivot);
    hinges.push({name: pivot.name, stateKey, axis, openRadians, durationSeconds, ...(motion ? {motion} : {})});
    return pivot;
  };
  hinge('front-left', 'driverFront', isX ? [-.94, 1.04, -.98] : [-.80, 1.04, -.91], [0, 1, 0], -1.05);
  hinge('front-right', 'passengerFront', isX ? [.94, 1.04, -.98] : [.80, 1.04, -.91], [0, 1, 0], 1.05);
  if (isX) {
    for (const [side, sign, stateKey] of [['left', -1, 'driverRear'], ['right', 1, 'passengerRear']] as const) {
      // The roof joint rises beside the spine; the shoulder counter-rotates,
      // leaving the exterior door panel hanging down from its raised elbow.
      // Adding both rotations would wrongly flip the lower edge above the roof.
      const upper = hinge(`falcon-upper-${side}`, stateKey, [sign * .12, 1.64, .89], [0, 0, 1], sign * 1.35, 1.8, source, 'falcon-upper');
      hinge(`falcon-lower-${side}`, stateKey, [sign * .68, 1.55, .89], [0, 0, 1], -sign * .25, 1.8, upper, 'falcon-lower');
    }
  } else {
    hinge('rear-left', 'driverRear', [-.85, 1.10, .25], [0, 1, 0], -.98);
    hinge('rear-right', 'passengerRear', [.85, 1.10, .25], [0, 1, 0], .98);
  }
  hinge('frunk', 'frunk', isX ? [0, 1.109, -1.400] : [0, 1.09, -1.17], [1, 0, 0], .88, 1.15);
  hinge('trunk', 'trunk', isX ? [0, 1.569, 1.453] : [0, 1.52, 1.35], [1, 0, 0], -1.12, 1.15);
  hinge('chargePort', 'chargePort', isX ? [-.85, 1.102, 2.16] : [-.75, 1.10, 1.94], [0, 0, 1], -1.3);

  const wheels: WheelAudit[] = [];
  for (const axle of ['front', 'rear'] as const) for (const side of ['left', 'right'] as const) {
    const part = `wheel-${axle}-${side}`, meshes = parts.get(part);
    if (!meshes?.length) throw new Error(`Vehicle ${id} is missing ${part}`);
    const box = new THREE.Box3();
    for (const mesh of meshes) box.union(new THREE.Box3().setFromObject(mesh));
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    wheels.push({name: `${id}-${part}`, components: meshes.map(mesh => mesh.name), center: center.toArray(), radiusMetres: (size.y + size.z) / 4, axle});
  }

  if (isX) addLegacyXCabin(source);
  addStorageWells(source, isX);
  const chargeSocket = isX ? new THREE.Vector3(-.88, 1.015, 2.21) : new THREE.Vector3(-.765, 1.066, 1.995);
  // Locate the actual curved lamp surface, then recess the fixed receptacle.
  // A bounding-box X coordinate would leave it floating outside the tapering tail.
  const ray = new THREE.Raycaster(new THREE.Vector3(-3, chargeSocket.y, chargeSocket.z), new THREE.Vector3(1, 0, 0));
  const surface = ray.intersectObjects(parts.get('chargePort') ?? [], false)[0];
  if (surface) chargeSocket.x = surface.point.x + .018;
  addSocket(source, chargeSocket, isX);
  // Include every generated node in the audit, not just the original source indices.
  let nodeCount = 0, geometryCount = 0, triangles = 0;
  source.traverse(node => {
    node.userData.sourceNodeIndex = nodeCount++;
    if (node instanceof THREE.Mesh) {
      geometryCount++;
      triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    }
  });
  source.updateMatrixWorld(true);
  return {scene: source, nativeMaterials: true, chargeSocket, audit: {nodeCount, geometryCount, triangles, hinges, wheels, groundingTranslation: [0, 0, 0]}};
}

function solid(parent: THREE.Object3D, name: string, size: number[], position: number[], material: THREE.Material, radius = .035) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(radius, ...size.map(n => n / 3))), material);
  mesh.name = name; mesh.position.fromArray(position); parent.add(mesh); return mesh;
}

/** Added locally: the CC source has door cards but no seats/dashboard.
 * This is a modest legacy-layout cabin (portrait display / round wheel), not an
 * assertion that the source author supplied an exact 2020 trim specification.
 */
function addLegacyXCabin(scene: THREE.Group) {
  const cabin = new THREE.Group(); cabin.name = 'modelx-added-legacy-cabin';
  cabin.userData.provenance = 'ModelYMate original integration geometry; approximate legacy five-seat layout'; scene.add(cabin);
  const leather = new THREE.MeshStandardMaterial({name: 'interior_leather', color: 0x292b2e, roughness: .8});
  const trim = new THREE.MeshStandardMaterial({name: 'legacy_x_soft_trim', color: 0x121519, roughness: .7});
  const silver = new THREE.MeshStandardMaterial({name: 'legacy_x_cabin_metal', color: 0x91969c, roughness: .3, metalness: .75});
  const wood = new THREE.MeshStandardMaterial({name: 'legacy_x_dashboard_wood', color: 0x5c4432, roughness: .62});
  const screen = new THREE.MeshStandardMaterial({name: 'legacy_x_display', color: 0x172b38, roughness: .25, emissive: 0x172b38, emissiveIntensity: .35});
  solid(cabin, 'legacy_x_floor', [1.55, .09, 3.12], [0, .43, .51], trim);
  solid(cabin, 'legacy_x_dashboard', [1.48, .24, .39], [0, .98, -.96], trim, .09);
  solid(cabin, 'legacy_x_dashboard_wood', [1.4, .065, .05], [0, 1.025, -.748], wood, .015);
  solid(cabin, 'legacy_x_console', [.27, .26, .83], [0, .66, -.33], trim, .045);
  solid(cabin, 'legacy_x_portrait_display_frame', [.28, .43, .038], [.02, .91, -.718], silver, .015);
  solid(cabin, 'legacy_x_portrait_display', [.255, .401, .012], [.02, .91, -.691], screen, .009);
  solid(cabin, 'legacy_x_instrument_binnacle', [.4, .16, .19], [-.43, 1.12, -.89], trim, .045);
  solid(cabin, 'legacy_x_instrument_display', [.31, .105, .013], [-.43, 1.11, -.786], screen, .015);
  const steering = new THREE.Group(); steering.name = 'legacy_x_round_steering'; steering.position.set(-.43, 1.04, -.61); steering.rotation.x = -.28; cabin.add(steering);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.166, .019, 10, 36), leather); rim.name = 'legacy_x_steering_rim'; steering.add(rim);
  solid(steering, 'legacy_x_steering_hub', [.16, .085, .055], [0, -.015, 0], leather, .025);
  solid(steering, 'legacy_x_steering_spoke_left', [.1, .024, .025], [-.105, -.012, 0], silver, .006);
  solid(steering, 'legacy_x_steering_spoke_right', [.1, .024, .025], [.105, -.012, 0], silver, .006);
  solid(steering, 'legacy_x_steering_spoke_bottom', [.035, .12, .03], [0, -.095, 0], silver, .008);
  const seat = (name: string, x: number, z: number, width: number, front: boolean) => {
    solid(cabin, `${name}_base`, [width, .17, .52], [x, .59, z], leather, .07);
    const back = solid(cabin, `${name}_back`, [width, .58, .16], [x, .94, z + .25], leather, .065); back.rotation.x = -.11;
    solid(cabin, `${name}_headrest`, [width * .57, .22, .135], [x, 1.31, z + .30], leather, .05);
    if (front) for (const sign of [-1, 1]) {
      solid(cabin, `${name}_bolster_${sign}`, [.075, .18, .44], [x + sign * (width / 2 - .03), .67, z], leather, .03);
    }
  };
  seat('legacy_x_driver_seat', -.43, -.20, .49, true); seat('legacy_x_passenger_seat', .43, -.20, .49, true);
  seat('legacy_x_rear_left_seat', -.48, .82, .45, false); seat('legacy_x_rear_center_seat', 0, .82, .43, false); seat('legacy_x_rear_right_seat', .48, .82, .45, false);
  solid(cabin, 'legacy_x_rear_cargo_floor', [1.35, .055, .92], [0, .53, 1.77], trim, .02);
}

function addStorageWells(scene: THREE.Group, isX: boolean) {
  const trim = new THREE.MeshStandardMaterial({name: 'cargo_liner', color: 0x15181c, roughness: .91});
  const width = isX ? 1.12 : .96, z = isX ? -1.91 : -1.73, y = isX ? .54 : .59, depth = isX ? .78 : .69;
  solid(scene, 'added_frunk_well_floor', [width, .045, depth], [0, y, z], trim, .02);
  for (const sign of [-1, 1]) solid(scene, `added_frunk_well_side_${sign}`, [.045, .14, depth], [sign * width / 2, y + .065, z], trim, .015);
  for (const sign of [-1, 1]) solid(scene, `added_frunk_well_end_${sign}`, [width, .14, .04], [0, y + .065, z + sign * depth / 2], trim, .015);
}

function addSocket(scene: THREE.Group, position: THREE.Vector3, isX: boolean) {
  const rubber = new THREE.MeshStandardMaterial({name: 'charge_socket_housing', color: 0x090c10, roughness: .7});
  const housing = solid(scene, 'added_charge_socket', [.014, isX ? .105 : .041, .117], position.toArray(), rubber, .012);
  housing.userData.isChargeSocket = true;
  const pinMat = new THREE.MeshStandardMaterial({name: 'charge_socket_contacts', color: 0x535a60, roughness: .4, metalness: .8});
  for (let i = 0; i < 3; i++) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(.010, .010, .009, 12), pinMat);
    pin.name = `added_charge_socket_pin_${i}`; pin.rotation.z = Math.PI / 2;
    pin.position.copy(position).add(new THREE.Vector3(-.008, i === 2 ? -.010 : .009, i === 2 ? 0 : (i ? -.024 : .024))); scene.add(pin);
  }
}
