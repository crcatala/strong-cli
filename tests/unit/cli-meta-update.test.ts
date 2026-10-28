import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdate, packageMeta, runUpdate, versionDetails } from '../../src/cli-meta.js'

const tempDirs: string[] = []
const originalPath = process.env.PATH

function mkTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'strong-cli-update-'))
  tempDirs.push(dir)
  return dir
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** Put a fake `npm` first on PATH; every call it receives is appended to its log file. */
function installNpmStub(options: { globalRoot: string; view?: string; failInstall?: boolean }) {
  const bin = mkTemp()
  const log = join(bin, 'npm.log')
  const view = options.view === undefined ? 'exit 1' : `echo ${JSON.stringify(options.view)}`
  writeFileSync(
    join(bin, 'npm'),
    `#!/usr/bin/env bash
echo "npm $*" >> ${JSON.stringify(log)}
case "$1" in
  root) echo ${JSON.stringify(options.globalRoot)} ;;
  view) ${view} ;;
  install | add | run) exit ${options.failInstall ? 1 : 0} ;;
esac
`,
  )
  chmodSync(join(bin, 'npm'), 0o755)
  process.env.PATH = `${bin}:${originalPath}`
  return { calls: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') }
}

function captureConsole() {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '))
  })
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    err.push(args.join(' '))
  })
  return { out: () => out.join('\n'), err: () => err.join('\n') }
}

function writePackage(dir: string, pkg: Record<string, unknown> = {}): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: '@crcatala/strong-cli', version: '0.3.0', ...pkg }),
  )
}

/** A package installed globally with npm, plus a stub npm that knows that root. */
function npmGlobalFixture(
  pkg: Record<string, unknown> = {},
  stub: { view?: string; failInstall?: boolean } = {},
) {
  const globalRoot = join(mkTemp(), 'global')
  const root = join(globalRoot, 'node_modules', '@crcatala', 'strong-cli')
  mkdirSync(root, { recursive: true })
  writePackage(root, pkg)
  const npm = installNpmStub({ globalRoot, ...stub })
  return { meta: packageMeta(root), root, npm }
}

/** An origin repository on `main` and a clone of it carrying a stamped dist/. */
function checkoutFixture({ originAhead = false } = {}) {
  const origin = mkTemp()
  writeFileSync(
    join(origin, 'package.json'),
    JSON.stringify({ name: '@crcatala/strong-cli', version: '0.3.0' }),
  )
  writeFileSync(join(origin, '.gitignore'), 'dist/\n')
  git(origin, ['init', '-q', '-b', 'main'])
  git(origin, ['add', '-A'])
  git(origin, ['commit', '-q', '-m', 'init'])

  const root = join(mkTemp(), 'clone')
  git(mkTemp(), ['clone', '-q', origin, root])
  mkdirSync(join(root, 'dist'))
  writeFileSync(
    join(root, 'dist', 'build-info.json'),
    JSON.stringify({
      version: '0.3.0',
      commit: git(root, ['rev-parse', 'HEAD']),
      date: '2026-01-01',
      dirty: false,
    }),
  )

  if (originAhead) {
    writeFileSync(join(origin, 'next.txt'), 'next\n')
    git(origin, ['add', '-A'])
    git(origin, ['commit', '-q', '-m', 'next'])
  }
  return { origin, root, meta: packageMeta(root) }
}

/** A repository on main, plus a private package.json that points at it. */
function privateFixture({ withRepository = true } = {}) {
  const origin = mkTemp()
  writeFileSync(join(origin, 'README.md'), 'x\n')
  git(origin, ['init', '-q', '-b', 'main'])
  git(origin, ['add', '-A'])
  git(origin, ['commit', '-q', '-m', 'init'])
  const head = git(origin, ['rev-parse', 'HEAD'])

  const globalRoot = join(mkTemp(), 'global')
  const root = join(globalRoot, 'node_modules', '@crcatala', 'strong-cli')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: '@crcatala/strong-cli',
      version: '0.3.0',
      private: true,
      ...(withRepository ? { repository: origin } : {}),
    }),
  )
  return { origin, head, globalRoot, root, meta: packageMeta(root) }
}

