# Security policy

## Supported versions

Security fixes are made on the latest release line and on `main`. Older preview builds and locally modified bundles are not supported.

| Version | Support |
| --- | --- |
| `0.4.x` | Security fixes |
| Latest published release | Security fixes |
| `main` | Pre-release fixes and review |
| Older releases | Best effort only |

`dsh-fleet` 0.4.1 is a single-owner convergence and signed asynchronous-task tool for DSH 0.1.0-rc.8. It provides atomic profile releases, device-bound A2A messages, fixed workspace/profile task policy, per-call approval for eligible mutations, bounded execution, cancellation, and durable recovery metadata. It is not a multi-tenant control plane, an MDM, an operating-system sandbox, or a security boundary between mutually untrusted users. Read [the security model](docs/SECURITY_MODEL.md) before enabling mutation or remote tasks.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** flow for this repository so the report remains private:

<https://github.com/ruby1304/dsh-fleet/security/advisories/new>

Do not open a public issue for a suspected vulnerability. If private reporting is unavailable, open a minimal issue asking the maintainer to establish a private channel; do not include exploit details, credentials, hostnames, local paths, or session data.

Include, when possible:

- affected dsh-fleet, DSH, Node.js, and operating-system versions;
- whether the read-only Host path or mutation-capable Agent path is affected;
- the smallest safe reproduction;
- impact and any known preconditions;
- whether the issue is already being exploited or publicly discussed.

The maintainer will acknowledge a complete report, coordinate validation and remediation, and credit reporters who want public attribution. Disclosure timing is coordinated after a fix or mitigation is available.

## High-priority classes

The following are security-sensitive:

- arbitrary command or shell injection through a manifest, Web RPC, SSH target, or Agent config;
- approval replay, plan substitution, or bypass of exact-source validation;
- mutation reported as successful without required restart and health verification;
- rollback that can silently lose or expose profile data;
- credential, session-content, private-path, or private-source leakage through RPC, UI, logs, update checks, packages, or examples;
- process cleanup that permits concurrent mutation after cancellation;
- package or release provenance that does not match the tagged source.

## Safe diagnostics

Before sharing logs, remove usernames, absolute paths, SSH aliases, hostnames, IP addresses, manifest contents, profile data, credentials, tokens, and session text. Never attach an Agent state directory or a real team manifest to a public issue.
