# Open-source DSH plugin checklist

Use this checklist before moving a plugin from a private Fleet artifact to a public package. Publication is a source and trust decision; changing one manifest field from `visibility: private` to `public` is not enough.

## 1. Draw the boundary

- Keep user credentials, real manifests, device IDs, hostnames, absolute user paths, task data and production screenshots out of source, fixtures, packages and release notes.
- Separate public plugin code from private overlays, artifacts and operator policy. A public package must remain useful with placeholder configuration and without access to the maintainer's fleet.
- List every Host and browser capability: filesystem, process, network, credentials, RPC, DOM interception, persistent storage and data egress.
- Prefer official DSH services and slots. Treat monkeypatching a conversation or renderer implementation as an unstable compatibility layer, not an ecosystem contract.

## 2. Make the package atomic

- Publish one plugin responsibility per package with an explicit `files` allowlist and exact `exports`.
- Pin the supported Node and DSH range. Production manifests use an exact npm version plus SRI, a GitHub 40-character commit, or a reviewed content-addressed artifact.
- Do not publish a mutable `link:`, branch, tag, local directory, install script or generated production configuration.
- Include the patch, Host/client bundles, license, changelog, security policy, support boundary and uninstall/data-retention behavior.

## 3. Close privacy and supply-chain gates

- Scan all tracked public text and the final tarball for real identities, local paths, private endpoints, secrets and private package coordinates.
- Install with lifecycle scripts disabled; run the complete test/typecheck/build/generated checks from a clean lockfile.
- Require Linux and macOS CI, CodeQL, dependency audit, a protected default branch and private vulnerability reporting.
- Publish from a protected tag through a package-specific trusted publisher. The public repository URL, workflow, package name and provenance must match exactly.

## 4. Prove the lifecycle

1. Build and inspect the exact candidate tarball.
2. Install it into an isolated DSH profile; run `--dump-config` and start DSH.
3. Verify Host behavior, Web behavior, console output, declared network egress and generated files.
4. Upgrade from the last public version without changing unrelated plugins or user configuration.
5. Remove the plugin, restart DSH and verify both runtime cleanup and documented retained data.
6. If promoting through Fleet, approve the exact plan, verify health/alignment, exercise rollback once, then use the separate retention plan for old backups.

Tests alone do not prove a deployed plugin. Keep evidence for source commit, package SHA/SRI, profile hash, runtime version, health result and rollback outcome outside the public repository when that evidence contains private fleet details.
