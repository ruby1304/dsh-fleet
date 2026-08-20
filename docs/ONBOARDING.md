# Single-owner device onboarding

The 0.4.3 release for DSH 0.1.0-rc.8 binds trusted devices with two independent proofs:

1. the fixed local/SSH transport identifies which machine was reached;
2. a device-local Ed25519 key signs the team, principal, sender device, recipient device, capability, payload digest and expiry.

This is single-owner device pairing, not a cloud account or multi-user enrollment system. Device IDs and principals are durable identifiers; display names are not identities.

## Configuration split

Keep these layers separate:

- `team-pack.yaml` is publishable. It contains the compatible DSH range, exact public plugin releases, logical workspace/profile IDs and optional federation-only trust anchors. Keep the managed service profile (normally `web`) separate from task execution profiles (normally `headless`).
- `device-overlay.yaml` is private and must be owner-only (`0600`). It contains one device assignment, private artifact digests, real local paths, restart ownership and task-capable peer trust.
- A multi-device release uses one overlay file per device. Every device receives the same reviewed overlay set, but `render-set` consumes only that device's local private identity.
- `identity.private.pem` never leaves its device.
- `identity.invite.json` is public key material that may be exchanged out of band.

`agent.tasks.policyIds` is a device-local allowlist of installed Fleet task policies. An older overlay without this field remains compatible and resolves to `[readonly-v1]`. Keep that default for controllers and read-only workers. A worker that must edit its configured workspace may explicitly use `[readonly-v1, workspace-write-ask-v1]`; write-capable tools still require a signed, single-use approval. Unknown, empty or duplicate policy IDs are rejected. Generated Agent configuration stores only these IDs—the Agent resolves the built-in policy definitions and digests locally, so bootstrap output does not copy or expose tool-rule lists.

The bootstrap validator rejects a public pack that contains an artifact source or grants remote task capabilities. This prevents an open-source configuration from silently becoming an execution authorization list.

## Recommended layout

Use paths without spaces because fixed Host-to-Agent transport paths intentionally follow a narrow grammar.

```text
~/.config/dsh-fleet/
  identity/
    identity.private.pem
    identity.invite.json
~/.local/share/dsh-fleet/
  artifacts/
    <sha256>.tgz
  runtime/
    current -> generations/web-1.0.0
    generations/
      web-1.0.0/
        launcher.mjs
        agent.mjs
        worker.mjs
        agent.config.json
        fleet.lock.yaml
        trust-store.json
        task-policy.json
        routes.json
        generation.json
~/.local/state/dsh-fleet/
  web/
```

Do not overwrite an active generation. Render the next release into a new directory and retain the previous generation until acceptance and rollback checks pass.

Every assembled generation contains an immutable `launcher.mjs`, `agent.mjs`, `agent.config.json` and `worker.mjs`. Host routes must call `<generation-root>/current/launcher.mjs` with `<generation-root>/current/agent.config.json`. The launcher reads the owner-controlled relative `current -> generations/<id>` target exactly once, verifies that generation's recorded file digests, then starts the generation-specific Agent with the generation-specific config; the Agent resolves `worker.mjs` beside itself. This prevents one Host call from mixing files across an activation.

## First device

1. Install a pinned DSH runtime, Node.js 22+, pnpm 11, the reviewed Fleet Agent bundle, and the fixed restart/inspection tools.
2. Copy `examples/team-pack.yaml` to the team repository and replace all example public coordinates with reviewed exact releases.
3. Copy `examples/device-overlay.yaml` to an owner-controlled location. Set the real device ID, principal, immutable DSH binary, state/artifact paths, launchd or screen ownership, loopback health URL and logical workspace mapping.
4. Leave `agent.tasks.enabled: false` until peer trust and direct execution tests are complete. Review `agent.tasks.policyIds` separately; do not enable `workspace-write-ask-v1` on a device that only needs read access.
5. Create the device identity:

   ```bash
   dsh-fleet-bootstrap identity \
     --output-dir /absolute/private/identity-dir \
     --team team-id \
     --principal owner-id \
     --device stable-device-id
   ```

