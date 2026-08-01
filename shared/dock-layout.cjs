const DOCK_WIDTH = 388;
const DOCK_MAX_HEIGHT = 680;
const DOCK_MIN_MARGIN = 24;
const EDGE_TOLERANCE = 2;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function normalizeRectangle(value) {
  if (!value || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]))) {
    throw new Error('Invalid display rectangle');
  }
  return value;
}

function displayBounds(display) {
  return normalizeRectangle(display?.bounds || display?.workArea || display);
}

function displayWorkArea(display) {
  return normalizeRectangle(display?.workArea || display?.bounds || display);
}

function dockSize(display) {
  const area = displayWorkArea(display);
  return {
    width: Math.min(DOCK_WIDTH, area.width),
    height: Math.min(DOCK_MAX_HEIGHT, area.height, Math.max(240, area.height - DOCK_MIN_MARGIN)),
  };
}

function expandedDockBounds(display, position = 'right', savedBounds = null) {
  const area = displayWorkArea(display);
  const bounds = displayBounds(display);
  const size = dockSize(display);
  const savedX = Number.isFinite(savedBounds?.x) ? savedBounds.x : area.x + Math.round((area.width - size.width) / 2);
  const savedY = Number.isFinite(savedBounds?.y) ? savedBounds.y : area.y + Math.round((area.height - size.height) / 2);

  if (position === 'left') return { ...size, x: bounds.x, y: clamp(savedY, area.y, area.y + area.height - size.height) };
  if (position === 'top') return { ...size, x: clamp(savedX, area.x, area.x + area.width - size.width), y: bounds.y };
  return { ...size, x: bounds.x + bounds.width - size.width, y: clamp(savedY, area.y, area.y + area.height - size.height) };
}

function collapsedDockBounds(expandedBounds, display, position = 'right', triggerSize = 8) {
  const bounds = displayBounds(display);
  const trigger = clamp(Number(triggerSize) || 8, 3, 24);
  const result = { ...expandedBounds };
  if (position === 'left') result.x = bounds.x - result.width + trigger;
  else if (position === 'top') result.y = bounds.y - result.height + trigger;
  else result.x = bounds.x + bounds.width - trigger;
  return result;
}

function sameDisplay(left, right) {
  return left === right || (left?.id != null && right?.id != null && String(left.id) === String(right.id));
}

function subtractInterval(segments, blockerStart, blockerEnd) {
  if (blockerEnd <= blockerStart) return segments;
  const result = [];
  for (const [start, end] of segments) {
    if (blockerEnd <= start || blockerStart >= end) {
      result.push([start, end]);
      continue;
    }
    if (blockerStart > start) result.push([start, Math.min(blockerStart, end)]);
    if (blockerEnd < end) result.push([Math.max(blockerEnd, start), end]);
  }
  return result;
}

function edgeBlocker(display, candidate, position) {
  if (sameDisplay(display, candidate)) return null;
  const area = displayBounds(display);
  const other = displayBounds(candidate);
  if (position === 'left' && Math.abs(other.x + other.width - area.x) <= EDGE_TOLERANCE) return [other.y, other.y + other.height];
  if (position === 'right' && Math.abs(other.x - (area.x + area.width)) <= EDGE_TOLERANCE) return [other.y, other.y + other.height];
  if (position === 'top' && Math.abs(other.y + other.height - area.y) <= EDGE_TOLERANCE) return [other.x, other.x + other.width];
  return null;
}

function externalDockTargets(displays) {
  if (!Array.isArray(displays)) return [];
  const targets = [];
  for (const display of displays) {
    const area = displayBounds(display);
    const workArea = displayWorkArea(display);
    const targetSize = dockSize(display);
    for (const position of ['left', 'right', 'top']) {
      const horizontal = position === 'top';
      let segments = [[horizontal ? area.x : area.y, horizontal ? area.x + area.width : area.y + area.height]];
      for (const candidate of displays) {
        const blocker = edgeBlocker(display, candidate, position);
        if (blocker) segments = subtractInterval(segments, blocker[0], blocker[1]);
      }
      const workStart = horizontal ? workArea.x : workArea.y;
      const workEnd = horizontal ? workArea.x + workArea.width : workArea.y + workArea.height;
      const required = horizontal ? targetSize.width : targetSize.height;
      const edge = position === 'left' ? area.x : position === 'right' ? area.x + area.width : area.y;
      for (const [rawStart, rawEnd] of segments) {
        const start = Math.max(rawStart, workStart);
        const end = Math.min(rawEnd, workEnd);
        if (end - start + EDGE_TOLERANCE < required) continue;
        targets.push({ displayId: String(display.id ?? ''), position, edge, start, end, display });
      }
    }
  }
  return targets;
}

function fitDockTarget(target, preferredBounds) {
  const size = dockSize(target.display);
  const source = { ...size, ...(preferredBounds || {}) };
  const width = size.width;
  const height = size.height;
  if (target.position === 'left') return { width, height, x: target.edge, y: clamp(source.y, target.start, target.end - height) };
  if (target.position === 'top') return { width, height, x: clamp(source.x, target.start, target.end - width), y: target.edge };
  return { width, height, x: target.edge - width, y: clamp(source.y, target.start, target.end - height) };
}

function targetDistance(windowBounds, targetBounds, position) {
  if (position === 'left') return Math.hypot(windowBounds.x - targetBounds.x, windowBounds.y - targetBounds.y);
  if (position === 'top') return Math.hypot(windowBounds.y - targetBounds.y, windowBounds.x - targetBounds.x);
  return Math.hypot((windowBounds.x + windowBounds.width) - (targetBounds.x + targetBounds.width), windowBounds.y - targetBounds.y);
}

function findNearestDockTarget(windowBounds, displays, snapDistance = 28) {
  const distanceLimit = clamp(Number(snapDistance) || 28, 8, 80);
  let nearest = null;
  for (const target of externalDockTargets(displays)) {
    const bounds = fitDockTarget(target, windowBounds);
    const distance = targetDistance(windowBounds, bounds, target.position);
    if (distance <= distanceLimit && (!nearest || distance < nearest.distance)) nearest = { ...target, bounds, distance };
  }
  return nearest;
}

function resolveDockTarget(displays, { position = 'right', displayId = '', preferredBounds = null } = {}) {
  const all = externalDockTargets(displays).filter((target) => target.position === position);
  const matchingDisplay = displayId ? all.filter((target) => target.displayId === String(displayId)) : [];
  const candidates = matchingDisplay.length ? matchingDisplay : all;
  let nearest = null;
  for (const target of candidates) {
    const bounds = fitDockTarget(target, preferredBounds);
    const source = preferredBounds || bounds;
    const distance = Math.hypot(bounds.x - source.x, bounds.y - source.y);
    if (!nearest || distance < nearest.distance) nearest = { ...target, bounds, distance };
  }
  return nearest;
}

function collapsedDockBoundsForTarget(expandedBounds, target, triggerSize = 8) {
  const trigger = clamp(Number(triggerSize) || 8, 3, 24);
  const result = { ...expandedBounds };
  if (target.position === 'left') result.x = target.edge - result.width + trigger;
  else if (target.position === 'top') result.y = target.edge - result.height + trigger;
  else result.x = target.edge - trigger;
  return result;
}

module.exports = {
  DOCK_WIDTH,
  DOCK_MAX_HEIGHT,
  dockSize,
  expandedDockBounds,
  collapsedDockBounds,
  externalDockTargets,
  fitDockTarget,
  findNearestDockTarget,
  resolveDockTarget,
  collapsedDockBoundsForTarget,
};
