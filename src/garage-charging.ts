import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Classic red-and-white Supercharger, built locally from rounded profiles. */
export class GarageCharger {
  readonly root = new THREE.Group();
  readonly socket: THREE.Vector3;
  readonly cable: THREE.CatmullRomCurve3;
  readonly station = new THREE.Group();
  private readonly rubber = new THREE.MeshStandardMaterial({color: 0x171b1c, metalness: .06, roughness: .6});
  private readonly indicator = new THREE.MeshBasicMaterial({color: 0x65df94, transparent: true, toneMapped: false});
  private readonly uniforms = {time: {value: 0}, flowEnabled: {value: 0}, color: {value: new THREE.Color(0x65db92)}};
  private readonly portLight: THREE.Mesh;
  private elapsed = 0;
  private flowing = false;
  private moving = false;
  private phase = 'unknown';

  constructor(socket: THREE.Vector3) {
    this.socket = socket.clone();
    this.root.name = 'garage-charging-connection'; this.root.visible = false;
    const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, position = new THREE.Vector3()) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.position.copy(position);
      mesh.castShadow = material === this.rubber; mesh.receiveShadow = material === this.rubber; this.root.add(mesh); return mesh;
    };
    const white = new THREE.MeshStandardMaterial({color: 0xf5f5f2, metalness: .16, roughness: .27});
    const red = new THREE.MeshStandardMaterial({color: 0xd71932, metalness: .12, roughness: .3});
    const base = new THREE.MeshStandardMaterial({color: 0x777d81, metalness: .55, roughness: .48});
    this.station.name = 'supercharger';
    this.station.position.set(-.75, 0, socket.z + 1.48); this.station.rotation.y = -.72;
    this.root.add(this.station);
    const stationMesh = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.position.set(x, y, z);
      mesh.castShadow = true; mesh.receiveShadow = true; this.station.add(mesh); return mesh;
    };
    // Continuous curved silhouette with a genuinely open centre, not a red panel.
    const outer = new THREE.Shape();
    outer.moveTo(-.34, .1); outer.lineTo(.34, .1); outer.lineTo(.34, 1.26);
    outer.quadraticCurveTo(.34, 1.30, .375, 1.33); outer.lineTo(.375, 1.59);
    outer.bezierCurveTo(.375, 1.64, .2, 1.66, 0, 1.66);
    outer.bezierCurveTo(-.2, 1.66, -.375, 1.64, -.375, 1.59); outer.lineTo(-.375, 1.33);
    outer.quadraticCurveTo(-.34, 1.30, -.34, 1.26); outer.closePath();
    const opening = (inset = 0) => {
      const p = new THREE.Path(), w = .25 - inset, bottom = .4 + inset, top = 1.42 - inset;
      p.moveTo(-w, .65); p.lineTo(-w, top - .08);
      p.quadraticCurveTo(-w, top, -w + .08, top); p.lineTo(w - .08, top);
      p.quadraticCurveTo(w, top, w, top - .08); p.lineTo(w, .65);
      p.bezierCurveTo(w, bottom + .08, .15, bottom, 0, bottom);
      p.bezierCurveTo(-.15, bottom, -w, bottom + .08, -w, .65); p.closePath(); return p;
    };
    outer.holes.push(opening());
    const shell = new THREE.ExtrudeGeometry(outer, {depth: .19, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 4, curveSegments: 24, steps: 1});
    shell.translate(0, 0, -.095);
    stationMesh('supercharger-white-shell', shell, white);
    const liner = new THREE.Shape(opening(-.008).getPoints(48)); liner.holes.push(opening(.025));
    const linerGeometry = new THREE.ExtrudeGeometry(liner, {depth: .23, bevelEnabled: true, bevelThickness: .012, bevelSize: .012, bevelSegments: 3, curveSegments: 24, steps: 1});
    linerGeometry.translate(0, 0, -.115);
    stationMesh('supercharger-red-inner-arch', linerGeometry, red);
    stationMesh('supercharger-plinth', new RoundedBoxGeometry(.84, .1, .37, 4, .025), base, 0, .05);
    stationMesh('supercharger-base-trim', new RoundedBoxGeometry(.71, .018, .27, 3, .006), this.rubber, 0, .105);
    // Small segmented letterforms stay sharp without loading a font or texture.
    const letters: number[][][] = [
      [[0,1],[.78,1],[.78,.84],[0,.84]], [[.32,.72],[.47,.72],[.47,0],[.32,0]],
      [[1.02,1],[1.76,1],[1.76,.84],[1.02,.84]], [[1.02,.57],[1.65,.57],[1.65,.42],[1.02,.42]], [[1.02,.16],[1.76,.16],[1.76,0],[1.02,0]],
      [[2,1],[2.74,1],[2.74,.84],[2.16,.84],[2.16,.59],[2.74,.59],[2.74,0],[2,0],[2,.16],[2.58,.16],[2.58,.43],[2,.43]],
      [[3,1],[3.16,1],[3.16,.16],[3.72,.16],[3.72,0],[3,0]],
      [[3.98,1],[4.76,1],[4.76,.84],[3.98,.84]], [[4.04,0],[4.27,.7],[4.46,.7],[4.7,0],[4.53,0],[4.36,.48],[4.2,0]],
    ];
    const wordmark = new THREE.Group(); wordmark.name = 'supercharger-tesla-wordmark';
    for (const points of letters) {
      const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2((x - 2.38) * .1, y * .082)));
      const glyph = new THREE.Mesh(new THREE.ShapeGeometry(shape), red); wordmark.add(glyph);
    }
    wordmark.position.set(0, 1.5, .127); this.station.add(wordmark);
    const nose = add('charge-plug-nose', new THREE.CylinderGeometry(.025, .027, .09, 20), this.rubber, socket.clone().add(new THREE.Vector3(-.028, 0, 0)));
    nose.rotation.z = Math.PI / 2;
    const grip = add('charge-plug-grip', new RoundedBoxGeometry(.12, .065, .065, 4, .025), this.rubber, socket.clone().add(new THREE.Vector3(-.112, -.016, 0)));
    grip.rotation.z = .2;
    this.portLight = add('charge-port-light', new THREE.TorusGeometry(.038, .0045, 10, 40), this.indicator, socket.clone().add(new THREE.Vector3(-.017, 0, 0)));
    this.portLight.rotation.y = Math.PI / 2;
    const start = new THREE.Vector3(-.2, 1.34, .12).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.station.rotation.y).add(this.station.position);
    const outlet = stationMesh('supercharger-cable-outlet', new THREE.SphereGeometry(.035, 16, 10), this.rubber, -.2, 1.34, .12);
    outlet.scale.set(1, 1, .6);
    const end = socket.clone().add(new THREE.Vector3(-.17, -.026, 0));
    this.cable = new THREE.CatmullRomCurve3([
      start,
      start.clone().add(new THREE.Vector3(-.08, -.68, -.08)),
      new THREE.Vector3(socket.x - .55, .07, socket.z + .85),
      new THREE.Vector3(socket.x - .42, .09, socket.z + .4),
      end.clone().add(new THREE.Vector3(-.13, -.33, .09)), end,
    ], false, 'centripetal');
    const material = (glow: boolean) => new THREE.ShaderMaterial({
      name: glow ? 'charging-cable-soft-edge' : 'charging-cable-flow',
      uniforms: {...this.uniforms, glow: {value: glow ? 1 : 0}}, transparent: true, depthWrite: false, toneMapped: false,
      vertexShader: `varying vec2 cableUV;
        void main() { cableUV = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float time; uniform float flowEnabled; uniform float glow; uniform vec3 color;
        varying vec2 cableUV;
        void main() {
          // A broad highlight travels towards the socket without dotted beads.
          float wave = pow(0.5 + 0.5 * cos(6.2831853 * (cableUV.x - time * 0.24)), 3.0) * flowEnabled;
          float opacity = mix(0.75 + wave * 0.22, 0.12 + wave * 0.06, glow);
          gl_FragColor = vec4(color * (0.84 + wave * 0.23), opacity);
          #include <colorspace_fragment>
        }`,
    });
    add('charging-cable', new THREE.TubeGeometry(this.cable, 96, .009, 12, false), material(false));
    add('charging-cable-glow', new THREE.TubeGeometry(this.cable, 96, .018, 10, false), material(true));
  }

  setState(connected: boolean, animate: boolean, phase: string, light: boolean) {
    const changed = this.root.visible !== connected;
    this.root.visible = connected; this.flowing = connected && animate; this.phase = phase;
    const energized = phase === 'charging' || phase === 'complete';
    this.uniforms.color.value.setHex(energized ? (light ? 0x248a55 : 0x65db92) : (light ? 0x677c72 : 0x8b9e94));
    this.indicator.color.setHex(energized ? 0x65df94 : phase === 'paused' ? 0xd4ae68 : 0x9bbbc8);
    return changed;
  }

  update(delta: number, reduceMotion: boolean) {
    this.moving = this.root.visible && this.flowing && !reduceMotion;
    if (this.moving) this.elapsed = (this.elapsed + delta) % 3600;
    this.uniforms.time.value = this.elapsed; this.uniforms.flowEnabled.value = this.moving ? 1 : 0;
    this.indicator.opacity = 1;
    return this.moving;
  }

  get info() {
    return {visible: this.root.visible, phase: this.phase, flowing: this.flowing, elapsed: this.elapsed,
      socket: this.socket.toArray(), cableStart: this.cable.getPoint(0).toArray(), cableEnd: this.cable.getPoint(1).toArray(),
      station: this.station.position.toArray(), stationVisible: this.root.visible,
      flowVisible: this.moving, pulsesVisible: false, style: 'supercharger'};
  }
}

