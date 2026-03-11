import { minimatch } from 'minimatch';
import { ContextConfig, FileScan, RuleCheckResult, Violation } from './types';

/**
 * Returns the singular and plural directory-name candidates for a layer name.
 *   repository → ['repository', 'repositories']  (y → ies)
 *   service    → ['service',    'services']       (+ s)
 *   controller → ['controller', 'controllers']   (+ s)
 */
function pluralCandidates(layer: string): string[] {
  const lower = layer.toLowerCase();
  if (lower.endsWith('y')) {
    return [lower, lower.slice(0, -1) + 'ies'];
  }
  return [lower, lower + 's'];
}

function capitalise(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Determines which architectural layer a file or import path belongs to by
 * inspecting each directory segment (not the filename) for a layer name match.
 * Both singular and plural forms are recognised.
 *
 * Returns the first matching layer, or null if no match is found.
 */
export function detectLayer(filePath: string, layers: string[]): string | null {
  const directories = filePath.split('/').slice(0, -1);

  for (const layer of layers) {
    const candidates = pluralCandidates(layer);
    for (const dir of directories) {
      if (candidates.includes(dir.toLowerCase())) {
        return layer;
      }
    }
  }

  return null;
}

/**
 * Builds a short, actionable fix suggestion for a violation.
 *
 * For cannot_import violations: lists the layers the source IS allowed to import.
 * For can_only_import violations: lists the layers the source may legally import.
 */
function buildFixSuggestion(
  sourceLayer: string,
  targetLayer: string,
  config: ContextConfig,
): string {
  const rule = config.rules?.[sourceLayer];
  const allLayers = config.architecture.layers;

  if (rule?.cannot_import?.includes(targetLayer)) {
    const forbidden = new Set(rule.cannot_import);
    const allowed = allLayers.filter(l => l !== sourceLayer && !forbidden.has(l));
    if (allowed.length > 0) {
      return (
        `Instead of importing '${targetLayer}' directly, route through an allowed ` +
        `intermediary layer: ${allowed.map(l => `'${l}'`).join(' or ')}.`
      );
    }
    return `Remove the direct '${targetLayer}' import from '${sourceLayer}'.`;
  }

  if (rule?.can_only_import !== undefined) {
    if (rule.can_only_import.length > 0) {
      return (
        `'${sourceLayer}' may only import from: ` +
        `${rule.can_only_import.map(l => `'${l}'`).join(', ')}. ` +
        `Route through one of those layers instead.`
      );
    }
    return (
      `'${sourceLayer}' is not permitted to import from any other layer. ` +
      `Remove this import.`
    );
  }

  return `Review the architecture rules and remove or redirect this import.`;
}

/**
 * Runs all rules defined in the context config against the scanned files.
 *
 * Features supported:
 *  - cannot_import   blacklist: the layer must not import from listed layers.
 *  - can_only_import whitelist: the layer may only import from listed layers.
 *  - files           glob:      rule only applies to source files matching the pattern.
 *  - arch-ignore     inline comment on the import suppresses a specific violation.
 *  - strict          collects files that belong to no declared layer.
 *  - generateFix     when true, populates the `fix` field on each Violation.
 */
export function checkRules(
  scans: FileScan[],
  config: ContextConfig,
  strict = false,
  generateFix = false,
): RuleCheckResult {
  const violations: Violation[] = [];
  const unclassifiedFiles: string[] = [];
  const violationsByLayer: Record<string, number> = {};
  const layers = config.architecture.layers;

  // Initialise per-layer counters so every layer appears in the summary.
  for (const layer of layers) {
    violationsByLayer[layer] = 0;
  }

  for (const scan of scans) {
    const sourceLayer = detectLayer(scan.file, layers);

    if (!sourceLayer) {
      if (strict) unclassifiedFiles.push(scan.file);
      continue;
    }

    const layerRule = config.rules?.[sourceLayer];
    if (!layerRule) continue;

    // If the rule has a files pattern, only apply it to matching source files.
    if (layerRule.files && !minimatch(scan.file, layerRule.files)) {
      continue;
    }

    for (const importInfo of scan.imports) {
      const targetLayer = detectLayer(importInfo.importPath, layers);
      if (!targetLayer) continue;

      const ruleString = `${capitalise(sourceLayer)} cannot import ${capitalise(targetLayer)}`;

      // Respect arch-ignore inline comments on the preceding line.
      if (importInfo.archIgnore.some(hint => hint === ruleString.toLowerCase())) {
        continue;
      }

      let violated = false;

      // Blacklist check
      if (layerRule.cannot_import?.includes(targetLayer)) {
        violated = true;
      }

      // Whitelist check (only evaluated when cannot_import did not already flag it)
      if (!violated && layerRule.can_only_import !== undefined) {
        violated = !layerRule.can_only_import.includes(targetLayer);
      }

      if (violated) {
        const violation: Violation = {
          file: scan.file,
          importPath: importInfo.importPath,
          rawSpecifier: importInfo.rawSpecifier,
          sourceLayer,
          targetLayer,
          rule: ruleString,
        };

        if (generateFix) {
          violation.fix = buildFixSuggestion(sourceLayer, targetLayer, config);
        }

        violations.push(violation);
        violationsByLayer[sourceLayer] = (violationsByLayer[sourceLayer] ?? 0) + 1;
      }
    }
  }

  return { violations, unclassifiedFiles, violationsByLayer };
}
