# Single-owner device onboarding

Version 0.3 binds trusted devices with two independent proofs:

1. the fixed local/SSH transport identifies which machine was reached;
2. a device-local Ed25519 key signs the team, principal, sender device, recipient device, capability, payload digest and expiry.

This is single-owner device pairing, not a cloud account or multi-user enrollment system. Device IDs and principals are durable identifiers; display names are not identities.

## Configuration split

Keep these layers separate:

- `team-pack.yaml` is publishable. It contains the compatible DSH range, exact public plugin releases, logical workspace/profile IDs and optional federation-only trust anchors. Keep the managed service profile (normally `web`) separate from task execution profiles (normally `headless`).
- `device-overlay.yaml` is private. It contains one device assignment, private artifact digests, real local paths, restart ownership and task-capable peer trust.
- `identity.private.pem` never leaves its device.
- `identity.invite.json` is public key material that may be exchanged out of band.

The bootstrap validator rejects a public pack that contains an artifact source or grants remote task capabilities. This prevents an open-source configuration from silently becoming an execution authorization list.

## Recommended layout

Use paths without spaces because fixed Host-to-Agent transport paths intentionally follow a narrow grammar.

```text
~/.config/dsh-fleet/
  identity/
    identity.private.pem
    identity.invite.json
  releases/
    web-1.0.0/
      agent.config.json
      fleet.lock.yaml
      trust-store.json
      task-policy.json
~/.local/share/dsh-fleet/
  artifacts/
    <sha256>.tgz
  agent-releases/
    0.3.1/agent.mjs
~/.local/state/dsh-fleet/
  web/
```

Do not overwrite an active generation. Render the next release into a new directory and retain the previous generation until acceptance and rollback checks pass.

## First device

1. Install a pinned DSH runtime, Node.js 22+, pnpm 11, the reviewed Fleet Agent bundle, and the fixed restart/inspection tools.
2. Copy `examples/team-pack.yaml` to the team repository and replace all example public coordinates with reviewed exact releases.
3. Copy `examples/device-overlay.yaml` to an owner-controlled location. Set the real device ID, principal, immutable DSH binary, state/artifact paths, launchd or screen ownership, loopback health URL and logical workspace mapping.
4. Leave `agent.tasks.enabled: false` until peer trust and direct execution tests are complete.
5. Create the device identity:

   ```bash
   dsh-fleet-bootstrap identity \
     --output-dir /absolute/private/identity-dir \
     --team team-id \
     --principal owner-id \
     --device stable-device-id
   ```

6. Render a new immutable generation:

   ```bash
   dsh-fleet-bootstrap render \
     --pack /absolute/path/team-pack.yaml \
     --overlay /absolute/private/device-overlay.yaml \
     --identity-dir /absolute/private/identity-dir \
     --output-dir /absolute/private/releases/release-id
   ```

7. Put each private plugin tarball at `<artifactStore>/<sha256>.tgz`. Verify the digest independently. The Agent will verify it again before staging.
8. Run `doctor` directly, then `release-inspect`. Confirm identity/trust, live Fleet health, executable/workspace readiness, device, profile, manifest digest, DSH version, release ID and every public/private plugin source.
9. Configure the DSH service to use the pinned DSH runtime and profile. Confirm the restart owner and every managed port with a non-production profile.
10. Add the target to the controller while convergence remains disabled. Inspect it through Fleet Settings, then enable convergence.

## Pairing a second device

1. Repeat identity creation on the second device with the same team ID and the second device's stable ID.
2. Exchange `identity.invite.json` files through a channel where the owner can compare the key IDs.
3. Add the controller invite fields to the worker's private `trustedPeers`. Grant only `task.submit`, `task.status` and `task.cancel` if the controller needs those powers.
4. Add the worker invite fields to the controller's private `trustedPeers`. Grant only `task.progress`, `task.result` and `receipt` if those are the expected responses.
5. Render new configuration generations on both devices. A trust change is a configuration release; do not edit the generated trust store in place.
6. Configure the controller itself as a fixed local Agent target and set `convergence.signerDeviceId` to that target. The signer must not be an SSH target.
7. Verify direct `a2a-sign`, `a2a-receive` and `a2a-verify` calls with a harmless fixed workspace/profile.
8. Enable `agent.tasks.enabled` on the worker, render a new generation, then submit one bounded task through Fleet Settings.
9. Disconnect/reload the Web client and recover the same task by ID. Confirm status/result signature verification and cancellation behavior.

## Cross-team federation

Cross-team public packs may carry trust anchors only for `handoff`, `approval.request`, `approval.decision` and `receipt`. A public federation anchor cannot submit, query or cancel a task.

If another team must execute work, the receiving owner must deliberately add that peer to the private overlay with task capabilities and a fixed local policy. There is no transitive trust: trusting team B does not trust devices that B trusts.

## Upgrade

1. Review and install the new Fleet Agent in a new immutable release directory.
2. Update exact public versions/integrities or private artifact digests and increment the profile release ID/version.
3. Render a new configuration directory; bootstrap refuses to overwrite the previous one.
4. Run direct `release-inspect` and `tasks-resume` with the new Agent.
5. Change only fixed Agent/config paths in the Host target and service definition.
6. Inspect through Fleet Settings, approve the atomic release, and verify DSH/Fleet health and Loader state.
7. Retain the prior Agent, DSH runtime, generated configuration and profile backup for one full release cycle.

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
