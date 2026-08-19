import { createHash, createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, readlink, rename, rm, rmdir, symlink, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import { a2aKeyId } from '../a2a/protocol.ts'
import { assertA2AReadyConfig, assertReleaseReadyConfig, parseAgentConfig } from '../agent/config.ts'
import { sha256Canonical } from '../agent/protocol.ts'
import { normalizeDeviceId } from '../shared.ts'
import {
  createGenerationRoutes,
  createTeamAgentConfig,
  instantiateTeamPack,
  instantiateTeamPackSet,
  parseGenerationRoutes,
  parseTeamOverlay,
  parseTeamPack,
  type FleetTeamOverlay,
  type InstantiatedTeamPackSet,
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

export interface BootstrapPlanSetInput {
  packPath: string
  overlayPaths: string[]
}

export interface BootstrapPlanSetResult {
  teamId: string
  packId: string
  packVersion: string
  profileId: string
  manifestYaml: string
  manifestDigest: string
  devices: Array<{
    deviceId: string
    releaseId: string
    releaseVersion: string
  }>
}

export interface BootstrapRenderSetInput extends BootstrapPlanSetInput {
  outputDirectory: string
  identityDirectory: string
  deviceId: string
}

export interface BootstrapRenderSetResult extends BootstrapRenderResult {
  deviceId: string
  releaseId: string
}

export interface BootstrapGenerationAssembleInput extends BootstrapPlanSetInput {
  rootDirectory: string
  generationId: string
  identityDirectory: string
  deviceId: string
  agentBundlePath: string
  workerBundlePath: string
  bootstrapBundlePath?: string
  now?: Date | string
}

export interface BootstrapGenerationFileRecord {
  sha256: string
  bytes: number
  mode: number
}

export interface BootstrapGenerationRecordBody {
  schemaVersion: 1
  generationId: string
  createdAt: string
  teamId: string
  packId: string
  packVersion: string
  profileId: string
  deviceId: string
  manifestDigest: string
  liveManifestPath: string
  desiredManifestPath: string
  files: Record<string, BootstrapGenerationFileRecord>
}

export interface BootstrapGenerationRecord extends BootstrapGenerationRecordBody {
  generationDigest: string
}

export interface BootstrapGenerationAssembleResult {
  generationId: string
  generationPath: string
  generationDigest: string
  manifestDigest: string
  deviceId: string
  files: Record<string, BootstrapGenerationFileRecord>
}

export interface BootstrapGenerationInspectInput {
  rootDirectory: string
  generationId: string
}

export interface BootstrapGenerationInspectResult extends BootstrapGenerationRecord {
  generationPath: string
}

export interface BootstrapGenerationLifecycleHooks {
  beforeCurrentSwap?: () => void | Promise<void>
  afterCurrentSwap?: () => void | Promise<void>
}

export interface BootstrapGenerationActivateInput {
  rootDirectory: string
  generationId: string
  expectedCurrent: string | null
  now?: Date | string
  hooks?: BootstrapGenerationLifecycleHooks
}

export interface BootstrapGenerationRollbackInput {
  rootDirectory: string
  expectedCurrent: string | null
  now?: Date | string
  hooks?: BootstrapGenerationLifecycleHooks
}

export interface BootstrapGenerationSwitchResult {
  previous: string | null
  current: string | null
  generationDigest: string | null
  journalDigest: string
}

interface BootstrapInvite {
  schemaVersion: 1
  teamId: string
  principalId: string
  deviceId: string
  keyId: string
  publicKeyPem: string
}

interface BootstrapActivationJournalBody {
  schemaVersion: 1
  operationId: string
  previous: string | null
  next: string
  state: 'prepared' | 'committed' | 'rolled-back'
  preparedAt: string
  committedAt: string | null
  rolledBackAt: string | null
}

interface BootstrapActivationJournal extends BootstrapActivationJournalBody {
  journalDigest: string
}

interface BootstrapGenerationLifecycleLockBody {
  schemaVersion: 1
  pid: number
  token: string
  createdAt: string
  rootDigest: string
}

interface BootstrapGenerationLifecycleLock extends BootstrapGenerationLifecycleLockBody {
  lockDigest: string
}

interface BootstrapGenerationLifecycleReclaimBody {
  schemaVersion: 1
  pid: number
  token: string
  staleToken: string
  createdAt: string
  rootDigest: string
}

interface BootstrapGenerationLifecycleReclaim extends BootstrapGenerationLifecycleReclaimBody {
  reclaimDigest: string
}

interface BootstrapGenerationLifecycleLockIdentity {
  directoryDevice: number
  directoryInode: number
  recordDevice: number
  recordInode: number
  record: BootstrapGenerationLifecycleLock
  reclaim: null | {
    recordDevice: number
    recordInode: number
    record: BootstrapGenerationLifecycleReclaim
  }
}

const GENERATION_RECORD_NAME = 'generation.json'
const ROUTES_NAME = 'routes.json'
const ACTIVATION_JOURNAL_NAME = 'activation-journal.json'
const GENERATION_LIFECYCLE_LOCK_NAME = '.generation-lifecycle.lock'
const GENERATION_LIFECYCLE_LOCK_RECORD_NAME = 'owner.json'
const GENERATION_LIFECYCLE_RECLAIM_RECORD_NAME = 'reclaim.json'
const REQUIRED_GENERATION_FILES = [
  'agent.config.json', 'agent.mjs', 'fleet.lock.yaml', 'launcher.mjs', ROUTES_NAME,
  'task-policy.json', 'trust-store.json', 'worker.mjs',
] as const
const OPTIONAL_GENERATION_FILES = ['bootstrap.mjs'] as const
const MAX_GENERATION_FILE_BYTES = 64 * 1024 * 1024

const GENERATION_LAUNCHER_SOURCE = `#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'

function fail(message) {
  throw new Error('Fleet generation launcher refused: ' + message)
}

async function privateFile(path, expectedMode) {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile() || info.isSymbolicLink()) fail('generation member must be a regular file')
    if ((info.mode & 0o777) !== expectedMode) fail('generation member mode mismatch')
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) fail('generation member owner mismatch')
    const contents = await handle.readFile()
    return { contents, bytes: info.size, mode: info.mode & 0o777 }
  } finally {
    await handle?.close()
  }
}

function verifyFileRecord(record, name, file) {
  const expected = record.files?.[name]
  if (typeof expected !== 'object' || expected === null || Array.isArray(expected) ||
      expected.bytes !== file.bytes || expected.mode !== file.mode ||
      typeof expected.sha256 !== 'string' ||
      createHash('sha256').update(file.contents).digest('hex') !== expected.sha256) {
    fail('generation member integrity mismatch: ' + name)
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) fail('generation.json contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
  }
  fail('generation.json is not canonical JSON')
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length !== 3 || argv[0] !== '--config' || typeof argv[1] !== 'string' ||
      !isAbsolute(argv[1]) || normalize(argv[1]) !== argv[1] || basename(argv[1]) !== 'agent.config.json' ||
      basename(dirname(argv[1])) !== 'current' || typeof argv[2] !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(argv[2])) {
    fail('Host route must use exactly --config <root>/current/agent.config.json <command>')
  }
  const currentPath = dirname(argv[1])
  const rootPath = dirname(currentPath)
  const expectedLauncherPath = join(currentPath, 'launcher.mjs')
  const entryPath = process.argv[1]
  const resolvedLauncherPrefix = join(rootPath, 'generations') + '/'
  if (typeof entryPath !== 'string' || !isAbsolute(entryPath) || normalize(entryPath) !== entryPath ||
      !(entryPath === expectedLauncherPath ||
        (entryPath.startsWith(resolvedLauncherPrefix) && basename(entryPath) === 'launcher.mjs'))) {
    fail('entrypoint does not belong to the configured generation root')
  }
  const rootInfo = await lstat(rootPath)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (rootInfo.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === 'function' && rootInfo.uid !== process.getuid())) {
    fail('generation root is not owner-controlled')
  }
  const currentInfo = await lstat(currentPath)
  if (!currentInfo.isSymbolicLink() || (typeof process.getuid === 'function' && currentInfo.uid !== process.getuid())) {
    fail('current must be an owner-controlled symbolic link')
  }
  const currentTarget = await readlink(currentPath)
  const match = /^generations\\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/.exec(currentTarget)
  if (match === null) fail('current must be one relative generations/<id> target')
  const generationId = match[1]
  const generationsPath = join(rootPath, 'generations')
  const generationPath = join(generationsPath, generationId)
  const generationsInfo = await lstat(generationsPath)
  if (!generationsInfo.isDirectory() || generationsInfo.isSymbolicLink() || (generationsInfo.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === 'function' && generationsInfo.uid !== process.getuid())) {
    fail('generations directory is not owner-controlled')
  }
  const generationInfo = await lstat(generationPath)
  if (!generationInfo.isDirectory() || generationInfo.isSymbolicLink() || (generationInfo.mode & 0o777) !== 0o500 ||
      (typeof process.getuid === 'function' && generationInfo.uid !== process.getuid())) {
    fail('generation directory is not immutable and owner-controlled')
  }
  const recordFile = await privateFile(join(generationPath, 'generation.json'), 0o400)
  let record
  try { record = JSON.parse(recordFile.contents.toString('utf8')) } catch { fail('generation.json is invalid') }
  if (record?.generationId !== generationId || typeof record.files !== 'object' || record.files === null) {
    fail('generation.json does not bind this generation')
  }
  const { generationDigest, ...generationBody } = record
  if (typeof generationDigest !== 'string' ||
      createHash('sha256').update(canonicalJson(generationBody)).digest('hex') !== generationDigest) {
    fail('generation.json digest does not match')
  }
  const members = {
    'agent.mjs': await privateFile(join(generationPath, 'agent.mjs'), 0o500),
    'agent.config.json': await privateFile(join(generationPath, 'agent.config.json'), 0o400),
    'worker.mjs': await privateFile(join(generationPath, 'worker.mjs'), 0o500),
    'launcher.mjs': await privateFile(join(generationPath, 'launcher.mjs'), 0o500),
  }
  for (const [name, file] of Object.entries(members)) verifyFileRecord(record, name, file)
  let agentConfig
  try { agentConfig = JSON.parse(members['agent.config.json'].contents.toString('utf8')) } catch { fail('agent.config.json is invalid') }
  if (agentConfig?.desiredManifestPath !== join(generationPath, 'fleet.lock.yaml')) {
    fail('agent.config.json does not bind this generation')
  }
  const generationAfter = await lstat(generationPath)
  if (generationAfter.dev !== generationInfo.dev || generationAfter.ino !== generationInfo.ino ||
      !generationAfter.isDirectory() || generationAfter.isSymbolicLink() || (generationAfter.mode & 0o777) !== 0o500) {
    fail('generation was replaced while being verified')
  }

  const child = spawn(process.execPath, [
    join(generationPath, 'agent.mjs'), '--config', join(generationPath, 'agent.config.json'), argv[2],
  ], { stdio: 'inherit', env: process.env })
  const forward = signal => {
    try { child.kill(signal) } catch {}
  }
  const onSigint = () => forward('SIGINT')
  const onSigterm = () => forward('SIGTERM')
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  process.off('SIGINT', onSigint)
  process.off('SIGTERM', onSigterm)
  process.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : result.signal === 'SIGTERM' ? 143 : 1)
}

try {
  await main()
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : 'Fleet generation launcher failed') + '\\n')
  process.exitCode = 70
}
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactObjectKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(field + ' has unsupported or missing fields')
  }
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

function canonicalNow(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError('now must be a valid timestamp')
  return date.toISOString()
}

function sha256(contents: string | Buffer): string {
  return createHash('sha256').update(contents).digest('hex')
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError('bootstrap output must be a real directory')
  if ((info.mode & 0o077) !== 0) throw new TypeError('bootstrap output directory must be owner-only (0700)')
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new TypeError('bootstrap output directory must be owned by the current user')
}

async function assertPrivateDirectory(path: string, field: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError(field + ' must be a real directory')
  if ((info.mode & 0o077) !== 0) throw new TypeError(field + ' must be owner-only')
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new TypeError(field + ' must be owned by the current user')
}

async function readRegularBuffer(path: string, field: string, ownerOnly: boolean): Promise<Buffer> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile()) throw new TypeError(field + ' must be a regular file')
    if (info.size > MAX_GENERATION_FILE_BYTES) throw new TypeError(field + ' exceeds the generation file size limit')
    if (ownerOnly && (info.mode & 0o077) !== 0) throw new TypeError(field + ' must be owner-only')
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new TypeError(field + ' must be owned by the current user')
    return await handle.readFile()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new TypeError(field + ' must not be a symbolic link')
    throw error
  } finally {
    await handle?.close()
  }
}

async function readRegularFile(path: string, privateLabel?: string): Promise<string> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile()) throw new TypeError('bootstrap inputs must be regular files')
    if (privateLabel !== undefined && (info.mode & 0o077) !== 0) {
      throw new TypeError(privateLabel + ' must be owner-only (0600)')
    }
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

async function writeExclusive(path: string, contents: string | Buffer, mode = 0o600): Promise<void> {
  let handle
  try {
    handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode)
    if (typeof contents === 'string') await handle.writeFile(contents, 'utf8')
    else await handle.writeFile(contents)
    await handle.sync()
  } finally {
    await handle?.close()
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isDirectory()) throw new TypeError('durability target must be a directory')
    await handle.sync()
  } finally {
    await handle.close()
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

async function validateIdentity(identityDirectory: string, overlay: FleetTeamOverlay): Promise<string> {
  await assertPrivateDirectory(identityDirectory, 'identityDirectory')
  const privateKeyPath = join(identityDirectory, 'identity.private.pem')
  const invitePath = join(identityDirectory, 'identity.invite.json')
  const privateKeyPem = await readRegularFile(privateKeyPath, 'bootstrap private key')
  const invite = parseInvite(JSON.parse(await readRegularFile(invitePath)) as unknown)
  if (invite.teamId !== overlay.team.id || invite.principalId !== overlay.device.assignedTo || invite.deviceId !== overlay.device.id) {
    throw new TypeError('identity invite does not match the overlay team, principal and device')
  }
  if (a2aKeyId(privateKeyPem) !== invite.keyId) throw new TypeError('identity private key does not match the invite')
  const derivedPublicPem = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString()
  if (a2aKeyId(derivedPublicPem) !== a2aKeyId(invite.publicKeyPem)) throw new TypeError('identity private and public keys do not match')
  return privateKeyPath
}

async function loadTeamPackSet(input: BootstrapPlanSetInput) {
  const packPath = safeAbsolutePath(input.packPath, 'packPath')
  if (!Array.isArray(input.overlayPaths) || input.overlayPaths.length === 0) {
    throw new TypeError('overlayPaths must contain at least one overlay')
  }
  const overlayPaths = input.overlayPaths.map((path, index) => safeAbsolutePath(path, `overlayPaths[${index}]`))
  if (new Set(overlayPaths).size !== overlayPaths.length) throw new TypeError('overlayPaths must not contain duplicates')
  const pack = parseTeamPack(await readRegularFile(packPath))
  const overlays = await Promise.all(overlayPaths.map(async path => parseTeamOverlay(await readRegularFile(path, 'bootstrap overlay'))))
  const instantiated = instantiateTeamPackSet(pack, overlays)
  return { pack, instantiated }
}

function planFromSet(
  pack: ReturnType<typeof parseTeamPack>,
  instantiated: InstantiatedTeamPackSet,
): BootstrapPlanSetResult {
  return {
    teamId: instantiated.devices[0]?.overlay.team.id ?? '',
    packId: pack.pack.id,
    packVersion: pack.pack.version,
    profileId: pack.profile.id,
    manifestYaml: instantiated.manifestYaml,
    manifestDigest: createHash('sha256').update(instantiated.manifestYaml, 'utf8').digest('hex'),
    devices: instantiated.devices.map(device => ({
      deviceId: device.deviceId,
      releaseId: device.releaseId,
      releaseVersion: device.overlay.release.version,
    })),
  }
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
  const overlay = parseTeamOverlay(await readRegularFile(overlayPath, 'bootstrap overlay'))
  const privateKeyPath = await validateIdentity(identityDirectory, overlay)

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

export async function planBootstrapSet(input: BootstrapPlanSetInput): Promise<BootstrapPlanSetResult> {
  const { pack, instantiated } = await loadTeamPackSet(input)
  return planFromSet(pack, instantiated)
}

export async function renderBootstrapSet(input: BootstrapRenderSetInput): Promise<BootstrapRenderSetResult> {
  const outputDirectory = safeAbsolutePath(input.outputDirectory, 'outputDirectory')
  const identityDirectory = safeAbsolutePath(input.identityDirectory, 'identityDirectory')
  const deviceId = normalizeDeviceId(input.deviceId)
  const { pack, instantiated } = await loadTeamPackSet(input)
  const plan = planFromSet(pack, instantiated)
  const device = instantiated.devices.find(candidate => candidate.deviceId === deviceId)
  if (device === undefined) throw new TypeError('deviceId is not present in the overlay set: ' + deviceId)
  const privateKeyPath = await validateIdentity(identityDirectory, device.overlay)
  await ensurePrivateDirectory(outputDirectory)
  const manifestPath = join(outputDirectory, 'fleet.lock.yaml')
  const trustStorePath = join(outputDirectory, 'trust-store.json')
  const taskPolicyPath = join(outputDirectory, 'task-policy.json')
  const agentConfigPath = join(outputDirectory, 'agent.config.json')
  const outputs = [manifestPath, trustStorePath, taskPolicyPath, agentConfigPath]
  await assertMissing(outputs)
  const contents = [
    instantiated.manifestYaml,
    device.trustStoreJson,
    JSON.stringify(device.taskPolicy, null, 2) + '\n',
    createTeamAgentConfig(pack, device.overlay, { manifestPath, trustStorePath, privateKeyPath }),
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
    deviceId: device.deviceId,
    releaseId: device.releaseId,
    manifestPath,
    trustStorePath,
    taskPolicyPath,
    agentConfigPath,
    manifestDigest: plan.manifestDigest,
  }
}

function generationDirectory(rootDirectory: string, generationId: string): string {
  return join(rootDirectory, 'generations', generationId)
}

async function ensureGenerationRoot(rootDirectory: string, create: boolean): Promise<string> {
  const root = safeAbsolutePath(rootDirectory, 'rootDirectory')
  if (create) await ensurePrivateDirectory(root)
  else await assertPrivateDirectory(root, 'generation root')
  const generations = join(root, 'generations')
  if (create) await ensurePrivateDirectory(generations)
  else await assertPrivateDirectory(generations, 'generations directory')
  return root
}

function generationFileMode(name: string): number {
  return name.endsWith('.mjs') ? 0o500 : 0o400
}

function generationFileRecord(contents: string | Buffer, mode: number): BootstrapGenerationFileRecord {
  const bytes = typeof contents === 'string' ? Buffer.byteLength(contents, 'utf8') : contents.byteLength
  return { sha256: sha256(contents), bytes, mode }
}

function generationRoutesWithLauncher(instantiated: InstantiatedTeamPackSet): string {
  const routes = parseGenerationRoutes(createGenerationRoutes(instantiated))
  const launcherRoutes = {
    ...routes,
    routes: routes.routes.map(route => {
      const routeDirectory = dirname(route.configPath)
      if (basename(routeDirectory) !== 'current' || basename(route.configPath) !== 'agent.config.json' ||
          dirname(route.agentPath) !== routeDirectory ||
          (basename(route.agentPath) !== 'agent.mjs' && basename(route.agentPath) !== 'launcher.mjs')) {
        throw new TypeError('generation routes must pair current/launcher.mjs with current/agent.config.json')
      }
      return { ...route, agentPath: join(routeDirectory, 'launcher.mjs') }
    }),
  }
  const source = JSON.stringify(launcherRoutes, null, 2) + '\n'
  parseGenerationRoutes(source)
  return source
}

async function cleanupGeneration(path: string, created: string[]): Promise<void> {
  try { await chmod(path, 0o700) } catch { /* best-effort cleanup of the exact directory created by this call */ }
  for (const file of [...created].reverse()) {
    try { await unlink(file) } catch { /* leave a failed immutable generation visibly incomplete */ }
  }
  try { await rmdir(path) } catch { /* never recursively delete an unexpected entry */ }
}

export async function assembleBootstrapGeneration(
  input: BootstrapGenerationAssembleInput,
): Promise<BootstrapGenerationAssembleResult> {
  const rootDirectory = safeAbsolutePath(input.rootDirectory, 'rootDirectory')
  const generationId = identifier(input.generationId, 'generationId')
  const identityDirectory = safeAbsolutePath(input.identityDirectory, 'identityDirectory')
  const deviceId = normalizeDeviceId(input.deviceId)
  const agentBundlePath = safeAbsolutePath(input.agentBundlePath, 'agentBundlePath')
  const workerBundlePath = safeAbsolutePath(input.workerBundlePath, 'workerBundlePath')
  const bootstrapBundlePath = input.bootstrapBundlePath === undefined
    ? undefined
    : safeAbsolutePath(input.bootstrapBundlePath, 'bootstrapBundlePath')
  const createdAt = canonicalNow(input.now)
  const { pack, instantiated } = await loadTeamPackSet(input)
  const plan = planFromSet(pack, instantiated)
  const device = instantiated.devices.find(candidate => candidate.deviceId === deviceId)
  if (device === undefined) throw new TypeError('deviceId is not present in the overlay set: ' + deviceId)
  const privateKeyPath = await validateIdentity(identityDirectory, device.overlay)

  const expectedCurrentAgent = join(rootDirectory, 'current', 'agent.mjs')
  const expectedCurrentLauncher = join(rootDirectory, 'current', 'launcher.mjs')
  const expectedCurrentConfig = join(rootDirectory, 'current', 'agent.config.json')
  if ((device.overlay.route.agentPath !== expectedCurrentAgent && device.overlay.route.agentPath !== expectedCurrentLauncher) ||
      device.overlay.route.configPath !== expectedCurrentConfig) {
    throw new TypeError('selected device route must target current/launcher.mjs (or legacy current/agent.mjs) and current/agent.config.json under rootDirectory')
  }

  const agentBundle = await readRegularBuffer(agentBundlePath, 'agent bundle', false)
  const workerBundle = await readRegularBuffer(workerBundlePath, 'worker bundle', false)
  const bootstrapBundle = bootstrapBundlePath === undefined
    ? undefined
    : await readRegularBuffer(bootstrapBundlePath, 'bootstrap bundle', false)

  const root = await ensureGenerationRoot(rootDirectory, true)
  const generationsPath = join(root, 'generations')
  const generationPath = generationDirectory(root, generationId)
  try {
    await mkdir(generationPath, { mode: 0o700 })
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new TypeError('generation assemble refuses to overwrite an existing generation: ' + generationId)
    }
    throw error
  }

  const created: string[] = []
  try {
    const desiredManifestPath = join(generationPath, 'fleet.lock.yaml')
    const liveManifestPath = join(device.overlay.agent.dshHome, 'profiles', pack.profile.id, 'fleet.lock.yaml')
    const routesJson = generationRoutesWithLauncher(instantiated)
    const contents: Record<string, string | Buffer> = {
      'agent.config.json': createTeamAgentConfig(pack, device.overlay, {
        manifestPath: liveManifestPath,
        desiredManifestPath,
        trustStorePath: join(generationPath, 'trust-store.json'),
        privateKeyPath,
      }),
      'agent.mjs': agentBundle,
      'fleet.lock.yaml': instantiated.manifestYaml,
      'launcher.mjs': GENERATION_LAUNCHER_SOURCE,
      [ROUTES_NAME]: routesJson,
      'task-policy.json': JSON.stringify(device.taskPolicy, null, 2) + '\n',
      'trust-store.json': device.trustStoreJson,
      'worker.mjs': workerBundle,
      ...(bootstrapBundle === undefined ? {} : { 'bootstrap.mjs': bootstrapBundle }),
    }
    const files: Record<string, BootstrapGenerationFileRecord> = {}
    for (const name of Object.keys(contents).sort()) {
      const content = contents[name]
      if (content === undefined) throw new TypeError('generation content is incomplete')
      const mode = generationFileMode(name)
      const path = join(generationPath, name)
      await writeExclusive(path, content, mode)
      created.push(path)
      files[name] = generationFileRecord(content, mode)
    }
    const body: BootstrapGenerationRecordBody = {
      schemaVersion: 1,
      generationId,
      createdAt,
      teamId: plan.teamId,
      packId: plan.packId,
      packVersion: plan.packVersion,
      profileId: plan.profileId,
      deviceId,
      manifestDigest: plan.manifestDigest,
      liveManifestPath,
      desiredManifestPath,
      files,
    }
    const record: BootstrapGenerationRecord = { ...body, generationDigest: sha256Canonical(body) }
    const recordPath = join(generationPath, GENERATION_RECORD_NAME)
    await writeExclusive(recordPath, JSON.stringify(record, null, 2) + '\n', 0o400)
    created.push(recordPath)
    await syncDirectory(generationPath)
    await chmod(generationPath, 0o500)
    await syncDirectory(generationsPath)
    return {
      generationId,
      generationPath,
      generationDigest: record.generationDigest,
      manifestDigest: record.manifestDigest,
      deviceId,
      files,
    }
  } catch (error) {
    await cleanupGeneration(generationPath, created)
    throw error
  }
}

function recordText(value: unknown, field: string, maxLength = 1024): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > maxLength || /[\r\n\0]/.test(value)) {
    throw new TypeError(field + ' must be a bounded trimmed string')
  }
  return value
}

function recordDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new TypeError(field + ' must be a lowercase SHA-256 digest')
  return value
}

function recordTime(value: unknown, field: string): string {
  const timestamp = recordText(value, field, 64)
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) throw new TypeError(field + ' must be a canonical ISO timestamp')
  return timestamp
}

function parseGenerationRecord(source: string): BootstrapGenerationRecord {
  let value: unknown
  try { value = JSON.parse(source) as unknown } catch { throw new TypeError('generation.json must contain JSON') }
  if (!isRecord(value)) throw new TypeError('generation.json must be an object')
  exactObjectKeys(value, [
    'schemaVersion', 'generationId', 'createdAt', 'teamId', 'packId', 'packVersion', 'profileId',
    'deviceId', 'manifestDigest', 'liveManifestPath', 'desiredManifestPath', 'files', 'generationDigest',
  ], 'generation.json')
  if (value.schemaVersion !== 1 || !isRecord(value.files)) throw new TypeError('generation.json schema or files are invalid')
  const files: Record<string, BootstrapGenerationFileRecord> = {}
  for (const [name, rawRecord] of Object.entries(value.files)) {
    if (![...REQUIRED_GENERATION_FILES, ...OPTIONAL_GENERATION_FILES].includes(name as never) || !isRecord(rawRecord)) {
      throw new TypeError('generation.json contains an unsupported file record: ' + name)
    }
    exactObjectKeys(rawRecord, ['sha256', 'bytes', 'mode'], 'generation file record')
    if (typeof rawRecord.bytes !== 'number' || !Number.isSafeInteger(rawRecord.bytes) || rawRecord.bytes < 0 || rawRecord.bytes > MAX_GENERATION_FILE_BYTES) {
      throw new TypeError('generation file bytes are invalid')
    }
    if (rawRecord.mode !== generationFileMode(name)) throw new TypeError('generation file mode is invalid: ' + name)
    files[name] = { sha256: recordDigest(rawRecord.sha256, 'generation file sha256'), bytes: rawRecord.bytes, mode: rawRecord.mode }
  }
  if (REQUIRED_GENERATION_FILES.some(name => files[name] === undefined)) throw new TypeError('generation.json is missing required files')
  const body: BootstrapGenerationRecordBody = {
    schemaVersion: 1,
    generationId: identifier(recordText(value.generationId, 'generationId', 64), 'generationId'),
    createdAt: recordTime(value.createdAt, 'createdAt'),
    teamId: identifier(recordText(value.teamId, 'teamId', 64), 'teamId'),
    packId: identifier(recordText(value.packId, 'packId', 64), 'packId'),
    packVersion: recordText(value.packVersion, 'packVersion', 128),
    profileId: identifier(recordText(value.profileId, 'profileId', 64), 'profileId'),
    deviceId: normalizeDeviceId(recordText(value.deviceId, 'deviceId', 64)),
    manifestDigest: recordDigest(value.manifestDigest, 'manifestDigest'),
    liveManifestPath: safeAbsolutePath(recordText(value.liveManifestPath, 'liveManifestPath', 4096), 'liveManifestPath'),
    desiredManifestPath: safeAbsolutePath(recordText(value.desiredManifestPath, 'desiredManifestPath', 4096), 'desiredManifestPath'),
    files,
  }
  const generationDigest = recordDigest(value.generationDigest, 'generationDigest')
  if (sha256Canonical(body) !== generationDigest) throw new TypeError('generationDigest does not match generation metadata')
  return { ...body, generationDigest }
}

export async function inspectBootstrapGeneration(
  input: BootstrapGenerationInspectInput,
): Promise<BootstrapGenerationInspectResult> {
  const root = await ensureGenerationRoot(input.rootDirectory, false)
  const generationId = identifier(input.generationId, 'generationId')
  const generationPath = generationDirectory(root, generationId)
  await assertPrivateDirectory(generationPath, 'generation directory')
  const directoryInfo = await lstat(generationPath)
  if ((directoryInfo.mode & 0o777) !== 0o500) throw new TypeError('generation directory must be immutable owner-only (0500)')
  const recordContents = await readRegularBuffer(join(generationPath, GENERATION_RECORD_NAME), 'generation.json', true)
  const recordInfo = await lstat(join(generationPath, GENERATION_RECORD_NAME))
  if ((recordInfo.mode & 0o777) !== 0o400) throw new TypeError('generation.json mode must be 0400')
  const record = parseGenerationRecord(recordContents.toString('utf8'))
  if (record.generationId !== generationId) throw new TypeError('generation directory id does not match generation.json')
  if (record.desiredManifestPath !== join(generationPath, 'fleet.lock.yaml')) {
    throw new TypeError('desiredManifestPath must bind the immutable generation manifest')
  }

  const expectedNames = [...Object.keys(record.files), GENERATION_RECORD_NAME].sort()
  const actualNames = (await readdir(generationPath)).sort()
  if (actualNames.length !== expectedNames.length || actualNames.some((name, index) => name !== expectedNames[index])) {
    throw new TypeError('generation directory contains missing or unsupported files')
  }
  for (const [name, expected] of Object.entries(record.files)) {
    const path = join(generationPath, name)
    const contents = await readRegularBuffer(path, 'generation file ' + name, true)
    const info = await lstat(path)
    if ((info.mode & 0o777) !== expected.mode || contents.byteLength !== expected.bytes || sha256(contents) !== expected.sha256) {
      throw new TypeError('generation file integrity mismatch: ' + name)
    }
  }
  const manifest = await readRegularBuffer(join(generationPath, 'fleet.lock.yaml'), 'generation manifest', true)
  if (sha256(manifest) !== record.manifestDigest) throw new TypeError('generation manifestDigest does not match fleet.lock.yaml')
  const routes = parseGenerationRoutes((await readRegularBuffer(join(generationPath, ROUTES_NAME), 'routes.json', true)).toString('utf8'))
  const selectedRoute = routes.routes.find(route => route.deviceId === record.deviceId)
  if (routes.teamId !== record.teamId || selectedRoute === undefined) {
    throw new TypeError('routes.json does not bind the generation team and device')
  }
  if (selectedRoute.agentPath !== join(root, 'current', 'launcher.mjs') ||
      selectedRoute.configPath !== join(root, 'current', 'agent.config.json')) {
    throw new TypeError('routes.json selected device must target the generation root current launcher and config')
  }
  const agentConfigSource = (await readRegularBuffer(
    join(generationPath, 'agent.config.json'), 'agent.config.json', true,
  )).toString('utf8')
  let agentConfigValue: unknown
  try { agentConfigValue = JSON.parse(agentConfigSource) as unknown } catch { throw new TypeError('agent.config.json must contain JSON') }
  const agentConfig = parseAgentConfig(agentConfigValue)
  assertReleaseReadyConfig(agentConfig)
  assertA2AReadyConfig(agentConfig)
  if (agentConfig.deviceId !== record.deviceId || agentConfig.manifestPath !== record.liveManifestPath ||
      agentConfig.desiredManifestPath !== record.desiredManifestPath) {
    throw new TypeError('agent.config.json does not bind the generation device and manifests')
  }
  return { ...record, generationPath }
}

function activationJournal(body: BootstrapActivationJournalBody): BootstrapActivationJournal {
  return { ...body, journalDigest: sha256Canonical(body) }
}

function parseActivationJournal(source: string): BootstrapActivationJournal {
  let value: unknown
  try { value = JSON.parse(source) as unknown } catch { throw new TypeError('activation journal must contain JSON') }
  if (!isRecord(value)) throw new TypeError('activation journal must be an object')
  exactObjectKeys(value, [
    'schemaVersion', 'operationId', 'previous', 'next', 'state', 'preparedAt',
    'committedAt', 'rolledBackAt', 'journalDigest',
  ], 'activation journal')
  if (value.schemaVersion !== 1 || typeof value.operationId !== 'string' ||
      !/^activation:[0-9a-f-]{36}$/.test(value.operationId)) {
    throw new TypeError('activation journal identity is invalid')
  }
  const previous = value.previous === null
    ? null
    : identifier(recordText(value.previous, 'activation journal previous', 64), 'activation journal previous')
  const next = identifier(recordText(value.next, 'activation journal next', 64), 'activation journal next')
  if (value.state !== 'prepared' && value.state !== 'committed' && value.state !== 'rolled-back') {
    throw new TypeError('activation journal state is invalid')
  }
  const preparedAt = recordTime(value.preparedAt, 'activation journal preparedAt')
  const committedAt = value.committedAt === null ? null : recordTime(value.committedAt, 'activation journal committedAt')
  const rolledBackAt = value.rolledBackAt === null ? null : recordTime(value.rolledBackAt, 'activation journal rolledBackAt')
  if ((value.state === 'prepared' && (committedAt !== null || rolledBackAt !== null)) ||
      (value.state === 'committed' && (committedAt === null || rolledBackAt !== null)) ||
      (value.state === 'rolled-back' && rolledBackAt === null)) {
    throw new TypeError('activation journal timestamps do not match its state')
  }
  const body: BootstrapActivationJournalBody = {
    schemaVersion: 1,
    operationId: value.operationId,
    previous,
    next,
    state: value.state,
    preparedAt,
    committedAt,
    rolledBackAt,
  }
  const journalDigest = recordDigest(value.journalDigest, 'activation journal digest')
  if (sha256Canonical(body) !== journalDigest) throw new TypeError('activation journal digest does not match')
  return { ...body, journalDigest }
}

async function readActivationJournal(rootDirectory: string, required: boolean): Promise<BootstrapActivationJournal | null> {
  const path = join(rootDirectory, ACTIVATION_JOURNAL_NAME)
  try {
    const contents = await readRegularBuffer(path, 'activation journal', true)
    const info = await lstat(path)
    if ((info.mode & 0o777) !== 0o600) throw new TypeError('activation journal mode must be 0600')
    return parseActivationJournal(contents.toString('utf8'))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !required) return null
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new TypeError('activation journal does not exist')
    throw error
  }
}

async function writeActivationJournal(rootDirectory: string, journal: BootstrapActivationJournal): Promise<void> {
  const destination = join(rootDirectory, ACTIVATION_JOURNAL_NAME)
  try {
    const existing = await lstat(destination)
    if (!existing.isFile() || existing.isSymbolicLink() || (existing.mode & 0o777) !== 0o600 ||
        (typeof process.getuid === 'function' && existing.uid !== process.getuid())) {
      throw new TypeError('activation journal destination is not a private regular file')
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = join(rootDirectory, `.activation-journal.${randomUUID()}.tmp`)
  try {
    await writeExclusive(temporary, JSON.stringify(journal, null, 2) + '\n', 0o600)
    await rename(temporary, destination)
    await syncDirectory(rootDirectory)
  } finally {
    try { await unlink(temporary) } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

async function currentGenerationId(rootDirectory: string): Promise<string | null> {
  const currentPath = join(rootDirectory, 'current')
  let info
  try {
    info = await lstat(currentPath)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (!info.isSymbolicLink() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw new TypeError('current must be an owner-controlled symbolic link')
  }
  const target = await readlink(currentPath)
  const match = /^generations\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/.exec(target)
  if (match === null) throw new TypeError('current must point to generations/<id> with a relative link')
  const generationId = identifier(match[1]!, 'current generation id')
  await inspectBootstrapGeneration({ rootDirectory, generationId })
  return generationId
}

function lifecycleProcessId(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 0x7fffffff) {
    throw new TypeError(field + ' must be a positive process id')
  }
  return value
}

function lifecycleToken(value: unknown, field: string, prefix: 'lock' | 'reclaim'): string {
  const token = recordText(value, field, 64)
  if (!new RegExp(`^${prefix}:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).test(token)) {
    throw new TypeError(field + ' is invalid')
  }
  return token
}

