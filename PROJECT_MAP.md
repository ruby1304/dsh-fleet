# dsh-fleet project map

Current candidate: `0.4.3`, targeting DSH `0.1.0-rc.8` exactly. DSH rc.7 remains on the frozen Fleet `0.4.0` line.

## Runtime surfaces

| Surface | Source | Generated package entry |
|---|---|---|
| DSH Host plugin | `src/index.ts`, `src/host/` | `index.mjs` |
| Web settings client | `src/client/index.tsx` | `client.js`, `client.js.map` |
| One-shot Fleet Agent and doctor | `src/agent/` | `agent.mjs` |
| Policy-bounded task worker | `src/worker/` | `worker.mjs` |
| Team/bootstrap generation tools | `src/bootstrap/` | `bootstrap.mjs` |
| Public test helpers | `src/testing.ts` | `testing.mjs` |
| Signed device protocol | `src/a2a/`, `src/federation/` | Agent/Host bundles above |

## Critical compatibility and safety contracts

- `src/agent/service-definition.ts` binds launchd to its real Node/DSH files, `DSH_HOME`, PID and exact Web argv. The only accepted tails are rc.7 `web --host H --port P` and rc.8 `web --no-open --host H --port P`; the observed rc.7/rc.8 package version must match that form.
- `src/agent/runtime.ts` owns immutable release planning, staging, restart, health proof, rollback and retention.
- Agent and worker profile hashes include both `package-lock.json` and `pnpm-lock.yaml` when present. Read-only doctor accepts npm-only profiles; release mutation remains pnpm-only and requires a hybrid/pnpm candidate.
- `src/worker/` enforces fixed workspace/profile policy and rechecks signed task bindings before execution and tool calls.
- `src/bootstrap/` keeps public team data separate from private device paths, artifact digests and task-capable trust.
- Generated bundles are committed artifacts. Change source first, run `pnpm run build`, then require `pnpm run check:generated` to reproduce all seven outputs.

## Verification map

- `tests/service-definition.test.ts` covers the two exact launchd forms and rejects extra, duplicate, misplaced and unknown flags.
- `tests/release-runtime.test.ts` covers rc.8 launchd planning, read-only doctor, restart ownership and rollback.
- `tests/rc8-contract.test.ts` covers the official DSH rc.8 Host, Client, Settings and isolated CLI reconciliation contracts.
- The `0.4.3` candidate has `21` Vitest files and `258` tests. Release gates are `pnpm run typecheck`, `pnpm test`, `pnpm run check:generated`, `pnpm run check:repository`, and `pnpm run release:check`.

Start with `README.md` for operator scope, `docs/SECURITY_MODEL.md` for trust boundaries, `docs/ONBOARDING.md` for deployment preparation, and `docs/RELEASING.md` for artifact provenance.
