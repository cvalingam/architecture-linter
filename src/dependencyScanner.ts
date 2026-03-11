import path from 'path';
import fg from 'fast-glob';
import { Project } from 'ts-morph';
import { FileScan, ImportInfo } from './types';
import { AliasMap, resolveAlias } from './aliasResolver';

/**
 * Scans all TypeScript files in the given directory and returns the list of
 * imports found in each file.
 *
 * Relative imports are resolved to project-relative paths directly.
 * Non-relative imports (bare specifiers) are checked against the provided
 * alias map (auto-detected from tsconfig.json paths + manual .context.yml aliases).
 * Imports that match no alias are skipped (treated as node_modules).
 *
 * @param projectDir  Absolute path to the project root.
 * @param exclude     Project-relative glob patterns for files to skip.
 * @param aliases     Resolved alias map for path alias resolution.
 */
export async function scanProject(
  projectDir: string,
  exclude: string[] = [],
  aliases: AliasMap = {}
): Promise<FileScan[]> {
  const absoluteFiles = await fg('**/*.ts', {
    cwd: projectDir,
    ignore: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', ...exclude],
    absolute: true,
  });

  if (absoluteFiles.length === 0) {
    return [];
  }

  // skipFileDependencyResolution prevents ts-morph from crawling the entire
  // dependency graph; we only need the AST of the files we provide.
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });

  const results: FileScan[] = [];

  for (const absoluteFile of absoluteFiles) {
    const sourceFile = project.addSourceFileAtPath(absoluteFile);
    const relativeFile = toForwardSlash(path.relative(projectDir, absoluteFile));
    const fileDir = path.dirname(absoluteFile);
    const sourceLines = sourceFile.getFullText().split('\n');

    const imports: ImportInfo[] = [];

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const rawSpecifier = importDecl.getModuleSpecifierValue();

      let importPath: string;

      if (rawSpecifier.startsWith('.')) {
        // Relative import — resolve directly to a project-relative path
        const resolvedAbsolute = path.resolve(fileDir, rawSpecifier);
        importPath = toForwardSlash(path.relative(projectDir, resolvedAbsolute));
      } else {
        // Bare specifier — try to resolve via alias map
        const resolved = resolveAlias(rawSpecifier, aliases, projectDir);
        if (!resolved) {
          // No matching alias → this is a node_modules package; skip
          continue;
        }
        importPath = resolved;
      }

      // Check the line immediately before this import for an arch-ignore comment.
      // Format: // arch-ignore: controller cannot import repository
      const lineNumber = importDecl.getStartLineNumber(); // 1-based
      const precedingLine = lineNumber >= 2 ? (sourceLines[lineNumber - 2] ?? '').trim() : '';
      const ignoreMatch = precedingLine.match(/\/\/\s*arch-ignore:\s*(.+)/i);
      const archIgnore = ignoreMatch ? [ignoreMatch[1].trim().toLowerCase()] : [];

      imports.push({ file: relativeFile, importPath, rawSpecifier, archIgnore });
    }

    results.push({ file: relativeFile, layer: null, imports });
  }

  return results;
}

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}
