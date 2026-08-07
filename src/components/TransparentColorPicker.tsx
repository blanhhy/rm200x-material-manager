import { useEffect, useRef, useState, useCallback } from 'react';
import { getPalette } from '../preview/pngPalette';

interface Props {
  pngBytes: Uint8Array;
  onClose: () => void;
  onConfirm: (targetRGB: { r: number; g: number; b: number }) => void;
}

export default function TransparentColorPicker({ pngBytes, onClose, onConfirm }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [hoverPx, setHoverPx] = useState<{ x: number; y: number; idx: number; r: number; g: number; b: number } | null>(null);
  const [selected, setSelected] = useState<{ idx: number; r: number; g: number; b: number } | null>(null);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });

  const paletteRef = useRef<{ palette: Uint8Array; trns: Uint8Array | null } | null>(null);
  const canvasDataRef = useRef<ImageData | null>(null);

  const getCurPalette0 = () => {
    const pal = paletteRef.current?.palette;
    if (!pal || pal.length < 3) return null;
    return { r: pal[0], g: pal[1], b: pal[2] };
  };

  useEffect(() => {
    const onResize = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;

    const paletteInfo = getPalette(pngBytes);
    paletteRef.current = paletteInfo;

    try {
      blobUrl = URL.createObjectURL(new Blob([new Uint8Array(pngBytes)], { type: 'image/png' }));
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        if (!img.width || !img.height) return;

        setImgSize({ w: img.width, h: img.height });

        const c = canvasRef.current;
        if (c) {
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0);
            try {
              canvasDataRef.current = ctx.getImageData(0, 0, img.width, img.height);
            } catch {
              canvasDataRef.current = null;
            }
          }
        }
        const ov = overlayRef.current;
        if (ov) {
          ov.width = img.width;
          ov.height = img.height;
        }
      };
      img.src = blobUrl;
    } catch {
      // Blob creation failed
    }

    return () => {
      cancelled = true;
      if (blobUrl) {
        try { URL.revokeObjectURL(blobUrl); } catch {}
      }
    };
  }, [pngBytes]);

  useEffect(() => {
    if (!imgSize.w || !imgSize.h) return;
    const overlay = overlayRef.current;
    if (!overlay || overlay.width === 0 || overlay.height === 0) return;
    const octx = overlay.getContext('2d');
    if (!octx) return;

    const canvasData = canvasDataRef.current;
    if (!canvasData) return;

    let target: { r: number; g: number; b: number } | null = selected;
    if (!target) {
      const pal = paletteRef.current?.palette;
      if (!pal || pal.length < 3) return;
      target = { r: pal[0], g: pal[1], b: pal[2] };
    }
    const tgt = target;

    let showTransparent = true;
    let last = performance.now();

    const paintDimmed = () => {
      const w = overlay.width, h = overlay.height;
      const out = octx.createImageData(w, h);
      const src = canvasData.data;
      const tgtR = tgt.r, tgtG = tgt.g, tgtB = tgt.b;
      const tgtLum = 0.299 * tgtR + 0.587 * tgtG + 0.114 * tgtB;
      const blendFactor = 0.15;
      const toR = tgtLum < 128 ? 255 : 0;
      const toG = toR;
      const toB = toR;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const si = (y * w + x) * 4;
          if (src[si] === tgtR && src[si + 1] === tgtG && src[si + 2] === tgtB) {
            out.data[si]     = Math.round(src[si]     + (toR - src[si])     * blendFactor);
            out.data[si + 1] = Math.round(src[si + 1] + (toG - src[si + 1]) * blendFactor);
            out.data[si + 2] = Math.round(src[si + 2] + (toB - src[si + 2]) * blendFactor);
            out.data[si + 3] = 255;
          }
        }
      }
      octx.putImageData(out, 0, 0);
    };

    const tick = (now: number) => {
      if (cancelled) return;
      if (now - last > 500) {
        last = now;
        showTransparent = !showTransparent;
        if (showTransparent) {
          paintDimmed();
        } else {
          octx.clearRect(0, 0, overlay.width, overlay.height);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    let cancelled = false;
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [selected, imgSize]);

  function clientToPixel(e: React.MouseEvent): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: -1, y: -1 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);
    return { x, y };
  }

  const findPaletteIdx = useCallback((r: number, g: number, b: number): number => {
    const pal = paletteRef.current?.palette;
    if (!pal) return -1;
    for (let i = 0; i + 2 < pal.length; i += 3) {
      if (pal[i] === r && pal[i + 1] === g && pal[i + 2] === b) {
        return Math.floor(i / 3);
      }
    }
    return -1;
  }, []);

  const getPixelInfo = useCallback((px: number, py: number) => {
    const data = canvasDataRef.current;
    if (!data) return null;
    if (px < 0 || py < 0 || px >= imgSize.w || py >= imgSize.h) return null;
    const idx = (py * imgSize.w + px) * 4;
    const r = data.data[idx];
    const g = data.data[idx + 1];
    const b = data.data[idx + 2];
    const paletteIdx = findPaletteIdx(r, g, b);
    return { idx: paletteIdx, r, g, b };
  }, [imgSize, findPaletteIdx]);

  function handleMove(e: React.MouseEvent) {
    const { x, y } = clientToPixel(e);
    if (x < 0 || y < 0 || x >= imgSize.w || y >= imgSize.h) { setHoverPx(null); return; }
    const info = getPixelInfo(x, y);
    if (info) setHoverPx({ x, y, ...info });
  }

  function handleClick(e: React.MouseEvent) {
    const { x, y } = clientToPixel(e);
    if (x < 0 || y < 0 || x >= imgSize.w || y >= imgSize.h) return;
    const info = getPixelInfo(x, y);
    if (info && info.idx >= 0) {
      setSelected({ idx: info.idx, r: info.r, g: info.g, b: info.b });
    }
  }

  const MIN_ZOOM = 2;
  const MAX_ZOOM = 8;
  const RM_SCREEN_W = 320;
  const RM_SCREEN_H = 240;

  let zoom = MIN_ZOOM;
  if (imgSize.w && imgSize.h && viewportSize.w && viewportSize.h) {
    const availW = Math.max(Math.floor(viewportSize.w * 0.92) - 40, RM_SCREEN_W);
    const availH = Math.max(Math.floor(viewportSize.h * 0.90) - 130, RM_SCREEN_H);
    const zFromW = Math.floor(availW / imgSize.w);
    const zFromH = Math.floor(availH / imgSize.h);
    zoom = Math.max(MIN_ZOOM, Math.min(Math.min(zFromW, zFromH), MAX_ZOOM));
  }

  const displayW = imgSize.w * zoom;
  const displayH = imgSize.h * zoom;
  const curPalette0 = getCurPalette0();
  const targetColor = selected ? { r: selected.r, g: selected.g, b: selected.b } : curPalette0;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--color-bg-elev)', borderRadius: 8, padding: 16,
        maxWidth: '92vw', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', gap: 12,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--color-border)', paddingBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>重选透明色</h3>
          <button onClick={onClose} style={{
            marginLeft: 'auto', padding: '2px 8px', fontSize: 14, background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--color-text-muted)',
          }}>✕</button>
        </div>

        <div style={{
          position: 'relative',
          backgroundImage: 'linear-gradient(45deg, var(--color-checker-a) 25%, transparent 25%), linear-gradient(-45deg, var(--color-checker-b) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-checker-b) 75%), linear-gradient(-45deg, transparent 75%, var(--color-checker-a) 75%)',
          backgroundSize: '16px 16px', backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          border: '1px solid var(--color-border)',
          alignSelf: 'center',
          flexShrink: 1,
          maxWidth: '100%',
          maxHeight: '70vh',
          overflow: 'auto',
        }}>
          <div style={{ position: 'relative', width: displayW || 100, height: displayH || 100 }}>
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute', top: 0, left: 0,
                width: displayW, height: displayH,
                imageRendering: 'pixelated', cursor: 'crosshair',
              }}
              onMouseMove={handleMove}
              onMouseLeave={() => setHoverPx(null)}
              onClick={handleClick}
            />
            <canvas
              ref={overlayRef}
              style={{
                position: 'absolute', top: 0, left: 0,
                width: displayW, height: displayH, pointerEvents: 'none',
                imageRendering: 'pixelated',
              }}
            />
            <div style={{
              position: 'absolute',
              left: Math.max(0, Math.min((hoverPx?.x ?? 0) * zoom - 3, displayW - (zoom + 6))),
              top: Math.max(0, Math.min((hoverPx?.y ?? 0) * zoom - 3, displayH - (zoom + 6))),
              width: zoom + 6, height: zoom + 6,
              border: '1px solid var(--color-pixel-red)', pointerEvents: 'none',
              boxSizing: 'border-box',
              opacity: hoverPx && zoom >= 2 ? 1 : 0,
            }} />
            <div style={{
              position: 'absolute',
              left: Math.max(0, Math.min((hoverPx?.x ?? 0) * zoom - 2, displayW - (zoom + 4))),
              top: Math.max(0, Math.min((hoverPx?.y ?? 0) * zoom - 2, displayH - (zoom + 4))),
              width: zoom + 4, height: zoom + 4,
              border: '2px solid var(--color-primary)', pointerEvents: 'none',
              boxSizing: 'border-box',
              opacity: selected && hoverPx ? 1 : 0,
            }} />
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
          fontSize: 12, paddingTop: 4,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            minWidth: 130,
          }}>
            <div style={{
              width: 22, height: 22, border: '1px solid var(--color-border)', borderRadius: 3,
              background: hoverPx ? `rgb(${hoverPx.r},${hoverPx.g},${hoverPx.b})` : 'transparent',
              flexShrink: 0,
            }} />
            <span style={{ color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
              {hoverPx ? `(${hoverPx.x}, ${hoverPx.y})` : '—'}
            </span>
          </div>

          <div style={{ flex: 1 }} />

          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 10px', background: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)', borderRadius: 6,
          }}>
            <div style={{
              width: 22, height: 22, border: '1px solid var(--color-border)', borderRadius: 3,
              background: curPalette0 ? `rgb(${curPalette0.r},${curPalette0.g},${curPalette0.b})` : 'transparent',
            }} />
            <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>→</span>
            <div style={{
              width: 22, height: 22, border: '1px solid var(--color-border)', borderRadius: 3,
              background: targetColor ? `rgb(${targetColor.r},${targetColor.g},${targetColor.b})` : 'transparent',
              boxShadow: selected ? '0 0 0 2px rgba(59,130,246,0.4)' : 'none',
            }} />
            <button
              onClick={() => {
                if (selected && selected.idx > 0) onConfirm({ r: selected.r, g: selected.g, b: selected.b });
                onClose();
              }}
              style={{
                marginLeft: 4,
                padding: '4px 14px', borderRadius: 4, border: 'none',
                background: 'var(--color-primary)',
                color: 'var(--color-text-inverse)', cursor: 'pointer',
                fontSize: 13, fontWeight: 500,
              }}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
