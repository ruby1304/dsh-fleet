import { createHash } from 'node:crypto'
import { inspectCurrentRuntimeIdentity, type FleetRuntimeIdentity } from '../host/runtime-identity.ts'

export interface LaunchdServiceDefinitionIdentity {
  serviceTarget: string
  programArguments: string[]
  dshHome: string
  runtimeIdentity: FleetRuntimeIdentity
  serviceDefinitionDigest: string
  pid: number | null
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function block(lines: string[], name: string): string[] {
  const start = lines.findIndex(line => line.trim() === name + ' = {')
  if (start < 0) throw new TypeError('launchd service is missing the ' + name + ' block')
  const values: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const value = lines[index]!.trim()
    if (value === '}') return values
    if (value.length > 0) values.push(value)
  }
  throw new TypeError('launchd service has an unterminated ' + name + ' block')
}

function singleValue(lines: string[], name: string): string {
  const prefix = name + ' = '
  const values = lines.map(line => line.trim()).filter(line => line.startsWith(prefix)).map(line => line.slice(prefix.length))
  if (values.length !== 1 || values[0]!.length === 0) throw new TypeError('launchd service has an invalid ' + name)
  return values[0]!
}

function environmentValue(lines: string[], name: string): string {
  const prefix = name + ' => '
  const values = block(lines, 'environment').filter(line => line.startsWith(prefix)).map(line => line.slice(prefix.length))
  if (values.length !== 1 || values[0]!.length === 0) throw new TypeError('launchd service environment is missing ' + name)
  return values[0]!
}

export async function inspectLaunchdServiceDefinition(input: {
  source: string
  serviceTarget: string
  dshHome: string
  host: string
  port: number
}): Promise<LaunchdServiceDefinitionIdentity> {
  const lines = input.source.split(/\r?\n/)
  if (lines[0]?.trim() !== input.serviceTarget + ' = {') {
    throw new TypeError('launchd service target does not match the configured target')
  }
  const programArguments = block(lines, 'arguments')
  if (programArguments.length !== 7 || programArguments.some(argument => /[\r\n\0]/.test(argument))) {
    throw new TypeError('launchd service must have one exact DSH web argument vector')
  }
  const expectedTail = ['web', '--host', input.host, '--port', String(input.port)]
  if (programArguments.slice(2).some((argument, index) => argument !== expectedTail[index])) {
    throw new TypeError('launchd service DSH web arguments do not match the Agent configuration')
  }
  if (singleValue(lines, 'program') !== programArguments[0]) {
    throw new TypeError('launchd service program does not match argv[0]')
  }
  const dshHome = environmentValue(lines, 'DSH_HOME')
  if (dshHome !== input.dshHome) throw new TypeError('launchd service DSH_HOME does not match the Agent configuration')
  const nodePath = programArguments[0]!
  const entrypointPath = programArguments[1]!
  const runtimeIdentity = await inspectCurrentRuntimeIdentity({
    execPath: nodePath,
    entrypointPath,
  })
  const definition = {
    serviceTarget: input.serviceTarget,
    programArguments,
    dshHome,
    runtimeDigest: runtimeIdentity.runtimeDigest,
  }
  const rawPid = singleValue(lines, 'pid')
  const pid = Number(rawPid)
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError('launchd service pid is invalid')
  return {
    serviceTarget: input.serviceTarget,
    programArguments,
    dshHome,
    runtimeIdentity,
    serviceDefinitionDigest: sha256(JSON.stringify(definition)),
    pid,
  }
}