function generationLifecycleLock(
  rootDirectory: string,
  pid = process.pid,
): BootstrapGenerationLifecycleLock {
  const body: BootstrapGenerationLifecycleLockBody = {
    schemaVersion: 1,
    pid,
    token: 'lock:' + randomUUID(),
    createdAt: canonicalNow(undefined),
    rootDigest: sha256(rootDirectory),
  }
  return { ...body, lockDigest: sha256Canonical(body) }
}

function parseGenerationLifecycleLock(source: string, rootDirectory: string): BootstrapGenerationLifecycleLock {
  let value: unknown
  try { value = JSON.parse(source) as unknown } catch { throw new TypeError('generation lifecycle lock record must contain JSON') }
  if (!isRecord(value)) throw new TypeError('generation lifecycle lock record must be an object')
  exactObjectKeys(value, ['schemaVersion', 'pid', 'token', 'createdAt', 'rootDigest', 'lockDigest'], 'generation lifecycle lock record')
  if (value.schemaVersion !== 1) throw new TypeError('generation lifecycle lock record schema is invalid')
  const body: BootstrapGenerationLifecycleLockBody = {
    schemaVersion: 1,
    pid: lifecycleProcessId(value.pid, 'generation lifecycle lock pid'),
    token: lifecycleToken(value.token, 'generation lifecycle lock token', 'lock'),
    createdAt: recordTime(value.createdAt, 'generation lifecycle lock createdAt'),
    rootDigest: recordDigest(value.rootDigest, 'generation lifecycle lock rootDigest'),
  }
  const lockDigest = recordDigest(value.lockDigest, 'generation lifecycle lock digest')
  if (body.rootDigest !== sha256(rootDirectory)) throw new TypeError('generation lifecycle lock is bound to another root')
  if (sha256Canonical(body) !== lockDigest) throw new TypeError('generation lifecycle lock digest does not match')
  return { ...body, lockDigest }
}

