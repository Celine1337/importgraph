#!/usr/bin/env node
/**
 * importgraph CLI — import-graph forensics for JS/TS codebases.
 *
 *   importgraph <dir> [--dot]
 *
 * Exit codes: 0 acyclic graph, 1 cycles found (CI gate), 2 usage/IO error.
 */
import { argv, exit, stderr, stdout } from "node:process";
import {
  findCycles,
  findOrphans,
  graphStats,
  hotspots,
  toDot,
} from "./graph.js";
import { buildGraph, isDirectory } from "./scan.js";

const USAGE = `importgraph — import-graph analyzer for JS/TS codebases

Usage: importgraph <dir> [--dot]

  <dir>   directory to scan (.ts/.js sources, node_modules skipped)
  --dot   emit Graphviz DOT instead of the human report

Reports circular dependencies, orphan modules and fan-in hotspots.
Exit codes: 0 no cycles, 1 cycles found, 2 bad usage or directory.`;

function fail(message: string): never {
  stderr.write(`importgraph: ${message}\n`);
  exit(2);
}

function main(): void {
  const args = argv.slice(2);
  let dir: string | null = null;
  let dot = false;
  for (const arg of args) {
    if (arg === "--dot") dot = true;
    else if (arg === "--help" || arg === "-h") {
      stdout.write(USAGE + "\n");
      exit(0);
    } else if (arg.startsWith("-")) fail(`unknown option '${arg}'`);
    else if (dir === null) dir = arg;
    else fail("expected exactly one directory argument");
  }
  if (dir === null) {
    stderr.write(USAGE + "\n");
    exit(2);
  }
  if (!isDirectory(dir)) fail(`not a directory: ${dir}`);

  const graph = buildGraph(dir);
  const cycles = findCycles(graph);
  const stats = graphStats(graph);

  if (dot) {
    stdout.write(toDot(graph) + "\n");
    exit(cycles.length > 0 ? 1 : 0);
  }

  const orphans = findOrphans(graph);
  const spots = hotspots(graph, 2);
  const lines: string[] = [];
  lines.push(`Scanned ${stats.modules} modules (${stats.edges} import edges) in ${dir}`);
  lines.push("");
  lines.push(`Cycles: ${cycles.length}`);
  cycles.forEach((cycle, i) => {
    lines.push(`  [${i + 1}] ${[...cycle, cycle[0]].join(" -> ")}`);
  });
  lines.push("");
  lines.push(`Orphans: ${orphans.length}`);
  for (const o of orphans) lines.push(`  ${o}`);
  lines.push("");
  lines.push("Fan-in hotspots (>= 2 importers):");
  if (spots.length === 0) lines.push("  none");
  for (const s of spots) lines.push(`  ${s.module} (${s.count} importers)`);
  lines.push("");
  if (cycles.length > 0) {
    lines.push(`Result: ${cycles.length} cycle(s) found — CI gate FAILS`);
  } else {
    lines.push("Result: no cycles — graph is acyclic");
  }
  stdout.write(lines.join("\n") + "\n");
  exit(cycles.length > 0 ? 1 : 0);
}

main();