6. Assemble and inspect a new immutable generation. Use the complete overlay set once the team has more than one device:

   ```bash
   dsh-fleet-bootstrap generation-assemble \
     --pack /absolute/path/team-pack.yaml \
     --overlay /absolute/private/device-overlay.yaml \
     --device stable-device-id \
     --identity-dir /absolute/private/identity-dir \
     --root /absolute/private/runtime-root \
     --generation-id web-1.0.0 \
     --agent-bundle /absolute/reviewed/agent.mjs \
     --worker-bundle /absolute/reviewed/worker.mjs

   dsh-fleet-bootstrap generation-inspect \
     --root /absolute/private/runtime-root \
     --generation-id web-1.0.0
   ```

7. Activate with a compare-and-swap expectation (`none` only for the first generation), then bind Host target routes to `current/launcher.mjs` and `current/agent.config.json`:

   ```bash
   dsh-fleet-bootstrap generation-activate \
     --root /absolute/private/runtime-root \
     --generation-id web-1.0.0 \
     --expected-current none
   ```

8. Bind the DSH profile's Fleet row `manifestPath` to `<DSH_HOME>/profiles/<profile>/fleet.lock.yaml` and `desiredManifestPath` to `<runtime-root>/current/fleet.lock.yaml`. Seed the live regular file with the currently active manifest; after adoption the Agent replaces it only inside a staged profile, so manifest, packages and rollback cross one rename boundary.
9. Put each private plugin tarball at `<artifactStore>/<sha256>.tgz`. Verify the digest independently. The Agent will verify it again before staging.
10. Run `doctor` through the launcher, then `release-inspect`. Confirm identity/trust, live Fleet health, execution-profile hashes, executable/workspace readiness, device, live/desired manifest digests, actual DSH runtime digest, release ID and every public/private plugin source. `package-lock.json` is valid hashed profile state, so an npm-only live profile remains inspectable. Release mutation is still pnpm-only: prepare and frozen-verify a sibling hybrid candidate containing both the preserved npm lock and a valid `pnpm-lock.yaml` before approval; do not convert the active profile in place and do not expect Fleet apply to choose a package manager. A pre-0.4 Host that does not expose RPC runtime identity is accepted only for the one-time launchd bridge when its exact service definition, job PID and listener owner match; `screen` targets are not eligible, and post-upgrade health must expose runtime identity.
11. Configure the DSH service to use the pinned DSH runtime and profile. Confirm the rc.8 launchd vector is exactly `web --no-open --host H --port P`, together with `DSH_HOME`, restart owner and every managed port, using a non-production profile.
12. Add the target to the controller while convergence remains disabled. Inspect it through Fleet Settings, then enable convergence.

## Canonical multi-device release

Once the fleet contains more than one device, do not render each overlay as an unrelated single-device manifest. First plan the complete set. Repeat `--overlay` once for every device; argument order does not affect the manifest bytes or digest.

```bash
dsh-fleet-bootstrap plan \
  --pack /absolute/path/team-pack.yaml \
  --overlay /absolute/private/controller-overlay.yaml \
  --overlay /absolute/private/worker-overlay.yaml
```

`plan` is read-only. It validates the complete team, device, profile release, assignment, workspace and immutable-source graph and prints the canonical schema-v2 manifest and SHA-256 digest. Treat that output as private operational metadata.

Then run `render-set` separately on each device with the identical pack and complete overlay list. Select only the local device and its local identity:

```bash
dsh-fleet-bootstrap render-set \
  --pack /absolute/path/team-pack.yaml \
  --overlay /absolute/private/controller-overlay.yaml \
  --overlay /absolute/private/worker-overlay.yaml \
  --device controller \
  --identity-dir /absolute/private/local-identity-dir \
  --output-dir /absolute/private/releases/new-generation
```

On the worker, repeat the command with `--device worker`, its local identity directory and a new local output directory. The private key never leaves its device. Each generation gets the same byte-for-byte `fleet.lock.yaml`, while `agent.config.json`, `trust-store.json` and `task-policy.json` remain device-specific and owner-only.

`render-set` is useful for review, while `generation-assemble` is the production form because it also binds launcher/Agent/worker bundles and creates the generation record. Use the same pack and overlay list for both.

The set is rejected if team identity or name differs, a device ID is duplicated, one release ID has different content, plugin IDs collide, workspace IDs do not exactly match the pack, or any source is mutable. `render-set` refuses to overwrite existing output files and never edits an active pointer, launchd unit or running service. Compare the reported digest on every device before activation.

## Pairing a second device