function generationLifecycleReclaim(
  rootDirectory: string,
  staleToken: string,
  pid = process.pid,
): BootstrapGenerationLifecycleReclaim {
  const body: BootstrapGenerationLifecycleReclaimBody = {
    schemaVersion: 1,
    pid,
    token: 'reclaim:' + randomUUID(),
    staleToken,
    createdAt: canonicalNow(undefined),
    rootDigest: sha256(rootDirectory),
  }
  return { ...body, reclaimDigest: sha256Canonical(body) }
}

function parseGenerationLifecycleReclaim(source: string, rootDirectory: string): BootstrapGenerationLifecycleReclaim {
  let value: unknown
  try { value = JSON.parse(source) as unknown } catch { throw new TypeError('generation lifecycle reclaim record must contain JSON') }
  if (!isRecord(value)) throw new TypeError('generation lifecycle reclaim record must be an object')
  exactObjectKeys(value, [
    'schemaVersion', 'pid', 'token', 'staleToken', 'createdAt', 'rootDigest', 'reclaimDigest',
  ], 'generation lifecycle reclaim record')
  if (value.schemaVersion !== 1) throw new TypeError('generation lifecycle reclaim record schema is invalid')
  const body: BootstrapGenerationLifecycleReclaimBody = {
    schemaVersion: 1,
    pid: lifecycleProcessId(value.pid, 'generation lifecycle reclaim pid'),
    token: lifecycleToken(value.token, 'generation lifecycle reclaim token', 'reclaim'),
    staleToken: lifecycleToken(value.staleToken, 'generation lifecycle reclaim staleToken', 'lock'),
    createdAt: recordTime(value.createdAt, 'generation lifecycle reclaim createdAt'),
    rootDigest: recordDigest(value.rootDigest, 'generation lifecycle reclaim rootDigest'),
  }
  const reclaimDigest = recordDigest(value.reclaimDigest, 'generation lifecycle reclaim digest')
  if (body.rootDigest !== sha256(rootDirectory)) throw new TypeError('generation lifecycle reclaim is bound to another root')
  if (sha256Canonical(body) !== reclaimDigest) throw new TypeError('generation lifecycle reclaim digest does not match')
  return { ...body, reclaimDigest }
}

