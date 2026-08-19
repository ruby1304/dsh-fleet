import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stringify } from 'yaml'
import { describe, expect, it } from 'vitest'
import { createBootstrapIdentity, renderBootstrapBundle } from '../src/bootstrap/runtime.ts'
import { parseAgentConfig } from '../src/agent/config.ts'
import { parseFleetManifest } from '../src/host/core.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-bootstrap-'))
  const identityDirectory = join(root, 'identity')
  const outputDirectory = join(root, 'release-1')
  const packPath = join(root, 'team-pack.yaml')
  const overlayPath = join(root, 'device-overlay.yaml')
  await mkdir(identityDirectory, { mode: 0o700 })
  await writeFile(packPath, stringify({
    schemaVersion: 1,
    pack: { id: 'engineering', version: '1.0.0' },
    profile: { id: 'headless', dshRange: '>=0.1.0-rc.7 <0.2.0' },
    publicPlugins: [{ id: 'dsh-public-tool', source: { kind: 'npm', version: '1.0.0', integrity: 'sha512-QUJDRA==' } }],
    taskPolicy: { profiles: ['headless'], workspaceIds: ['fleet-repo'] },
    trustAnchors: [],
  }))
  await writeFile(overlayPath, stringify({
    schemaVersion: 1,
    team: { id: 'ruby-team' },
    device: { id: 'worker', assignedTo: 'owner', class: 'always-on-worker', channel: 'stable' },
    release: { id: 'headless-r1', version: '1.0.0' },
    privatePlugins: [{ id: 'dsh-private-tool', version: '2.0.0', digest: 'a'.repeat(64) }],
    workspacePaths: { 'fleet-repo': join(root, 'workspace') },
    trustedPeers: [],
    agent: {
      dshHome: join(root, 'dsh-home'),
      dshBinary: join(root, 'runtime/bin/dsh'),
      pnpmBinary: join(root, 'runtime/bin/pnpm'),
      stateDir: join(root, 'state'),
      artifactStore: join(root, 'artifacts'),
      tarBinary: '/usr/bin/tar',
      planTtlMs: 300000,
      restart: {
        kind: 'launchd', launchctlBinary: '/bin/launchctl', lsofBinary: '/usr/sbin/lsof', psBinary: '/bin/ps',
        ownerMarkers: ['@deepseek-ai/dsh/lib/bin.js'], serviceTarget: 'gui/502/com.example.dsh',
        host: '127.0.0.1', port: 3211, managedPorts: [3211],
      },
      health: { url: 'http://127.0.0.1:3211', timeoutMs: 45000, requireFleetRpc: true },
      maxMessageTtlMs: 900000,
      tasks: { enabled: true, timeoutMs: 3600000, maxOutputBytes: 1048576, maxConcurrent: 1 },
    },
  }))
  return { root, identityDirectory, outputDirectory, packPath, overlayPath }
}

describe('team bootstrap runtime', () => {
  it('creates an owner-only Ed25519 identity and a validated immutable device bundle', async () => {
    const paths = await fixture()
    const identity = await createBootstrapIdentity({
      outputDirectory: paths.identityDirectory,
      teamId: 'ruby-team', principalId: 'owner', deviceId: 'worker',
    })
    expect((await stat(identity.privateKeyPath)).mode & 0o777).toBe(0o600)
    expect((await stat(identity.invitePath)).mode & 0o777).toBe(0o600)

    const rendered = await renderBootstrapBundle(paths)
    expect(rendered.manifestDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(parseFleetManifest(await readFile(rendered.manifestPath, 'utf8')).schemaVersion).toBe(2)
    const agent = parseAgentConfig(JSON.parse(await readFile(rendered.agentConfigPath, 'utf8')) as unknown)
    expect(agent.a2a).toEqual(expect.objectContaining({ teamId: 'ruby-team', principalId: 'owner', privateKeyPath: identity.privateKeyPath }))
    expect(agent.tasks?.workspaces).toEqual({ 'fleet-repo': join(paths.root, 'workspace') })
    expect((await stat(rendered.agentConfigPath)).mode & 0o777).toBe(0o600)
  })

  it('refuses identity reuse, output overwrites and an identity for another device', async () => {
    const paths = await fixture()
    await createBootstrapIdentity({ outputDirectory: paths.identityDirectory, teamId: 'ruby-team', principalId: 'owner', deviceId: 'worker' })
    await expect(createBootstrapIdentity({
      outputDirectory: paths.identityDirectory, teamId: 'ruby-team', principalId: 'owner', deviceId: 'worker',
    })).rejects.toThrow(/refuses to overwrite/)
    await renderBootstrapBundle(paths)
    await expect(renderBootstrapBundle(paths)).rejects.toThrow(/refuses to overwrite/)

    const other = await fixture()
    await createBootstrapIdentity({ outputDirectory: other.identityDirectory, teamId: 'ruby-team', principalId: 'owner', deviceId: 'other-worker' })
    await expect(renderBootstrapBundle(other)).rejects.toThrow(/does not match the overlay/)
  })
})
