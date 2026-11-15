import { describe, expect, it } from "vitest";
import {
  adjacency,
  fanIn,
  findCycles,
  findOrphans,
  graphStats,
  hotspots,
  inDegrees,
  toDot,
  type ModuleGraph,
} from "../src/graph";

const g = (modules: string[], edges: [string, string][]): ModuleGraph => ({
  modules,
  edges: edges.map(([from, to]) => ({ from, to })),
});

describe("findCycles", () => {
  it("detects a two-node cycle", () => {
    const cycles = findCycles(g(["a", "b"], [["a", "b"], ["b", "a"]]));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(["a", "b"]);
  });

  it("detects a self-loop", () => {
    const cycles = findCycles(g(["a"], [["a", "a"]]));
    expect(cycles).toEqual([["a"]]);
  });

  it("returns nothing for a DAG", () => {
    const cycles = findCycles(g(["a", "b", "c"], [["a", "b"], ["b", "c"], ["a", "c"]]));
    expect(cycles).toEqual([]);
  });

  it("detects a long cycle through a chain", () => {
    const cycles = findCycles(g(["a", "b", "c", "d"], [
      ["a", "b"], ["b", "c"], ["c", "d"], ["d", "a"],
    ]));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(["a", "b", "c", "d"]);
  });

  it("finds multiple independent cycles", () => {
    const cycles = findCycles(g(["a", "b", "x", "y"], [
      ["a", "b"], ["b", "a"], ["x", "y"], ["y", "x"],
    ]));
    expect(cycles).toHaveLength(2);
  });

  it("deduplicates the same cycle reached from different entry points", () => {
    const cycles = findCycles(g(["a", "b", "c"], [
      ["a", "b"], ["b", "c"], ["c", "a"], ["b", "a"],
    ]));
    // a->b->c->a and a->b->a are two distinct cycles, each reported once.
    expect(cycles).toHaveLength(2);
    const keys = cycles.map((c) => [...c].sort().join(","));
    expect(new Set(keys).size).toBe(2);
  });

  it("handles deep chains without stack overflow", () => {
    const n = 5000;
    const modules = Array.from({ length: n }, (_, i) => `m${i}`);
    const edges: [string, string][] = modules
      .slice(0, -1)
      .map((m, i) => [m, modules[i + 1]]);
    edges.push([modules[n - 1], modules[0]]);
    const cycles = findCycles(g(modules, edges));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(n);
  });
});

describe("findOrphans", () => {
  it("flags modules with no edges at all", () => {
    const orphans = findOrphans(g(["a", "b", "lonely"], [["a", "b"]]));
    expect(orphans).toEqual(["lonely"]);
  });

  it("does not flag modules that only import", () => {
    expect(findOrphans(g(["a", "b"], [["a", "b"]]))).toEqual([]);
  });

  it("does not flag modules that are only imported", () => {
    expect(findOrphans(g(["a", "b"], [["a", "b"]]))).toEqual([]);
  });

  it("returns orphans sorted", () => {
    expect(findOrphans(g(["z", "a", "m"], []))).toEqual(["a", "m", "z"]);
  });
});

describe("fanIn / hotspots", () => {
  const graph = g(["util", "a", "b", "c", "d"], [
    ["a", "util"], ["b", "util"], ["c", "util"], ["d", "a"],
  ]);

  it("counts importers per module", () => {
    const deg = inDegrees(graph);
    expect(deg.get("util")).toBe(3);
    expect(deg.get("a")).toBe(1);
    expect(deg.get("d")).toBe(0);
  });

  it("sorts fan-in descending", () => {
    const table = fanIn(graph);
    expect(table[0]).toEqual({ module: "util", count: 3 });
    expect(table[1]).toEqual({ module: "a", count: 1 });
  });

  it("filters hotspots by threshold", () => {
    expect(hotspots(graph, 2)).toEqual([{ module: "util", count: 3 }]);
    expect(hotspots(graph, 4)).toEqual([]);
  });

  it("deduplicates repeated edges in counts", () => {
    const dup = g(["a", "b"], [["a", "b"], ["a", "b"]]);
    expect(inDegrees(dup).get("b")).toBe(1);
    expect(graphStats(dup).edges).toBe(1);
  });
});

describe("toDot", () => {
  it("emits a digraph with quoted nodes and edges", () => {
    const dot = toDot(g(["a.ts", "b.ts"], [["a.ts", "b.ts"]]));
    expect(dot).toContain("digraph importgraph {");
    expect(dot).toContain('"a.ts";');
    expect(dot).toContain('"a.ts" -> "b.ts";');
    expect(dot.trimEnd().endsWith("}")).toBe(true);
  });

  it("escapes quotes in module ids", () => {
    const dot = toDot(g(['we"ird.ts'], []));
    expect(dot).toContain('"we\\"ird.ts";');
  });

  it("deduplicates edges", () => {
    const dot = toDot(g(["a", "b"], [["a", "b"], ["a", "b"]]));
    expect(dot.split('"a" -> "b";')).toHaveLength(2);
  });
});

describe("adjacency / graphStats", () => {
  it("builds sorted deduplicated adjacency", () => {
    const adj = adjacency(g(["a", "b", "c"], [["a", "c"], ["a", "b"], ["a", "b"]]));
    expect(adj.get("a")).toEqual(["b", "c"]);
    expect(adj.get("b")).toEqual([]);
  });

  it("counts modules and unique edges", () => {
    expect(graphStats(g(["a", "b"], [["a", "b"], ["a", "b"]]))).toEqual({
      modules: 2,
      edges: 1,
    });
  });
});