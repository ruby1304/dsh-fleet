# dsh-fleet

Declarative device inventory, drift detection, and owner-approved plugin convergence for [DeepSeek Harness](https://github.com/deepseek-ai).

`0.2.0` is a V1 preview built and tested against DSH `0.1.0-rc.7`. It keeps the existing read-only Fleet status/update views and adds a deliberately narrow M5 → M3 control path:

```text
M5 DSH Web (loopback-only Fleet RPC)
  → fixed local/SSH target configuration
  → one-shot dsh-fleet-agent on M3
  → immutable plan → explicit approval
  → snapshot → exact install/update → restart → health check
  → success or automatic rollback
```

This preview is for one owner controlling their own Unix devices. It is not yet a multi-user Fleet Hub, an MDM, or a general remote shell.

## What works

- device identity and targeting by id, class, channel, and DSH profile;
- profile dependency/bundle inventory and live Cordis Loader phases;
- deterministic drift states and unmanaged bundle detection;
- credential-free, on-demand public npm/GitHub update discovery;
- exact DSH `0.1.0-rc.7` Host/Client RPC compile and runtime contract tests;
- external one-shot Fleet Agent for one exact plugin per plan;
- exact npm versions and `github:owner/repo#<40-char-sha>` sources only;
- two-step plan/confirm UI on the loopback DSH Web connection;
- profile snapshots, frozen-lockfile dependency restoration, restart, health checks, and rollback;
- local or fixed SSH-alias transport with structured JSON commands and no shell interpolation;
- audit, action state, idempotency, profile locking, and interrupted-action recovery.

## Safety boundary

The Web client never supplies a package version, URL, command, argv, or shell fragment. It can only choose a configured device and a plugin already present in that device's manifest. The target agent recomputes the plan from local state and rejects mutable sources, profile changes, manifest changes, expired approvals, unsupported DSH versions, and concurrent actions.

Agent commands are fixed to `inspect`, `plan`, `apply`, and `status`. Child processes use `shell: false`; timeout terminates the complete process group before rollback starts. Installation uses:

```text
dsh plugin --profile <fixed-profile> add <approved-package>@<exact-spec> --save-exact --ignore-scripts
```

Rollback restores the captured profile files and runs a frozen, scripts-disabled pnpm install before restart and health verification. If rollback cannot be proven, the action ends as `manual-intervention`, not success.

The current SSH route relies on the owner's existing SSH authentication and the same Unix account on the target. Approval records are integrity-bound and auditable, but they are not cryptographically signed. Multi-user enrollment, dedicated device identities, forced-command keys, outbound mTLS, and Hub policy remain later phases.

## Requirements

- macOS or Linux;
- Node.js 22+;
- pnpm 11;
- DSH `0.1.0-rc.7` or another version satisfying `>=0.1.0-rc.7 <0.2.0`;
- for remote targets, a preconfigured SSH host alias and absolute paths to Node, the agent bundle, and its config.

Do not rely on non-interactive `PATH`. Pin absolute DSH, Node, pnpm, agent, manifest, and profile paths on every managed device.

## Install and develop

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
dsh plugin --profile web add "link:$PWD" --save-exact --ignore-scripts
```

The repository pins its DSH development/runtime contract packages to exactly `0.1.0-rc.7`. `pnpm run check` runs TypeScript, all tests, and all four bundles. `npm pack --dry-run --ignore-scripts` checks the public package contents.

## Manifest

See [`examples/fleet.lock.yaml`](examples/fleet.lock.yaml). A stable convergence target must use one immutable source:

```yaml
plugins:
  - id: dsh-turn-fork
    source: npm
    revision: 0.1.0
    profiles: [web]
    target: { devices: [m3-worker] }

  - id: dsh-example
    source: github:owner/dsh-example
    revision: 0123456789abcdef0123456789abcdef01234567
    spec: github:owner/dsh-example#0123456789abcdef0123456789abcdef01234567
    profiles: [web]
    target: { devices: [m3-worker] }
```

Ranges, tags, branches, URLs, aliases, `link:`, `file:`, and `workspace:` are rejected by the stable agent planner. Local links remain useful for the read-only/dev inventory path but cannot be applied by this preview.

## Target agent

Copy [`examples/agent.config.json`](examples/agent.config.json) to a private, owner-readable path on the target and replace every path. A production Web profile normally uses a screen-owned restart and a loopback Fleet RPC health check:

```json
{
  "schemaVersion": 1,
  "deviceId": "m3-worker",
  "manifestPath": "/Users/you/dev/dsh-fleet/examples/fleet.lock.yaml",
  "dshHome": "/Users/you/.dsh",
  "dshBinary": "/Users/you/.dsh/fleet-runtime/rc7/bin/dsh",
  "pnpmBinary": "/Users/you/.local/bin/pnpm",
  "profile": "web",
  "stateDir": "/Users/you/.dsh/fleet-agent/web",
  "planTtlMs": 300000,
  "restart": {
    "kind": "screen",
    "screenBinary": "/usr/bin/screen",
    "sessionName": "dsh-web-m3",
    "host": "127.0.0.1",
    "port": 3211
  },
  "health": {
    "url": "http://127.0.0.1:3211",
    "timeoutMs": 45000,
    "requireFleetRpc": true
  }
}
```

The agent is intentionally one-shot. The M5 Host invokes `node agent.mjs --config <absolute-path> <fixed-command>` locally or through SSH; no listener is exposed on M3.

## M5 Fleet configuration

Add the Fleet row to the M5 Web profile's `cordis.patch.yml`:

```yaml
- id: fleet
  name: dsh-fleet
  config:
    deviceId: ruby-m5
    manifestPath: /absolute/path/to/fleet.lock.yaml
    profile: web
    dshBinary: /absolute/path/to/dsh
    updateCheck: true
    convergence:
      enabled: true
      principalId: ruby
      timeoutMs: 600000
      targets:
        - deviceId: m3-worker
          transport: ssh
          sshHost: m3-mac
          nodeBinary: /opt/homebrew/bin/node
          agentPath: /Users/you/dev/dsh-fleet/agent.mjs
          configPath: /Users/you/.dsh/fleet-agent/config.json
```

The `sshHost` value must be an already configured alias and cannot contain usernames, options, whitespace, or punctuation used by the shell. The Host RPC remains `authority: loopback`; remote browser clients cannot call it.

## Using the UI

Open the Fleet overlay and select **操作**:

1. inspect configured targets;
2. choose one manifest-derived candidate;
3. review device, action, exact source, digest, and expiry;
4. tick the confirmation box;
5. approve exactly once;
6. read `succeeded`, `rolled-back`, or `manual-intervention`.

If the request disconnects after approval, `action-status` can recover an interrupted nonterminal action by rolling it back under the target profile lock.

## Current limitations

- install/update only; no remove, batch plan, DSH core upgrade, or config distribution;
- one plugin per plan and stable target devices only;
- install scripts are disabled; Git packages that require `prepare` will fail closed and roll back;
- rollback may require registry/network access to rematerialize the old frozen lockfile;
- screen is the only implemented Web restart owner;
- no Hub, device enrollment, member roles, signed approvals, secrets distribution, or asynchronous queue;
- the example manifest is development evidence, not a private team source of truth.

See [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) for the complete model, phased roadmap, and acceptance record.

## Roadmap

- V0: inventory, drift, and read-only update availability — complete;
- V1 preview: owner-approved exact install/update with rollback — implemented in `0.2.0`;
- V1 hardening: forced-command device identity, signed approvals, broader recovery tests;
- V2: dev/candidate/stable promotion and private immutable sources;
- V3/V4: enrollment, roles, revocation, outbound Hub transport, tasks, and team audit.

## License

MIT
