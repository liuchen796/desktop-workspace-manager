const STEP_TYPES = new Set(['item', 'url', 'delay']);

function sanitizeLaunchStep(entry, index = 0) {
  const type = String(entry?.type || 'item');
  if (!STEP_TYPES.has(type)) throw new Error('工作场景步骤类型无效');
  const id = String(entry?.id || `step-${index}`).slice(0, 80);
  const label = String(entry?.label || '').trim().slice(0, 80);
  let value = String(entry?.value ?? '').trim();
  if (type === 'url') {
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error('工作场景网址无效'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('工作场景只允许 HTTP 或 HTTPS 网址');
    value = parsed.href;
  }
  if (type === 'delay') {
    const milliseconds = Number(value);
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 10000) throw new Error('等待时间必须在 0 到 10000 毫秒之间');
    value = String(milliseconds);
  }
  if (type === 'item' && (!value || value.length > 100)) throw new Error('工作场景项目无效');
  return { id, type, value, label, enabled: entry?.enabled !== false };
}

function sanitizeLaunchSteps(entries) {
  if (!Array.isArray(entries) || entries.length > 30) throw new Error('每个工作场景最多设置 30 个启动步骤');
  const steps = entries.map(sanitizeLaunchStep);
  if (new Set(steps.map((step) => step.id)).size !== steps.length) throw new Error('工作场景步骤标识不能重复');
  return steps;
}

module.exports = { STEP_TYPES, sanitizeLaunchStep, sanitizeLaunchSteps };
