import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'

const RC8 = '0.1.0-rc.8'
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN_DIR = join(ROOT, 'node_modules', '.bin')
const DSH_BIN = join(BIN_DIR, 'dsh')
const PROFILE = 'fleet-smoke'
const FIXTURE_NAME = '@dsh-fleet-test/rc8-bundle'
const FIXTURE_VERSION = '1.0.0'
const roots: string[] = []

interface PackageManifest {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dsh?: {
    profile?: { bundles?: string[] }
  }
}

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

function runDsh(args: string[], dshHome: string): Promise<{ stdout: string, stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    execFile(DSH_BIN, args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        PATH: `${BIN_DIR}${delimiter}${process.env.PATH ?? ''}`,
      },
    }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(Object.assign(error, { stdout, stderr }))
        return
      }
      resolvePromise({ stdout, stderr })
    })
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('DSH rc.8 contract', () => {
  it('pins and installs the official Host, Client and settings contracts at exactly rc.8', async () => {
    const workspace = await readManifest(join(ROOT, 'package.json'))
    const packages = [
      '@deepseek-ai/dsh',
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-host-apiproxy',
    ]

    for (const packageName of packages) {
      expect(workspace.devDependencies?.[packageName]).toBe(RC8)
      const installed = await readManifest(join(ROOT, 'node_modules', packageName, 'package.json'))
      expect(installed.name).toBe(packageName)
      expect(installed.version).toBe(RC8)
    }
  })

  it('compiles against the official host/client generic RPC shapes', () => {
    expectTypeOf<Parameters<ConnectionRpcHandler>>()
      .toEqualTypeOf<[string, unknown, AbortSignal]>()
    expectTypeOf<ReturnType<ConnectionRpcHandler>>()
      .toEqualTypeOf<Promise<RpcResult<unknown>>>()
    expectTypeOf<ReturnType<HostConnectionHandle['rpc']['handle']>>()
      .toEqualTypeOf<() => Promise<void>>()
    expectTypeOf<ReturnType<ClientConnectionRpc['call']>>()
      .toEqualTypeOf<Promise<RpcResult<unknown>>>()
  })

  it('uses the absolute rc.8 CLI and reconciles one exact local bundle into only fleet-smoke', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'dsh-rc8-contract-'))
    roots.push(sandbox)
    const dshHome = join(sandbox, 'dsh-home')
    const fixtureDir = join(sandbox, 'fixture')
    await mkdir(dshHome, { recursive: true })
    await mkdir(fixtureDir, { recursive: true })
    await writeFile(join(fixtureDir, 'package.json'), JSON.stringify({
      name: FIXTURE_NAME,
      version: FIXTURE_VERSION,
      private: true,
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, null, 2))
    await writeFile(join(fixtureDir, 'cordis.patch.yml'), '[]\n')

    expect(isAbsolute(DSH_BIN)).toBe(true)
    const version = await runDsh(['--version'], dshHome)
    expect(version.stdout.trim()).toBe(RC8)

    await runDsh([
      'plugin',
      '--profile', PROFILE,
      'add',
      '--save-exact',
      '--offline',
      '--ignore-scripts',
      `link:${fixtureDir}`,
    ], dshHome)

    const profilesDir = join(dshHome, 'profiles')
    expect(await readdir(profilesDir)).toEqual([PROFILE])
    const profileDir = join(profilesDir, PROFILE)
    const profile = await readManifest(join(profileDir, 'package.json'))
    const dependencySpec = profile.dependencies?.[FIXTURE_NAME]
    expect(dependencySpec).toMatch(/^link:/)
    const linkTarget = dependencySpec?.slice('link:'.length)
    expect(linkTarget).toBeDefined()
    const resolvedTarget = isAbsolute(linkTarget!) ? linkTarget! : resolve(profileDir, linkTarget!)
    expect(await realpath(resolvedTarget)).toBe(await realpath(fixtureDir))

    const installed = await readManifest(join(profileDir, 'node_modules', FIXTURE_NAME, 'package.json'))
    expect(installed.version).toBe(FIXTURE_VERSION)
    expect(profile.dsh?.profile?.bundles?.filter(name => name === FIXTURE_NAME)).toEqual([FIXTURE_NAME])
  }, 45_000)
})
