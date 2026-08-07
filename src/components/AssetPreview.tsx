import { useEffect, useRef, useState, useCallback } from 'react';
import type { AssetCategory, AssetFile } from '../types/index';
import { parsePNGPalette0, replaceColorWithTransparency, swapPalette0WithRGB, parsePNG } from '../preview/pngPalette';
import TransparentColorPicker from './TransparentColorPicker';

const IMAGE_CATS: AssetCategory[] = [
  'ChipSet','CharSet','FaceSet',
  'Backdrop','Battle','Battle2','BattleCharSet','BattleWeapon','Monster',
  'Panorama','Picture',
  'System','System2','Title','GameOver','Frame',
];
const AUDIO_CATS: AssetCategory[] = ['Music','Sound'];
const VIDEO_CATS: AssetCategory[] = ['Movie'];

const SPINNER = (
  <div style={{ textAlign: 'center', padding: 24, color: 'var(--color-text-muted)' }}>
    <div style={{
      width: 28, height: 28, border: '2px solid var(--color-border)',
      borderTopColor: 'var(--color-primary)', borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
      margin: '0 auto 10px',
    }} />
    <div style={{ fontSize: 12 }}>加载中...</div>
  </div>
);

export default function AssetPreview({
  asset,
  onSaved,
}: {
  asset: AssetFile | null;
  onSaved?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [useTransparency, setUseTransparency] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [isIndexedPNG, setIsIndexedPNG] = useState(false);
  const [currentPngBytes, setCurrentPngBytes] = useState<Uint8Array | null>(null);
  const [_, setPalette0] = useState<{ r: number; g: number; b: number } | null>(null);
  const [previewRev, setPreviewRev] = useState(0);

  useEffect(() => {
    setMediaUrl(null);
    setError(null);
    if (!asset || !asset.handle) return;

    if (!AUDIO_CATS.includes(asset.category) && !VIDEO_CATS.includes(asset.category)) return;

    let cancelled = false;
    let urlToRevoke: string | null = null;
    setLoading(true);
    (async () => {
      try {
        const file = await asset.handle!.getFile();
        if (cancelled) return;
        const url = URL.createObjectURL(file);
        urlToRevoke = url;
        if (cancelled) { URL.revokeObjectURL(url); return; }
        setMediaUrl(url);
      } catch {
        if (cancelled) return;
        setError('媒体文件加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (urlToRevoke) { try { URL.revokeObjectURL(urlToRevoke); } catch {} }
      setMediaUrl(null);
      setLoading(false);
    };
  }, [asset]);

  useEffect(() => {
    setError(null);
    const canvas = canvasRef.current;
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    if (!asset || !asset.handle || !IMAGE_CATS.includes(asset.category)) return;
    let cancelled = false;
    const urls: string[] = [];
    setLoading(true);

    (async () => {
      try {
        const file = await asset.handle!.getFile();
        const buf = new Uint8Array(await file.arrayBuffer());
        if (cancelled) return;
        setCurrentPngBytes(buf);

        const { ok, ihdr } = parsePNG(buf);
        setIsIndexedPNG(ok && ihdr?.colorType === 3);

        const pal0 = parsePNGPalette0(buf);
        setPalette0(pal0);

        const url = URL.createObjectURL(file);
        urls.push(url);
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          const c = canvasRef.current;
          if (!c) return;
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d');
          if (!ctx) return;
          ctx.clearRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0);
          if (useTransparency && pal0) {
            const imgData = ctx.getImageData(0, 0, c.width, c.height);
            replaceColorWithTransparency(imgData, pal0.r, pal0.g, pal0.b);
            ctx.putImageData(imgData, 0, 0);
          }
          if (!cancelled) setLoading(false);
        };
        img.onerror = () => {
          if (cancelled) return;
          const c = canvasRef.current;
          if (c) { c.width = 0; c.height = 0; }
          setError('图片加载失败');
          setLoading(false);
        };
        img.src = url;
      } catch {
        if (cancelled) return;
        const c = canvasRef.current;
        if (c) { c.width = 0; c.height = 0; }
        setError('图片文件读取失败');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      for (const u of urls) {
        try { URL.revokeObjectURL(u); } catch {}
      }
    };
  }, [asset, useTransparency, previewRev]);

  const handleColorConfirm = useCallback(async (targetRGB: { r: number; g: number; b: number }) => {
    if (!asset || !asset.handle || !currentPngBytes) return;

    try {
      const newPng = swapPalette0WithRGB(currentPngBytes, targetRGB.r, targetRGB.g, targetRGB.b);

      // 检测是否有变化
      let changed = newPng.length !== currentPngBytes.length;
      if (!changed) {
        for (let i = 0; i < newPng.length; i++) {
          if (newPng[i] !== currentPngBytes[i]) { changed = true; break; }
        }
      }

      if (!changed) {
        alert('没有可执行的变化（可能选中的颜色不在 palette 里或就是 idx-0）');
        return;
      }

      const writable = await (asset.handle as FileSystemFileHandle).createWritable();
      await writable.write(newPng as unknown as BufferSource);
      await writable.close();

      setColorPickerOpen(false);
      setUseTransparency(true);
      setPreviewRev(r => r + 1);
      onSaved?.();
    } catch (e) {
      alert('保存失败：' + (e as Error).message);
    }
  }, [asset, currentPngBytes, onSaved]);

  if (!asset) {
    return <div style={{ padding: 16, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>选中一个素材查看预览</div>;
  }

  if (asset.ext === '.xyz') {
    return (
      <div style={{ padding: 12 }}>
        <div style={{ background: 'var(--color-bg-subtle)', border: '1px dashed var(--color-border-strong)', borderRadius: 6, padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🖼️</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>{asset.name}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>暂不支持 .xyz 格式</div>
        </div>
      </div>
    );
  }

  if (IMAGE_CATS.includes(asset.category)) {
    return (
      <div style={{ padding: 12 }}>
        <div style={{ marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={useTransparency} onChange={e => setUseTransparency(e.target.checked)} />
            透明色
          </label>

          {isIndexedPNG && (
            <>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setColorPickerOpen(true)}
                style={{
                  padding: '3px 10px', fontSize: 11, borderRadius: 3,
                  border: '1px solid var(--color-border)', background: 'var(--color-bg-elev)', color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
                title="重新选择素材的透明色"
              >重选透明色</button>
            </>
          )}
        </div>
        <div style={{
          position: 'relative',
          backgroundImage: 'linear-gradient(45deg, var(--color-checker-a) 25%, transparent 25%), linear-gradient(-45deg, var(--color-checker-b) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-checker-b) 75%), linear-gradient(-45deg, transparent 75%, var(--color-checker-a) 75%)',
          backgroundSize: '16px 16px', backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          border: '1px solid var(--color-border)', display: 'inline-block', minWidth: 80, minHeight: 40,
          maxHeight: 360, overflow: 'hidden',
        }}>
          {loading && SPINNER}
          <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%', maxHeight: 340, height: 'auto' }} />
        </div>
        {error && <p style={{ color: 'red', fontSize: 12 }}>{error}</p>}

        {colorPickerOpen && currentPngBytes && (
          <TransparentColorPicker
            pngBytes={currentPngBytes}
            onClose={() => setColorPickerOpen(false)}
            onConfirm={handleColorConfirm}
          />
        )}
      </div>
    );
  }

  if (AUDIO_CATS.includes(asset.category)) {
    return (
      <div style={{ padding: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--color-text)' }}>{asset.name}</p>
        {loading && SPINNER}
        {!loading && mediaUrl && <audio controls src={mediaUrl} />}
        {!loading && !mediaUrl && !error && <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>音频加载中...</p>}
        {error && <p style={{ color: 'red', fontSize: 12 }}>{error}</p>}
      </div>
    );
  }

  if (VIDEO_CATS.includes(asset.category)) {
    return (
      <div style={{ padding: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--color-text)' }}>{asset.name}</p>
        {loading && SPINNER}
        {!loading && mediaUrl && <video controls src={mediaUrl} style={{ maxWidth: '100%' }} />}
        {error && <p style={{ color: 'red', fontSize: 12 }}>{error}</p>}
      </div>
    );
  }

  return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>此类别暂无预览</div>;
}
