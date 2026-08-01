import { useEffect, useMemo, useRef } from 'react';
import { Check, EyeOff, FolderOpen, LocateFixed, Star } from 'lucide-react';
import type { Category, DesktopItem } from '../types';

export type ContextItemAction = 'open' | 'reveal' | 'favorite' | 'hide';

interface ItemContextMenuProps {
  item: DesktopItem;
  categories: Category[];
  x: number;
  y: number;
  onAction: (action: ContextItemAction) => void;
  onAssign: (categoryId: string) => void;
  onClose: () => void;
}

export function ItemContextMenu({ item, categories, x, y, onAction, onAssign, onClose }: ItemContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const position = useMemo(() => ({
    left: Math.max(8, Math.min(x, window.innerWidth - 250)),
    top: Math.max(8, Math.min(y, window.innerHeight - 430)),
  }), [x, y]);

  useEffect(() => {
    menuRef.current?.focus();
    const handlePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', handlePointer, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointerdown', handlePointer, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const run = (action: ContextItemAction) => {
    onAction(action);
    onClose();
  };

  return (
    <div ref={menuRef} className="context-menu" style={position} role="menu" tabIndex={-1} aria-label={`${item.name}快捷菜单`}>
      <div className="context-heading"><strong>{item.name}</strong><span>{item.scope === 'public' ? '公共桌面' : item.scope === 'external' ? '外部入口' : '个人桌面'}</span></div>
      <button role="menuitem" onClick={() => run('open')}><FolderOpen size={16} /><span>打开</span></button>
      <button role="menuitem" onClick={() => run('reveal')}><LocateFixed size={16} /><span>在资源管理器中显示</span></button>
      <button role="menuitem" onClick={() => run('favorite')}><Star size={16} fill={item.favorite ? 'currentColor' : 'none'} /><span>{item.favorite ? '取消收藏' : '加入收藏'}</span></button>
      <div className="context-separator" />
      <div className="context-label">虚拟分类</div>
      <div className="context-categories">
        {categories.map((category) => (
          <button role="menuitemradio" aria-checked={item.categoryId === category.id} key={category.id} onClick={() => { onAssign(category.id); onClose(); }}>
            <i style={{ background: category.color }} /><span>{category.label}</span>{item.categoryId === category.id && <Check size={14} />}
          </button>
        ))}
      </div>
      <div className="context-separator" />
      <button role="menuitem" onClick={() => run('hide')}><EyeOff size={16} /><span>{item.hidden ? '取消隐藏' : '从工作台隐藏'}</span></button>
    </div>
  );
}
