import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import snapshotModule from '../shared/snapshots.cjs';

const { createSnapshot, diffSnapshot, applySnapshotVirtualState } = snapshotModule;

describe('desktop snapshots', () => {
  const categories = [{ id: 'other' }, { id: 'projects' }];
  const original = [{ id: 'old-a', name: 'A', path: 'C:\\Desktop\\A.lnk', scope: 'personal', categoryId: 'projects', favorite: true, hidden: false }];

  it('reports added, removed and virtual-state changes', () => {
    const snapshot = createSnapshot(original, { categories }, { id: 'one', timestamp: 1 });
    const current = [
      { ...original[0], id: 'new-a', categoryId: 'other', favorite: false },
      { id: 'b', name: 'B', path: 'C:\\Desktop\\B.txt', scope: 'personal', categoryId: 'other', favorite: false, hidden: false },
    ];
    const diff = diffSnapshot(snapshot, current);
    expect(diff.added.map((item: { name: string }) => item.name)).toEqual(['B']);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed[0].fields).toEqual(['category', 'favorite']);
  });

  it('restores virtual state by stable path when item ids changed', () => {
    const snapshot = createSnapshot(original, { categories }, { id: 'one', timestamp: 1 });
    const current = [{ ...original[0], id: 'new-a', categoryId: 'other', favorite: false }];
    const settings = { categories, assignments: {}, favorites: [], hidden: [] };
    expect(applySnapshotVirtualState(snapshot, current, settings)).toBe(1);
    expect(settings.assignments['new-a']).toBe('projects');
    expect(settings.favorites).toEqual(['new-a']);
  });
});
