import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import type { AssetAnalysis } from '../types/index';
import { analyzeChipsetTileUsage } from '../core/tileUsage';
import type { ChipsetTileUsage, TileUnitUsage } from '../core/tileUsage';
import type { TileLayer, TileUnit } from '../core/tileLayout';
import { CHIPSET_WIDTH, CHIPSET_HEIGHT, TILE_SIZE } from '../core/tileLayout';
import { fetchRtpBlob } from '../core/rtpCache';

interface Props {
  analysis: AssetAnalysis;
  onClose: () => void;
}

/** 缩放档位（默认 2×） */
const ZOOM_LEVELS = [2, 3, 4, 6, 8];
/** tile ID 列表最多展示多少个，超出则截断 */
const MAX_TILE_IDS_SHOWN = 30;

const pad4 = (id: number) => String(id).padStart(4, '0');
const layerName = (l: TileLayer) => (l === 'lower' ? '图层1' : '图层2');

/** 已使用 / 未使用单元描边色 */
const USED_STROKE = 'rgba(74, 222, 128, 0.9)';
const UNUSED_STROKE = 'rgba(120, 120, 140, 0.55)';

export default function TileUsageModal({ analysis, onClose }: Props) {
  const gameData = useStore(s => s.gameData);
  const asset = analysis.asset;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(2);
  const [hoverUnitId, setHoverUnitId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  // undefined = 计算中，null = 无法计算（无游戏数据）
  const [usage, setUsage] = useState<ChipsetTileUsage | null | undefined>(undefined);

  // 引用了该 ChipSet 的 Chipset.id 集合（取自文件级引用）
  const chipsetIds = useMemo(
    () => new Set(
      analysis.references
        .filter(r => r.location.kind === 'ChipsetRef')
        .map(r => (r.location as { chipsetId: number }).chipsetId),
    ),
    [analysis.references],
  );

  // ── 单元用量：异步计算，先渲染"计算中…"让出首帧 ──────────────────
  useEffect(() => {
    setUsage(undefined);
    if (!gameData) { setUsage(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      let result: ChipsetTileUsage | null = null;
      try {
        result = analyzeChipsetTileUsage(gameData, chipsetIds);
      } catch {
        result = null;
      }
      if (!cancelled) setUsage(result);
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [gameData, chipsetIds]);

  // ── 素材图加载：磁盘 / RTP / .xyz 占位 ───────────────────────────
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setImgEl(null);
    setImgError(null);

    if (asset.ext === '.xyz') {
      setImgError('unsupported');
      return;
    }

    (async () => {
      try {
        let blob: Blob | null = null;
        if (asset.handle !== undefined) {
          blob = await asset.handle.getFile();
        } else if (analysis.inRtp && gameData) {
          blob = await fetchRtpBlob(asset.name, asset.category, gameData.engine);
        }
        if (cancelled) return;
        if (!blob) { setImgError('未找到素材文件'); return; }
        objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          if (!img.width || !img.height) { setImgError('图片尺寸为空'); return; }
          setImgEl(img);
        };
        img.onerror = () => { if (!cancelled) setImgError('图片加载失败'); };
        img.src = objectUrl;
      } catch {
        if (!cancelled) setImgError('素材读取失败');
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ } }
    };
  }, [asset, analysis.inRtp, gameData]);

  const layout = usage?.layout ?? null;
  const canvasW = CHIPSET_WIDTH * zoom;
  const canvasH = CHIPSET_HEIGHT * zoom;

  // ── 底图：按缩放后的分辨率绘制，保证像素锐利 ────────────────────
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = canvasW;
    c.height = canvasH;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    if (imgEl) ctx.drawImage(imgEl, 0, 0, canvasW, canvasH);
  }, [imgEl, canvasW, canvasH]);

  // ── 覆盖层：单元网格 + hover / 选中高亮 ─────────────────────────
  useEffect(() => {
    const ov = overlayRef.current;
    if (!ov) return;
    ov.width = canvasW;
    ov.height = canvasH;
    const octx = ov.getContext('2d');
    if (!octx) return;
    octx.clearRect(0, 0, ov.width, ov.height);
    if (!layout || !usage) return;

    // 逐单元描边：自动图块（3×4）用粗线，E/F 单格用细线
    for (const unit of layout.units) {
      const used = !!usage.unitUsages.get(unit.id)?.used;
      octx.strokeStyle = used ? USED_STROKE : UNUSED_STROKE;
      octx.lineWidth = unit.kind === 'autotile' ? 3 : 1;
      octx.strokeRect(unit.x * zoom, unit.y * zoom, unit.w * zoom, unit.h * zoom);
    }

    const highlight = (unit: TileUnit, fill: string, stroke: string, lw: number) => {
      const x = unit.x * zoom, y = unit.y * zoom, w = unit.w * zoom, h = unit.h * zoom;
      octx.fillStyle = fill;
      octx.fillRect(x, y, w, h);
      octx.strokeStyle = stroke;
      octx.lineWidth = lw;
      octx.strokeRect(x, y, w, h);
    };

    const hoverUnit = hoverUnitId ? layout.unitById.get(hoverUnitId) : undefined;
    if (hoverUnit) highlight(hoverUnit, 'rgba(255,255,255,0.18)', 'rgba(255,255,255,0.9)', 2);
    const selectedUnit = selectedUnitId ? layout.unitById.get(selectedUnitId) : undefined;
    if (selectedUnit) highlight(selectedUnit, 'rgba(74,143,231,0.12)', 'rgba(74,143,231,1)', 2);
  }, [layout, usage, hoverUnitId, selectedUnitId, zoom, canvasW, canvasH]);

  // ── 坐标换算与命中判定 ─────────────────────────────────────────
  function clientToImage(e: React.MouseEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
    return { x: cx / zoom, y: cy / zoom };
  }

  function unitAt(ix: number, iy: number): TileUnit | undefined {
    if (!layout) return undefined;
    return layout.units.find(u => ix >= u.x && ix < u.x + u.w && iy >= u.y && iy < u.y + u.h);
  }

  function handleMove(e: React.MouseEvent) {
    const p = clientToImage(e);
    if (!p) { setHoverUnitId(null); return; }
    const unit = unitAt(p.x, p.y);
    setHoverUnitId(unit ? unit.id : null);
  }

  function handleClick(e: React.MouseEvent) {
    const p = clientToImage(e);
    if (!p) return;
    const unit = unitAt(p.x, p.y);
    if (unit) setSelectedUnitId(unit.id);
  }

  const hoverUnit = hoverUnitId && layout ? layout.unitById.get(hoverUnitId) : undefined;
  const hoverUsed = hoverUnit && usage ? !!usage.unitUsages.get(hoverUnit.id)?.used : false;

  const selectedUnit = selectedUnitId && layout ? layout.unitById.get(selectedUnitId) : undefined;
  const selectedUsage: TileUnitUsage | undefined = selectedUnit && usage
    ? usage.unitUsages.get(selectedUnit.id)
    : undefined;

  const showMedia = imgError !== 'unsupported' && imgError !== '未找到素材文件';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-bg-elev)', borderRadius: 8, padding: 16,
          width: '94vw', maxWidth: 1180, maxHeight: '92vh',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--color-border)', paddingBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>图块引用详情</h3>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{asset.name}</span>
          {usage && (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              · 覆盖 {usage.mapCount} 张地图 · {chipsetIds.size} 个 ChipSet 引用
            </span>
          )}
          <button onClick={onClose} style={{
            marginLeft: 'auto', padding: '2px 8px', fontSize: 14, background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--color-text-muted)',
          }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 14, minHeight: 0, flex: 1 }}>
          {/* 左：画布 + 网格 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--color-text)', minWidth: 150 }}>
                {hoverUnit ? `${hoverUnit.id} · ${hoverUsed ? '已使用' : '未使用'}` : '—'}
              </span>
              <div style={{ flex: 1 }} />
              <span style={{ color: 'var(--color-text-muted)' }}>缩放</span>
              {ZOOM_LEVELS.map(z => (
                <button
                  key={z}
                  onClick={() => setZoom(z)}
                  style={{
                    padding: '2px 8px', fontSize: 12, borderRadius: 4,
                    border: '1px solid ' + (z === zoom ? 'var(--color-primary)' : 'var(--color-border)'),
                    background: z === zoom ? 'var(--color-primary-soft)' : 'var(--color-bg-elev)',
                    color: 'var(--color-text)', cursor: 'pointer',
                  }}
                >{z}×</button>
              ))}
            </div>

            {showMedia ? (
              <div style={{
                position: 'relative',
                backgroundImage: 'linear-gradient(45deg, var(--color-checker-a) 25%, transparent 25%), linear-gradient(-45deg, var(--color-checker-b) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-checker-b) 75%), linear-gradient(-45deg, transparent 75%, var(--color-checker-a) 75%)',
                backgroundSize: '16px 16px', backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                border: '1px solid var(--color-border)',
                overflow: 'auto', maxHeight: '74vh', maxWidth: '64vw',
              }}>
                <div style={{ position: 'relative', width: canvasW, height: canvasH }}>
                  <canvas
                    ref={canvasRef}
                    style={{
                      position: 'absolute', top: 0, left: 0,
                      width: canvasW, height: canvasH,
                      imageRendering: 'pixelated', cursor: 'crosshair',
                    }}
                    onMouseMove={handleMove}
                    onMouseLeave={() => setHoverUnitId(null)}
                    onClick={handleClick}
                  />
                  <canvas
                    ref={overlayRef}
                    style={{
                      position: 'absolute', top: 0, left: 0,
                      width: canvasW, height: canvasH,
                      pointerEvents: 'none', imageRendering: 'pixelated',
                    }}
                  />
                </div>
              </div>
            ) : imgError === 'unsupported' ? (
              <div className="previewUnsupported" style={{ minWidth: 320 }}>
                <div className="previewUnsupportedInner">
                  <div className="previewUnsupportedIcon">🖼️</div>
                  <div className="previewUnsupportedName">{asset.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>暂不支持 .xyz 格式</div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--color-danger)', padding: 12 }}>
                {imgError ?? '素材不可用'}
              </div>
            )}

            <div style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>
              绿色 = 已使用，灰色 = 未使用；粗线框为自动图块（3×4），细线框为 E/F 单格
            </div>
          </div>

          {/* 右：选中单元详情 */}
          <div style={{
            flex: 1, minWidth: 320, maxWidth: 460, overflow: 'auto',
            borderLeft: '1px solid var(--color-border)', paddingLeft: 14, maxHeight: '78vh',
          }}>
            {usage === undefined && (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>计算中…</p>
            )}
            {usage === null && (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>尚无游戏数据，无法计算用量</p>
            )}
            {usage && usage.outOfRangeEventTiles.length > 0 && (
              <div style={{
                fontSize: 12, color: 'var(--color-warning-text)',
                background: 'var(--color-bg-warning)', border: '1px solid var(--color-warning)',
                borderRadius: 4, padding: '6px 8px', marginBottom: 10,
              }}>
                ⚠ 有 {usage.outOfRangeEventTiles.length} 个事件图像无法解析为图块（tile ID 越界，运行时按空图块处理）
              </div>
            )}
            {usage && !selectedUnit && (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>点击左侧图块查看引用详情</p>
            )}
            {selectedUnit && selectedUsage && (
              <>
                <h5 style={{ margin: '0 0 6px', fontSize: 14 }}>{selectedUnit.id}</h5>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10, lineHeight: 1.7 }}>
                  <div>类型：{selectedUnit.kind === 'autotile' ? '自动图块' : '单图块'}</div>
                  <div>可用图层：{selectedUnit.layers.map(layerName).join(' / ')}</div>
                  <div>
                    位置：第 {selectedUnit.x / TILE_SIZE + 1} 列，第 {selectedUnit.y / TILE_SIZE + 1} 行
                    {' · '}
                    {selectedUnit.w / TILE_SIZE}×{selectedUnit.h / TILE_SIZE} 格（{selectedUnit.w}×{selectedUnit.h}px）
                  </div>
                  <div>状态：{selectedUsage.used ? '已使用' : '未使用'}</div>
                </div>

                <h5 style={{ margin: '10px 0 4px', fontSize: 13 }}>地图图层使用</h5>
                {selectedUsage.mapTiles.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--color-text-dim)', margin: 0 }}>无</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {selectedUsage.mapTiles.map((m, i) => (
                      <li key={i} style={{ padding: '2px 0', fontSize: 12, borderBottom: '1px solid var(--color-border-dim)' }}>
                        Map{pad4(m.mapId)} · {layerName(m.layer)} · {m.count} 次
                      </li>
                    ))}
                  </ul>
                )}

                <h5 style={{ margin: '10px 0 4px', fontSize: 13 }}>图块切换命令</h5>
                {selectedUsage.substitutions.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--color-text-dim)', margin: 0 }}>无</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {selectedUsage.substitutions.map((s, i) => (
                      <li key={i} style={{ padding: '2px 0', fontSize: 12, borderBottom: '1px solid var(--color-border-dim)' }}>
                        Map{pad4(s.mapId)} 事件{s.eventId} 第{s.pageId}页 命令第{s.commandIdx + 1}行 · {layerName(s.layer)} · {s.role === 'old' ? '旧图块' : '新图块'} · {s.tileId}
                      </li>
                    ))}
                  </ul>
                )}

                <h5 style={{ margin: '10px 0 4px', fontSize: 13 }}>事件图像</h5>
                {selectedUsage.eventGraphics.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--color-text-dim)', margin: 0 }}>无</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {selectedUsage.eventGraphics.map((g, i) => (
                      <li key={i} style={{ padding: '2px 0', fontSize: 12, borderBottom: '1px solid var(--color-border-dim)' }}>
                        Map{pad4(g.mapId)} 事件{g.eventId} 第{g.pageId}页 · tile ID {g.tileId}（索引 {g.characterIndex}）
                      </li>
                    ))}
                  </ul>
                )}

                <h5 style={{ margin: '10px 0 4px', fontSize: 13 }}>
                  tile ID（{selectedUsage.tileIdCounts.size} 个）
                </h5>
                {selectedUsage.tileIdCounts.size === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--color-text-dim)', margin: 0 }}>无</p>
                ) : (() => {
                  const ids = [...selectedUsage.tileIdCounts.keys()].sort((a, b) => a - b);
                  const shown = ids.slice(0, MAX_TILE_IDS_SHOWN);
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {shown.map(id => (
                        <span key={id} style={{
                          fontSize: 11, padding: '1px 6px', borderRadius: 3,
                          background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)',
                          color: 'var(--color-text)',
                        }}>{id}</span>
                      ))}
                      {ids.length > shown.length && (
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', alignSelf: 'center' }}>
                          …共 {ids.length} 个
                        </span>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}