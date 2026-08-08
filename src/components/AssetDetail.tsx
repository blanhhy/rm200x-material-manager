import { useState } from 'react';
import type { AssetAnalysis } from '../types/index';

function locToString(loc: AssetAnalysis['references'][number]['location']): string {
  switch (loc.kind) {
    case 'System':       return `System.${loc.field}`;
    case 'Actor':        return `Actor[${loc.actorId}].${loc.field}`;
    case 'Terrain':      return `Terrain[${loc.terrainId}].${loc.field}`;
    case 'MapInfo':      return `MapInfo[${loc.mapId}].${loc.field}`;
    case 'MapUnit':      return `Map${String(loc.mapId).padStart(4,'0')}.${loc.field}`;
    case 'Event':        return `Map${String(loc.mapId).padStart(4,'0')} Event${loc.eventId} Page${loc.pageId} → ${loc.field}`;
    case 'MoveRoute':    return `Map${String(loc.mapId).padStart(4,'0')} Event${loc.eventId} Page${loc.pageId} Route Cmd[${loc.commandIdx}] → ${loc.field}`;
    case 'CommonEvent':  return `CommonEvent[${loc.ceId}].${loc.field}`;
    case 'ChipsetRef':   return `Chipset[${loc.chipsetId}].${loc.field}`;
    case 'TroopPage':    return `Troop[${loc.troopId}] Page${loc.pageIdx}.${loc.field}`;
    case 'Unknown':      return loc.note ?? 'Unknown';
    default:             return JSON.stringify(loc);
  }
}

export default function AssetDetail({
  analysis,
  onRename,
  renaming,
  onDelete,
  deleting,
}: {
  analysis: AssetAnalysis | null;
  onRename: (newStem: string) => Promise<void> | void;
  renaming: boolean;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');

  if (!analysis) return <div style={{ padding: 16, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>选中一个素材查看详情</div>;

  const asset = analysis.asset;

  function startRename() {
    setNewName(asset.stem);
    setEditing(true);
  }

  async function submitRename() {
    if (!newName.trim() || newName.trim() === asset.stem) {
      setEditing(false);
      return;
    }
    await onRename(newName.trim());
    setEditing(false);
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        {editing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setEditing(false); }}
              style={{
                flex: 1, padding: '3px 6px', fontSize: 13,
                border: '1px solid var(--color-primary)', borderRadius: 4, outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{asset.ext}</span>
            <button
              onClick={submitRename}
              disabled={renaming}
              style={{
                padding: '3px 8px', fontSize: 12, borderRadius: 4,
                border: '1px solid var(--color-primary)', background: 'var(--color-primary)', color: 'var(--color-text-inverse)',
                cursor: renaming ? 'not-allowed' : 'pointer',
              }}
            >{renaming ? '...' : '确定'}</button>
            <button
              onClick={() => setEditing(false)}
              disabled={renaming}
              style={{
                padding: '3px 8px', fontSize: 12, borderRadius: 4,
                border: '1px solid var(--color-border)', background: 'var(--color-bg-elev)', color: 'var(--color-text)',
                cursor: renaming ? 'not-allowed' : 'pointer',
              }}
            >取消</button>
          </div>
        ) : (
          <>
            <h4 style={{ margin: 0, fontSize: 14, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.name}</h4>
            <button
              onClick={startRename}
              disabled={renaming}
              title="重命名"
              style={{
                padding: '2px 8px', fontSize: 11, borderRadius: 4,
                border: '1px solid var(--color-border)', background: 'var(--color-bg-elev)', color: 'var(--color-text)',
                cursor: renaming ? 'not-allowed' : 'pointer',
              }}
            >✎ 重命名</button>
            {onDelete && (
              <button
                onClick={onDelete}
                disabled={deleting}
                title={analysis.references.length > 0 ? `删除（清除 ${analysis.references.length} 处引用）` : '删除'}
                style={{
                  padding: '2px 8px', fontSize: 11, borderRadius: 4,
                  border: '1px solid var(--color-danger)', background: analysis.references.length > 0 ? 'var(--color-danger-soft)' : 'var(--color-bg-elev)',
                  color: 'var(--color-danger)',
                  cursor: deleting ? 'not-allowed' : 'pointer',
                }}
              >🗑 删除</button>
            )}
          </>
        )}
      </div>
      {!analysis.onDisk && (
        <div style={{ fontSize: 12, color: 'var(--color-danger)', marginBottom: 12 }}>
          {asset.category} · 文件不存在
        </div>
      )}
      {analysis.onDisk && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
          {asset.category} · {(asset.size/1024).toFixed(1)} KB
          {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
          <br />
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{asset.path}</span>
        </div>
      )}
      <h5 style={{ margin: '8px 0 4px', fontSize: 13 }}>
        数据库引用 ({analysis.references.length})
      </h5>
      {analysis.references.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>未在数据库中被引用</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {analysis.references.map((ref, i) => (
            <li key={i} style={{ padding: '3px 0', fontSize: 12, borderBottom: '1px solid var(--color-border-dim)' }}>
              <span style={{ color: 'var(--color-success-text)' }}>{ref.category}</span>
              <span style={{ color: 'var(--color-text-muted)', margin: '0 6px' }}>·</span>
              {locToString(ref.location)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
