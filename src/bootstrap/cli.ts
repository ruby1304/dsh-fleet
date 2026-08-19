#!/usr/bin/env node
import {
  activateBootstrapGeneration,
  assembleBootstrapGeneration,
  createBootstrapIdentity,
  inspectBootstrapGeneration,
  planBootstrapSet,
  renderBootstrapBundle,
  renderBootstrapSet,
  rollbackBootstrapGeneration,
} from './runtime.ts'

type Command =
  | 'identity' | 'render' | 'plan' | 'render-set'
  | 'generation-assemble' | 'generation-inspect' | 'generation-activate' | 'generation-rollback'

const COMMAND_FLAGS: Record<Command, { required: string[]; optional?: string[]; repeatable?: string[] }> = {
  identity: { required: ['--device', '--output-dir', '--principal', '--team'] },
  render: { required: ['--identity-dir', '--output-dir', '--overlay', '--pack'] },
  plan: { required: ['--overlay', '--pack'], repeatable: ['--overlay'] },
  'render-set': {
    required: ['--device', '--identity-dir', '--output-dir', '--overlay', '--pack'],
    repeatable: ['--overlay'],
  },
  'generation-assemble': {
    required: [
      '--agent-bundle', '--device', '--generation-id', '--identity-dir', '--overlay',
      '--pack', '--root', '--worker-bundle',
    ],
    optional: ['--bootstrap-bundle'],
    repeatable: ['--overlay'],
  },
  'generation-inspect': { required: ['--generation-id', '--root'] },
  'generation-activate': { required: ['--expected-current', '--generation-id', '--root'] },
  'generation-rollback': { required: ['--expected-current', '--root'] },
}

function parseFlags(argv: string[]): { command: Command; flags: Map<string, string[]> } {
  const command = argv.shift()
  if (typeof command !== 'string' || !Object.hasOwn(COMMAND_FLAGS, command)) throw new TypeError(
    'usage: dsh-fleet-bootstrap <identity|render|plan|render-set|generation-assemble|generation-inspect|generation-activate|generation-rollback> [options]',
  )
  const typedCommand = command as Command
  const specification = COMMAND_FLAGS[typedCommand]
  if (argv.length % 2 !== 0) throw new TypeError('bootstrap options must be --name value pairs')
  const flags = new Map<string, string[]>()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name === undefined || value === undefined || !/^--[a-z-]+$/.test(name) || value.length === 0) {
      throw new TypeError('bootstrap options are invalid')
    }
    if (!specification.required.includes(name) && specification.optional?.includes(name) !== true) {
      throw new TypeError(typedCommand + ' does not accept option: ' + name)
    }
    const values = flags.get(name) ?? []
    if (values.length > 0 && specification.repeatable?.includes(name) !== true) throw new TypeError('bootstrap option is duplicated: ' + name)
    values.push(value)
    flags.set(name, values)
  }
  const missing = specification.required.filter(name => !flags.has(name))
  if (missing.length > 0) {
    throw new TypeError(typedCommand + ' requires: ' + specification.required.join(' '))
  }
  return { command: typedCommand, flags }
}

function one(flags: Map<string, string[]>, name: string): string {
  const value = flags.get(name)?.[0]
  if (value === undefined) throw new TypeError('missing bootstrap option: ' + name)
  return value
}

function expectedCurrent(flags: Map<string, string[]>): string | null {
  const value = one(flags, '--expected-current')
  return value === 'none' ? null : value
}

try {
  const { command, flags } = parseFlags(process.argv.slice(2))
  let result: unknown
  if (command === 'identity') {
    result = await createBootstrapIdentity({
      outputDirectory: one(flags, '--output-dir'),
      teamId: one(flags, '--team'),
      principalId: one(flags, '--principal'),
      deviceId: one(flags, '--device'),
    })
  } else if (command === 'render') {
    result = await renderBootstrapBundle({
      packPath: one(flags, '--pack'),
      overlayPath: one(flags, '--overlay'),
      outputDirectory: one(flags, '--output-dir'),
      identityDirectory: one(flags, '--identity-dir'),
    })
  } else if (command === 'plan') {
    result = await planBootstrapSet({ packPath: one(flags, '--pack'), overlayPaths: flags.get('--overlay') ?? [] })
  } else if (command === 'render-set') {
    result = await renderBootstrapSet({
      packPath: one(flags, '--pack'),
      overlayPaths: flags.get('--overlay') ?? [],
      outputDirectory: one(flags, '--output-dir'),
      identityDirectory: one(flags, '--identity-dir'),
      deviceId: one(flags, '--device'),
    })
  } else if (command === 'generation-assemble') {
    result = await assembleBootstrapGeneration({
      packPath: one(flags, '--pack'),
      overlayPaths: flags.get('--overlay') ?? [],
      rootDirectory: one(flags, '--root'),
      generationId: one(flags, '--generation-id'),
      identityDirectory: one(flags, '--identity-dir'),
      deviceId: one(flags, '--device'),
      agentBundlePath: one(flags, '--agent-bundle'),
      workerBundlePath: one(flags, '--worker-bundle'),
      ...(flags.has('--bootstrap-bundle') ? { bootstrapBundlePath: one(flags, '--bootstrap-bundle') } : {}),
    })
  } else if (command === 'generation-inspect') {
    result = await inspectBootstrapGeneration({
      rootDirectory: one(flags, '--root'), generationId: one(flags, '--generation-id'),
    })
  } else if (command === 'generation-activate') {
    result = await activateBootstrapGeneration({
      rootDirectory: one(flags, '--root'),
      generationId: one(flags, '--generation-id'),
      expectedCurrent: expectedCurrent(flags),
    })
  } else {
    result = await rollbackBootstrapGeneration({
      rootDirectory: one(flags, '--root'), expectedCurrent: expectedCurrent(flags),
    })
  }
  process.stdout.write(JSON.stringify({ ok: true, value: result }) + '\n')
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'bootstrap failed'
  process.stdout.write(JSON.stringify({ ok: false, error: { code: 'bootstrap-failed', message } }) + '\n')
  process.exitCode = 1
}
