#!/usr/bin/env node
/**
 * architecture-linter CLI
 *
 * Commands:
 *   scan   Scan the project for architecture violations
 *   init   Generate a starter .context.yml from the project's folder structure
 *   ci     Generate a CI workflow file for architecture linting
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { findContextFile, loadContextConfig } from './contextParser';
import { scanProject } from './dependencyScanner';
import { explain } from './explainer';
import { checkRules } from './ruleEngine';
import { loadTsConfigAliases, mergeAliases } from './aliasResolver';
import { RuleCheckResult, ScanOptions } from './types';

const program = new Command();

program
  .name('architecture-linter')
  .description('Enforce architecture rules in TypeScript projects')
  .version('0.1.0');

// ── scan ──────────────────────────────────────────────────────────────────────

program
  .command('scan')
  .description('Scan the project for architecture violations')
  .option('-c, --context <path>', 'path to the .context.yml config file (auto-detected if omitted)')
  .option('-p, --project <path>', 'root directory of the project to scan', '.')
  .option('-f, --format <format>', 'output format: text or json', 'text')
  .option('-s, --strict', 'report files that do not belong to any declared layer', false)
  .option('-q, --quiet', 'suppress informational output; only print violations', false)
  .option('-e, --explain', 'print why/impact/fix explanation for each violation', false)
  .option('-x, --fix', 'show a suggested fix for each violation', false)
  .option('-w, --watch', 'watch for file changes and re-run the scan automatically', false)
  .action(async (options: {
    context?: string;
    project: string;
    format: string;
    strict: boolean;
    quiet: boolean;
    explain: boolean;
    fix: boolean;
    watch: boolean;
  }) => {
    const projectDir = path.resolve(options.project);
    const format = (options.format === 'json' ? 'json' : 'text') as 'text' | 'json';
    const opts: ScanOptions = {
      format,
      strict: options.strict,
      quiet: options.quiet,
      explain: options.explain,
      fix: options.fix,
      watch: options.watch,
    };

    // Resolve config: explicit flag → auto-detect walking up from project dir → error
    let contextPath: string;
    if (options.context) {
      contextPath = path.resolve(options.context);
    } else {
      const found = findContextFile(projectDir);
      if (!found) {
        console.error(
          chalk.red(
            'Error: No .context.yml found.\n' +
              'Run "architecture-linter init" to generate one, or pass --context <path>.'
          )
        );
        process.exit(1);
      }
      contextPath = found;
    }

    // Load config once (presets resolved inside loadContextConfig)
    let config;
    try {
      config = loadContextConfig(contextPath);
    } catch (err) {
      console.error(chalk.red(`Error loading config: ${(err as Error).message}`));
      process.exit(1);
    }

    // Build alias map: tsconfig.json paths + manual aliases from .context.yml
    const tsconfigAliases = loadTsConfigAliases(projectDir);
    const aliases = mergeAliases(tsconfigAliases, config.aliases, projectDir);

    /** Execute one full scan pass and print results. Returns true if violations found. */
    const runScan = async (): Promise<boolean> => {
      let scans;
      try {
        scans = await scanProject(projectDir, config.exclude ?? [], aliases);
      } catch (err) {
        console.error(chalk.red(`Error scanning project: ${(err as Error).message}`));
        return false;
      }

      if (scans.length === 0) {
        if (format === 'json') {
          console.log(
            JSON.stringify({ filesScanned: 0, violations: [], unclassifiedFiles: [], violationsByLayer: {} }, null, 2)
          );
        } else {
          console.log('No TypeScript files found in the specified directory.');
        }
        return false;
      }

      if (!opts.quiet && format === 'text') {
        console.log(chalk.bold('Scanning project...\n'));
      }

      const result = checkRules(scans, config, opts.strict, opts.fix);

      if (format === 'json') {
        printJson(result, scans.length, opts);
      } else {
        printText(result, scans.length, opts);
      }

      return result.violations.length > 0 || (opts.strict && result.unclassifiedFiles.length > 0);
    };

    if (opts.watch) {
      // Dynamic import keeps chokidar out of the startup path for non-watch runs
      const chokidar = await import('chokidar');

      console.log(chalk.dim('Watching for file changes… (press Ctrl+C to stop)\n'));

      let running = false;

      const onChange = async (changedPath?: string) => {
        if (running) return; // debounce: skip if previous run still in progress
        running = true;
        if (format === 'text') {
          process.stdout.write('\x1Bc'); // clear terminal
          if (changedPath) {
            console.log(chalk.dim(`Change detected: ${path.relative(projectDir, changedPath)}\n`));
          }
        }
        await runScan();
        running = false;
      };

      const watcher = chokidar.watch('**/*.ts', {
        cwd: projectDir,
        ignored: /(node_modules|dist|\.d\.ts$)/,
        ignoreInitial: false,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      });

      watcher.on('ready', () => onChange());
      watcher.on('change', (p) => onChange(path.join(projectDir, p)));
      watcher.on('add', (p) => onChange(path.join(projectDir, p)));
      watcher.on('unlink', () => onChange());

      // Keep process alive
      process.stdin.resume();
    } else {
      const hasIssues = await runScan();
      process.exit(hasIssues ? 1 : 0);
    }
  });

