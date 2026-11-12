/// <reference types="vite/client" />
import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {doorSignals, motionSpeed} from './core.mjs';
import {ENTRY_DURATION, ENTRY_ARC_LENGTH, arrivalDistance, driftPose, driftSteering, frontWheelSteering} from './garage-motion.mjs';
import {configureCabinGlass, makeCenterDisplayTexture, restoreCabin} from './garage-interior';
import {request,RequestFailure} from './request';
import type {GarageSettings} from './storage';
import GarageLoading from './GarageLoading';
import {GarageCharger} from './garage-charging';
import {garageChargingState} from './garage-charging-state.mjs';
import './garage-charging.css';
import {loadVehicle} from './vehicle-loader';
import {hingePoseAngle, type VehicleModelID, type HingeAudit, type WheelAudit, type VehicleAudit as Audit} from './vehicle-types';

type Props = {
  modelId?: VehicleModelID;
  presentation?: 'hero' | 'preview';
  settings: GarageSettings;
  status: any | null;
  units: any;
  received: number | null;
  active: boolean;
  onReady?: (info: {triangles: number; nodes: number; renderer: string}) => void;
};
type Hinge = HingeAudit & {node: THREE.Object3D; closed: THREE.Quaternion; axisVector: THREE.Vector3; value: number; from: number; target: number; elapsed: number};
type Wheel = {pivot: THREE.Group; roll: THREE.Group; front: boolean; radius: number; angle: number};
type Fixture = {status: any; units: any; received: number | null};
type EntryFrame = {frame: number; elapsed: number; wallSeconds: number; position: number[]; yaw: number; wheelAngles: number[]; wheelSteering: number[]};
type ZoomLimits = {canZoomIn: boolean; canZoomOut: boolean};

