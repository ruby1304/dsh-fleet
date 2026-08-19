import { generateKeyPairSync } from 'node:crypto'
import { stringify } from 'yaml'
import { describe, expect, it } from 'vitest'
import { a2aKeyId, type FleetA2AKind } from '../src/a2a/protocol.ts'
import { createTeamAgentConfig, instantiateTeamPack, parseTeamOverlay, parseTeamPack } from '../src/bootstrap/team-pack.ts'
import { parseAgentConfig } from '../src/agent/config.ts'
import { parseFleetManifest } from '../src/host/core.ts'

function peer(deviceId: string, allowedKinds: FleetA2AKind[]) {
  const { publicKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  return {
    keyId: a2aKeyId(publicKey),
    principalId: 'owner',
    deviceId,
    publicKeyPem,
    allowedKinds,
  }
}

function packSource(trustAnchors: unknown[] = []): string {
  return stringify({
    schemaVersion: 1,
    pack: { id: 'engineering', version: '1.2.0' },
    profile: { id: 'web', dshRange: '>=0.1.0-rc.7 <0.2.0' },
    publicPlugins: [{
      id: 'dsh-public-tool',
      source: { kind: 'npm', version: '2.1.0', integrity: 'sha512-QUJDRA==' },
      runtimeModules: ['dsh-public-tool'],
    }],
    taskPolicy: { profiles: ['headless'], workspaceIds: ['fleet-repo'] },
    trustAnchors,
  })
}

function overlaySource(trustedPeers: unknown[] = []): string {
  return stringify({
    schemaVersion: 1,
    team: { id: 'ruby-team', name: 'Ruby team' },
    device: { id: 'worker', assignedTo: 'owner', class: 'always-on-worker', channel: 'stable' },
    release: { id: 'web-2026-08', version: '3.0.0' },
    privatePlugins: [{
      id: 'dsh-private-tool',
      version: '4.5.0',
      digest: '1'.repeat(64),
      runtimeModules: ['@example/dsh-private-host'],
    }],
    workspacePaths: { 'fleet-repo': '/Users/example/Local/dsh-fleet' },
    trustedPeers,
    agent: {
      dshHome: '/Users/example/.dsh',
      dshBinary: '/Users/example/.local/share/dsh-runtime/current/bin/dsh',
      pnpmBinary: '/Users/example/.local/bin/pnpm',
      stateDir: '/Users/example/.local/state/dsh-fleet/web',
      artifactStore: '/Users/example/.local/share/dsh-fleet/artifacts',
      tarBinary: '/usr/bin/tar',
      planTtlMs: 300000,
      restart: {
        kind: 'launchd',
        launchctlBinary: '/bin/launchctl',
        lsofBinary: '/usr/sbin/lsof',
        psBinary: '/bin/ps',
        ownerMarkers: ['@deepseek-ai/dsh/lib/bin.js'],
        serviceTarget: 'gui/502/com.example.dsh-web',
        host: '127.0.0.1',
        port: 3211,
        managedPorts: [3211],
      },
      health: { url: 'http://127.0.0.1:3211', timeoutMs: 45000, requireFleetRpc: true },
      maxMessageTtlMs: 900000,
      tasks: { enabled: true, timeoutMs: 3600000, maxOutputBytes: 1048576, maxConcurrent: 1 },
    },
  })
}

describe('public team packs and private device overlays', () => {
  it('instantiates one immutable public/private release, trust store and fixed task policy', () => {
    const federation = peer('partner', ['handoff', 'receipt'])
    const controller = peer('controller', ['task.submit', 'task.status', 'task.cancel'])
    const result = instantiateTeamPack(
      parseTeamPack(packSource([federation])),
      parseTeamOverlay(overlaySource([controller])),
    )
    const manifest = parseFleetManifest(result.manifestYaml)

    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.v2?.assignments.worker?.web).toBe('web-2026-08')
    expect(manifest.v2?.profileReleases['web-2026-08']?.plugins).toEqual([
      expect.objectContaining({ id: 'dsh-public-tool', visibility: 'public', source: expect.objectContaining({ kind: 'npm', version: '2.1.0' }) }),
      expect.objectContaining({ id: 'dsh-private-tool', visibility: 'private', runtimeModules: ['@example/dsh-private-host'], source: { kind: 'artifact', version: '4.5.0', digest: '1'.repeat(64) } }),
    ])
    expect(JSON.parse(result.trustStoreJson)).toEqual(expect.objectContaining({
      schemaVersion: 1,
      teamId: 'ruby-team',
      entries: [expect.objectContaining({ deviceId: 'partner' }), expect.objectContaining({ deviceId: 'controller' })],
    }))
    expect(result.taskPolicy).toEqual({ profiles: ['headless'], workspaces: { 'fleet-repo': '/Users/example/Local/dsh-fleet' } })
    const agent = parseAgentConfig(JSON.parse(createTeamAgentConfig(
      parseTeamPack(packSource([federation])),
      parseTeamOverlay(overlaySource([controller])),
      {
        manifestPath: '/Users/example/.config/dsh-fleet/releases/r1/fleet.lock.yaml',
        trustStorePath: '/Users/example/.config/dsh-fleet/releases/r1/trust-store.json',
        privateKeyPath: '/Users/example/.config/dsh-fleet/identity.private.pem',
      },
    )))
    expect(agent).toEqual(expect.objectContaining({
      schemaVersion: 2,
      deviceId: 'worker',
      profile: 'web',
      a2a: expect.objectContaining({ teamId: 'ruby-team', principalId: 'owner' }),
      tasks: expect.objectContaining({ workspaces: { 'fleet-repo': '/Users/example/Local/dsh-fleet' }, profiles: ['headless'] }),
    }))
  })

  it('keeps public packs immutable and unable to grant remote task execution', () => {
    const taskPeer = peer('partner', ['task.submit'])
    expect(() => parseTeamPack(packSource([taskPeer]))).toThrow(/cannot grant task execution/)
    expect(() => parseTeamPack(packSource().replace(
      'kind: npm',
      'kind: artifact\n      digest: ' + '2'.repeat(64),
    ))).toThrow(/must be npm or github|unsupported fields/)
    expect(() => parseTeamPack(packSource() + 'privateToken: secret\n')).toThrow(/unsupported fields/)
  })

  it('rejects mismatched workspaces, non-normal paths and public/private id collisions', () => {
    const pack = parseTeamPack(packSource())
    expect(() => instantiateTeamPack(pack, parseTeamOverlay(overlaySource().replace(
      '/Users/example/Local/dsh-fleet',
      '/Users/example/../private',
    )))).toThrow(/normalized absolute path/)
    expect(() => instantiateTeamPack(pack, parseTeamOverlay(overlaySource().replace(
      'fleet-repo: /Users/example/Local/dsh-fleet',
      "other: /Users/example/Local/dsh-fleet",
    )))).toThrow(/exactly instantiate/)
    expect(() => instantiateTeamPack(pack, parseTeamOverlay(overlaySource().replace(
      'dsh-private-tool',
      'dsh-public-tool',
    )))).toThrow(/conflicts with a public/)
  })

  it('rejects a trust key id that does not match its PEM key', () => {
    const trusted = peer('controller', ['task.submit'])
    trusted.keyId = 'ed25519:' + '0'.repeat(64)
    expect(() => parseTeamOverlay(overlaySource([trusted]))).toThrow(/does not match/)
  })
})