// ── init ──────────────────────────────────────────────────────────────────────

/**
 * Layer names (singular) that the init command recognises from directory names.
 * Both singular and plural forms are checked (e.g. "controller" matches "controllers/").
 */
const KNOWN_LAYERS = [
  'controller', 'service', 'repository', 'middleware', 'model',
  'handler', 'resolver', 'provider', 'store', 'gateway', 'adapter',
  'route', 'util', 'helper',
];

program
  .command('init')
  .description('Generate a starter .context.yml by inspecting the project directory structure')
  .option('-p, --project <path>', 'root directory of the project', '.')
  .action((options: { project: string }) => {
    const projectDir = path.resolve(options.project);
    const outputPath = path.join(projectDir, '.context.yml');

    if (fs.existsSync(outputPath)) {
      console.error(chalk.yellow(`A .context.yml already exists at ${outputPath}`));
      process.exit(1);
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      console.error(chalk.red(`Cannot read directory: ${projectDir}`));
      process.exit(1);
    }

    // Also scan inside a top-level src/ folder, which is a common pattern
    const srcDir = path.join(projectDir, 'src');
    if (fs.existsSync(srcDir)) {
      try {
        entries.push(...fs.readdirSync(srcDir, { withFileTypes: true }));
      } catch { /* ignore */ }
    }

    const skipDirs = new Set(['node_modules', 'dist', 'build', 'coverage', 'src', '.git']);
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !skipDirs.has(e.name));

    const candidates = (layer: string): string[] => {
      const lower = layer.toLowerCase();
      return lower.endsWith('y') ? [lower, lower.slice(0, -1) + 'ies'] : [lower, lower + 's'];
    };

    const detectedLayers: string[] = [];
    for (const dir of dirs) {
      const lower = dir.name.toLowerCase();
      for (const layer of KNOWN_LAYERS) {
        if (candidates(layer).includes(lower) && !detectedLayers.includes(layer)) {
          detectedLayers.push(layer);
          break;
        }
      }
    }

    if (detectedLayers.length === 0) {
      console.log(chalk.yellow('No recognisable layers found. A minimal template will be generated.'));
      detectedLayers.push('controller', 'service', 'repository');
    }

    const layersYaml = detectedLayers.map(l => `    - ${l}`).join('\n');
    const rulesYaml = detectedLayers
      .map(l => `  ${l}:\n    cannot_import: []`)
      .join('\n\n');

    const content = [
      '# .context.yml \u2014 generated by architecture-linter init',
      '#',
      '# Define which layers exist and what each layer is forbidden from importing.',
      '# Example: prevent controllers from importing repositories directly:',
      '#',
      '#   controller:',
      '#     cannot_import:',
      '#       - repository',
      '#',
      '# To whitelist instead of blacklist, use can_only_import:',
      '#',
      '#   repository:',
      '#     can_only_import: []  # repository imports nothing from other layers',
      '#',
      '# To scope a rule to specific files, add a files glob:',
      '#',
      '#   controller:',
      '#     files: "src/controllers/**"',
      '#     cannot_import:',
      '#       - repository',
      '',
      'architecture:',
      '  layers:',
      layersYaml,
      '',
      'rules:',
      rulesYaml,
      '',
      '# Exclude patterns (project-relative globs):',
      '# exclude:',
      '#   - "**/*.spec.ts"',
      '#   - "**/__mocks__/**"',
      '',
    ].join('\n');

    fs.writeFileSync(outputPath, content, 'utf-8');
    console.log(chalk.green(`\u2705 Created .context.yml at: ${outputPath}`));
    console.log(`   Detected layers: ${chalk.cyan(detectedLayers.join(', '))}`);
    console.log(`\n${chalk.dim('Edit the rules section to add your constraints, then run:')}`);
    console.log(`   ${chalk.bold('architecture-linter scan')}\n`);
  });

