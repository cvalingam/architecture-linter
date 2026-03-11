# architecture-linter

> Enforce architectural layer rules in TypeScript projects from the command line.

`architecture-linter` reads a `.context.yml` configuration file and scans your
TypeScript source tree for dependency violations — such as a controller importing
a repository directly, bypassing the service layer.

---

## Quick start

```bash
npm install --save-dev architecture-linter
npx architecture-linter init   # generate .context.yml from your folder structure
npx architecture-linter scan   # check for violations
```

Expected output when a violation exists:

```
Scanning project...

❌ Architecture violation detected

   File:   controllers/orderController.ts
   Import: repositories/orderRepository
   Rule:   Controller cannot import Repository

── Violations by layer ──────────────────
   controller       1 violation(s)
   service          0 violation(s)
   repository       0 violation(s)

Found 1 violation in 3 file(s) scanned.
```

---

## Installation

### As a local dev dependency (recommended)

```bash
npm install --save-dev architecture-linter
```

Add a script to your `package.json`:

```json
{
  "scripts": {
    "lint:arch": "architecture-linter scan"
  }
}
```

### Global install

```bash
npm install -g architecture-linter
```

---

## Quick setup for a new project

Run `init` to auto-generate a `.context.yml` by inspecting your folder structure.
The command detects common layer names (`controller`, `service`, `repository`,
`middleware`, etc.) from top-level and `src/` subdirectory names.

```bash
architecture-linter init
```

Then edit the generated file to add your constraints, and run:

```bash
architecture-linter scan
```

---

## Framework presets

Use a built-in preset to get a sensible starting configuration for popular
architectural patterns. Declare it with the `extends` key in `.context.yml`:

```yaml
extends: nestjs
```

User-defined layers and rules always take precedence over preset defaults.

| Preset | Layers |
|---|---|
| `nestjs` | module, controller, service, repository, guard, interceptor, pipe, decorator, dto, entity |
| `clean-architecture` | entity, usecase, repository, infrastructure, interface |
| `hexagonal` | domain, port, adapter, application, infrastructure |
| `nextjs` | page, component, hook, lib, api, store, util |

### Extending multiple presets

```yaml
extends:
  - clean-architecture
  - nestjs
```

### Overriding a preset rule

```yaml
extends: nestjs

rules:
  # Override the nestjs default — allow controllers to import repositories directly
  controller:
    cannot_import: []
```

---

## Configuration reference

Create a `.context.yml` in your project root (or pass `--context` to override).
When `--context` is omitted, the linter walks up the directory tree until a
`.context.yml` is found — just like ESLint.

```yaml
# Optional: extend a built-in preset
extends: nestjs

architecture:
  layers:
    - controller
    - service
    - repository

rules:
  # Blacklist: this layer must NOT import from any layer in the list.
  controller:
    cannot_import:
      - repository

  # Whitelist: this layer may ONLY import from layers in the list.
  service:
    can_only_import:
      - repository

  repository:
    cannot_import: []

# Glob patterns (project-relative) for files to skip entirely.
exclude:
  - "**/*.spec.ts"
  - "**/*.test.ts"
  - "**/__mocks__/**"

# Manual path alias overrides (supplements tsconfig.json paths automatically).
aliases:
  "@repositories": "src/repositories"
  "@services": "src/services"
```

### Rule options

| Option | Type | Description |
|---|---|---|
| `cannot_import` | `string[]` | Blacklist — the layer must not import from any listed layer |
| `can_only_import` | `string[]` | Whitelist — the layer may only import from listed layers |
| `files` | `string` (glob) | Scope this rule to source files matching the pattern |

`cannot_import` and `can_only_import` are mutually exclusive. Use one per layer rule.

#### Scoping a rule to specific files

```yaml
rules:
  controller:
    files: "src/controllers/admin/**"
    cannot_import:
      - repository
```

### Path alias resolution

The linter automatically reads `compilerOptions.paths` from your `tsconfig.json`
and resolves aliased imports before checking rules. No extra config needed for
standard TypeScript path aliases.

For monorepos or non-standard setups, add manual overrides via the `aliases` key:

```yaml
aliases:
  "@repositories": "src/repositories"
```

Manual aliases take precedence over any `tsconfig.json` entries with the same key.

### Inline suppression with `arch-ignore`

