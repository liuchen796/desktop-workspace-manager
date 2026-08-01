import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import dockLayout from '../shared/dock-layout.cjs';

const { expandedDockBounds, collapsedDockBounds, externalDockTargets, findNearestDockTarget, resolveDockTarget, collapsedDockBoundsForTarget } = dockLayout;
const display = { id: 1, bounds: { x: 1920, y: 40, width: 2560, height: 1560 }, workArea: { x: 1920, y: 40, width: 2560, height: 1560 } };

describe('quick panel dock layout', () => {
  it('docks to the right and leaves the configured trigger strip visible', () => {
    const expanded = expandedDockBounds(display, 'right', { x: 0, y: 200 });
    const collapsed = collapsedDockBounds(expanded, display, 'right', 10);
    expect(expanded.x + expanded.width).toBe(4480);
    expect(collapsed.x).toBe(4470);
  });

  it('exposes left, right and top edges for a single display', () => {
    const targets = externalDockTargets([display], { width: 388, height: 680 });
    expect(targets.map((target: { position: string }) => target.position).sort()).toEqual(['left', 'right', 'top']);
  });

  it('removes internal edges between adjacent displays', () => {
    const left = { id: 1, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 0, width: 1920, height: 1040 } };
    const right = { id: 2, bounds: { x: 0, y: 0, width: 2560, height: 1440 }, workArea: { x: 0, y: 0, width: 2560, height: 1400 } };
    const targets = externalDockTargets([left, right], { width: 388, height: 680 });
    expect(targets.some((target: { displayId: string; position: string }) => target.displayId === '1' && target.position === 'right')).toBe(false);
    expect(targets.some((target: { displayId: string; position: string }) => target.displayId === '2' && target.position === 'left')).toBe(false);
    expect(targets.some((target: { displayId: string; position: string }) => target.displayId === '1' && target.position === 'left')).toBe(true);
    expect(targets.some((target: { displayId: string; position: string }) => target.displayId === '2' && target.position === 'right')).toBe(true);
    expect(targets.filter((target: { position: string }) => target.position === 'top')).toHaveLength(2);
  });

  it('keeps sufficiently long exposed segments in staggered layouts', () => {
    const primary = { id: 1, bounds: { x: 0, y: 0, width: 2560, height: 1600 }, workArea: { x: 0, y: 0, width: 2560, height: 1560 } };
    const lowerRight = { id: 2, bounds: { x: 2560, y: 900, width: 1920, height: 1080 }, workArea: { x: 2560, y: 900, width: 1920, height: 1040 } };
    const target = externalDockTargets([primary, lowerRight], { width: 388, height: 680 }).find((entry: { displayId: string; position: string }) => entry.displayId === '1' && entry.position === 'right');
    expect(target).toMatchObject({ start: 0, end: 900 });
  });

  it('finds a snap target only within the configured distance', () => {
    const near = { x: 1928, y: 300, width: 388, height: 680 };
    const far = { x: 1980, y: 300, width: 388, height: 680 };
    expect(findNearestDockTarget(near, [display], 12)?.position).toBe('left');
    expect(findNearestDockTarget(far, [display], 12)).toBeNull();
  });

  it('restores a target on the same display and computes its collapsed bounds', () => {
    const target = resolveDockTarget([display], { position: 'top', displayId: '1', preferredBounds: { x: 2500, y: 40, width: 388, height: 680 } });
    expect(target?.bounds).toMatchObject({ x: 2500, y: 40 });
    expect(collapsedDockBoundsForTarget(target.bounds, target, 12).y + target.bounds.height).toBe(52);
  });
});
