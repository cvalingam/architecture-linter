import { ContextConfig } from './types';

/**
 * Built-in preset rule packs. Each preset declares a suggested layer set and a
 * default set of rules. User config always takes precedence over preset rules.
 *
 * Supported presets:
 *   - nestjs             Standard NestJS module structure
 *   - clean-architecture Uncle Bob's Clean Architecture
 *   - hexagonal          Ports & Adapters (Hexagonal Architecture)
 *   - nextjs             Next.js file-system routing structure
 */
export const PRESETS: Record<string, Partial<ContextConfig>> = {
  'nestjs': {
    architecture: {
      layers: [
        'module', 'controller', 'service', 'schema',
        'dto', 'utils', 'guard', 'decorator', 'filter', 'interceptor', 'pipe',
      ],
    },
    rules: {
      // Controllers handle HTTP only — no direct DB access, no cross-controller imports
      controller:  { cannot_import: ['schema', 'controller'] },
      // Services orchestrate logic — must not depend on HTTP layer
      service:     { cannot_import: ['controller'] },
      // Utils must stay pure — no business logic or HTTP concerns
      utils:       { cannot_import: ['service', 'controller'] },
      // Cross-cutting infrastructure layers must not touch DB models directly
      guard:       { cannot_import: ['schema'] },
      interceptor: { cannot_import: ['schema'] },
      pipe:        { cannot_import: ['schema'] },
    },
  },

  'clean-architecture': {
    architecture: {
      layers: ['controller', 'usecase', 'repository', 'entity', 'infrastructure'],
    },
    rules: {
      // Inner layers must never know about outer layers
      entity:         { can_only_import: [] },
      usecase:        { cannot_import: ['controller', 'infrastructure'] },
      controller:     { cannot_import: ['repository', 'infrastructure'] },
      infrastructure: { cannot_import: ['controller'] },
    },
  },

  'hexagonal': {
    architecture: {
      layers: ['adapter', 'port', 'domain', 'application', 'infrastructure'],
    },
    rules: {
      // Domain must be framework-agnostic and free of outward dependencies
      domain:      { can_only_import: [] },
      application: { cannot_import: ['adapter', 'infrastructure'] },
    },
  },

  'nextjs': {
    architecture: {
      layers: ['page', 'component', 'hook', 'lib', 'api', 'model', 'store'],
    },
    rules: {
      // Pages and components must not call API routes directly
      page:      { cannot_import: ['api'] },
      component: { cannot_import: ['api'] },
    },
  },
};

/**
 * Merges one or more named presets into the user's config.
 * Presets are applied left-to-right; later presets override earlier ones.
 * User-supplied layers and rules always take final precedence.
 *
 * Throws if an unknown preset name is referenced.
 */
export function resolvePresets(config: ContextConfig): ContextConfig {
  const extendsValue = config.extends;
  if (!extendsValue) return config;

  const presetNames = Array.isArray(extendsValue) ? extendsValue : [extendsValue];

  // Build an accumulated preset by merging all requested presets in order
  let accumulated: Partial<ContextConfig> = {};

  for (const name of presetNames) {
    const preset = PRESETS[name];
    if (!preset) {
      const available = Object.keys(PRESETS).join(', ');
      throw new Error(
        `Unknown preset: "${name}".\nAvailable presets: ${available}\n` +
        'Check the "extends" field in your .context.yml.'
      );
    }

    // all built-in presets define both architecture.layers and rules; ?? fallbacks are defensive
    /* istanbul ignore next */
    const accLayers = accumulated.architecture?.layers ?? [];
    /* istanbul ignore next */
    const presetLayers = preset.architecture?.layers ?? [];
    /* istanbul ignore next */
    const accRules = accumulated.rules ?? {};
    /* istanbul ignore next */
    const presetRules = preset.rules ?? {};

    accumulated = {
      ...accumulated,
      ...preset,
      architecture: {
        layers: dedupe([...accLayers, ...presetLayers]),
      },
      rules: {
        ...accRules,
        ...presetRules,
      },
    };
  }

  // User config takes full precedence: merge user on top of accumulated preset
  // accumulated always has layers/rules (loop ran ≥ once); config properties are required by type
  /* istanbul ignore next */
  const finalAccLayers = accumulated.architecture?.layers ?? [];
  /* istanbul ignore next */
  const finalAccRules = accumulated.rules ?? {};
  /* istanbul ignore next */
  const userLayers = config.architecture?.layers ?? [];
  /* istanbul ignore next */
  const userRules = config.rules ?? {};
  return {
    ...accumulated,
    ...config,
    architecture: {
      layers: dedupe([...finalAccLayers, ...userLayers]),
    },
    rules: {
      ...finalAccRules,
      ...userRules,
    },
  };
}

function dedupe<T>(arr: T[]): T[] {
  return arr.filter((v, i, a) => a.indexOf(v) === i);
}
