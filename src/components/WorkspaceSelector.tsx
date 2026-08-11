import { useState } from 'react';
import { useStore } from '../store/useStore';
import { useClickOutside } from '../hooks/useClickOutside';

interface Props {
  onOpen: () => void;
  onClose: () => void;
  assetCount: number;
  mapCount: number;
  onEncodingChange: (enc: string) => void;
}

export default function WorkspaceSelector({ onOpen, onClose, assetCount, mapCount, onEncodingChange }: Props) {
  const { gameData, loading, error } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useClickOutside(() => setMenuOpen(false));

  const { projectName, iniStatus } = (() => {
    const ini = gameData?.rpgIni;
    if (!ini) return { projectName: '', iniStatus: 'missing' as const };
    const t1 = ini['RPG_RT']?.GameTitle?.trim();
    if (t1) return { projectName: t1, iniStatus: 'ok' as const };
    const t2 = ini['Game']?.GameTitle?.trim();
    if (t2) return { projectName: t2, iniStatus: 'ok' as const };
    return { projectName: '', iniStatus: 'no-title' as const };
  })();

  const dirName = gameData?.rootHandle?.name || '';

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button onClick={() => setMenuOpen(!menuOpen)} className="wsTrigger" data-open={!!gameData || undefined}>
        <span className="wsTriggerIcon">📁</span>
        <span className="wsTriggerText">{gameData ? (dirName || '未命名项目') : '打开项目'}</span>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>▾</span>
      </button>

      {menuOpen && (
        <div className="popupMenu wsMenu">
          {error && <div className="errorBanner">{error}</div>}
          {loading ? (
            <div style={{ padding: 12, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>加载中...</div>
          ) : gameData ? (
            <>
              <div className="wsProjectHeader">
                {projectName ? (
                  <>
                    <div className="wsProjectTitle">{projectName}</div>
                    <div className="wsProjectDir">{dirName}</div>
                  </>
                ) : (
                  <>
                    <div className="wsProjectTitle">{dirName}</div>
                    <div className="wsIniWarning">
                      {iniStatus === 'missing' ? '\u26a0 INI 读取被拒绝' : '\u26a0 未设置 GameTitle'}
                    </div>
                  </>
                )}
              </div>

              <div className="wsStats">
                <div><span className="filterLabel">引擎</span><br /><b>{gameData.engine === '2k' ? 'RPG Maker 2000' : 'RPG Maker 2003'}</b></div>
                <div>
                  <span className="filterLabel">编码</span><br />
                  <select value={gameData.encoding} onChange={e => { onEncodingChange(e.target.value); }} className="wsEncSelect">
                    <option value="shift_jis">Shift_JIS</option>
                    <option value="gbk">GBK</option>
                    <option value="eucjp">EUC-JP</option>
                    <option value="utf8">UTF-8</option>
                    <option value="latin1">Latin-1</option>
                  </select>
                </div>
                <div><span className="filterLabel">素材总数</span><br /><b>{assetCount}</b></div>
                <div><span className="filterLabel">地图数</span><br /><b>{mapCount}</b></div>
                <div><span className="filterLabel">角色数</span><br /><b>{gameData.database?.actors?.length ?? 0}</b></div>
                <div><span className="filterLabel">数据库</span><br /><b>{(gameData.database ? '已加载' : '\u2014')}</b></div>
              </div>

              <div className="wsMenuActions">
                <button onClick={() => { setMenuOpen(false); onOpen(); }} className="wsMenuBtn">切换目录...</button>
                <button onClick={() => { setMenuOpen(false); onClose(); }} className="wsMenuBtnDanger">关闭项目</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ padding: '10px 12px', color: 'var(--color-text-muted)', fontSize: 13 }}>未打开项目</div>
              <button onClick={() => { setMenuOpen(false); onOpen(); }} className="wsMenuBtnPrimary">选择目录...</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
