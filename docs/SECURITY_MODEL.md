# Security model

## Scope

dsh-fleet has two deliberately different surfaces:

1. The DSH Host plugin reads a local manifest and profile, reports inventory/drift, and performs credential-free public update checks.
2. The external one-shot Agent can apply one owner-approved exact plugin change, restart DSH, verify health, and roll back.

Version 0.2 is designed for one owner operating devices and Unix accounts they already trust. It does not isolate mutually untrusted users and does not replace host hardening, SSH policy, package review, or backups.

## Assets

The design protects:

- the DSH profile dependency and lock files;
- the running DSH service and its Loader state;
- the integrity and expiry of an approved plan;
- Agent action and audit state;
- credentials, session content, private manifests, host identity, and local paths;
- the distinction between an applied, rolled-back, unknown, and manually recoverable mutation.

## Trust boundaries

### Web client to Host

The Fleet RPC is loopback-only. The client may select only a device and plugin already present in fixed Host configuration and the target's local manifest. It cannot provide a version, URL, path, command, argument vector, or shell fragment.

### Host to Agent

Targets are fixed in the DSH profile. Local and SSH transports execute a fixed Node binary, Agent bundle, config path, and protocol command without shell interpolation. The Host rejects inspection and plans unless the Agent's device ID, profile, and manifest digest match the configured Host state. SSH authentication and host-key policy remain the owner's responsibility.

### Agent to package manager and DSH

The Agent accepts stable mutations only from exact npm semantic versions or `github:owner/repo#<40-character-sha>`. It invokes fixed executables with `shell: false`, disables install scripts, snapshots the profile, applies one plan, restarts the configured service owner, and verifies loopback HTTP plus Fleet RPC state.

## Mutation protocol

An approved plan binds the device, profile, plugin, current state, desired exact source, manifest digest, profile digest, action, creation time, and expiry. The Agent recomputes local state before mutation and rejects drift or replay.

Success requires all of the following:

- the package operation completes;
- the configured DSH restart completes;
- the configured loopback URL becomes healthy;
- Fleet RPC returns the expected device/profile;
- the target plugin is aligned;
- no enabled Loader module is failed.

If verification fails, the Agent restores the snapshot and rematerializes the old frozen lockfile with scripts disabled. An unproven rollback is `manual-intervention`, never success.

After a mutation-capable process starts, cancellation, timeout, output overflow, or transport loss is reported as mutation-unknown until `action-status` recovers the exact action. Callers must not immediately start a second apply.

## Process boundary

The Agent terminates the controlled command's process group with TERM followed by KILL and confirms that group is empty before compensation. This is not OS-level containment. A trusted executable that deliberately creates a new session or double-forks can escape that group. For this reason:

- all executable paths are fixed, normalized, and absolute;
- package install scripts are disabled;
- the Agent, DSH profile, package manager, and SSH account must share one trusted owner boundary;
- unreviewed executables or same-owner profile writers are outside the security guarantee.

The Fleet lock coordinates Fleet actions only. A separate same-owner process can still race the profile between the final digest check and process spawn. Action state and append-only audit records are separately fsynced, so a crash may produce a verified event followed by interrupted-action recovery rather than an atomic two-file commit.

## Network and privacy

Inventory reads local package/profile/Loader metadata. It does not read provider credentials or session bodies. Public update checks omit credentials and support only recognized public npm/GitHub sources; local/private sources are reported as local or unsupported rather than contacted.

RPC responses and public diagnostics must not expose credentials, session content, SSH configuration, Agent state, private manifest content, or local link paths. Real manifests, Agent config/state, and audit files are private operational data and must never be committed to this repository.

## Threats explicitly out of scope

- a compromised root account or compromised trusted Unix owner;
- a malicious DSH, Node.js, pnpm, screen, lsof, ps, SSH binary, or already-approved package at an immutable revision;
- arbitrary code executed by a plugin after installation;
- multi-user authorization, device enrollment, signed approvals, secret distribution, Hub policy, and remote attestation;
- OS-level sandboxing or cgroup/job-object containment;
- guaranteed rollback without access to dependencies needed by the old frozen lockfile;
- recovery after a human manually edits profile, lock, snapshot, action, or audit files mid-action.

## Deployment checklist

- keep the Web endpoint loopback-only;
- store the Agent config/state and manifest in owner-only paths;
- copy the exact reviewed manifest bytes to Host and Agent; a digest mismatch blocks inspection and planning;
- pin absolute Node, DSH, pnpm, Agent, config, and restart-tool paths;
- use immutable package specs and a reviewed manifest;
- back up the DSH profile and user data independently;
- test restart ownership, health, rollback, and process cleanup on a non-production profile;
- retain the previous Agent bundle and runtime for one full release cycle;
- review [SECURITY.md](../SECURITY.md) before publishing logs or reports.
