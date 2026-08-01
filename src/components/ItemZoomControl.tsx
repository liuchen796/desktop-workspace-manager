import { Minus, Plus } from 'lucide-react';

const clamp = (value: number) => Math.min(160, Math.max(80, Math.round(value / 5) * 5));

export function ItemZoomControl({ value, label, compact = false, onChange }: { value: number; label: string; compact?: boolean; onChange: (value: number) => void | Promise<void> }) {
  const update = (next: number) => { void onChange(clamp(next)); };
  return <div className={`item-zoom-control ${compact ? 'compact' : ''}`} role="group" aria-label={label}>
    <button title={`${label}减小`} aria-label={`${label}减小`} disabled={value <= 80} onClick={() => update(value - 5)}><Minus size={15} /></button>
    <button className="zoom-value" title="恢复 100%" aria-label={`${label}恢复 100%`} onClick={() => update(100)}>{value}%</button>
    <button title={`${label}放大`} aria-label={`${label}放大`} disabled={value >= 160} onClick={() => update(value + 5)}><Plus size={15} /></button>
  </div>;
}
