/** Lossless transport compression for the six added vehicles only.
 * Does not edit public assets. Candidates and immutable source snapshots are
 * written under the intake directory for browser validation before promotion.
 * No vertex/index reorder, quantization, filtering, simplification or texture
 * conversion is performed. INDICES preserves even triangle corner order.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {MeshoptDecoder as ThreeDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {MeshoptEncoder, MeshoptDecoder} = createRequire(require.resolve('@types/three/package.json'))('meshoptimizer');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, ThreeDecoder.ready]);
const allowed = ['model3-2018', 'model3-2024', 'models-2013', 'models-2021', 'modelx-2020', 'modely-2021'];
const selection = process.argv.find(arg => arg.startsWith('--models='));
const ids = selection ? selection.slice('--models='.length).split(',') : allowed;
if (!ids.length || ids.some(id => !allowed.includes(id))) throw new Error('Only the six added vehicle IDs may be processed. The existing Model Y is excluded.');
const outputRoot = path.join(root, '.model-intake-20261112/modelxy/compressed-test');
const snapshotRoot = path.join(root, '.model-intake-20261112/modelxy/compression-inputs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const align4 = n => (n + 3) & ~3;
const dim = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16};
const componentSize = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4};

function readGlb(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB header');
  let json, binary;
  for (let cursor = 12; cursor < bytes.length;) {
    const length = bytes.readUInt32LE(cursor), type = bytes.toString('ascii', cursor + 4, cursor + 8);
    if (cursor + 8 + length > bytes.length) throw new Error('Truncated GLB chunk');
    if (type === 'JSON') json = JSON.parse(bytes.toString('utf8', cursor + 8, cursor + 8 + length));
    else if (type === 'BIN\0') binary = bytes.subarray(cursor + 8, cursor + 8 + length);
    else throw new Error(`Unknown GLB chunk ${type}; refusing to drop it`);
    cursor += 8 + length;
  }
  if (!json || !binary) throw new Error('Self-contained GLB JSON and binary chunks required');
  if (json.buffers.some((buffer, i) => buffer.uri || (i !== 0 && !buffer.extensions?.EXT_meshopt_compression?.fallback))) throw new Error('External/non-fallback buffers require explicit support');
  return {json, binary};
}
function bytesOfView(asset, view) {
  const extension = view.extensions?.EXT_meshopt_compression;
  if (extension) {
    if (extension.buffer !== 0) throw new Error('Compressed data must be in the GLB binary buffer');
    const data = new Uint8Array(view.byteLength);
    MeshoptDecoder.decodeGltfBuffer(data, extension.count, extension.byteStride, asset.binary.subarray(extension.byteOffset || 0, (extension.byteOffset || 0) + extension.byteLength), extension.mode, extension.filter);
    return Buffer.from(data);
  }
  if ((view.buffer ?? 0) !== 0) throw new Error('Uncompressed view references an unavailable fallback buffer');
  const start = view.byteOffset || 0;
  if (start + view.byteLength > asset.binary.length) throw new Error('Buffer view outside binary chunk');
  return asset.binary.subarray(start, start + view.byteLength);
}
function writeGlb(json, binary) {
  const text = Buffer.from(JSON.stringify(json));
  const jsonData = Buffer.concat([text, Buffer.alloc(align4(text.length) - text.length, 32)]);
  const binaryData = Buffer.concat([binary, Buffer.alloc(align4(binary.length) - binary.length)]);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonData.length + binaryData.length, 8);
  jsonHeader.writeUInt32LE(jsonData.length); jsonHeader.write('JSON', 4);
  binHeader.writeUInt32LE(binaryData.length); binHeader.write('BIN\0', 4);
  return Buffer.concat([header, jsonHeader, jsonData, binHeader, binaryData]);
}

const reports = [];
for (const id of ids) {
  const inputPath = path.join(root, 'public/assets/vehicles', id, 'model.glb');
  const original = fs.readFileSync(inputPath), inputSha256 = hash(original), input = readGlb(original), json = structuredClone(input.json);
  const inputSnapshot = path.join(snapshotRoot, id, `${inputSha256}.glb`);
  fs.mkdirSync(path.dirname(inputSnapshot), {recursive: true});
  if (fs.existsSync(inputSnapshot)) {
    if (hash(fs.readFileSync(inputSnapshot)) !== inputSha256) throw new Error(`Snapshot hash mismatch: ${inputSnapshot}`);
  } else fs.writeFileSync(inputSnapshot, original, {flag: 'wx'});

  const imageViews = new Set((json.images || []).map(image => image.bufferView).filter(v => v !== undefined));
  const accessorsForView = new Map();
  for (const accessor of json.accessors || []) if (accessor.bufferView !== undefined) {
    const list = accessorsForView.get(accessor.bufferView) || []; list.push(accessor); accessorsForView.set(accessor.bufferView, list);
  }
  const indexViews = new Set();
  for (const mesh of json.meshes || []) for (const primitive of mesh.primitives) if (primitive.indices !== undefined) {
    const accessor = json.accessors[primitive.indices]; if (accessor.bufferView !== undefined) indexViews.add(accessor.bufferView);
  }
  for (const accessor of json.accessors || []) if (accessor.sparse?.indices) indexViews.add(accessor.sparse.indices.bufferView);

  const chunks = [], views = []; let binarySize = 0, fallbackSize = 0;
  const append = data => {
    const offset = align4(binarySize); if (offset > binarySize) chunks.push(Buffer.alloc(offset - binarySize));
    chunks.push(Buffer.from(data)); binarySize = offset + data.length; return offset;
  };
  for (const [viewIndex, originalView] of input.json.bufferViews.entries()) {
    const decodedOriginal = bytesOfView(input, originalView), view = structuredClone(originalView), accessors = accessorsForView.get(viewIndex) || [];
    if (view.extensions?.EXT_meshopt_compression) {
      delete view.extensions.EXT_meshopt_compression;
      if (!Object.keys(view.extensions).length) delete view.extensions;
    }
    let mode = 'ATTRIBUTES', stride = originalView.byteStride;
    const isIndex = indexViews.has(viewIndex) || originalView.target === 34963;
    if (isIndex) {
      const sizes = new Set(accessors.map(a => componentSize[a.componentType]));
      for (const accessor of json.accessors || []) if (accessor.sparse?.indices?.bufferView === viewIndex) sizes.add(componentSize[accessor.sparse.indices.componentType]);
      if (sizes.size !== 1 || ![2, 4].includes([...sizes][0])) throw new Error(`${id} view ${viewIndex}: mixed/unsupported index element sizes`);
      mode = 'INDICES'; stride = [...sizes][0];
    } else if (!stride) {
      const sizes = new Set(accessors.map(a => dim[a.type] * componentSize[a.componentType]));
      const candidate = sizes.size === 1 ? [...sizes][0] : 4;
      stride = candidate && candidate % 4 === 0 && candidate <= 256 && decodedOriginal.length % candidate === 0 ? candidate : 4;
    }
    const compressible = !imageViews.has(viewIndex) && decodedOriginal.length > 0 && decodedOriginal.length % stride === 0 && (mode === 'INDICES' || stride % 4 === 0 && stride <= 256);
    let stored, record;
    if (compressible) {
      const count = decodedOriginal.length / stride;
      stored = MeshoptEncoder.encodeGltfBuffer(decodedOriginal, count, stride, mode);
      const decoded = new Uint8Array(decodedOriginal.length), decodedByThree = new Uint8Array(decodedOriginal.length);
      MeshoptDecoder.decodeGltfBuffer(decoded, count, stride, stored, mode, 'NONE');
      ThreeDecoder.decodeGltfBuffer(decodedByThree, count, stride, stored, mode, 'NONE');
      if (!decodedOriginal.equals(Buffer.from(decoded)) || !decodedOriginal.equals(Buffer.from(decodedByThree))) throw new Error(`${id} view ${viewIndex}: byte round-trip mismatch`);
      const offset = append(stored); fallbackSize = align4(fallbackSize);
      view.buffer = 1; view.byteOffset = fallbackSize;
      view.extensions = {...view.extensions, EXT_meshopt_compression: {buffer: 0, byteOffset: offset, byteLength: stored.length, byteStride: stride, count, mode, filter: 'NONE'}};
      fallbackSize += decodedOriginal.length;
      record = {view: viewIndex, mode, stride, count, before: decodedOriginal.length, after: stored.length, decodedSha256: hash(decodedOriginal), exactBytes: true, threeDecoderExact: true};
    } else {
      stored = decodedOriginal; view.buffer = 0; view.byteOffset = append(stored);
      record = {view: viewIndex, mode: 'unchanged', reason: imageViews.has(viewIndex) ? 'image bytes retained verbatim' : 'view cannot be represented without padding or layout changes', before: stored.length, after: stored.length, decodedSha256: hash(stored), exactBytes: true};
    }
    json.bufferViews[viewIndex] = view; views.push(record);
  }
  json.buffers = [{byteLength: binarySize}, {byteLength: fallbackSize, extensions: {EXT_meshopt_compression: {fallback: true}}}];
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'EXT_meshopt_compression'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), 'EXT_meshopt_compression'])];
  const candidate = writeGlb(json, Buffer.concat(chunks));
  const parsedCandidate = readGlb(candidate);
  // Re-parse the actual packed candidate, not only the encoder return buffers.
  for (let i = 0; i < json.bufferViews.length; i++) if (!bytesOfView(input, input.json.bufferViews[i]).equals(bytesOfView(parsedCandidate, parsedCandidate.json.bufferViews[i]))) throw new Error(`${id} packed view ${i}: decoded-byte mismatch`);
  for (const key of ['meshes', 'accessors', 'nodes', 'scenes', 'scene', 'materials', 'textures', 'samplers', 'skins', 'animations', 'images', 'asset']) if (JSON.stringify(input.json[key]) !== JSON.stringify(parsedCandidate.json[key])) throw new Error(`${id}: semantic JSON changed in ${key}`);
  const outputPath = path.join(outputRoot, id, 'model.glb'); fs.mkdirSync(path.dirname(outputPath), {recursive: true}); fs.writeFileSync(outputPath, candidate);
  const report = {id,sourcePath: inputPath,inputSnapshot,inputSha256,outputPath,outputSha256: hash(candidate),beforeBytes: original.length,afterBytes: candidate.length,savingPercent: +(100 * (1 - candidate.length / original.length)).toFixed(2),byteExactViews: views.length,imagesPreserved: imageViews.size,indicesPreserved: true,semanticJsonUnchanged: true,publicSourceUnchanged: hash(fs.readFileSync(inputPath)) === inputSha256,views};
  if (!report.publicSourceUnchanged) throw new Error(`${id} changed concurrently; candidate must not be promoted`);
  fs.writeFileSync(path.join(path.dirname(outputPath), 'verification.json'), JSON.stringify(report, null, 2)); reports.push(report);
  console.log(`${id}: ${original.length} -> ${candidate.length} bytes (${report.savingPercent}% saved); ${views.length} exact views, ${imageViews.size} unchanged images`);
}
fs.mkdirSync(outputRoot, {recursive: true});
fs.writeFileSync(path.join(outputRoot, 'compression-report.json'), JSON.stringify(reports, null, 2));
