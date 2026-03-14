import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';

export interface WorkspacePackage {
  /** Display name (from package.json `name` or directory basename). */
  name: string;
  /** Absolute path to the package directory. */
  dir: string;
}

type PkgJson = {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
};

/**
 * Discovers workspace packages from the root `package.json` `workspaces` field.
 *
 * Supports both the flat array form and the Yarn/npm workspaces object form:
 *   workspaces: ["packages/*"]
 *   workspaces: { packages: ["packages/*"] }
 *
 * Returns an empty array when no workspaces are configured or `package.json`
 * is absent/unparseable.
 */
export function discoverWorkspacePackages(rootDir: string): WorkspacePackage[] {
  const pkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  let pkg: PkgJson;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PkgJson;
  } catch {
    return [];
  }

  const { workspaces } = pkg;
  const patterns: string[] = Array.isArray(workspaces)
    ? workspaces
    : Array.isArray(workspaces?.packages)
      ? workspaces.packages
      : [];

  if (patterns.length === 0) return [];

  // Resolve each pattern to a glob that matches `package.json` inside each workspace dir.
  const pkgJsonGlobs = patterns.map(p => {
    const stripped = p.replace(/\/$/, '');
    return `${stripped}/package.json`;
  });

  const found = fg.sync(pkgJsonGlobs, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
  });

  return found.map(pkgJsonPath => {
    const dir = path.dirname(pkgJsonPath);
    let name = path.basename(dir);
    try {
      const subPkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as PkgJson;
      if (subPkg.name) name = subPkg.name;
    } catch { /* keep basename */ }
    return { name, dir };
  });
}
