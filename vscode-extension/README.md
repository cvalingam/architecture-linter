# Architecture Linter for VS Code

Enforce architectural layer rules in TypeScript projects — inline diagnostics,
fix hints, and real-time feedback every time you save.

## Features

- **Real-time scanning** — runs automatically on every `.ts` save
- **Inline diagnostics** — violations appear as red squiggles directly in the editor
- **Fix hints** — each violation shows a suggested fix in the Problems panel
- **Status bar** — shows `✓ Architecture OK` or `⊗ Architecture: N violations` at a glance
- **Manual trigger** — run `Scan Architecture` from the Command Palette (`Ctrl+Shift+P`)

## Requirements

Your project needs a `.context.yml` file in the workspace root. The extension
activates automatically when one is found.

Install the CLI:
```bash
npm install --save-dev architecture-linter
```

Generate a starter config:
```bash
npx architecture-linter init
```

## Example `.context.yml`

```yaml
architecture:
  layers:
    - controller
    - service
    - repository

rules:
  controller:
    cannot_import:
      - repository
```

## How it works

The extension runs `architecture-linter scan --format json --fix` in the
background and converts each violation into a VS Code diagnostic pinpointed to
the exact import line.

## Links

- [npm package](https://www.npmjs.com/package/architecture-linter)
- [GitHub repository](https://github.com/cvalingam/architecture-linter)
- [Full documentation](https://github.com/cvalingam/architecture-linter#readme)
