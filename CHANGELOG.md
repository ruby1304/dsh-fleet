# Changelog

## 0.3.0 - Unreleased

- Add schema-v2 atomic profile releases that combine exact public npm/GitHub sources and content-addressed private artifacts under one approval and one profile swap.
- Stage profiles on the live filesystem, verify private tarballs and npm integrity, validate before cutover, prove post-restart DSH/Fleet health, and restore the previous directory on failure.
- Add Ed25519-signed, capability-scoped team A2A envelopes with strict payloads, recipient/team binding, expiry and replay-safe receipts.
- Add durable policy-bounded tasks with fixed workspace/profile IDs, bounded time/output/concurrency, cancellation, signed progress/results, reconnect and accepted-task recovery.
- Add public team packs, private per-device overlays, owner-only identity generation and strict non-overwriting bootstrap rendering.
- Keep the managed service profile independent from the allowed task profiles so a Web controller can dispatch only to one-shot `headless` execution.
- Add a read-only Agent `doctor` for release, health, identity, trust, executable and workspace readiness.
- Prevent public federation anchors from granting task execution and keep private plugin artifacts out of shareable configuration.
- Add launchd restart ownership with managed-port verification while retaining screen compatibility.
- Move Fleet from the sidebar footer into a first-class Settings section with status, updates, releases and tasks tabs.
- Distinguish immutable local tarballs from mutable `link:`/directory sources in update inventory and UI.
- Add crash/replay/concurrency, atomic rollback, public/private release, bootstrap and Settings-layout regression coverage.
- Preserve schema-v1 inventory and single-plugin operations as a compatibility path; recommend schema v2 for new stable deployments.

## 0.2.0 - 2026-08-18

This is a single-owner V1 release candidate, not the complete Fleet product.

- Pin and test the DSH `0.1.0-rc.7` Host/Client/CLI contracts.
- Add the external one-shot Fleet Agent and fixed local/SSH transport.
- Add immutable exact-source plans, loopback two-step approval, profile snapshots, restart, health checks, dependency-tree rollback, audit, locking, idempotency, and interrupted-action recovery.
- Add the Smartisan-style Operations view and place its trigger in DSH's layout-owned sidebar footer action instead of a fixed overlay that can collide with Settings.
- Normalize device IDs across manifests, Host targets, and Agent config; reject target inspection and plans when device, profile, or manifest identity differs.
- Add a single-owner onboarding and immutable Agent upgrade checklist with explicit non-goals.
- Add Operations UI regression coverage for exact plan review, confirmation, approval-disconnect `action-status` recovery, and target refresh.
- Preserve the active Node runtime in the Agent's restricted `PATH`, including Linux CI and nonstandard Node installations.
- Harden Host/Agent cancellation with bounded process-group cleanup and a ten-minute mutation compensation window; treat every interrupted, already-started `apply`/`status` as unknown until `action-status` recovery.
- Require mutation-capable restart plus loopback Fleet RPC health configuration, and reject success when the target is not aligned or any Loader module is failed.
- Record a dated 2026-08-18 controller → worker rc.7 install, update, restart, health-failure rollback, and production-profile acceptance; this is not a guarantee of current live state.
- Keep V0 inventory, drift, and credential-free update monitoring behavior.
- Add public security, support, contribution, conduct, threat-model, and release documentation.
- Add generic schema-tested examples, repository secret/path hygiene checks, deterministic generated-bundle verification, third-party notices, and Linux/macOS CI.
- Add a tag/version-gated npm trusted-publishing workflow with public provenance and no long-lived publish token.

## 0.1.0 - 2026-08-18

- Add read-only device inventory, manifest reconciliation, runtime drift, update discovery, and the Fleet Web overlay.
