import { useEffect, useState } from 'react';
import { AlertTriangle, EyeOff, FolderOpen, LocateFixed, Star, Trash2, Wrench, X } from 'lucide-react';
import type { Category, DesktopItem } from '../types';

type Preview = Awaited<ReturnType<Window['desktopAPI']['getItemPreview']>>;

interface DetailsPaneProps {
  item: DesktopItem;
  category?: Category;
  categories: Category[];
  onClose: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onFavorite: () => void;
  onHide: () => void;
  onAssign: (categoryId: string) => void;
  onRemoveExternal: () => void;
  onRepairShortcut: () => void;
}

function formatBytes(value: number | null) {
  if (value == null) return '未统计';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function sourceLabel(scope: DesktopItem['scope']) {
  if (scope === 'public') return '公共桌面';
  if (scope === 'external') return '外部固定入口';
  return '个人桌面';
}

export function DetailsPane({ item, categories, onClose, onOpen, onReveal, onFavorite, onHide, onAssign, onRemoveExternal, onRepairShortcut }: DetailsPaneProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    let active = true;
    setPreview(null);
    setPreviewError('');
    window.desktopAPI.getItemPreview(item.id).then((value) => { if (active) setPreview(value); }).catch((error) => { if (active) setPreviewError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [item.id, item.modifiedAt]);

  return (
    <aside className="details-pane" aria-label={`${item.name}详情`}>
      <header><strong>项目详情</strong><button className="icon-button" title="关闭详情" onClick={onClose}><X size={17} /></button></header>
      <div className="details-preview">
        {!preview && !previewError && <div className="preview-loading">正在生成预览</div>}
        {preview?.kind === 'image' && <img src={preview.source} alt={`${item.name}预览`} />}
        {preview?.kind === 'video' && <video src={preview.source} controls preload="metadata" />}
        {preview?.kind === 'pdf' && <iframe src={preview.source} title={`${item.name} PDF 预览`} />}
        {preview?.kind === 'folder' && <div className="preview-fallback"><FolderOpen size={42} /><span>{preview.childCount == null ? '文件夹' : `${preview.childCount} 个直接子项目`}</span></div>}
        {preview?.kind === 'missing' && <div className="preview-fallback danger"><AlertTriangle size={38} /><span>原项目已不存在</span></div>}
        {preview?.kind === 'none' && <div className="preview-fallback"><FolderOpen size={38} /><span>此类型暂无内容预览</span></div>}
        {previewError && <div className="preview-fallback danger"><AlertTriangle size={36} /><span>{previewError}</span></div>}
      </div>
      <div className="details-title"><div className="details-native-icon">{item.icon ? <img src={item.icon} alt="" /> : <FolderOpen size={25} />}</div><span><strong>{item.name}</strong><small>{sourceLabel(item.scope)}</small></span></div>
      <div className="details-actions">
        <button className="primary-button" disabled={!item.exists} onClick={onOpen}><FolderOpen size={16} />打开</button>
        <button className="icon-button" title="在资源管理器中显示" disabled={!item.exists} onClick={onReveal}><LocateFixed size={16} /></button>
        <button className={`icon-button ${item.favorite ? 'active' : ''}`} title={item.favorite ? '取消收藏' : '收藏'} onClick={onFavorite}><Star size={16} fill={item.favorite ? 'currentColor' : 'none'} /></button>
        <button className="icon-button" title={item.hidden ? '恢复显示' : '隐藏'} onClick={onHide}><EyeOff size={16} /></button>
      </div>
      {item.scope === 'personal' && item.type === 'shortcut' && !item.targetExists && <button className="repair-shortcut-button" onClick={onRepairShortcut}><Wrench size={16} />打开快捷方式修复助手</button>}
      <dl className="details-meta">
        <div><dt>工作场景</dt><dd><select value={item.categoryId} onChange={(event) => onAssign(event.target.value)}>{categories.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}</select></dd></div>
        <div><dt>类型</dt><dd>{item.extension || item.type}</dd></div>
        <div><dt>大小</dt><dd>{formatBytes(item.size)}</dd></div>
        <div><dt>修改时间</dt><dd>{item.modifiedAt ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(item.modifiedAt) : '未知'}</dd></div>
        <div><dt>工作台打开</dt><dd>{item.useCount} 次</dd></div>
        {item.target && <div><dt>快捷方式目标</dt><dd title={item.target}>{item.target}</dd></div>}
        <div><dt>完整路径</dt><dd title={item.path}>{item.path}</dd></div>
      </dl>
      {item.scope === 'external' && <button className="remove-external" onClick={onRemoveExternal}><Trash2 size={15} />从工作台移除入口</button>}
    </aside>
  );
}
