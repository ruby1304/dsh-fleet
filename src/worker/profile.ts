import { createHash } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'

const EXECUTION_PROFILE_FILES = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'cordis.patch.yml',
  'cordis.yml',
  'fleet.lock.yaml',
] as const
const EXECUTION_PROFILE_FILE_NAMES = new Set<string>(EXECUTION_PROFILE_FILES)

export type ExecutionProfileHashErrorCode =
  | 'execution-profile-invalid'
  | 'execution-profile-layout-unsupported'

export class ExecutionProfileHashError extends Error {
  readonly code: ExecutionProfileHashErrorCode

  constructor(code: ExecutionProfileHashErrorCode, message: string) {
    super(message)
    this.name = 'ExecutionProfileHashError'
    this.code = code
  }
}

function profileDirectory(dshHome: string, profile: string): string {
  if (!isAbsolute(dshHome) || normalize(dshHome) !== dshHome || dshHome === '/' || dshHome.includes('\0')) {
    throw new ExecutionProfileHashError('execution-profile-invalid', 'DSH home must be a normalized absolute non-root path')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)) {
    throw new ExecutionProfileHashError('execution-profile-invalid', 'execution profile id is invalid')
  }
  return join(dshHome, 'profiles', profile)
}

async function readRegularOptional(path: string): Promise<string | null> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile()) {
      throw new ExecutionProfileHashError('execution-profile-invalid', 'execution profile state accepts regular files only')
    }
    return await handle.readFile('utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new ExecutionProfileHashError('execution-profile-invalid', 'execution profile state must not contain symbolic links')
    }
    throw error
  } finally {
    await handle?.close()
  }
}

/**
 * Hashes the complete reproducible DSH profile snapshot. node_modules is
 * deliberately represented by package.json plus the npm/pnpm lockfiles and is
 * rebuilt with scripts disabled; every other top-level entry is rejected.
 */
export async function computeExecutionProfileHash(dshHome: string, profile: string): Promise<string> {
  const directory = profileDirectory(dshHome, profile)
  let directoryInfo: Stats | undefined
  try {
    directoryInfo = await lstat(directory)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (directoryInfo === undefined || directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
    throw new ExecutionProfileHashError('execution-profile-invalid', 'execution profile must be an existing real directory')
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.name === 'node_modules') {
      const info = await lstat(path)
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new ExecutionProfileHashError('execution-profile-invalid', 'execution profile node_modules must be a real directory')
      }
      continue
    }
    if (!EXECUTION_PROFILE_FILE_NAMES.has(entry.name)) {
      throw new ExecutionProfileHashError(
        'execution-profile-layout-unsupported',
        'execution profile contains unsupported top-level state',
      )
    }
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new ExecutionProfileHashError('execution-profile-invalid', 'execution profile state accepts regular files only')
    }
  }
  const files = Object.fromEntries(await Promise.all(EXECUTION_PROFILE_FILES.map(async name => [
    name,
    await readRegularOptional(join(directory, name)),
  ] as const)))
  return createHash('sha256').update(JSON.stringify(files), 'utf8').digest('hex')
}

export async function assertExecutionProfileHash(
  dshHome: string,
  profile: string,
  expectedHash: string,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(expectedHash) || await computeExecutionProfileHash(dshHome, profile) !== expectedHash) {
    throw new ExecutionProfileHashError('execution-profile-invalid', 'execution profile no longer matches its signed task binding')
  }
}
