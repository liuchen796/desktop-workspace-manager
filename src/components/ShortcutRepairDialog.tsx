import { useEffect, useState } from 'react';
import { Check, FolderSearch, Search, Wrench } from 'lucide-react';
import type { DesktopItem, DesktopPayload, ShortcutCandidate } from '../types';
import { Modal } from './Modal';

interface ShortcutRepairDialogProps {
  item: DesktopItem;
  onClose: () => void;
  onPayload: (payload: DesktopPayload) => void;
  onMessage: (message: string) => void;
}

export function ShortcutRepairDialog({ item, onClose, onPayload, onMessage }: ShortcutRepairDialogProps) {
  const [candidates, setCandidates] = useState<ShortcutCandidate[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    window.desktopAPI.findShortcutCandidates(item.id)
      .then((value) => { if (active) { setCandidates(value); setSelected(value[0]?.token || ''); } })
      .catch((nextError) => { if (active) setError(nextError instanceof Error ? nextError.message : String(nextError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [item.id]);

  const chooseManually = async () => {
    try {
      const candidate = await window.desktopAPI.chooseShortcutCandidate(item.id);
      if (!candidate) return;
      setCandidates((current) => [candidate, ...current.filter((entry) => entry.path !== candidate.path)]);
      setSelected(candidate.token);
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
  };

  const repair = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.desktopAPI.repairShortcut(selected);
      onPayload(result.payload);
      onMessage('快捷方式已修复，可在整理记录中撤销');
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`修复“${item.name}”`} wide onClose={() => { if (!busy) onClose(); }}>
    <div className="repair-body">
      <div className="repair-current"><Wrench size={19} /><span><strong>当前目标已失效</strong><small>{item.target || '快捷方式没有可读取的目标路径'}</small></span></div>
      <div className="repair-heading"><strong>候选程序</strong><button className="secondary-button" disabled={busy} onClick={chooseManually}><FolderSearch size={15} />手动选择 EXE</button></div>
      {loading ? <div className="repair-empty"><Search size={24} />正在常用安装目录中搜索</div> : <div className="repair-candidates">{candidates.map((candidate) => <button className={selected === candidate.token ? 'selected' : ''} onClick={() => setSelected(candidate.token)} key={candidate.token}><span><strong>{candidate.name}</strong><small title={candidate.path}>{candidate.path}</small></span>{candidate.score >= 100 && <em>原程序名匹配</em>}{selected === candidate.token && <Check size={16} />}</button>)}{!candidates.length && <div className="repair-empty">没有自动找到候选程序，请手动选择新的 EXE</div>}</div>}
      {error && <div className="dialog-error" role="alert">{error}</div>}
    </div>
    <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={!selected || busy} onClick={repair}><Wrench size={16} />{busy ? '正在修复' : '确认修复'}</button></footer>
  </Modal>;
}
