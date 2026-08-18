import { parse } from "yaml";
import { appendFile, copyFile, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { gt, satisfies, valid, validRange } from "semver";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
//#region src/host/core.ts
function isRecord$4(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value, field) {
	if (value === void 0) return void 0;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) throw new TypeError(field + " must be an array of non-empty strings");
	return value.map((item) => item.trim());
}
function nonEmpty$2(value, field) {
	if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(field + " must be a non-empty string");
	return value.trim();
}
function parseDevice(value, field) {
	if (!isRecord$4(value)) throw new TypeError(field + " must be an object");
	const assignedTo = value.assignedTo === void 0 ? void 0 : nonEmpty$2(value.assignedTo, field + ".assignedTo");
	const labels = strings(value.labels, field + ".labels");
	return {
		...assignedTo === void 0 ? {} : { assignedTo },
		class: nonEmpty$2(value.class, field + ".class"),
		channel: nonEmpty$2(value.channel, field + ".channel"),
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
	if (!isRecord$4(value)) throw new TypeError(field + " must be an object");
	const profiles = strings(value.profiles, field + ".profiles");
	const runtimeModules = strings(value.runtimeModules, field + ".runtimeModules");
	let target;
	if (value.target !== void 0) {
		if (!isRecord$4(value.target)) throw new TypeError(field + ".target must be an object");
		const devices = strings(value.target.devices, field + ".target.devices");
		const classes = strings(value.target.classes, field + ".target.classes");
		const channels = strings(value.target.channels, field + ".target.channels");
		target = {
			...devices === void 0 ? {} : { devices },
			...classes === void 0 ? {} : { classes },
			...channels === void 0 ? {} : { channels }
		};
	}
	const id = nonEmpty$2(value.id, field + ".id");
	const hasSpec = value.spec !== void 0;
	const hasSource = value.source !== void 0 || value.revision !== void 0;
	if (hasSpec === hasSource) throw new TypeError(field + " must specify exactly one of spec or source");
	const spec = hasSpec ? nonEmpty$2(value.spec, field + ".spec") : void 0;
	const source = hasSource ? nonEmpty$2(value.source, field + ".source") : void 0;
	const revision = value.revision === void 0 ? void 0 : nonEmpty$2(value.revision, field + ".revision");
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
	if (!isRecord$4(raw)) throw new TypeError("fleet manifest must be an object");
	if (raw.schemaVersion !== 1) throw new TypeError("schemaVersion must equal 1");
	if (!isRecord$4(raw.team)) throw new TypeError("team must be an object");
	const teamId = nonEmpty$2(raw.team.id, "team.id");
	const teamName = raw.team.name === void 0 ? void 0 : nonEmpty$2(raw.team.name, "team.name");
	if (!isRecord$4(raw.devices)) throw new TypeError("devices must be an object");
	const devices = {};
	for (const [id, value] of Object.entries(raw.devices)) devices[nonEmpty$2(id, "device id")] = parseDevice(value, "devices." + id);
	if (!Array.isArray(raw.plugins)) throw new TypeError("plugins must be an array");
	const plugins = raw.plugins.map(parsePlugin);
	for (const plugin of plugins) if (Object.entries(devices).some(([id, device]) => device.channel === "stable" && targetsDevice$1(plugin, id, device))) {
		if (plugin.source?.startsWith("link:") || plugin.spec.startsWith("link:")) throw new TypeError("stable plugin " + JSON.stringify(plugin.id) + " must not use a link source");
		const exactSemver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(plugin.spec);
		const exactSha = plugin.source !== "npm" && !plugin.source?.startsWith("link:") && (/^[0-9a-fA-F]{40}$/.test(plugin.revision ?? "") || /#[0-9a-fA-F]{40}$/.test(plugin.spec));
		if (!exactSemver && !exactSha) throw new TypeError("stable plugin " + JSON.stringify(plugin.id) + " must use immutable exact semver or commit SHA");
	}
	for (let i = 0; i < plugins.length; i++) for (let j = i + 1; j < plugins.length; j++) {
		if (plugins[i]?.id !== plugins[j]?.id) continue;
		const a = plugins[i];
		const b = plugins[j];
		if (Object.keys(devices).some((id) => targetsDevice$1(a, id, devices[id]) && targetsDevice$1(b, id, devices[id])) && (a.profiles === void 0 || b.profiles === void 0 || a.profiles.some((profile) => b.profiles?.includes(profile)))) throw new TypeError("duplicate plugin id " + JSON.stringify(a.id));
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
function targetsDevice$1(plugin, deviceId, device) {
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
	const desired = input.manifest.plugins.filter((plugin) => plugin.profiles === void 0 || plugin.profiles.includes(input.profile)).filter((plugin) => targetsDevice$1(plugin, input.deviceId, device)).sort((a, b) => a.id.localeCompare(b.id));
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
async function readProfile(config) {
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
	const profile = await readProfile(config);
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
//#region src/agent/config.ts
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmpty$1(value, field) {
	if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(field + " must be a non-empty string");
	return value.trim();
}
function absolutePath(value, field) {
	const path = nonEmpty$1(value, field);
	if (!isAbsolute(path) || normalize(path) !== path || path.includes("\0")) throw new TypeError(field + " must be a normalized absolute path");
	return path;
}
function boundedInt(value, field, fallback, min, max) {
	if (value === void 0) return fallback;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${field} must be an integer from ${min} to ${max}`);
	return value;
}
function exactKeys(value, allowed, field) {
	const extra = Object.keys(value).filter((key) => !allowed.includes(key));
	if (extra.length > 0) throw new TypeError(field + " contains unsupported fields: " + extra.sort().join(", "));
}
function parseRestart(value) {
	if (!isRecord$3(value)) throw new TypeError("restart must be an object");
	const kind = nonEmpty$1(value.kind, "restart.kind");
	if (kind === "none") {
		exactKeys(value, ["kind"], "restart");
		return { kind: "none" };
	}
	if (kind !== "screen") throw new TypeError("restart.kind must be none or screen");
	exactKeys(value, [
		"kind",
		"screenBinary",
		"lsofBinary",
		"psBinary",
		"ownerMarkers",
		"sessionName",
		"host",
		"port"
	], "restart");
	const sessionName = nonEmpty$1(value.sessionName, "restart.sessionName");
	if (!/^[A-Za-z0-9._-]+$/.test(sessionName)) throw new TypeError("restart.sessionName contains unsupported characters");
	const host = nonEmpty$1(value.host, "restart.host");
	if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") throw new TypeError("restart.host must be loopback");
	if (!Array.isArray(value.ownerMarkers) || value.ownerMarkers.length === 0 || value.ownerMarkers.length > 8 || value.ownerMarkers.some((marker) => typeof marker !== "string" || marker.trim() !== marker || marker.length === 0 || marker.length > 240 || /[\r\n\0]/.test(marker))) throw new TypeError("restart.ownerMarkers must contain 1 to 8 fixed command fragments");
	return {
		kind: "screen",
		screenBinary: absolutePath(value.screenBinary, "restart.screenBinary"),
		lsofBinary: absolutePath(value.lsofBinary, "restart.lsofBinary"),
		psBinary: absolutePath(value.psBinary, "restart.psBinary"),
		ownerMarkers: value.ownerMarkers,
		sessionName,
		host,
		port: boundedInt(value.port, "restart.port", 0, 1024, 65535)
	};
}
function parseHealth(value) {
	if (value === void 0) return {
		timeoutMs: 45e3,
		requireFleetRpc: false
	};
	if (!isRecord$3(value)) throw new TypeError("health must be an object");
	exactKeys(value, [
		"url",
		"timeoutMs",
		"requireFleetRpc"
	], "health");
	let url;
	if (value.url !== void 0) {
		url = nonEmpty$1(value.url, "health.url");
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.hostname !== "[::1]") throw new TypeError("health.url must be a loopback http URL");
		if (parsed.username !== "" || parsed.password !== "") throw new TypeError("health.url must not contain credentials");
	}
	const requireFleetRpc = value.requireFleetRpc ?? false;
	if (typeof requireFleetRpc !== "boolean") throw new TypeError("health.requireFleetRpc must be boolean");
	if (requireFleetRpc && url === void 0) throw new TypeError("health.requireFleetRpc needs health.url");
	return {
		...url === void 0 ? {} : { url },
		timeoutMs: boundedInt(value.timeoutMs, "health.timeoutMs", 45e3, 3e3, 12e4),
		requireFleetRpc
	};
}
function parseAgentConfig(value) {
	if (!isRecord$3(value)) throw new TypeError("agent config must be an object");
	exactKeys(value, [
		"schemaVersion",
		"deviceId",
		"manifestPath",
		"dshHome",
		"dshBinary",
		"pnpmBinary",
		"profile",
		"stateDir",
		"planTtlMs",
		"restart",
		"health"
	], "agent config");
	if (value.schemaVersion !== 1) throw new TypeError("agent config schemaVersion must equal 1");
	const profile = nonEmpty$1(value.profile, "profile");
	if (!/^[A-Za-z0-9._-]+$/.test(profile)) throw new TypeError("profile contains unsupported characters");
	return {
		schemaVersion: 1,
		deviceId: nonEmpty$1(value.deviceId, "deviceId"),
		manifestPath: absolutePath(value.manifestPath, "manifestPath"),
		dshHome: absolutePath(value.dshHome, "dshHome"),
		dshBinary: absolutePath(value.dshBinary, "dshBinary"),
		pnpmBinary: absolutePath(value.pnpmBinary, "pnpmBinary"),
		profile,
		stateDir: absolutePath(value.stateDir, "stateDir"),
		planTtlMs: boundedInt(value.planTtlMs, "planTtlMs", 6e5, 6e4, 36e5),
		restart: parseRestart(value.restart),
		health: parseHealth(value.health)
	};
}
async function readAgentConfig(path) {
	return parseAgentConfig(JSON.parse(await readFile(path, "utf8")));
}
var FleetProtocolError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "FleetProtocolError";
		this.code = code;
	}
};
const PLAN_BODY_KEYS = [
	"protocolVersion",
	"deviceId",
	"profile",
	"manifestDigest",
	"profileHash",
	"observedDshVersion",
	"pluginId",
	"action",
	"fromSpec",
	"exactToSpec",
	"sourceKind",
	"restartRequired",
	"createdAt",
	"expiresAt"
];
const PLAN_KEYS = [
	...PLAN_BODY_KEYS,
	"planId",
	"digest"
];
const APPROVAL_KEYS = [
	"protocolVersion",
	"approvalId",
	"principalId",
	"planId",
	"planDigest",
	"deviceId",
	"profile",
	"approvedAt",
	"expiresAt"
];
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertExactKeys(value, keys, label) {
	if (!isRecord$2(value)) throw new FleetProtocolError("invalid-payload", label + " must be an object");
	const expected = new Set(keys);
	for (const key of Object.keys(value)) if (!expected.has(key)) throw new FleetProtocolError("invalid-payload", label + " contains unsupported field " + JSON.stringify(key));
	for (const key of keys) if (!Object.hasOwn(value, key)) throw new FleetProtocolError("invalid-payload", label + " is missing field " + JSON.stringify(key));
}
function assertNonEmpty(value, field) {
	if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) throw new FleetProtocolError("invalid-payload", field + " must be a trimmed non-empty string");
}
function assertDigest(value, field) {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new FleetProtocolError("invalid-digest", field + " must be a lowercase SHA-256 digest");
}
function parseCanonicalTime(value, field) {
	if (typeof value !== "string") throw new FleetProtocolError("invalid-time", field + " must be an ISO timestamp");
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) throw new FleetProtocolError("invalid-time", field + " must be a canonical ISO timestamp");
	return timestamp;
}
function exactNpmVersion(value) {
	return valid(value) === value;
}
function exactGitHubRevision(value) {
	return /^github:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?#[0-9a-f]{40}$/.test(value);
}
function isSafeNpmPackageName(value) {
	if (value.length === 0 || value.length > 214 || value !== value.toLowerCase()) return false;
	return /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(value);
}
function exactSourceKind(value) {
	if (exactNpmVersion(value)) return "npm";
	if (exactGitHubRevision(value)) return "github";
	return null;
}
function isSupportedDshVersion(value) {
	return valid(value) === value && satisfies(value, ">=0.1.0-rc.7 <0.2.0", { includePrerelease: true });
}
function validatePlanBody(value) {
	assertExactKeys(value, PLAN_BODY_KEYS, "plan body");
	if (value.protocolVersion !== 1) throw new FleetProtocolError("invalid-protocol", "unsupported fleet agent protocol version");
	assertNonEmpty(value.deviceId, "deviceId");
	assertNonEmpty(value.profile, "profile");
	assertDigest(value.manifestDigest, "manifestDigest");
	assertDigest(value.profileHash, "profileHash");
	assertNonEmpty(value.observedDshVersion, "observedDshVersion");
	if (!isSupportedDshVersion(value.observedDshVersion)) throw new FleetProtocolError("unsupported-dsh-version", "DSH version is outside >=0.1.0-rc.7 <0.2.0");
	assertNonEmpty(value.pluginId, "pluginId");
	if (!isSafeNpmPackageName(value.pluginId)) throw new FleetProtocolError("invalid-payload", "pluginId must be one literal lowercase npm package name");
	if (value.action !== "install" && value.action !== "update") throw new FleetProtocolError("invalid-action", "action must be install or update");
	if (value.action === "install" && value.fromSpec !== null) throw new FleetProtocolError("invalid-action", "install plans must bind fromSpec to null");
	if (value.action === "update") {
		assertNonEmpty(value.fromSpec, "fromSpec");
		if (value.fromSpec === value.exactToSpec) throw new FleetProtocolError("invalid-action", "update plans must change the dependency spec");
	}
	assertNonEmpty(value.exactToSpec, "exactToSpec");
	if (exactSourceKind(value.exactToSpec) !== value.sourceKind) throw new FleetProtocolError("unsupported-source", "exactToSpec does not match sourceKind or is mutable");
	if (value.restartRequired !== true) throw new FleetProtocolError("invalid-payload", "restartRequired must be true for this protocol slice");
	const createdAt = parseCanonicalTime(value.createdAt, "createdAt");
	if (parseCanonicalTime(value.expiresAt, "expiresAt") <= createdAt) throw new FleetProtocolError("invalid-time", "expiresAt must be after createdAt");
}
function canonicalize(value, seen) {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new FleetProtocolError("invalid-payload", "canonical JSON rejects non-finite numbers");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) throw new FleetProtocolError("invalid-payload", "canonical JSON rejects cycles");
		seen.add(value);
		const encoded = "[" + value.map((item) => canonicalize(item, seen)).join(",") + "]";
		seen.delete(value);
		return encoded;
	}
	if (isRecord$2(value)) {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) throw new FleetProtocolError("invalid-payload", "canonical JSON accepts only plain objects");
		if (seen.has(value)) throw new FleetProtocolError("invalid-payload", "canonical JSON rejects cycles");
		seen.add(value);
		const encoded = "{" + Object.keys(value).sort().map((key) => {
			const item = value[key];
			if (item === void 0) throw new FleetProtocolError("invalid-payload", "canonical JSON rejects undefined");
			return JSON.stringify(key) + ":" + canonicalize(item, seen);
		}).join(",") + "}";
		seen.delete(value);
		return encoded;
	}
	throw new FleetProtocolError("invalid-payload", "value is not representable as canonical JSON");
}
function canonicalJson(value) {
	return canonicalize(value, /* @__PURE__ */ new Set());
}
function sha256Canonical(value) {
	return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
function createFleetPlan(body) {
	validatePlanBody(body);
	const digest = sha256Canonical(body);
	return Object.freeze({
		...body,
		planId: "plan:" + digest,
		digest
	});
}
function validateFleetPlan(value) {
	assertExactKeys(value, PLAN_KEYS, "plan");
	const body = {
		protocolVersion: value.protocolVersion,
		deviceId: value.deviceId,
		profile: value.profile,
		manifestDigest: value.manifestDigest,
		profileHash: value.profileHash,
		observedDshVersion: value.observedDshVersion,
		pluginId: value.pluginId,
		action: value.action,
		fromSpec: value.fromSpec,
		exactToSpec: value.exactToSpec,
		sourceKind: value.sourceKind,
		restartRequired: value.restartRequired,
		createdAt: value.createdAt,
		expiresAt: value.expiresAt
	};
	validatePlanBody(body);
	assertDigest(value.digest, "digest");
	const digest = sha256Canonical(body);
	if (value.digest !== digest || value.planId !== "plan:" + digest) throw new FleetProtocolError("plan-integrity-failed", "plan id or digest does not match its canonical body");
}
function asTimestamp(value, field) {
	if (value instanceof Date) {
		const timestamp = value.getTime();
		if (!Number.isFinite(timestamp)) throw new FleetProtocolError("invalid-time", field + " is invalid");
		return timestamp;
	}
	return parseCanonicalTime(value, field);
}
function validateFleetPlanApproval(plan, approval, now) {
	validateFleetPlan(plan);
	assertExactKeys(approval, APPROVAL_KEYS, "approval");
	if (approval.protocolVersion !== 1) throw new FleetProtocolError("invalid-protocol", "unsupported approval protocol version");
	assertNonEmpty(approval.approvalId, "approvalId");
	assertNonEmpty(approval.principalId, "approval.principalId");
	assertNonEmpty(approval.planId, "approval.planId");
	assertDigest(approval.planDigest, "approval.planDigest");
	assertNonEmpty(approval.deviceId, "approval.deviceId");
	assertNonEmpty(approval.profile, "approval.profile");
	const approvedAt = parseCanonicalTime(approval.approvedAt, "approvedAt");
	const expiresAt = parseCanonicalTime(approval.expiresAt, "approval.expiresAt");
	const nowAt = asTimestamp(now, "now");
	const planCreatedAt = Date.parse(plan.createdAt);
	const planExpiresAt = Date.parse(plan.expiresAt);
	if (approval.planId !== plan.planId || approval.planDigest !== plan.digest || approval.deviceId !== plan.deviceId || approval.profile !== plan.profile) throw new FleetProtocolError("approval-mismatch", "approval is not bound to this exact plan, device and profile");
	if (approvedAt < planCreatedAt || expiresAt <= approvedAt || expiresAt > planExpiresAt) throw new FleetProtocolError("approval-mismatch", "approval lifetime is outside the plan lifetime");
	if (nowAt < approvedAt) throw new FleetProtocolError("approval-mismatch", "approval is not active yet");
	if (nowAt >= planExpiresAt) throw new FleetProtocolError("plan-expired", "plan has expired");
	if (nowAt >= expiresAt) throw new FleetProtocolError("approval-expired", "approval has expired");
	return Object.freeze({ idempotencyKey: "approval:" + sha256Canonical(approval) });
}
var FleetPlannerError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "FleetPlannerError";
		this.code = code;
	}
};
const INPUT_KEYS = [
	"manifest",
	"manifestDigest",
	"dependencies",
	"profileHash",
	"observedDshVersion",
	"now",
	"pluginId",
	"deviceId",
	"profile",
	"planTtlMs"
];
const MANIFEST_KEYS = [
	"schemaVersion",
	"team",
	"devices",
	"plugins"
];
const TEAM_KEYS = ["id", "name"];
const DEVICE_KEYS = [
	"assignedTo",
	"class",
	"channel",
	"labels"
];
const PLUGIN_KEYS = [
	"id",
	"spec",
	"source",
	"revision",
	"profiles",
	"runtimeModules",
	"target"
];
const TARGET_KEYS = [
	"devices",
	"classes",
	"channels"
];
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function rejectUnknownKeys(value, keys, label) {
	if (!isRecord$1(value)) throw new FleetPlannerError("invalid-input", label + " must be an object");
	const allowed = new Set(keys);
	for (const key of Object.keys(value)) if (!allowed.has(key)) throw new FleetPlannerError("invalid-input", label + " contains unsupported field " + JSON.stringify(key));
}
function trimmed(value, field) {
	if (typeof value !== "string" || value.trim().length === 0) throw new FleetPlannerError("invalid-input", field + " must be a non-empty string");
	return value.trim();
}
function canonicalNow(value) {
	const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
	if (!Number.isFinite(date.getTime())) throw new FleetPlannerError("invalid-input", "now must be a valid timestamp");
	return date.toISOString();
}
function targetsDevice(plugin, deviceId, device) {
	const target = plugin.target;
	if (target === void 0) return true;
	rejectUnknownKeys(target, TARGET_KEYS, "plugin.target");
	if (target.devices !== void 0 && !target.devices.includes(deviceId)) return false;
	if (target.classes !== void 0 && !target.classes.includes(device.class)) return false;
	if (target.channels !== void 0 && !target.channels.includes(device.channel)) return false;
	return true;
}
function desiredExactSource(plugin) {
	rejectUnknownKeys(plugin, PLUGIN_KEYS, "plugin");
	const spec = trimmed(plugin.spec, "plugin.spec");
	if (plugin.source === void 0) {
		const sourceKind = exactSourceKind(spec);
		if (sourceKind === null) throw new FleetPlannerError("unsupported-source", "stable plans require exact npm semver or github:owner/repo#40sha");
		return {
			sourceKind,
			exactToSpec: spec
		};
	}
	const source = trimmed(plugin.source, "plugin.source");
	if (source === "npm") {
		const revision = trimmed(plugin.revision, "plugin.revision");
		if (spec !== revision || exactSourceKind(revision) !== "npm") throw new FleetPlannerError("unsupported-source", "npm plans require one exact semver revision");
		return {
			sourceKind: "npm",
			exactToSpec: revision
		};
	}
	if (/^github:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(source)) {
		const revision = trimmed(plugin.revision, "plugin.revision");
		if (!/^[0-9a-fA-F]{40}$/.test(revision)) throw new FleetPlannerError("unsupported-source", "GitHub plans require a 40-hex commit revision");
		const exactToSpec = source + "#" + revision.toLowerCase();
		if (spec.toLowerCase() !== exactToSpec.toLowerCase()) throw new FleetPlannerError("unsupported-source", "plugin.spec must match its exact GitHub source and revision");
		return {
			sourceKind: "github",
			exactToSpec
		};
	}
	throw new FleetPlannerError("unsupported-source", "URLs, tags, links, files, workspaces and shell sources are not supported");
}
function selectedPlugin(manifest, pluginId, profile, deviceId, device) {
	const matches = manifest.plugins.filter((plugin) => plugin.id === pluginId && (plugin.profiles === void 0 || plugin.profiles.includes(profile)) && targetsDevice(plugin, deviceId, device));
	if (matches.length === 0) throw new FleetPlannerError("plugin-not-targeted", "plugin is not targeted to this device and profile");
	if (matches.length !== 1) throw new FleetPlannerError("ambiguous-plugin", "more than one plugin variant targets this device and profile");
	return matches[0];
}
function createAgentPlan(input) {
	rejectUnknownKeys(input, INPUT_KEYS, "planner input");
	rejectUnknownKeys(input.manifest, MANIFEST_KEYS, "manifest");
	rejectUnknownKeys(input.manifest.team, TEAM_KEYS, "manifest.team");
	if (input.manifest.schemaVersion !== 1 || !Array.isArray(input.manifest.plugins) || !isRecord$1(input.manifest.devices)) throw new FleetPlannerError("invalid-input", "planner requires a parsed schemaVersion 1 manifest");
	if (!isRecord$1(input.dependencies)) throw new FleetPlannerError("invalid-input", "dependencies must be an object");
	const deviceId = trimmed(input.deviceId, "deviceId");
	const profile = trimmed(input.profile, "profile");
	const pluginId = trimmed(input.pluginId, "pluginId");
	if (!isSafeNpmPackageName(pluginId)) throw new FleetPlannerError("invalid-input", "pluginId must be one literal lowercase npm package name");
	const observedDshVersion = trimmed(input.observedDshVersion, "observedDshVersion");
	if (!isSupportedDshVersion(observedDshVersion)) throw new FleetPlannerError("unsupported-dsh-version", "DSH version is outside the supported agent range");
	const device = input.manifest.devices[deviceId];
	if (device === void 0) throw new FleetPlannerError("unknown-device", "device is not registered in the manifest");
	rejectUnknownKeys(device, DEVICE_KEYS, "device");
	if (device.channel !== "stable") throw new FleetPlannerError("device-not-stable", "this planner slice only supports stable devices");
	const { sourceKind, exactToSpec } = desiredExactSource(selectedPlugin(input.manifest, pluginId, profile, deviceId, device));
	const actualSpec = input.dependencies[pluginId];
	if (actualSpec === exactToSpec) throw new FleetPlannerError("already-aligned", "plugin is already aligned; no plan is created");
	if (actualSpec !== void 0 && (typeof actualSpec !== "string" || actualSpec.trim().length === 0)) throw new FleetPlannerError("invalid-input", "installed dependency spec must be a non-empty string");
	const createdAt = canonicalNow(input.now);
	const planTtlMs = input.planTtlMs ?? 3e5;
	if (!Number.isSafeInteger(planTtlMs) || planTtlMs < 6e4 || planTtlMs > 36e5) throw new FleetPlannerError("invalid-input", "planTtlMs must be an integer from 60000 to 3600000");
	const expiresAt = new Date(Date.parse(createdAt) + planTtlMs).toISOString();
	try {
		return createFleetPlan({
			protocolVersion: 1,
			deviceId,
			profile,
			manifestDigest: trimmed(input.manifestDigest, "manifestDigest").toLowerCase(),
			profileHash: trimmed(input.profileHash, "profileHash").toLowerCase(),
			observedDshVersion,
			pluginId,
			action: actualSpec === void 0 ? "install" : "update",
			fromSpec: actualSpec ?? null,
			exactToSpec,
			sourceKind,
			restartRequired: true,
			createdAt,
			expiresAt
		});
	} catch (error) {
		if (error instanceof FleetProtocolError) throw error;
		throw new FleetPlannerError("invalid-input", error instanceof Error ? error.message : String(error));
	}
}
//#endregion
//#region src/agent/runtime.ts
const SNAPSHOT_FILES = [
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"cordis.patch.yml"
];
const MAX_OUTPUT_BYTES = 1048576;
var AgentRuntimeError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "AgentRuntimeError";
		this.code = code;
	}
};
function profileDir(config) {
	return join(config.dshHome, "profiles", config.profile);
}
function controlledEnv(config) {
	const path = [
		dirname(config.pnpmBinary),
		dirname(config.dshBinary),
		"/opt/homebrew/bin",
		"/usr/bin",
		"/bin"
	].join(":");
	const env = {};
	for (const key of [
		"HOME",
		"USER",
		"LOGNAME",
		"TMPDIR",
		"LANG",
		"LC_ALL",
		"SHELL",
		"TERM",
		"XDG_CONFIG_HOME",
		"XDG_CACHE_HOME"
	]) if (process.env[key] !== void 0) env[key] = process.env[key];
	return {
		...env,
		DSH_HOME: config.dshHome,
		PATH: path,
		GIT_TERMINAL_PROMPT: "0"
	};
}
function runFile(file, args, options = {}) {
	return new Promise((resolve, reject) => {
		const grouped = process.platform !== "win32";
		const child = spawn(file, args, {
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			shell: false,
			detached: grouped,
			...options.env === void 0 ? {} : { env: options.env },
			...options.cwd === void 0 ? {} : { cwd: options.cwd }
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		let timedOut = false;
		let forceTimer;
		const killTree = (signal) => {
			try {
				if (grouped && child.pid !== void 0) process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch (error) {
				if (error.code !== "ESRCH") throw error;
			}
		};
		const finish = (action) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (forceTimer !== void 0) clearTimeout(forceTimer);
			action();
		};
		const timer = setTimeout(() => {
			timedOut = true;
			killTree("SIGTERM");
			forceTimer = setTimeout(() => killTree("SIGKILL"), 2e3);
			forceTimer.unref();
		}, options.timeoutMs ?? 12e4);
		timer.unref();
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) child.kill("SIGTERM");
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
			if (Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) child.kill("SIGTERM");
		});
		child.once("error", () => finish(() => {
			reject(new AgentRuntimeError("command-unavailable", "required executable is unavailable"));
		}));
		child.once("close", (code) => finish(() => {
			const exitCode = code ?? 1;
			if (timedOut) reject(new AgentRuntimeError("command-timeout", "controlled command exceeded its timeout"));
			else if (exitCode !== 0 && options.allowFailure !== true) reject(new AgentRuntimeError("command-failed", "controlled command failed"));
			else resolve({
				stdout,
				stderr,
				code: exitCode
			});
		}));
	});
}
function sha256(value) {
	return createHash("sha256").update(value, "utf8").digest("hex");
}
async function readOptional(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
async function readRegularOptional(path) {
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink() || !info.isFile()) throw new AgentRuntimeError("unsafe-profile-file", "profile state accepts regular files only");
		return await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
async function computeProfileHash(config) {
	const dir = profileDir(config);
	const files = {};
	for (const name of SNAPSHOT_FILES) files[name] = await readRegularOptional(join(dir, name));
	return sha256(JSON.stringify(files));
}
async function readDshVersion(config) {
	const version = (await runFile(config.dshBinary, ["--version"], {
		env: controlledEnv(config),
		timeoutMs: 1e4
	})).stdout.trim();
	if (version.length === 0) throw new AgentRuntimeError("dsh-version-unavailable", "DSH version is unavailable");
	return version;
}
async function loadState(config) {
	const manifestSource = await readFile(config.manifestPath, "utf8");
	const manifest = parseFleetManifest(manifestSource);
	const profileSource = await readRegularOptional(join(profileDir(config), "package.json"));
	const parsed = profileSource === null ? {} : JSON.parse(profileSource);
	return {
		manifest,
		manifestDigest: sha256(manifestSource),
		dependencies: parsed.dependencies ?? {},
		profileHash: await computeProfileHash(config),
		dshVersion: await readDshVersion(config)
	};
}
function planPath(config, planId) {
	if (!/^plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError("invalid-plan-id", "plan id is invalid");
	return join(config.stateDir, "plans", planId.slice(5) + ".json");
}
function actionPath(config, planId) {
	if (!/^plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError("invalid-plan-id", "plan id is invalid");
	return join(config.stateDir, "actions", planId.slice(5) + ".json");
}
async function atomicJson(path, value) {
	await mkdir(dirname(path), {
		recursive: true,
		mode: 448
	});
	const temporary = path + "." + randomUUID() + ".tmp";
	await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 384 });
	await rename(temporary, path);
}
async function readJson(path) {
	const source = await readOptional(path);
	return source === null ? null : JSON.parse(source);
}
async function audit(config, event) {
	await mkdir(config.stateDir, {
		recursive: true,
		mode: 448
	});
	await appendFile(join(config.stateDir, "audit.jsonl"), JSON.stringify({
		eventId: randomUUID(),
		at: (/* @__PURE__ */ new Date()).toISOString(),
		deviceId: config.deviceId,
		...event
	}) + "\n", { mode: 384 });
}
async function processIsAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code !== "ESRCH";
	}
}
async function withProfileLock(config, operation) {
	const lockDir = join(config.stateDir, "locks");
	await mkdir(lockDir, {
		recursive: true,
		mode: 448
	});
	const identity = sha256(config.dshHome + "\0" + config.profile);
	const lockPath = join(lockDir, identity + ".lock");
	const token = randomUUID();
	for (;;) try {
		const handle = await open(lockPath, "wx", 384);
		try {
			await handle.writeFile(JSON.stringify({
				token,
				pid: process.pid,
				createdAt: (/* @__PURE__ */ new Date()).toISOString()
			}) + "\n");
		} finally {
			await handle.close();
		}
		break;
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		let owner = null;
		let ageMs = 0;
		try {
			const info = await lstat(lockPath);
			if (info.isSymbolicLink() || !info.isFile()) throw new AgentRuntimeError("unsafe-state-file", "fleet lock must be a regular file");
			ageMs = Date.now() - info.mtimeMs;
			owner = JSON.parse(await readFile(lockPath, "utf8"));
		} catch (readError) {
			if (readError.code === "ENOENT") continue;
			if (readError instanceof AgentRuntimeError) throw readError;
		}
		const ownerPid = typeof owner?.pid === "number" && Number.isSafeInteger(owner.pid) && owner.pid > 0 ? owner.pid : null;
		if (ownerPid !== null && await processIsAlive(ownerPid) || ownerPid === null && ageMs < 1e4) throw new AgentRuntimeError("agent-busy", "another fleet action is already running for this profile");
		await rm(lockPath, { force: true });
	}
	try {
		return await operation();
	} finally {
		try {
			if (JSON.parse(await readFile(lockPath, "utf8")).token === token) await rm(lockPath, { force: true });
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
}
async function saveAction(config, record, state, fields = {}) {
	const next = {
		...record,
		...fields,
		state,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	await atomicJson(actionPath(config, record.planId), next);
	return next;
}
async function snapshotProfile(config, plan) {
	const destination = join(config.stateDir, "snapshots", plan.digest);
	await rm(destination, {
		recursive: true,
		force: true
	});
	await mkdir(destination, {
		recursive: true,
		mode: 448
	});
	let profileDirectoryPresent = true;
	try {
		const info = await lstat(profileDir(config));
		if (info.isSymbolicLink() || !info.isDirectory()) throw new AgentRuntimeError("unsafe-profile-directory", "profile state accepts a regular directory only");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		profileDirectoryPresent = false;
	}
	const present = {};
	for (const name of SNAPSHOT_FILES) {
		const source = join(profileDir(config), name);
		try {
			const info = await lstat(source);
			if (info.isSymbolicLink() || !info.isFile()) throw new AgentRuntimeError("unsafe-profile-file", "profile snapshots accept regular files only");
			await copyFile(source, join(destination, name));
			present[name] = true;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			present[name] = false;
		}
	}
	if (profileDirectoryPresent && (present["package.json"] !== true || present["pnpm-lock.yaml"] !== true)) throw new AgentRuntimeError("profile-not-snapshotable", "an existing profile requires package.json and pnpm-lock.yaml for rollback");
	await atomicJson(join(destination, "snapshot.json"), {
		planId: plan.planId,
		digest: plan.digest,
		manifestDigest: plan.manifestDigest,
		profileHash: plan.profileHash,
		profileDirectoryPresent,
		present
	});
}
async function restoreProfile(config, plan) {
	const source = join(config.stateDir, "snapshots", plan.digest);
	const metadataSource = await readRegularOptional(join(source, "snapshot.json"));
	if (metadataSource === null) throw new AgentRuntimeError("snapshot-missing", "profile snapshot is unavailable");
	const metadata = JSON.parse(metadataSource);
	if (metadata.planId !== plan.planId || metadata.digest !== plan.digest || metadata.manifestDigest !== plan.manifestDigest || metadata.profileHash !== plan.profileHash) throw new AgentRuntimeError("snapshot-mismatch", "profile snapshot does not match the approved plan");
	const targetDir = profileDir(config);
	try {
		const info = await lstat(targetDir);
		if (info.isSymbolicLink() || !info.isDirectory()) throw new AgentRuntimeError("unsafe-profile-directory", "profile state accepts a regular directory only");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (metadata.profileDirectoryPresent !== true) {
		await rm(targetDir, {
			recursive: true,
			force: true
		});
		return;
	}
	if (metadata.present["package.json"] !== true || metadata.present["pnpm-lock.yaml"] !== true) throw new AgentRuntimeError("snapshot-mismatch", "profile snapshot cannot rebuild the dependency tree");
	await mkdir(targetDir, {
		recursive: true,
		mode: 448
	});
	for (const name of SNAPSHOT_FILES) {
		const destination = join(targetDir, name);
		await rm(destination, { force: true });
		if (metadata.present[name] === true) await copyFile(join(source, name), destination);
	}
	await runFile(config.pnpmBinary, [
		"install",
		"--frozen-lockfile",
		"--ignore-scripts"
	], {
		cwd: targetDir,
		env: controlledEnv(config),
		timeoutMs: 12e4
	});
	if (await computeProfileHash(config) !== plan.profileHash) throw new AgentRuntimeError("rollback-profile-mismatch", "restored profile does not match the approved snapshot");
}
async function restartDsh(config) {
	if (config.restart.kind === "none") return;
	const env = controlledEnv(config);
	await runFile(config.restart.screenBinary, [
		"-S",
		config.restart.sessionName,
		"-X",
		"quit"
	], {
		env,
		timeoutMs: 1e4,
		allowFailure: true
	});
	const listeners = await runFile(config.restart.lsofBinary, [
		"-nP",
		"-t",
		"-iTCP:" + String(config.restart.port),
		"-sTCP:LISTEN"
	], {
		env,
		timeoutMs: 1e4,
		allowFailure: true
	});
	const pids = listeners.stdout.trim() === "" ? [] : listeners.stdout.trim().split(/\s+/).map((value) => Number(value));
	if (pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0) || pids.length > 1) throw new AgentRuntimeError("restart-owner-ambiguous", "DSH restart found an ambiguous listener owner");
	const listenerPid = pids[0];
	if (listenerPid !== void 0) {
		const command = (await runFile(config.restart.psBinary, [
			"-p",
			String(listenerPid),
			"-o",
			"command="
		], {
			env,
			timeoutMs: 1e4
		})).stdout.trim();
		const hasWebToken = /(?:^|\s)web(?:\s|$)/.test(command);
		const hasPort = command.includes("--port " + String(config.restart.port));
		if (!config.restart.ownerMarkers.some((marker) => command.includes(marker)) || !hasWebToken || !hasPort) throw new AgentRuntimeError("restart-owner-mismatch", "configured port is not owned by a recognizable DSH Web process");
		try {
			process.kill(listenerPid, "SIGTERM");
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
		const deadline = Date.now() + 5e3;
		while (Date.now() < deadline && await processIsAlive(listenerPid)) await new Promise((resolve) => setTimeout(resolve, 100));
		if (await processIsAlive(listenerPid)) try {
			process.kill(listenerPid, "SIGKILL");
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
	}
	if ((await runFile(config.restart.screenBinary, [
		"-DmS",
		config.restart.sessionName,
		"/usr/bin/env",
		"DSH_HOME=" + config.dshHome,
		"PATH=" + env.PATH,
		config.dshBinary,
		"web",
		"--host",
		config.restart.host,
		"--port",
		String(config.restart.port)
	], {
		env,
		timeoutMs: 1e4,
		allowFailure: true
	})).code !== 0) throw new AgentRuntimeError("restart-failed", "DSH restart failed");
}
async function waitForHttp(url, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(3e3, Math.max(1, deadline - Date.now()))) });
			if (response.ok) return response;
			response.status;
		} catch (error) {}
		await new Promise((resolve) => setTimeout(resolve, 350));
	}
	throw new AgentRuntimeError("health-timeout", "DSH health endpoint did not recover before timeout");
}
async function verifyHealth(config, plan) {
	await runFile(config.dshBinary, [
		"--profile",
		config.profile,
		"--dump-config"
	], {
		env: controlledEnv(config),
		timeoutMs: 2e4
	});
	if (plan !== void 0) {
		const source = await readRegularOptional(join(profileDir(config), "package.json"));
		if (source === null) throw new AgentRuntimeError("profile-missing", "DSH profile is missing after apply");
		if (JSON.parse(source).dependencies?.[plan.pluginId] !== plan.exactToSpec) throw new AgentRuntimeError("profile-mismatch", "installed dependency does not match the approved plan");
	}
	if (config.health.url === void 0) return;
	await waitForHttp(config.health.url, config.health.timeoutMs);
	if (!config.health.requireFleetRpc) return;
	const endpoint = new URL("/dsh-fleet/status", config.health.url);
	const deadline = Date.now() + config.health.timeoutMs;
	let targetPending = plan !== void 0;
	while (Date.now() < deadline) {
		const rpcId = "fleet-agent-health-" + randomUUID();
		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "client-request",
					rpcId,
					method: "status",
					payload: null
				}),
				signal: AbortSignal.timeout(Math.min(3e3, Math.max(1, deadline - Date.now())))
			});
			if (response.ok) {
				const body = await response.json();
				const fleetHealthy = body.rpcId === rpcId && body.result?.ok === true && body.result.value?.summary?.failed === 0;
				const target = plan === void 0 ? void 0 : body.result?.value?.plugins?.find((item) => item.id === plan.pluginId);
				targetPending = plan !== void 0 && target?.state !== "aligned";
				if (fleetHealthy && !targetPending) return;
			}
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 350));
	}
	if (targetPending) throw new AgentRuntimeError("plugin-not-active", "approved plugin did not become active");
	throw new AgentRuntimeError("fleet-rpc-unhealthy", "Fleet RPC reported an unhealthy runtime");
}
function installArgument(plan) {
	return plan.pluginId + "@" + plan.exactToSpec;
}
async function applyPackage(config, plan) {
	await runFile(config.pnpmBinary, ["--version"], {
		env: controlledEnv(config),
		timeoutMs: 1e4
	});
	await runFile(config.dshBinary, [
		"plugin",
		"--profile",
		config.profile,
		"add",
		installArgument(plan),
		"--save-exact",
		"--ignore-scripts"
	], {
		env: controlledEnv(config),
		timeoutMs: 12e4
	});
}
async function inspectAgent(config, now = /* @__PURE__ */ new Date()) {
	const state = await loadState(config);
	const ids = [...new Set(state.manifest.plugins.map((plugin) => plugin.id))].sort();
	const candidates = [];
	for (const pluginId of ids) try {
		const plan = createAgentPlan({
			manifest: state.manifest,
			manifestDigest: state.manifestDigest,
			dependencies: state.dependencies,
			profileHash: state.profileHash,
			observedDshVersion: state.dshVersion,
			now,
			pluginId,
			deviceId: config.deviceId,
			profile: config.profile,
			planTtlMs: config.planTtlMs
		});
		candidates.push({
			pluginId: plan.pluginId,
			action: plan.action,
			fromSpec: plan.fromSpec,
			exactToSpec: plan.exactToSpec,
			sourceKind: plan.sourceKind
		});
	} catch (error) {
		const code = error.code;
		if (code !== "already-aligned" && code !== "plugin-not-targeted") throw error;
	}
	return {
		protocolVersion: 1,
		deviceId: config.deviceId,
		profile: config.profile,
		dshVersion: state.dshVersion,
		manifestDigest: state.manifestDigest,
		profileHash: state.profileHash,
		candidates
	};
}
async function createStoredPlan(config, pluginId, now = /* @__PURE__ */ new Date()) {
	const state = await loadState(config);
	const plan = createAgentPlan({
		manifest: state.manifest,
		manifestDigest: state.manifestDigest,
		dependencies: state.dependencies,
		profileHash: state.profileHash,
		observedDshVersion: state.dshVersion,
		now,
		pluginId,
		deviceId: config.deviceId,
		profile: config.profile,
		planTtlMs: config.planTtlMs
	});
	await atomicJson(planPath(config, plan.planId), plan);
	await audit(config, {
		type: "plan/created",
		planId: plan.planId,
		pluginId: plan.pluginId,
		action: plan.action
	});
	return plan;
}
async function readAction(config, planId) {
	return readJson(actionPath(config, planId));
}
async function recoverInterrupted(config, plan, record) {
	let current = await saveAction(config, record, "rollback", { errorCode: "interrupted-action" });
	try {
		await restoreProfile(config, plan);
		current = await saveAction(config, current, "rollback-restarting");
		await restartDsh(config);
		current = await saveAction(config, current, "rollback-verifying");
		await verifyHealth(config);
		current = await saveAction(config, current, "rolled-back", { result: "rolled-back" });
		await audit(config, {
			type: "capability/rolled-back",
			planId: plan.planId,
			result: "interrupted-action"
		});
		return current;
	} catch {
		current = await saveAction(config, current, "manual-intervention", {
			result: "manual-intervention",
			errorCode: "rollback-failed"
		});
		await audit(config, {
			type: "capability/failed",
			planId: plan.planId,
			result: "manual-intervention"
		});
		return current;
	}
}
async function applyStoredPlanLocked(config, approval, now) {
	const plan = await readJson(planPath(config, approval.planId));
	if (plan === null) throw new AgentRuntimeError("plan-not-found", "approved plan was not found");
	validateFleetPlan(plan);
	const existing = await readAction(config, plan.planId);
	let validation;
	try {
		validation = validateFleetPlanApproval(plan, approval, now);
	} catch (error) {
		if (existing !== null && existing.state !== "succeeded" && existing.state !== "rolled-back" && existing.state !== "manual-intervention") return recoverInterrupted(config, plan, existing);
		throw error;
	}
	if (existing !== null) {
		if (existing.idempotencyKey !== validation.idempotencyKey) {
			if (existing.state !== "succeeded" && existing.state !== "rolled-back" && existing.state !== "manual-intervention") return recoverInterrupted(config, plan, existing);
			throw new AgentRuntimeError("idempotency-conflict", "plan already has a different approval");
		}
		if (existing.state === "succeeded" || existing.state === "rolled-back" || existing.state === "manual-intervention") return existing;
		return recoverInterrupted(config, plan, existing);
	}
	const currentState = await loadState(config);
	if (currentState.manifestDigest !== plan.manifestDigest || currentState.profileHash !== plan.profileHash || currentState.dshVersion !== plan.observedDshVersion) throw new FleetProtocolError("approval-mismatch", "manifest, profile or DSH version changed after the plan was created");
	const recordSeed = {
		planId: plan.planId,
		planDigest: plan.digest,
		approvalId: approval.approvalId,
		principalId: approval.principalId,
		idempotencyKey: validation.idempotencyKey,
		deviceId: plan.deviceId,
		profile: plan.profile,
		pluginId: plan.pluginId,
		action: plan.action,
		state: "staged",
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	await audit(config, {
		type: "plan/approved",
		planId: plan.planId,
		approvalId: approval.approvalId,
		principalId: approval.principalId
	});
	await snapshotProfile(config, plan);
	let record = await saveAction(config, recordSeed, "staged");
	try {
		record = await saveAction(config, record, "applying");
		await applyPackage(config, plan);
		record = await saveAction(config, record, "restarting");
		await restartDsh(config);
		record = await saveAction(config, record, "verifying");
		await verifyHealth(config, plan);
		record = await saveAction(config, record, "succeeded", { result: "success" });
		await audit(config, {
			type: "capability/applied",
			planId: plan.planId,
			pluginId: plan.pluginId,
			result: "success"
		});
		return record;
	} catch (error) {
		const errorCode = typeof error.code === "string" ? error.code : "apply-failed";
		record = await saveAction(config, record, "rollback", { errorCode });
		await audit(config, {
			type: "capability/failed",
			planId: plan.planId,
			pluginId: plan.pluginId,
			result: errorCode
		});
		try {
			await restoreProfile(config, plan);
			record = await saveAction(config, record, "rollback-restarting");
			await restartDsh(config);
			record = await saveAction(config, record, "rollback-verifying");
			await verifyHealth(config);
			record = await saveAction(config, record, "rolled-back", { result: "rolled-back" });
			await audit(config, {
				type: "capability/rolled-back",
				planId: plan.planId,
				result: errorCode
			});
			return record;
		} catch {
			record = await saveAction(config, record, "manual-intervention", {
				result: "manual-intervention",
				errorCode: "rollback-failed"
			});
			await audit(config, {
				type: "capability/failed",
				planId: plan.planId,
				result: "manual-intervention"
			});
			return record;
		}
	}
}
async function applyStoredPlan(config, approval, now = /* @__PURE__ */ new Date()) {
	return withProfileLock(config, () => applyStoredPlanLocked(config, approval, now));
}
//#endregion
//#region src/host/agent-client.ts
function isRecord(value) {
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
function safePath(value, field) {
	if (!isAbsolute(value) || normalize(value) !== value || !/^\/[A-Za-z0-9._/-]+$/.test(value)) throw new TypeError(field + " must be a normalized absolute path without shell metacharacters");
	return value;
}
function nonEmpty(value, field) {
	if (value.trim().length === 0) throw new TypeError(field + " must not be empty");
	return value.trim();
}
function validateAgentTarget(target) {
	const deviceId = nonEmpty(target.deviceId, "target.deviceId");
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
	const candidate = isRecord(value) ? value.code : void 0;
	const code = typeof candidate === "string" && Object.hasOwn(messages, candidate) ? candidate : "agent-rejected";
	return new AgentClientError(code, messages[code] ?? "fleet agent rejected the request");
}
function callAgent(targetInput, command, payload, timeoutMs, signal) {
	const invocation = childInvocation(validateAgentTarget(targetInput), command);
	return new Promise((resolve, reject) => {
		if (signal?.aborted === true) {
			reject(new AgentClientError("cancelled", "fleet agent request was cancelled"));
			return;
		}
		const child = spawn(invocation.file, invocation.args, {
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			shell: false,
			env: {
				...process.env,
				GIT_TERMINAL_PROMPT: "0"
			}
		});
		let stdout = "";
		let stderrBytes = 0;
		let settled = false;
		const finish = (action) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			action();
		};
		const abort = () => {
			child.kill("SIGTERM");
			finish(() => reject(new AgentClientError("cancelled", "fleet agent request was cancelled")));
		};
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			finish(() => reject(new AgentClientError("agent-timeout", "fleet agent did not answer before the timeout")));
		}, timeoutMs);
		timer.unref();
		signal?.addEventListener("abort", abort, { once: true });
		child.once("error", () => finish(() => reject(new AgentClientError("agent-unavailable", "fleet agent transport is unavailable"))));
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			if (stdout.length <= 1048576) stdout += chunk;
			if (stdout.length > 1048576) child.kill("SIGTERM");
		});
		child.stderr.on("data", (chunk) => {
			stderrBytes += chunk.length;
			if (stderrBytes > 1048576) child.kill("SIGTERM");
		});
		child.once("close", (code) => {
			finish(() => {
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
				if (!isRecord(response) || typeof response.ok !== "boolean") {
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
		child.stdin.end(JSON.stringify(payload) + "\n");
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
export { applyStoredPlan, callAgent, canonicalJson, collectFleetUpdates, computeProfileHash, createAgentClient, createAgentPlan, createFleetPlan, createStoredPlan, createUpdateMonitor, exactSourceKind, inspectAgent, isSupportedDshVersion, parseAgentConfig, parseFleetManifest, readAction, readAgentConfig, reconcileFleet, sha256Canonical, systemUpdateProbe, validateAgentTarget, validateFleetPlan, validateFleetPlanApproval };
