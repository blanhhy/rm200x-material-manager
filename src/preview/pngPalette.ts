import pako from 'pako';

export interface Palette0Result { r: number; g: number; b: number }

export interface IHDR {
  width: number; height: number;
  bitDepth: number; colorType: number;
  compression: number; filter: number; interlace: number;
}

export interface PNGChunk { type: string; data: Uint8Array; crc: number }

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32(buf: Uint8Array, off: number): number {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

export function parsePNG(buf: Uint8Array): { chunks: PNGChunk[]; ihdr: IHDR | null; ok: boolean } {
  if (buf.length < 24) return { chunks: [], ihdr: null, ok: false };
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) return { chunks: [], ihdr: null, ok: false };

  const chunks: PNGChunk[] = [];
  let off = 8;
  let ihdr: IHDR | null = null;

  while (off + 8 <= buf.length) {
    const len = u32(buf, off);
    off += 4;

    if (off + 4 > buf.length) return { chunks, ihdr, ok: true };
    const type = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
    off += 4;

    if (len > buf.length - off - 4) return { chunks, ihdr, ok: true };

    const data = new Uint8Array(buf.buffer, buf.byteOffset + off, len);
    off += len;

    if (off + 4 > buf.length) return { chunks, ihdr, ok: true };
    const crc = u32(buf, off);
    off += 4;

    chunks.push({ type, data, crc });

    if (type === 'IHDR' && data.length >= 13) {
      ihdr = {
        width: u32(data, 0),
        height: u32(data, 4),
        bitDepth: data[8], colorType: data[9],
        compression: data[10], filter: data[11], interlace: data[12],
      };
    }
    if (type === 'IEND') break;
  }

  return { chunks, ihdr, ok: true };
}

export function buildPNG(chunks: PNGChunk[]): Uint8Array {
  let total = 8;
  for (const ch of chunks) total += 12 + ch.data.length;
  const out = new Uint8Array(total);
  out.set(SIG, 0);
  let off = 8;
  for (const ch of chunks) {
    out[off] = (ch.data.length >>> 24) & 0xff;
    out[off + 1] = (ch.data.length >>> 16) & 0xff;
    out[off + 2] = (ch.data.length >>> 8) & 0xff;
    out[off + 3] = ch.data.length & 0xff;
    off += 4;
    const typeBytes = new TextEncoder().encode(ch.type);
    out.set(typeBytes, off); off += 4;
    out.set(ch.data, off); off += ch.data.length;
    const typeAndData = new Uint8Array(4 + ch.data.length);
    typeAndData.set(typeBytes, 0);
    typeAndData.set(ch.data, 4);
    const crc = crc32(typeAndData);
    out[off] = (crc >>> 24) & 0xff;
    out[off + 1] = (crc >>> 16) & 0xff;
    out[off + 2] = (crc >>> 8) & 0xff;
    out[off + 3] = crc & 0xff;
    off += 4;
  }
  return out;
}

export function parsePNGPalette0(buffer: Uint8Array | ArrayBuffer): Palette0Result | null {
  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const { chunks, ihdr, ok } = parsePNG(buf);
  if (!ok || !ihdr || ihdr.colorType !== 3) return null;

  const plte = chunks.find(c => c.type === 'PLTE');
  if (!plte || plte.data.length < 3) return null;

  return { r: plte.data[0], g: plte.data[1], b: plte.data[2] };
}

export function getPalette(buf: Uint8Array): { palette: Uint8Array; trns: Uint8Array | null } | null {
  const { chunks, ok } = parsePNG(buf);
  if (!ok) return null;
  const plte = chunks.find(c => c.type === 'PLTE');
  if (!plte) return null;
  const trns = chunks.find(c => c.type === 'tRNS')?.data ?? null;
  return { palette: plte.data, trns };
}

export function replaceColorWithTransparency(
  imageData: ImageData,
  targetR: number, targetG: number, targetB: number,
  tolerance: number = 0
): void {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - targetR) <= tolerance &&
        Math.abs(data[i+1] - targetG) <= tolerance &&
        Math.abs(data[i+2] - targetB) <= tolerance) {
      data[i+3] = 0;
    }
  }
}

