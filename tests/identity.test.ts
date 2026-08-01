import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import identity from '../shared/identity.cjs';

const { legacyItemId, stableItemId, migrateItemReferences } = identity;

describe('stable desktop item identity', () => {
  it('keeps the same id after a rename when filesystem identity is available', () => {
    expect(stableItemId('personal', 'C:\\Desktop\\old.txt', { dev: 7, ino: 42 })).toBe(stableItemId('personal', 'C:\\Desktop\\new.txt', { dev: 7, ino: 42 }));
    expect(legacyItemId('personal', 'C:\\Desktop\\old.txt')).not.toBe(legacyItemId('personal', 'C:\\Desktop\\new.txt'));
  });

  it('migrates favorites, assignments, usage and scene references', () => {
    const oldId = legacyItemId('personal', 'C:\\Desktop\\A.lnk');
    const newId = stableItemId('personal', 'C:\\Desktop\\A.lnk', { dev: 2, ino: 9 });
    const settings = { assignments: { [oldId]: 'projects' }, usage: { [oldId]: { count: 2 } }, fileHashes: {}, favorites: [oldId], hidden: [], knownItemIds: [oldId], newItemIds: [], categories: [{ launchSteps: [{ id: 'one', type: 'item', value: oldId }] }] };
    expect(migrateItemReferences(settings, [{ id: newId, legacyId: oldId }])).toBe(true);
    expect(settings.assignments[newId]).toBe('projects');
    expect(settings.favorites).toEqual([newId]);
    expect(settings.categories[0].launchSteps[0].value).toBe(newId);
  });
});
