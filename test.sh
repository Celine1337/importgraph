#!/usr/bin/env bash
# Self-contained test suite for importgraph: vitest unit tests on the pure
# graph core, then CLI fixture trees (cycle/orphan/hotspot, clean, DOT,
# require parsing, exit codes). Fixtures live in mktemp dirs only.
set -uo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  export PATH="$HOME/.local/toolchains/node/bin:$PATH"
fi

pass=0; fail=0
ok(){ pass=$((pass+1)); echo "ok $pass - $1"; }
bad(){ fail=$((fail+1)); echo "FAIL - $1"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# --- unit tests (pure graph core) -----------------------------------------
if ./node_modules/.bin/vitest run --reporter=dot > "$TMP/vitest.log" 2>&1; then
  ok "vitest unit tests (graph + parse cores)"
else
  bad "vitest unit tests"; tail -30 "$TMP/vitest.log"
fi

# --- build -----------------------------------------------------------------
if ./build.sh > /dev/null; then
  ok "build.sh compiles dist/ and writes bin/importgraph"
else
  bad "build.sh"; exit 1
fi
IG="./bin/importgraph"

# --- fixture: known cycle + orphan + fan-in hotspot ------------------------
mkdir -p "$TMP/dirty/src"
cat > "$TMP/dirty/src/a.ts" <<'EOF'
import { b } from "./b";
export const a = b + 1;
EOF
cat > "$TMP/dirty/src/b.ts" <<'EOF'
import { a } from "./a";
export const b = 2;
EOF
cat > "$TMP/dirty/src/lonely.ts" <<'EOF'
export const lonely = true;
EOF
cat > "$TMP/dirty/src/util.ts" <<'EOF'
export const util = 1;
EOF
for f in c d e; do
  printf 'import { util } from "./util";\nexport const %s = util;\n' "$f" > "$TMP/dirty/src/$f.ts"
done

out=$($IG "$TMP/dirty"); rc=$?
[ "$rc" -eq 1 ] && ok "cycle fixture exits 1 (CI gate)" || bad "cycle fixture exit (got $rc, want 1)"
printf '%s' "$out" | grep -qF "Cycles: 1" && ok "cycle count reported" || bad "cycle count missing"
printf '%s' "$out" | grep -qF "src/a.ts -> src/b.ts -> src/a.ts" && ok "cycle path reported" || bad "cycle path missing"
printf '%s' "$out" | grep -qF "Orphans: 1" && ok "orphan count reported" || bad "orphan count missing"
printf '%s' "$out" | grep -qF "src/lonely.ts" && ok "orphan module named" || bad "orphan module missing"
printf '%s' "$out" | grep -qF "src/util.ts (3 importers)" && ok "fan-in hotspot reported" || bad "hotspot missing"
printf '%s' "$out" | grep -qF "Scanned 7 modules (5 import edges)" && ok "module/edge summary correct" || bad "summary wrong"

# --- fixture: clean tree ----------------------------------------------------
mkdir -p "$TMP/clean/src"
cat > "$TMP/clean/src/main.ts" <<'EOF'
import { helper } from "./helper";
export const main = helper;
EOF
cat > "$TMP/clean/src/helper.ts" <<'EOF'
export const helper = 1;
EOF
out=$($IG "$TMP/clean"); rc=$?
[ "$rc" -eq 0 ] && ok "clean fixture exits 0" || bad "clean fixture exit (got $rc, want 0)"
printf '%s' "$out" | grep -qF "no cycles" && ok "clean fixture reports acyclic" || bad "clean report wrong"
printf '%s' "$out" | grep -qF "Orphans: 0" && ok "clean fixture has no orphans" || bad "clean orphans wrong"

# --- fixture: CommonJS require cycle ---------------------------------------
mkdir -p "$TMP/cjs"
printf 'const g = require("./g");\nmodule.exports = g;\n' > "$TMP/cjs/f.js"
printf 'const f = require("./f");\nmodule.exports = f;\n' > "$TMP/cjs/g.js"
out=$($IG "$TMP/cjs"); rc=$?
[ "$rc" -eq 1 ] && ok "require() cycle detected (exit 1)" || bad "require cycle exit (got $rc)"
printf '%s' "$out" | grep -qF "f.js -> g.js -> f.js" && ok "require cycle path reported" || bad "require cycle path missing"

# --- --dot ------------------------------------------------------------------
out=$($IG "$TMP/dirty" --dot); rc=$?
[ "$rc" -eq 1 ] && ok "--dot keeps CI exit code" || bad "--dot exit (got $rc)"
printf '%s' "$out" | grep -qF "digraph importgraph {" && ok "--dot emits digraph" || bad "--dot header missing"
printf '%s' "$out" | grep -qF '"src/a.ts" -> "src/b.ts";' && ok "--dot emits edges" || bad "--dot edge missing"

# --- error paths -------------------------------------------------------------
$IG "$TMP/does-not-exist" > /dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "missing directory exits 2" || bad "missing dir exit (got $rc)"
$IG > /dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "no arguments exits 2" || bad "no-args exit (got $rc)"

echo "----------------------------------------"
echo "importgraph: $pass passed, $fail failed"
if [ "$fail" -eq 0 ]; then echo "ALL CHECKS PASSED"; else exit 1; fi