// ── ci ────────────────────────────────────────────────────────────────────────

const CI_PLATFORMS = ['github'] as const;
type CiPlatform = typeof CI_PLATFORMS[number];

program
  .command('ci')
  .description('Generate a CI workflow file that runs architecture-linter on every push/PR')
  .option('--platform <platform>', 'CI platform to target: github', 'github')
  .option('-p, --project <path>', 'root directory of the project', '.')
  .action((options: { platform: string; project: string }) => {
    const projectDir = path.resolve(options.project);
    const platform = options.platform.toLowerCase() as CiPlatform;

    if (!CI_PLATFORMS.includes(platform)) {
      console.error(chalk.red(`Unknown platform: "${platform}". Supported platforms: ${CI_PLATFORMS.join(', ')}`));
      process.exit(1);
    }

    if (platform === 'github') {
      const workflowDir = path.join(projectDir, '.github', 'workflows');
      const workflowPath = path.join(workflowDir, 'arch-lint.yml');

      if (fs.existsSync(workflowPath)) {
        console.error(chalk.yellow(`A workflow already exists at ${workflowPath}`));
        process.exit(1);
      }

      fs.mkdirSync(workflowDir, { recursive: true });

      const workflowContent = [
        '# arch-lint.yml - generated by architecture-linter ci',
        '# Runs architecture-linter on every push and pull request.',
        '# See: https://github.com/cvalingam/architecture-linter',
        '',
        'name: Architecture Lint',
        '',
        'on:',
        '  push:',
        '    branches: ["**"]',
        '  pull_request:',
        '    branches: ["**"]',
        '',
        'jobs:',
        '  arch-lint:',
        '    runs-on: ubuntu-latest',
        '',
        '    steps:',
        '      - name: Checkout repository',
        '        uses: actions/checkout@v4',
        '',
        '      - name: Set up Node.js',
        '        uses: actions/setup-node@v4',
        '        with:',
        '          node-version: "20"',
        '          cache: "npm"',
        '',
        '      - name: Install dependencies',
        '        run: npm ci',
        '',
        '      - name: Build',
        '        run: npm run build',
        '',
        '      - name: Run architecture linter',
        '        run: npx architecture-linter scan --strict',
        '',
      ].join('\n');

      fs.writeFileSync(workflowPath, workflowContent, 'utf-8');
      console.log(chalk.green(`\u2705 Created GitHub Actions workflow at: ${workflowPath}`));
      console.log(`\n${chalk.dim('Commit and push this file to enable CI enforcement:')}`);
      console.log(`   ${chalk.bold('git add .github/workflows/arch-lint.yml')}`);
      console.log(`   ${chalk.bold('git commit -m "ci: add architecture-linter workflow"')}`);
      console.log(`   ${chalk.bold('git push')}\n`);
    }
  });

