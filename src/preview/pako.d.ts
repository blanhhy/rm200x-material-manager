declare module 'pako' { export function inflate(data: Uint8Array): Uint8Array; export function deflate(data: Uint8Array, options?: unknown): Uint8Array; }