async function readLifecycleRecord(path: string, field: string): Promise<{
  source: string
  device: number
  inode: number
}> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile() || (info.mode & 0o777) !== 0o600) throw new TypeError(field + ' must be a private regular file (0600)')
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new TypeError(field + ' must be owned by the current user')
    if (info.size < 2 || info.size > 16 * 1024) throw new TypeError(field + ' size is invalid')
    return { source: await handle.readFile('utf8'), device: info.dev, inode: info.ino }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new TypeError(field + ' must not be a symbolic link')
    throw error
  } finally {
    await handle?.close()
  }
}

function sameLifecycleLockIdentity(
  left: BootstrapGenerationLifecycleLockIdentity,
  right: BootstrapGenerationLifecycleLockIdentity,
): boolean {
  return left.directoryDevice === right.directoryDevice && left.directoryInode === right.directoryInode &&
    left.recordDevice === right.recordDevice && left.recordInode === right.recordInode &&
    left.record.token === right.record.token && left.record.lockDigest === right.record.lockDigest
}

async function readGenerationLifecycleLockAt(
  rootDirectory: string,
  lockPath: string,
  allowReclaim: boolean,
): Promise<BootstrapGenerationLifecycleLockIdentity> {
  const before = await lstat(lockPath)
  if (!before.isDirectory() || before.isSymbolicLink()) throw new TypeError('generation lifecycle lock must be a real directory')
  if ((before.mode & 0o777) !== 0o700) throw new TypeError('generation lifecycle lock directory must be owner-only (0700)')
  if (typeof process.getuid === 'function' && before.uid !== process.getuid()) {
    throw new TypeError('generation lifecycle lock directory must be owned by the current user')
  }
  const names = (await readdir(lockPath)).sort()
  const withoutReclaim = [GENERATION_LIFECYCLE_LOCK_RECORD_NAME]
  const withReclaim = [GENERATION_LIFECYCLE_LOCK_RECORD_NAME, GENERATION_LIFECYCLE_RECLAIM_RECORD_NAME].sort()
  const hasReclaim = names.length === withReclaim.length && names.every((name, index) => name === withReclaim[index])
  if (!(names.length === withoutReclaim.length && names[0] === withoutReclaim[0]) && !(allowReclaim && hasReclaim)) {
    throw new TypeError('generation lifecycle lock directory contains unsupported or missing records')
  }
  const owner = await readLifecycleRecord(join(lockPath, GENERATION_LIFECYCLE_LOCK_RECORD_NAME), 'generation lifecycle lock record')
  const record = parseGenerationLifecycleLock(owner.source, rootDirectory)
  const reclaimFile = hasReclaim
    ? await readLifecycleRecord(join(lockPath, GENERATION_LIFECYCLE_RECLAIM_RECORD_NAME), 'generation lifecycle reclaim record')
    : null
  const reclaim = reclaimFile === null ? null : {
    recordDevice: reclaimFile.device,
    recordInode: reclaimFile.inode,
    record: parseGenerationLifecycleReclaim(reclaimFile.source, rootDirectory),
  }
  if (reclaim !== null && reclaim.record.staleToken !== record.token) {
    throw new TypeError('generation lifecycle reclaim does not bind the stale lock token')
  }
  const after = await lstat(lockPath)
  if (after.dev !== before.dev || after.ino !== before.ino || !after.isDirectory() || after.isSymbolicLink()) {
    throw new TypeError('generation lifecycle lock was replaced while being inspected')
  }
  const finalNames = (await readdir(lockPath)).sort()
  if (finalNames.length !== names.length || finalNames.some((name, index) => name !== names[index])) {
    throw new TypeError('generation lifecycle lock changed while being inspected')
  }
  return {
    directoryDevice: before.dev,
    directoryInode: before.ino,
    recordDevice: owner.device,
    recordInode: owner.inode,
    record,
    reclaim,
  }
}

