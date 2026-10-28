import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildInfo,
  checkForUpdate,
  compareVersions,
  detectInstall,
  formatVersion,
  gitCloneUrl,
  gitInstallUrl,
  packageMeta,
  updateSteps,
} from '../../src/cli-meta.js'

const tempDirs: string[] = []

function mkTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'strong-cli-meta-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

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

function meta(overrides: Partial<ReturnType<typeof packageMeta>> = {}) {
  return {
    root: '/x',
    name: '@crcatala/strong-cli',
    version: '1.0.0',
    isPrivate: false,
    ...overrides,
  }
}

describe('formatVersion', () => {
  it('prints the version, short commit and commit date', () => {
    expect(
      formatVersion('strong', { version: '1.4.2', commit: 'a1b2c3d4e5f6', date: '2026-10-27' }),
    ).toBe('strong 1.4.2 (a1b2c3d 2026-10-27)')
  })

  it('marks dirty builds', () => {
    expect(
      formatVersion('strong', {
        version: '1.4.2',
        commit: 'a1b2c3d4e5f6',
        date: '2026-10-27',
        dirty: true,
      }),
    ).toBe('strong 1.4.2 (a1b2c3d-dirty 2026-10-27)')
  })

  it('prints no empty parentheses without a commit', () => {
    expect(formatVersion('strong', { version: '1.4.2' })).toBe('strong 1.4.2')
  })
})

describe('detectInstall', () => {
  it('recognizes a checkout first', () => {
    expect(detectInstall('/Users/u/src/strong-cli', true)).toBe('checkout')
  })

  it('recognizes npx, mise, bun and pnpm global installs', () => {
    expect(detectInstall('/Users/u/.npm/_npx/abc/node_modules/pkg', false)).toBe('npx')
    expect(
      detectInstall(
        '/Users/u/.local/share/mise/installs/npm-pkg/1.0.0/lib/node_modules/pkg',
        false,
      ),
    ).toBe('mise')
    expect(detectInstall('/Users/u/.bun/install/global/node_modules/pkg', false)).toBe('bun')
    expect(detectInstall('/Users/u/.local/share/pnpm/global/5/node_modules/pkg', false)).toBe(
      'pnpm',
    )
  })

  it('recognizes a global npm install by its root', () => {
    expect(detectInstall('/usr/lib/node_modules/pkg', false, '/usr/lib/node_modules')).toBe('npm')
  })

  it('treats a project dependency as unknown', () => {
    expect(detectInstall('/proj/node_modules/pkg', false, '/usr/lib/node_modules')).toBe('unknown')
  })
})

describe('updateSteps', () => {
  it('uses @latest for registry installs', () => {
    expect(updateSteps('npm', meta())).toEqual([
      { cmd: 'npm', args: ['install', '-g', '@crcatala/strong-cli@latest'] },
    ])
    expect(updateSteps('mise', meta())).toEqual([
      { cmd: 'mise', args: ['upgrade', '--bump', 'npm:@crcatala/strong-cli'] },
    ])
    expect(updateSteps('pnpm', meta())).toEqual([
      { cmd: 'pnpm', args: ['add', '-g', '@crcatala/strong-cli@latest'] },
    ])
    expect(updateSteps('bun', meta())).toEqual([
      { cmd: 'bun', args: ['add', '-g', '@crcatala/strong-cli@latest'] },
    ])
  })

  it('reinstalls an unpublished package from git, never from the registry', () => {
    const priv = meta({ isPrivate: true, repositoryUrl: 'github:crcatala/strong-cli' })
    const url = 'git+https://github.com/crcatala/strong-cli.git'
    expect(updateSteps('npm', priv)).toEqual([{ cmd: 'npm', args: ['install', '-g', url] }])
    expect(updateSteps('pnpm', priv)).toEqual([{ cmd: 'pnpm', args: ['add', '-g', url] }])
    expect(updateSteps('bun', priv)).toEqual([{ cmd: 'bun', args: ['add', '-g', url] }])
    expect(updateSteps('mise', priv)).toBeNull()
    expect(updateSteps('npm', meta({ isPrivate: true }))).toBeNull()
  })

  it('pulls, installs and rebuilds a checkout with its package manager', () => {
    const steps = updateSteps('checkout', meta(), 'pnpm') ?? []
    expect(steps.map((s) => [s.cmd, ...s.args].join(' '))).toEqual([
      'git pull --ff-only origin main',
      'pnpm install',
      'pnpm run build',
    ])
  })

  it('has no steps for npx or an unknown install', () => {
    expect(updateSteps('unknown', meta())).toBeNull()
    expect(updateSteps('npx', meta())).toBeNull()
  })
})

describe('repository URLs', () => {
  it('normalizes once for git and for installers', () => {
    const cases: Array<[string, string]> = [
      ['github:crcatala/strong-cli', 'https://github.com/crcatala/strong-cli.git'],
      ['crcatala/strong-cli', 'https://github.com/crcatala/strong-cli.git'],
      ['crcatala/strong-cli.git', 'https://github.com/crcatala/strong-cli.git'],
      ['git@github.com:crcatala/strong-cli.git', 'ssh://git@github.com/crcatala/strong-cli.git'],
      ['https://github.com/crcatala/strong-cli.git', 'https://github.com/crcatala/strong-cli.git'],
      [
        'git+https://github.com/crcatala/strong-cli.git',
        'https://github.com/crcatala/strong-cli.git',
      ],
    ]
    for (const [input, clone] of cases) {
      expect(gitCloneUrl(input), input).toBe(clone)
      expect(gitInstallUrl(input), input).toBe(`git+${clone}`)
    }
  })
})

