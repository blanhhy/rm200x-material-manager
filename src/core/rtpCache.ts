// RTP 素材 blob 的浏览器本地缓存（IndexedDB）。
// 注入时下载的素材（图片或音频）缓存下来，之后离线/再次注入同一素材直接读本地，免重复下载。
// 仅在线版（生产构建）启用：本地 dev 下素材走本机 dev server，fetch 瞬间完成，无缓存必要。

// Vite 注入的开发模式标记（tsx/node 等非 Vite 环境无值，按非 dev 处理）
const IS_DEV = (import.meta as any).env?.DEV === true;

const DB_NAME = 'rmm-rtp-cache';
const STORE_NAME = 'blobs';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function getCachedRtpBlob(key: string): Promise<Blob | null> {
  if (!key || IS_DEV) return null;
  try {
    const db = await openDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function putCachedRtpBlob(key: string, blob: Blob): Promise<void> {
  if (!key || IS_DEV) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 缓存写入失败不影响注入主流程
  }
}