To suppress a single violation without removing the import, add an
`// arch-ignore:` comment on the line immediately before the import:

```ts
// arch-ignore: controller cannot import repository
import { OrderRepository } from '../repositories/orderRepository';
```

The hint must match the rule string (case-insensitive): `<sourceLayer> cannot import <targetLayer>`.

---

### How layer detection works

The linter infers a file's layer from its **directory name**. Both singular and
plural forms are recognised (including irregular plurals such as `repository` → `repositories`).

| Path | Detected layer |
|---|---|
| `controllers/orderController.ts` | `controller` |
| `services/orderService.ts` | `service` |
| `repositories/orderRepository.ts` | `repository` |
| `src/controllers/admin/ctrl.ts` | `controller` |

---

## CLI reference

### `scan`

```
architecture-linter scan [options]

Options:
  -c, --context <path>   Path to the .context.yml file (auto-detected if omitted)
  -p, --project <path>   Root directory of the project to scan   (default: .)
  -f, --format <format>  Output format: text or json              (default: text)
  -s, --strict           Report files not assigned to any layer
  -q, --quiet            Suppress the "Scanning project..." banner
  -e, --explain          Print why/impact/how-to-fix guidance per violation
  -x, --fix              Show a suggested fix for each violation
  -w, --watch            Watch for file changes and re-scan automatically
  -h, --help             Display help
```

#### `--explain` — understand each violation

```bash
architecture-linter scan --explain
```

Adds three sections below each violation:
- **Why this matters** — the architectural reason this rule exists
- **Impact** — what goes wrong if the violation is left in place
- **How to fix** — a concrete recommendation

#### `--fix` — get a suggested fix

```bash
architecture-linter scan --fix
```

Prints a short actionable message per violation, e.g.:

```
🔧 Suggested fix
   Instead of importing 'repository' directly, route through an allowed
   intermediary layer: 'service'.
```

#### `--watch` — re-scan on file changes

```bash
architecture-linter scan --watch
```

Watches the project directory for `.ts` file changes and re-runs the scan
automatically. Press `Ctrl+C` to stop.

### `init`

```
architecture-linter init [options]

Options:
  -p, --project <path>   Root directory of the project  (default: .)
```

Generates a starter `.context.yml` by detecting layer names from directory
structure. Fails safely if a `.context.yml` already exists.

### `ci`

```
architecture-linter ci [options]

Options:
  --platform <platform>  CI platform to target: github  (default: github)
  -p, --project <path>   Root directory of the project  (default: .)
```

Generates a ready-to-use CI workflow file. Currently supports GitHub Actions:

```bash
architecture-linter ci
# Creates: .github/workflows/arch-lint.yml
```

Fails safely if the workflow file already exists.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No violations found |
| `1` | One or more violations found (or a fatal error occurred) |

---

## GitHub Action

The easiest way to enforce architecture rules on every pull request — no Node.js
setup needed, violations appear as inline code annotations.

```yaml
# .github/workflows/arch-lint.yml
name: Architecture Lint

on:
  push:
    branches: ["**"]
  pull_request:
    branches: ["**"]

jobs:
  arch-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: cvalingam/architecture-linter@v0.1.2
        with:
          config: .context.yml          # path to your config (default: .context.yml)
          fail-on-violations: 'true'    # fail the job on violations (default: true)
          token: ${{ secrets.GITHUB_TOKEN }}  # enables PR comment summary (optional)
```

### Action inputs

| Input | Default | Description |
|---|---|---|
| `config` | `.context.yml` | Path to the config file |
| `working-directory` | `.` | Root directory to scan |
| `fail-on-violations` | `true` | Fail the step when violations are found |
| `token` | `''` | GitHub token — enables PR comment with violation table |

### Action outputs

| Output | Description |
|---|---|
| `violations` | Number of violations found (usable in subsequent steps) |

When violations are found, each one appears as a **red annotation** directly on
the diff line in the PR, and a summary comment is posted to the PR thread.

---

## GitHub Action

The easiest way to enforce architecture rules on every pull request — no manual
setup required. Violations are posted as inline PR annotations and an optional
PR comment summary:

```yaml
# .github/workflows/arch-lint.yml
name: Architecture Lint

on:
  pull_request:
    branches: ["**"]

jobs:
  arch-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Enforce architecture rules
        uses: cvalingam/architecture-linter@v0.1.2
        with:
          token: ${{ secrets.GITHUB_TOKEN }}   # for PR comment (optional)
```