describe('compareVersions', () => {
  it('orders versions, tolerating a v prefix and prereleases', () => {
    expect(compareVersions('1.2.3', '1.10.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0)
  })
})

describe('packageMeta and buildInfo', () => {
  it('walks up to package.json and prefers the build stamp', () => {
    const root = mkTemp()
    mkdirSync(join(root, 'dist', 'cli'), { recursive: true })
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: '@crcatala/strong-cli',
        version: '0.3.0',
        private: true,
        repository: { url: 'github:crcatala/strong-cli' },
      }),
    )
    writeFileSync(
      join(root, 'dist', 'build-info.json'),
      JSON.stringify({
        version: '0.3.0',
        commit: 'f'.repeat(40),
        date: '2026-01-02',
        dirty: false,
      }),
    )

    const m = packageMeta(join(root, 'dist', 'cli'))
    expect(m.name).toBe('@crcatala/strong-cli')
    expect(m.isPrivate).toBe(true)
    expect(m.repositoryUrl).toBe('github:crcatala/strong-cli')
    expect(formatVersion('strong', buildInfo(m))).toBe('strong 0.3.0 (fffffff 2026-01-02)')
  })

  it('falls back to git in a checkout without a build', () => {
    const root = mkTemp()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 't', version: '0.1.0' }))
    writeFileSync(join(root, '.gitignore'), 'dist/\n')
    git(root, ['init', '-q', '-b', 'main'])
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', 'init'])

    const info = buildInfo(packageMeta(root))
    expect(info.commit).toBe(git(root, ['rev-parse', 'HEAD']))
    expect(info.date).toBe(git(root, ['show', '-s', '--format=%cs', 'HEAD']))
    expect(info.dirty).toBe(false)
  })

  it('reports the stamp from dist/ and git from src/', () => {
    const root = mkTemp()
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 't', version: '0.1.0' }))
    writeFileSync(join(root, '.gitignore'), 'dist/\n')
    writeFileSync(
      join(root, 'dist', 'build-info.json'),
      JSON.stringify({
        version: '0.1.0',
        commit: 'e'.repeat(40),
        date: '2026-01-01',
        dirty: false,
      }),
    )
    git(root, ['init', '-q', '-b', 'main'])
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', 'init'])
    writeFileSync(join(root, 'src', 'edited.ts'), 'x')

    const m = packageMeta(root)
    expect(buildInfo(m, join(root, 'dist')).commit).toBe('e'.repeat(40))
    const fromSource = buildInfo(m, join(root, 'src'))
    expect(fromSource.commit).toBe(git(root, ['rev-parse', 'HEAD']))
    expect(fromSource.dirty).toBe(true)
  })

  it('prints the version alone outside git', () => {
    const root = mkTemp()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 't', version: '0.1.0' }))
    expect(buildInfo(packageMeta(root))).toEqual({ version: '0.1.0' })
  })
})

describe('checkForUpdate in a checkout', () => {
  // A clone of a one-commit origin, with dist/ stamped at `stampAt` (a commit id or "head").
  function clone(stampAt: 'head' | string, dirty = false) {
    const origin = mkTemp()
    writeFileSync(join(origin, 'package.json'), JSON.stringify({ name: 't', version: '0.1.0' }))
    writeFileSync(join(origin, '.gitignore'), 'dist/\n')
    git(origin, ['init', '-q', '-b', 'main'])
    git(origin, ['add', '-A'])
    git(origin, ['commit', '-q', '-m', 'init'])

    const root = join(mkTemp(), 'clone')
    git(origin, ['clone', '-q', origin, root])
    const head = git(root, ['rev-parse', 'HEAD'])
    mkdirSync(join(root, 'dist'))
    const commit = stampAt === 'head' ? head : stampAt
    writeFileSync(
      join(root, 'dist', 'build-info.json'),
      JSON.stringify({ version: '0.1.0', commit, date: '2026-01-01', dirty }),
    )
    const m = packageMeta(root)
    return {
      m,
      root,
      head,
      status: () => checkForUpdate('checkout', m, buildInfo(m, join(root, 'dist'))),
    }
  }

  it('is up to date when the build is the checkout', () => {
    expect(clone('head').status().available).toBe(false)
  })

  it('offers the update when the build is older than the checkout', () => {
    const { status, head } = clone('a'.repeat(40))
    const s = status()
    expect(s.available).toBe(true)
    expect(s.current).toBe('aaaaaaa')
    expect(s.latest).toBe(head.slice(0, 7))
    expect(s.note).toMatch(/build is older/)
  })

  it('offers a rebuild when a dirty build is no longer dirty', () => {
    const { status, head } = clone('head', true)
    const s = status()
    expect(s.available).toBe(true)
    expect(s.current).toBe(`${head.slice(0, 7)}-dirty`)
    expect(s.note).toMatch(/uncommitted edits/)
  })

  it('is up to date when the dirty edits are still present', () => {
    const { status, root } = clone('head', true)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 't', version: '0.1.0', x: 1 }))
    expect(status().available).toBe(false)
  })
})
