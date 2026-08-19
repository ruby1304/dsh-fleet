import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const generated = ['index.mjs', 'testing.mjs', 'agent.mjs', 'worker.mjs', 'bootstrap.mjs', 'client.js', 'client.js.map']

async function digest(path) {
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null
    throw error
  }
}

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'scripts/build.mjs')], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`build exited with ${code ?? `signal ${signal}`}`))
    })
  })
}

const before = new Map(await Promise.all(generated.map(async file => [file, await digest(join(root, file))])))
await runBuild()
const stale = []
for (const file of generated) {
  if (before.get(file) !== await digest(join(root, file))) stale.push(file)
}

if (stale.length > 0) {
  console.error(`Generated files were stale and have been rebuilt: ${stale.join(', ')}`)
  console.error('Review the generated diff, then run the check again.')
  process.exitCode = 1
} else {
  console.log(`Generated bundles are reproducible and current (${generated.length} files).`)
}
