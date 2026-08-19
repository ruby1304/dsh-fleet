import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const failures = []
const requiredFiles = [
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'SUPPORT.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'THIRD_PARTY_NOTICES.md',
  'docs/SECURITY_MODEL.md',
  'docs/RELEASING.md',
  '.github/workflows/ci.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/publish.yml',
]

function fail(message) {
  failures.push(message)
}

let tracked = []
try {
  tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  }).split('\0').filter(Boolean)
} catch (error) {
  fail(`cannot enumerate tracked files: ${error instanceof Error ? error.message : String(error)}`)
}

const forbiddenNames = /(^|\/)(?:\.env(?:\..*)?|id_(?:rsa|ed25519)|[^/]+\.(?:pem|p12|pfx|key))$/i
const textExtensions = new Set(['', '.cjs', '.js', '.json', '.jsx', '.map', '.md', '.mjs', '.ts', '.tsx', '.txt', '.yaml', '.yml'])
const forbiddenContent = [
  ['maintainer-local path', new RegExp('/Users/' + 'qudian' + '(?:/|\\b)')],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{20,}\b/],
  ['AWS access key', /\bAKIA[A-Z0-9]{16}\b/],
]

for (const file of tracked) {
  if (forbiddenNames.test(file)) fail(`sensitive filename is tracked: ${file}`)
  if (!textExtensions.has(extname(file)) || file === 'pnpm-lock.yaml') continue
  const source = await readFile(join(root, file), 'utf8')
  for (const [label, pattern] of forbiddenContent) {
    if (pattern.test(source)) fail(`${label} found in ${file}`)
  }

  if (file.endsWith('.md')) {
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1]?.trim()
      if (!target || /^(?:https?:|mailto:|#)/.test(target)) continue
      const localTarget = target.split('#', 1)[0]
      if (!localTarget) continue
      try {
        await stat(resolve(root, dirname(file), decodeURIComponent(localTarget)))
      } catch {
        fail(`broken local Markdown link in ${file}: ${target}`)
      }
    }
  }
}

for (const file of requiredFiles) {
  if (!tracked.includes(file)) fail(`required repository file is missing: ${file}`)
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (pkg.license !== 'MIT') fail('package.json license must be MIT')
if (pkg.repository?.url !== 'git+https://github.com/ruby1304/dsh-fleet.git') fail('package repository URL is not canonical')
if (pkg.publishConfig?.access !== 'public' || pkg.publishConfig?.provenance !== true) {
  fail('publishConfig must require public access and provenance')
}
for (const file of [
  'README.md', 'CHANGELOG.md', 'SECURITY.md', 'SUPPORT.md', 'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'docs',
]) {
  if (!pkg.files?.includes(file)) fail(`public package omits ${file}`)
}
if (!/^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager ?? '')) fail('packageManager must pin an exact pnpm version')

const notices = await readFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  const dependencyPackage = JSON.parse(await readFile(join(root, 'node_modules', dependency, 'package.json'), 'utf8'))
  if (!notices.includes(`${dependency} ${dependencyPackage.version}`)) {
    fail(`third-party notices do not identify ${dependency} ${dependencyPackage.version}`)
  }
}

const agentMode = (await stat(join(root, 'agent.mjs'))).mode
if ((agentMode & 0o111) === 0) fail('agent.mjs must remain executable')

for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/codeql.yml', '.github/workflows/publish.yml']) {
  const source = await readFile(join(root, workflow), 'utf8')
  for (const line of source.split('\n')) {
    const action = line.match(/^\s*uses:\s*([^\s#]+)@([^\s#]+)/)
    if (action && !/^[0-9a-f]{40}$/.test(action[2] ?? '')) fail(`${workflow} uses an unpinned action: ${action[1]}`)
  }
}

const publishWorkflow = await readFile(join(root, '.github/workflows/publish.yml'), 'utf8')
if (!publishWorkflow.includes('id-token: write')) fail('publish workflow must request OIDC id-token permission')
if (/NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./.test(publishWorkflow)) fail('publish workflow must not use a long-lived npm token')

try {
  const { parseAgentConfig, parseFleetManifest } = await import('../testing.mjs')
  const manifestSource = await readFile(join(root, 'examples/fleet.lock.yaml'), 'utf8')
  const manifest = parseFleetManifest(manifestSource)
  const config = parseAgentConfig(JSON.parse(await readFile(join(root, 'examples/agent.config.json'), 'utf8')))
  if (!manifest.devices[config.deviceId]) fail('example Agent deviceId is not declared by the example manifest')

  const stableDevices = new Set(Object.entries(manifest.devices)
    .filter(([, device]) => device.channel === 'stable')
    .map(([id]) => id))
  for (const plugin of manifest.plugins) {
    const targetsStable = plugin.target?.devices?.some(id => stableDevices.has(id)) ?? false
    if (!targetsStable) continue
    const immutableNpm = plugin.source === 'npm' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(plugin.revision ?? '')
    const immutableGitHub = plugin.source?.startsWith('github:') === true && /^[0-9a-f]{40}$/.test(plugin.revision ?? '')
    if (!immutableNpm && !immutableGitHub) fail(`stable example plugin is mutable: ${plugin.id}`)
  }
} catch (error) {
  fail(`examples do not satisfy the public schemas: ${error instanceof Error ? error.message : String(error)}`)
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`repository-check: ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Repository hygiene passed (${tracked.length} repository files checked).`)
}
