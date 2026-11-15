/**
 * Pure import-specifier extraction and module resolution.
 *
 * Regex-based on purpose: importgraph must work on any JS/TS dialect without
 * a parser dependency, and import statements are a tiny, regular grammar.
 * No filesystem access here — resolution is a pure function over the set of
 * scanned module ids, which keeps it unit-testable.
 */
import { posix } from "node:path";

const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

/** Strip block and line comments so commented-out imports are not counted. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Extract every module specifier referenced by import / export-from /
 * require / dynamic import. Order-preserving, deduplicated.
 */
export function extractSpecifiers(src: string): string[] {
  const code = stripComments(src);
  const found: string[] = [];
  const patterns: RegExp[] = [
    // import ... from "x" | import "x"
    /\bimport\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g,
    // export ... from "x"
    /\bexport\s+[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g,
    // require("x")
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // import("x") — dynamic import
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const spec = m[1];
      if (spec && !found.includes(spec)) found.push(spec);
    }
  }
  return found;
}

/** Only relative specifiers can resolve inside the scanned tree. */
export function isRelative(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

/** Candidate file ids for a resolved base path, in priority order. */
export function resolutionCandidates(base: string): string[] {
  const candidates: string[] = [base];
  const ext = posix.extname(base);
  const swapped = JS_TO_TS[ext];
  if (swapped) {
    const stem = base.slice(0, -ext.length);
    for (const alt of swapped) candidates.push(stem + alt);
  }
  for (const e of EXTS) candidates.push(base + e);
  for (const e of EXTS) candidates.push(posix.join(base, "index" + e));
  return candidates;
}

/**
 * Resolve a relative specifier from `fromFile` against the scanned module
 * set. Returns the matching module id, or null when the import points
 * outside the tree (or at a file that was not scanned).
 */
export function resolveModule(
  fromFile: string,
  spec: string,
  modules: ReadonlySet<string>,
): string | null {
  if (!isRelative(spec)) return null;
  const base = posix.normalize(posix.join(posix.dirname(fromFile), spec));
  for (const candidate of resolutionCandidates(base)) {
    if (modules.has(candidate)) return candidate;
  }
  return null;
}