async function readGenerationLifecycleLock(
  rootDirectory: string,
  allowReclaim: boolean,
): Promise<BootstrapGenerationLifecycleLockIdentity> {
  return readGenerationLifecycleLockAt(
    rootDirectory,
    join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME),
    allowReclaim,
  )
}

async function assertGenerationLifecycleLockOwned(
  rootDirectory: string,
  expected: BootstrapGenerationLifecycleLockIdentity,
): Promise<void> {
  const observed = await readGenerationLifecycleLock(rootDirectory, false)
  if (!sameLifecycleLockIdentity(expected, observed)) throw new TypeError('generation lifecycle lock was replaced')
}

function processIsDefinitelyDead(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
    throw new TypeError('generation lifecycle lock owner liveness cannot be verified')
  }
}

async function assertGenerationLifecycleStateRecoverable(rootDirectory: string): Promise<void> {
  const current = await currentGenerationId(rootDirectory)
  const journal = await readActivationJournal(rootDirectory, false)
  if (journal === null) return
  if (journal.state === 'rolled-back') {
    if (current !== journal.previous) throw new TypeError('stale generation lifecycle lock has an unrecoverable rolled-back state')
    return
  }
  if (current !== journal.previous && current !== journal.next) {
    throw new TypeError('stale generation lifecycle lock has an unrecoverable journal/current state')
  }
}

