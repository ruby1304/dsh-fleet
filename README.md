# dsh-fleet

[![CI](https://github.com/ruby1304/dsh-fleet/actions/workflows/ci.yml/badge.svg)](https://github.com/ruby1304/dsh-fleet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Declarative device inventory, drift detection, and owner-approved plugin convergence for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

## Project status

`0.2.0` is a release candidate for DSH `0.1.0-rc.7`. It contains two intentionally different capability levels:

- V0 provides read-only device inventory, profile drift, Loader health, unmanaged-bundle detection, and public update availability.
- V1 adds a narrow single-owner workflow for one exact plugin install or update, with explicit approval, restart, health verification, audit, and rollback.

This is not the complete Fleet product. It is not a multi-user control plane, MDM, general remote shell, secret distributor, or substitute for host security. Hub, enrollment, roles, signed approvals, configuration distribution, batch changes, remove, core DSH upgrades, and general task execution remain out of scope for this release.

Read [the security model](docs/SECURITY_MODEL.md) before enabling mutation.

## How it works

```text
loopback DSH Web
  -> fixed Fleet Host configuration
  -> local or fixed SSH transport
  -> one-shot dsh-fleet-agent on the target
  -> immutable plan and explicit approval
  -> snapshot and exact package operation
  -> DSH restart and loopback health verification
  -> success, proved rollback, or manual intervention
```

The Web client can select only a configured device and a plugin already present in that device's local manifest. It cannot provide package versions, URLs, paths, commands, arguments, or shell fragments.

The Fleet trigger is registered in DSH's additive `sidebar.footer.action` slot, so it participates in the sidebar layout above Settings instead of using viewport-fixed coordinates.

## Features

- device targeting by id, class, channel, and DSH profile;
- exact reconciliation of profile dependencies and active DSH bundles;
- Loader-aware `aligned`, `missing`, `spec-drift`, `runtime-inactive`, and `runtime-failed` states;
- credential-free public npm/GitHub update discovery with caching and explicit unsupported states;
- exact npm versions and GitHub 40-character commit revisions for stable mutation;
- fixed local or SSH Agent targets with no shell interpolation;
- immutable, expiring, profile- and manifest-bound plans;
- two-step plan review and explicit approval in the Operations UI;
- cross-process profile locking, snapshots, idempotent action state, and append-only audit events;
- scripts-disabled installation and frozen-lockfile rollback;
- mandatory DSH restart, loopback HTTP/Fleet RPC health, target alignment, and zero Loader failures;
- conservative recovery after cancellation, timeout, output overflow, or transport loss.

## Requirements and compatibility

- Node.js 22 or newer;
- pnpm 11 for Agent rollback/rematerialization;
- DSH `>=0.1.0-rc.7 <0.2.0`;
- macOS or Linux for the mutation-capable Agent;
- `screen`, `lsof`, and `ps` at fixed absolute paths for the current restart implementation;
- an existing SSH alias and host-key policy for remote targets.

Do not depend on a non-interactive `PATH`. Pin normalized absolute paths to Node.js, DSH, pnpm, the Agent bundle, Agent config, manifest, and restart tools.

## Install

Release deployments should use an immutable npm release or a verified tarball, never a live checkout link.

After an npm release is available:

```bash
dsh plugin --profile web add dsh-fleet@0.2.0 --save-exact --ignore-scripts
```

To build a reviewable tarball from source:

```bash
git clone https://github.com/ruby1304/dsh-fleet.git
cd dsh-fleet
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm run release:check
npm pack --ignore-scripts
shasum -a 256 dsh-fleet-0.2.0.tgz
dsh plugin --profile web add /absolute/path/to/dsh-fleet-0.2.0.tgz --save-exact --ignore-scripts
```

Use `link:$PWD` only for development:

```bash
dsh plugin --profile web add "link:$PWD" --save-exact --ignore-scripts
```

## Configure read-only inventory

Copy [`examples/fleet.lock.yaml`](examples/fleet.lock.yaml) to a private operational repository or owner-only state directory. Do not use the packaged example as production truth.

```yaml
schemaVersion: 1
team:
  id: example-team

devices:
  controller:
    assignedTo: owner
    class: portable-control
    channel: dev
  worker:
    assignedTo: owner
    class: always-on-worker
    channel: stable

plugins:
  - id: dsh-turn-fork
    source: npm
    revision: 0.1.0
    profiles: [web]
    target: { devices: [worker] }
```

Add the Host row to the DSH profile's `cordis.patch.yml`:

```yaml
- id: fleet
  name: dsh-fleet
  config:
    deviceId: controller
    manifestPath: /absolute/private/path/fleet.lock.yaml
    profile: web
    dshBinary: /absolute/path/to/dsh
    updateCheck: true
```

Restart DSH and verify the Fleet status and update views. This configuration is read-only until `convergence.enabled` and at least one fixed Agent target are explicitly added.

For a new machine, follow the complete [single-owner device onboarding checklist](docs/ONBOARDING.md). The packaged examples are schema examples, not a pairing mechanism or production state.

## Configure a target Agent

Copy [`examples/agent.config.json`](examples/agent.config.json) to an owner-readable target path, replace every placeholder, and set the file and state directory to owner-only permissions.

The Agent config fixes:

- device and profile identity;
- manifest, DSH home, DSH, pnpm, and state paths;
- plan lifetime;
- restart owner, command markers, host, and port;
- loopback health URL and mandatory Fleet RPC verification.

Inspect the target before enabling mutation:

```bash
/absolute/path/to/node \
  /absolute/path/to/agent.mjs \
  --config /absolute/private/path/agent.config.json \
  inspect
```

The Agent is one-shot and opens no listener. `restart.kind: none` is accepted for read-only inspection, but plan/apply fail closed unless a mutation-capable restart and credential-free loopback health check with `requireFleetRpc: true` are configured.

Then add a fixed target to the controller's Fleet Host config:

```yaml
convergence:
  enabled: true
  principalId: owner
  timeoutMs: 600000
  targets:
    - deviceId: worker
      transport: ssh
      sshHost: worker-mac
      nodeBinary: /opt/homebrew/bin/node
      agentPath: /Users/example/.local/share/dsh-fleet/releases/0.2.0/agent.mjs
      configPath: /Users/example/.config/dsh-fleet/agent.json
```

`sshHost` must be a preconfigured alias; usernames, command-line options, whitespace, and shell punctuation are rejected. The executable and config paths must be normalized absolute paths without spaces.

## Manifest source rules

An entry uses either a read-only `spec`, or a stable `source` plus `revision`:

```yaml
plugins:
  - id: dsh-local-development-plugin
    spec: link:/opt/example/dsh-local-development-plugin
    target: { devices: [controller] }

  - id: dsh-turn-fork
    source: npm
    revision: 0.1.0
    target: { devices: [worker] }

  - id: dsh-example
    source: github:owner/dsh-example
    revision: 0123456789abcdef0123456789abcdef01234567
    target: { devices: [worker] }
```

Stable mutation rejects ranges, tags, branches, aliases, URLs, `link:`, `file:`, `workspace:`, and missing Git revisions. Install scripts are disabled. Git packages that require `prepare` therefore fail closed and roll back.

## Operations and recovery

In the Fleet panel, open **Operations**, inspect a configured target, select one manifest-derived candidate, review the full exact plan, tick confirmation, and approve once.

Outcomes are:

- `succeeded`: restart and health gates were proved;
- `rolled-back`: the old profile/dependency tree and service health were restored;
- `manual-intervention`: rollback or final state could not be proved;
- mutation unknown at the Host boundary: recover the exact plan through `action-status` before any second apply.

The current planner creates install/update plans only for a missing dependency or exact dependency-spec drift. `runtime-inactive` and Loader failures are visible health blockers; this release does not invent an automatic repair action for them.

## Security boundary and limitations

- Approval records are integrity-bound and auditable but not cryptographically signed.
- SSH trusts the owner's existing account and SSH configuration.
- Host inspection and plans fail closed unless Agent device ID, profile, and manifest digest match the Host binding.
- Process-group cleanup is not cgroup/job-object containment; a trusted executable that deliberately creates a new session can escape it.
- The Fleet lock does not coordinate unrelated same-owner profile writers.
- The final profile digest check and process spawn are not one atomic filesystem transaction.
- Action state and audit events are separately fsynced.
- Rollback can require registry/network access to rematerialize the old frozen lockfile.
- `screen` is the only implemented DSH restart owner.
- One plan changes one plugin; remove, batch, config distribution, DSH core upgrade, Hub, enrollment, roles, signed approvals, and secret distribution are not implemented.

These are explicit design limits, not hidden guarantees. See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) and [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).

## Development

```bash
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
npm pack --dry-run --ignore-scripts
```

`pnpm run check` performs strict TypeScript checking, the full test suite, deterministic bundle verification, example/schema validation, and repository hygiene checks. Generated release bundles are committed and must remain synchronized with `src/`.

## Documentation

- [Single-owner device onboarding](docs/ONBOARDING.md)
- [Security model](docs/SECURITY_MODEL.md)
- [Release and upgrade process](docs/RELEASING.md)
- [Product requirements and roadmap](docs/REQUIREMENTS.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)
- [Security reporting](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

MIT. Bundled dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
