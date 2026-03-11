import { checkRules, detectLayer } from '../ruleEngine';
import { ContextConfig, FileScan } from '../types';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeImport(source: string, importPath: string, archIgnore: string[] = []) {
  return { file: source, importPath, rawSpecifier: importPath, archIgnore };
}

function makeScan(file: string, imports: ReturnType<typeof makeImport>[]): FileScan {
  return { file, layer: null, imports };
}

// ── detectLayer ───────────────────────────────────────────────────────────────

describe('detectLayer', () => {
  const layers = ['controller', 'service', 'repository'];

  it('detects layer from singular directory name', () => {
    expect(detectLayer('controller/order.ts', layers)).toBe('controller');
  });

  it('detects layer from plural directory name (+s)', () => {
    expect(detectLayer('controllers/order.ts', layers)).toBe('controller');
    expect(detectLayer('services/order.ts', layers)).toBe('service');
  });

  it('handles y → ies pluralisation', () => {
    expect(detectLayer('repositories/repo.ts', layers)).toBe('repository');
  });

  it('returns null when no layer matches', () => {
    expect(detectLayer('utils/helper.ts', layers)).toBeNull();
    expect(detectLayer('index.ts', layers)).toBeNull();
  });

  it('matches directory segment, not filename', () => {
    // filename contains "controller" but the directory does not
    expect(detectLayer('utils/myController.ts', layers)).toBeNull();
  });

  it('matches a layer in a deeply nested path', () => {
    expect(detectLayer('src/controllers/order/orderController.ts', layers)).toBe('controller');
  });
});

// ── checkRules - cannot_import ────────────────────────────────────────────────

describe('checkRules - cannot_import', () => {
  const config: ContextConfig = {
    architecture: { layers: ['controller', 'service', 'repository'] },
    rules: { controller: { cannot_import: ['repository'] } },
  };

  it('reports a violation when controller imports repository', () => {
    const scans = [makeScan('controllers/order.ts', [makeImport('controllers/order.ts', 'repositories/repo.ts')])];
    const result = checkRules(scans, config);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].sourceLayer).toBe('controller');
    expect(result.violations[0].targetLayer).toBe('repository');
    expect(result.violations[0].rule).toMatch(/Controller cannot import Repository/i);
  });

  it('does not report a violation when controller imports service (allowed)', () => {
    const scans = [makeScan('controllers/order.ts', [makeImport('controllers/order.ts', 'services/svc.ts')])];
    expect(checkRules(scans, config).violations).toHaveLength(0);
  });

  it('does not report a violation when no rule covers that layer', () => {
    // service has no rule defined
    const scans = [makeScan('services/order.ts', [makeImport('services/order.ts', 'repositories/repo.ts')])];
    expect(checkRules(scans, config).violations).toHaveLength(0);
  });

  it('suppresses violation when arch-ignore comment matches rule string', () => {
    const scans = [
      makeScan('controllers/order.ts', [
        makeImport('controllers/order.ts', 'repositories/repo.ts', ['controller cannot import repository']),
      ]),
    ];
    expect(checkRules(scans, config).violations).toHaveLength(0);
  });

  it('does not suppress violation when arch-ignore text does not match', () => {
    const scans = [
      makeScan('controllers/order.ts', [
        makeImport('controllers/order.ts', 'repositories/repo.ts', ['controller cannot import service']),
      ]),
    ];
    expect(checkRules(scans, config).violations).toHaveLength(1);
  });
});

// ── checkRules - can_only_import ──────────────────────────────────────────────

describe('checkRules - can_only_import', () => {
  const config: ContextConfig = {
    architecture: { layers: ['controller', 'service', 'repository'] },
    rules: { controller: { can_only_import: ['service'] } },
  };

  it('reports a violation when controller imports a layer not in the whitelist', () => {
    const scans = [makeScan('controllers/order.ts', [makeImport('controllers/order.ts', 'repositories/repo.ts')])];
    expect(checkRules(scans, config).violations).toHaveLength(1);
  });

  it('does not report a violation when controller imports an allowed layer', () => {
    const scans = [makeScan('controllers/order.ts', [makeImport('controllers/order.ts', 'services/svc.ts')])];
    expect(checkRules(scans, config).violations).toHaveLength(0);
  });

  it('reports violation when importing any layer from an empty whitelist', () => {
    const strictConfig: ContextConfig = {
      architecture: { layers: ['entity', 'service'] },
      rules: { entity: { can_only_import: [] } },
    };
    const scans = [makeScan('entity/order.ts', [makeImport('entity/order.ts', 'services/svc.ts')])];
    expect(checkRules(scans, strictConfig).violations).toHaveLength(1);
  });
});

