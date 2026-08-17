import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.tsx'

describe('dsh-fleet client slots', () => {
  it('waits for shell.overlay before registering the fleet card', () => {
    let setup: (() => unknown) | undefined
    const register = vi.fn((_descriptor: Record<string, unknown>, _component: unknown) => () => {})
    const inject = vi.fn((name: string, callback: () => unknown) => {
      expect(name).toBe('shell.overlay')
      setup = callback
      return () => {}
    })

    apply({
      connection: { rpc: { call: vi.fn() } },
      slots: { inject, register },
    } as never)

    expect(inject).toHaveBeenCalledOnce()
    expect(register).not.toHaveBeenCalled()

    setup?.()
    expect(register).toHaveBeenCalledOnce()
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      name: 'shell.overlay',
      id: 'dsh-fleet',
      order: 110,
    })
  })
})