// ===== PNG pixel decode/encode (for indexed color, filter 0) =====

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterRow(row: Uint8Array, prev: Uint8Array | null, filterType: number, bpp: number): Uint8Array {
  const out = new Uint8Array(row.length);
  for (let x = 0; x < row.length; x++) {
    const cur = row[x];
    let left = 0, up = 0, upLeft = 0;
    if (x >= 0 && x < bpp) left = 0; else if (x >= bpp) left = out[x - bpp];
    if (prev) up = prev[x];
    if (prev && x >= bpp) upLeft = prev[x - bpp];

    switch (filterType) {
      case 0: out[x] = cur; break;
      case 1: out[x] = (cur + left) & 0xff; break;
      case 2: out[x] = (cur + up) & 0xff; break;
      case 3: out[x] = (cur + ((left + up) >>> 1)) & 0xff; break;
      case 4: out[x] = (cur + paeth(left, up, upLeft)) & 0xff; break;
      default: out[x] = cur;
    }
  }
  return out;
}

function filterRow(row: Uint8Array, prev: Uint8Array | null, filterType: number, bpp: number): Uint8Array {
  const n = row.length;
  const out = new Uint8Array(n + 1);
  out[0] = filterType;
  for (let x = 0; x < n; x++) {
    const cur = row[x];
    let left = 0, up = 0, upLeft = 0;
    if (x >= bpp) left = row[x - bpp];
    if (prev) up = prev[x];
    if (prev && x >= bpp) upLeft = prev[x - bpp];

    let v = cur;
    switch (filterType) {
      case 0: break;
      case 1: v = (cur - left) & 0xff; break;
      case 2: v = (cur - up) & 0xff; break;
      case 3: v = (cur - ((left + up) >>> 1)) & 0xff; break;
      case 4: v = (cur - paeth(left, up, upLeft)) & 0xff; break;
    }
    out[x + 1] = v;
  }
  return out;
}

export function decodeIndexedPixels(buf: Uint8Array): { pixels: Uint8Array; ihdr: IHDR } | null {
  const { chunks, ihdr, ok } = parsePNG(buf);
  if (!ok || !ihdr || ihdr.colorType !== 3) return null;

  if (ihdr.width <= 0 || ihdr.height <= 0 || ihdr.width > 0x10000 || ihdr.height > 0x10000) return null;

  const idatData: Uint8Array[] = [];
  let total = 0;
  for (const c of chunks) {
    if (c.type === 'IDAT') {
      total += c.data.length;
      idatData.push(c.data);
    }
  }
  if (idatData.length === 0 || total <= 0) return null;

  if (total > 128 * 1024 * 1024) return null;

  const merged = new Uint8Array(total);
  let off = 0;
  for (const d of idatData) { merged.set(d, off); off += d.length; }

  let inflated: Uint8Array;
  try { inflated = pako.inflate(merged); } catch { return null; }

  const bpp = 1;
  const bpl = ihdr.width * bpp;
  const expectedRaw = ihdr.height * (bpl + 1);
  if (inflated.length !== expectedRaw) return null;

  const pixels = new Uint8Array(ihdr.width * ihdr.height);
  let prevRow: Uint8Array | null = null;
  let io = 0;

  for (let y = 0; y < ihdr.height; y++) {
    const filterType = inflated[io++];
    const row = inflated.slice(io, io + bpl); io += bpl;
    const decoded = unfilterRow(row, prevRow, filterType, bpp);
    pixels.set(decoded, y * bpl);
    prevRow = decoded;
  }

  return { pixels, ihdr };
}

