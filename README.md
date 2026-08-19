# dsh-fleet

[![CI](https://github.com/ruby1304/dsh-fleet/actions/workflows/ci.yml/badge.svg)](https://github.com/ruby1304/dsh-fleet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Atomic plugin releases and signed, recoverable device-to-device tasks for a single owner running [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) on several trusted machines.

## Status

`0.3.8` targets DSH `>=0.1.0-rc.7 <0.2.0`. It is an open-source preview with a deliberately narrow trust model: one owner, fixed devices, fixed SSH/local transports, and fixed workspace/profile policies.

It now covers the foundations needed for a Remote Control-like workflow:

- public plugins and private content-addressed plugins in one atomic profile release;
- Ed25519-signed team A2A messages with capability-scoped trust;
- durable asynchronous task IDs, status, cancellation, reconnect and accepted-task recovery;
- a public team pack plus a private per-device overlay for fast, repeatable setup;
- Fleet as a first-class DSH Settings section, without a floating sidebar capsule.

It is not yet equivalent to Codex Remote Control. There is no hosted relay/push service, roaming account enrollment, interactive live session resume, tool-call streaming, remote interactive approval loop, multi-user RBAC, remote attestation, or secret distribution. Fleet uses DSH's existing headless execution path and does not invent a second agent protocol.

Read the [security model](docs/SECURITY_MODEL.md) before enabling mutation or remote tasks.

## Architecture

```text
public team-pack.yaml              private device-overlay.yaml
  exact public releases             private artifact digests
  profile compatibility             local workspace paths
  workspace/profile IDs             restart and health ownership
  federation-only trust             task-capable peer trust
             \                     /
              dsh-fleet-bootstrap
                       |
          schema-v2 manifest + trust store
                + Agent config
                       |
loopback DSH Web -> Fleet Host -> fixed local/SSH Agent
                                      |
                       atomic profile release or
                       durable signed DSH task
```

The public pack cannot contain private artifacts or grant `task.submit`, `task.status`, or `task.cancel`. Those powers exist only in the private overlay on the receiving device.

## Install

Production profiles should install an exact npm release or a reviewed tarball. Never use a live checkout link as production state. Once `0.3.8` is published:

```bash
dsh plugin --profile web add dsh-fleet@0.3.8 --save-exact --ignore-scripts
```

To review and pack from source:

```bash
git clone https://github.com/ruby1304/dsh-fleet.git
cd dsh-fleet
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm run release:check
npm pack --ignore-scripts
shasum -a 256 dsh-fleet-0.3.8.tgz
dsh plugin --profile web add /absolute/path/to/dsh-fleet-0.3.8.tgz --save-exact --ignore-scripts
```

The package provides `dsh-fleet-agent` and `dsh-fleet-bootstrap` binaries. Pin their resolved release paths in services and Host target configuration; do not depend on a login-shell `PATH`.

## Fast device setup

Start with [`examples/team-pack.yaml`](examples/team-pack.yaml) and a private copy of [`examples/device-overlay.yaml`](examples/device-overlay.yaml). Replace every illustrative version, integrity, digest, identity and path.

Create one team-scoped Ed25519 identity per device:

```bash
dsh-fleet-bootstrap identity \
  --output-dir /Users/example/.config/dsh-fleet/identity \
  --team example-team \
  --principal owner \
  --device worker
```

This writes an owner-only private key and a public `identity.invite.json`. Exchange only the invite. On the receiving device, copy the invite fields into `trustedPeers` and grant only the required message kinds. A controller that submits tasks normally needs `task.submit`, `task.status`, and `task.cancel`; a worker response key normally needs `task.progress` and `task.result`.

Render a new immutable configuration directory:

```bash
dsh-fleet-bootstrap render \
  --pack /absolute/path/to/team-pack.yaml \
  --overlay /absolute/private/path/to/device-overlay.yaml \
  --identity-dir /Users/example/.config/dsh-fleet/identity \
  --output-dir /Users/example/.config/dsh-fleet/releases/web-1.0.0
```

The renderer validates the key binding, team/device/principal identity, DSH range, exact sources, trust capabilities, workspace IDs, restart health ownership, and Agent schema. It refuses symlinked inputs, unsafe private-key permissions, and existing output files. For an update, render a new directory; do not overwrite a working generation.

The pack's managed `profile.id` and `taskPolicy.profiles` are intentionally independent. A normal controller manages and health-checks the `web` profile while remote work is restricted to an explicitly allowed one-shot profile such as `headless`.

The output contains:

- `fleet.lock.yaml`: schema-v2 atomic release assignment;
- `trust-store.json`: capability-scoped peer keys;
- `task-policy.json`: redacted workspace/profile policy for review;
- `agent.config.json`: complete one-shot Agent configuration.

Run direct inspection before adding the target to the controller:

```bash
/absolute/path/to/node \
  /absolute/path/to/agent.mjs \
  --config /absolute/path/to/agent.config.json \
  doctor
```

`doctor` is read-only. It verifies the release binding, live loopback Fleet health, identity key, trust store, artifact/workspace directories, and fixed executables without installing a plugin or running a task. Use `release-inspect` afterward to review the exact proposed release delta.

See the complete [onboarding checklist](docs/ONBOARDING.md).

## Host configuration

Add Fleet to the DSH profile patch. Mutation stays off until explicitly enabled.

```yaml
- id: fleet
  name: dsh-fleet
  config:
    deviceId: controller
    manifestPath: /absolute/dsh-home/profiles/web/fleet.lock.yaml
    profile: web
    dshBinary: /absolute/immutable/path/to/dsh
    artifactStore: /absolute/private/path/to/artifacts
    convergence:
      enabled: true
      principalId: owner
      signerDeviceId: controller
      timeoutMs: 600000
      targets:
        - deviceId: controller
          transport: local
          nodeBinary: /absolute/path/to/node
          agentPath: /absolute/path/to/releases/0.3.8/agent.mjs
          configPath: /absolute/path/to/controller/agent.config.json
        - deviceId: worker
          transport: ssh
          sshHost: worker-mac
          nodeBinary: /opt/homebrew/bin/node
          agentPath: /Users/example/.local/share/dsh-fleet/releases/0.3.8/agent.mjs
          configPath: /Users/example/.config/dsh-fleet/releases/web-1.0.0/agent.config.json
```

`sshHost` must be an existing alias with host-key policy. Usernames, SSH options, whitespace and shell punctuation are rejected. Agent, Node and config paths must be normalized absolute paths without spaces.

## Atomic plugin releases

A stable schema-v2 device is assigned exactly one release per profile. One approval covers the complete profile delta, not a sequence of partially visible plugin changes.

- Public npm plugins require an exact semantic version and SHA-512 SRI.
- Public GitHub plugins require `owner/repository` plus a lowercase 40-character commit SHA.
- Private plugins require an exact version and a tarball named `<sha256>.tgz` in the configured artifact store.
- The Agent validates private tarball digest, package identity/version and DSH bundle metadata.
- Staging occurs beside the live profile on the same filesystem.
- The DSH runtime reads `<DSH_HOME>/profiles/<profile>/fleet.lock.yaml`; the Agent copies the approved immutable generation into the staged profile so manifest and packages swap and roll back together.
- The Agent validates the staged profile, stops the owned service, swaps directories by rename, restarts, and proves DSH/Fleet health and release alignment.
- A failed post-swap check restores the previous profile by rename. Durable release markers recover a crash after commit.
- Plugins not owned by the previous Fleet release are not removed.

The legacy schema-v1 single-plugin planner remains readable for compatibility, but new stable deployments should use schema v2.

## Signed remote tasks

The Web Settings page submits only:

```text
target device ID + fixed workspace ID + fixed profile ID + prompt
```

There is no remote path, executable, argument vector, URL, or arbitrary shell field. The Host asks a fixed local signer Agent to sign the request, sends it through a configured local/SSH target, and verifies the target's signed response.

Task records are durable. Replaying the same signed message returns its stored receipt; concurrent submissions for one task ID are serialized. The worker bounds duration, output and concurrency, supports cancellation, and exposes signed progress/result messages. `tasks-resume` restarts only tasks that were durably accepted but never began; a lost running worker is not blindly replayed because task side effects may not be idempotent.

This gives useful asynchronous single-owner remote execution and reconnect semantics. It does not provide a live mirrored terminal or recover the internal state of a DSH process that died mid-turn.

## UI

Fleet registers `settings.section` and renders inside the normal Settings content flow. Tabs cover status, public updates, atomic releases and signed tasks. It does not register a sidebar footer action or use fixed-position collision geometry.

## Safety boundaries

- The Web endpoint and Fleet RPC must remain loopback-only.
- Private keys, overlays, manifests, trust stores, task state and artifacts are private operational data.
- A2A authenticates messages; SSH/local transport still authenticates and reaches the machine.
- Revocation is removal of a peer key from the receiving device's trust store followed by configuration rollout.
- Install scripts are disabled. Approved plugins still execute with the DSH owner's authority after installation.
- Process groups are cleanup, not OS sandboxing. A crashed worker can leave an independently detached child requiring operator inspection.
- Fleet does not distribute provider credentials or secrets.

See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for the full threat model and recovery rules.

## Development

```bash
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
npm pack --dry-run --ignore-scripts
```

`pnpm run check` performs strict TypeScript checking, the full test suite, deterministic bundle verification, example/schema validation and repository hygiene checks. Generated release bundles are committed and must match `src/`.

## Documentation

- [Single-owner device onboarding](docs/ONBOARDING.md)
- [Security model](docs/SECURITY_MODEL.md)
- [Release and upgrade process](docs/RELEASING.md)
- [Product requirements and roadmap](docs/REQUIREMENTS.md)
- [Changelog](CHANGELOG.md)
- [Security reporting](SECURITY.md)
- [Support](SUPPORT.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT. Bundled dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