**Inputs**

| Input | Default | Description |
|---|---|---|
| `config` | `.context.yml` | Path to your config file |
| `working-directory` | `.` | Root of the project to scan |
| `fail-on-violations` | `true` | Fail the step when violations are found |
| `token` | `''` | `GITHUB_TOKEN` — enables PR comment summary |

**Outputs**

| Output | Description |
|---|---|
| `violations` | Number of violations found |

---

## CI integration (manual setup)

Run the linter on every push and pull request. The `ci` command generates this
for you (`architecture-linter ci`), or add the step manually:

```yaml
# .github/workflows/arch-lint.yml
name: Architecture Lint

on:
  push:
    branches: ["**"]
  pull_request:
    branches: ["**"]

jobs:
  arch-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npx architecture-linter scan --strict
```

---

## JSON output

```bash
architecture-linter scan --format json
architecture-linter scan --format json --fix --explain
```

```json
{
  "filesScanned": 3,
  "violations": [
    {
      "file": "controllers/orderController.ts",
      "importPath": "repositories/orderRepository",
      "rawSpecifier": "../repositories/orderRepository",
      "sourceLayer": "controller",
      "targetLayer": "repository",
      "rule": "Controller cannot import Repository",
      "fix": "Instead of importing 'repository' directly, route through an allowed intermediary layer: 'service'.",
      "explanation": {
        "why": "...",
        "impact": "...",
        "fix": "..."
      }
    }
  ],
  "unclassifiedFiles": [],
  "violationsByLayer": {
    "controller": 1,
    "service": 0,
    "repository": 0
  }
}
```

---

## Development

```bash
# Install dependencies
npm install

# Run directly with ts-node (no build required)
npx ts-node src/cli.ts scan --context examples/sample.context.yml --project examples/sample-project

# Build to dist/
npm run build

# Run the full test suite
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Clean build artefacts
npm run clean
```

---

## Project structure

```
architecture-linter/
├── src/
│   ├── cli.ts               # Commander-based CLI entry point
│   ├── contextParser.ts     # Loads and validates .context.yml; walks up directory tree
│   ├── dependencyScanner.ts # Walks .ts files and extracts imports via ts-morph
│   ├── ruleEngine.ts        # Matches imports against rules; builds violations
│   ├── aliasResolver.ts     # Resolves tsconfig.json path aliases
│   ├── presets.ts           # Built-in framework presets
│   ├── explainer.ts         # Why/impact/fix guidance for --explain
│   └── types.ts             # Shared TypeScript interfaces
│
├── src/__tests__/           # Jest test suite (105 tests)
│
├── examples/
│   ├── sample.context.yml         # Example rule configuration
│   ├── sample-project/            # ❌ intentional violation for demo
│   ├── alias-test/                # Demo of path alias resolution
│   └── preset-test/               # Demo of framework presets
│
├── .github/workflows/ci.yml  # Runs tests on every push/PR
├── jest.config.js
├── package.json
├── tsconfig.json
└── README.md
```

---

## How it works

1. **Parse config** — `contextParser` loads `.context.yml`, merges any preset
   declared via `extends`, validates required fields, and walks up the directory
   tree when no explicit path is provided.
2. **Scan files** — `dependencyScanner` uses `fast-glob` to find every `.ts`
   file (respecting `exclude` patterns) and `ts-morph` to parse import
   declarations. Path aliases are resolved via `aliasResolver` before rules are
   applied. Each import is checked for a preceding `// arch-ignore:` comment.
3. **Check rules** — `ruleEngine` evaluates `cannot_import` / `can_only_import`
   rules against each import. Violations are collected with optional fix
   suggestions and layer-level counts.
4. **Report** — results are printed as human-readable text (with colour) or
   machine-readable JSON. The process exits `0` for clean, `1` for violations.
3. **Apply rules** — `ruleEngine` maps each file and resolved import to an
   architectural layer, then evaluates `cannot_import` (blacklist) and
   `can_only_import` (whitelist) rules. Per-rule `files` glob scoping is
   applied via `minimatch`.
4. **Report** — The CLI prints every violation with the file, import path, and
   rule broken. A per-layer summary is shown at the end. `--format json` emits
   machine-readable output.

