import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'

const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'
const MAX_PACKAGE_SEARCH_DEPTH = 8

export interface FleetRuntimeIdentity {
  nodeRealpath: string
  dshEntrypointRealpath: string
  dshPackageRealpath: string
  dshVersion: string
  entrypointDigest: string
  packageJsonDigest: string
  runtimeDigest: string
}

interface DshPackageMetadata {
  name?: unknown
  version?: unknown
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

async function readRegularFile(path: string): Promise<Buffer> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile()) throw new TypeError('runtime identity accepts regular files only')
    return await handle.readFile()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new TypeError('runtime identity accepts regular files only')
    }
    throw error
  } finally {
    await handle?.close()
  }
}

async function findDshPackage(entrypoint: string): Promise<{
  packageRealpath: string
  packageJson: Buffer
  version: string
}> {
  let directory = dirname(entrypoint)
  for (let depth = 0; depth < MAX_PACKAGE_SEARCH_DEPTH; depth += 1) {
    const candidate = join(directory, 'package.json')
    try {
      const packageJson = await readRegularFile(candidate)
      const metadata = JSON.parse(packageJson.toString('utf8')) as DshPackageMetadata
      if (metadata.name === DSH_PACKAGE_NAME) {
        if (typeof metadata.version !== 'string' || metadata.version.trim() !== metadata.version || metadata.version.length === 0) {
          throw new TypeError('DSH runtime package version is invalid')
        }
        return {
          packageRealpath: await realpath(directory),
          packageJson,
          version: metadata.version,
        }
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new TypeError('running DSH package metadata was not found')
}

export async function inspectCurrentRuntimeIdentity(input: {
  execPath?: string
  entrypointPath?: string
} = {}): Promise<FleetRuntimeIdentity> {
  const execPath = input.execPath ?? process.execPath
  const entrypointPath = input.entrypointPath ?? process.argv[1]
  if (typeof entrypointPath !== 'string' || !isAbsolute(execPath) || !isAbsolute(entrypointPath)) {
    throw new TypeError('runtime identity needs absolute Node and DSH entrypoint paths')
  }
  const [nodeRealpath, dshEntrypointRealpath] = await Promise.all([
    realpath(execPath),
    realpath(entrypointPath),
  ])
  const [entrypoint, packageMetadata] = await Promise.all([
    readRegularFile(dshEntrypointRealpath),
    findDshPackage(dshEntrypointRealpath),
  ])
  const entrypointDigest = sha256(entrypoint)
  const packageJsonDigest = sha256(packageMetadata.packageJson)
  const identity = {
    nodeRealpath,
    dshEntrypointRealpath,
    dshPackageRealpath: packageMetadata.packageRealpath,
    dshVersion: packageMetadata.version,
    entrypointDigest,
    packageJsonDigest,
  }
  return {
    ...identity,
    runtimeDigest: sha256(JSON.stringify(identity)),
  }
}

export function validateRuntimeIdentity(value: unknown): asserts value is FleetRuntimeIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('runtime identity must be an object')
  }
  const body = value as Record<string, unknown>
  const expected = [
    'nodeRealpath', 'dshEntrypointRealpath', 'dshPackageRealpath', 'dshVersion',
    'entrypointDigest', 'packageJsonDigest', 'runtimeDigest',
  ].sort()
  if (Object.keys(body).sort().join(',') !== expected.join(',')) {
    throw new TypeError('runtime identity has unsupported or missing fields')
  }
  for (const field of ['nodeRealpath', 'dshEntrypointRealpath', 'dshPackageRealpath'] as const) {
    if (typeof body[field] !== 'string' || !isAbsolute(body[field]) || normalize(body[field]) !== body[field]) {
      throw new TypeError('runtime identity path is invalid')
    }
  }
  if (typeof body.dshVersion !== 'string' || body.dshVersion.length === 0 || body.dshVersion !== body.dshVersion.trim()) {
    throw new TypeError('runtime identity DSH version is invalid')
  }
  for (const field of ['entrypointDigest', 'packageJsonDigest', 'runtimeDigest'] as const) {
    if (typeof body[field] !== 'string' || !/^[0-9a-f]{64}$/.test(body[field])) {
      throw new TypeError('runtime identity digest is invalid')
    }
  }
  const identity = {
    nodeRealpath: body.nodeRealpath,
    dshEntrypointRealpath: body.dshEntrypointRealpath,
    dshPackageRealpath: body.dshPackageRealpath,
    dshVersion: body.dshVersion,
    entrypointDigest: body.entrypointDigest,
    packageJsonDigest: body.packageJsonDigest,
  }
  if (sha256(JSON.stringify(identity)) !== body.runtimeDigest) {
    throw new TypeError('runtime identity digest does not match its fields')
  }
}
