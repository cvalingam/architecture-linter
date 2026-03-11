import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface Violation {
  file: string;
  rawSpecifier: string;
  sourceLayer: string;
  targetLayer: string;
  rule: string;
  fix?: string;
}

interface LintResult {
  violations: Violation[];
  unclassifiedFiles: string[];
  violationsByLayer: Record<string, number>;
}

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('architecture-linter');
  context.subscriptions.push(diagnostics);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBarItem.command = 'architecture-linter.scan';
  context.subscriptions.push(statusBarItem);

  const run = (): void => { runLinter(diagnostics); };

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === 'typescript' || doc.fileName.endsWith('.context.yml')) {
        run();
      }
    }),
    vscode.commands.registerCommand('architecture-linter.scan', run),
  );

  run();
}

function getLinterCommand(root: string): string {
  const ext = process.platform === 'win32' ? '.cmd' : '';
  const local = path.join(root, 'node_modules', '.bin', `architecture-linter${ext}`);
  return fs.existsSync(local) ? `"${local}"` : 'npx --yes architecture-linter';
}

function runLinter(collection: vscode.DiagnosticCollection): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return;

  const root = folders[0].uri.fsPath;

  if (!fs.existsSync(path.join(root, '.context.yml'))) {
    collection.clear();
    statusBarItem.hide();
    return;
  }

  const cmd = getLinterCommand(root);
  statusBarItem.text = '$(sync~spin) Architecture Linter';
  statusBarItem.tooltip = 'Scanning…';
  statusBarItem.show();

  // The CLI exits with code 1 when violations are found — ignore err, parse stdout
  exec(`${cmd} scan --format json --fix`, { cwd: root }, (_err, stdout) => {
    collection.clear();

    let result: LintResult;
    try {
      result = JSON.parse(stdout);
    } catch {
      statusBarItem.text = '$(warning) Architecture Linter';
      statusBarItem.tooltip = 'Could not parse linter output. Is architecture-linter installed?';
      return;
    }

    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const v of result.violations) {
      // Violation files are project-relative forward-slash paths
      const absPath = path.join(root, ...v.file.split('/'));
      const uri = vscode.Uri.file(absPath);
      const range = findImportRange(absPath, v.rawSpecifier);

      const message = v.fix ? `${v.rule}\n💡 ${v.fix}` : v.rule;
      const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
      diag.source = 'architecture-linter';

      const key = uri.toString();
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key)!.push(diag);
    }

    byFile.forEach((diags, key) => collection.set(vscode.Uri.parse(key), diags));

    const count = result.violations.length;
    statusBarItem.text = count === 0
      ? '$(check) Architecture OK'
      : `$(error) Architecture: ${count} violation${count !== 1 ? 's' : ''}`;
    statusBarItem.tooltip = count === 0
      ? 'No architecture violations found'
      : `${count} architecture violation${count !== 1 ? 's' : ''} — click to re-scan`;
  });
}

function findImportRange(filePath: string, rawSpecifier: string): vscode.Range {
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const col = lines[i].indexOf(rawSpecifier);
      if (col !== -1) {
        return new vscode.Range(i, col, i, col + rawSpecifier.length);
      }
    }
  } catch { /* fall through to default range */ }
  return new vscode.Range(0, 0, 0, 0);
}

export function deactivate(): void {}