// ── checkRules - files glob scoping ──────────────────────────────────────────

describe('checkRules - files glob', () => {
  const config: ContextConfig = {
    architecture: { layers: ['controller', 'repository'] },
    rules: {
      controller: {
        files: 'controllers/admin/**',
        cannot_import: ['repository'],
      },
    },
  };

  it('applies rule only to files matching the glob', () => {
    // This file does NOT match controllers/admin/**, so the rule should not fire
    const scans = [
      makeScan('controllers/orderController.ts', [
        makeImport('controllers/orderController.ts', 'repositories/repo.ts'),
      ]),
    ];
    expect(checkRules(scans, config).violations).toHaveLength(0);
  });

  it('applies rule to files that DO match the glob', () => {
    const scans = [
      makeScan('controllers/admin/adminController.ts', [
        makeImport('controllers/admin/adminController.ts', 'repositories/repo.ts'),
      ]),
    ];
    expect(checkRules(scans, config).violations).toHaveLength(1);
  });
});

// ── checkRules - strict mode ──────────────────────────────────────────────────

describe('checkRules - strict mode', () => {
  const config: ContextConfig = {
    architecture: { layers: ['controller', 'service'] },
    rules: {},
  };

  it('adds unclassified files when strict is true', () => {
    const scans = [makeScan('utils/helper.ts', [])];
    const result = checkRules(scans, config, true);
    expect(result.unclassifiedFiles).toContain('utils/helper.ts');
  });

  it('does not add unclassified files when strict is false', () => {
    const scans = [makeScan('utils/helper.ts', [])];
    expect(checkRules(scans, config, false).unclassifiedFiles).toHaveLength(0);
  });

  it('does not list classified files as unclassified', () => {
    const scans = [makeScan('controllers/order.ts', [])];
    expect(checkRules(scans, config, true).unclassifiedFiles).toHaveLength(0);
  });
});

// ── checkRules - generateFix ──────────────────────────────────────────────────

describe('checkRules - generateFix', () => {
  const config: ContextConfig = {
    architecture: { layers: ['controller', 'service', 'repository'] },
    rules: { controller: { cannot_import: ['repository'] } },
  };

  const scan = [
    makeScan('controllers/order.ts', [makeImport('controllers/order.ts', 'repositories/repo.ts')]),
  ];

  it('does not populate fix field when generateFix is false', () => {
    const result = checkRules(scan, config, false, false);
    expect(result.violations[0].fix).toBeUndefined();
  });

  it('populates fix field with a string when generateFix is true', () => {
    const result = checkRules(scan, config, false, true);
    expect(typeof result.violations[0].fix).toBe('string');
    expect(result.violations[0].fix!.length).toBeGreaterThan(0);
  });

  it('fix message mentions the allowed intermediary layer', () => {
    const result = checkRules(scan, config, false, true);
    expect(result.violations[0].fix).toContain("'service'");
  });

  it('fix message for can_only_import lists the allowed layers', () => {
    const canOnlyConfig: ContextConfig = {
      architecture: { layers: ['controller', 'service', 'repository'] },
      rules: { controller: { can_only_import: ['service'] } },
    };
    const result = checkRules(scan, canOnlyConfig, false, true);
    expect(result.violations[0].fix).toContain("'service'");
  });
});

// ── checkRules - violationsByLayer ────────────────────────────────────────────

describe('checkRules - violationsByLayer', () => {
  const config: ContextConfig = {
    architecture: { layers: ['controller', 'service', 'repository'] },
    rules: { controller: { cannot_import: ['repository'] } },
  };

  it('initialises every layer with zero count', () => {
    const result = checkRules([], config);
    expect(result.violationsByLayer).toEqual({ controller: 0, service: 0, repository: 0 });
  });

  it('increments count for the source layer on each violation', () => {
    const scans = [
      makeScan('controllers/a.ts', [makeImport('controllers/a.ts', 'repositories/r.ts')]),
      makeScan('controllers/b.ts', [makeImport('controllers/b.ts', 'repositories/r.ts')]),
    ];
    const result = checkRules(scans, config);
    expect(result.violationsByLayer.controller).toBe(2);
    expect(result.violationsByLayer.service).toBe(0);
    expect(result.violationsByLayer.repository).toBe(0);
  });
});