1. Repeat identity creation on the second device with the same team ID and the second device's stable ID.
2. Exchange `identity.invite.json` files through a channel where the owner can compare the key IDs.
3. Add the controller invite fields to the worker's private `trustedPeers`. Grant only `task.submit`, `task.status` and `task.cancel` if the controller needs those powers.
4. Add the worker invite fields to the controller's private `trustedPeers`. Grant only `task.progress`, `task.result` and `receipt` if those are the expected responses.
5. Run canonical `plan` over both overlays, then run `render-set` locally on both devices. Confirm both generations report the same manifest digest. A trust change is a configuration release; do not edit the generated trust store in place.
6. Configure the controller itself as a fixed local Agent target and set `convergence.signerDeviceId` to that target. The signer must not be an SSH target.
7. Verify direct `a2a-sign`, `a2a-receive` and `a2a-verify` calls with a harmless fixed workspace/profile.
8. Enable `agent.tasks.enabled` on the worker, render a new generation, then submit one bounded task through Fleet Settings.
9. Disconnect/reload the Web client and recover the same task by ID. Confirm status/result signature verification and cancellation behavior.

## Cross-team federation

Cross-team public packs may carry trust anchors only for `handoff`, `approval.request`, `approval.decision` and `receipt`. A public federation anchor cannot submit, query or cancel a task.

The Fleet Collaboration tab exchanges signed JSON manually; it has no hosted relay. Handoff and advisory approval envelopes may remain valid up to the device's configured `maxMessageTtlMs` (never over 24 hours), while ordinary same-team task messages remain capped at five minutes. Import never opens an artifact reference or turns an advisory decision into a task/tool approval.

If another team must execute work, the receiving owner must deliberately add that peer to the private overlay with task capabilities and a fixed local policy. There is no transitive trust: trusting team B does not trust devices that B trusts.

## Upgrade

1. Review and install the new Fleet Agent in a new immutable release directory.
2. Update exact public versions/integrities or private artifact digests and increment the profile release ID/version.
3. Plan the complete overlay set and assemble a new local immutable generation on every device; bootstrap refuses to overwrite the previous one. Confirm every generation reports the same manifest digest.
4. Run direct `release-inspect` and `tasks-resume` with the new Agent.
5. Activate with `--expected-current <old-generation-id>`, never by editing `current`. The lifecycle journal recovers a crash and a dead lifecycle lock is reclaimed only after owner and journal/current validation.
6. For the one-time pre-0.4 bridge, an old private overlay may still name `current/agent.mjs`; `generation-assemble` accepts it only to emit canonical `current/launcher.mjs` routes. If a running old Host already calls the mutable `current/agent.mjs`, use a maintenance window: stop Web cleanly, activate the new generation, change the Host target to `current/launcher.mjs`, then restart. A Host on a fixed old Agent path can remain running until the atomic Fleet profile release installs the new route. The old Host may omit RPC `runtimeIdentity` only when launchd's exact definition, job PID and listener ownership prove the runtime. No equivalent bridge exists for `screen`, and the restarted 0.4 Host must return the plan-bound runtime identity.
7. Inspect through Fleet Settings, approve the atomic release, and verify the runtime/service-definition digests, DSH/Fleet health and Loader state.
8. Exercise explicit Release rollback once on the candidate. Keep the current and previous rollback transitions; review the separate retention plan before deleting any older exact backup.

## Revocation and lost devices

Remove the lost device's key from every receiving trust store, render and activate new generations, remove its Host target, and revoke its SSH access. A2A messages expire quickly, but expiry is not a substitute for trust-store and transport revocation.

Rotate a compromised identity by creating a new owner-only identity directory and redistributing the new invite. Never reuse the old key ID.

## Current limits

- SSH alias creation, host-key verification and file transfer remain owner-operated.
- Bootstrap renders validated files but does not install launchd units, edit SSH configuration, copy secrets or switch the active generation.
- There is no hosted relay, offline push, QR/account enrollment, attestation or multi-user role service.
- Accepted tasks can be resumed after a worker-launch crash. Running tasks are not automatically replayed because their side effects may not be idempotent.
- A task reconnects by durable task ID and signed status/result; it does not resume a live interactive DSH process.

These are explicit release boundaries. See [SECURITY_MODEL.md](SECURITY_MODEL.md) for the threat model.
