import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rm } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'
import { a2aKeyId } from '../a2a/protocol.ts'
import { normalizeDeviceId } from '../shared.ts'
import {
  createTeamAgentConfig,
  instantiateTeamPack,
  parseTeamOverlay,
  parseTeamPack,
} from './team-pack.ts'

export interface BootstrapIdentityInput {
  outputDirectory: string
  teamId: string
  principalId: string
  deviceId: string
}

export interface BootstrapIdentityResult {
  privateKeyPath: string
  invitePath: string
  keyId: string
}

export interface BootstrapRenderInput {
  packPath: string
  overlayPath: string
  outputDirectory: string
  identityDirectory: string
}

export interface BootstrapRenderResult {
  manifestPath: string
  trustStorePath: string
  taskPolicyPath: string
  agentConfigPath: string
  manifestDigest: string
}

interface BootstrapInvite {
  schemaVersion: 1
  teamId: string
  principalId: string
  deviceId: string
  keyId: string
  publicKeyPem: string
}

function identifier(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new TypeError(field + ' is invalid')
  return value
}

function safeAbsolutePath(value: string, field: string): string {
  if (!isAbsolute(value) || normalize(value) !== value || value.includes('\0')) {
    throw new TypeError(field + ' must be a normalized absolute path')
  }
  return value
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError('bootstrap output must be a real directory')
  if ((info.mode & 0o077) !== 0) throw new TypeError('bootstrap output directory must be owner-only (0700)')
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new TypeError('bootstrap output directory must be owned by the current user')
}

async function readRegularFile(path: string, privateFile = false): Promise<string> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile()) throw new TypeError('bootstrap inputs must be regular files')
    if (privateFile && (info.mode & 0o077) !== 0) throw new TypeError('bootstrap private key must be owner-only (0600)')
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new TypeError('bootstrap inputs must be owned by the current user')
    return await handle.readFile('utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new TypeError('bootstrap inputs must not be symbolic links')
    throw error
  } finally {
    await handle?.close()
  }
}

async function assertMissing(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await lstat(path)
      throw new TypeError('bootstrap refuses to overwrite existing output: ' + path)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

async function writeExclusive(path: string, contents: string): Promise<void> {
  let handle
  try {
    handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle?.close()
  }
}

function parseInvite(value: unknown): BootstrapInvite {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('identity invite must be an object')
  const raw = value as Record<string, unknown>
  const expected = ['deviceId', 'keyId', 'principalId', 'publicKeyPem', 'schemaVersion', 'teamId']
  const actual = Object.keys(raw).sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError('identity invite has unsupported or missing fields')
  }
  if (raw.schemaVersion !== 1 || typeof raw.teamId !== 'string' || typeof raw.principalId !== 'string' ||
      typeof raw.deviceId !== 'string' || typeof raw.keyId !== 'string' || typeof raw.publicKeyPem !== 'string') {
    throw new TypeError('identity invite is invalid')
  }
  const invite: BootstrapInvite = {
    schemaVersion: 1,
    teamId: identifier(raw.teamId, 'identity teamId'),
    principalId: identifier(raw.principalId, 'identity principalId'),
    deviceId: normalizeDeviceId(raw.deviceId, 'identity deviceId'),
    keyId: raw.keyId,
    publicKeyPem: raw.publicKeyPem,
  }
  if (a2aKeyId(invite.publicKeyPem) !== invite.keyId) throw new TypeError('identity invite key id does not match its public key')
  return invite
}

export async function createBootstrapIdentity(input: BootstrapIdentityInput): Promise<BootstrapIdentityResult> {
  const outputDirectory = safeAbsolutePath(input.outputDirectory, 'outputDirectory')
  const teamId = identifier(input.teamId, 'teamId')
  const principalId = identifier(input.principalId, 'principalId')
  const deviceId = normalizeDeviceId(input.deviceId)
  await ensurePrivateDirectory(outputDirectory)
  const privateKeyPath = join(outputDirectory, 'identity.private.pem')
  const invitePath = join(outputDirectory, 'identity.invite.json')
  await assertMissing([privateKeyPath, invitePath])
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const keyId = a2aKeyId(publicKey)
  const invite: BootstrapInvite = { schemaVersion: 1, teamId, principalId, deviceId, keyId, publicKeyPem }
  const created: string[] = []
  try {
    await writeExclusive(privateKeyPath, privateKeyPem)
    created.push(privateKeyPath)
    await writeExclusive(invitePath, JSON.stringify(invite, null, 2) + '\n')
    created.push(invitePath)
  } catch (error) {
    await Promise.all(created.map(path => rm(path, { force: true })))
    throw error
  }
  return { privateKeyPath, invitePath, keyId }
}

export async function renderBootstrapBundle(input: BootstrapRenderInput): Promise<BootstrapRenderResult> {
  const outputDirectory = safeAbsolutePath(input.outputDirectory, 'outputDirectory')
  const identityDirectory = safeAbsolutePath(input.identityDirectory, 'identityDirectory')
  const packPath = safeAbsolutePath(input.packPath, 'packPath')
  const overlayPath = safeAbsolutePath(input.overlayPath, 'overlayPath')
  await ensurePrivateDirectory(outputDirectory)
  const pack = parseTeamPack(await readRegularFile(packPath))
  const overlay = parseTeamOverlay(await readRegularFile(overlayPath))
  const privateKeyPath = join(identityDirectory, 'identity.private.pem')
  const invitePath = join(identityDirectory, 'identity.invite.json')
  const privateKeyPem = await readRegularFile(privateKeyPath, true)
  const invite = parseInvite(JSON.parse(await readRegularFile(invitePath)) as unknown)
  if (invite.teamId !== overlay.team.id || invite.principalId !== overlay.device.assignedTo || invite.deviceId !== overlay.device.id) {
    throw new TypeError('identity invite does not match the overlay team, principal and device')
  }
  if (a2aKeyId(privateKeyPem) !== invite.keyId) throw new TypeError('identity private key does not match the invite')
  const derivedPublicPem = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString()
  if (a2aKeyId(derivedPublicPem) !== a2aKeyId(invite.publicKeyPem)) throw new TypeError('identity private and public keys do not match')

  const manifestPath = join(outputDirectory, 'fleet.lock.yaml')
  const trustStorePath = join(outputDirectory, 'trust-store.json')
  const taskPolicyPath = join(outputDirectory, 'task-policy.json')
  const agentConfigPath = join(outputDirectory, 'agent.config.json')
  const outputs = [manifestPath, trustStorePath, taskPolicyPath, agentConfigPath]
  await assertMissing(outputs)
  const instantiated = instantiateTeamPack(pack, overlay)
  const contents = [
    instantiated.manifestYaml,
    instantiated.trustStoreJson,
    JSON.stringify(instantiated.taskPolicy, null, 2) + '\n',
    createTeamAgentConfig(pack, overlay, { manifestPath, trustStorePath, privateKeyPath }),
  ]
  const created: string[] = []
  try {
    for (let index = 0; index < outputs.length; index += 1) {
      const path = outputs[index]
      const content = contents[index]
      if (path === undefined || content === undefined) throw new TypeError('bootstrap output set is incomplete')
      await writeExclusive(path, content)
      created.push(path)
    }
  } catch (error) {
    await Promise.all(created.map(path => rm(path, { force: true })))
    throw error
  }
  return {
    manifestPath,
    trustStorePath,
    taskPolicyPath,
    agentConfigPath,
    manifestDigest: createHash('sha256').update(instantiated.manifestYaml, 'utf8').digest('hex'),
  }
}