async function retireGenerationLifecycleLock(
  rootDirectory: string,
  expected: BootstrapGenerationLifecycleLockIdentity,
  purpose: 'release' | 'reclaim',
): Promise<void> {
  const lockPath = join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME)
  const quarantinePath = join(rootDirectory, `.generation-lifecycle.${purpose}.${randomUUID()}`)
  const observed = await readGenerationLifecycleLock(rootDirectory, purpose === 'reclaim')
  if (!sameLifecycleLockIdentity(expected, observed) ||
      observed.reclaim?.record.token !== expected.reclaim?.record.token ||
      observed.reclaim?.recordInode !== expected.reclaim?.recordInode) {
    throw new TypeError('generation lifecycle lock was replaced before ' + purpose)
  }
  await rename(lockPath, quarantinePath)
  const quarantined = await readGenerationLifecycleLockAt(rootDirectory, quarantinePath, purpose === 'reclaim')
  if (!sameLifecycleLockIdentity(expected, quarantined) ||
      quarantined.reclaim?.record.token !== expected.reclaim?.record.token ||
      quarantined.reclaim?.recordInode !== expected.reclaim?.recordInode) {
    try {
      await lstat(lockPath)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') await rename(quarantinePath, lockPath)
    }
    throw new TypeError('generation lifecycle lock was replaced during ' + purpose)
  }
  if (quarantined.reclaim !== null) await unlink(join(quarantinePath, GENERATION_LIFECYCLE_RECLAIM_RECORD_NAME))
  await unlink(join(quarantinePath, GENERATION_LIFECYCLE_LOCK_RECORD_NAME))
  const remaining = await readdir(quarantinePath)
  if (remaining.length !== 0) throw new TypeError('generation lifecycle lock quarantine is not empty')
  await rmdir(quarantinePath)
  await syncDirectory(rootDirectory)
}

