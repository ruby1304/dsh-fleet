import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectLaunchdServiceDefinition } from '../src/agent/service-definition.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(input: {
  dshVersion?: string
  webArguments?: string[]
} = {}): Promise<{ source: string; dshHome: string }> {
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
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    version: input.dshVersion ?? '0.1.0-rc.8',
  }) + '\n')
  const webArguments = input.webArguments ?? ['web', '--no-open', '--host', '127.0.0.1', '--port', '3080']
  return {
    dshHome,
    source: `gui/502/com.example.dsh-web = {
\tprogram = ${node}
\targuments = {
\t\t${node}
\t\t${entrypoint}
${webArguments.map(argument => `\t\t${argument}\n`).join('')}\t}
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
  it('binds the exact rc.8 --no-open service arguments to the referenced DSH runtime', async () => {
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
        dshVersion: '0.1.0-rc.8',
        runtimeDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      programArguments: expect.arrayContaining(['web', '--no-open', '--host', '127.0.0.1', '--port', '3080']),
      pid: 1234,
    })
  })

  it('retains the exact seven-item rc.7 legacy service contract', async () => {
    const state = await fixture({
      dshVersion: '0.1.0-rc.7',
      webArguments: ['web', '--host', '127.0.0.1', '--port', '3080'],
    })
    await expect(inspectLaunchdServiceDefinition({
      source: state.source,
      serviceTarget: 'gui/502/com.example.dsh-web',
      dshHome: state.dshHome,
      host: '127.0.0.1',
      port: 3080,
    })).resolves.toMatchObject({
      runtimeIdentity: { dshVersion: '0.1.0-rc.7' },
      programArguments: expect.not.arrayContaining(['--no-open']),
    })
  })

  it.each([
    ['extra flag', ['web', '--no-open', '--host', '127.0.0.1', '--port', '3080', '--verbose']],
    ['duplicate flag', ['web', '--no-open', '--no-open', '--host', '127.0.0.1', '--port', '3080']],
    ['misplaced flag', ['web', '--host', '127.0.0.1', '--no-open', '--port', '3080']],
    ['wrong flag', ['web', '--no-browser', '--host', '127.0.0.1', '--port', '3080']],
  ])('rejects an rc.8 service with an %s', async (_label, webArguments) => {
    const state = await fixture({ webArguments })
    await expect(inspectLaunchdServiceDefinition({
      source: state.source,
      serviceTarget: 'gui/502/com.example.dsh-web',
      dshHome: state.dshHome,
      host: '127.0.0.1',
      port: 3080,
    })).rejects.toThrow(/arguments/)
  })

  it('requires the exact argument contract for the observed rc.7 or rc.8 runtime', async () => {
    const rc8Legacy = await fixture({
      webArguments: ['web', '--host', '127.0.0.1', '--port', '3080'],
    })
    await expect(inspectLaunchdServiceDefinition({
      source: rc8Legacy.source,
      serviceTarget: 'gui/502/com.example.dsh-web',
      dshHome: rc8Legacy.dshHome,
      host: '127.0.0.1',
      port: 3080,
    })).rejects.toThrow(/0\.1\.0-rc\.8 requires --no-open/)

    const rc7NoOpen = await fixture({ dshVersion: '0.1.0-rc.7' })
    await expect(inspectLaunchdServiceDefinition({
      source: rc7NoOpen.source,
      serviceTarget: 'gui/502/com.example.dsh-web',
      dshHome: rc7NoOpen.dshHome,
      host: '127.0.0.1',
      port: 3080,
    })).rejects.toThrow(/0\.1\.0-rc\.7 requires the legacy/)
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
