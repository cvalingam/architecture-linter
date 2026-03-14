import { CircularDep, FileScan } from './types';
import { detectLayer } from './ruleEngine';

/**
 * Detects circular dependencies between architectural layers using Tarjan's
 * Strongly Connected Components (SCC) algorithm.
 *
 * A cycle exists when layer A (transitively) imports layer B which imports
 * back into layer A — e.g. controller → service → controller.
 *
 * Each SCC with more than one node is reported as a circular dependency.
 * Self-loops (a file importing its own layer) are intentionally ignored.
 *
 * @param scans   File scan results produced by `scanProject`.
 * @param layers  Declared layer names from the architecture config.
 */
export function detectCircularDependencies(
  scans: FileScan[],
  layers: string[],
): CircularDep[] {
  // Build directed adjacency list: layer → set of layers it imports.
  const adj = new Map<string, Set<string>>();
  for (const layer of layers) adj.set(layer, new Set());

  for (const scan of scans) {
    const src = detectLayer(scan.file, layers);
    if (!src) continue;
    for (const imp of scan.imports) {
      const tgt = detectLayer(imp.importPath, layers);
      if (tgt && tgt !== src) {
        adj.get(src)!.add(tgt);
      }
    }
  }

  // ── Tarjan's SCC ────────────────────────────────────────────────────────────
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: CircularDep[] = [];
  let counter = 0;

  const strongconnect = (v: string): void => {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v)!) {
      if (!index.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }

    // Root of an SCC
    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);

      if (scc.length > 1) {
        // Reverse to restore natural discovery order, then close the cycle.
        const ordered = scc.reverse();
        cycles.push({ cycle: [...ordered, ordered[0]] });
      }
    }
  };

  for (const layer of layers) {
    if (!index.has(layer)) strongconnect(layer);
  }

  return cycles;
}
