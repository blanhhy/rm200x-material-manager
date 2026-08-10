/** 跨操作共享的已删除 Blob 缓冲区，供快照恢复时使用 */
export const pendingBlobBuffer: { current: Map<string, Blob> } = { current: new Map() };
