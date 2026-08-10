import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import type { AssetCategory, AssetFile, AssetAnalysis, EngineVersion } from '../types/index';
import { parsePNGPalette0, replaceColorWithTransparency, swapPalette0WithRGB, parsePNG } from '../preview/pngPalette';
import { getRtpBundleUrl, isRTPAvailable, getActiveRtpKind, getActiveRtpDiskHandle, lookupRTPFileInfo, resolveRtpDirName } from '../core/rtpIndex';
import { CATEGORY_EXTS, IMAGE_CATEGORIES } from '../scanner/assetTypes';
import TransparentColorPicker from './TransparentColorPicker';

const AUDIO_CATS: AssetCategory[] = ['Music', 'Sound'];

function Spinner() {
  return (
    <div className="previewSpinner">
      <div className="previewSpinnerCircle" />
      <div className="previewSpinnerLabel">加载中...</div>
    </div>
  );
}

function PlaceholderCard({ name, hint, hintColor = 'var(--color-warning-text)' }: { name: string; hint: string; hintColor?: string }) {
  return (
    <div className="previewPlaceholder">
      <div className="previewPlaceholderInner">
        <div className="previewPlaceholderName">{name}</div>
        <div className="previewPlaceholderHint" style={{ color: hintColor }}>{hint}</div>
      </div>
    </div>
  );
}

