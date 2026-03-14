import { calculateScore } from '../scorer';
import { ContextConfig, FileScan, RuleCheckResult } from '../types';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeConfig(
  layers: string[],
  rules: ContextConfig['rules'] = {},
): ContextConfig {
  return { architecture: { layers }, rules };
}

function makeScan(file: string, importCount: number, layer: string | null = null): FileScan {
  return {
    file,
    layer,
    imports: Array.from({ length: importCount }, (_, i) => ({
      file,
      importPath: `some/path${i}.ts`,
      rawSpecifier: `./path${i}`,
      archIgnore: [],
    })),
  };
}

function makeResult(
  violationCount: number,
  unclassifiedFiles: string[] = [],
): RuleCheckResult {
  return {
    violations: Array.from({ length: violationCount }, (_, i) => ({
      file: `file${i}.ts`,
      importPath: `bad/path${i}.ts`,
      rawSpecifier: `./bad${i}`,
      sourceLayer: 'controller',
      targetLayer: 'repository',
      rule: 'controller cannot_import repository',
    })),
    unclassifiedFiles,
    violationsByLayer: {},
    circularDeps: [],
  };
}

// ── calculateScore ────────────────────────────────────────────────────────────

describe('calculateScore', () => {
  describe('perfect score', () => {
    it('returns 100 when no violations, all files classified, all layers have rules', () => {
      const scans = [makeScan('controllers/a.ts', 5), makeScan('services/b.ts', 3)];
      const result = makeResult(0, []);
      const config = makeConfig(
        ['controller', 'service'],
        {
          controller: { cannot_import: ['repository'] },
          service: { cannot_import: ['controller'] },
        },
      );
      const s = calculateScore(scans, result, config);
      expect(s.score).toBe(100);
      expect(s.grade).toBe('A');
      expect(s.breakdown.violations).toBe(60);
      expect(s.breakdown.coverage).toBe(25);
      expect(s.breakdown.ruleCompleteness).toBe(15);
    });
  });

  describe('grade boundaries', () => {
    it('assigns grade A for score >= 90', () => {
      const scans = [makeScan('controllers/a.ts', 10)];
      const result = makeResult(0);
      const config = makeConfig(['controller'], { controller: { cannot_import: ['repository'] } });
      const s = calculateScore(scans, result, config);
      expect(s.grade).toBe('A');
    });

    it('assigns grade B for score >= 75', () => {
      // violation score: 0 violations / 4 imports → 60 pts
      // coverage score: 1 classified / 1 file → 25 pts
      // rule completeness: 1/2 layers with rules → ~7 pts  (total ~92 → A, bump to B range)
      // Use partial violation rate to land in B range
      const scans = [makeScan('controllers/a.ts', 8)];
      const result = makeResult(1); // 1/8 violation rate → 52.5 pts violation component → rounds to B
      const config = makeConfig(['controller', 'service'], { controller: { cannot_import: ['service'] } });
      const s = calculateScore(scans, result, config);
      expect(s.grade).toBe('B');
    });

    it('assigns grade C for score >= 60', () => {
      // violation score: 3/6 imports violated → 30 pts
      // coverage score: 1/1 files classified → 25 pts
      // rule completeness: 1/2 layers → 7.5 pts  → total ~62
      const scans = [makeScan('controllers/a.ts', 6)];
      const result = makeResult(3);
      const config = makeConfig(['controller', 'service'], { controller: { cannot_import: ['service'] } });
      const s = calculateScore(scans, result, config);
      expect(s.grade).toBe('C');
    });

    it('assigns grade D for score >= 40', () => {
      // violation score: 5/6 imports violated → ~10 pts
      // coverage score: 1/1 files classified → 25 pts
      // rule completeness: 1/2 layers → 7.5 pts  → total ~42
      const scans = [makeScan('controllers/a.ts', 6)];
      const result = makeResult(5);
      const config = makeConfig(['controller', 'service'], { controller: { cannot_import: ['service'] } });
      const s = calculateScore(scans, result, config);
      expect(s.grade).toBe('D');
    });

    it('assigns grade F for score < 40', () => {
      // all imports are violations, no rules, all files unclassified
      const scans = [makeScan('random/a.ts', 5)];
      const result = makeResult(5, ['random/a.ts']);
      const config = makeConfig(['controller', 'service'], {});
      const s = calculateScore(scans, result, config);
      expect(s.grade).toBe('F');
      expect(s.score).toBeLessThan(40);
    });
  });

  describe('violation density component', () => {
    it('gives 60 pts when there are no imports', () => {
      const scans = [makeScan('controllers/a.ts', 0)];
      const result = makeResult(0);
      const config = makeConfig(['controller'], { controller: { cannot_import: [] } });
      const s = calculateScore(scans, result, config);
      expect(s.breakdown.violations).toBe(60);
    });

    it('reduces violation pts proportionally', () => {
      const scans = [makeScan('controllers/a.ts', 10)];
      const result = makeResult(5); // 50% violation rate
      const config = makeConfig(['controller'], { controller: { cannot_import: ['service'] } });
      const s = calculateScore(scans, result, config);
      expect(s.breakdown.violations).toBe(30); // 50% of 60
    });

    it('clamps violation pts to 0 (never negative)', () => {
      const scans = [makeScan('controllers/a.ts', 3)];
      const result = makeResult(10); // more violations than imports (edge case)
      const config = makeConfig(['controller'], {});
      const s = calculateScore(scans, result, config);
      expect(s.breakdown.violations).toBe(0);
    });
  });

  describe('layer coverage component', () => {
    it('gives 25 pts when all files are classified', () => {
      const scans = [makeScan('controllers/a.ts', 2)];
      const result = makeResult(0, []);
      const config = makeConfig(['controller'], {});
      const s = calculateScore(scans, result, config);
      expect(s.breakdown.coverage).toBe(25);
    });

    it('gives 0 pts when all files are unclassified', () => {
      const scans = [makeScan('random/a.ts', 2)];
      const result = makeResult(0, ['random/a.ts']);
      const config = makeConfig(['controller'], {});
      const s = calculateScore(scans, result, config);
      expect(s.breakdown.coverage).toBe(0);
    });

    it('gives 25 pts when no files scanned', () => {
      const s = calculateScore([], makeResult(0), makeConfig(['controller'], {}));
      expect(s.breakdown.coverage).toBe(25);
    });
  });

  describe('rule completeness component', () => {
    it('gives 15 pts when all layers have rules', () => {
      const scans = [makeScan('controllers/a.ts', 1)];
      const result = makeResult(0);
      const config = makeConfig(
        ['controller', 'service'],
        {
          controller: { cannot_import: ['repository'] },
          service: { can_only_import: ['repository'] },
        },
      );
      const s = calculateScore(scans, result, config);
      expect(s.breakdown.ruleCompleteness).toBe(15);
    });

    it('gives partial pts when only some layers have rules', () => {
      const scans = [makeScan('controllers/a.ts', 1)];
      const result = makeResult(0);
      const config = makeConfig(
        ['controller', 'service'],
        { controller: { cannot_import: ['repository'] } },
      );
      const s = calculateScore(scans, result, config);
      expect(s.breakdown.ruleCompleteness).toBe(8); // round(7.5) = 8
    });

    it('gives 15 pts when there are no layers (edge case)', () => {
      const s = calculateScore([], makeResult(0), makeConfig([], {}));
      expect(s.breakdown.ruleCompleteness).toBe(15);
    });

    it('counts can_only_import: [] as a defined rule', () => {
      const config = makeConfig(['controller'], { controller: { can_only_import: [] } });
      const s = calculateScore([], makeResult(0), config);
      expect(s.breakdown.ruleCompleteness).toBe(15);
    });

    it('does not count a layer with empty cannot_import as having a rule', () => {
      const config = makeConfig(['controller'], { controller: { cannot_import: [] } });
      const s = calculateScore([], makeResult(0), config);
      expect(s.breakdown.ruleCompleteness).toBe(0);
    });
  });

  describe('stats', () => {
    it('populates stats correctly', () => {
      const scans = [
        makeScan('controllers/a.ts', 3),
        makeScan('services/b.ts', 2),
        makeScan('random/c.ts', 1),
      ];
      const result = makeResult(1, ['random/c.ts']);
      const config = makeConfig(
        ['controller', 'service'],
        { controller: { cannot_import: ['repository'] } },
      );
      const s = calculateScore(scans, result, config);
      expect(s.stats.filesScanned).toBe(3);
      expect(s.stats.totalImports).toBe(6);
      expect(s.stats.violationCount).toBe(1);
      expect(s.stats.classifiedFiles).toBe(2);
      expect(s.stats.unclassifiedFiles).toBe(1);
      expect(s.stats.layersWithRules).toBe(1);
      expect(s.stats.totalLayers).toBe(2);
    });
  });

  describe('score cap', () => {
    it('never exceeds 100', () => {
      const scans = [makeScan('controllers/a.ts', 5)];
      const result = makeResult(0);
      const config = makeConfig(['controller'], { controller: { cannot_import: ['repository'] } });
      const s = calculateScore(scans, result, config);
      expect(s.score).toBeLessThanOrEqual(100);
    });
  });
});
