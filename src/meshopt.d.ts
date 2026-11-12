// three bundles this named runtime export, but @types/three forwards it to an
// optional meshoptimizer package which is not part of this locked installation.
declare module 'three/addons/libs/meshopt_decoder.module.js' {
  export const MeshoptDecoder: {
    supported: boolean;
    ready: Promise<void>;
    useWorkers(count: number): void;
    decodeVertexBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array, filter?: string): void;
    decodeIndexBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array): void;
    decodeIndexSequence(target: Uint8Array, count: number, size: number, source: Uint8Array): void;
    decodeGltfBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array, mode: string, filter?: string): void;
    decodeGltfBufferAsync(count: number, size: number, source: Uint8Array, mode: string, filter?: string): Promise<Uint8Array>;
  };
}
