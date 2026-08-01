import { ArrowDown, ArrowUp, Clock3, FilePlus2, Globe2, Play, Plus, Trash2 } from 'lucide-react';
import type { Category, DesktopItem, LaunchStep } from '../types';
import { Modal } from './Modal';

interface SceneEditorDialogProps {
  category: Category;
  items: DesktopItem[];
  onChange: (category: Category) => void;
  onClose: () => void;
}

const nextId = () => `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function SceneEditorDialog({ category, items, onChange, onClose }: SceneEditorDialogProps) {
  const updateStep = (id: string, patch: Partial<LaunchStep>) => onChange({ ...category, launchSteps: category.launchSteps.map((step) => step.id === id ? { ...step, ...patch } : step) });
  const addStep = (type: LaunchStep['type']) => {
    const value = type === 'item' ? (items[0]?.id || '') : type === 'url' ? 'https://www.example.com/' : '800';
    if (type === 'item' && !value) return;
    onChange({ ...category, launchSteps: [...category.launchSteps, { id: nextId(), type, value, label: '', enabled: true }] });
  };
  const move = (index: number, direction: -1 | 1) => {
    const next = [...category.launchSteps];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange({ ...category, launchSteps: next });
  };

  return <Modal title={`${category.label} · 一键启动`} wide onClose={onClose}>
    <div className="scene-editor">
      <div className="scene-summary"><Play size={20} /><span><strong>{category.launchSteps.filter((step) => step.enabled).length} 个启用步骤</strong><small>按下方顺序依次打开；单项失败不会中断后续步骤</small></span></div>
      <div className="scene-step-list">{category.launchSteps.map((step, index) => <div className="scene-step" key={step.id}><input type="checkbox" aria-label="启用步骤" checked={step.enabled} onChange={(event) => updateStep(step.id, { enabled: event.target.checked })} /><span className={`scene-type type-${step.type}`}>{step.type === 'item' ? <FilePlus2 size={16} /> : step.type === 'url' ? <Globe2 size={16} /> : <Clock3 size={16} />}</span>{step.type === 'item' ? <select aria-label="选择启动项目" value={step.value} onChange={(event) => updateStep(step.id, { value: event.target.value })}>{items.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.scope === 'external' ? '外部入口' : item.scope === 'public' ? '公共桌面' : '个人桌面'}</option>)}</select> : <input className="text-input" aria-label={step.type === 'url' ? '网页地址' : '等待毫秒数'} type={step.type === 'delay' ? 'number' : 'url'} min={step.type === 'delay' ? 0 : undefined} max={step.type === 'delay' ? 10000 : undefined} value={step.value} onChange={(event) => updateStep(step.id, { value: event.target.value })} />}<input className="text-input scene-label-input" aria-label="步骤备注" value={step.label} onChange={(event) => updateStep(step.id, { label: event.target.value })} placeholder="备注（可选）" /><button className="icon-button" title="上移" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button className="icon-button" title="下移" disabled={index === category.launchSteps.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button><button className="icon-button danger-button" title="删除步骤" onClick={() => onChange({ ...category, launchSteps: category.launchSteps.filter((entry) => entry.id !== step.id) })}><Trash2 size={15} /></button></div>)}{!category.launchSteps.length && <div className="scene-empty">还没有启动步骤</div>}</div>
    </div>
    <footer className="modal-footer scene-footer"><div><button className="secondary-button" disabled={!items.length} onClick={() => addStep('item')}><Plus size={15} />项目</button><button className="secondary-button" onClick={() => addStep('url')}><Plus size={15} />网页</button><button className="secondary-button" onClick={() => addStep('delay')}><Plus size={15} />等待</button></div><button className="primary-button" onClick={onClose}>完成编辑</button></footer>
  </Modal>;
}
