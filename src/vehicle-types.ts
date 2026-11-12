import type * as THREE from 'three';

export type VehicleModelID = 'modely-2025' | 'model3-2018' | 'model3-2024' | 'models-2013' | 'models-2021' | 'modelx-2020' | 'modely-2021';
export type HingeAudit = {stateKey: string; name: string; axis: number[]; openRadians: number; durationSeconds: number; motion?: 'linear' | 'falcon-upper' | 'falcon-lower'};
export type WheelAudit = {name: string; components: string[]; steeringComponents?: string[]; center: number[]; radiusMetres: number; axle: 'front' | 'rear'};
export type VehicleAudit = {nodeCount: number; geometryCount: number; triangles: number; hinges: HingeAudit[]; wheels: WheelAudit[]; groundingTranslation: number[]};
export type PreparedVehicle = {
  scene: THREE.Group;
  audit: VehicleAudit;
  /** Fixed socket anchor in the normalized model coordinates, independent of the lid. */
  chargeSocket?: THREE.Vector3;
  /** Imported cabin geometry is retained; legacy Y uses its existing restoration. */
  nativeMaterials: boolean;
};

export function hingePoseAngle(hinge: HingeAudit, angle: number) {
  if (!hinge.motion || hinge.motion === 'linear' || !hinge.openRadians) return angle;
  const p = Math.max(0, Math.min(1, angle / hinge.openRadians));
  // Lift away from the body before folding the outer panel back down.
  const t = hinge.motion === 'falcon-upper' ? p : Math.max(0, (p - .2) / .8);
  return hinge.openRadians * t * t * (3 - 2 * t);
}
