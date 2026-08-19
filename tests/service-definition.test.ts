import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectLaunchdServiceDefinition } from '../src/agent/service-definition.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ source: string; dshHome: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-launchd-definition-'))
  roots.push(root)
  const packageRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh')
  const node = join(root, 'node', 'bin', 'node')
  const entrypoint = join(packageRoot, 'lib', 'bin.js')
  const dshHome = join(root, 'dsh-home')
  await Promise.all([
    mkdir(join(root, 'node', 'bin'), { recursive: true }),
    mkdir(join(packageRoot, 'lib'), { recursive: true }),
  ])
  await writeFile(node, '#!/bin/sh\nexit 0\n')
  await writeFile(entrypoint, 'process.stdout.write("ready")\n')
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.7' }) + '\n')
  return {
    dshHome,
    source: `gui/502/com.example.dsh-web = {
\tprogram = ${node}
\targuments = {
\t\t${node}
\t\t${entrypoint}
\t\tweb
\t\t--host
\t\t127.0.0.1
\t\t--port
\t\t3080
\t}
\tenvironment = {
\t\tPATH => /usr/bin:/bin
\t\tDSH_HOME => ${dshHome}
\t}
\tpid = 1234
}
`,
  }
}

describe('launchd service definition identity', () => {
  it('binds the exact service arguments to the referenced DSH runtime', async () => {
    const state = await fixture()
    await expect(inspectLaunchdServiceDefinition({
      source: state.source,
      serviceTarget: 'gui/502/com.example.dsh-web',
      dshHome: state.dshHome,
      host: '127.0.0.1',
      port: 3080,
    })).resolves.toMatchObject({
      serviceTarget: 'gui/502/com.example.dsh-web',
      dshHome: state.dshHome,
      serviceDefinitionDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      runtimeIdentity: {
        dshVersion: '0.1.0-rc.7',
        runtimeDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      pid: 1234,
    })
  })

  it('rejects a service that will restart another host, port or DSH_HOME', async () => {
    const state = await fixture()
    await expect(inspectLaunchdServiceDefinition({
      source: state.source.replace('\t\t3080\n', '\t\t3211\n'),
      serviceTarget: 'gui/502/com.example.dsh-web',
      dshHome: state.dshHome,
      host: '127.0.0.1',
      port: 3080,
    })).rejects.toThrow(/arguments/)
    await expect(inspectLaunchdServiceDefinition({
      source: state.source,
      serviceTarget: 'gui/502/com.example.dsh-web',
      dshHome: state.dshHome + '-other',
      host: '127.0.0.1',
      port: 3080,
    })).rejects.toThrow(/DSH_HOME/)
  })
})