export function encodeIndexedPixelsToIDAT(pixels: Uint8Array, ihdr: IHDR): Uint8Array {
  if (ihdr.width <= 0 || ihdr.height <= 0) return new Uint8Array();
  if (ihdr.width > 0x10000 || ihdr.height > 0x10000) return new Uint8Array();

  const bpp = 1;
  const bpl = ihdr.width * bpp;
  const expectedPixels = ihdr.width * ihdr.height;
  if (pixels.length !== expectedPixels) return new Uint8Array();

  const totalRaw = ihdr.height * (bpl + 1);
  if (totalRaw <= 0 || totalRaw > 256 * 1024 * 1024) return new Uint8Array();

  const raw = new Uint8Array(totalRaw);
  let prevRow: Uint8Array | null = null;
  let outOff = 0;

  for (let y = 0; y < ihdr.height; y++) {
    const row = pixels.slice(y * bpl, y * bpl + bpl);
    const filtered = filterRow(row, prevRow, 0, bpp);
    raw.set(filtered, outOff);
    outOff += filtered.length;
    prevRow = row;
  }

  return pako.deflate(raw);
}

// ===== Public operations =====

export function setPalette0Color(buf: Uint8Array, r: number, g: number, b: number): Uint8Array {
  try {
    const { chunks, ok } = parsePNG(buf);
    if (!ok) return buf;
    const plte = chunks.find(c => c.type === 'PLTE');
    if (!plte || plte.data.length < 3) return buf;

    const newPlteData = new Uint8Array(plte.data);
    newPlteData[0] = r; newPlteData[1] = g; newPlteData[2] = b;
    plte.data = newPlteData;

    const trns = chunks.find(c => c.type === 'tRNS');
    if (trns && trns.data.length > 0) {
      const newTrns = new Uint8Array(trns.data);
      newTrns[0] = 255;
      trns.data = newTrns;
    }

    return buildPNG(chunks);
  } catch {
    return buf;
  }
}

export function swapPalette0WithRGB(buf: Uint8Array, targetR: number, targetG: number, targetB: number): Uint8Array {
  try {
    const parse = parsePNG(buf);
    const { chunks, ihdr, ok } = parse;
    if (!ok || !ihdr || ihdr.colorType !== 3) return buf;

    const plte = chunks.find(c => c.type === 'PLTE');
    if (!plte || plte.data.length < 6) return buf;

    let targetIdx = -1;
    for (let i = 0; i + 2 < plte.data.length; i += 3) {
      if (plte.data[i] === targetR && plte.data[i + 1] === targetG && plte.data[i + 2] === targetB) {
        targetIdx = Math.floor(i / 3);
        break;
      }
    }
    if (targetIdx === -1) return buf;
    if (targetIdx === 0) return buf;

    const newPlte = new Uint8Array(plte.data);
    const t0 = newPlte[0], t1 = newPlte[1], t2 = newPlte[2];
    const idx3 = targetIdx * 3;
    if (idx3 + 2 >= newPlte.length) return buf;
    newPlte[0] = newPlte[idx3];
    newPlte[1] = newPlte[idx3 + 1];
    newPlte[2] = newPlte[idx3 + 2];
    newPlte[idx3] = t0;
    newPlte[idx3 + 1] = t1;
    newPlte[idx3 + 2] = t2;
    plte.data = newPlte;

    const trns = chunks.find(c => c.type === 'tRNS');
    if (trns && trns.data.length > targetIdx) {
      const newTrns = new Uint8Array(trns.data);
      const tmp = newTrns[0];
      newTrns[0] = newTrns[targetIdx];
      newTrns[targetIdx] = tmp;
      trns.data = newTrns;
    }

    const decoded = decodeIndexedPixels(buf);
    if (decoded && decoded.pixels.length === ihdr.width * ihdr.height) {
      const { pixels } = decoded;
      for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] === 0) { pixels[i] = targetIdx; }
        else if (pixels[i] === targetIdx) { pixels[i] = 0; }
      }

      const newIdat = encodeIndexedPixelsToIDAT(pixels, ihdr);
      if (newIdat.length === 0) return buildPNG(chunks);

      const newChunks: PNGChunk[] = [];
      let replaced = false;
      for (const c of chunks) {
        if (c.type === 'IDAT') {
          if (!replaced) {
            newChunks.push({ type: 'IDAT', data: newIdat, crc: 0 });
            replaced = true;
          }
        } else {
          newChunks.push(c);
        }
      }
      if (!replaced) newChunks.push({ type: 'IDAT', data: newIdat, crc: 0 });
      return buildPNG(newChunks);
    }

    return buildPNG(chunks);
  } catch {
    return buf;
  }
}
