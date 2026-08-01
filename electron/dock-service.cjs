function boundsVisible(displays, bounds, width = bounds?.width, height = bounds?.height) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(width) || !Number.isFinite(height)) return false;
  return displays.some((entry) => {
    const area = entry.workArea;
    return bounds.x < area.x + area.width && bounds.x + width > area.x && bounds.y < area.y + area.height && bounds.y + height > area.y;
  });
}

function createDockService({ screen, dockSize, resolveDockTarget }) {
  function initialWindowState(settings = {}) {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const size = dockSize(primary);
    const saved = settings.dockBounds;
    const savedVisible = boundsVisible(displays, saved, size.width, size.height);
    const area = primary.workArea;
    const floating = { width: size.width, height: size.height, x: area.x + area.width - size.width - 18, y: area.y + Math.round((area.height - size.height) / 2) };
    const preferred = { ...floating, ...(savedVisible ? saved : {}) };
    const target = settings.quickPanelDocked ? resolveDockTarget(displays, { position: settings.quickPanelDockPosition, displayId: settings.quickPanelDockDisplayId, preferredBounds: preferred }) : null;
    return { size, bounds: target?.bounds || preferred, target };
  }

  function edgeDistance(bounds, target) {
    if (!bounds || !target) return Number.POSITIVE_INFINITY;
    if (target.position === 'left') return Math.abs(bounds.x - target.edge);
    if (target.position === 'top') return Math.abs(bounds.y - target.edge);
    return Math.abs(bounds.x + bounds.width - target.edge);
  }

  return { initialWindowState, boundsVisible, edgeDistance };
}

module.exports = { createDockService, boundsVisible };
