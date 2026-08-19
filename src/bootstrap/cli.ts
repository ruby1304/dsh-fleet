#!/usr/bin/env node
import { createBootstrapIdentity, renderBootstrapBundle } from './runtime.ts'

type Command = 'identity' | 'render'

function parseFlags(argv: string[]): { command: Command; flags: Map<string, string> } {
  const command = argv.shift()
  if (command !== 'identity' && command !== 'render') throw new TypeError('usage: dsh-fleet-bootstrap <identity|render> [options]')
  if (argv.length % 2 !== 0) throw new TypeError('bootstrap options must be --name value pairs')
  const flags = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name === undefined || value === undefined || !/^--[a-z-]+$/.test(name) || value.length === 0 || flags.has(name)) {
      throw new TypeError('bootstrap options are invalid or duplicated')
    }
    flags.set(name, value)
  }
  const expected = command === 'identity'
    ? ['--device', '--output-dir', '--principal', '--team']
    : ['--identity-dir', '--output-dir', '--overlay', '--pack']
  const actual = [...flags.keys()].sort()
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new TypeError(command + ' requires exactly: ' + expected.join(' '))
  }
  return { command, flags }
}

try {
  const { command, flags } = parseFlags(process.argv.slice(2))
  const result = command === 'identity'
    ? await createBootstrapIdentity({
      outputDirectory: flags.get('--output-dir')!,
      teamId: flags.get('--team')!,
      principalId: flags.get('--principal')!,
      deviceId: flags.get('--device')!,
    })
    : await renderBootstrapBundle({
      packPath: flags.get('--pack')!,
      overlayPath: flags.get('--overlay')!,
      outputDirectory: flags.get('--output-dir')!,
      identityDirectory: flags.get('--identity-dir')!,
    })
  process.stdout.write(JSON.stringify({ ok: true, value: result }) + '\n')
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'bootstrap failed'
  process.stdout.write(JSON.stringify({ ok: false, error: { code: 'bootstrap-failed', message } }) + '\n')
  process.exitCode = 1
}
