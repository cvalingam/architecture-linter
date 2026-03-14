import { detectCircularDependencies } from '../circularDetector';
import { FileScan } from '../types';

function makeScan(file: string, importPaths: string[] = []): FileScan {
  return {
    file,
    layer: null,
    imports: importPaths.map(p => ({
      file,
      importPath: p,
      rawSpecifier: `./${p}`,
      archIgnore: [],
    })),
  };
}

const LAYERS = ['controller', 'service', 'repository'];

describe('detectCircularDependencies', () => {
  it('returns empty array when there are no scans', () => {
    expect(detectCircularDependencies([], LAYERS)).toEqual([]);
  });

  it('returns empty array when there are no cross-layer imports', () => {
    const scans = [makeScan('controllers/ctrl.ts', [])];
    expect(detectCircularDependencies(scans, LAYERS)).toEqual([]);
  });

  it('returns empty array for a valid one-way dependency', () => {
    // controller → service (no cycle)
    const scans = [
      makeScan('controllers/ctrl.ts', ['services/svc']),
      makeScan('services/svc.ts', []),
    ];
    expect(detectCircularDependencies(scans, LAYERS)).toEqual([]);
  });

  it('returns empty array for a valid chain', () => {
    // controller → service → repository
    const scans = [
      makeScan('controllers/ctrl.ts', ['services/svc']),
      makeScan('services/svc.ts', ['repositories/repo']),
      makeScan('repositories/repo.ts', []),
    ];
    expect(detectCircularDependencies(scans, LAYERS)).toEqual([]);
  });

  it('detects a direct two-layer cycle: controller ↔ service', () => {
    const scans = [
      makeScan('controllers/ctrl.ts', ['services/svc']),
      makeScan('services/svc.ts', ['controllers/ctrl']),
    ];
    const cycles = detectCircularDependencies(scans, LAYERS);
    expect(cycles.length).toBeGreaterThan(0);
    // Both layers must appear in the cycle
    const allNodes = cycles.flatMap(c => c.cycle);
    expect(allNodes).toContain('controller');
    expect(allNodes).toContain('service');
  });

  it('detected cycle closes back to the start node', () => {
    const scans = [
      makeScan('controllers/ctrl.ts', ['services/svc']),
      makeScan('services/svc.ts', ['controllers/ctrl']),
    ];
    const [cycle] = detectCircularDependencies(scans, LAYERS);
    expect(cycle.cycle[0]).toBe(cycle.cycle[cycle.cycle.length - 1]);
  });

  it('detects a three-node cycle: controller → service → repository → controller', () => {
    const scans = [
      makeScan('controllers/ctrl.ts', ['services/svc']),
      makeScan('services/svc.ts', ['repositories/repo']),
      makeScan('repositories/repo.ts', ['controllers/ctrl']),
    ];
    const cycles = detectCircularDependencies(scans, LAYERS);
    expect(cycles.length).toBeGreaterThan(0);
    const allNodes = cycles.flatMap(c => c.cycle);
    expect(allNodes).toContain('controller');
    expect(allNodes).toContain('service');
    expect(allNodes).toContain('repository');
  });

  it('does not report a self-import as a cycle', () => {
    // A file in controllers imports another file also in controllers
    const scans = [
      makeScan('controllers/a.ts', ['controllers/b']),
      makeScan('controllers/b.ts', []),
    ];
    expect(detectCircularDependencies(scans, LAYERS)).toEqual([]);
  });

  it('ignores files that match no layer', () => {
    const scans = [
      makeScan('random/thing.ts', ['other/stuff']),
    ];
    expect(detectCircularDependencies(scans, LAYERS)).toEqual([]);
  });

  it('returns empty array when layers list is empty', () => {
    const scans = [makeScan('controllers/ctrl.ts', ['services/svc'])];
    expect(detectCircularDependencies(scans, [])).toEqual([]);
  });

  it('handles a diamond-shaped DAG without false positives (cross-edge coverage)', () => {
    // controller → service, controller → repository, service → repository
    // repository is reachable from two paths; not a cycle
    const FOUR_LAYERS = ['controller', 'service', 'repository', 'gateway'];
    const scans = [
      makeScan('controllers/ctrl.ts', ['services/svc', 'repositories/repo']),
      makeScan('services/svc.ts', ['repositories/repo']),
      makeScan('repositories/repo.ts', []),
    ];
    expect(detectCircularDependencies(scans, FOUR_LAYERS)).toEqual([]);
  });
});
