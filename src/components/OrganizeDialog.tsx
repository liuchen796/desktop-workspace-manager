import { useEffect, useState } from 'react';
import { AlertTriangle, Archive, Check, ChevronRight } from 'lucide-react';
import type { Category, OrganizePlan } from '../types';
import { Modal } from './Modal';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function OrganizeDialog({ ids, categories, onClose, onComplete }: { ids: string[]; categories: Category[]; onClose: () => void; onComplete: (message: string) => Promise<void> }) {
  const choices = categories.filter((category) => category.id !== 'inbox');
  const [categoryId, setCategoryId] = useState(choices[0]?.id || 'other');
  const [plan, setPlan] = useState<OrganizePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    window.desktopAPI.previewOrganize(ids, categoryId).then((next) => { if (!cancelled) { setPlan(next); setError(''); } }).catch((nextError) => { if (!cancelled) setError(errorText(nextError)); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [ids.join('|'), categoryId]);

  return <Modal title="整理预览" onClose={onClose} wide><div className="organize-head"><div><strong>目标分类</strong><select aria-label="整理目标分类" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{choices.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></div><span>{plan?.destinationDir}</span></div>
    <div className="preview-list">{busy && <div className="preview-loading">正在验证路径</div>}{plan?.operations.map((operation) => <div className="preview-row" key={operation.id}><Check size={16} /><span><strong>{operation.name}</strong><small>{operation.source}</small></span><ChevronRight size={16} /><span className="target-path">{operation.target}</span>{operation.renamed && <em>已避开重名</em>}</div>)}{plan?.failures.map((failure) => <div className="preview-row failed" key={failure.id}><AlertTriangle size={16} /><span><strong>{failure.name || failure.id}</strong><small>{failure.reason}</small></span></div>)}</div>
    {error && <div className="error-banner" role="alert"><AlertTriangle size={17} />{error}</div>}
    <footer className="modal-footer"><span className="safety-note">只移动个人桌面项目，不覆盖已有文件</span><button className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !plan?.operations.length} onClick={async () => { setBusy(true); try { const result = await window.desktopAPI.executeOrganize(ids, categoryId); const recycled = result.completed.filter((operation) => operation.sourceRecovery === 'recycle-bin').length; await onComplete(`已整理 ${result.completed.length} 个项目${result.failed.length ? `，${result.failed.length} 个未处理` : ''}${recycled ? `；${recycled} 个跨盘源副本已进入回收站` : ''}`); } catch (nextError) { setError(errorText(nextError)); setBusy(false); } }}><Archive size={17} />确认整理</button></footer>
  </Modal>;
}
