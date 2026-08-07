# Releasing

This project uses [release-it](https://github.com/release-it/release-it) for manual
releases from a maintainer machine. A release validates the package, updates the
changelog and version, publishes `@crcatala/strong-cli` to npm, pushes a release
commit and tag, and creates a GitHub Release.

## Prerequisites

- Push access to `crcatala/strong-cli`
- An npm account with publish access to the `@crcatala` scope (`npm whoami`)
- A GitHub token available as `GITHUB_TOKEN` with repository **Contents: read and
  write** permission, so release-it can create the GitHub Release
- Node.js `^22.21.0 || >=24.0.0` (the release-it v21 requirement)
- A clean checkout on `main`

The package is public and installs the `strong` command.

## Before releasing

1. Update the local `main` branch:

   ```bash
   git checkout main
   git pull --ff-only
   ```

2. Prepare and update the changelog. The helper lists changes since the last tag
   and prints a prompt for drafting user-facing entries:

   ```bash
   npm run release:prep
   ```

   Add entries below `## [Unreleased]` in `CHANGELOG.md` using
   [Keep a Changelog](https://keepachangelog.com/) sections such as Added, Changed,
   Fixed, Removed, or Security.

3. Run the complete local verification suite:

   ```bash
   npm run verify
   ```

   This builds TypeScript, runs unit tests and linting, and smoke-tests the exact
   `npm pack` tarball with production dependencies installed.

## Release

For the initial release (when there is no prior release tag), publish the current
version:

```bash
npm run release:first
```

For all later releases, preview the process first:

```bash
npm run release:dry
```

`release:dry` disables npm and GitHub integrations, so it cannot publish or create
a GitHub Release. It still requires a clean `main` branch because that is an
invariant of the real release.

Then release interactively:

```bash
export GITHUB_TOKEN=github_pat_... # if not already configured
npm run release
```

Release-it prompts for the version bump and then:

1. verifies the clean `main` checkout, an unreleased changelog section, and
   `npm run verify`;
2. updates `package.json` and moves Unreleased changelog entries into the new version;
3. packs and smoke-tests the built npm artifact;
4. commits and tags `vX.Y.Z`;
5. publishes `@crcatala/strong-cli` publicly to npm;
6. pushes the release commit and tag; and
7. creates a GitHub Release using the changelog notes.

Useful recovery options:

```bash
# Skip npm publishing if it already succeeded in a partial release
npm run release -- --no-npm

# Skip GitHub Release creation
npm run release -- --no-github

# Release a specific version without the bump prompt
npm run release -- 0.1.0

# Publish a prerelease
npm run release -- --preRelease=alpha
```

## Verify the release

```bash
npm view @crcatala/strong-cli
npx -y @crcatala/strong-cli@latest --version
npx -y @crcatala/strong-cli@latest --help
```

Published npm versions are immutable. If a release has a defect, publish a
corrective version rather than replacing the existing version.
