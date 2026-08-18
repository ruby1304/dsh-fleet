# Release process

This process keeps source, generated bundles, package contents, and the deployed artifact tied to one reviewable revision.

## 1. Prepare the release

1. Start from a clean branch based on current `main`.
2. Update `package.json` and move the release notes in `CHANGELOG.md` from Unreleased to the release date.
3. Keep the DSH contract dependencies on one exact compatible release line.
4. Review dependency licenses and update `THIRD_PARTY_NOTICES.md` when a bundled dependency or version changes.
5. Confirm examples contain no real device, account, path, manifest, credential, or session data.

Do not publish from a development `link:` profile, a dirty worktree, or a machine-specific manifest.

## 2. Reproduce and inspect

Use the Node.js and pnpm versions declared by the repository:

```bash
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm run release:check
npm pack --ignore-scripts
```

`release:check` runs TypeScript, tests, deterministic bundle verification, repository hygiene, a production dependency vulnerability audit, and a package dry run.

Inspect the tarball before any tag or publish:

```bash
npm pack --dry-run --ignore-scripts --json
tar -tzf dsh-fleet-<version>.tgz
shasum -a 256 dsh-fleet-<version>.tgz
```

The package must contain only the declared runtime bundles, patch, generic examples, user documentation, MIT license, security policy, changelog, and third-party notices.

## 3. Candidate gate

Install the exact tarball into an isolated DSH home/profile. Do not install from the checkout.

Verify:

- `dsh --version` satisfies the documented compatibility range;
- `--dump-config` loads one Fleet row;
- inventory, drift, unmanaged bundles, and update checks work without credentials;
- the Fleet UI has no Loader, RPC, console, or request errors;
- a fixed local or SSH Agent target returns `inspect` without mutation;
- plan review and explicit approval show the exact immutable source;
- a known-good mutation restarts DSH and reaches aligned/zero-failed health;
- a forced health failure rolls back the profile and dependency tree;
- cancellation and transport loss recover through `action-status` without a second concurrent mutation;
- existing DSH sessions and attachments remain intact;
- stopping DSH leaves no Agent-owned or restart-owned orphan that the deployment claims to manage.

Record the candidate tarball SHA-256, Git commit, Node/pnpm/DSH versions, test result, and sanitized acceptance result. Do not commit a production manifest or Agent state.

## 4. Merge, tag, and publish

1. Require CI on Linux and macOS and resolve all review comments.
2. Require CodeQL, private vulnerability reporting, Dependabot alerts, and protected `main` settings on the public repository.
3. Merge the release commit to `main`.
4. Create a signed or protected tag `v<package-version>` from that exact commit.
5. Create a GitHub Release from the tag only after the candidate gate passes.
6. The `publish.yml` workflow verifies that the tag equals `package.json.version`, repeats all release checks, and publishes from a GitHub-hosted runner.

The npm workflow uses OIDC trusted publishing and public provenance; it intentionally contains no long-lived npm token. The npm package must be configured to trust `ruby1304/dsh-fleet` and `.github/workflows/publish.yml`, and the GitHub `npm` environment should require maintainer approval.

For the first publication, confirm package-name availability and ownership with a maintainer-controlled, 2FA-protected npm account, then configure npm trusted publishing and remove any temporary publish token. Never add an npm token to repository or environment files.

References:

- <https://docs.npmjs.com/trusted-publishers/>
- <https://docs.npmjs.com/generating-provenance-statements/>

## 5. Production promotion

Treat the npm/GitHub release as a source artifact, not automatic permission to update a fleet.

1. Freeze the release tarball and integrity in the deployment manifest.
2. Build a candidate DSH profile from immutable artifacts.
3. Run the candidate and rollback gates.
4. Atomically switch the production runtime/profile pointer.
5. Keep user sessions and attachments in persistent storage, outside the release directory.
6. Retain the previous runtime, profile snapshot, Agent bundle, and package tarball for at least one complete upgrade cycle.

Fleet plans created before a manifest, profile, Agent, or runtime migration must be discarded and regenerated.

## 6. Failure handling

If CI, provenance, tag/version matching, package inspection, candidate health, or rollback evidence is incomplete, do not publish or promote.

If a published package is defective:

- stop promotion;
- deprecate the affected npm version with a concise warning rather than deleting it;
- publish a new patch version from a reviewed fix;
- point deployments back to the retained last-known-good artifact;
- preserve new user data unless a separate, explicit data rollback is required;
- use a GitHub Security Advisory when the defect is security-sensitive.