afterEach(() => {
  process.env.PATH = originalPath
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('checkForUpdate for a published package (registry)', () => {
  it('reports a newer registry version as an update', () => {
    const { meta, npm } = npmGlobalFixture({}, { view: '0.4.0' })
    const status = checkForUpdate('npm', meta, { version: '0.3.0' })

    expect(status).toEqual({ current: '0.3.0', latest: '0.4.0', available: true })
    expect(npm.calls()).toContain('npm view @crcatala/strong-cli@latest version')
  })

  it('is up to date on the same version', () => {
    const { meta } = npmGlobalFixture({}, { view: '0.3.0' })
    expect(checkForUpdate('npm', meta, { version: '0.3.0' }).available).toBe(false)
  })

  it('says so when the registry cannot be reached', () => {
    const { meta } = npmGlobalFixture()
    expect(checkForUpdate('mise', meta, { version: '0.3.0' })).toEqual({
      current: '0.3.0',
      reason: 'could not reach the npm registry',
    })
  })
})

describe('checkForUpdate for an unpublished (private) package', () => {
  it('compares the build commit with the repository main branch', () => {
    const { meta, head } = privateFixture()
    expect(checkForUpdate('npm', meta, { version: '0.3.0', commit: head })).toEqual({
      current: head.slice(0, 7),
      latest: head.slice(0, 7),
      available: false,
    })
    expect(checkForUpdate('npm', meta, { version: '0.3.0', commit: 'a'.repeat(40) })).toEqual({
      current: 'aaaaaaa',
      latest: head.slice(0, 7),
      available: true,
    })
  })

  it('reports a build without a commit stamp', () => {
    const { meta, head } = privateFixture()
    expect(checkForUpdate('npm', meta, { version: '0.3.0' })).toEqual({
      current: '0.3.0',
      latest: head.slice(0, 7),
      reason: 'this build has no commit stamp',
    })
  })

  it('reports a package with no repository', () => {
    const { meta } = privateFixture({ withRepository: false })
    expect(checkForUpdate('npm', meta, { version: '0.3.0' })).toEqual({
      current: '0.3.0',
      reason: "could not read the repository's main branch",
    })
  })
})

describe('checkForUpdate in a checkout without a reachable origin', () => {
  it('says the fetch failed instead of guessing', () => {
    const root = mkTemp()
    writePackage(root)
    writeFileSync(join(root, '.gitignore'), 'dist/\n')
    git(root, ['init', '-q', '-b', 'main'])
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', 'init'])

    expect(checkForUpdate('checkout', packageMeta(root), { version: '0.3.0' })).toEqual({
      current: '0.3.0',
      reason: 'could not fetch origin/main',
    })
  })
})

describe('versionDetails', () => {
  it('reports a global npm install and its path', () => {
    const { meta, root } = npmGlobalFixture()
    expect(versionDetails(meta)).toMatchObject({ version: '0.3.0', install: 'npm', path: root })
  })

  it('reports an unrecognized install', () => {
    const root = join(mkTemp(), 'node_modules', '@crcatala', 'strong-cli')
    mkdirSync(root, { recursive: true })
    writePackage(root)
    expect(versionDetails(packageMeta(root)).install).toBe('unknown')
  })
})

/** A package outside any recognized install root, plus a stub npm with a different global root. */
function looseFixture(
  pkg: Record<string, unknown> = {},
  stub: { view?: string; failInstall?: boolean } = {},
) {
  const root = join(mkTemp(), 'node_modules', '@crcatala', 'strong-cli')
  mkdirSync(root, { recursive: true })
  writePackage(root, pkg)
  const npm = installNpmStub({ globalRoot: join(mkTemp(), 'global'), ...stub })
  return { meta: packageMeta(root), root, npm }
}

describe('runUpdate', () => {
  it('tells an npx install that npx always runs the latest version', () => {
    const root = join(mkTemp(), '_npx', 'abc', 'node_modules', '@crcatala', 'strong-cli')
    mkdirSync(root, { recursive: true })
    writePackage(root)
    const output = captureConsole()

    expect(runUpdate('strong', { check: true }, packageMeta(root))).toBe(0)
    expect(output.out()).toContain(
      '`npx @crcatala/strong-cli@latest` always runs the latest version',
    )
    expect(output.err()).toBe('')
  })

  it('reports an up-to-date checkout and touches nothing', () => {
    const { root, meta } = checkoutFixture()
    const head = git(root, ['rev-parse', 'HEAD'])
    const output = captureConsole()

    expect(runUpdate('strong', {}, meta)).toBe(0)
    expect(output.out()).toContain('strong is up to date')
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(head)
  })

  it('reports an available checkout update with --check, without changing it', () => {
    const { root, meta } = checkoutFixture({ originAhead: true })
    const head = git(root, ['rev-parse', 'HEAD'])
    const output = captureConsole()

    expect(runUpdate('strong', { check: true }, meta)).toBe(1)
    expect(output.out()).toContain('update available')
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(head)
  })

  it('pulls, installs and rebuilds a checkout', () => {
    const { origin, root, meta } = checkoutFixture({ originAhead: true })
    const npm = installNpmStub({ globalRoot: join(mkTemp(), 'global') })
    const output = captureConsole()

    expect(runUpdate('strong', {}, meta)).toBe(0)
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(git(origin, ['rev-parse', 'HEAD']))
    expect(npm.calls()).toContain('npm install')
    expect(npm.calls()).toContain('npm run build')
    expect(output.out()).toContain('strong updated.')
  })

  it('refuses to update a dirty checkout', () => {
    const { root, meta } = checkoutFixture()
    writeFileSync(join(root, 'edited.txt'), 'local\n')
    const output = captureConsole()

    expect(runUpdate('strong', { force: true }, meta)).toBe(1)
    expect(output.err()).toContain('must be clean and on main')
    expect(output.err()).toContain('it is dirty')
  })

  it('refuses to update a checkout that is not on main', () => {
    const { root, meta } = checkoutFixture()
    git(root, ['checkout', '-q', '-b', 'feature'])
    const output = captureConsole()

    expect(runUpdate('strong', { force: true }, meta)).toBe(1)
    expect(output.err()).toContain('on feature')
  })

  it('names a detached HEAD', () => {
    const { root, meta } = checkoutFixture()
    git(root, ['checkout', '-q', '--detach', 'HEAD'])
    const output = captureConsole()

    expect(runUpdate('strong', { force: true }, meta)).toBe(1)
    expect(output.err()).toContain('a detached HEAD')
  })
})

describe('runUpdate for a published global npm install', () => {
  it('reports an available update with --check', () => {
    const { meta } = npmGlobalFixture({}, { view: '0.4.0' })
    const output = captureConsole()

    expect(runUpdate('strong', { check: true }, meta)).toBe(1)
    expect(output.out()).toContain('update available, 0.3.0 → 0.4.0')
  })

  it('reinstalls the package from the registry', () => {
    const { meta, npm } = npmGlobalFixture({}, { view: '0.4.0' })
    const output = captureConsole()

    expect(runUpdate('strong', {}, meta)).toBe(0)
    expect(npm.calls()).toContain('npm install -g @crcatala/strong-cli@latest')
    expect(output.out()).toContain('strong updated.')
  })

  it('reports a failing step and how to retry it', () => {
    const { meta } = npmGlobalFixture({}, { view: '0.4.0', failInstall: true })
    const output = captureConsole()

    expect(runUpdate('strong', {}, meta)).toBe(1)
    expect(output.err()).toContain('failed')
    expect(output.err()).toContain('run `strong update` again')
  })

  it('explains how to update an unrecognized install', () => {
    const { meta } = looseFixture({}, { view: '0.4.0' })
    const output = captureConsole()

    expect(runUpdate('strong', { check: true }, meta)).toBe(1)
    expect(runUpdate('strong', {}, meta)).toBe(1)
    expect(output.err()).toContain('which is not a recognized install method')
    expect(output.err()).toContain('npm install -g @crcatala/strong-cli@latest')
  })
})

describe('runUpdate for a private package whose latest is unknown', () => {
  it('returns 2 from --check instead of guessing', () => {
    const { meta } = privateFixture()
    const output = captureConsole()

    expect(runUpdate('strong', { check: true }, meta)).toBe(2)
    expect(output.err()).toContain('cannot tell whether an update is available')
  })

  it('reinstalls from the repository with --force', () => {
    const { origin, meta, npm } = (() => {
      const fixture = privateFixture()
      const npm = installNpmStub({ globalRoot: fixture.globalRoot })
      return { ...fixture, npm }
    })()
    const output = captureConsole()

    expect(runUpdate('strong', { force: true }, meta)).toBe(0)
    expect(npm.calls()).toContain(`npm install -g git+${origin}`)
    expect(output.out()).toContain('strong updated.')
  })
})
