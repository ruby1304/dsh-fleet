import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectCurrentRuntimeIdentity, validateRuntimeIdentity } from '../src/host/runtime-identity.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ node: string; entrypoint: string; entrypointSource: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-runtime-identity-'))
  roots.push(root)
  const release = join(root, 'releases', 'rc7')
  const packageRoot = join(release, 'node_modules', '@deepseek-ai', 'dsh')
  await mkdir(join(packageRoot, 'lib'), { recursive: true })
  await mkdir(join(release, 'node', 'bin'), { recursive: true })
  const node = join(release, 'node', 'bin', 'node')
  const entrypoint = join(packageRoot, 'lib', 'bin.js')
  const entrypointSource = '#!/usr/bin/env node\nprocess.stdout.write("ok")\n'
  await writeFile(node, '#!/bin/sh\nexit 0\n')
  await chmod(node, 0o755)
  await writeFile(entrypoint, entrypointSource)
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.8' }) + '\n')
  const current = join(root, 'current')
  await symlink(release, current)
  return {
    node: join(current, 'node', 'bin', 'node'),
    entrypoint: join(current, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    entrypointSource,
  }
}

describe('running DSH runtime identity', () => {
  it('binds immutable realpaths, package version and entrypoint bytes', async () => {
    const state = await fixture()
    const identity = await inspectCurrentRuntimeIdentity({ execPath: state.node, entrypointPath: state.entrypoint })
    expect(identity).toMatchObject({
      nodeRealpath: await realpath(state.node),
      dshEntrypointRealpath: await realpath(state.entrypoint),
      dshVersion: '0.1.0-rc.8',
      entrypointDigest: createHash('sha256').update(state.entrypointSource).digest('hex'),
      runtimeDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(() => validateRuntimeIdentity(identity)).not.toThrow()
    expect(() => validateRuntimeIdentity({ ...identity, dshVersion: '0.1.0-rc.5' })).toThrow(/digest/)
  })

  it('rejects an entrypoint outside an identifiable DSH package', async () => {
    const state = await fixture()
    const unrelated = join(roots.at(-1)!, 'unrelated.mjs')
    await writeFile(unrelated, 'export {}\n')
    await expect(inspectCurrentRuntimeIdentity({ execPath: state.node, entrypointPath: unrelated })).rejects.toThrow(/metadata/)
  })
})
