import { resolvePresets, PRESETS } from '../presets';
import { ContextConfig } from '../types';

// ── helpers ───────────────────────────────────────────────────────────────────

const emptyConfig = (): ContextConfig => ({
  architecture: { layers: [] },
  rules: {},
});

// ── no extends ────────────────────────────────────────────────────────────────

describe('resolvePresets - no extends', () => {
  it('returns the same config object when extends is absent', () => {
    const config: ContextConfig = { architecture: { layers: ['controller'] }, rules: {} };
    expect(resolvePresets(config)).toBe(config);
  });
});

// ── nestjs preset ─────────────────────────────────────────────────────────────

describe('resolvePresets - nestjs preset', () => {
  it('merges nestjs layers into user config', () => {
    const result = resolvePresets({ ...emptyConfig(), extends: 'nestjs' });
    expect(result.architecture.layers).toContain('controller');
    expect(result.architecture.layers).toContain('service');
    expect(result.architecture.layers).toContain('schema');
    expect(result.architecture.layers).toContain('utils');
    expect(result.architecture.layers).toContain('guard');
    expect(result.architecture.layers).toContain('dto');
    expect(result.architecture.layers).toContain('filter');
  });

  it('controller cannot import schema (must go through service)', () => {
    const result = resolvePresets({ ...emptyConfig(), extends: 'nestjs' });
    expect(result.rules?.controller?.cannot_import).toContain('schema');
  });

  it('controller cannot import another controller (no cross-module coupling)', () => {
    const result = resolvePresets({ ...emptyConfig(), extends: 'nestjs' });
    expect(result.rules?.controller?.cannot_import).toContain('controller');
  });

  it('service cannot import controller (no reverse dependency)', () => {
    const result = resolvePresets({ ...emptyConfig(), extends: 'nestjs' });
    expect(result.rules?.service?.cannot_import).toContain('controller');
  });

  it('utils cannot import service or controller (must stay pure)', () => {
    const result = resolvePresets({ ...emptyConfig(), extends: 'nestjs' });
    expect(result.rules?.utils?.cannot_import).toContain('service');
    expect(result.rules?.utils?.cannot_import).toContain('controller');
  });

  it('guard/interceptor/pipe cannot import schema directly', () => {
    const result = resolvePresets({ ...emptyConfig(), extends: 'nestjs' });
    expect(result.rules?.guard?.cannot_import).toContain('schema');
    expect(result.rules?.interceptor?.cannot_import).toContain('schema');
    expect(result.rules?.pipe?.cannot_import).toContain('schema');
  });
});

// ── clean-architecture preset ────────────────────────────────────────────────

describe('resolvePresets - clean-architecture preset', () => {
  it('contains entity, usecase, infrastructure layers', () => {
    const result = resolvePresets({ ...emptyConfig(), extends: 'clean-architecture' });
    expect(result.architecture.layers).toContain('entity');
    expect(result.architecture.layers).toContain('usecase');
    expect(result.architecture.layers).toContain('infrastructure');
  });

  it('entity layer has empty can_only_import (no dependencies)', () => {
    const result = resolvePresets({ ...emptyConfig(), extends: 'clean-architecture' });
    expect(result.rules?.entity?.can_only_import).toEqual([]);
  });
});

// ── hexagonal preset ──────────────────────────────────────────────────────────

describe('resolvePresets - hexagonal preset', () => {
  it('contains domain, port, adapter, application layers', () => {
    const result = resolvePresets({ ...emptyConfig(), extends: 'hexagonal' });
    expect(result.architecture.layers).toContain('domain');
    expect(result.architecture.layers).toContain('port');
    expect(result.architecture.layers).toContain('adapter');
    expect(result.architecture.layers).toContain('application');
  });

  it('domain layer has empty can_only_import', () => {
    const result = resolvePresets({ ...emptyConfig(), extends: 'hexagonal' });
    expect(result.rules?.domain?.can_only_import).toEqual([]);
  });
});

// ── nextjs preset ─────────────────────────────────────────────────────────────

describe('resolvePresets - nextjs preset', () => {
  it('contains page, component, hook, lib, api layers', () => {
    const result = resolvePresets({ ...emptyConfig(), extends: 'nextjs' });
    expect(result.architecture.layers).toContain('page');
    expect(result.architecture.layers).toContain('component');
    expect(result.architecture.layers).toContain('api');
  });

  it('page and component cannot import api', () => {
    const result = resolvePresets({ ...emptyConfig(), extends: 'nextjs' });
    expect(result.rules?.page?.cannot_import).toContain('api');
    expect(result.rules?.component?.cannot_import).toContain('api');
  });
});

// ── all presets ───────────────────────────────────────────────────────────────

describe('resolvePresets - all presets', () => {
  it('every exported preset resolves without errors', () => {
    for (const name of Object.keys(PRESETS)) {
      expect(() =>
        resolvePresets({ ...emptyConfig(), extends: name }),
      ).not.toThrow();
    }
  });
});

// ── merging behaviour ─────────────────────────────────────────────────────────

describe('resolvePresets - merging', () => {
  it('user layers are merged with preset layers', () => {
    const config: ContextConfig = {
      ...emptyConfig(),
      extends: 'nestjs',
      architecture: { layers: ['custom-layer'] },
    };
    const result = resolvePresets(config);
    expect(result.architecture.layers).toContain('custom-layer');
    expect(result.architecture.layers).toContain('controller');
  });

  it('user rules override matching preset rules', () => {
    const config: ContextConfig = {
      ...emptyConfig(),
      extends: 'nestjs',
      rules: { controller: { cannot_import: [] } }, // user allows everything
    };
    expect(resolvePresets(config).rules.controller?.cannot_import).toEqual([]);
  });

  it('deduplicates layers present in both preset and user config', () => {
    const config: ContextConfig = {
      ...emptyConfig(),
      extends: 'nestjs',
      architecture: { layers: ['controller'] }, // 'controller' already in nestjs
    };
    const result = resolvePresets(config);
    const count = result.architecture.layers.filter(l => l === 'controller').length;
    expect(count).toBe(1);
  });

  it('supports an array for extends', () => {
    const result = resolvePresets({ ...emptyConfig(), extends: ['nestjs'] });
    expect(result.architecture.layers).toContain('controller');
  });

  it('merges multiple presets in order when extends is an array', () => {
    const result = resolvePresets({
      ...emptyConfig(),
      extends: ['nestjs', 'clean-architecture'],
    });
    expect(result.architecture.layers).toContain('controller'); // from nestjs
    expect(result.architecture.layers).toContain('usecase');   // from clean-architecture
  });
});

// ── error handling ────────────────────────────────────────────────────────────

describe('resolvePresets - errors', () => {
  it('throws with preset name quoted in message', () => {
    const config: ContextConfig = { ...emptyConfig(), extends: 'unknown-preset' };
    expect(() => resolvePresets(config)).toThrow(/"unknown-preset"/);
  });

  it('lists available presets in the error message', () => {
    const config: ContextConfig = { ...emptyConfig(), extends: 'bad' };
    expect(() => resolvePresets(config)).toThrow(/Available presets/);
  });
});
