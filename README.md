# dsh-fleet

Declarative capability inventory and drift detection for [DeepSeek Harness](https://github.com/deepseek-ai).

> V0 is intentionally read-only. It compares a device's DSH Web profile and live Cordis plugin state with a shared fleet manifest, and can check public release sources for newer versions. It does not install or apply updates, restart DSH, remotely control a device, or upload sessions.

The complete product requirements, current handoff state, phased roadmap, security boundaries, and next-session instructions live in [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).

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
- on-demand update checks for DSH core, npm bundles, and public GitHub bundles;
- six-hour in-memory update caching, local-link classification, and per-source failure reporting;
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
    updateCheck: true
    updateCacheMs: 21600000
    updateTimeoutMs: 5000
```

Install a local checkout into the Web profile:

```bash
npm run build
dsh plugin --profile web add "link:$PWD"
```

After changing the client bundle, rebuild and restart/refresh the existing DSH Web GUI. Client HMR is only available when the matching DSH checkout's `pnpm run dev:web` watcher is running.

## Update monitoring

The Fleet overlay has separate **Status** and **Updates** views. Opening Updates performs an on-demand read-only check; normal 30-second status polling never triggers network access. Results are cached in memory for six hours, and **Check again** is debounced for 60 seconds.

- DSH core is compared with the official npm `latest` release of `@deepseek-ai/dsh`.
- npm bundle versions are read from the installed package and compared with the unauthenticated npm public-registry `latest` endpoint.
- packages marked `private: true`, scoped packages without `publishConfig.access: public`, packages declaring a non-npmjs publish registry, and npm aliases are reported as unsupported instead of being sent to the public registry.
- strict `github:owner/repo` and public GitHub HTTPS sources compare the lockfile's resolved commit with the repository HEAD. A difference is reported as **upstream changed**, not as a safe or automatic upgrade.
- `link:`, `file:`, and `workspace:` sources are marked as local and never queried remotely.
- ordinary profile libraries outside `dsh.profile.bundles` are excluded.
- source failures remain explicit; an offline or timed-out check is never reported as current.
- unauthenticated GitHub API limits are handled as per-source failures; the six-hour cache keeps normal probe volume low.

The detector uses credential-free HTTPS for npm and GitHub, with redirects rejected and credentials explicitly omitted. It never launches Git, so user Git configuration, AskPass helpers, and `.netrc` credentials are outside the probe path. It also does not call `dsh plugin`, because that command reconciles profile bundles after successful pnpm commands and is therefore not a strict read-only boundary. No registry token, Git credential, raw upstream response, or local link path is returned over RPC.

An available release is only a discovery signal. Compatibility review, manifest/channel changes, approval, snapshots, health checks, installation, restart, and rollback remain future V1 work.

## Security boundary

V0 mutates nothing. Its only network activity is an on-demand, unauthenticated read of the public npm registry and public GitHub repositories. It does not:

- expose a remote HTTP endpoint;
- accept arbitrary commands;
- distribute credentials;
- upload DSH sessions or personal files;
- mutate the DSH profile;
- auto-install marketplace updates.

Future mutation support must use an external local fleet agent with explicit plans, approval, profile snapshots, health checks, and rollback. A running DSH plugin must not attempt to replace or restart itself directly.

## Roadmap

- V0: inventory, drift report, and read-only update availability;
- V1: manually approved local convergence and rollback;
- V2: dev/candidate/stable channels and public/private sources;
- V3: member/device enrollment, role capability sets, revocation, and per-device tokens;
- V4: asynchronous worker tasks, remote approval, handoff, and team audit.

## License

MIT