program.parse(process.argv);

// ── output helpers ────────────────────────────────────────────────────────────

function printJson(result: RuleCheckResult, filesScanned: number, opts: ScanOptions): void {
  const violations = result.violations.map(v => {
    const entry: Record<string, unknown> = { ...v };
    if (opts.explain) {
      entry.explanation = explain(v.sourceLayer, v.targetLayer, v.rule);
    }
    return entry;
  });

  console.log(
    JSON.stringify(
      {
        filesScanned,
        violations,
        unclassifiedFiles: result.unclassifiedFiles,
        violationsByLayer: result.violationsByLayer,
      },
      null,
      2
    )
  );
}

function printText(result: RuleCheckResult, filesScanned: number, opts: ScanOptions): void {
  const { violations, unclassifiedFiles, violationsByLayer } = result;

  // Violations
  for (const v of violations) {
    console.log(chalk.red.bold('❌ Architecture violation detected\n'));
    console.log(`   ${chalk.bold('File:')}   ${chalk.yellow(v.file)}`);
    console.log(`   ${chalk.bold('Import:')} ${v.importPath}`);
    console.log(`   ${chalk.bold('Rule:')}   ${v.rule}`);

    if (opts.explain) {
      const exp = explain(v.sourceLayer, v.targetLayer, v.rule);
      console.log();
      console.log(`   ${chalk.cyan.bold('💡 Why this matters')}`);
      console.log(wordWrap(exp.why, 72, '      '));
      console.log();
      console.log(`   ${chalk.yellow.bold('⚡ Impact')}`);
      console.log(wordWrap(exp.impact, 72, '      '));
      console.log();
      console.log(`   ${chalk.green.bold('✅ How to fix')}`);
      console.log(wordWrap(exp.fix, 72, '      '));
    }

    if (opts.fix && v.fix) {
      console.log();
      console.log(`   ${chalk.blue.bold('🔧 Suggested fix')}`);
      console.log(wordWrap(v.fix, 72, '      '));
    }

    console.log();
  }

  // Strict mode: unclassified files
  if (opts.strict && unclassifiedFiles.length > 0) {
    console.log(chalk.yellow.bold('⚠️  Unclassified files (not assigned to any layer):\n'));
    for (const f of unclassifiedFiles) {
      console.log(`   ${f}`);
    }
    console.log();
  }

  if (violations.length === 0 && (!opts.strict || unclassifiedFiles.length === 0)) {
    console.log(chalk.green(`✅ No architecture violations found. (${filesScanned} file(s) scanned)`));
    return;
  }

  // Per-layer violation summary
  console.log(chalk.bold('── Violations by layer ──────────────────'));
  for (const [layer, count] of Object.entries(violationsByLayer)) {
    const label = `   ${layer.padEnd(16)} ${count} violation(s)`;
    console.log(count > 0 ? chalk.red(label) : chalk.green(label));
  }
  console.log();

  const vLabel = violations.length === 1 ? 'violation' : 'violations';
  console.log(chalk.red.bold(`Found ${violations.length} ${vLabel} in ${filesScanned} file(s) scanned.`));

  if (opts.strict && unclassifiedFiles.length > 0) {
    console.log(chalk.yellow(`Found ${unclassifiedFiles.length} unclassified file(s).`));
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Wraps `text` at `maxWidth` characters, prefixing every line with `indent`.
 */
function wordWrap(text: string, maxWidth: number, indent: string): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = indent;

  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth && current.trim().length > 0) {
      lines.push(current);
      current = indent + word;
    } else {
      current = current.trim().length === 0 ? indent + word : current + ' ' + word;
    }
  }
  if (current.trim().length > 0) lines.push(current);
  return lines.join('\n');
}
