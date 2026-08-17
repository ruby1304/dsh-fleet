# dsh-fleet

Declarative capability inventory and drift detection for [DeepSeek Harness](https://github.com/deepseek-ai).

> V0 is intentionally read-only. It compares a device's DSH Web profile and live Cordis plugin state with a shared fleet manifest. It does not install, update, restart, remotely control, or upload sessions.

## Why

DSH already has a plugin market, profile package management, skills, presets, permissions, telemetry, and runtime plugin inventory. What it does not yet provide is a team/device layer answering:

- Which device is this?
- Which capabilities should it have?
- Which versions are actually installed?
- Which plugins are active, failed, missing, drifting, or unmanaged?

The same model is intended to support both:

1. one person with a portable control device and an always-on worker;
2. an owner plus partners/interns using role-controlled member devices.

Human identity and device identity remain separate from the first schema version.

## V0 capabilities

- local device identity from plugin config or `DSH_FLEET_DEVICE_ID`;
- YAML `fleet.lock.yaml` parsing and validation;
- device targeting by device id, device class, channel, and DSH profile;
- DSH Web profile dependency/bundle inventory;
- live Cordis Loader phases: pending/loading/active/failed/unloading;
- deterministic drift states: aligned, missing, spec-drift, runtime-failed, runtime-inactive;
- unmanaged bundle detection;
- a read-only Web overlay showing device and drift summary;
- loopback-only Host/Client RPC.

## Manifest

See [examples/fleet.lock.yaml](examples/fleet.lock.yaml).

`spec` is compared with the exact dependency spec stored in the DSH profile's `package.json`. V0 does not resolve semver equivalence or query remote registries.

## Local development

Requirements: Node.js 22+, npm, DSH 0.1.0-rc.5 or a compatible build.

```bash
npm install
npm run check
```

Configure the plugin row after installing the bundle:

```yaml
- id: fleet
  name: dsh-fleet
  config:
    deviceId: ruby-m5
    manifestPath: /absolute/path/to/fleet.lock.yaml
    profile: web
```

Install a local checkout into the Web profile:

```bash
npm run build
dsh plugin --profile web add "link:$PWD"
```

After changing the client bundle, rebuild and restart/refresh the existing DSH Web GUI. Client HMR is only available when the matching DSH checkout's `pnpm run dev:web` watcher is running.

## Security boundary

V0 performs local reads only. It does not:

- expose a remote HTTP endpoint;
- accept arbitrary commands;
- distribute credentials;
- upload DSH sessions or personal files;
- mutate the DSH profile;
- auto-install marketplace updates.

Future mutation support must use an external local fleet agent with explicit plans, approval, profile snapshots, health checks, and rollback. A running DSH plugin must not attempt to replace or restart itself directly.

## Roadmap

- V0: inventory and drift report;
- V1: manually approved local convergence and rollback;
- V2: dev/candidate/stable channels and public/private sources;
- V3: member/device enrollment, role capability sets, revocation, and per-device tokens;
- V4: asynchronous worker tasks, remote approval, handoff, and team audit.

## License

MIT
