import { describe, expect, it } from "vitest";
import {
  extractSpecifiers,
  isRelative,
  resolutionCandidates,
  resolveModule,
  stripComments,
} from "../src/parse";

describe("extractSpecifiers", () => {
  it("parses static imports, side-effect imports and re-exports", () => {
    const src = `
      import { a } from "./a";
      import "./side-effect";
      export { b } from "./b";
    `;
    expect(extractSpecifiers(src)).toEqual(["./a", "./side-effect", "./b"]);
  });

  it("parses require and dynamic import", () => {
    const src = `const x = require("./c"); const y = import("./d");`;
    expect(extractSpecifiers(src)).toEqual(["./c", "./d"]);
  });

  it("ignores commented-out imports", () => {
    const src = `
      // import "./gone";
      /* import "./also-gone"; */
      import "./kept";
    `;
    expect(extractSpecifiers(src)).toEqual(["./kept"]);
  });

  it("deduplicates repeated specifiers", () => {
    const src = `import "./a"; import "./a"; require("./a");`;
    expect(extractSpecifiers(src)).toEqual(["./a"]);
  });

  it("handles single and double quotes", () => {
    expect(extractSpecifiers(`import x from './s'; import y from "./d";`))
      .toEqual(["./s", "./d"]);
  });
});

describe("stripComments", () => {
  it("removes block and line comments", () => {
    expect(stripComments("a /* x */ b // y\nc")).toBe("a  b \nc");
  });
});

describe("isRelative", () => {
  it("accepts ./ and ../ only", () => {
    expect(isRelative("./a")).toBe(true);
    expect(isRelative("../a")).toBe(true);
    expect(isRelative("lodash")).toBe(false);
    expect(isRelative("@scope/pkg")).toBe(false);
  });
});

describe("resolveModule", () => {
  const modules = new Set([
    "src/a.ts", "src/b.js", "src/util/index.ts", "src/typed.ts",
  ]);

  it("resolves exact and extensionless relative imports", () => {
    expect(resolveModule("src/main.ts", "./a", modules)).toBe("src/a.ts");
    expect(resolveModule("src/main.ts", "./a.ts", modules)).toBe("src/a.ts");
  });

  it("maps .js specifiers onto .ts sources (TS ESM style)", () => {
    expect(resolveModule("src/main.ts", "./typed.js", modules)).toBe("src/typed.ts");
  });

  it("resolves directory imports to index files", () => {
    expect(resolveModule("src/main.ts", "./util", modules)).toBe("src/util/index.ts");
  });

  it("resolves parent-relative paths", () => {
    expect(resolveModule("src/nested/x.ts", "../a", modules)).toBe("src/a.ts");
  });

  it("returns null for bare specifiers and missing files", () => {
    expect(resolveModule("src/a.ts", "lodash", modules)).toBeNull();
    expect(resolveModule("src/a.ts", "./nope", modules)).toBeNull();
  });

  it("lists extension candidates in priority order", () => {
    const c = resolutionCandidates("src/x");
    expect(c[0]).toBe("src/x");
    expect(c).toContain("src/x.ts");
    expect(c).toContain("src/x/index.ts");
  });
});