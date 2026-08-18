# Contributing to dsh-fleet

Thank you for helping improve dsh-fleet. The project accepts focused bug fixes, tests, documentation, portability work, and proposals that preserve its fail-closed security boundary.

## Before starting

- Use an issue for a substantial protocol, schema, storage, transport, or security-boundary change.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- Do not commit real fleet manifests, credentials, session data, hostnames, SSH aliases, usernames, or machine-specific absolute paths.
- Keep V0 read-only behavior separate from the mutation-capable Agent path.

## Development environment

Required:

- Node.js 22 or newer;
- pnpm 11.22.0;
- macOS or Linux for the mutation/runtime tests.

Set up a checkout without running dependency lifecycle scripts:

```bash
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
```

The DSH contract dependencies are pinned to one release line. Upgrade all related `@deepseek-ai/*` packages together and add or update contract tests; do not widen them to floating ranges.

## Source and generated files

Edit files under `src/`, `tests/`, `scripts/`, `examples/`, or the documentation. The following release files are generated and committed:

- `index.mjs`;
- `testing.mjs`;
- `agent.mjs`;
- `client.js`;
- `client.js.map`.

Run `pnpm run build` after source changes. `pnpm run check:generated` rebuilds and fails if the committed bundles were stale.

## Required checks

```bash
pnpm run typecheck
pnpm run test
pnpm run check:generated
pnpm run check:repository
npm pack --dry-run --ignore-scripts
```

Release candidates additionally run `pnpm run release:check`, which performs a production dependency audit and package dry run.

Tests that create processes must prove cleanup, not only command completion. Tests that exercise mutation must use temporary profiles and fixed fake executables; they must never target a developer's live DSH profile.

## Security invariants

Changes must preserve these constraints unless a reviewed protocol version explicitly replaces them:

- the Web client selects only a configured device and manifest plugin;
- versions, revisions, commands, arguments, and paths are never accepted from arbitrary Web input;
- stable mutation accepts only exact npm versions or GitHub 40-character commit SHAs;
- process execution uses fixed arguments with `shell: false`;
- approval is bound to the full immutable plan and expires;
- a started mutation that loses transport is reported as unknown until recovery proves an outcome;
- success requires restart, loopback health, Fleet RPC, target alignment, and zero Loader failures;
- failure to prove rollback ends in manual intervention, never success.

See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for the complete trust model.

## Pull requests

Keep pull requests small enough to review. Explain the threat-model impact, user-visible behavior, tests, and migration or rollback needs. Update the README, changelog, examples, and generated bundles when their contracts change.

By contributing, you agree that your contribution is licensed under the repository's MIT License and to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
