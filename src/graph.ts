/**
 * Pure graph core for importgraph.
 *
 * Everything in this file is a pure function over plain data: no filesystem,
 * no process state, no side effects. The CLI layer (scan.ts / main.ts) builds
 * a ModuleGraph from disk and hands it to these functions, which makes the
 * whole analysis unit-testable with vitest and reusable as a library.
 */

/** A directed import edge: `from` imports `to`. */
export interface Edge {
  from: string;
  to: string;
}

/** A module graph: node ids are scan-root-relative POSIX paths. */
export interface ModuleGraph {
  modules: string[];
  edges: Edge[];
}

/** Fan-in measurement for one module. */
export interface FanInEntry {
  module: string;
  count: number;
}

/** Build a deduplicated adjacency list (out-edges) from a graph. */
export function adjacency(graph: ModuleGraph): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of graph.modules) out.set(m, []);
  const seen = new Set<string>();
  for (const e of graph.edges) {
    const key = `${e.from}\u0000${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = out.get(e.from);
    if (list) list.push(e.to);
  }
  for (const list of out.values()) list.sort();
  return out;
}

/** In-degree per module (how many modules import it). */
export function inDegrees(graph: ModuleGraph): Map<string, number> {
  const deg = new Map<string, number>();
  for (const m of graph.modules) deg.set(m, 0);
  const seen = new Set<string>();
  for (const e of graph.edges) {
    const key = `${e.from}\u0000${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  return deg;
}

/** Canonical rotation of a cycle so deduplication is order-independent. */
function canonicalCycle(cycle: string[]): string {
  let best = cycle.join("\u0000");
  for (let i = 1; i < cycle.length; i++) {
    const rotated = [...cycle.slice(i), ...cycle.slice(0, i)].join("\u0000");
    if (rotated < best) best = rotated;
  }
  return best;
}

/**
 * Detect every distinct directed cycle via iterative DFS with an explicit
 * stack. A back-edge to a node currently on the stack closes a cycle; the
 * cycle is the stack slice from that node plus the closing edge. Cycles are
 * deduplicated by canonical rotation and returned sorted for stable output.
 *
 * Each returned cycle [a, b, c] means a -> b -> c -> a.
 */
export function findCycles(graph: ModuleGraph): string[][] {
  const adj = adjacency(graph);
  const cycles = new Map<string, string[]>();

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const m of graph.modules) color.set(m, WHITE);

  // Iterative DFS so deep graphs cannot overflow the call stack.
  for (const start of graph.modules) {
    if (color.get(start) !== WHITE) continue;
    const stack: string[] = [start];
    const onStack = new Set<string>([start]);
    const iters: Iterator<string>[] = [(adj.get(start) ?? [])[Symbol.iterator]()];
    color.set(start, GREY);

    while (stack.length > 0) {
      const it = iters[iters.length - 1];
      const next = it.next();
      if (next.done) {
        const done = stack.pop() as string;
        onStack.delete(done);
        color.set(done, BLACK);
        iters.pop();
        continue;
      }
      const node = next.value;
      if (onStack.has(node)) {
        const idx = stack.indexOf(node);
        const cycle = stack.slice(idx);
        const key = canonicalCycle(cycle);
        if (!cycles.has(key)) cycles.set(key, cycle);
        continue;
      }
      if (color.get(node) === WHITE) {
        color.set(node, GREY);
        stack.push(node);
        onStack.add(node);
        iters.push((adj.get(node) ?? [])[Symbol.iterator]());
      }
    }
  }

  return [...cycles.values()].sort((a, b) =>
    canonicalCycle(a) < canonicalCycle(b) ? -1 : 1,
  );
}

/**
 * Orphan modules: no incoming AND no outgoing import edges. These are either
 * dead code or entry points nobody wires up — both worth a look.
 */
export function findOrphans(graph: ModuleGraph): string[] {
  const touched = new Set<string>();
  for (const e of graph.edges) {
    touched.add(e.from);
    touched.add(e.to);
  }
  return graph.modules.filter((m) => !touched.has(m)).sort();
}

/** Fan-in for every module, sorted by count desc then module id asc. */
export function fanIn(graph: ModuleGraph): FanInEntry[] {
  const deg = inDegrees(graph);
  return [...deg.entries()]
    .map(([module, count]) => ({ module, count }))
    .sort((a, b) => b.count - a.count || (a.module < b.module ? -1 : 1));
}

/** Modules imported by at least `minFanIn` other modules (hotspots). */
export function hotspots(graph: ModuleGraph, minFanIn = 2): FanInEntry[] {
  return fanIn(graph).filter((e) => e.count >= minFanIn);
}

/** Escape a module id for a DOT quoted identifier. */
function dotQuote(id: string): string {
  return `"${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Render the graph as Graphviz DOT (digraph, left-to-right). */
export function toDot(graph: ModuleGraph, name = "importgraph"): string {
  const lines: string[] = [`digraph ${name} {`, "  rankdir=LR;", "  node [shape=box];"];
  for (const m of [...graph.modules].sort()) lines.push(`  ${dotQuote(m)};`);
  const seen = new Set<string>();
  const edges = [...graph.edges].sort((a, b) =>
    a.from === b.from ? (a.to < b.to ? -1 : 1) : a.from < b.from ? -1 : 1,
  );
  for (const e of edges) {
    const key = `${e.from}\u0000${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`  ${dotQuote(e.from)} -> ${dotQuote(e.to)};`);
  }
  lines.push("}");
  return lines.join("\n");
}

/** Plain counts for the CLI summary line. */
export function graphStats(graph: ModuleGraph): { modules: number; edges: number } {
  const seen = new Set<string>();
  for (const e of graph.edges) seen.add(`${e.from}\u0000${e.to}`);
  return { modules: graph.modules.length, edges: seen.size };
}