async function removeDeadGenerationLifecycleReclaim(
  rootDirectory: string,
  locked: BootstrapGenerationLifecycleLockIdentity,
): Promise<BootstrapGenerationLifecycleLockIdentity> {
  const reclaim = locked.reclaim
  if (reclaim === null) return locked
  if (!processIsDefinitelyDead(reclaim.record.pid)) {
    throw new TypeError('generation lifecycle stale-lock recovery is already active')
  }
  await assertGenerationLifecycleStateRecoverable(rootDirectory)
  const observed = await readGenerationLifecycleLock(rootDirectory, true)
  if (!sameLifecycleLockIdentity(locked, observed) || observed.reclaim?.record.token !== reclaim.record.token ||
      observed.reclaim.recordInode !== reclaim.recordInode) {
    throw new TypeError('generation lifecycle reclaim record was replaced')
  }
  await unlink(join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME, GENERATION_LIFECYCLE_RECLAIM_RECORD_NAME))
  await syncDirectory(join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME))
  const withoutReclaim = await readGenerationLifecycleLock(rootDirectory, false)
  if (!sameLifecycleLockIdentity(locked, withoutReclaim)) throw new TypeError('generation lifecycle lock changed while clearing a dead reclaim')
  return withoutReclaim
}

async function reclaimStaleGenerationLifecycleLock(rootDirectory: string): Promise<void> {
  let stale = await readGenerationLifecycleLock(rootDirectory, true)
  stale = await removeDeadGenerationLifecycleReclaim(rootDirectory, stale)
  if (!processIsDefinitelyDead(stale.record.pid)) throw new TypeError('generation lifecycle is already locked by a live owner')
  await assertGenerationLifecycleStateRecoverable(rootDirectory)
  const reclaim = generationLifecycleReclaim(rootDirectory, stale.record.token)
  try {
    await writeExclusive(
      join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME, GENERATION_LIFECYCLE_RECLAIM_RECORD_NAME),
      JSON.stringify(reclaim, null, 2) + '\n',
      0o600,
    )
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new TypeError('generation lifecycle stale-lock recovery is already active')
    }
    throw error
  }
  await syncDirectory(join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME))
  const claimed = await readGenerationLifecycleLock(rootDirectory, true)
  if (!sameLifecycleLockIdentity(stale, claimed) || claimed.reclaim?.record.token !== reclaim.token) {
    throw new TypeError('generation lifecycle lock was replaced during stale-lock claim')
  }
  await assertGenerationLifecycleStateRecoverable(rootDirectory)
  await retireGenerationLifecycleLock(rootDirectory, claimed, 'reclaim')
}

