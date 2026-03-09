/**
 * Represents the parsed structure of a .context.yml file.
 */
export interface ContextConfig {
  architecture: {
    layers: string[];
  };
  rules: Record<string, LayerRule>;
  /** Project-relative glob patterns for files to exclude from scanning. */
  exclude?: string[];
}

/**
 * Rules applied to a single layer.
 * Use cannot_import OR can_only_import — they are mutually exclusive.
 */
export interface LayerRule {
  /** Blacklist: this layer must not import from any listed layer. */
  cannot_import?: string[];
  /** Whitelist: this layer may only import from listed layers. Any other layer import is a violation. */
  can_only_import?: string[];
  /** Optional file glob (project-relative). Rule only applies to source files matching this pattern. */
  files?: string;
}

/**
 * A single import found in a scanned file.
 * importPath is project-relative (e.g. "repositories/orderRepository").
 * rawSpecifier is the original string in the source (e.g. "../repositories/orderRepository").
 */
export interface ImportInfo {
  file: string;
  importPath: string;
  rawSpecifier: string;
  /** Normalised rule strings suppressed via // arch-ignore: comments on the preceding line. */
  archIgnore: string[];
}

/**
 * The result of scanning a single TypeScript file.
 */
export interface FileScan {
  file: string;
  layer: string | null;
  imports: ImportInfo[];
}

/**
 * A detected architecture rule violation.
 */
export interface Violation {
  file: string;
  importPath: string;
  rawSpecifier: string;
  sourceLayer: string;
  targetLayer: string;
  rule: string;
}

/** Options passed from the CLI to the scan pipeline. */
export interface ScanOptions {
  format: 'text' | 'json';
  /** Fail and report files that do not belong to any declared layer. */
  strict: boolean;
  /** Suppress informational output; only print violations. */
  quiet: boolean;
}

/** Aggregated result returned by the rule engine. */
export interface RuleCheckResult {
  violations: Violation[];
  /** Populated only in strict mode: files whose directory matches no layer. */
  unclassifiedFiles: string[];
  /** Number of violations per layer name. */
  violationsByLayer: Record<string, number>;
}
