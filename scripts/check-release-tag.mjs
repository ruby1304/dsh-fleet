import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
const changelog = await readFile(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8')
const tag = process.env.GITHUB_REF_NAME ?? process.argv[2]
if (tag !== `v${pkg.version}`) {
  console.error(`Release tag ${JSON.stringify(tag)} does not match package version v${pkg.version}.`)
  process.exitCode = 1
} else {
  console.log(`Release tag matches package version: ${tag}`)
}

const releaseHeading = changelog.match(/^## (\d+\.\d+\.\d+) - (.+)$/m)
if (releaseHeading?.[1] !== pkg.version || !/^\d{4}-\d{2}-\d{2}$/.test(releaseHeading?.[2] ?? '')) {
  console.error(`Top changelog entry must be a dated ${pkg.version} release before publishing.`)
  process.exitCode = 1
}

try {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const tagged = execFileSync('git', ['rev-parse', `refs/tags/${tag}^{commit}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (tagged !== head) throw new Error('release tag does not point to HEAD')
  const worktree = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=normal'], { encoding: 'utf8' }).trim()
  if (worktree !== '') throw new Error('release worktree is not clean')
  execFileSync('git', ['rev-parse', '--verify', 'refs/remotes/origin/main'], { stdio: 'ignore' })
  execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main'], { stdio: 'ignore' })
  console.log('Release tag points to a clean commit belonging to origin/main.')
} catch {
  console.error('Release tag must point to the clean checked-out commit and belong to protected origin/main.')
  process.exitCode = 1
}
