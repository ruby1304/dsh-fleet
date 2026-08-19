# Changelog

## 0.4.0 - 2026-08-20

- Add canonical multi-device generations with private per-device overlays, atomic activation and an explicit rollback path.
- Pin launcher, Agent, config and worker to one generation per call; recover dead lifecycle locks with owner/token/inode CAS checks.
- Bind signed tasks to the active manifest, release, local workspace, actual execution-profile hash and installed task policy before execution and before every tool call.
- Add durable task indexing, reconnect-safe status recovery and bounded retention without persisting prompts or results in the browser.
- Require local tool policy for every task call and an argument-bound, single-use decision for each approved workspace mutation.
- Bind atomic release plans to the actual running DSH runtime and launchd service definition, retain explicit rollback state, and add CAS-bound backup retention planning.
- Keep task execution capabilities in private device trust while adding a manual signed federation inbox for advisory handoff/approval metadata.
- Add Fleet Settings task visibility, release rollback and collaboration controls without reintroducing a floating sidebar control.

## 0.3.8 - 2026-08-19

- Persist only the selected target device and durable task ID in browser storage so a signed A2A task can be recovered after a page reload or disconnect without retaining its prompt or output.
- Add strict stored-reference validation, automatic status recovery, manual task-ID lookup and an explicit local-reference clear action.
- Allocate and persist the task ID before submission, require the Host to validate and reuse it, and block accidental resubmission while delivery is uncertain.
- Ignore stale task responses after the selected device or task reference changes.

## 0.3.7 - 2026-08-19

- Reconcile the staged lockfile immediately after removing mutable bindings from the disposable package manifest, before adding immutable artifacts.
- Prevent pnpm from reusing a stale `link:` resolution for a dependency whose approved package spec is now a content-addressed tarball.

## 0.3.6 - 2026-08-19

- Accept literal scoped npm package names in bootstrap `runtimeModules`, matching the Cordis Loader module names used by bundle-only private plugins.
- Keep runtime-module declarations exact and duplicate-free while allowing generated manifests to represent configured providers such as `@deepseek-ai/dsh-skill-filesystem`.

## 0.3.5 - 2026-08-19

- Replace mutable staged dependency bindings by editing only the disposable stage manifest before adding immutable packages, instead of invoking a package-manager remove that can mutate a linked development checkout.
- Preserve the linked source tree and its dependency installation as a valid rollback target while still fully materializing and verifying the staged profile.

## 0.3.4 - 2026-08-19

- Store the Fleet runtime manifest inside the managed DSH profile so the manifest, package graph and profile patch cross the same atomic rename boundary and roll back together.
- Treat a manifest-only release as restart-required, materialize the complete staged dependency tree with the pinned pnpm binary, and verify the runtime is bound to the stable profile-local manifest path.

## 0.3.3 - 2026-08-19

- Allow only the fixed `screen -dmS` service launcher to retain its expected managed child after the launcher exits; all plugin, package and inspection commands still reject live process-group descendants.
- Keep post-launch loopback health, listener ownership, plugin alignment and Loader checks as the authority for successful restart or rollback.

## 0.3.2 - 2026-08-19

- Remove a mutable dependency from the staged profile before adding its immutable replacement, preventing pnpm from retaining a stale `link:` materialization behind a changed package specifier.
- Verify each release plugin resolves inside the staged profile and that its materialized package name/version matches the approved release before service cutover.
- Keep lifecycle scripts disabled through the controlled environment while omitting the unsupported `--ignore-scripts` flag from pnpm-backed remove operations.

## 0.3.1 - 2026-08-19

- Allow a schema-v2 Agent to accept a healthy schema-v1 Fleet RPC response only during target-free preflight and rollback verification, so an installed 0.2 Host can bootstrap its own 0.3.x atomic upgrade.
- Continue to require the current runtime health field, zero Loader failures and exact plugin alignment after every release swap; a post-swap legacy response rolls the release back.
- Run the process- and port-sensitive runtime suite without file-level parallelism so release gates remain deterministic on a busy controller.

## 0.3.0 - 2026-08-19

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
