#!/usr/bin/env bash
# Build the npm tarball and smoke-test the CLI exactly as a consumer receives it.
set -euo pipefail

archive=''
tmpdir=$(mktemp -d)
cleanup() {
  [[ -n "$archive" ]] && rm -f "$archive"
  rm -rf "$tmpdir"
}
trap cleanup EXIT

archive=$(npm pack --json | node -e "let input=''; process.stdin.on('data', chunk => input += chunk).on('end', () => console.log(JSON.parse(input)[0].filename))")
consumer="$tmpdir/consumer"
# Install normally so native dependency install scripts run just as they do for users.
npm install --omit=dev --prefix "$consumer" "$(pwd)/$archive" >/dev/null

"$consumer/node_modules/.bin/strong" --help >/dev/null
# keytar is native; verify its install script supplied the binding. Do not load it here:
# Linux CI deliberately lacks libsecret, and the CLI falls back when no keyring is available.
test -f "$consumer/node_modules/keytar/build/Release/keytar.node"
node -e '
  const pkg = require(process.argv[1]);
  if (!pkg.bin?.strong || !pkg.files?.includes("dist")) process.exit(1)
' "$consumer/node_modules/@crcatala/strong-cli/package.json"

echo 'Package smoke test passed.'