---

## Roadmap (post-MVP)

- `--fix` flag to suggest corrected import paths
- SARIF output format for GitHub Advanced Security integration
- Watch mode (`--watch`)
- Support for TypeScript path alias resolution (`@app/repositories`)

---

## License

MIT


`architecture-linter` reads a `.context.yml` configuration file and scans your
TypeScript source tree for dependency violations — such as a controller importing
a repository directly, bypassing the service layer.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Build
npm run build

# 3. Scan the bundled example project
node dist/cli.js scan \
  --context examples/sample.context.yml \
  --project examples/sample-project
```

Expected output:

```
Scanning project...

❌ Architecture violation detected

   File:    controllers/orderController.ts
   Import:  repositories/orderRepository
   Rule:    Controller cannot import Repository

Found 1 violation in 3 file(s) scanned.
```

---

## Installation

### As a local dev dependency

```bash
npm install --save-dev architecture-linter
```

Then add a script to your `package.json`:

```json
{
  "scripts": {
    "lint:arch": "architecture-linter scan"
  }
}
```

### Global install

```bash
npm install -g architecture-linter
```

---

## Configuration

Create a `.context.yml` file in your project root (or pass `--context` to point
to a different path).

```yaml
architecture:
  layers:
    - controller
    - service
    - repository

rules:
  controller:
    cannot_import:
      - repository   # Controllers must go through the service layer

  service:
    cannot_import: []

  repository:
    cannot_import: []
```

### How layer detection works

The linter infers a file's layer from its **directory name**. A file inside a
directory called `controllers/` or `controller/` is automatically assigned to
the `controller` layer. Both singular and plural forms are recognised.

| Path | Detected layer |
|---|---|
| `controllers/orderController.ts` | `controller` |
| `services/orderService.ts` | `service` |
| `repositories/orderRepository.ts` | `repository` |

The same logic applies to import paths: a relative import that resolves into a
`repositories/` directory is treated as a `repository`-layer import.

---

## CLI reference

```
architecture-linter scan [options]

Options:
  -c, --context <path>   Path to the .context.yml file  (default: .context.yml)
  -p, --project <path>   Root directory of the project  (default: .)
  -V, --version          Print version number
  -h, --help             Display help
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No violations found |
| `1` | One or more violations found (or a fatal error occurred) |

This makes the tool suitable for use in CI pipelines:

```yaml
# .github/workflows/ci.yml (example)
- name: Architecture lint
  run: npx architecture-linter scan
```

---

## Development

```bash
# Run directly with ts-node (no build step required)
npx ts-node src/cli.ts scan --context examples/sample.context.yml --project examples/sample-project

# Build to dist/
npm run build

# Run the compiled output
node dist/cli.js scan --context examples/sample.context.yml --project examples/sample-project

# Clean build artefacts
npm run clean
```

---

## Project structure

```
architecture-linter/
├── src/
│   ├── cli.ts               # Commander-based CLI entry point
│   ├── contextParser.ts     # Loads and validates .context.yml
│   ├── dependencyScanner.ts # Walks .ts files and extracts imports via ts-morph
│   ├── ruleEngine.ts        # Matches imports against rules and returns violations
│   └── types.ts             # Shared TypeScript interfaces
│
├── examples/
│   ├── sample.context.yml                        # Example rule configuration
│   └── sample-project/
│       ├── controllers/orderController.ts        # ❌ contains an intentional violation
│       ├── services/orderService.ts
│       └── repositories/orderRepository.ts
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## How it works

1. **Parse config** — `contextParser` loads `.context.yml` using `js-yaml` and
   validates the required fields.
2. **Scan files** — `dependencyScanner` uses `fast-glob` to find every `.ts`
   file in the project and `ts-morph` to parse its import declarations.
   Relative imports are resolved to project-relative paths.
3. **Apply rules** — `ruleEngine` maps each file and each resolved import path
   to an architectural layer, then checks the `cannot_import` rules.
4. **Report** — The CLI prints every violation with the offending file, the
   resolved import path, and the rule that was broken.

---

## Roadmap (post-MVP)

- `--fix` flag to suggest corrected import paths
- JSON / SARIF output format for CI integration
- Wildcard layer patterns (`src/*/controllers/**`)
- Support for path alias resolution (`@app/repositories`)
- Watch mode

---

## License

MIT
