import fs from 'fs';
import path from 'path';

/**
 * A resolved alias map where each key is an alias prefix (e.g. '@repositories')
 * and each value is the absolute path to the corresponding directory on disk.
 */
export interface AliasMap {
  [prefix: string]: string;
}

/**
 * Reads tsconfig.json from the project root and extracts compilerOptions.paths
 * entries, resolving them relative to compilerOptions.baseUrl (or the project root).
 *
 * Handles tsconfig files that contain // line comments (which TypeScript allows).
 *
 * Returns an empty map if tsconfig.json is absent or cannot be parsed.
 */
export function loadTsConfigAliases(projectDir: string): AliasMap {
  const tsconfigPath = path.join(projectDir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    return {};
  }

  try {
    // tsconfig allows JS-style comments — strip them before JSON.parse
    // Also strip UTF-8 BOM which some editors/tools prepend
    const raw = fs
      .readFileSync(tsconfigPath, 'utf-8')
      .replace(/^\ufeff/, '')              // strip UTF-8 BOM
      .replace(/\/\/[^\n]*/g, '')          // strip // comments
      .replace(/\/\*[\s\S]*?\*\//g, '');   // strip /* */ block comments

    const parsed = JSON.parse(raw);
    const opts: Record<string, unknown> = parsed?.compilerOptions ?? {};
    const baseUrl = typeof opts.baseUrl === 'string'
      ? path.resolve(projectDir, opts.baseUrl)
      : projectDir;

    const pathsMap = (opts.paths ?? {}) as Record<string, string[]>;
    const aliases: AliasMap = {};

    for (const [alias, targets] of Object.entries(pathsMap)) {
      if (!Array.isArray(targets) || targets.length === 0) continue;

      // Strip trailing /* wildcard from both alias prefix and target path
      const normalizedAlias = alias.endsWith('/*') ? alias.slice(0, -2) : alias;
      const firstTarget = targets[0];
      const normalizedTarget = firstTarget.endsWith('/*')
        ? firstTarget.slice(0, -2)
        : firstTarget;

      aliases[normalizedAlias] = path.resolve(baseUrl, normalizedTarget);
    }

    return aliases;
  } catch {
    // Malformed tsconfig — fail silently; user will see unresolved aliases flagged as unclassified
    return {};
  }
}

/**
 * Merges tsconfig-derived aliases with any manual aliases declared in .context.yml.
 * Manual aliases take precedence over tsconfig aliases.
 *
 * @param tsconfigAliases  Aliases loaded from tsconfig.json
 * @param configAliases    Aliases from the `aliases:` field in .context.yml (project-relative dirs)
 * @param projectDir       Absolute path to the project root (used to resolve configAliases)
 */
export function mergeAliases(
  tsconfigAliases: AliasMap,
  configAliases: Record<string, string> | undefined,
  projectDir: string,
): AliasMap {
  const result: AliasMap = { ...tsconfigAliases };

  if (configAliases) {
    for (const [prefix, relativeDir] of Object.entries(configAliases)) {
      result[prefix] = path.resolve(projectDir, relativeDir);
    }
  }

  return result;
}

/**
 * Attempts to resolve a bare (non-relative) import specifier using the alias map.
 *
 * Returns a project-relative forward-slash path on success, or null if the specifier
 * does not match any known alias (e.g. it's a node_modules package).
 *
 * @param specifier   The raw import string (e.g. '@repositories/orderRepo')
 * @param aliases     The merged alias map
 * @param projectDir  Absolute path to the project root
 */
export function resolveAlias(
  specifier: string,
  aliases: AliasMap,
  projectDir: string,
): string | null {
  for (const [prefix, absoluteTarget] of Object.entries(aliases)) {
    if (specifier === prefix || specifier.startsWith(prefix + '/')) {
      const rest = specifier.slice(prefix.length); // includes leading '/' if present
      const absoluteResolved = absoluteTarget + rest;
      return path.relative(projectDir, absoluteResolved).replace(/\\/g, '/');
    }
  }
  return null;
}
