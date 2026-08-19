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
  ['non-example macOS home path', /\/Users\/(?!example(?:\/|$))[A-Za-z0-9._-]+(?:\/|\b)/],
  ['private fleet team identifier', new RegExp('\\b' + 'ruby' + '-team\\b')],
  ['private fleet host identifier', new RegExp('\\b(?:' + [
    'ruby' + '-mac',
    'm3' + '-mac',
    'xxl' + '-mac',
    'pm' + '-codex',
    'ruby' + '-win',
  ].join('|') + ')\\b')],
  ['maintainer GitHub coordinate used as a fixture', new RegExp('github:' + 'ruby' + '1304/')],
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

  if (/^(?:tests|examples)\//.test(file) && new RegExp('\\bm' + '[35]\\b').test(source)) {
    fail(`private fleet device fixture found in ${file}`)
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

const readme = await readFile(join(root, 'README.md'), 'utf8')
const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8')
const security = await readFile(join(root, 'SECURITY.md'), 'utf8')
const issueTemplate = await readFile(join(root, '.github/ISSUE_TEMPLATE/bug_report.yml'), 'utf8')
const changelogHeading = changelog.match(/^## (\d+\.\d+\.\d+) - (.+)$/m)
if (changelogHeading?.[1] !== pkg.version) fail('top changelog version does not match package.json')
if (!/^(?:Unreleased candidate|\d{4}-\d{2}-\d{2})$/.test(changelogHeading?.[2] ?? '')) {
  fail('top changelog entry must be an unreleased candidate or a dated release')
}
if (!readme.includes(`\`${pkg.version}\` is an unreleased open-source candidate`)
  && !readme.includes(`\`${pkg.version}\` targets DSH`)) {
  fail('README status does not identify the package version')
}
if (!security.includes(`\`dsh-fleet\` ${pkg.version}`)) fail('SECURITY.md does not identify the package version')
if (!issueTemplate.includes(`placeholder: ${pkg.version}`)) fail('bug report template does not identify the package version')

for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
  if (subpath === './package.json' || typeof target !== 'string') continue
  const packagedTarget = target.replace(/^\.\//, '')
  if (!pkg.files?.includes(packagedTarget)) fail(`package export is omitted from files: ${subpath}`)
}
for (const [binary, target] of Object.entries(pkg.bin ?? {})) {
  if (typeof target !== 'string') continue
  const packagedTarget = target.replace(/^\.\//, '')
  if (!pkg.files?.includes(packagedTarget)) fail(`package binary is omitted from files: ${binary}`)
}

const runtimeBundleContract = {
  './agent': './agent.mjs',
  './worker': './worker.mjs',
}
for (const [subpath, target] of Object.entries(runtimeBundleContract)) {
  if (pkg.exports?.[subpath] !== target) fail(`runtime bundle export ${subpath} must target ${target}`)
  if (!pkg.files?.includes(target.slice(2))) fail(`runtime bundle ${target} is omitted from files`)
}

const notices = await readFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  const dependencyPackage = JSON.parse(await readFile(join(root, 'node_modules', dependency, 'package.json'), 'utf8'))
  if (!notices.includes(`${dependency} ${dependencyPackage.version}`)) {
    fail(`third-party notices do not identify ${dependency} ${dependencyPackage.version}`)
  }
}

const agentMode = (await stat(join(root, 'agent.mjs'))).mode
if ((agentMode & 0o111) === 0) fail('agent.mjs must remain executable')
const agentBundle = await readFile(join(root, 'agent.mjs'), 'utf8')
if (!/["']worker\.mjs["']/.test(agentBundle)) fail('agent.mjs must bind its sibling worker.mjs bundle')
const workerInfo = await stat(join(root, 'worker.mjs'))
if (!workerInfo.isFile()) fail('worker.mjs must be a regular file')
if ((workerInfo.mode & 0o022) !== 0) fail('worker.mjs must not be group- or world-writable')
const workerBundle = await readFile(join(root, 'worker.mjs'), 'utf8')
const workerRuntimeSpecifiers = [
  ...workerBundle.matchAll(/^(?:import|export)(?:\s+[^'"\n]+?\s+from\s+|\s*)['"]([^'"]+)['"];?$/gm),
  ...workerBundle.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
]
for (const match of workerRuntimeSpecifiers) {
  if (!match[1]?.startsWith('node:')) fail(`worker.mjs has an external runtime import: ${match[1]}`)
}
const bootstrapMode = (await stat(join(root, 'bootstrap.mjs'))).mode
if ((bootstrapMode & 0o111) === 0) fail('bootstrap.mjs must remain executable')

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
    const immutableArtifact = plugin.source === 'artifact' && /^[0-9a-f]{64}$/.test(plugin.artifactDigest ?? '')
    if (!immutableNpm && !immutableGitHub && !immutableArtifact) fail(`stable example plugin is mutable: ${plugin.id}`)
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
