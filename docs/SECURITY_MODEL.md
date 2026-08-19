# Security model

## Scope

dsh-fleet 0.3 is for one owner operating a small set of trusted Unix accounts and devices. It provides inventory, atomic plugin releases and policy-bounded asynchronous DSH tasks. It does not isolate mutually untrusted local users and does not replace SSH policy, OS hardening, package review or backups.

## Assets

The design protects:

- DSH profile/config/lock integrity and service availability;
- the exact public and private plugin release approved for a profile;
- private artifact contents and device-local paths;
- A2A device identity, message integrity, expiry and capability authorization;
- durable task identity, request/result binding and replay behavior;
- the distinction between succeeded, rolled back, failed, cancelled, unknown and manual-intervention states;
- provider credentials and DSH session content, which Fleet should not read or distribute.

## Trust boundaries

### Web client to Host

Fleet RPC remains loopback-only. The UI may choose only configured device IDs, manifest-derived releases, and target-reported workspace/profile IDs. It cannot submit a package URL, artifact path, executable, argv vector, shell fragment or arbitrary remote path.

### Host to Agent

Targets are fixed in the DSH profile. Local and SSH transports execute a fixed Node binary, Agent bundle, config path and protocol command with `shell: false`. SSH authentication and host-key verification identify the machine; Fleet does not replace them.

The Host rejects Agent inspection/plans when device ID, profile or manifest digest does not match its local binding. The configured A2A signer must be a fixed local Agent target.

### A2A identity and authorization

Every message is Ed25519-signed and binds schema version, team, message ID, sender principal/device/key, recipient device, kind, timestamps, payload digest and payload. Verification requires:

- an unexpired, canonical validity window;
- the exact expected team and recipient;
- a trust-store entry whose key ID, public key, principal and device match;
- an explicit `allowedKinds` capability;
- a valid signature and payload schema.

Trust is receiver-local and non-transitive. Removing a key from one trust store revokes it only on that device. Public team-pack anchors are structurally prevented from granting task execution capabilities; task-capable trust belongs in the private overlay.

Private keys must be owner-only regular files. Bootstrap refuses unsafe permissions, symlinked inputs, mismatched private/public keys and identity/overlay mismatches.

### Package release boundary

Stable public npm sources require exact semantic versions plus SHA-512 SRI. GitHub sources require a lowercase 40-character commit SHA. Private sources require exact versions and content-addressed tarballs from the configured artifact store.

The Agent rejects links, ranges, tags, branches, arbitrary URLs and artifact files outside that store. It validates tarball digest, package name/version and DSH bundle metadata. Install scripts are disabled.

## Atomic release protocol

One immutable plan binds the device, profile, full release, manifest digest, observed profile digest, complete plugin set, operations, timestamps and expiry. Approval binds that exact plan.

The Agent stages a sibling profile on the same filesystem, validates it, stops the configured service owner, swaps live/staged directories by rename, restarts and proves:

- loopback DSH HTTP health;
- Fleet RPC device/profile identity;
- full release alignment;
- no enabled Loader module is failed.

If post-swap verification fails, the previous directory is restored by rename and health is checked again. Durable applied-release and action records recover a crash after the swap. An unproved result is never reported as success.

Only plugins owned by the previous applied Fleet release are eligible for automatic removal. Unmanaged plugins remain visible and untouched.

## Durable task protocol

`task.submit` contains exactly task ID, logical workspace ID, logical profile ID and prompt. The receiving Agent maps IDs to local fixed paths/policies. It bounds task TTL, execution time, output bytes and concurrency.

Requests, records, receipts, cancellation markers and bounded results are owner-only durable files. The same signed message returns the stored receipt. Concurrent creation of one task ID is serialized, and a task ID cannot be rebound to different sender, workspace, profile or prompt content.

Stale receipt/worker/slot locks are reaped only when their owning process is gone, or an invalid partial lock has exceeded a grace period. An accepted task can be relaunched after a crash before execution. A task recorded as running is not blindly replayed because the original operation may have side effects; it becomes a recoverable result if a durable result exists, otherwise `worker-lost`.

## Process boundary

Fleet uses process groups for bounded TERM/KILL cleanup. This is not a sandbox, cgroup, container or macOS Endpoint Security boundary. A trusted executable that deliberately creates an independent session may escape cleanup. A worker crash may also leave a detached child that requires operator inspection.

For this reason:

- all executable and operational paths are fixed, normalized and absolute;
- package install scripts are disabled;
- task requests contain no executable or argv field;
- only reviewed DSH runtimes/plugins run inside the trusted owner account;
- operators must not automatically replay `worker-lost` tasks.

The Fleet lock coordinates Fleet writers only. An unrelated same-owner process can still race profile or service state.

## Network and privacy

Inventory reads profile/package/Loader metadata. Public update checks are credential-free and limited to recognized public npm/GitHub sources. Private artifacts are compared locally by digest and are not uploaded by Fleet.

RPC responses and diagnostics must not include private keys, provider credentials, full prompts/results beyond the bounded task result contract, private overlay content, SSH configuration or local artifact contents. Manifests, Agent configs, trust stores, task state and audit files are private operational data even when they contain no secret token.

## Threats out of scope

- a compromised root account or trusted Unix owner;
- a malicious pinned DSH, Node, pnpm, tar, launchctl/screen, SSH binary or approved plugin;
- multi-user RBAC, organization accounts, hosted relay/push, remote attestation or secret distribution;
- OS-level sandboxing and guaranteed cleanup of deliberately escaped processes;
- live interactive session persistence after the DSH process dies;
- recovery after manual mutation of profile, release marker, task record, trust store or audit state;
- guaranteed rollback if the underlying filesystem/storage fails.

## Deployment checklist

- keep Web/Fleet RPC loopback-only;
- use immutable DSH/Fleet runtime paths, not a mutable login-shell wrapper;
- protect private keys, overlays, generated configs, manifests, trust stores, state and artifacts with owner-only permissions;
- compare invite key IDs out of band and grant minimal message kinds;
- keep task execution disabled until fixed workspace/profile mappings are reviewed;
- test launchd/screen ownership, all managed ports, health, rollback, cancellation and task reconnect on a disposable profile;
- retain the prior Agent, DSH runtime, generated configuration and profile backup;
- remove trust keys and SSH access promptly when revoking a device;
- review [../SECURITY.md](../SECURITY.md) before publishing diagnostics.