async function createGenerationLifecycleLock(
  rootDirectory: string,
): Promise<BootstrapGenerationLifecycleLockIdentity | null> {
  const lockPath = join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME)
  let directoryDevice: number
  let directoryInode: number
  try {
    await mkdir(lockPath, { mode: 0o700 })
    const info = await lstat(lockPath)
    directoryDevice = info.dev
    directoryInode = info.ino
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null
    throw error
  }
  const record = generationLifecycleLock(rootDirectory)
  try {
    await writeExclusive(
      join(lockPath, GENERATION_LIFECYCLE_LOCK_RECORD_NAME),
      JSON.stringify(record, null, 2) + '\n',
      0o600,
    )
    await syncDirectory(lockPath)
    await syncDirectory(rootDirectory)
    const locked = await readGenerationLifecycleLock(rootDirectory, false)
    if (locked.directoryDevice !== directoryDevice || locked.directoryInode !== directoryInode || locked.record.token !== record.token) {
      throw new TypeError('generation lifecycle lock was replaced during acquisition')
    }
    return locked
  } catch (error: unknown) {
    try {
      const info = await lstat(lockPath)
      if (info.dev === directoryDevice && info.ino === directoryInode && info.isDirectory() && !info.isSymbolicLink()) {
        const names = await readdir(lockPath)
        if (names.length === 1 && names[0] === GENERATION_LIFECYCLE_LOCK_RECORD_NAME) {
          await unlink(join(lockPath, GENERATION_LIFECYCLE_LOCK_RECORD_NAME))
        }
        if ((await readdir(lockPath)).length === 0) await rmdir(lockPath)
      }
    } catch {
      // Leave anything that cannot still be proven to be this acquisition in place.
    }
    throw error
  }
}

interface GenerationLifecycleLockGuard {
  assertOwned: () => Promise<void>
}

async function withGenerationLifecycleLock<T>(
  rootDirectory: string,
  action: (guard: GenerationLifecycleLockGuard) => Promise<T>,
): Promise<T> {
  let locked = await createGenerationLifecycleLock(rootDirectory)
  if (locked === null) {
    await reclaimStaleGenerationLifecycleLock(rootDirectory)
    locked = await createGenerationLifecycleLock(rootDirectory)
    if (locked === null) throw new TypeError('generation lifecycle lock was acquired by another owner')
  }
  const owned = locked
  const guard: GenerationLifecycleLockGuard = {
    assertOwned: () => assertGenerationLifecycleLockOwned(rootDirectory, owned),
  }
  try {
    await guard.assertOwned()
    return await action(guard)
  } finally {
    await retireGenerationLifecycleLock(rootDirectory, owned, 'release')
  }
}

function assertExpectedCurrent(expected: string | null, actual: string | null): void {
  const normalized = expected === null ? null : identifier(expected, 'expectedCurrent')
  if (normalized !== actual) {
    throw new TypeError(`generation current CAS mismatch: expected ${normalized ?? 'none'}, observed ${actual ?? 'none'}`)
  }
}

async function replaceCurrentGeneration(
  rootDirectory: string,
  expectedBefore: string | null,
  next: string | null,
  hooks: BootstrapGenerationLifecycleHooks | undefined,
  guard: GenerationLifecycleLockGuard,
): Promise<void> {
  await guard.assertOwned()
  await hooks?.beforeCurrentSwap?.()
  await guard.assertOwned()
  const observed = await currentGenerationId(rootDirectory)
  assertExpectedCurrent(expectedBefore, observed)
  await guard.assertOwned()
  const currentPath = join(rootDirectory, 'current')
  if (next === null) {
    if (observed !== null) await unlink(currentPath)
    await syncDirectory(rootDirectory)
    await guard.assertOwned()
    await hooks?.afterCurrentSwap?.()
    await guard.assertOwned()
    return
  }
  const temporary = join(rootDirectory, `.current.${randomUUID()}.tmp`)
  try {
    await symlink(`generations/${identifier(next, 'next generation')}`, temporary)
    await syncDirectory(rootDirectory)
    await rename(temporary, currentPath)
    await syncDirectory(rootDirectory)
  } finally {
    try { await unlink(temporary) } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  await guard.assertOwned()
  await hooks?.afterCurrentSwap?.()
  await guard.assertOwned()
}

function assertPriorJournalSettled(journal: BootstrapActivationJournal | null, current: string | null): void {
  if (journal === null) return
  if (journal.state === 'prepared') throw new TypeError('previous generation activation is incomplete; rollback it before activating another generation')
  const expected = journal.state === 'committed' ? journal.next : journal.previous
  if (current !== expected) throw new TypeError('activation journal and current link disagree')
}

export async function activateBootstrapGeneration(
  input: BootstrapGenerationActivateInput,
): Promise<BootstrapGenerationSwitchResult> {
  const root = await ensureGenerationRoot(input.rootDirectory, false)
  const generationId = identifier(input.generationId, 'generationId')
  const timestamp = canonicalNow(input.now)
  return withGenerationLifecycleLock(root, async guard => {
    const target = await inspectBootstrapGeneration({ rootDirectory: root, generationId })
    const previous = await currentGenerationId(root)
    assertExpectedCurrent(input.expectedCurrent, previous)
    if (previous === generationId) throw new TypeError('generation is already current')
    const priorJournal = await readActivationJournal(root, false)
    assertPriorJournalSettled(priorJournal, previous)
    const prepared = activationJournal({
      schemaVersion: 1,
      operationId: 'activation:' + randomUUID(),
      previous,
      next: generationId,
      state: 'prepared',
      preparedAt: timestamp,
      committedAt: null,
      rolledBackAt: null,
    })
    await guard.assertOwned()
    await writeActivationJournal(root, prepared)
    await guard.assertOwned()
    await replaceCurrentGeneration(root, previous, generationId, input.hooks, guard)
    const committed = activationJournal({
      schemaVersion: 1,
      operationId: prepared.operationId,
      previous,
      next: generationId,
      state: 'committed',
      preparedAt: prepared.preparedAt,
      committedAt: timestamp,
      rolledBackAt: null,
    })
    await guard.assertOwned()
    await writeActivationJournal(root, committed)
    return {
      previous,
      current: generationId,
      generationDigest: target.generationDigest,
      journalDigest: committed.journalDigest,
    }
  })
}

export async function rollbackBootstrapGeneration(
  input: BootstrapGenerationRollbackInput,
): Promise<BootstrapGenerationSwitchResult> {
  const root = await ensureGenerationRoot(input.rootDirectory, false)
  const timestamp = canonicalNow(input.now)
  return withGenerationLifecycleLock(root, async guard => {
    const current = await currentGenerationId(root)
    assertExpectedCurrent(input.expectedCurrent, current)
    const journal = await readActivationJournal(root, true)
    if (journal === null) throw new TypeError('activation journal does not exist')
    if (journal.state === 'rolled-back') {
      if (current !== journal.previous) throw new TypeError('rolled-back journal and current link disagree')
      const previousGeneration = current === null ? null : await inspectBootstrapGeneration({ rootDirectory: root, generationId: current })
      return {
        previous: journal.next,
        current,
        generationDigest: previousGeneration?.generationDigest ?? null,
        journalDigest: journal.journalDigest,
      }
    }
    if (current !== journal.next && current !== journal.previous) {
      throw new TypeError('rollback refuses a current link unrelated to journal.next or journal.previous')
    }
    const previousGeneration = journal.previous === null
      ? null
      : await inspectBootstrapGeneration({ rootDirectory: root, generationId: journal.previous })
    if (current === journal.next) {
      await replaceCurrentGeneration(root, journal.next, journal.previous, input.hooks, guard)
    }
    const rolledBack = activationJournal({
      schemaVersion: 1,
      operationId: journal.operationId,
      previous: journal.previous,
      next: journal.next,
      state: 'rolled-back',
      preparedAt: journal.preparedAt,
      committedAt: journal.committedAt,
      rolledBackAt: timestamp,
    })
    await guard.assertOwned()
    await writeActivationJournal(root, rolledBack)
    return {
      previous: journal.next,
      current: journal.previous,
      generationDigest: previousGeneration?.generationDigest ?? null,
      journalDigest: rolledBack.journalDigest,
    }
  })
}
