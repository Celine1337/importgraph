#!/usr/bin/env bash
# Compile importgraph with the local TypeScript compiler and write the
# bin/importgraph launcher. Fully offline once `npm install` has run.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x node_modules/.bin/tsc ]; then
  echo "importgraph: node_modules/.bin/tsc missing — run 'npm install' first" >&2
  exit 1
fi

mkdir -p dist bin
./node_modules/.bin/tsc -p tsconfig.json

cat > bin/importgraph <<'WRAP'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$DIR/dist/main.js" "$@"
WRAP
chmod +x bin/importgraph

echo "built dist/ and bin/importgraph"