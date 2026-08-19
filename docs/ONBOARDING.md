# Single-owner device onboarding

Version 0.2 uses explicit, local configuration. It is suitable for an experienced owner operating a small trusted fleet, but it is not a zero-touch pairing flow: there is no account login, invitation, enrollment token, certificate authority, or automatic manifest distribution.

## Binding model

One target binding has four parts:

1. a stable `deviceId` in the private Fleet manifest;
2. the same `deviceId` in the target Agent config;
3. a fixed Host target that maps that `deviceId` to a local process or preconfigured SSH alias;
4. the exact same manifest bytes and profile name on the Host and Agent.

The Host rejects inspection and plans when the Agent reports a different device, profile, or manifest digest. SSH authentication and host-key verification establish which machine answered; `assignedTo` and `principalId` are descriptive and audit fields, not authentication.

Device IDs are 1 to 64 ASCII letters, digits, dots, underscores, or hyphens, and must start with a letter or digit. Do not derive a durable ID from a display name that may change.

## Recommended target layout

Keep executable paths free of spaces because the fixed SSH transport deliberately accepts only a narrow path grammar.

```text
~/.config/dsh-fleet/
  agent.json
  fleet.lock.yaml
~/.local/share/dsh-fleet/
  releases/0.2.0/
    agent.mjs
  state/web/
```

Use a new immutable release directory for every Agent upgrade. Never overwrite the bundle currently named by the Host target; retain the previous bundle until the new release has completed inspection, one safe operation, restart, and health verification.

## First target checklist

1. Install and verify the supported DSH, Node.js, pnpm, restart, and inspection tools on the target.
2. Create the private manifest on the controller, then copy those exact bytes to the target. Do not use the packaged example as production state.
3. Install a reviewed release `agent.mjs` at its immutable release path and record its SHA-256 digest.
4. Create the target Agent config from `examples/agent.config.json`. Set its `deviceId`, profile, absolute paths, restart owner markers, loopback port, and health URL.
5. Restrict the config, manifest, and state directory to the owning Unix account.
6. Configure an SSH alias with explicit host-key policy and confirm non-interactive access. The Fleet config accepts the alias only; it does not accept usernames, SSH flags, or shell fragments.
7. Run the one-shot inspection directly on the target:

   ```bash
   /absolute/path/to/node \
     /absolute/path/to/agent.mjs \
     --config /absolute/private/path/agent.json \
     inspect
   ```

8. Add the fixed Host target while `convergence.enabled` remains false. Confirm the device ID, profile, DSH version, and manifest digest.
9. Enable convergence only after restart ownership and loopback Fleet RPC health have been tested on a disposable profile.

## Upgrade checklist

1. Put the new Agent in a new release directory and verify its digest.
2. Run direct inspection with the existing private config.
3. Change only the Host target's `agentPath` and reload DSH.
4. Inspect from Fleet Operations before approving a mutation.
5. Retain the previous Agent, DSH runtime, manifest, profile snapshot, and config until the new release has passed the full health and rollback gates.

## Current onboarding limitations

- manifest copying and SSH alias setup are manual;
- file ownership and mode are documented requirements but are not yet enforced by an installer;
- there is no `pair`, `bootstrap`, or interactive `doctor` command;
- the mutation-capable restart implementation supports macOS/Linux with `screen`, `lsof`, and `ps`; Windows mutation is not implemented;
- one Host instance manages one configured profile name across its targets;
- device enrollment, revocation, signed identity, remote attestation, Hub policy, and secret distribution are out of scope for 0.2.

These limitations are release boundaries, not implied guarantees. A future guided bootstrap should generate both config fragments, verify permissions and SSH host identity, transfer the manifest safely, and produce a redacted diagnostic report without changing a DSH profile.
