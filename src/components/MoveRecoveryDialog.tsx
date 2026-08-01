import { AlertTriangle, FolderOpen, HardDriveDownload, ShieldCheck } from 'lucide-react';
import type { MoveRecoveryIssue } from '../types';
import { Modal } from './Modal';

const STAGE_LABELS: Record<string, string> = {
  created: '正在准备', prepared: '已记录事务', held: '源文件已暂存', copied: '副本已校验', committed: '目标已提交', sealed: '等待清理源文件', retained: '源文件待恢复', failed: '上次处理失败', invalid: '记录异常',
};

export function MoveRecoveryDialog({ issues, busy, onRecover, onRecoverAll, onReveal, onClose }: { issues: MoveRecoveryIssue[]; busy: boolean; onRecover: (id: string) => Promise<void>; onRecoverAll: () => Promise<void>; onReveal: (id: string) => Promise<void>; onClose: () => void }) {
  return <Modal title="整理恢复中心" onClose={onClose} wide>
    <div className="move-recovery-body">
      <div className="move-recovery-intro"><ShieldCheck size={21} /><span><strong>检测到上次未完整结束的跨盘整理</strong><small>安全恢复不会覆盖现有文件。已提交的目标副本会保留，隐藏源文件会恢复到桌面；发生重名时自动使用新名称。</small></span></div>
      <div className="move-recovery-list">{issues.map((issue) => <section key={issue.id} className="move-recovery-item"><AlertTriangle size={18} /><span><strong>{issue.name}</strong><small>{STAGE_LABELS[issue.stage] || issue.stage} · {issue.sourceExists ? '桌面源文件存在' : issue.hiddenSourceExists ? '发现隐藏源文件' : '桌面源文件缺失'} · {issue.targetExists ? '目标副本存在' : '目标副本未确认'}</small><small title={issue.source}>{issue.source || issue.error}</small></span><button className="icon-button" title="定位相关文件" onClick={() => onReveal(issue.id)}><FolderOpen size={16} /></button><button className="secondary-button" disabled={busy || issue.stage === 'invalid'} onClick={() => onRecover(issue.id)}><HardDriveDownload size={16} />安全恢复</button></section>)}</div>
    </div>
    <footer className="modal-footer"><span className="safety-note">恢复过程不会覆盖或永久删除用户文件</span><button className="secondary-button" disabled={busy} onClick={onClose}>稍后处理</button><button className="primary-button" disabled={busy || !issues.some((issue) => issue.stage !== 'invalid')} onClick={onRecoverAll}><ShieldCheck size={16} />全部安全恢复</button></footer>
  </Modal>;
}
