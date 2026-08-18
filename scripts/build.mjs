import { copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: process.env })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(command + ' exited with ' + (code ?? ('signal ' + signal))))
    })
  })
}
for (const dir of ['dist-host', 'dist-testing', 'dist-agent', 'dist-client']) await rm(join(root, dir), { recursive: true, force: true })
await run(join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'])
await run(join(root, 'node_modules/.bin/tsdown'), ['--config', 'tsdown.config.ts'])
await copyFile(join(root, 'dist-host', 'index.js'), join(root, 'index.mjs'))
await copyFile(join(root, 'dist-testing', 'testing.js'), join(root, 'testing.mjs'))
await copyFile(join(root, 'dist-agent', 'agent.js'), join(root, 'agent.mjs'))
await copyFile(join(root, 'dist-client', 'client.js'), join(root, 'client.js'))
await copyFile(join(root, 'dist-client', 'client.js.map'), join(root, 'client.js.map'))
for (const dir of ['dist-host', 'dist-testing', 'dist-agent', 'dist-client']) await rm(join(root, dir), { recursive: true, force: true })