const PAINTS: Record<string, [number, number, number]> = {
  pearl: [.88, .90, .93], graphite: [.065, .075, .09], silver: [.40, .45, .50],
  red: [.64, .025, .055], blue: [.018, .10, .36], glacier: [.09, .55, .58], acid: [.61, .88, .025],
};
const GROUND: Record<'light' | 'dark', Record<string, [number, number, number]>> = {
  dark: {studio: [.13, .13, .13], desert: [.155, .137, .12], midnight: [.06, .065, .075]},
  light: {studio: [.76, .79, .79], desert: [.82, .78, .72], midnight: [.69, .75, .80]},
};
const FINISH: Record<string, {roughness: number; clearcoat: number; clearcoatRoughness: number}> = {
  gloss: {roughness: .28, clearcoat: .9, clearcoatRoughness: .16},
  satin: {roughness: .48, clearcoat: .35, clearcoatRoughness: .36},
  matte: {roughness: .78, clearcoat: .04, clearcoatRoughness: .7},
};
const smooth = (p: number) => p * p * (3 - 2 * p);
const rgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const assetURL = (name: string) => `${import.meta.env.BASE_URL}assets/${name}`;
function makeLivery(paint: string, style: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const base = PAINTS[paint] ?? PAINTS.pearl;
  const accent = ['pearl', 'silver', 'glacier', 'acid'].includes(paint) ? [.025, .045, .065] : [.88, .94, 1];
  const css = (color: number[], alpha = 1) => `rgba(${color.map(v => Math.round(v * 255)).join(',')},${alpha})`;
  ctx.fillStyle = css(base); ctx.fillRect(0, 0, 1024, 512);
  if (style === 'flow') {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < 5; i++) {
      const x = 180 + i * 165;
      ctx.beginPath(); ctx.moveTo(x - 90, -20); ctx.bezierCurveTo(x + 42, 125, x - 96, 355, x + 28, 540);
      ctx.strokeStyle = css(accent, i === 2 ? .88 : .46); ctx.lineWidth = i === 2 ? 24 : 9; ctx.stroke();
    }
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = css([1, 1, 1], .56); ctx.fillRect(488, 0, 4, 512);
  } else if (style === 'split') {
    ctx.fillStyle = css(accent, .92); ctx.fillRect(0, 251, 1024, 261);
    ctx.fillStyle = css([1, 1, 1], .82); ctx.fillRect(0, 244, 1024, 7);
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = css([0, 0, 0], .18); ctx.fillRect(0, 0, 1024, 20);
  } else if (style === 'speckle') {
    ctx.fillStyle = css(accent, .7);
    let seed = 0x9e3779b97f4a7c15n;
    const next = () => {seed = BigInt.asUintN(64, 2862933555777941757n * seed + 3037000493n); return Number((seed >> 33n) & 0xffffn) / 0xffff;};
    for (let i = 0; i < 780; i++) {
      const x = next() * 1024, y = next() * 512, diameter = 1.2 + next() * 3.2;
      ctx.beginPath(); ctx.ellipse(x + diameter / 2, y + diameter / 2, diameter / 2, diameter / 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'screen'; ctx.strokeStyle = css([1, 1, 1], .38); ctx.lineWidth = 2; ctx.strokeRect(0, 248, 1024, 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'local-vehicle-livery'; texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  return texture;
}

function contactTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 127);
  gradient.addColorStop(0, 'rgba(0,0,0,.95)'); gradient.addColorStop(.36, 'rgba(0,0,0,.68)');
  gradient.addColorStop(.7, 'rgba(0,0,0,.19)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient; context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function freeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(node => {
    if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
      geometries.add(node.geometry);
      (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => {
        materials.add(material);
        Object.values(material).forEach(value => {if (value instanceof THREE.Texture) textures.add(value);});
      });
    }
    if (node instanceof THREE.DirectionalLight || node instanceof THREE.SpotLight) node.shadow.map?.dispose();
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
}

class GarageEngine {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(29, 1, .05, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly car = new THREE.Group();
  private readonly road = new THREE.Group();
  private readonly floorMaterial = new THREE.MeshPhysicalMaterial({color: rgb(.13, .13, .13), metalness: 0, roughness: .88, specularIntensity: .35});
  private readonly abort = new AbortController();
  private readonly reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly resizeObserver: ResizeObserver;
  private readonly visibilityObserver: IntersectionObserver;
  private readonly themeObserver: MutationObserver;
  private readonly pointerPositions = new Map<number, {x: number; y: number; startX: number; startY: number}>();
  private readonly temporaryQuaternion = new THREE.Quaternion();
  private readonly qaEnabled = new URLSearchParams(location.search).get('qa') === '1';
  private readonly errors: string[] = [];
  private readonly paints: THREE.MeshPhysicalMaterial[] = [];
  private hinges: Hinge[] = [];
  private wheels: Wheel[] = [];
  private wheelbase = 2.9;
  private audit: Audit | null = null;
  private cabin: ReturnType<typeof restoreCabin> | null = null;
  private charger: GarageCharger | null = null;
  private chargingState = garageChargingState(null, null);
  private chargingKey = '';
  private chargingTimer = 0;
  private environment: THREE.WebGLRenderTarget | null = null;
  private livery: THREE.Texture | null = null;
  private rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private model: THREE.Group | null = null;
  private fixture: Fixture | null = null;
  private qaInspector: object | null = null;
  private raf = 0;
  private lastFrame = 0;
  private frames = 0;
  private renderMilliseconds = 0;
  private settingsKey = '';
  private paintKey = '';
  private nativeMaterials = false;
  private disposed = false;
  private ready = false;
  private dirty = true;
  private shadowDirty = true;
  private inputFitPending = false;
  private renderWidth = 0;
  private renderHeight = 0;
  private lastActive = false;
  private pageHidden = document.hidden;
  private inViewport = true;
  private contextLost = false;
  private preparationVersion = 0;
  private entryRequested = false;
  private entryRunning = false;
  private entryElapsed = 0;
  private entryCount = 0;
  private entryPhase = 'loading';
  private entryWallStarted = 0;
  private entryTrace: EntryFrame[] = [];
  private speed = 0;
  private roadPhase = 0;
  private zoomDistance = Math.sqrt(5.5 ** 2 + (2.45 - .72) ** 2 + 8.2 ** 2);
  private pinchDistance = 0;
  private protectedTop = 0;
  private protectedBottom = 0;
  private minimumZoomDistance = 5.8;
  private fitPoints: {node: THREE.Object3D; corners: THREE.Vector3[]}[] = [];
  private readonly fittingPoint = new THREE.Vector3();
  private zoomLimitsKey = '';

  constructor(
    private readonly host: HTMLDivElement,
    private readonly props: () => Props,
    private readonly phase: (phase: 'loading' | 'ready' | 'error', error?: string) => void,
    private readonly zoomLimitsChanged: (limits: ZoomLimits) => void,
    private readonly chargingChanged: (state: ReturnType<typeof garageChargingState>) => void,
  ) {
    RectAreaLightUniformsLib.init();
    this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: false, powerPreference: 'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:pan-y;';
    this.host.appendChild(canvas);
    this.scene.background = rgb(.11, .11, .11);
    this.scene.fog = new THREE.Fog(rgb(.11, .11, .11), 10, 40);
    this.scene.environmentIntensity = .8;
    this.car.name = 'garage-vehicle-root'; this.scene.add(this.car);
    this.road.name = 'garage-driving-road'; this.road.visible = false; this.car.add(this.road);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), this.floorMaterial);
    floor.name = 'garage-floor'; floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.floorMaterial.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec2 vGarageFloor;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGarageFloor = (modelMatrix * vec4(transformed,1.0)).xz;');
      shader.fragmentShader = 'varying vec2 vGarageFloor;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float grain = fract(sin(dot(floor(vGarageFloor * 650.0),vec2(12.9898,78.233))) * 43758.5453);
        float cloud = sin(vGarageFloor.x * 2.1 + sin(vGarageFloor.y * 1.7)) * sin(vGarageFloor.y * 2.3);
        diffuseColor.rgb *= 0.97 + 0.035 * grain + 0.015 * cloud;`);
    };
    this.floorMaterial.customProgramCacheKey = () => 'modelymate-continuous-ground-v1';
    this.scene.add(floor);

    const focus = new THREE.Vector3(0, .72, 0);
    const addSoftbox = (name: string, position: [number, number, number], intensity: number, width: number, height: number) => {
      const light = new THREE.RectAreaLight(0xffffff, intensity, width, height);
      light.name = name; light.position.set(...position); light.lookAt(focus); this.scene.add(light);
    };
    addSoftbox('garage-key-softbox', [-3.5, 6, -4], 2.6, 6.5, 4.2);
    addSoftbox('garage-fill-softbox', [4.8, 3.3, -1.8], .75, 5, 3);
    addSoftbox('garage-rim-softbox', [.8, 4.4, 5.2], 1.5, 5.8, 2.3);
    const key = new THREE.DirectionalLight(0xffffff, .85);
    key.name = 'garage-shadow-light'; key.position.set(-3.5, 8, -4); key.target.position.set(0, .4, 1.5);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, {left: -10, right: 10, top: 10, bottom: -10, near: .5, far: 26});
    key.shadow.camera.updateProjectionMatrix(); key.shadow.bias = -.0002; key.shadow.normalBias = .014; key.shadow.radius = 2;
    this.scene.add(key, key.target);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, .1));

    const roadMaterial = new THREE.MeshBasicMaterial({color: rgb(.48, .48, .48), transparent: true, opacity: .65, depthWrite: false});
    const roadGeometry = new THREE.PlaneGeometry(.055, 1.8);
    for (const x of [-1.85, 1.85]) for (let i = -3; i <= 3; i++) {
      const dash = new THREE.Mesh(roadGeometry, roadMaterial); dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, .012, i * 4); this.road.add(dash);
    }
    this.rain = this.makeRain(); this.scene.add(this.rain);
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('pointercancel', this.pointerUp);
    canvas.addEventListener('webglcontextlost', this.lostContext);
    canvas.addEventListener('webglcontextrestored', this.restoredContext);
    document.addEventListener('visibilitychange', this.visibilityChanged);
    window.addEventListener('pagehide', this.pageHide);
    window.addEventListener('pageshow', this.pageShow);
    this.reduceMotion.addEventListener('change', this.motionPreferenceChanged);
    this.resizeObserver = new ResizeObserver(this.resize); this.resizeObserver.observe(host);
    this.visibilityObserver = new IntersectionObserver(entries => {
      this.inViewport = entries[0]?.isIntersecting ?? false;
      this.refreshSchedule();
    }, {rootMargin: '40px'});
    this.visibilityObserver.observe(host);
    // Follow the same resolved appearance as the page, including live system changes.
    // Update this scene in place so a theme switch keeps the model and its pose.
    this.themeObserver = new MutationObserver(() => this.sync());
    this.themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
    this.resize(); this.sync(); this.installQA();
  }

  async load() {
    try {
      const fetchAsset = <T,>(name: string, consume: (response: Response) => Promise<T>) => request(assetURL(name), async response => {
        if (!response.ok) throw new RequestFailure('http', `Asset ${name}: HTTP ${response.status}`, response.status);
        return consume(response);
      }, {signal: this.abort.signal, timeoutMs: 120000});
      const [vehicle, hdrBytes] = await Promise.all([
        loadVehicle(this.props().modelId ?? 'modely-2025', this.abort.signal).then(vehicle => {
          if (this.disposed) {freeObject(vehicle.scene); throw new DOMException('Disposed', 'AbortError');}
          this.model = vehicle.scene;
          return vehicle;
        }),
        fetchAsset('Atelier.hdr', response => response.arrayBuffer()),
      ]);
      if (this.disposed) return;
      const audit = vehicle.audit;
      this.model = vehicle.scene; this.audit = audit;
      await this.loadingTurn();
      if (this.disposed) return;
      const counts = {nodes: 0, meshes: 0, triangles: 0};
      this.model.traverse(node => {
        if (typeof node.userData.sourceNodeIndex === 'number') counts.nodes++;
        if (node instanceof THREE.Mesh) {counts.meshes++; counts.triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;}
      });
      if (counts.nodes !== audit.nodeCount || counts.meshes !== audit.geometryCount || counts.triangles !== audit.triangles) throw new Error('Articulated asset counts differ from its lossless export audit.');
      this.nativeMaterials = vehicle.nativeMaterials;
      this.materialsPrivate(this.model, vehicle.nativeMaterials);
      this.paintKey = '';
      if (!vehicle.nativeMaterials) this.cabin = restoreCabin(this.model, makeCenterDisplayTexture());
      else {
        const fill = new THREE.PointLight(0xf1f5fa, 1.25, 3.5, 2);
        fill.name = 'vehicle-cabin-fill'; fill.position.set(0, 1.25, .15); this.model.add(fill);
      }
      this.car.add(this.model); this.model.position.fromArray(audit.groundingTranslation);
      this.model.updateMatrixWorld(true);
      for (const wheel of audit.wheels) {
        const pivot = new THREE.Group(); pivot.name = wheel.name; pivot.position.fromArray(wheel.center);
        const roll = new THREE.Group(); roll.name = `${wheel.name}-roll`; pivot.add(roll);
        this.model.add(pivot); this.model.updateMatrixWorld(true);
        for (const name of wheel.components) {
          const component = this.model.getObjectByName(name);
          if (!component) throw new Error(`Wheel component missing: ${name}`);
          roll.attach(component);
        }
        for (const name of wheel.steeringComponents ?? []) {
          const component = this.model.getObjectByName(name);
          if (!component) throw new Error(`Steering component missing: ${name}`);
          pivot.attach(component);
        }
        this.wheels.push({pivot, roll, front: wheel.axle === 'front', radius: wheel.radiusMetres, angle: 0});
      }
      const front = audit.wheels.find(wheel => wheel.axle === 'front'), rear = audit.wheels.find(wheel => wheel.axle === 'rear');
      if (front && rear) this.wheelbase = Math.abs(front.center[2] - rear.center[2]);
      for (const hinge of audit.hinges) {
        const node = this.model.getObjectByName(hinge.name);
        if (!node) throw new Error(`Articulated hinge missing: ${hinge.name}`);
        this.hinges.push({...hinge, node, closed: node.quaternion.clone(), axisVector: new THREE.Vector3().fromArray(hinge.axis), value: 0, from: 0, target: 0, elapsed: hinge.durationSeconds});
      }
      const chargePort = this.hinges.find(hinge => hinge.stateKey === 'chargePort');
      if (chargePort) {
        // Capture the closed lid's surface before its hinge moves. The socket
        // belongs to the body, so opening the flap never drags the connector.
        const box = new THREE.Box3().setFromObject(chargePort.node);
        const socket = vehicle.chargeSocket?.clone() ?? box.getCenter(new THREE.Vector3());
        if (!vehicle.chargeSocket) socket.x = box.min.x - .012;
        this.charger = new GarageCharger(socket); this.car.add(this.charger.root); this.chargingKey = '';
      }
      this.addContactShadows();
      await this.loadingTurn();
      if (this.disposed) return;
      const hdr = new HDRLoader().setDataType(THREE.HalfFloatType).parse(hdrBytes);
      const sourceTexture = new THREE.DataTexture(hdr.data, hdr.width, hdr.height, THREE.RGBAFormat, hdr.type);
      sourceTexture.colorSpace = THREE.LinearSRGBColorSpace;
      sourceTexture.minFilter = sourceTexture.magFilter = THREE.LinearFilter;
      sourceTexture.generateMipmaps = false; sourceTexture.flipY = true;
      sourceTexture.mapping = THREE.EquirectangularReflectionMapping; sourceTexture.needsUpdate = true;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.environment = pmrem.fromEquirectangular(sourceTexture);
      this.scene.environment = this.environment.texture; sourceTexture.dispose(); pmrem.dispose();
      this.sync(); this.applyDoorSignals(true);
      await this.loadingTurn();
      if (!await this.prepare()) return;
    } catch (error) {
      if (this.model && !this.model.parent) {freeObject(this.model); this.model = null;}
      this.loadFailed(error);
    }
  }

  private loadingTurn(delay = 0) {return new Promise<void>(resolve => setTimeout(resolve, delay));}

  private loadFailed(error: unknown) {
    if (this.disposed || this.abort.signal.aborted || this.contextLost) return;
    this.abort.abort();
    const detail = error instanceof Error ? error.message : String(error);
    this.errors.push(detail); this.phase('error', error instanceof RequestFailure && error.kind === 'timeout' ? '车库载入超时，请重新载入' : '车库暂时无法载入');
    this.updateQADOM();
  }

  private async prepare(): Promise<boolean> {
    if (this.disposed || this.contextLost || !this.model || this.abort.signal.aborted) return false;
    const version = ++this.preparationVersion, settingsKey = this.settingsKey;
    const current = () => !this.disposed && !this.contextLost && !this.abort.signal.aborted && version === this.preparationVersion;
    this.fitHeroCamera();
    // Upload every source geometry, HDR and material before revealing an entry.
    // The loading cover remains in place for this warm-up draw; no parked image
    // or parked model flashes before the first distant arrival pose.
    if (this.entryRequested && this.props().settings.arrival && !this.reduceMotion.matches && this.currentSpeed() === 0 && !this.chargingState.connected) {
      this.poseEntry(0);
    }
    this.renderer.compile(this.scene, this.camera);
    // Wait for linked programs without querying their logs or uniforms early.
    // Unlike compileAsync's internal timer, this polling also stops on dispose
    // or context loss, before Three's program objects can be released.
    const context = this.renderer.getContext();
    const parallel = this.renderer.extensions.get('KHR_parallel_shader_compile') as {COMPLETION_STATUS_KHR: number} | null;
    const programs = (this.renderer.info.programs ?? []).map(program => program.program as WebGLProgram);
    const deadline = performance.now() + 30000;
    if (parallel) {
      while (current() && programs.some(program => !context.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR))) {
        if (performance.now() >= deadline) throw new RequestFailure('timeout', 'Garage shader preparation timed out');
        await this.loadingTurn(10);
      }
    }
    await this.loadingTurn();
    if (!current()) return false;
    // A material or theme changed while the programs were linking. Prepare
    // that latest scene before removing the loading cover.
    if (this.settingsKey !== settingsKey) return this.prepare();
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    this.ready = true; this.entryPhase = this.entryRunning ? 'arriving' : 'parked'; this.dirty = true;
    this.phase('ready'); this.startEntryIfEligible(); this.refreshSchedule();
    if (this.audit) this.props().onReady?.({triangles: this.audit.triangles, nodes: this.audit.nodeCount, renderer: String(context.getParameter(context.VERSION))});
    return true;
  }

  sync() {
    if (this.disposed) return;
    const props = this.props();
    if (this.qaEnabled && props.active && this.qaInspector) (window as any).__garage = this.qaInspector;
    if (props.active !== this.lastActive) {
      this.lastActive = props.active;
      if (props.active) {this.entryRequested = true; if (this.ready) this.resize();}
      else {this.entryRequested = false; this.settleEntry();}
    }
    const settings = props.settings;
    this.syncCharging();
    const appearance = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const settingsKey = [appearance, settings.paint, settings.finish, settings.livery, settings.environment, settings.rain, settings.arrival].join('|');
    if (this.settingsKey !== settingsKey) {
      this.settingsKey = settingsKey;
      const palette = GROUND[appearance], tone = palette[settings.environment] ?? palette.studio;
      const backdrop = appearance === 'light' ? rgb(.953, .961, .961) : rgb(.11, .11, .11);
      (this.scene.background as THREE.Color).copy(backdrop);
      (this.scene.fog as THREE.Fog).color.copy(backdrop);
      this.floorMaterial.color.copy(rgb(...tone));
      this.floorMaterial.roughness = settings.rain ? .8 : .88;
      this.floorMaterial.clearcoat = settings.rain ? .008 : 0;
      this.floorMaterial.clearcoatRoughness = .65;
      this.dirty = true;
    }
    if (this.model) {
      const paintKey = [settings.paint, settings.finish, settings.livery].join('|');
      if (this.paintKey !== paintKey) {
        this.paintKey = paintKey;
        const oldLivery = this.livery;
        this.livery = settings.livery === 'plain' ? null : makeLivery(settings.paint, settings.livery);
        if (this.livery && this.nativeMaterials) this.livery.channel = 1;
        const finish = FINISH[settings.finish] ?? FINISH.gloss;
        for (const material of this.paints) {
          const hadMap = material.map !== null;
          material.map = this.livery;
          material.color.copy(this.livery ? rgb(1, 1, 1) : rgb(...(PAINTS[settings.paint] ?? PAINTS.pearl)));
          material.metalness = settings.paint === 'silver' ? .62 : (settings.paint === 'pearl' ? .12 : .28);
          Object.assign(material, finish);
          if (hadMap !== (material.map !== null)) material.needsUpdate = true;
        }
        oldLivery?.dispose();
        this.dirty = true;
      }
      this.applyDoorSignals(!this.ready || this.reduceMotion.matches);
      if (this.reduceMotion.matches) for (const hinge of this.hinges) {
        // A missing latest boolean must still respect a changed motion preference.
        hinge.value = hinge.target; hinge.elapsed = hinge.durationSeconds; this.poseHinge(hinge);
        this.shadowDirty = true;
      }
    }
    this.speed = this.currentSpeed();
    if (!settings.arrival || this.reduceMotion.matches || this.speed !== 0 || this.chargingState.connected) {
      if (this.speed !== 0) this.entryRequested = false;
      if (this.chargingState.connected) this.entryRequested = false;
      this.settleEntry();
    }
    this.rain.visible = settings.rain && !this.reduceMotion.matches;
    this.road.visible = this.speed !== 0 && !this.reduceMotion.matches;
    this.dirty = true;
    this.startEntryIfEligible(); if (this.ready) this.fitHeroCamera(); this.refreshSchedule();
  }

  private currentTelemetry() {return this.fixture ?? this.props();}
  private syncCharging() {
    const {status, received} = this.currentTelemetry();
    const state = garageChargingState(status, received, Date.now());
    const light = document.documentElement.dataset.theme === 'light';
    const key = [state.connected, state.animate, state.phase, light, this.reduceMotion.matches].join('|');
    this.chargingState = state;
    if (key === this.chargingKey) return;
    this.chargingKey = key; this.chargingChanged(state);
    if (state.connected) {this.entryRequested = false; this.settleEntry();}
    const changed = this.charger?.setState(state.connected, state.animate, state.phase, light);
    this.charger?.update(0, this.reduceMotion.matches);
    this.applyDoorSignals(!this.ready || this.reduceMotion.matches);
    if (changed) {
      if (state.connected) this.car.rotation.y = -1.75;
      this.fitPoints = []; this.resize(); this.updateZoomLimits(); this.shadowDirty = true;
    }
    this.dirty = true;
  }
  private currentSpeed() {
    const {status, units, received} = this.currentTelemetry();
    return motionSpeed(status, units, received, Date.now());
  }

  private applyDoorSignals(immediate = false) {
    const signals = doorSignals(this.currentTelemetry().status);
    for (const hinge of this.hinges) {
      const signal = hinge.stateKey === 'chargePort' && this.chargingState.connected ? true : signals[hinge.stateKey];
      if (typeof signal !== 'boolean') continue;
      const target = signal ? hinge.openRadians : 0;
      if (target === hinge.target && !immediate) continue;
      hinge.from = hinge.value; hinge.target = target; hinge.elapsed = immediate ? hinge.durationSeconds : 0;
      if (immediate) {hinge.value = target; this.poseHinge(hinge);}
      this.shadowDirty = true;
    }
  }

  private poseHinge(hinge: Hinge) {
    hinge.node.quaternion.copy(hinge.closed).multiply(this.temporaryQuaternion.setFromAxisAngle(hinge.axisVector, hingePoseAngle(hinge, hinge.value)));
  }

  private materialsPrivate(model: THREE.Object3D, native = false) {
    const oldMaterials = new Set<THREE.Material>();
    model.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const originals = Array.isArray(node.material) ? node.material : [node.material];
      const physical = originals.map(original => {
        oldMaterials.add(original);
        const old = original as THREE.MeshStandardMaterial;
        if (native) {
          const material = new THREE.MeshPhysicalMaterial();
          // Preserve the source cabin, lamp and trim maps. The legacy Juniper
          // follows its unchanged material restoration below.
          if (old instanceof THREE.MeshPhysicalMaterial) material.copy(old);
          else THREE.MeshStandardMaterial.prototype.copy.call(material, old);
          material.envMapIntensity = old.name === 'glass' ? .4 : 1;
          if (old.name === 'exterior_paint') this.paints.push(material);
          if (old.name === 'glass') {
            material.transparent = true; material.opacity = Math.min(material.opacity,.28);
            material.depthWrite = false; material.side = THREE.DoubleSide; material.forceSinglePass = true;
            material.transmission = 0; node.castShadow = false;
          }
          return material;
        }
        const material = new THREE.MeshPhysicalMaterial({
          name: old.name, color: old.color.clone(), metalness: old.metalness, roughness: old.roughness,
          emissive: old.emissive.clone(), emissiveIntensity: old.emissiveIntensity,
          side: old.side, opacity: 1, transparent: false, depthWrite: true,
          shadowSide: THREE.BackSide, envMapIntensity: 1,
        });
        const name = old.name;
        if (name === 'exterior_paint') this.paints.push(material);
        else if (name === 'signature_led') {
          material.color.copy(rgb(.65, .65, .65)); material.emissive.copy(rgb(.72, .72, .72)); material.emissiveIntensity = .35;
        } else if (name === 'glass' && node.name.startsWith('Plane050_Mesh036')) {
          material.color.copy(rgb(.3, .3, .3)); material.metalness = .95; material.roughness = .12;
        } else if (name === 'glass') {
          configureCabinGlass(material, node.name);
          node.castShadow = false;
        } else if (name === 'interior_leather') {
          material.color.copy(rgb(.075, .075, .075)); material.roughness = .86; material.metalness = 0;
        } else if (name === 'tire_rubber') {
          material.color.copy(rgb(.055, .055, .055)); material.roughness = .84; material.metalness = 0;
        } else if (name === 'wheel_finish') {
          material.color.copy(rgb(.19, .19, .19)); material.roughness = .28; material.metalness = .78;
        } else if (name === 'satin_trim') {
          material.color.copy(rgb(.038, .038, .038)); material.roughness = .48; material.metalness = .08;
        } else if (name === 'brake_rotor') {
          material.color.copy(rgb(.24, .24, .24)); material.roughness = .42; material.metalness = .82;
        }
        return material;
      });
      node.material = Array.isArray(node.material) ? physical : physical[0];
      node.castShadow = !originals.some(material => material.name === 'glass' && !node.name.startsWith('Plane050_Mesh036'));
      node.receiveShadow = true;
    });
    oldMaterials.forEach(material => material.dispose());
  }

  private addContactShadows() {
    const texture = contactTexture();
    const patch = (name: string, width: number, length: number, x: number, z: number, y: number, opacity: number) => {
      const material = new THREE.MeshBasicMaterial({map: texture, transparent: true, opacity, depthWrite: false, toneMapped: false});
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), material);
      mesh.name = name; mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); mesh.renderOrder = 1;
      this.car.add(mesh);
    };
    patch('garage-chassis-occlusion', 3.2, 6.1, 0, 0, .004, .55);
    patch('garage-underbody-occlusion', 2.1, 4.9, 0, 0, .006, .4);
    this.wheels.forEach((wheel, index) => patch(`garage-tire-contact-${index}`, .65, wheel.radius * 2.1, wheel.pivot.position.x, wheel.pivot.position.z, .008, .9));
  }

  private makeRain() {
    const positions = new Float32Array(180 * 6);
    // Fixed seed keeps switching environments from replacing the weather pattern.
    let seed = 71341;
    const next = () => {seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296;};
    for (let i = 0; i < positions.length; i += 6) {
      const x = (next() - .5) * 11, y = next() * 5.4, z = (next() - .5) * 12;
      positions.set([x, y, z, x + .008, y + .15, z], i);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const rain = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({color: rgb(.72, .72, .72), transparent: true, opacity: .19, depthWrite: false, toneMapped: false}));
    rain.name = 'garage-rain'; rain.frustumCulled = false; rain.visible = false; rain.renderOrder = 3;
    return rain;
  }

  private startEntryIfEligible() {
    if (!this.ready || this.disposed || !this.lastActive || !this.inViewport || this.pageHidden || this.contextLost || !this.entryRequested || this.entryRunning) return;
    if (!this.props().settings.arrival || this.reduceMotion.matches || this.currentSpeed() !== 0 || this.chargingState.connected) {
      this.car.position.set(0, 0, 0); this.car.rotation.set(0, 0, 0); this.steerWheels(0); this.entryRequested = false; this.entryPhase = 'parked'; return;
    }
    this.entryRequested = false; this.entryRunning = true; this.entryElapsed = 0; this.entryCount++;
    this.entryWallStarted = performance.now(); this.lastFrame = this.entryWallStarted; this.entryTrace = [];
    this.poseEntry(0);
    this.entryPhase = 'arriving';
    this.shadowDirty = true; this.dirty = true;
  }

  private steerWheels(steer: number) {
    for (const wheel of this.wheels) wheel.pivot.rotation.y = wheel.front ? frontWheelSteering(steer, wheel.pivot.position.x, this.wheelbase) : 0;
  }

  private poseEntry(distance: number) {
    const pose = driftPose(distance);
    this.car.position.set(pose.x, 0, pose.z); this.car.rotation.set(0, pose.yaw, 0);
    this.steerWheels(driftSteering(distance));
    for (const wheel of this.wheels) {wheel.angle = -distance / wheel.radius; wheel.roll.rotation.x = wheel.angle;}
  }

  private settleEntry(preserveYaw = false) {
    if (!this.entryRunning && this.car.position.lengthSq() === 0) return;
    this.entryRunning = false; this.car.position.set(0, 0, 0);
    this.steerWheels(0);
    if (!preserveYaw) this.car.rotation.set(0, 0, 0);
    this.entryPhase = 'parked'; this.shadowDirty = true; this.dirty = true;
    // Preserve reached wheel angles when motion is interrupted.
  }

  private canRender() {return this.ready && !this.disposed && this.lastActive && !this.pageHidden && this.inViewport && !this.contextLost;}
  private refreshSchedule() {
    this.updateQADOM();
    if (!this.canRender() || !this.chargingState.connected) {
      window.clearTimeout(this.chargingTimer); this.chargingTimer = 0;
    } else if (!this.chargingTimer) {
      // Static connected/reduced-motion states still expire after failed polls.
      this.chargingTimer = window.setTimeout(() => {this.chargingTimer = 0; this.sync();}, 1000);
    }
    if (!this.canRender()) {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0; this.lastFrame = 0; return;
    }
    this.startEntryIfEligible();
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (!this.canRender()) return;
    const visibleDelta = this.lastFrame ? Math.max(0, (now - this.lastFrame) / 1000) : 0;
    const delta = Math.min(.05, visibleDelta);
    // A queued RAF can carry a timestamp from before preparation finished.
    // Never count that pre-entry work as visible arrival animation time.
    this.lastFrame = Math.max(now, this.lastFrame);
    this.syncCharging();
    this.speed = this.currentSpeed();
    if (this.speed !== 0 && this.entryRunning) {this.entryRequested = false; this.settleEntry();}
    const wasArriving = this.entryRunning;
    let animating = false, hingesChanged = false;
    for (const hinge of this.hinges) if (hinge.value !== hinge.target) {
      hinge.elapsed = Math.min(hinge.durationSeconds, hinge.elapsed + delta);
      hinge.value = hinge.from + (hinge.target - hinge.from) * smooth(hinge.elapsed / hinge.durationSeconds);
      if (hinge.elapsed === hinge.durationSeconds) hinge.value = hinge.target;
      this.poseHinge(hinge); this.shadowDirty = true; this.dirty = true; animating = true; hingesChanged = true;
    }
    if (this.entryRunning) {
      this.entryElapsed = Math.min(ENTRY_DURATION, this.entryElapsed + visibleDelta);
      const distance = arrivalDistance(this.entryElapsed);
      this.poseEntry(distance);
      this.shadowDirty = true; this.dirty = true; animating = true;
      if (this.entryElapsed === ENTRY_DURATION) {this.entryRunning = false; this.car.position.set(0, 0, 0); this.car.rotation.set(0, 0, 0); this.entryPhase = 'parked';}
    } else if (this.speed !== 0 && !this.reduceMotion.matches) {
      for (const wheel of this.wheels) {wheel.angle -= this.speed * delta / wheel.radius; wheel.roll.rotation.x = wheel.angle;}
      this.roadPhase = (this.roadPhase + this.speed * delta) % 4;
      this.road.position.z = this.roadPhase; this.dirty = true; animating = true;
    }
    const roadVisible = this.speed !== 0 && !this.reduceMotion.matches;
    if (this.road.visible !== roadVisible) {this.road.visible = roadVisible; this.dirty = true;}
    if (this.rain.visible && !this.reduceMotion.matches) {
      const attribute = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      const positions = attribute.array as Float32Array;
      for (let i = 0; i < positions.length; i += 6) {
        const y = positions[i + 1] - 6.4 * delta;
        positions[i + 1] = y < -.2 ? 5.4 : y; positions[i + 4] = positions[i + 1] + .15;
      }
      attribute.needsUpdate = true; this.dirty = true; animating = true;
    }
    if (this.charger?.update(delta, this.reduceMotion.matches)) {this.dirty = true; animating = true;}
    // Pointer events can arrive more often than display frames. Accumulate the
    // pose immediately, then fit it together with moving hinges before drawing.
    if ((hingesChanged || this.inputFitPending) && !this.entryRunning) this.fitHeroCamera();
    if (this.dirty) {
      const started = performance.now();
      this.renderer.shadowMap.needsUpdate = this.shadowDirty;
      this.renderer.render(this.scene, this.camera);
      this.renderMilliseconds = performance.now() - started;
      this.frames++; this.dirty = false; this.shadowDirty = false;
      if (this.qaEnabled && wasArriving) this.entryTrace.push({frame: this.frames, elapsed: this.entryElapsed,
        wallSeconds: (performance.now() - this.entryWallStarted) / 1000,
        position: this.car.position.toArray(), yaw: this.car.rotation.y,
        wheelAngles: this.wheels.map(wheel => wheel.roll.rotation.x), wheelSteering: this.wheels.map(wheel => wheel.pivot.rotation.y)});
    }
    this.updateQADOM();
    // syncCharging can resize and schedule a frame during this callback.
    // Keep a single loop when telemetry expires while hinges/rain still move.
    if (animating && !this.raf) this.raf = requestAnimationFrame(this.frame);
    if (!this.raf) this.lastFrame = 0;
  };

  private resize = () => {
    if (this.disposed) return;
    const width = this.host.clientWidth || this.renderWidth || 400, height = this.host.clientHeight || this.renderHeight || 320;
    // setSize rewrites canvas.width/height even when unchanged. Preserve its
    // drawing buffer during zoom, page returns and duplicate resize callbacks.
    if (width !== this.renderWidth || height !== this.renderHeight) {
      this.renderer.setSize(width, height, false);
      this.renderWidth = width; this.renderHeight = height;
    }
    const aspect = width / height;
    this.camera.aspect = aspect;
    const style = this.props().presentation === 'hero' ? getComputedStyle(this.host) : null;
    this.protectedTop = parseFloat(style?.getPropertyValue('--garage-protect-top') ?? '') || (this.chargingState.connected ? 46 : 0);
    this.protectedBottom = parseFloat(style?.getPropertyValue('--garage-protect-bottom') ?? '') || (this.chargingState.connected ? (this.props().presentation === 'hero' ? 92 : 12) : 0);
    const referenceHeight = parseFloat(style?.getPropertyValue('--garage-framing-height') ?? '') || height;
    // Preserve the previous projected vehicle scale when the mobile card grows.
    const referenceAspect = width / referenceHeight;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(29 / 2)) * Math.min(1, 1.4 / referenceAspect) * height / referenceHeight));
    this.camera.clearViewOffset();
    if (this.protectedTop) this.camera.setViewOffset(width, height, 0, -(this.protectedTop - this.protectedBottom) / 2, width, height);
    this.positionCamera(); this.camera.updateProjectionMatrix();
    this.fitHeroCamera();
    this.updateZoomLimits();
    this.dirty = true; this.refreshSchedule();
  };

  private positionCamera() {
    this.car.updateWorldMatrix(true, false);
    const target = this.chargingState.connected
      ? new THREE.Vector3(0, .82, .66).applyMatrix4(this.car.matrixWorld)
      : new THREE.Vector3(0, .72, 0);
    const direction = new THREE.Vector3(-5.5, this.chargingState.connected ? 3.4 : 2.45 - .72, -8.2).normalize();
    this.camera.position.copy(direction.multiplyScalar(this.zoomDistance)).add(target);
    this.camera.lookAt(target); this.camera.updateMatrixWorld();
  }

  private collectFitPoints() {
    if (this.fitPoints.length || !this.model) return;
    const collect = (node: THREE.Object3D) => {
      if (!(node instanceof THREE.Mesh)) return;
      const geometry = node.geometry as THREE.BufferGeometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const corners: THREE.Vector3[] = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
      this.fitPoints.push({node, corners});
    };
    this.model.traverseVisible(collect);
    if (this.charger?.root.visible) this.charger.root.traverseVisible(collect);
  }

  private fitHeroCamera() {
    if (!this.model || !this.lastActive || this.entryRunning) return;
    this.inputFitPending = false;
    this.collectFitPoints(); this.car.updateWorldMatrix(true, true); this.positionCamera();
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    const xLimit = Math.max(.1, 1 - 12 / width), yLimit = Math.max(.1, (height - this.protectedTop - this.protectedBottom - 12) / height);
    const projection = this.camera.projectionMatrix.elements;
    let requiredDelta = -Infinity;
    for (const {node, corners} of this.fitPoints) for (const corner of corners) {
      const p = this.fittingPoint.copy(corner).applyMatrix4(node.matrixWorld).applyMatrix4(this.camera.matrixWorldInverse);
      requiredDelta = Math.max(requiredDelta, Math.abs(p.x) * projection[0] / xLimit + p.z, Math.abs(p.y) * projection[5] / yLimit + p.z);
    }
    this.minimumZoomDistance = Math.max(5.8, this.zoomDistance + requiredDelta);
    if (this.zoomDistance + .001 < this.minimumZoomDistance) {
      this.zoomDistance = this.minimumZoomDistance;
      this.positionCamera();
    }
    this.updateZoomLimits();
  }

  private updateZoomLimits() {
    const minimum = this.minimumZoomDistance;
    const maximum = Math.max(11.5, minimum + 1.5);
    const limits = {canZoomIn: this.zoomDistance > minimum + .05, canZoomOut: this.zoomDistance < maximum - .05};
    const key = String(limits.canZoomIn) + ':' + String(limits.canZoomOut);
    if (key !== this.zoomLimitsKey) {this.zoomLimitsKey = key; this.zoomLimitsChanged(limits);}
  }

  private framingInfo() {
    this.collectFitPoints(); this.car.updateWorldMatrix(true, true); this.camera.updateMatrixWorld();
    const bounds = {left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity};
    for (const {node, corners} of this.fitPoints) for (const corner of corners) {
      const p = this.fittingPoint.copy(corner).applyMatrix4(node.matrixWorld).project(this.camera);
      const x = (p.x + 1) * this.host.clientWidth / 2, y = (1 - p.y) * this.host.clientHeight / 2;
      bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x); bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
    }
    return {width: this.host.clientWidth, height: this.host.clientHeight, protectedTop: this.protectedTop, protectedBottom: this.protectedBottom, bounds, distance: this.zoomDistance, fov: this.camera.fov};
  }

  private cancelEntryForInteraction() {this.entryRequested = false; this.settleEntry(true);}
  rotate(amount: number, deferFit = false) {
    this.cancelEntryForInteraction(); this.car.rotation.y += amount;
    if (deferFit) this.inputFitPending = true; else this.fitHeroCamera();
    this.shadowDirty = true; this.dirty = true; this.refreshSchedule();
  }
  zoom(amount: number, deferFit = false) {
    this.cancelEntryForInteraction(); this.zoomDistance = THREE.MathUtils.clamp(this.zoomDistance * amount, 5.8, Math.max(11.5, this.minimumZoomDistance + 1.5));
    if (deferFit) this.inputFitPending = true; else this.fitHeroCamera();
    this.dirty = true; this.refreshSchedule();
  }
  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.pointerPositions.set(event.pointerId, {x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY});
    this.renderer.domElement.setPointerCapture(event.pointerId);
    if (this.pointerPositions.size === 2) {this.pinchDistance = this.pointerDistance(); this.cancelEntryForInteraction();}
  };
  private pointerDistance() {
    const points = [...this.pointerPositions.values()];
    return points.length === 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
  }
  private pointerMove = (event: PointerEvent) => {
    const old = this.pointerPositions.get(event.pointerId); if (!old) return;
    const deltaX = event.clientX - old.x;
    this.pointerPositions.set(event.pointerId, {...old, x: event.clientX, y: event.clientY});
    if (this.pointerPositions.size === 2) {
      const distance = this.pointerDistance();
      if (distance > 0 && this.pinchDistance > 0) this.zoom(this.pinchDistance / distance, true);
      this.pinchDistance = distance; event.preventDefault();
    } else if (Math.abs(event.clientX - old.startX) > Math.abs(event.clientY - old.startY) && Math.abs(event.clientX - old.startX) > 4) {
      this.rotate(deltaX * .008, true); event.preventDefault();
    }
  };
  private pointerUp = (event: PointerEvent) => {
    this.pointerPositions.delete(event.pointerId); this.pinchDistance = 0;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
  };
  private visibilityChanged = () => {this.pageHidden = document.hidden; this.dirty = true; this.refreshSchedule();};
  private pageHide = () => {this.pageHidden = true; this.refreshSchedule();};
  private pageShow = () => {this.pageHidden = document.hidden; this.dirty = true; this.sync();};
  private motionPreferenceChanged = () => {this.sync();};
  private lostContext = (event: Event) => {
    event.preventDefault(); this.contextLost = true; this.preparationVersion++; this.errors.push('WebGL context lost'); this.refreshSchedule(); this.phase('loading');
  };
  private restoredContext = () => {
    if (this.disposed) return;
    this.contextLost = false; void this.prepare().catch(error => this.loadFailed(error));
  };

  private installQA() {
    if (!this.qaEnabled) return;
    const engine = this;
    const inspector = {
      get ready() {return engine.ready && !engine.disposed && !engine.contextLost;},
      get nodes() {return engine.audit?.nodeCount ?? 0;},
      get modelId() {return engine.props().modelId ?? 'modely-2025';},
      get geometry() {return engine.audit?.geometryCount ?? 0;},
      get triangles() {return engine.audit?.triangles ?? 0;},
      get interior() {return engine.cabin ? {...engine.cabin} : null;},
      get charging() {return engine.charger?.info ?? null;},
      get framing() {return engine.framingInfo();},
      get entryCount() {return engine.entryCount;},
      get entryPhase() {return engine.entryPhase;},
      get entryDuration() {return ENTRY_DURATION;},
      get entryElapsed() {return engine.entryElapsed;},
      get entryArcLength() {return ENTRY_ARC_LENGTH;},
      get entryTrace() {return engine.entryTrace.map(frame => ({...frame, position: [...frame.position], wheelAngles: [...frame.wheelAngles], wheelSteering: [...frame.wheelSteering]}));},
      get vehiclePosition() {return engine.car.position.toArray();},
      get vehicleYaw() {return engine.car.rotation.y;},
      get speed() {return engine.speed;},
      get paused() {return !engine.canRender();},
      get errors() {return [...engine.errors];},
      get settings() {return {...engine.props().settings};},
      get paintMaterials() {return engine.paints.map(material => ({color:material.color.getHexString(),map:!!material.map,roughness:material.roughness,metalness:material.metalness}));},
      get appearance() {return {theme: document.documentElement.dataset.theme, background: (engine.scene.background as THREE.Color).getHexString(), fog: (engine.scene.fog as THREE.Fog).color.getHexString(), floor: engine.floorMaterial.color.getHexString()};},
      get hinges() {return Object.fromEntries(engine.hinges.map(hinge => [hinge.stateKey, {name: hinge.name, angle: hinge.value, target: hinge.target, position: hinge.node.position.toArray(), quaternion: hinge.node.quaternion.toArray()}]));},
      get joints() {return engine.hinges.map(hinge => ({stateKey:hinge.stateKey,name:hinge.name,motion:hinge.motion,angle:hinge.value,pose:hingePoseAngle(hinge,hinge.value),target:hinge.target,quaternion:hinge.node.quaternion.toArray()}));},
      get wheels() {return engine.wheels.map(wheel => ({name: wheel.pivot.name, front: wheel.front, angle: wheel.roll.rotation.x, steering: wheel.pivot.rotation.y, radius: wheel.radius, center: wheel.pivot.position.toArray()}));},
      get performance() {return {frames: engine.frames, lastRenderMs: engine.renderMilliseconds, pixelRatio: engine.renderer.getPixelRatio(), calls: engine.renderer.info.render.calls, geometries: engine.renderer.info.memory.geometries, textures: engine.renderer.info.memory.textures};},
      // Fixture injection exists only in explicit local QA mode. It drives this
      // local renderer and never sends a request or changes persisted settings.
      setTelemetry(status: any, units = {unit_of_length: 'km'}, received: number | null = Date.now()) {engine.fixture = {status, units, received}; engine.sync();},
      clearTelemetry() {engine.fixture = null; engine.sync();},
      rotate(amount: number) {engine.rotate(amount);},
      zoom(amount: number) {engine.zoom(amount);},
    };
    this.qaInspector = inspector; (window as any).__garage = inspector;
    this.updateQADOM();
  }

  private updateQADOM() {
    if (!this.qaEnabled || this.disposed) return;
    this.host.dataset.garageQa = JSON.stringify({
      ready: this.ready && !this.contextLost, modelId:this.props().modelId ?? 'modely-2025', nodes: this.audit?.nodeCount ?? 0,
      geometry: this.audit?.geometryCount ?? 0, triangles: this.audit?.triangles ?? 0,
      interior: this.cabin,
      entryCount: this.entryCount, entryPhase: this.entryPhase, vehiclePosition: this.car.position.toArray(),
      entryDuration: ENTRY_DURATION, entryElapsed: this.entryElapsed, entryArcLength: ENTRY_ARC_LENGTH,
      entryTrace: this.entryTrace,
      vehicleYaw: this.car.rotation.y, speed: this.speed, paused: !this.canRender(), errors: this.errors,
      hinges: Object.fromEntries(this.hinges.map(hinge => [hinge.stateKey, {angle: hinge.value, target: hinge.target}])),
      wheels: this.wheels.map(wheel => ({name: wheel.pivot.name, front: wheel.front, angle: wheel.roll.rotation.x, steering: wheel.pivot.rotation.y, radius: wheel.radius})),
      performance: {frames: this.frames, lastRenderMs: this.renderMilliseconds, pixelRatio: this.renderer.getPixelRatio(), calls: this.renderer.info.render.calls, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures},
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.preparationVersion++; this.abort.abort(); if (this.raf) cancelAnimationFrame(this.raf);
    this.inputFitPending = false;
    window.clearTimeout(this.chargingTimer);
    this.resizeObserver.disconnect(); this.visibilityObserver.disconnect(); this.themeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    window.removeEventListener('pagehide', this.pageHide); window.removeEventListener('pageshow', this.pageShow);
    this.reduceMotion.removeEventListener('change', this.motionPreferenceChanged);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.pointerDown); canvas.removeEventListener('pointermove', this.pointerMove);
    canvas.removeEventListener('pointerup', this.pointerUp); canvas.removeEventListener('pointercancel', this.pointerUp);
    canvas.removeEventListener('webglcontextlost', this.lostContext); canvas.removeEventListener('webglcontextrestored', this.restoredContext);
    if (this.model && !this.model.parent) freeObject(this.model);
    freeObject(this.scene); this.model = null; this.environment?.dispose(); this.livery?.dispose(); this.fitPoints = [];
    this.scene.clear(); this.renderer.renderLists.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); canvas.remove();
    delete this.host.dataset.garageQa;
    if (this.qaEnabled && (window as any).__garage === this.qaInspector) delete (window as any).__garage;
  }
}

export default function Garage(props: Props) {
  const [loadedModelId,setLoadedModelId] = useState<VehicleModelID>(props.modelId ?? 'modely-2025');
  const [activated,setActivated] = useState(props.active);
  const host = useRef<HTMLDivElement>(null), engine = useRef<GarageEngine | null>(null), latest = useRef(props);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState(''), [attempt, setAttempt] = useState(0);
  const [zoomLimits,setZoomLimits] = useState<ZoomLimits>({canZoomIn:true,canZoomOut:true});
  const [charging,setCharging] = useState(() => garageChargingState(props.status, props.received));
  latest.current = {...props,modelId:loadedModelId};
  // A hidden homepage retains its existing scene. Load the newly selected model
  // when that scene becomes visible, avoiding a second offscreen preparation.
  useEffect(() => {if (props.active) {setActivated(true); setLoadedModelId(props.modelId ?? 'modely-2025');}}, [props.active,props.modelId]);
  useEffect(() => {
    if (!host.current || !activated) return;
    let mounted = true;
    setPhase('loading'); setMessage('');
    try {
      const instance = new GarageEngine(host.current, () => latest.current, (next, text = '') => {if (mounted) {setPhase(next); setMessage(text);}}, limits => {if (mounted) setZoomLimits(limits);}, state => {if (mounted) setCharging(state);});
      engine.current = instance; void instance.load();
      return () => {mounted = false; engine.current = null; instance.dispose();};
    } catch {
      setPhase('error'); setMessage('当前浏览器无法打开车库');
      return () => {mounted = false;};
    }
  }, [attempt, loadedModelId, activated]);
  useEffect(() => {engine.current?.sync();}, [props.settings, props.status, props.units, props.received, props.active]);
  useEffect(() => {
    const resume = () => {if (!document.hidden && phase === 'error') setAttempt(value => value + 1);};
    document.addEventListener('visibilitychange', resume); window.addEventListener('online', resume); window.addEventListener('pageshow', resume);
    return () => {document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('pageshow', resume);};
  }, [phase]);
  return <div className={'garage-canvas'+(props.presentation==='hero'?' garage-canvas-hero':'')+(charging.connected?' garage-connected':'')} data-model={loadedModelId} style={{position: 'relative', width: '100%', height: '100%', minHeight: 300, overflow: 'hidden'}} role="group" aria-label="车辆三维车库，可水平拖动旋转，双指缩放">
    <div ref={host} style={{width: '100%', height: '100%', position: 'absolute', inset: 0}} />
    <div className="garage-vignette" aria-hidden="true" />
    {phase === 'ready' && charging.connected && props.presentation !== 'hero' && <div className="garage-charge-status" role="status"><span aria-hidden="true">ϟ</span>{charging.label}</div>}
    {phase !== 'ready' && <GarageLoading message={phase==='loading'?undefined:message} onRetry={phase==='error'?()=>setAttempt(value=>value+1):undefined}/>}
    {phase === 'ready' && <div className="garage-view-controls" style={{position: 'absolute', right: 16, display: 'flex', gap: 5}}>
      <button className="garage-view-button" type="button" aria-label="向左旋转车辆" title="旋转" onClick={() => engine.current?.rotate(Math.PI / 6)}>↶</button>
      <button className="garage-view-button" type="button" aria-label="缩小车库视图" title={zoomLimits.canZoomOut?'缩小':'已达缩小上限'} disabled={!zoomLimits.canZoomOut} onClick={() => engine.current?.zoom(1.12)}>−</button>
      <button className="garage-view-button" type="button" aria-label="放大车库视图" title={zoomLimits.canZoomIn?'放大':'已达完整车身放大上限'} disabled={!zoomLimits.canZoomIn} onClick={() => engine.current?.zoom(1 / 1.12)}>+</button>
    </div>}
  </div>;
}

