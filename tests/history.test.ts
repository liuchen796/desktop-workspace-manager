import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import history from '../shared/history.cjs';

const { reconcileUndo } = history;

describe('undo history reconciliation', () => {
  const operations = [
    { source: 'desktop-a', target: 'archive-a' },
    { source: 'desktop-b', target: 'archive-b' },
  ];

  it('keeps only failed operations pending after a partial undo', () => {
    const transaction = { operations, pendingOperations: operations, restoredCount: 0, undone: false };
    reconcileUndo(transaction, [{ ...operations[0], restoredTo: 'desktop-a' }]);
    expect(transaction.pendingOperations).toEqual([operations[1]]);
    expect(transaction.restoredCount).toBe(1);
    expect(transaction.undone).toBe(false);
  });

  it('marks the transaction complete after the remaining item succeeds', () => {
    const transaction = { operations, pendingOperations: [operations[1]], restoredCount: 1, undone: false };
    reconcileUndo(transaction, [{ ...operations[1], restoredTo: 'desktop-b' }]);
    expect(transaction.pendingOperations).toEqual([]);
    expect(transaction.restoredCount).toBe(2);
    expect(transaction.undone).toBe(true);
  });
});
