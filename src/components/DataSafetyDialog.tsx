import { useEffect, useState } from 'react';
import { ArchiveRestore, Camera, Download, FolderOpen, Import, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { DesktopPayload, SnapshotDiff, SnapshotSummary } from '../types';
import { Modal } from './Modal';

interface DataSafetyDialogProps {
  onClose: () => void;
  onPayload: (payload: DesktopPayload) => void;
  onMessage: (message: string) => void;
}

type ImportPreview = Awaited<ReturnType<Window['desktopAPI']['prepareImportBackup']>>;

export function DataSafetyDialog({ onClose, onPayload, onMessage }: DataSafetyDialogProps) {
  const [tab, setTab] = useState<'snapshot' | 'backup'>('snapshot');
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [backups, setBackups] = useState<Array<{ name: string; path: string; timestamp: number }>>([]);
  const [diff, setDiff] = useState<{ id: string; value: SnapshotDiff } | null>(null);
  const [label, setLabel] = useState('');
  const [importPreview, setImportPreview] = useState<ImportPreview>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [nextSnapshots, nextBackups] = await Promise.all([window.desktopAPI.listSnapshots(), window.desktopAPI.listAutomaticBackups()]);
    setSnapshots(nextSnapshots.sort((a, b) => b.timestamp - a.timestamp));
    setBackups(nextBackups.sort((a, b) => b.timestamp - a.timestamp));
  };

  useEffect(() => { void reload(); }, []);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try { await task(); } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  };

  return (
    <Modal title="数据安全中心" wide onClose={() => { if (!busy) onClose(); }}>
        <div className="data-tabs"><button className={tab === 'snapshot' ? 'active' : ''} onClick={() => setTab('snapshot')}><Camera size={16} />桌面快照</button><button className={tab === 'backup' ? 'active' : ''} onClick={() => setTab('backup')}><ArchiveRestore size={16} />配置备份</button></div>
        {tab === 'snapshot' ? <div className="data-center-body">
          <div className="snapshot-create"><input className="text-input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="快照名称（可选）" /><button className="primary-button" disabled={busy} onClick={() => run(async () => { await window.desktopAPI.createSnapshot(label); setLabel(''); await reload(); onMessage('桌面快照已创建'); })}><Plus size={16} />创建当前快照</button></div>
          <p className="data-note">快照只记录项目路径和工作台分类状态，不复制或移动真实文件。每次真实整理前也会自动创建一份。</p>
          <div className="snapshot-list">{snapshots.map((snapshot) => <section key={snapshot.id} className="snapshot-record"><div><Camera size={17} /><span><strong>{snapshot.label}</strong><small>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(snapshot.timestamp)} · {snapshot.itemCount} 项{snapshot.automatic ? ' · 自动' : ''}</small></span><button className="secondary-button" disabled={busy} onClick={() => run(async () => setDiff({ id: snapshot.id, value: await window.desktopAPI.diffSnapshot(snapshot.id) }))}>查看差异</button><button className="icon-button" title="恢复虚拟分类状态" disabled={busy} onClick={() => run(async () => { if (!window.confirm('只恢复当前仍存在项目的分类、收藏和隐藏状态，不移动真实文件。是否继续？')) return; const result = await window.desktopAPI.restoreSnapshot(snapshot.id); onPayload(result.payload); onMessage(`已恢复 ${result.restored} 个项目的工作台状态`); })}><RotateCcw size={15} /></button><button className="icon-button danger-button" title="删除快照记录" disabled={busy} onClick={() => run(async () => { if (!window.confirm('删除这份快照记录？不会删除任何桌面文件。')) return; await window.desktopAPI.deleteSnapshot(snapshot.id); if (diff?.id === snapshot.id) setDiff(null); await reload(); })}><Trash2 size={15} /></button></div>{diff?.id === snapshot.id && <SnapshotDifference value={diff.value} />}</section>)}{!snapshots.length && <div className="data-empty">还没有桌面快照</div>}</div>
        </div> : <div className="data-center-body">
          <div className="backup-actions"><button className="primary-button" disabled={busy} onClick={() => run(async () => { const file = await window.desktopAPI.exportBackup(); if (file) onMessage(`配置已导出到 ${file}`); })}><Upload size={16} />导出配置</button><button className="secondary-button" disabled={busy} onClick={() => run(async () => setImportPreview(await window.desktopAPI.prepareImportBackup()))}><Download size={16} />导入配置</button><button className="icon-button" title="打开自动备份目录" onClick={() => window.desktopAPI.openBackupFolder()}><FolderOpen size={16} /></button></div>
          {importPreview && <div className="import-preview"><Import size={20} /><span><strong>确认导入此配置</strong><small>{importPreview.categories} 个分类 · {importPreview.favorites} 个收藏 · {importPreview.assignments} 条分类结果 · {importPreview.externalItems} 个外部入口</small><small title={importPreview.filePath}>{importPreview.filePath}</small></span><button className="primary-button" disabled={busy} onClick={() => run(async () => { const payload = await window.desktopAPI.applyImportBackup(importPreview.token); onPayload(payload); setImportPreview(null); await reload(); onMessage('配置已导入，导入前设置已自动备份'); })}>确认导入</button></div>}
          <p className="data-note">应用会保留最近 5 份设置备份。恢复配置不会移动或删除任何桌面文件。</p>
          <div className="backup-list">{backups.map((backup) => <div key={backup.name}><span><strong>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(backup.timestamp)}</strong><small>{backup.name}</small></span><button className="secondary-button" disabled={busy} onClick={() => run(async () => { if (!window.confirm('恢复这份自动备份？当前设置会先保留。')) return; const payload = await window.desktopAPI.restoreAutomaticBackup(backup.name); onPayload(payload); onMessage('自动备份已恢复'); })}><RotateCcw size={15} />恢复</button></div>)}{!backups.length && <div className="data-empty">首次保存设置后会生成自动备份</div>}</div>
        </div>}
    </Modal>
  );
}

function SnapshotDifference({ value }: { value: SnapshotDiff }) {
  const groups = [{ key: 'added', label: '快照后新增', items: value.added }, { key: 'removed', label: '当前已缺少', items: value.removed }, { key: 'changed', label: '工作台状态变化', items: value.changed }];
  return <div className="snapshot-diff">{groups.map((group) => <div key={group.key}><strong>{group.label} {group.items.length}</strong>{group.items.slice(0, 20).map((item) => <span key={`${group.key}-${item.path}`} title={item.path}>{item.name}{item.fields?.length ? ` · ${item.fields.join('、')}` : ''}</span>)}</div>)}</div>;
}
