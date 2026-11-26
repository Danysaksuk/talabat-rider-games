#!/bin/sh
# Rebuilds public/vendor/three.min.js: a tree-shaken, minified ES module of three.js r187 with only
# the classes rush.js, penalty.js and superover.js use (about a third of the full build). Needs network for npx/npm.
# Usage: sh tools/build-three.sh   (re-run after using a new THREE.* class in rush.js, penalty.js or superover.js)
set -e
cd "$(dirname "$0")/.."
NAMES=$(grep -oh "THREE\.[A-Za-z0-9_]*" public/js/rush.js public/js/penalty.js public/js/superover.js | sort -u | sed 's/THREE\.//' | paste -sd, -)
TMP=$(mktemp -d)
(cd "$TMP" && npm pack three@0.187.0 --silent >/dev/null && tar xzf three-0.187.0.tgz)
echo "export { $NAMES } from '$TMP/package/build/three.module.js';" > "$TMP/entry.js"
npx --yes esbuild@0.25 "$TMP/entry.js" --bundle --minify --format=esm --legal-comments=inline \
  --banner:js="/* three.js r187 (MIT License, see three.LICENSE) - https://threejs.org */" \
  --outfile=public/vendor/three.min.js
cp "$TMP/package/LICENSE" public/vendor/three.LICENSE
rm -rf "$TMP"
