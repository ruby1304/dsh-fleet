import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { arch, homedir, hostname, platform } from "node:os";
import { basename, isAbsolute, join, normalize, resolve } from "node:path";
import { gt, valid, validRange } from "semver";
import { parse } from "yaml";
//#endregion
//#region src/host/agent-client.ts
const MAX_OUTPUT_BYTES = 1048576;
const NON_MUTATION_TERMINATION_GRACE_MS = 3e4;
const MUTATION_TERMINATION_GRACE_MS = 6e5;
const LOCAL_GROUP_DRAIN_MS = 2e3;
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
var AgentClientError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "AgentClientError";
		this.code = code;
	}
};
function isMutationCommand(command) {
	return command === "apply" || command === "status";
}
function agentTerminationGraceMs(command) {
	return isMutationCommand(command) ? MUTATION_TERMINATION_GRACE_MS : NON_MUTATION_TERMINATION_GRACE_MS;
}
function safePath(value, field) {
	if (!isAbsolute(value) || normalize(value) !== value || !/^\/[A-Za-z0-9._/-]+$/.test(value)) throw new TypeError(field + " must be a normalized absolute path without shell metacharacters");
	return value;
}
function nonEmpty$1(value, field) {
	if (value.trim().length === 0) throw new TypeError(field + " must not be empty");
	return value.trim();
}
function validateAgentTarget(target) {
	const deviceId = nonEmpty$1(target.deviceId, "target.deviceId");
	if (!/^[A-Za-z0-9._-]+$/.test(deviceId)) throw new TypeError("target.deviceId contains unsupported characters");
	if (target.transport !== "local" && target.transport !== "ssh") throw new TypeError("target.transport must be local or ssh");
	const sshHost = target.sshHost?.trim();
	if (target.transport === "ssh" && (sshHost === void 0 || sshHost.startsWith("-") || !/^[A-Za-z0-9._-]+$/.test(sshHost))) throw new TypeError("target.sshHost must be a configured host alias");
	if (target.transport === "local" && sshHost !== void 0) throw new TypeError("local target must not define sshHost");
	return {
		deviceId,
		transport: target.transport,
		...sshHost === void 0 ? {} : { sshHost },
		nodeBinary: safePath(target.nodeBinary, "target.nodeBinary"),
		agentPath: safePath(target.agentPath, "target.agentPath"),
		configPath: safePath(target.configPath, "target.configPath")
	};
}
function childInvocation(target, command) {
	const agentArgs = [
		target.nodeBinary,
		target.agentPath,
		"--config",
		target.configPath,
		command
	];
	if (target.transport === "local") return {
		file: target.nodeBinary,
		args: agentArgs.slice(1)
	};
	return {
		file: "/usr/bin/ssh",
		args: [
			"-o",
			"BatchMode=yes",
			"-o",
			"ConnectTimeout=8",
			"-o",
			"ServerAliveInterval=5",
			"-o",
			"ServerAliveCountMax=2",
			"--",
			target.sshHost,
			...agentArgs
		]
	};
}
function safeAgentError(value) {
	const messages = {
		"unsupported-dsh-version": "target DSH must be upgraded to rc.7 before convergence",
		"already-aligned": "plugin is already aligned",
		"plugin-not-targeted": "plugin is not targeted to this device",
		"plan-not-found": "approved plan was not found",
		"approval-mismatch": "approval no longer matches current target state",
		"plan-expired": "plan has expired",
		"approval-expired": "approval has expired"
	};
	const candidate = isRecord$1(value) ? value.code : void 0;
	const code = typeof candidate === "string" && Object.hasOwn(messages, candidate) ? candidate : "agent-rejected";
	return new AgentClientError(code, messages[code] ?? "fleet agent rejected the request");
}
function interruptedAgentError(command, reason, terminationUnknown, mutationMayHaveStarted = true) {
	if (isMutationCommand(command) && mutationMayHaveStarted) return new AgentClientError("agent-mutation-unknown", "fleet mutation state is unknown; recover it with action-status before continuing");
	if (terminationUnknown) return new AgentClientError("agent-termination-unknown", "fleet agent process-group termination could not be confirmed");
	if (reason === "cancelled") return new AgentClientError("cancelled", "fleet agent request was cancelled");
	if (reason === "timeout") return new AgentClientError("agent-timeout", "fleet agent did not answer before the timeout");
	return new AgentClientError("agent-output-limit", "fleet agent exceeded the output limit");
}
function callAgent(targetInput, command, payload, timeoutMs, signal, options = {}) {
	const target = validateAgentTarget(targetInput);
	const invocation = childInvocation(target, command);
	const terminationGraceMs = options.terminationGraceMs ?? agentTerminationGraceMs(command);
	if (!Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 0) throw new TypeError("terminationGraceMs must be a non-negative safe integer");
	const request = JSON.stringify(payload) + "\n";
	return new Promise((resolve, reject) => {
		const isAborted = () => signal?.aborted === true;
		if (isAborted()) {
			reject(new AgentClientError("cancelled", "fleet agent request was cancelled"));
			return;
		}
		const grouped = target.transport === "local" && process.platform !== "win32";
		const child = spawn(invocation.file, invocation.args, {
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			shell: false,
			detached: grouped,
			env: {
				...process.env,
				GIT_TERMINAL_PROMPT: "0"
			}
		});
		let stdout = "";
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let settled = false;
		let stopReason;
		let terminationUnknown = false;
		let transportFailed = false;
		let forceTimer;
		let timer;
		const killTransport = (killSignal) => {
			try {
				if (grouped && child.pid !== void 0) process.kill(-child.pid, killSignal);
				else child.kill(killSignal);
			} catch (error) {
				if (error.code !== "ESRCH") try {
					child.kill(killSignal);
				} catch {}
			}
		};
		const localGroupExists = () => {
			if (!grouped || child.pid === void 0) return false;
			try {
				process.kill(-child.pid, 0);
				return true;
			} catch (error) {
				return error.code !== "ESRCH";
			}
		};
		const stopLocalGroup = async () => {
			if (!localGroupExists()) return;
			killTransport("SIGKILL");
			const deadline = Date.now() + LOCAL_GROUP_DRAIN_MS;
			while (localGroupExists() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
			terminationUnknown = localGroupExists();
		};
		const finish = (action) => {
			if (settled) return;
			settled = true;
			if (timer !== void 0) clearTimeout(timer);
			if (forceTimer !== void 0) clearTimeout(forceTimer);
			signal?.removeEventListener("abort", abort);
			action();
		};
		const stop = (reason) => {
			if (settled || stopReason !== void 0) return;
			stopReason = reason;
			if (timer !== void 0) clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			child.stdin.destroy();
			killTransport("SIGTERM");
			forceTimer = setTimeout(() => {
				killTransport("SIGKILL");
			}, terminationGraceMs);
			forceTimer.unref();
		};
		const abort = () => stop("cancelled");
		timer = setTimeout(() => stop("timeout"), timeoutMs);
		timer.unref();
		signal?.addEventListener("abort", abort, { once: true });
		if (isAborted()) abort();
		child.once("error", () => {
			transportFailed = true;
			if (child.pid === void 0) finish(() => reject(stopReason === void 0 ? new AgentClientError("agent-unavailable", "fleet agent transport is unavailable") : interruptedAgentError(command, stopReason, false, false)));
		});
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			if (stopReason !== void 0) return;
			stdoutBytes += Buffer.byteLength(chunk);
			if (stdoutBytes > MAX_OUTPUT_BYTES) {
				stop("output-limit");
				return;
			}
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			if (stopReason !== void 0) return;
			stderrBytes += chunk.length;
			if (stderrBytes > MAX_OUTPUT_BYTES) stop("output-limit");
		});
		child.once("close", async (code) => {
			if (stopReason !== void 0) await stopLocalGroup();
			finish(() => {
				if (stopReason !== void 0) {
					reject(interruptedAgentError(command, stopReason, terminationUnknown));
					return;
				}
				if (transportFailed) {
					reject(new AgentClientError("agent-unavailable", "fleet agent transport is unavailable"));
					return;
				}
				if (code !== 0) {
					reject(new AgentClientError("agent-failed", "fleet agent command failed"));
					return;
				}
				let response;
				try {
					response = JSON.parse(stdout);
				} catch {
					reject(new AgentClientError("agent-protocol", "fleet agent returned an invalid response"));
					return;
				}
				if (!isRecord$1(response) || typeof response.ok !== "boolean") {
					reject(new AgentClientError("agent-protocol", "fleet agent returned an invalid response"));
					return;
				}
				if (response.ok !== true) {
					reject(safeAgentError(response.error));
					return;
				}
				if (!Object.hasOwn(response, "value")) {
					reject(new AgentClientError("agent-protocol", "fleet agent returned an invalid response"));
					return;
				}
				resolve(response.value);
			});
		});
		child.stdin.on("error", () => {});
		if (stopReason === void 0) child.stdin.end(request);
	});
}
function createAgentClient(config) {
	const targets = config.targets.map(validateAgentTarget);
	const ids = /* @__PURE__ */ new Set();
	for (const target of targets) {
		if (ids.has(target.deviceId)) throw new TypeError("fleet target deviceId values must be unique");
		ids.add(target.deviceId);
	}
	const byId = new Map(targets.map((target) => [target.deviceId, target]));
	return {
		enabled: config.enabled,
		targets: targets.map((target) => ({
			deviceId: target.deviceId,
			transport: target.transport
		})),
		async call(deviceId, command, payload, signal) {
			if (!config.enabled) throw new AgentClientError("agent-disabled", "fleet convergence is disabled");
			const target = byId.get(deviceId);
			if (target === void 0) throw new AgentClientError("target-not-found", "fleet target is not configured");
			return callAgent(target, command, payload, config.timeoutMs, signal);
		}
	};
}
//#endregion
//#region src/host/core.ts
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value, field) {
	if (value === void 0) return void 0;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) throw new TypeError(field + " must be an array of non-empty strings");
	return value.map((item) => item.trim());
}
function nonEmpty(value, field) {
	if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(field + " must be a non-empty string");
	return value.trim();
}
function parseDevice(value, field) {
	if (!isRecord(value)) throw new TypeError(field + " must be an object");
	const assignedTo = value.assignedTo === void 0 ? void 0 : nonEmpty(value.assignedTo, field + ".assignedTo");
	const labels = strings(value.labels, field + ".labels");
	return {
		...assignedTo === void 0 ? {} : { assignedTo },
		class: nonEmpty(value.class, field + ".class"),
		channel: nonEmpty(value.channel, field + ".channel"),
		...labels === void 0 ? {} : { labels }
	};
}
function dependencySpec(source, revision, field) {
	if (source.includes("#")) throw new TypeError(field + " must not contain # when revision is separate");
	if (source === "link:" || source.startsWith("link:")) {
		if (revision !== void 0) throw new TypeError(field + ".revision is not allowed for link sources");
		return source;
	}
	if (source === "npm") {
		if (revision === void 0) throw new TypeError(field + ".revision is required for npm source");
		return revision;
	}
	return revision === void 0 ? source : source + "#" + revision;
}
function parsePlugin(value, index) {
	const field = "plugins[" + index + "]";
	if (!isRecord(value)) throw new TypeError(field + " must be an object");
	const profiles = strings(value.profiles, field + ".profiles");
	const runtimeModules = strings(value.runtimeModules, field + ".runtimeModules");
	let target;
	if (value.target !== void 0) {
		if (!isRecord(value.target)) throw new TypeError(field + ".target must be an object");
		const devices = strings(value.target.devices, field + ".target.devices");
		const classes = strings(value.target.classes, field + ".target.classes");
		const channels = strings(value.target.channels, field + ".target.channels");
		target = {
			...devices === void 0 ? {} : { devices },
			...classes === void 0 ? {} : { classes },
			...channels === void 0 ? {} : { channels }
		};
	}
	const id = nonEmpty(value.id, field + ".id");
	const hasSpec = value.spec !== void 0;
	const hasSource = value.source !== void 0 || value.revision !== void 0;
	if (hasSpec === hasSource) throw new TypeError(field + " must specify exactly one of spec or source");
	const spec = hasSpec ? nonEmpty(value.spec, field + ".spec") : void 0;
	const source = hasSource ? nonEmpty(value.source, field + ".source") : void 0;
	const revision = value.revision === void 0 ? void 0 : nonEmpty(value.revision, field + ".revision");
	return {
		id,
		spec: spec ?? dependencySpec(source, revision, field),
		...source === void 0 ? {} : {
			source,
			...revision === void 0 ? {} : { revision }
		},
		...profiles === void 0 ? {} : { profiles },
		...runtimeModules === void 0 ? {} : { runtimeModules },
		...target === void 0 ? {} : { target }
	};
}
function parseFleetManifest(source) {
	const raw = parse(source);
	if (!isRecord(raw)) throw new TypeError("fleet manifest must be an object");
	if (raw.schemaVersion !== 1) throw new TypeError("schemaVersion must equal 1");
	if (!isRecord(raw.team)) throw new TypeError("team must be an object");
	const teamId = nonEmpty(raw.team.id, "team.id");
	const teamName = raw.team.name === void 0 ? void 0 : nonEmpty(raw.team.name, "team.name");
	if (!isRecord(raw.devices)) throw new TypeError("devices must be an object");
	const devices = {};
	for (const [id, value] of Object.entries(raw.devices)) devices[nonEmpty(id, "device id")] = parseDevice(value, "devices." + id);
	if (!Array.isArray(raw.plugins)) throw new TypeError("plugins must be an array");
	const plugins = raw.plugins.map(parsePlugin);
	for (const plugin of plugins) if (Object.entries(devices).some(([id, device]) => device.channel === "stable" && targetsDevice(plugin, id, device))) {
		if (plugin.source?.startsWith("link:") || plugin.spec.startsWith("link:")) throw new TypeError("stable plugin " + JSON.stringify(plugin.id) + " must not use a link source");
		const exactSemver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(plugin.spec);
		const exactSha = plugin.source !== "npm" && !plugin.source?.startsWith("link:") && (/^[0-9a-fA-F]{40}$/.test(plugin.revision ?? "") || /#[0-9a-fA-F]{40}$/.test(plugin.spec));
		if (!exactSemver && !exactSha) throw new TypeError("stable plugin " + JSON.stringify(plugin.id) + " must use immutable exact semver or commit SHA");
	}
	for (let i = 0; i < plugins.length; i++) for (let j = i + 1; j < plugins.length; j++) {
		if (plugins[i]?.id !== plugins[j]?.id) continue;
		const a = plugins[i];
		const b = plugins[j];
		if (Object.keys(devices).some((id) => targetsDevice(a, id, devices[id]) && targetsDevice(b, id, devices[id])) && (a.profiles === void 0 || b.profiles === void 0 || a.profiles.some((profile) => b.profiles?.includes(profile)))) throw new TypeError("duplicate plugin id " + JSON.stringify(a.id));
	}
	return {
		schemaVersion: 1,
		team: {
			id: teamId,
			...teamName === void 0 ? {} : { name: teamName }
		},
		devices,
		plugins
	};
}
function targetsDevice(plugin, deviceId, device) {
	const target = plugin.target;
	if (target === void 0) return true;
	if (target.devices !== void 0 && !target.devices.includes(deviceId)) return false;
	if (target.classes !== void 0 && (device === void 0 || !target.classes.includes(device.class))) return false;
	if (target.channels !== void 0 && (device === void 0 || !target.channels.includes(device.channel))) return false;
	return true;
}
function strongestPhase(entries, modules) {
	const phases = entries.filter((entry) => modules.includes(entry.moduleName)).map((entry) => entry.fiberPhase);
	if (phases.includes("failed")) return "failed";
	if (phases.includes("active")) return "active";
	if (phases.includes("loading")) return "loading";
	if (phases.includes("pending")) return "pending";
	if (phases.includes("unloading")) return "unloading";
	return null;
}
function reconcileFleet(input) {
	const device = input.manifest.devices[input.deviceId];
	const desired = input.manifest.plugins.filter((plugin) => plugin.profiles === void 0 || plugin.profiles.includes(input.profile)).filter((plugin) => targetsDevice(plugin, input.deviceId, device)).sort((a, b) => a.id.localeCompare(b.id));
	const plugins = desired.map((plugin) => {
		const actualSpec = input.dependencies[plugin.id];
		const runtimeModules = plugin.runtimeModules ?? [plugin.id];
		const runtimePhase = strongestPhase(input.runtime, runtimeModules);
		let state;
		if (actualSpec === void 0) state = "missing";
		else if (actualSpec !== plugin.spec) state = "spec-drift";
		else if (runtimePhase === "failed") state = "runtime-failed";
		else if (runtimePhase !== "active") state = "runtime-inactive";
		else state = "aligned";
		return {
			id: plugin.id,
			desiredSpec: plugin.spec,
			...plugin.source === void 0 ? {} : {
				desiredSource: plugin.source,
				...plugin.revision === void 0 ? {} : { desiredRevision: plugin.revision }
			},
			...actualSpec === void 0 ? {} : { actualSpec },
			runtimeModules,
			runtimePhase,
			state
		};
	});
	const desiredIds = new Set(desired.map((plugin) => plugin.id));
	const unmanaged = input.bundles.filter((id) => Object.hasOwn(input.dependencies, id)).filter((id) => !desiredIds.has(id)).sort().map((id) => ({
		id,
		actualSpec: input.dependencies[id]
	}));
	const summary = {
		desired: plugins.length,
		aligned: plugins.filter((item) => item.state === "aligned").length,
		missing: plugins.filter((item) => item.state === "missing").length,
		drifted: plugins.filter((item) => item.state === "spec-drift" || item.state === "runtime-inactive").length,
		failed: plugins.filter((item) => item.state === "runtime-failed").length,
		unmanaged: unmanaged.length
	};
	return {
		...device === void 0 ? {} : { device },
		plugins,
		unmanaged,
		summary
	};
}
//#endregion
//#region src/host/updates.ts
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const systemUpdateProbe = {
	async npmLatest(packageName, timeoutMs) {
		const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
			headers: { accept: "application/json" },
			credentials: "omit",
			redirect: "error",
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!response.ok) throw new Error("registry probe failed");
		const payload = await response.json();
		if (typeof payload.version !== "string" || payload.version.trim().length === 0) throw new Error("registry returned an invalid version");
		return payload.version.trim();
	},
	async githubHead(repository, timeoutMs) {
		const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\.git$/.exec(repository);
		if (match?.[1] === void 0 || match[2] === void 0) throw new Error("unsupported GitHub repository");
		const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/commits?per_page=1`, {
			headers: {
				accept: "application/vnd.github+json",
				"user-agent": "dsh-fleet",
				"x-github-api-version": "2026-03-10"
			},
			credentials: "omit",
			redirect: "error",
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!response.ok) throw new Error("GitHub probe failed");
		const payload = await response.json();
		const revision = Array.isArray(payload) ? payload[0]?.sha : void 0;
		if (typeof revision !== "string" || !/^[0-9a-f]{40}$/i.test(revision)) throw new Error("GitHub returned no HEAD revision");
		return revision.toLowerCase();
	}
};
function githubDescriptor(spec) {
	const shorthand = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:#.*)?$/.exec(spec);
	const url = /^(?:git\+)?https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:#.*)?$/.exec(spec);
	const match = shorthand ?? url;
	if (match?.[1] === void 0 || match[2] === void 0) return void 0;
	const owner = match[1];
	const repositoryName = match[2].replace(/\.git$/, "");
	return {
		source: "github",
		repository: `https://github.com/${owner}/${repositoryName}.git`,
		sourceUrl: `https://github.com/${owner}/${repositoryName}`
	};
}
function describeSource(id, spec) {
	if (/^(?:link|file|workspace):/.test(spec) || spec.startsWith("/") || spec.startsWith("./") || spec.startsWith("../")) return { source: "local" };
	const github = githubDescriptor(spec);
	if (github !== void 0) return github;
	if (NPM_NAME.test(id) && (validRange(spec) !== null || /^[a-z][a-z0-9._-]*$/i.test(spec))) return {
		source: "npm",
		packageName: id,
		sourceUrl: `https://www.npmjs.com/package/${encodeURIComponent(id)}`
	};
	return { source: "unknown" };
}
function resolvedRevision(value, spec) {
	const fromLock = value?.match(/[0-9a-f]{40}/i)?.[0];
	if (fromLock !== void 0) return fromLock.toLowerCase();
	return (spec.match(/#([0-9a-f]{40})$/i)?.[1])?.toLowerCase();
}
function isAvailable(current, latest) {
	const currentSemver = valid(current);
	const latestSemver = valid(latest);
	if (currentSemver !== null && latestSemver !== null) return gt(latestSemver, currentSemver);
	return current !== latest;
}
async function readInstalledPackage(profileDir, id) {
	try {
		const raw = JSON.parse(await readFile(join(profileDir, "node_modules", id, "package.json"), "utf8"));
		if (typeof raw.version !== "string" || raw.version.trim().length === 0) return void 0;
		const registry = typeof raw.publishConfig?.registry === "string" ? raw.publishConfig.registry : void 0;
		const access = typeof raw.publishConfig?.access === "string" ? raw.publishConfig.access : void 0;
		return {
			version: raw.version.trim(),
			private: raw.private === true,
			...access === void 0 ? {} : { access },
			...registry === void 0 ? {} : { registry }
		};
	} catch {
		return;
	}
}
async function readProfile$1(config) {
	const profileManifest = JSON.parse(await readFile(join(config.profileDir, "package.json"), "utf8"));
	const dependencies = profileManifest.dependencies ?? {};
	const bundles = profileManifest.dsh?.profile?.bundles ?? [];
	let desired = /* @__PURE__ */ new Map();
	try {
		const result = reconcileFleet({
			manifest: parseFleetManifest(await readFile(config.manifestPath, "utf8")),
			deviceId: config.deviceId,
			profile: config.profile,
			dependencies,
			bundles,
			runtime: []
		});
		desired = new Map(result.plugins.map((plugin) => [plugin.id, plugin]));
	} catch {}
	const lockVersions = {};
	try {
		const lock = parse(await readFile(join(config.profileDir, "pnpm-lock.yaml"), "utf8"));
		for (const [id, dependency] of Object.entries(lock.importers?.["."]?.dependencies ?? {})) {
			const version = typeof dependency === "string" ? dependency : dependency.version;
			if (version !== void 0) lockVersions[id] = version;
		}
	} catch {}
	return {
		dependencies,
		bundles,
		desired,
		lockVersions
	};
}
async function checkCore(config, probe) {
	const base = {
		id: "@deepseek-ai/dsh",
		kind: "dsh",
		managed: true,
		source: "npm",
		sourceUrl: "https://www.npmjs.com/package/%40deepseek-ai%2Fdsh",
		...config.dshVersion === null ? {} : { currentVersion: config.dshVersion },
		state: "error"
	};
	if (config.dshVersion === null) return {
		...base,
		errorCode: "not-installed"
	};
	try {
		const latestVersion = await probe.npmLatest("@deepseek-ai/dsh", config.timeoutMs);
		const available = isAvailable(config.dshVersion, latestVersion);
		return {
			...base,
			latestVersion,
			state: available ? "available" : "current",
			...available ? { changeKind: "version" } : {}
		};
	} catch {
		return {
			...base,
			errorCode: "registry-unavailable"
		};
	}
}
async function checkPlugin(id, spec, managed, lockVersion, config, probe) {
	const descriptor = describeSource(id, spec);
	const installedPackage = await readInstalledPackage(config.profileDir, id);
	const currentVersion = installedPackage?.version;
	const installed = installedPackage !== void 0;
	const base = {
		id,
		kind: "plugin",
		managed,
		source: descriptor.source,
		...currentVersion === void 0 ? {} : { currentVersion },
		...descriptor.sourceUrl === void 0 ? {} : { sourceUrl: descriptor.sourceUrl },
		state: installed ? "unsupported" : "missing",
		...!installed ? { errorCode: "not-installed" } : {}
	};
	if (descriptor.source === "local") return {
		...base,
		state: installed ? "local" : "missing"
	};
	if (descriptor.source === "npm" && descriptor.packageName !== void 0) {
		if (installedPackage?.private === true || id.startsWith("@") && installedPackage?.access !== "public" || installedPackage?.registry !== void 0 && !/^https:\/\/registry\.npmjs\.org\/?$/i.test(installedPackage.registry)) return {
			...base,
			state: "unsupported",
			errorCode: "unsupported-source"
		};
		try {
			const latestVersion = await probe.npmLatest(descriptor.packageName, config.timeoutMs);
			if (currentVersion === void 0) return {
				...base,
				latestVersion
			};
			const available = isAvailable(currentVersion, latestVersion);
			return {
				...base,
				latestVersion,
				state: available ? "available" : "current",
				...available ? { changeKind: "version" } : {}
			};
		} catch {
			return {
				...base,
				state: "error",
				errorCode: "registry-unavailable"
			};
		}
	}
	if (descriptor.source === "github" && descriptor.repository !== void 0) {
		const currentRevision = resolvedRevision(lockVersion, spec);
		try {
			const latestRevision = await probe.githubHead(descriptor.repository, config.timeoutMs);
			if (!installed) return {
				...base,
				latestRevision
			};
			if (currentRevision === void 0) return {
				...base,
				latestRevision,
				state: "unsupported",
				errorCode: "unsupported-source"
			};
			return {
				...base,
				currentRevision,
				latestRevision,
				state: currentRevision === latestRevision ? "current" : "available",
				...currentRevision === latestRevision ? {} : { changeKind: "head-changed" }
			};
		} catch {
			return {
				...base,
				...currentRevision === void 0 ? {} : { currentRevision },
				state: "error",
				errorCode: "github-unavailable"
			};
		}
	}
	return {
		...base,
		state: installed ? "unsupported" : "missing",
		errorCode: installed ? "unsupported-source" : "not-installed"
	};
}
function summarize(items) {
	return {
		tracked: items.length,
		available: items.filter((item) => item.state === "available").length,
		current: items.filter((item) => item.state === "current").length,
		local: items.filter((item) => item.state === "local").length,
		missing: items.filter((item) => item.state === "missing").length,
		errors: items.filter((item) => item.state === "error").length,
		unsupported: items.filter((item) => item.state === "unsupported").length
	};
}
const STATE_ORDER = {
	available: 0,
	error: 1,
	missing: 2,
	local: 3,
	unsupported: 4,
	current: 5
};
async function mapLimit(values, limit, worker) {
	const result = new Array(values.length);
	let cursor = 0;
	async function consume() {
		while (cursor < values.length) {
			const index = cursor++;
			const value = values[index];
			if (value !== void 0) result[index] = await worker(value);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, values.length) }, consume));
	return result;
}
async function collectFleetUpdates(config, probe = systemUpdateProbe, now = Date.now()) {
	const profile = await readProfile$1(config);
	const core = checkCore(config, probe);
	const desiredSpecs = new Map([...profile.desired].map(([id, plugin]) => [id, plugin.actualSpec ?? plugin.desiredSpec]));
	const plugins = await mapLimit([...new Set(profile.bundles.filter((id) => Object.hasOwn(profile.dependencies, id)))], 4, (id) => checkPlugin(id, profile.dependencies[id] ?? desiredSpecs.get(id) ?? "", profile.desired.has(id), profile.lockVersions[id], config, probe));
	plugins.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.id.localeCompare(b.id));
	const items = [await core, ...plugins];
	return {
		checkedAt: new Date(now).toISOString(),
		refreshAfter: new Date(now + config.cacheMs).toISOString(),
		summary: summarize(items),
		items
	};
}
async function inputFingerprint(config) {
	const paths = [
		join(config.profileDir, "package.json"),
		join(config.profileDir, "pnpm-lock.yaml"),
		config.manifestPath
	];
	const parts = await Promise.all(paths.map(async (path) => {
		try {
			const metadata = await stat(path);
			return `${path}:${metadata.size}:${metadata.mtimeMs}`;
		} catch {
			return `${path}:missing`;
		}
	}));
	return [config.dshVersion ?? "unknown", ...parts].join("|");
}
function createUpdateMonitor(config, dependencies = {}) {
	const now = dependencies.now ?? Date.now;
	const probe = dependencies.probe ?? systemUpdateProbe;
	const collect = dependencies.collect ?? collectFleetUpdates;
	let cached;
	let cachedFingerprint;
	let lastAttemptAt;
	let inFlight;
	return { async get(mode = "if-stale") {
		if (!config.enabled) return {
			enabled: false,
			cached: false,
			stale: false
		};
		const currentTime = now();
		const fingerprint = await inputFingerprint(config);
		const inputsChanged = cachedFingerprint !== void 0 && cachedFingerprint !== fingerprint;
		const expired = cached !== void 0 && Date.parse(cached.refreshAfter) <= currentTime;
		const stale = inputsChanged || expired;
		const report = (snapshot, fromCache, reportStale) => ({
			enabled: true,
			cached: fromCache,
			stale: reportStale,
			...lastAttemptAt === void 0 ? {} : { lastAttemptAt: new Date(lastAttemptAt).toISOString() },
			...snapshot === void 0 ? {} : { snapshot }
		});
		if (mode === "cache") return report(cached, cached !== void 0, stale);
		if (mode === "if-stale" && cached !== void 0 && !stale) return report(cached, true, false);
		if (mode === "force" && cached !== void 0 && !stale && lastAttemptAt !== void 0 && currentTime - lastAttemptAt < 6e4) return report(cached, true, stale);
		if (inFlight === void 0) {
			lastAttemptAt = currentTime;
			inFlight = (async () => {
				const snapshot = await collect(config, probe, currentTime);
				if (await inputFingerprint(config) !== fingerprint) throw new Error("fleet inputs changed during update check");
				cached = snapshot;
				cachedFingerprint = fingerprint;
				return snapshot;
			})();
		}
		const refresh = inFlight;
		try {
			return report(await refresh, false, false);
		} finally {
			if (inFlight === refresh) inFlight = void 0;
		}
	} };
}
//#endregion
//#region src/index.ts
const name = "fleet";
const inject = ["connection", "loader"];
const RPC_CHANNEL = "/dsh-fleet";
const AGENT_RPC_CHANNEL = "/dsh-fleet-agent";
const PHASES = {
	0: "pending",
	1: "loading",
	2: "active",
	3: "failed",
	4: null,
	5: "unloading"
};
function expandHome(value) {
	if (value === "~") return homedir();
	if (value.startsWith("~/")) return join(homedir(), value.slice(2));
	if (!value.includes("/")) return value;
	return resolve(value);
}
function defaultDshBinary() {
	const current = process.argv[1];
	return [
		...current !== void 0 && (basename(current) === "dsh" || current.includes("/@deepseek-ai/dsh/")) ? [current] : [],
		join(homedir(), ".npm-global/bin/dsh"),
		join(homedir(), ".local/bin/dsh")
	].find((candidate) => existsSync(candidate)) ?? "dsh";
}
function resolveConfig(config) {
	const dshHome = expandHome(config?.dshHome ?? process.env.DSH_HOME ?? "~/.dsh");
	const boundedNumber = (value, fallback, minimum, maximum) => value === void 0 || !Number.isFinite(value) ? fallback : Math.min(maximum, Math.max(minimum, Math.round(value)));
	return {
		deviceId: (config?.deviceId ?? process.env.DSH_FLEET_DEVICE_ID ?? hostname()).trim(),
		manifestPath: expandHome(config?.manifestPath ?? process.env.DSH_FLEET_MANIFEST ?? "~/.dsh/fleet/fleet.lock.yaml"),
		profile: (config?.profile ?? process.env.DSH_FLEET_PROFILE ?? "web").trim(),
		dshHome,
		dshBinary: expandHome(config?.dshBinary ?? process.env.DSH_FLEET_DSH_BINARY ?? defaultDshBinary()),
		updateCheck: config?.updateCheck !== false,
		updateCacheMs: boundedNumber(config?.updateCacheMs, 216e5, 6e4, 864e5),
		updateTimeoutMs: boundedNumber(config?.updateTimeoutMs, 5e3, 1e3, 15e3),
		convergence: {
			enabled: config?.convergence?.enabled === true,
			principalId: (config?.convergence?.principalId ?? process.env.USER ?? "local-owner").trim(),
			timeoutMs: boundedNumber(config?.convergence?.timeoutMs, 18e4, 5e3, 6e5),
			targets: config?.convergence?.targets ?? []
		}
	};
}
function readDshVersion(binary) {
	try {
		return execFileSync(binary, ["--version"], {
			encoding: "utf8",
			timeout: 3e3,
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			]
		}).trim() || null;
	} catch {
		return null;
	}
}
function runtimeSnapshot(loader) {
	const entries = [];
	for (const entry of loader.entries()) {
		if (entry.options.group) continue;
		entries.push({
			entryId: entry.id,
			moduleName: entry.options.name,
			enabled: entry.disabled !== true,
			fiberPhase: entry.fiber === void 0 ? null : PHASES[entry.fiber.state] ?? null
		});
	}
	return entries;
}
async function readProfile(path) {
	const parsed = JSON.parse(await readFile(path, "utf8"));
	return {
		dependencies: parsed.dependencies ?? {},
		bundles: parsed.dsh?.profile?.bundles ?? []
	};
}
const EMPTY_MANIFEST = {
	schemaVersion: 1,
	team: { id: "unavailable" },
	devices: {},
	plugins: []
};
async function collectFleetStatus(ctx, configInput) {
	const config = resolveConfig(configInput);
	const profilePath = join(config.dshHome, "profiles", config.profile, "package.json");
	const runtime = runtimeSnapshot(ctx.loader);
	let manifest = EMPTY_MANIFEST;
	let manifestLoaded = false;
	let manifestError;
	try {
		manifest = parseFleetManifest(await readFile(config.manifestPath, "utf8"));
		manifestLoaded = true;
	} catch (error) {
		manifestError = error instanceof Error ? error.message : String(error);
	}
	let dependencies = {};
	let bundles = [];
	try {
		const profile = await readProfile(profilePath);
		dependencies = profile.dependencies;
		bundles = profile.bundles;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		manifestError = manifestError === void 0 ? "profile: " + message : manifestError + "; profile: " + message;
	}
	const result = reconcileFleet({
		manifest,
		deviceId: config.deviceId,
		profile: config.profile,
		dependencies,
		bundles,
		runtime
	});
	const deviceSpec = result.device;
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		device: {
			id: config.deviceId,
			registered: deviceSpec !== void 0,
			...deviceSpec?.assignedTo === void 0 ? {} : { assignedTo: deviceSpec.assignedTo },
			...deviceSpec === void 0 ? {} : {
				class: deviceSpec.class,
				channel: deviceSpec.channel
			},
			hostname: hostname(),
			platform: platform(),
			arch: arch(),
			nodeVersion: process.version
		},
		dsh: {
			version: readDshVersion(config.dshBinary),
			profile: config.profile
		},
		manifest: {
			path: config.manifestPath,
			loaded: manifestLoaded,
			...manifestLoaded ? { teamId: manifest.team.id } : {},
			...manifestError === void 0 ? {} : { error: manifestError }
		},
		runtime: { failedModules: [...new Set(runtime.filter((entry) => entry.enabled && entry.fiberPhase === "failed").map((entry) => entry.moduleName))].sort() },
		summary: result.summary,
		plugins: result.plugins,
		unmanaged: result.unmanaged
	};
}
const ok = (value) => ({
	ok: true,
	value
});
const fail = (message) => ({
	ok: false,
	error: {
		code: "internal",
		message,
		details: {}
	}
});
function closedPayload(payload, keys, label) {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new TypeError(label + " must be an object");
	const value = payload;
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(label + " has unsupported or missing fields");
	return value;
}
function requiredString(value, field) {
	if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) throw new TypeError(field + " must be a trimmed non-empty string");
	return value;
}
function apply(ctx, config) {
	const host = ctx;
	const resolved = resolveConfig(config);
	const updates = createUpdateMonitor({
		enabled: resolved.updateCheck,
		cacheMs: resolved.updateCacheMs,
		timeoutMs: resolved.updateTimeoutMs,
		deviceId: resolved.deviceId,
		manifestPath: resolved.manifestPath,
		profileDir: join(resolved.dshHome, "profiles", resolved.profile),
		profile: resolved.profile,
		dshVersion: readDshVersion(resolved.dshBinary)
	});
	const agents = createAgentClient(resolved.convergence);
	host.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
		try {
			if (endpoint === "status") return ok(await collectFleetStatus(host, config));
			if (endpoint === "updates") {
				let mode = "if-stale";
				if (payload !== null && payload !== void 0) {
					if (typeof payload !== "object" || Array.isArray(payload) || !("mode" in payload)) throw new TypeError("updates payload must contain mode");
					const candidate = payload.mode;
					if (candidate !== "cache" && candidate !== "if-stale" && candidate !== "force") throw new TypeError("invalid updates mode");
					mode = candidate;
				}
				return ok(await updates.get(mode));
			}
			return fail("unknown endpoint: " + endpoint);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}, { authority: "loopback" });
	host.connection.rpc.handle(AGENT_RPC_CHANNEL, async (endpoint, payload, signal) => {
		try {
			if (endpoint === "targets") {
				if (payload !== null && (typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 0)) throw new TypeError("targets payload must be empty");
				if (!agents.enabled) return ok({
					enabled: false,
					targets: []
				});
				const targets = await Promise.all(agents.targets.map(async (target) => {
					try {
						const inspection = await agents.call(target.deviceId, "inspect", null, signal);
						return {
							...target,
							online: true,
							inspection
						};
					} catch (error) {
						const code = error instanceof AgentClientError ? error.code : "agent-unavailable";
						return {
							...target,
							online: false,
							errorCode: code
						};
					}
				}));
				return ok({
					enabled: true,
					targets
				});
			}
			if (endpoint === "plan") {
				const body = closedPayload(payload, ["deviceId", "pluginId"], "plan payload");
				const deviceId = requiredString(body.deviceId, "deviceId");
				const pluginId = requiredString(body.pluginId, "pluginId");
				return ok(await agents.call(deviceId, "plan", { pluginId }, signal));
			}
			if (endpoint === "approve") {
				const body = closedPayload(payload, [
					"approvalId",
					"deviceId",
					"planDigest",
					"planExpiresAt",
					"planId",
					"profile"
				], "approve payload");
				const deviceId = requiredString(body.deviceId, "deviceId");
				const approvedAt = /* @__PURE__ */ new Date();
				const planExpiresAt = new Date(requiredString(body.planExpiresAt, "planExpiresAt"));
				if (!Number.isFinite(planExpiresAt.getTime()) || planExpiresAt <= approvedAt) throw new TypeError("planExpiresAt must be in the future");
				const approval = {
					protocolVersion: 1,
					approvalId: requiredString(body.approvalId, "approvalId"),
					principalId: resolved.convergence.principalId,
					planId: requiredString(body.planId, "planId"),
					planDigest: requiredString(body.planDigest, "planDigest"),
					deviceId,
					profile: requiredString(body.profile, "profile"),
					approvedAt: approvedAt.toISOString(),
					expiresAt: new Date(Math.min(planExpiresAt.getTime(), approvedAt.getTime() + 12e4)).toISOString()
				};
				return ok(await agents.call(deviceId, "apply", { approval }, signal));
			}
			if (endpoint === "action-status") {
				const body = closedPayload(payload, ["deviceId", "planId"], "status payload");
				const deviceId = requiredString(body.deviceId, "deviceId");
				const planId = requiredString(body.planId, "planId");
				return ok(await agents.call(deviceId, "status", { planId }, signal));
			}
			return fail("unknown agent endpoint: " + endpoint);
		} catch (error) {
			if (error instanceof AgentClientError) return fail(error.message);
			return fail(error instanceof Error ? error.message : String(error));
		}
	}, { authority: "loopback" });
}
//#endregion
export { AGENT_RPC_CHANNEL, RPC_CHANNEL, apply, collectFleetStatus, inject, name };
