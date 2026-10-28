# Releasing

Releases are cut by hand from a clean `main` with
[release-it](https://github.com/release-it/release-it), wrapped by
`scripts/release.mjs`. One command bumps the version, moves the changelog's
Unreleased section into the new version, commits, tags `vX.Y.Z`, pushes,
creates the GitHub Release, and then publishes `@crcatala/strong-cli` to npm
from the tagged commit. The `strong` command is what the package installs.

## Prerequisites

- Push access to `crcatala/strong-cli`.
- A GitHub token with repository **Contents: read and write** permission for
  the GitHub Release, available as `GITHUB_TOKEN` (otherwise release-it opens
  the release form in the browser).
- An npm login with publish rights to the `@crcatala` scope: `npm whoami`,
  else `npm login`.
- Node.js `^22.21.0 || >=24.0.0` (the release-it v21 requirement).
- A clean checkout on `main`.

## Before releasing

1. Start from an up-to-date `main`:

   ```bash
   git checkout main
   git pull --ff-only
   ```

2. Draft the changelog:

   ```bash
   npm run release:prep
   ```

   Paste the output into an LLM, review the result, and put it under
   `## [Unreleased]` in `CHANGELOG.md` (Added, Changed, Fixed, Removed,
   Security; user-facing changes only). Commit it to `main` and push.

## Release

```bash
npm run release:dry       # preview; changes nothing and skips the hooks
npm run release           # asks for the version; or: npm run release -- patch|minor|major
```

In order, `npm run release`:

1. refuses to start when not logged in to npm or when `HEAD` is already a release;
2. checks that Unreleased has entries and runs `npm run verify`;
3. bumps the version and the changelog, then runs `npm run test:package` (packs
   the tarball, installs it, and checks `--help` and the `--version` line for
   `strong`);
4. commits `chore: release vX.Y.Z`, tags `vX.Y.Z`, pushes both;
5. creates the GitHub Release;
6. publishes to npm from the tagged commit (npm may ask for a one-time password).

A prerelease is published under a dist-tag named after its identifier, so
`latest` keeps pointing at the last full release:

```bash
npm run release -- --preRelease=beta    # 1.3.0-beta.0, published as @crcatala/strong-cli@beta
npm run release -- --preRelease=beta --npm.tag=next    # same version, under "next"
```

`npm run release -- <version> --npm.allowSameVersion` re-releases the version
already in `package.json` (there is no `release:first`).

## When a step fails

- **Before the commit** (steps 1–3): nothing was changed on the remote. Fix the
  cause and run `npm run release` again; `git checkout -- .` discards a
  half-made bump.
- **GitHub Release** (step 5): the tag is pushed. Create the release from the
  tag with that version's CHANGELOG section as notes
  (`gh release create vX.Y.Z --title vX.Y.Z --notes-file <section>`), then run
  `npm run release:publish`.
- **npm publish** (step 6): the tag is pushed; only the publish is left. Run
  `npm run release:publish` from the tagged commit (it picks the prerelease
  dist-tag again; `npm run release:publish -- --tag <tag>` chooses another).

Published npm versions are immutable: if a release has a defect, publish a
corrective version rather than replacing the existing one.

## Verify

```bash
npm view @crcatala/strong-cli version
npx -y @crcatala/strong-cli@latest --version   # strong X.Y.Z (sha7 YYYY-MM-DD)
npx -y @crcatala/strong-cli@latest --help
```
