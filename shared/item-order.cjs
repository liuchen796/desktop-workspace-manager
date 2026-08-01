function uniqueIds(values, limit = 5000) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => typeof value === 'string' && value).slice(0, limit))];
}

function mergeVisibleOrder(savedOrder, allIds, visibleIds) {
  const known = new Set(uniqueIds(allIds));
  const base = uniqueIds(savedOrder).filter((id) => known.has(id));
  for (const id of known) if (!base.includes(id)) base.push(id);

  const visible = uniqueIds(visibleIds).filter((id) => known.has(id));
  const visibleSet = new Set(visible);
  const positions = [];
  base.forEach((id, index) => { if (visibleSet.has(id)) positions.push(index); });
  if (positions.length !== visible.length) throw new Error('自定义排序项目不完整');
  positions.forEach((position, index) => { base[position] = visible[index]; });
  return base;
}

module.exports = { uniqueIds, mergeVisibleOrder };