export default function AssetPreview({
  asset, analysis, engine, onSaved,
}: {
  asset: AssetFile | null;
  analysis?: AssetAnalysis | null;
  engine?: EngineVersion;
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
  const activeRtpSourceId = useStore(s => s.activeRtpSourceId);

  // ── Disk audio/video preview ──────────────────────────────────────
  useEffect(() => {
    setMediaUrl(null); setError(null);
    if (!asset || !asset.handle) return;
    if (!AUDIO_CATS.includes(asset.category) && asset.category !== 'Movie') return;

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
      } catch { if (cancelled) return; setError('媒体文件加载失败'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; if (urlToRevoke) { try { URL.revokeObjectURL(urlToRevoke); } catch {} } setMediaUrl(null); setLoading(false); };
  }, [asset]);

  // ── Disk image preview ────────────────────────────────────────────
  useEffect(() => {
    setError(null);
    const canvas = canvasRef.current;
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    if (!asset || !asset.handle || !IMAGE_CATEGORIES.includes(asset.category)) return;
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
          const c = canvasRef.current; if (!c) return;
          c.width = img.width; c.height = img.height;
          const ctx = c.getContext('2d'); if (!ctx) return;
          ctx.clearRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0);
          if (useTransparency && pal0) {
            const imgData = ctx.getImageData(0, 0, c.width, c.height);
            replaceColorWithTransparency(imgData, pal0.r, pal0.g, pal0.b);
            ctx.putImageData(imgData, 0, 0);
          }
          if (!cancelled) setLoading(false);
        };
        img.onerror = () => { if (cancelled) return; const c = canvasRef.current; if (c) { c.width = 0; c.height = 0; } setError('图片加载失败'); setLoading(false); };
        img.src = url;
      } catch {
        if (cancelled) return;
        const c = canvasRef.current; if (c) { c.width = 0; c.height = 0; }
        setError('图片文件读取失败'); setLoading(false);
      }
    })();
    return () => { cancelled = true; for (const u of urls) { try { URL.revokeObjectURL(u); } catch {} } };
  }, [asset, useTransparency, previewRev]);

  // ── RTP image preview ─────────────────────────────────────────────
  useEffect(() => {
    setError(null);
    const canvas = canvasRef.current;
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    if (!asset || asset.handle !== undefined || !IMAGE_CATEGORIES.includes(asset.category) || !analysis?.inRtp || !engine) return;
    if (!isRTPAvailable(asset.name, asset.category, engine)) { setLoading(false); return; }

    const srcKind = getActiveRtpKind();
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        let buf: Uint8Array | null = null;
        if (srcKind === 'builtin') {
          const bundleUrl = getRtpBundleUrl(asset.name, asset.category, engine);
          if (!bundleUrl || cancelled) { setLoading(false); return; }
          const resp = await fetch(bundleUrl);
          if (!resp.ok || cancelled) { setLoading(false); return; }
          buf = new Uint8Array(await resp.arrayBuffer());
        } else if (srcKind === 'disk') {
          const diskHandle = getActiveRtpDiskHandle();
          if (!diskHandle) { setLoading(false); return; }
          const info = lookupRTPFileInfo(asset.name, asset.category, engine);
          if (!info) { setLoading(false); return; }
          const actualDir = resolveRtpDirName(info.rtpDir);
          if (!actualDir) { setLoading(false); return; }
          try {
            const subDir = await diskHandle.getDirectoryHandle(actualDir);
            let fileHandle: FileSystemFileHandle | null = null;
            for (const ext of CATEGORY_EXTS[asset.category]) {
              try { fileHandle = await subDir.getFileHandle(info.fileName + ext); break; } catch {}
            }
            if (!fileHandle || cancelled) { setLoading(false); return; }
            buf = new Uint8Array(await (await fileHandle.getFile()).arrayBuffer());
          } catch { setLoading(false); return; }
        }
        if (cancelled || !buf) { setLoading(false); return; }
        setCurrentPngBytes(buf);

        const pal0 = parsePNGPalette0(buf);
        setPalette0(pal0);

        const url = URL.createObjectURL(new Blob([buf as BlobPart]));
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          const c = canvasRef.current; if (!c) return;
          c.width = img.width; c.height = img.height;
          const ctx = c.getContext('2d'); if (!ctx) return;
          ctx.clearRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0);
          if (useTransparency && pal0) {
            const imgData = ctx.getImageData(0, 0, c.width, c.height);
            replaceColorWithTransparency(imgData, pal0.r, pal0.g, pal0.b);
            ctx.putImageData(imgData, 0, 0);
          }
          if (!cancelled) setLoading(false);
          URL.revokeObjectURL(url);
        };
        img.onerror = () => { if (cancelled) return; setLoading(false); URL.revokeObjectURL(url); };
        img.src = url;
      } catch { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [asset, useTransparency, analysis?.inRtp, engine, previewRev, activeRtpSourceId]);

  // ── RTP audio/video loading ──────────────────────────────────────
  const [rtpMediaUrl, setRtpMediaUrl] = useState<string | null>(null);

  useEffect(() => {
    setRtpMediaUrl(null);
    if (!asset || asset.handle !== undefined) return;
    if (!AUDIO_CATS.includes(asset.category)) return;
    if (!analysis?.inRtp || !engine) return;
    if (!isRTPAvailable(asset.name, asset.category, engine)) return;

    const srcKind = getActiveRtpKind();
    let cancelled = false;
    (async () => {
      try {
        if (srcKind === 'builtin') {
          const bundleUrl = getRtpBundleUrl(asset.name, asset.category, engine);
          if (!bundleUrl || cancelled) return;
          setRtpMediaUrl(bundleUrl);
        } else if (srcKind === 'disk') {
          const info = lookupRTPFileInfo(asset.name, asset.category, engine);
          if (!info) return;
          const diskHandle = getActiveRtpDiskHandle(); if (!diskHandle) return;
          const actualDir = resolveRtpDirName(info.rtpDir); if (!actualDir) return;
          const subDir = await diskHandle.getDirectoryHandle(actualDir);
          let fileHandle: FileSystemFileHandle | null = null;
          for (const ext of CATEGORY_EXTS[asset.category]) {
            try { fileHandle = await subDir.getFileHandle(info.fileName + ext); break; } catch {}
          }
          if (!fileHandle || cancelled) return;
          const file = await fileHandle.getFile();
          if (cancelled) return;
          setRtpMediaUrl(URL.createObjectURL(file));
        }
      } catch { /* file not found or read error */ }
    })();
    return () => { cancelled = true; };
  }, [asset, analysis?.inRtp, engine, activeRtpSourceId]);

  const handleColorConfirm = useCallback(async (targetRGB: { r: number; g: number; b: number }) => {
    if (!asset || !asset.handle || !currentPngBytes) return;
    try {
      const newPng = swapPalette0WithRGB(currentPngBytes, targetRGB.r, targetRGB.g, targetRGB.b);
      let changed = newPng.length !== currentPngBytes.length;
      if (!changed) { for (let i = 0; i < newPng.length; i++) { if (newPng[i] !== currentPngBytes[i]) { changed = true; break; } } }
      if (!changed) { alert('没有可执行的变化（可能选中的颜色不在 palette 里或就是 idx-0）'); return; }

      const writable = await (asset.handle as FileSystemFileHandle).createWritable();
      await writable.write(newPng as unknown as BufferSource);
      await writable.close();
      setColorPickerOpen(false);
      setUseTransparency(true);
      setPreviewRev(r => r + 1);
      onSaved?.();
    } catch (e) { alert('保存失败：' + (e as Error).message); }
  }, [asset, currentPngBytes, onSaved]);

  if (!asset) return <div className="previewNoSelection">选中一个素材查看预览</div>;

  // ── Non-disk assets ───────────────────────────────────────────────
  if (asset.handle === undefined) {
    const isRtpImage = analysis?.inRtp && IMAGE_CATEGORIES.includes(asset.category) && engine;
    const isRtpAudio = analysis?.inRtp && AUDIO_CATS.includes(asset.category);

    if (isRtpImage) {
      if (!isRTPAvailable(asset.name, asset.category, engine))
        return <PlaceholderCard name={asset.name} hint="当前使用的RTP不含此素材" />;
      return (
        <div className="previewSection">
          <div className="previewToolbar">
            <label className="previewTransparentLabel">
              <input type="checkbox" checked={useTransparency} onChange={e => setUseTransparency(e.target.checked)} /> 透明色
            </label>
          </div>
          <div className="previewCanvasWrap">
            {loading && <Spinner />}
            <canvas ref={canvasRef} className="previewCanvas" />
          </div>
          {error && <p className="previewError">{error}</p>}
        </div>
      );
    }

    if (isRtpAudio) {
      const hasFile = engine ? isRTPAvailable(asset.name, asset.category, engine) : false;
      if (!hasFile) return <PlaceholderCard name={asset.name} hint="当前使用的RTP不含此素材" />;
      if (rtpMediaUrl) return (<div className="previewSection"><p className="previewMediaName">{asset.name}</p><audio controls src={rtpMediaUrl} /></div>);
      return <Spinner />;
    }

    return <PlaceholderCard name={asset.name} hint="磁盘上未找到此文件" hintColor="var(--color-danger)" />;
  }

  if (asset.ext === '.xyz') {
    return (
      <div className="previewUnsupported">
        <div className="previewUnsupportedInner">
          <div className="previewUnsupportedIcon">🖼️</div>
          <div className="previewUnsupportedName">{asset.name}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>暂不支持 .xyz 格式</div>
        </div>
      </div>
    );
  }

  if (IMAGE_CATEGORIES.includes(asset.category)) {
    return (
      <div className="previewSection">
        <div className="previewToolbar">
          <label className="previewTransparentLabel">
            <input type="checkbox" checked={useTransparency} onChange={e => setUseTransparency(e.target.checked)} /> 透明色
          </label>
          {isIndexedPNG && (
            <>
              <div className="spacer" />
              <button onClick={() => setColorPickerOpen(true)} className="previewRepickBtn" title="重新选择素材的透明色">重选透明色</button>
            </>
          )}
        </div>
        <div className="previewCanvasWrap">
          {loading && <Spinner />}
          <canvas ref={canvasRef} className="previewCanvas"
            title={asset.width && asset.height ? `${asset.width}×${asset.height}` : undefined} />
        </div>
        {error && <p className="previewError">{error}</p>}
        {colorPickerOpen && currentPngBytes && (
          <TransparentColorPicker pngBytes={currentPngBytes} onClose={() => setColorPickerOpen(false)} onConfirm={handleColorConfirm} />
        )}
      </div>
    );
  }

  if (AUDIO_CATS.includes(asset.category)) {
    return (
      <div className="previewSection">
        <p className="previewMediaName">{asset.name}</p>
        {loading && <Spinner />}
        {!loading && mediaUrl && <audio controls src={mediaUrl} />}
        {!loading && !mediaUrl && !error && <p className="previewMediaLoading">音频加载中...</p>}
        {error && <p className="previewError">{error}</p>}
      </div>
    );
  }

  if (asset.category === 'Movie') {
    return (
      <div className="previewSection">
        <p className="previewMediaName">{asset.name}</p>
        {loading && <Spinner />}
        {!loading && mediaUrl && <video controls src={mediaUrl} className="previewMediaVideo" />}
        {error && <p className="previewError">{error}</p>}
      </div>
    );
  }

  return <div className="previewNoSelection">此类别暂无预览</div>;
}
