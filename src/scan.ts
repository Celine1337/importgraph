/**
 * Filesystem layer: walk a directory, read JS/TS sources, and assemble the
 * module graph. This is the only impure part of the pipeline besides the
 * CLI itself; all analysis happens in graph.ts on plain data.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import type { Edge, ModuleGraph } from "./graph.js";
import { extractSpecifiers, resolveModule } from "./parse.js";

const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
]);
const SKIP_DIRS = new Set([
  "node_modules", "dist", "coverage", "build", "out", "vendor",
]);

/** Recursively collect source files, skipping noise directories. */
export function walkSources(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory: skip silently
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        visit(full);
      } else if (entry.isFile()) {
        const dot = entry.name.lastIndexOf(".");
        const ext = dot >= 0 ? entry.name.slice(dot) : "";
        if (!SOURCE_EXTS.has(ext)) continue;
        if (entry.name.endsWith(".d.ts")) continue;
        files.push(full);
      }
    }
  };
  visit(root);
  return files.sort();
}

/** Convert an absolute path to a scan-root-relative POSIX module id. */
export function moduleId(root: string, file: string): string {
  return relative(root, file).split(sep).join(posix.sep);
}

/** Build the import graph for every source file under `root`. */
export function buildGraph(root: string): ModuleGraph {
  const files = walkSources(root);
  const modules = files.map((f) => moduleId(root, f));
  const moduleSet = new Set(modules);
  const edges: Edge[] = [];

  files.forEach((file, i) => {
    const from = modules[i];
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      return; // unreadable file: treat as edgeless module
    }
    for (const spec of extractSpecifiers(src)) {
      const to = resolveModule(from, spec, moduleSet);
      if (to !== null && to !== from) edges.push({ from, to });
    }
  });

  return { modules, edges };
}

/** True when `dir` exists and is a directory (CLI exit-2 gate). */
export function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}