/// <reference types="vite/client" />
import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {loadVehicle} from './vehicle-loader';
import type {VehicleModelID} from './vehicle-types';

type Props = {soc: number | null; limit: number | null; active: boolean; modelId?: VehicleModelID};
type Wheel = {axle: 'front' | 'rear'; center: number[]; radiusMetres: number; components: string[]};
type Audit = {groundingTranslation: number[]; wheels: Wheel[]};
type Phase = 'loading' | 'ready' | 'error';
const percentage = (value: number | null) => typeof value === 'number' && Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 100) : null;

// Each instance parses its own asset and owns its GPU resources. The garage's
// model, materials, pose and render loop are never shared or changed here.
function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh || node instanceof THREE.Line)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
}

function roundedPack(width: number, length: number, depth: number) {
  const x = -width / 2, y = -length / 2, r = .08, shape = new THREE.Shape();
  shape.moveTo(x + r, y); shape.lineTo(x + width - r, y); shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + length - r); shape.quadraticCurveTo(x + width, y + length, x + width - r, y + length);
  shape.lineTo(x + r, y + length); shape.quadraticCurveTo(x, y + length, x, y + length - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  const geometry = new THREE.ExtrudeGeometry(shape, {depth, steps: 1, bevelEnabled: true, bevelThickness: .012, bevelSize: .012, bevelSegments: 2, curveSegments: 4});
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

class ChargingEngine {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, .1, 40);
  private renderer: THREE.WebGLRenderer;
  private abort = new AbortController();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  private resizeObserver: ResizeObserver;
  private themeObserver: MutationObserver;
  private visibilityObserver: IntersectionObserver;
  private visible = true;
  private disposed = false;
  private ready = false;
  private frame = 0;
  private previousFrame = 0;
  private seconds = 0;
  private dirty = true;
  private bounds = new THREE.Box3();
  private shellMaterials: Array<{material: THREE.MeshStandardMaterial; kind: string}> = [];
  private caseMaterial = new THREE.MeshStandardMaterial({roughness: .72, metalness: .18});
  private bedMaterial = new THREE.MeshStandardMaterial({roughness: .9, metalness: .04});
  private lineMaterial = new THREE.LineDashedMaterial({transparent: true, opacity: .8, dashSize: .065, gapSize: .045, depthTest: false});
  private fillMaterial = new THREE.ShaderMaterial({
    uniforms: {color: {value: new THREE.Color('#48cc75')}, time: {value: 0}, running: {value: 0}, fraction: {value: 0}},
    vertexShader: `varying vec3 vPackPosition; varying vec3 vPackNormal;
      void main() {vPackPosition = position; vPackNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);}`,
    fragmentShader: `uniform vec3 color; uniform float time; uniform float running; uniform float fraction;
      varying vec3 vPackPosition; varying vec3 vPackNormal;
      void main() {
        float cell = fract((vPackPosition.z + .5) * fraction * 16.0);
        float separator = smoothstep(.965, 1.0, cell) * .065;
        float light = .76 + .24 * max(dot(normalize(vPackNormal), normalize(vec3(-.4, .9, -.25))), 0.0);
        float phase = fract(time / 3.6) * 1.5 - .25;
        float d = (vPackPosition.z + .5) - phase;
        float glow = exp(-d * d * 105.0) * running * .25;
        gl_FragColor = vec4(color * (light - separator) + vec3(.20, .35, .24) * glow, 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
  private fill: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial> | null = null;
  private limitLine: THREE.Line | null = null;
  private pack = {width: 0, length: 0, front: 0, top: 0};

  constructor(private host: HTMLDivElement, private getProps: () => Props, private onPhase: (phase: Phase) => void) {
    this.renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, powerPreference: 'low-power'});
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x79868c, 2.5));
    const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(-4, 6, -3); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xdce8ee, 2); rim.position.set(3, 3, 2); this.scene.add(rim);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host);
    this.themeObserver = new MutationObserver(() => this.sync());
    this.themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
    this.visibilityObserver = new IntersectionObserver(entries => {
      this.visible = entries[0]?.isIntersecting ?? false; this.previousFrame = 0; this.schedule();
    }, {rootMargin: '40px'});
    this.visibilityObserver.observe(host);
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.reduced.addEventListener('change', this.motionChanged);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.resize(); this.sync();
  }

  async load() {
    let model: THREE.Group | null = null;
    try {
      const vehicle = await loadVehicle(this.getProps().modelId ?? 'modely-2025', this.abort.signal);
      const audit = vehicle.audit;
      model = vehicle.scene;
      if (this.disposed) {disposeObject(model); return;}
      if (!Array.isArray(audit.wheels) || audit.wheels.length !== 4 || !audit.wheels.every(wheel =>
        wheel.center.length === 3 && wheel.center.every(Number.isFinite) && Number.isFinite(wheel.radiusMetres) && wheel.radiusMetres > 0)) throw new Error('Invalid wheel geometry audit');
      model.position.fromArray(audit.groundingTranslation);
      model.updateMatrixWorld(true);
      this.bounds.setFromObject(model);
      this.prepareShell(model, audit);
      this.scene.add(model);
      this.buildBattery(audit);
      this.addShadow(audit);
      this.sync(); this.resize();
      // Compile once before exposing the canvas, so the first visible state is complete.
      this.renderer.compile(this.scene, this.camera);
      const context = this.renderer.getContext();
      const parallel = this.renderer.extensions.get('KHR_parallel_shader_compile') as {COMPLETION_STATUS_KHR:number} | null;
      const programs = (this.renderer.info.programs ?? []).map(program => program.program as WebGLProgram);
      const deadline = performance.now() + 30000;
      // Three's compileAsync timer can outlive a disposed scene. Stop our own
      // polling before it touches shader objects released by a model switch.
      while (!this.disposed && parallel && programs.some(program => !context.getProgramParameter(program,parallel.COMPLETION_STATUS_KHR))) {
        if (performance.now() >= deadline) throw new Error('Charging shaders timed out');
        await new Promise(resolve => setTimeout(resolve,10));
      }
      if (this.disposed) return;
      this.ready = true; this.onPhase('ready'); this.dirty = true; this.schedule();
    } catch {
      if (this.disposed) return;
      if (model && !model.parent) disposeObject(model);
      this.onPhase('error'); this.dispose();
    }
  }

  private prepareShell(model: THREE.Object3D, audit: Audit) {
    const wheelNames = new Set(audit.wheels.flatMap(wheel => wheel.components));
    const oldMaterials = new Set<THREE.Material>(), oldTextures = new Set<THREE.Texture>();
    const cache = new Map<string, THREE.MeshStandardMaterial>();
    model.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const wheel = wheelNames.has(node.name), originals = Array.isArray(node.material) ? node.material : [node.material];
      node.material = originals.map(original => {
        oldMaterials.add(original);
        Object.values(original).forEach(value => {if (value instanceof THREE.Texture) oldTextures.add(value);});
        const kind = wheel ? original.name : `shell:${original.name}`;
        let material = cache.get(kind);
        if (!material) {
          material = new THREE.MeshStandardMaterial({name: `charging-${kind}`, roughness: .55, metalness: .12,
            transparent: !wheel, depthWrite: wheel, side: THREE.FrontSide});
          cache.set(kind, material); this.shellMaterials.push({material, kind});
        }
        return material;
      });
      if (originals.length === 1) node.material = node.material[0];
      // Opaque seats and the dashboard would hide the pack in this cutaway view.
      if (!wheel && originals.every(material => material.name === 'interior_leather')) node.visible = false;
      node.renderOrder = wheel ? 1 : 3;
      node.castShadow = false; node.receiveShadow = false;
    });
    oldMaterials.forEach(material => material.dispose()); oldTextures.forEach(texture => texture.dispose());
  }

  private buildBattery(audit: Audit) {
    const ground = new THREE.Vector3().fromArray(audit.groundingTranslation);
    const frontWheels = audit.wheels.filter(wheel => wheel.axle === 'front'), rearWheels = audit.wheels.filter(wheel => wheel.axle === 'rear');
    if (frontWheels.length !== 2 || rearWheels.length !== 2) throw new Error('Invalid axle audit');
    const frontAxle = frontWheels.reduce((sum, wheel) => sum + wheel.center[2], 0) / 2 + ground.z;
    const rearAxle = rearWheels.reduce((sum, wheel) => sum + wheel.center[2], 0) / 2 + ground.z;
    const radius = audit.wheels.reduce((sum, wheel) => sum + wheel.radiusMetres, 0) / 4;
    const track = Math.max(...audit.wheels.map(wheel => wheel.center[0])) - Math.min(...audit.wheels.map(wheel => wheel.center[0]));
    // This source car faces -Z. Place a schematic pack between the audited axles
    // and inside the wheel track; this is a SOC display, not a technical cutaway.
    const width = Math.min(track * .83, this.bounds.getSize(new THREE.Vector3()).x * .66);
    const front = frontAxle + radius * .50, length = rearAxle - radius * .50 - front;
    const bottom = this.bounds.min.y + radius * .47, depth = radius * .36;
    if (!(width > 0 && length > 0)) throw new Error('Invalid battery dimensions');
    this.pack = {width: width - .08, length: length - .08, front: front + .04, top: bottom + depth};
    const caseMesh = new THREE.Mesh(roundedPack(width, length, depth), this.caseMaterial);
    caseMesh.position.set(ground.x, bottom, front + length / 2); caseMesh.renderOrder = 1; this.scene.add(caseMesh);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(this.pack.width, .035, this.pack.length), this.bedMaterial);
    bed.position.set(ground.x, this.pack.top + .007, front + length / 2); bed.renderOrder = 1; this.scene.add(bed);
    this.fill = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.fillMaterial);
    this.fill.position.x = ground.x; this.fill.position.y = this.pack.top + .027; this.fill.renderOrder = 2; this.scene.add(this.fill);
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-width / 2 + .015, 0, 0), new THREE.Vector3(width / 2 - .015, 0, 0),
    ]);
    this.limitLine = new THREE.Line(geometry, this.lineMaterial); this.limitLine.computeLineDistances();
    this.limitLine.position.set(ground.x, this.pack.top + .065, 0); this.limitLine.renderOrder = 4; this.scene.add(this.limitLine);
  }

  private addShadow(audit: Audit) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d'); if (!context) return;
    const gradient = context.createRadialGradient(64, 64, 3, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(15,24,29,.28)'); gradient.addColorStop(.5, 'rgba(15,24,29,.11)'); gradient.addColorStop(1, 'rgba(15,24,29,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({map: texture, transparent: true, depthWrite: false, toneMapped: false});
    const geometry = new THREE.PlaneGeometry(1, 1);
    const patch = (x: number, z: number, width: number, length: number) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, this.bounds.min.y - .012, z); mesh.scale.set(width, length, 1); this.scene.add(mesh);
    };
    patch(0, 0, 2.5, 4.8);
    for (const wheel of audit.wheels) patch(wheel.center[0], wheel.center[2], .65, .9);
  }

  sync() {
    if (this.disposed) return;
    const light = document.documentElement.dataset.theme === 'light';
    for (const {material, kind} of this.shellMaterials) {
      const shell = kind.startsWith('shell:'), name = shell ? kind.slice(6) : kind;
      if (shell) {
        material.color.set(light ? '#657783' : '#d2dce3');
        material.opacity = name === 'glass' ? .055 : name === 'exterior_paint' ? (light ? .33 : .19) : .12;
        material.roughness = .42; material.metalness = .16;
      } else {
        material.color.set(name === 'tire_rubber' ? '#273138' : name === 'wheel_finish' ? '#859198' : '#59636a');
        material.roughness = name === 'tire_rubber' ? .86 : .37;
        material.metalness = name === 'tire_rubber' ? 0 : .46;
      }
    }
    this.caseMaterial.color.set(light ? '#3e484a' : '#5d6a6d');
    this.bedMaterial.color.set(light ? '#273638' : '#243438');
    this.lineMaterial.color.set(light ? '#f3fbf7' : '#e7fff0');
    const props = this.getProps(), soc = percentage(props.soc), limit = percentage(props.limit);
    if (soc === null) this.bedMaterial.color.set(light ? '#697779' : '#637173');
    const fraction = soc === null ? 0 : soc / 100;
    if (this.fill) {
      this.fill.visible = soc !== null && soc > 0;
      this.fill.scale.set(this.pack.width, .048, Math.max(this.pack.length * fraction, .0001));
      this.fill.position.z = this.pack.front + this.pack.length * fraction / 2;
    }
    if (this.limitLine) {
      this.limitLine.visible = limit !== null && limit > 0 && limit < 100;
      this.limitLine.position.z = this.pack.front + this.pack.length * (limit ?? 0) / 100;
    }
    this.fillMaterial.uniforms.fraction.value = fraction;
    this.fillMaterial.uniforms.running.value = props.active && !this.reduced.matches ? 1 : 0;
    this.dirty = true; this.schedule();
  }

  private resize() {
    if (this.disposed) return;
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height); this.camera.aspect = width / height;
    const center = this.bounds.isEmpty() ? new THREE.Vector3(0, .7, 0) : this.bounds.getCenter(new THREE.Vector3());
    center.y -= .12;
    const direction = new THREE.Vector3(-7.5, 4.7, -3.3).normalize();
    let distance = 8.7;
    for (let iteration = 0; iteration < 3; iteration++) {
      this.camera.position.copy(center).addScaledVector(direction, distance); this.camera.lookAt(center); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld(true);
      if (this.bounds.isEmpty()) break;
      let projectedWidth = 0, projectedHeight = 0;
      for (const x of [this.bounds.min.x, this.bounds.max.x]) for (const y of [this.bounds.min.y, this.bounds.max.y]) for (const z of [this.bounds.min.z, this.bounds.max.z]) {
        const point = new THREE.Vector3(x, y, z).project(this.camera);
        projectedWidth = Math.max(projectedWidth, Math.abs(point.x)); projectedHeight = Math.max(projectedHeight, Math.abs(point.y));
      }
      distance *= Math.max(projectedWidth / .90, projectedHeight / .91);
    }
    this.dirty = true; this.schedule();
  }

  private canRender() {return !this.disposed && this.ready && this.visible && !document.hidden && this.host.clientWidth > 0 && this.host.clientHeight > 0;}
  private animates() {const props = this.getProps(); return props.active && !this.reduced.matches && (percentage(props.soc) ?? 0) > 0;}
  private schedule() {
    if (!this.canRender()) {if (this.frame) cancelAnimationFrame(this.frame); this.frame = 0; this.previousFrame = 0; return;}
    if (!this.frame && (this.dirty || this.animates())) this.frame = requestAnimationFrame(this.render);
  }
  private render = (time: number) => {
    this.frame = 0; if (!this.canRender()) return;
    // The fixed camera needs only a gentle sweep: cap GPU work to 30 fps while
    // rendering input/theme/resize changes immediately.
    if (this.previousFrame && !this.dirty && time - this.previousFrame < 1000 / 30 - 1) {this.schedule(); return;}
    const elapsed = this.previousFrame ? Math.min((time - this.previousFrame) / 1000, .08) : 0;
    this.previousFrame = time;
    if (this.animates()) this.seconds += elapsed;
    this.fillMaterial.uniforms.time.value = this.seconds;
    try {this.renderer.render(this.scene, this.camera);}
    catch {this.onPhase('error'); this.dispose(); return;}
    this.dirty = false; this.schedule();
  };
  private visibilityChanged = () => {this.previousFrame = 0; this.dirty = true; this.schedule();};
  private motionChanged = () => {this.previousFrame = 0; this.sync();};
  private contextLost = (event: Event) => {event.preventDefault(); if (!this.disposed) {this.onPhase('error'); this.dispose();}};

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort(); if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect(); this.themeObserver.disconnect(); this.visibilityObserver.disconnect();
    document.removeEventListener('visibilitychange', this.visibilityChanged); this.reduced.removeEventListener('change', this.motionChanged);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    disposeObject(this.scene); this.scene.clear();
    // These may not yet belong to the scene if loading failed or was interrupted.
    this.caseMaterial.dispose(); this.bedMaterial.dispose(); this.lineMaterial.dispose(); this.fillMaterial.dispose();
    this.renderer.renderLists.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}

export default function ChargingScene(props: Props) {
  const host = useRef<HTMLDivElement>(null), engine = useRef<ChargingEngine | null>(null), latest = useRef(props);
  const [phase, setPhase] = useState<Phase>('loading'), [attempt, setAttempt] = useState(0);
  latest.current = props;
  useEffect(() => {
    if (!host.current) return;
    let mounted = true;
    setPhase('loading');
    try {
      const instance = new ChargingEngine(host.current, () => latest.current, next => {if (mounted) setPhase(next);});
      engine.current = instance; void instance.load();
      return () => {mounted = false; instance.dispose(); engine.current = null;};
    } catch {
      setPhase('error');
      return () => {mounted = false;};
    }
  }, [attempt, props.modelId]);
  useEffect(() => {engine.current?.sync();}, [props.soc, props.limit, props.active]);
  const soc = percentage(props.soc);
  return <div className="charging-scene" data-model={props.modelId ?? 'modely-2025'} data-phase={phase} role="group" aria-label={`车辆电池透视图，${soc === null ? '当前电量未知' : `当前电量 ${soc}%`}`}>
    <div ref={host} className="charging-scene-canvas" style={{visibility: phase === 'ready' ? 'visible' : 'hidden'}} />
    {phase !== 'ready' && <div className="charging-scene-message" role="status">
      <span>{phase === 'loading' ? '正在准备充电视图' : '充电视图暂不可用'}</span>
      {phase === 'error' && <button type="button" onClick={() => setAttempt(value => value + 1)}>重新加载</button>}
    </div>}
    {phase === 'ready' && soc === null && <span style={{position: 'absolute', bottom: 12, insetInline: 0, textAlign: 'center', fontSize: 12, color: 'var(--muted)'}}>等待电量数据</span>}
  </div>;
}
