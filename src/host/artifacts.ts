import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

function contained(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path))
}

function dependencyArtifactPath(profileDir: string, spec: string): string | null {
  if (!spec.startsWith('file:')) return null
  const encoded = spec.slice('file:'.length)
  if (encoded.length === 0 || encoded.startsWith('//') || /[?#\0]/.test(encoded)) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(encoded)
  } catch {
    return null
  }
  if (decoded.length === 0 || decoded.includes('\0')) return null
  const candidate = isAbsolute(decoded) ? resolve(decoded) : resolve(profileDir, decoded)
  return candidate.endsWith('.tgz') ? candidate : null
}

export async function digestInstalledArtifact(profileDir: string, artifactStore: string, spec: string): Promise<string | undefined> {
  const candidate = dependencyArtifactPath(profileDir, spec)
  if (candidate === null) return undefined
  try {
    const [storePath, candidatePath, originalInfo] = await Promise.all([
      realpath(artifactStore),
      realpath(candidate),
      lstat(candidate),
    ])
    if (originalInfo.isSymbolicLink() || !originalInfo.isFile() || !contained(storePath, candidatePath)) return undefined
    const handle = await open(candidatePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const openedInfo = await handle.stat()
      if (!openedInfo.isFile() || openedInfo.dev !== originalInfo.dev || openedInfo.ino !== originalInfo.ino) return undefined
      const hash = createHash('sha256')
      const buffer = Buffer.allocUnsafe(64 * 1024)
      let position = 0
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
        if (bytesRead === 0) break
        hash.update(buffer.subarray(0, bytesRead))
        position += bytesRead
      }
      return hash.digest('hex')
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}
