#!/usr/bin/env bash
# Project-specific package smoke checks, sourced by scripts/test-package.sh with
# $consumer set to the install prefix of the packed tarball.
set -euo pipefail

# keytar is a native optional dependency; verify its install script supplied the
# binding. Do not load it here: Linux CI deliberately lacks libsecret, and the
# CLI falls back when no keyring is available.
test -f "$consumer/node_modules/keytar/build/Release/keytar.node"

# The tarball must declare the `strong` bin and ship the built dist/ directory
# (including dist/build-info.json, which the --version line reads).
node -e '
  const pkg = require(process.argv[1]);
  if (!pkg.bin?.strong || !pkg.files?.includes("dist")) process.exit(1)
' "$consumer/node_modules/@crcatala/strong-cli/package.json"
