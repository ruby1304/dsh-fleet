# Changelog

## 0.2.0 - Unreleased

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
