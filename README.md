# dsh-fleet

[![CI](https://github.com/ruby1304/dsh-fleet/actions/workflows/ci.yml/badge.svg)](https://github.com/ruby1304/dsh-fleet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Atomic plugin releases and signed, recoverable device-to-device tasks for a single owner running [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) on several trusted machines.

## Status

`0.4.1` targets DSH `0.1.0-rc.8` exactly. The previous `0.4.0` line is the frozen DSH rc.7 release and must not be reused with rc.8. Its trust model is deliberately narrow: one owner, fixed devices, fixed SSH/local transports, and fixed workspace/profile policies. A checkout or locally built tarball is test material, not permission to promote a fleet; production should use an exact reviewed release.

It now covers the foundations needed for a Remote Control-like workflow:

- public plugins and private content-addressed plugins in one atomic profile release;
- Ed25519-signed team A2A messages with capability-scoped trust;
- durable asynchronous task IDs, status, cancellation, reconnect and accepted-task recovery;
- a public team pack plus a private per-device overlay for fast, repeatable setup;
- immutable multi-file generations with one fixed launcher, crash-safe activation and explicit generation rollback;
- a manual, signed cross-team handoff/approval inbox that never grants task execution authority;
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
 schema-v2 manifest + trust store + Agent config
      + same-generation launcher/Agent/worker
                       |
loopback DSH Web -> Fleet Host -> fixed local/SSH Agent
                                      |
                       atomic profile release or
                       durable signed DSH task
```

The public pack cannot contain private artifacts or grant `task.submit`, `task.status`, or `task.cancel`. Those powers exist only in the private overlay on the receiving device.

## Install

Production profiles should install an exact npm release or a reviewed tarball. Never use a live checkout link as production state. The exact npm install form is:

```bash
dsh plugin --profile web add dsh-fleet@0.4.1 --save-exact --ignore-scripts
```

To review and pack from source:

```bash
git clone https://github.com/ruby1304/dsh-fleet.git
cd dsh-fleet
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm run release:check
npm pack --ignore-scripts
shasum -a 256 dsh-fleet-0.4.1.tgz
dsh plugin --profile web add /absolute/path/to/dsh-fleet-0.4.1.tgz --save-exact --ignore-scripts
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

For a production target, assemble a complete immutable generation. Repeat `--overlay` for every device in the canonical set, but select only the local identity:

```bash
dsh-fleet-bootstrap generation-assemble \
  --pack /absolute/path/to/team-pack.yaml \
  --overlay /absolute/private/path/to/device-overlay.yaml \
  --device worker \
  --identity-dir /Users/example/.config/dsh-fleet/identity \
  --root /Users/example/.local/share/dsh-fleet/runtime \
  --generation-id web-1.0.0 \
  --agent-bundle /absolute/reviewed/agent.mjs \
  --worker-bundle /absolute/reviewed/worker.mjs
```

The assembler validates the key binding, team/device/principal identity, DSH range, exact sources, trust capabilities, workspace IDs, restart health ownership, Agent schema and bundle digests. It refuses symlinked inputs, private overlays or private keys that are not owner-only (`0600`), and existing generations. For an update, create a new generation; never overwrite a working one.

The pack's managed `profile.id` and `taskPolicy.profiles` are intentionally independent. A normal controller manages and health-checks the `web` profile while remote work is restricted to an explicitly allowed one-shot profile such as `headless`.

The output contains:

- `fleet.lock.yaml`: schema-v2 atomic release assignment;
- `trust-store.json`: capability-scoped peer keys;
- `task-policy.json`: redacted workspace/profile policy for review;
- `agent.config.json`: complete one-shot Agent configuration;
- `launcher.mjs`, `agent.mjs` and `worker.mjs`: one digest-bound execution generation;
- `routes.json` and `generation.json`: stable Host routes and the exact generation record.

Run direct inspection before adding the target to the controller:

```bash
/absolute/path/to/node \
  /absolute/runtime/current/launcher.mjs \
  --config /absolute/runtime/current/agent.config.json \
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
    desiredManifestPath: /absolute/runtime/current/fleet.lock.yaml
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
          agentPath: /absolute/runtime/current/launcher.mjs
          configPath: /absolute/runtime/current/agent.config.json
        - deviceId: worker
          transport: ssh
          sshHost: worker-mac
          nodeBinary: /opt/homebrew/bin/node
          agentPath: /Users/example/.local/share/dsh-fleet/runtime/current/launcher.mjs
          configPath: /Users/example/.local/share/dsh-fleet/runtime/current/agent.config.json
```

`sshHost` must be an existing alias with host-key policy. Usernames, SSH options, whitespace and shell punctuation are rejected. Agent, Node and config paths must be normalized absolute paths without spaces.

`manifestPath` is the live profile-local manifest and changes only with the profile rename. `desiredManifestPath` is the active generation candidate. A target may remain online while these differ so that an upgrade can be planned, but signed tasks remain disabled until live and desired are identical.

## Atomic plugin releases

A stable schema-v2 device is assigned exactly one release per profile. One approval covers the complete profile delta, not a sequence of partially visible plugin changes.

- Public npm plugins require an exact semantic version and SHA-512 SRI.
- Public GitHub plugins require `owner/repository` plus a lowercase 40-character commit SHA.
- Private plugins require an exact version and a tarball named `<sha256>.tgz` in the configured artifact store.
- The Agent validates private tarball digest, package identity/version and DSH bundle metadata.
- Staging occurs beside the live profile on the same filesystem.
- The DSH runtime reads `<DSH_HOME>/profiles/<profile>/fleet.lock.yaml`; the Agent copies the approved immutable generation into the staged profile so manifest and packages swap and roll back together.
- The Agent validates the staged profile, stops the owned service, swaps directories by rename, restarts, and proves DSH/Fleet health and release alignment.
- The plan binds the actual running Node/DSH entrypoint, package version and file digests. For launchd it also binds the exact service argument vector and `DSH_HOME`; the Agent rechecks these before swap and after restart instead of trusting a wrapper's version output.
- A one-time pre-0.4 launchd bridge may inspect a Host that does not yet report `runtimeIdentity`, but only when the exact launchd definition, job PID and listener ownership prove the running runtime. `screen` targets and every post-upgrade health check require Fleet RPC runtime identity; this compatibility path is not a general fallback.
- A failed post-swap check restores the previous profile by rename. Durable release markers recover a crash after commit.
- A successful transition keeps a bounded two-transition rollback chain. Older exact backups are removed only by a separately reviewed retention plan and approval; unknown/orphan state is reported, never glob-deleted.
- Plugins not owned by the previous Fleet release are not removed.

The legacy schema-v1 single-plugin planner remains readable for compatibility, but new stable deployments should use schema v2.

## Signed remote tasks

The Web Settings page submits only:

```text
target device ID + fixed workspace ID + fixed profile ID + prompt
```

There is no remote path, executable, argument vector, URL, or arbitrary shell field. The Host resolves the selected logical execution profile to its exact profile hash and binds that hash together with the live manifest, applied release and installed policy digest. The Agent and worker recheck the execution profile before acceptance, launch, approval and every tool call. The Host asks a fixed local signer Agent to sign the request, sends it through a configured local/SSH target, and verifies the target's signed response.

Task records are durable. Replaying the same signed message returns its stored receipt; concurrent submissions for one task ID are serialized. The worker bounds duration, output and concurrency, supports cancellation, and exposes signed progress/result messages. `tasks-resume` restarts only tasks that were durably accepted but never began; a lost running worker is not blindly replayed because task side effects may not be idempotent.

This gives useful asynchronous single-owner remote execution and reconnect semantics. It does not provide a live mirrored terminal or recover the internal state of a DSH process that died mid-turn.

## UI

Fleet registers `settings.section` and renders inside the normal Settings content flow. Tabs cover status, public updates, atomic releases, signed tasks and manual cross-team collaboration. It does not register a sidebar footer action or use fixed-position collision geometry.

The collaboration tab imports and exports signed envelope JSON for handoff and advisory approval. It has no Relay, does not open artifact references, cannot mint task capabilities and never turns a cross-team approval into a tool authorization.

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
- [Open-source plugin checklist](docs/OPEN_SOURCE_PLUGIN_CHECKLIST.md)
- [Release and upgrade process](docs/RELEASING.md)
- [Product requirements and roadmap](docs/REQUIREMENTS.md)
- [Changelog](CHANGELOG.md)
- [Security reporting](SECURITY.md)
- [Support](SUPPORT.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT. Bundled dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
