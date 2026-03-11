import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ContextConfig } from './types';
import { resolvePresets } from './presets';

/**
 * Walks up the directory tree from startDir looking for a .context.yml file.
 * Returns the absolute path if found, or null if the filesystem root is reached.
 */
export function findContextFile(startDir: string): string | null {
  let current = path.resolve(startDir);
  const { root } = path.parse(current);

  while (true) {
    const candidate = path.join(current, '.context.yml');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    if (current === root) {
      return null;
    }
    current = path.dirname(current);
  }
}

/**
 * Loads and validates a .context.yml file from the given path.
 * Throws a descriptive error if the file is missing or malformed.
 */
export function loadContextConfig(contextPath: string): ContextConfig {
  if (!fs.existsSync(contextPath)) {
    throw new Error(`Context file not found: ${contextPath}\nExpected a .context.yml file at this path.`);
  }

  const content = fs.readFileSync(contextPath, 'utf-8');
  let raw: unknown;

  try {
    raw = yaml.load(content);
  } catch (err) {
    throw new Error(`Failed to parse context file: ${(err as Error).message}`);
  }

  const config = raw as ContextConfig;

  if (!config?.architecture?.layers || !Array.isArray(config.architecture.layers)) {
    // Allow missing/empty layers when a preset via `extends` will supply them
    if (!config?.extends) {
      throw new Error(
        'Invalid context file: "architecture.layers" must be a non-empty array.\n' +
          'Example:\n\narchitecture:\n  layers:\n    - controller\n    - service\n    - repository'
      );
    }
    // Set empty array so resolvePresets can merge preset layers in
    if (!config.architecture) config.architecture = { layers: [] };
    if (!config.architecture.layers) config.architecture.layers = [];
  }

  // Resolve any preset extensions declared via the `extends` field.
  // This merges preset layers + rules BEFORE returning, with user config taking precedence.
  const resolved = resolvePresets(config);

  if (!resolved.architecture.layers || resolved.architecture.layers.length === 0) {
    throw new Error('Invalid context file: "architecture.layers" must contain at least one layer.');
  }

  return resolved;
}
