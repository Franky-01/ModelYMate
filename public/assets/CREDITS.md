# 2025 Tesla Model Y (Juniper)

- Artist: [BloxBloger](https://sketchfab.com/BloxBloger)
- Source: [2025 Tesla Model Y](https://sketchfab.com/3d-models/2025-tesla-model-y-619601e7800d418da5922c4fa7833f74)
- License: [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)
- Downloaded original OBJ from Sketchfab (307,399 triangles, 89 objects). MTL was not included in the archive; materials were assigned from `usemtl` names and object bounds.

Tesla Studio changes: axis normalization to metres with +Y up and -Z forward; length scaled to 4.794 m from the Model Y owner manual; MeshPhysical materials for paint, glass, lighting, tires and interior; lossless meshopt compression; static presentation wrapper with separated wheel groups. The body is not a factory hinge rig.

Noncommercial use only under the asset license.

ModelYMate changes (2026-10-03): decompressed the pinned public GLB mirror from
`aditano/tesla-studio` commit `1d4be35d45e8357f58d1ac620cfcfcf0544bbd56`,
converted mesh positions/normals/indices into a native SceneKit scene,
generated cylindrical presentation UVs, adjusted glass and paint materials,
and added local lighting, camera, material and weather presentation.
No factory door rig or original 小特 assets are included.

## Studio environment

Studio Small 09 by Sergej Majboroda / Poly Haven, CC0.
Source: https://polyhaven.com/a/studio_small_09
Asset: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr
License: https://polyhaven.com/license
Retained as the previous studio environment. No network fetch is performed
by the application; the asset is bundled locally.

## Neutral softbox environment (2026-10-13)

The active environment, `Atelier.hdr`, is an original, procedurally authored
1536 x 768 linear RGBE studio environment. It contains neutral ceiling,
strip-light and bounce-card profiles, without downloaded imagery. Rebuild it
with `python3 Scripts/VehicleModel/build-studio-environment.py` (requires numpy).
The app's new material treatment uses separate clear-coat, glass, rubber,
painted-wheel and metal responses. Ground contact patches follow the chassis
and imported wheel pivots; these are a studio presentation approximation,
not a ray-traced shadow simulation. The underlying credited mesh is unchanged.

## Curved surface revision (2026-10-03)

ModelYMate derived the main body shell, mirror caps and wheel-arch cladding
from the credited source with offline cubic PN patches and 4× edge sampling.
This is a refinement of the credited public model, not an OEM CAD model or
a scratch-built replica. Original panel boundaries and other components are
preserved. Visually identified window frames, wipers, underbody and lamp
housings received corrected separate materials. The original revision used explicit alpha blending for glass; the October 13
studio treatment uses depth-writing tinted exterior glass to avoid pane-sorting
artifacts in the source mesh. Tesla reference photographs are used only for
comparison and are not bundled in the app.

## Articulated vehicle and environment revision (2026-10-13)

`VehicleRig.scn` is derived from `VehicleModel.scn`, under the same original
model license. Disconnected source panels supply four door shells, the hood,
tailgate and charge-port cover. The associated handles, mirrors, glazing and
rear lamp assemblies follow their respective hinges. Only shared rear glazing
and interior side cards are clipped at their panel boundaries. Recessed dark
compartment liners are original additions, not OEM interior CAD.

Rebuild with `Scripts/VehicleModel/export-components.swift` (compile with
`swiftc -O`, export to `<work>/current`), `find-components.py <work>`, then
`rig-panels.swift VehicleModel.scn <work>/all-components.json VehicleRig.scn`.
The October 13 geometry audit preserves all 89 source meshes by surface area;
maximum per-mesh area difference is 3.21e-8 square metres.

The active `Atelier.hdr` was further revised to broad continuous neutral light
lobes instead of strip-light profiles. The background uses one continuous
ground plane fading into darkness, with three restrained ground tones and
no architectural or landscape cutouts. Rain particles and wet-ground materials are local presentation
settings, not a claim about the vehicle's measured weather.

## PWA conversion (2026-10-14)

`vehicle.glb` is a direct native SceneKit export of the current
`ModelYMate/Vehicle3D/VehicleRig.scn`, including the October 13 hood-liner
clearance repair. It is not an export of the older public GLB mirror.

The export preserves all 139 source nodes and their hierarchy/transforms,
131 geometry nodes, 749,971 source vertices and 496,691 triangles. All source
Float32 positions, normals and texture coordinates, and all triangle index
bytes are preserved without welding, flattening, normal regeneration,
quantization or transform baking. The four doors, hood, tailgate and charge
port retain their individual articulated hinge nodes. The seven original
compartment-liner additions are included.

The original 89 credited source mesh names remain represented after panel
splitting. Current `VehicleRig.scn` source SHA-256:
`9723f27ffe27bb80b380d2c5fc292ddedb20c6652428f2402d1d8dc59d0af5d0`.
The source-to-articulated maximum per-mesh surface area difference is
`3.203348697411457e-8` square metres, consistent with the native rig audit.
Conversion-specific attribute and index SHA-256 values, original materials,
hinge axes/angles, wheel assembly membership, bounds and contact points
are recorded in `vehicle.audit.json`.

Original material values are represented as glTF metallic/roughness
materials, with glTF color factors in linear sRGB and source values retained
in extras. SceneKit-specific lighting and depth behavior require the PWA's
renderer to reproduce the current app treatment; conversion alone does not
claim an identical frame across renderers. The source's current runtime
material, camera, lighting-environment and ground settings are in the audit.

`Atelier.hdr` is copied byte-for-byte from the current original ModelYMate
environment. All original `.scn`, HDR and attribution files remain unchanged.
Rebuild the GLB with `Web/tools/export-vehicle.swift`; see its build/run header.

The original model license remains CC BY-NC 4.0. This conversion does not
change its noncommercial-use restriction or imply Tesla endorsement.

### Lossless delivery compression

The hosted GLB uses `EXT_meshopt_compression` with the official meshoptimizer
0.22 encoder and the matching decoder bundled in Three r180. Compressed
attributes use `NONE` filtering, and indices use `INDICES` sequence encoding,
preserving original index order without triangle rotations. Attribute views
whose exact original bytes compress better over HTTP remain uncompressed.
No geometry is simplified, quantized, welded or reordered.

The final asset is 23,787,016 bytes (22.69 MiB), below the 25 MiB static-file
limit. HTTP gzip size is 10,204,660 bytes. All 524 buffer views have exact
source-byte checks, and the PWA's actual Three loader reproduces all 393
attribute hashes and 131 index hashes from the native SceneKit audit.
The uncompressed original is preserved under
`QAArtifacts/1014-pwa-assets/vehicle-uncompressed.glb`.

The compression helper, `QAArtifacts/1014-pwa-assets/compress-vehicle.mjs`,
records package provenance, full decoded BIN hashes and official glTF
validation reports. Khronos Validator currently does not implement the
meshopt extension's codec semantics; both its compressed-container check and
the fully decoded standard GLB report zero errors and zero warnings, while
exact codec correctness is additionally checked using the shipped decoder.

Meshoptimizer is copyright Arseny Kapoulkine and distributed under the MIT
license: https://github.com/zeux/meshoptimizer . The underlying vehicle's
CC BY-NC 4.0 license remains unchanged.

### PWA entrance motion

The PWA uses the user-requested curved lateral drift entrance, lasting 2.25
seconds of visible animation. The chassis follows a continuous grounded
Bezier path and straightens into the original parked pose; wheel rolling is
derived from the actual path's arc length. This is a local presentation
animation and sends no vehicle-control request.

### Web cabin visibility (2026-10-17)

The PWA retains the original front/rear seats, steering wheel, dashboard and
console geometry. Connected cabin pieces receive separate charcoal upholstery,
trim and headliner finishes. Tinted, transparent glazing and a neutral local
cabin fill reveal these details when doors open and through closed windows.
The GLB, source rig and lossless export audit remain unchanged.

The center display housing, stand and screen artwork are local presentation
additions. Its static interface depicts no live speed, range, location or
navigation information. No external image, font or model is downloaded.
