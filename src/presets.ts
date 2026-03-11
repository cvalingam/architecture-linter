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
        'module', 'controller', 'service', 'repository',
        'guard', 'interceptor', 'pipe', 'decorator', 'dto', 'entity',
      ],
    },
    rules: {
      controller: { cannot_import: ['repository', 'entity'] },
      guard:       { cannot_import: ['repository'] },
      interceptor: { cannot_import: ['repository'] },
      pipe:        { cannot_import: ['repository'] },
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

    accumulated = {
      ...accumulated,
      ...preset,
      architecture: {
        layers: dedupe([
          ...(accumulated.architecture?.layers ?? []),
          ...(preset.architecture?.layers ?? []),
        ]),
      },
      rules: {
        ...(accumulated.rules ?? {}),
        ...(preset.rules ?? {}),
      },
    };
  }

  // User config takes full precedence: merge user on top of accumulated preset
  return {
    ...accumulated,
    ...config,
    architecture: {
      layers: dedupe([
        ...(accumulated.architecture?.layers ?? []),
        ...(config.architecture?.layers ?? []),
      ]),
    },
    rules: {
      ...(accumulated.rules ?? {}),
      ...(config.rules ?? {}),
    },
  };
}

function dedupe<T>(arr: T[]): T[] {
  return arr.filter((v, i, a) => a.indexOf(v) === i);
}
