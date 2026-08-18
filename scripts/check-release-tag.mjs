import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
const tag = process.env.GITHUB_REF_NAME ?? process.argv[2]
if (tag !== `v${pkg.version}`) {
  console.error(`Release tag ${JSON.stringify(tag)} does not match package version v${pkg.version}.`)
  process.exitCode = 1
} else {
  console.log(`Release tag matches package version: ${tag}`)
}
