function reconcileUndo(transaction, restored) {
  const pendingOperations = transaction.pendingOperations || transaction.operations || [];
  const restoredTargets = new Set(restored.map((entry) => entry.target));
  transaction.pendingOperations = pendingOperations.filter((entry) => !restoredTargets.has(entry.target));
  transaction.restoredCount = (transaction.restoredCount || 0) + restored.length;
  transaction.undone = transaction.pendingOperations.length === 0;
  return transaction;
}

module.exports = { reconcileUndo };
