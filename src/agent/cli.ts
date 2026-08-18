#!/usr/bin/env node
import { isAbsolute, normalize } from 'node:path'
import { readAgentConfig } from './config.ts'
import { applyStoredPlan, createStoredPlan, inspectAgent, readOrRecoverAction, safeRuntimeError } from './runtime.ts'
import type { FleetPlanApproval } from './protocol.ts'

const MAX_INPUT_BYTES = 64 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(value)) throw Object.assign(new TypeError(label + ' must be an object'), { code: 'invalid-payload' })
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw Object.assign(new TypeError(label + ' has unsupported or missing fields'), { code: 'invalid-payload' })
  }
  return value
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw Object.assign(new TypeError(field + ' must be a trimmed non-empty string'), { code: 'invalid-payload' })
  }
  return value
}

async function readStdin(): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > MAX_INPUT_BYTES) throw Object.assign(new Error('request body is too large'), { code: 'invalid-payload' })
    chunks.push(buffer)
  }
  const source = Buffer.concat(chunks).toString('utf8').trim()
  return source === '' ? null : JSON.parse(source) as unknown
}

function parseArgs(argv: string[]): { configPath: string; command: 'inspect' | 'plan' | 'apply' | 'status' } {
  if (argv.length !== 3 || argv[0] !== '--config') throw Object.assign(new Error('usage: dsh-fleet-agent --config <path> <command>'), { code: 'invalid-invocation' })
  const configPath = argv[1] as string
  if (!isAbsolute(configPath) || normalize(configPath) !== configPath || configPath.includes('\0')) {
    throw Object.assign(new Error('config path must be absolute'), { code: 'invalid-invocation' })
  }
  const command = argv[2]
  if (command !== 'inspect' && command !== 'plan' && command !== 'apply' && command !== 'status') {
    throw Object.assign(new Error('unsupported command'), { code: 'invalid-invocation' })
  }
  return { configPath, command }
}

async function dispatch(): Promise<unknown> {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    throw Object.assign(new Error('fleet agent refuses to run as root'), { code: 'root-refused' })
  }
  const { configPath, command } = parseArgs(process.argv.slice(2))
  const config = await readAgentConfig(configPath)
  const payload = await readStdin()
  if (command === 'inspect') {
    if (payload !== null && (isRecord(payload) ? Object.keys(payload).length !== 0 : true)) {
      throw Object.assign(new Error('inspect payload must be empty'), { code: 'invalid-payload' })
    }
    return inspectAgent(config)
  }
  if (command === 'plan') {
    const body = exactObject(payload, ['pluginId'], 'plan payload')
    return createStoredPlan(config, stringField(body.pluginId, 'pluginId'))
  }
  if (command === 'status') {
    const body = exactObject(payload, ['planId'], 'status payload')
    const action = await readOrRecoverAction(config, stringField(body.planId, 'planId'))
    if (action === null) throw Object.assign(new Error('action not found'), { code: 'action-not-found' })
    return action
  }
  const body = exactObject(payload, ['approval'], 'apply payload')
  return applyStoredPlan(config, body.approval as FleetPlanApproval)
}

try {
  const value = await dispatch()
  process.stdout.write(JSON.stringify({ ok: true, value }) + '\n')
} catch (error: unknown) {
  process.stdout.write(JSON.stringify({ ok: false, error: safeRuntimeError(error) }) + '\n')
}
