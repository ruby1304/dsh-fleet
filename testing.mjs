import { parse, stringify } from "yaml";
import { gt, satisfies, valid, validRange } from "semver";
import { access, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
//#region src/shared.ts
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function normalizeDeviceId(value, field = "deviceId") {
	if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(field + " must be a non-empty string");
	const deviceId = value.trim();
	if (!DEVICE_ID_PATTERN.test(deviceId)) throw new TypeError(field + " must be 1 to 64 ASCII letters, digits, dots, underscores or hyphens and start with a letter or digit");
	return deviceId;
}
//#endregion
//#region src/host/core.ts
function isRecord$7(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings$1(value, field) {
	if (value === void 0) return void 0;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) throw new TypeError(field + " must be an array of non-empty strings");
	return value.map((item) => item.trim());
}
function nonEmpty$1(value, field) {
	if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(field + " must be a non-empty string");
	return value.trim();
}
function exactKeys$4(value, allowed, field) {
	const extras = Object.keys(value).filter((key) => !allowed.includes(key));
	if (extras.length > 0) throw new TypeError(field + " contains unsupported fields: " + extras.sort().join(", "));
}
function safeIdentifier$1(value, field) {
	const id = nonEmpty$1(value, field);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new TypeError(field + " must be 1 to 64 ASCII letters, digits, dots, underscores or hyphens");
	return id;
}
function safePackageName(value, field) {
	const id = nonEmpty$1(value, field);
	if (id.length > 214 || id !== id.toLowerCase() || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(id)) throw new TypeError(field + " must be one literal lowercase npm package name");
	return id;
}
function exactSemver(value, field) {
	const version = nonEmpty$1(value, field);
	if (valid(version) !== version) throw new TypeError(field + " must be an exact semantic version");
	return version;
}
function sha256Digest(value, field) {
	const digest = nonEmpty$1(value, field);
	if (!/^[0-9a-f]{64}$/.test(digest)) throw new TypeError(field + " must be a lowercase SHA-256 digest");
	return digest;
}
function parseDevice(value, field) {
	if (!isRecord$7(value)) throw new TypeError(field + " must be an object");
	const assignedTo = value.assignedTo === void 0 ? void 0 : nonEmpty$1(value.assignedTo, field + ".assignedTo");
	const labels = strings$1(value.labels, field + ".labels");
	return {
		...assignedTo === void 0 ? {} : { assignedTo },
		class: nonEmpty$1(value.class, field + ".class"),
		channel: nonEmpty$1(value.channel, field + ".channel"),
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
	if (!isRecord$7(value)) throw new TypeError(field + " must be an object");
	const profiles = strings$1(value.profiles, field + ".profiles");
	const runtimeModules = strings$1(value.runtimeModules, field + ".runtimeModules");
	let target;
	if (value.target !== void 0) {
		if (!isRecord$7(value.target)) throw new TypeError(field + ".target must be an object");
		const devices = strings$1(value.target.devices, field + ".target.devices")?.map((id, targetIndex) => normalizeDeviceId(id, `${field}.target.devices[${targetIndex}]`));
		const classes = strings$1(value.target.classes, field + ".target.classes");
		const channels = strings$1(value.target.channels, field + ".target.channels");
		target = {
			...devices === void 0 ? {} : { devices },
			...classes === void 0 ? {} : { classes },
			...channels === void 0 ? {} : { channels }
		};
	}
	const id = nonEmpty$1(value.id, field + ".id");
	const hasSpec = value.spec !== void 0;
	const hasSource = value.source !== void 0 || value.revision !== void 0;
	if (hasSpec === hasSource) throw new TypeError(field + " must specify exactly one of spec or source");
	const spec = hasSpec ? nonEmpty$1(value.spec, field + ".spec") : void 0;
	const source = hasSource ? nonEmpty$1(value.source, field + ".source") : void 0;
	const revision = value.revision === void 0 ? void 0 : nonEmpty$1(value.revision, field + ".revision");
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
function parseReleaseSource(value, field, visibility) {
	if (!isRecord$7(value)) throw new TypeError(field + " must be an object");
	const kind = nonEmpty$1(value.kind, field + ".kind");
	if (kind === "npm") {
		exactKeys$4(value, [
			"kind",
			"version",
			"integrity"
		], field);
		if (visibility !== "public") throw new TypeError(field + " private plugins must use content-addressed artifact sources");
		const integrity = value.integrity === void 0 ? void 0 : nonEmpty$1(value.integrity, field + ".integrity");
		if (integrity !== void 0 && !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) throw new TypeError(field + ".integrity must be one SHA-512 Subresource Integrity value");
		return {
			kind: "npm",
			version: exactSemver(value.version, field + ".version"),
			...integrity === void 0 ? {} : { integrity }
		};
	}
	if (kind === "github") {
		exactKeys$4(value, [
			"kind",
			"repository",
			"revision"
		], field);
		if (visibility !== "public") throw new TypeError(field + " private plugins must use content-addressed artifact sources");
		const repository = nonEmpty$1(value.repository, field + ".repository");
		if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(repository)) throw new TypeError(field + ".repository must be owner/repository without a URL or revision");
		const revision = nonEmpty$1(value.revision, field + ".revision");
		if (!/^[0-9a-f]{40}$/.test(revision)) throw new TypeError(field + ".revision must be a lowercase 40-character commit SHA");
		return {
			kind: "github",
			repository,
			revision
		};
	}
	if (kind === "artifact") {
		exactKeys$4(value, [
			"kind",
			"digest",
			"version"
		], field);
		if (visibility !== "private") throw new TypeError(field + " artifact sources must be declared private");
		return {
			kind: "artifact",
			digest: sha256Digest(value.digest, field + ".digest"),
			version: exactSemver(value.version, field + ".version")
		};
	}
	throw new TypeError(field + ".kind must be npm, github or artifact");
}
function parseReleasePlugin(value, field) {
	if (!isRecord$7(value)) throw new TypeError(field + " must be an object");
	exactKeys$4(value, [
		"id",
		"visibility",
		"source",
		"runtimeModules"
	], field);
	if (value.visibility !== "public" && value.visibility !== "private") throw new TypeError(field + ".visibility must be public or private");
	const runtimeModules = strings$1(value.runtimeModules, field + ".runtimeModules");
	return {
		id: safePackageName(value.id, field + ".id"),
		visibility: value.visibility,
		source: parseReleaseSource(value.source, field + ".source", value.visibility),
		...runtimeModules === void 0 ? {} : { runtimeModules }
	};
}
function parseProfileRelease(id, value, field) {
	if (!isRecord$7(value)) throw new TypeError(field + " must be an object");
	exactKeys$4(value, [
		"id",
		"version",
		"profile",
		"dshRange",
		"plugins"
	], field);
	if (value.id !== void 0 && safeIdentifier$1(value.id, field + ".id") !== id) throw new TypeError(field + ".id must match its profileReleases key");
	const dshRange = nonEmpty$1(value.dshRange, field + ".dshRange");
	if (validRange(dshRange) === null) throw new TypeError(field + ".dshRange must be a valid semantic-version range");
	if (!Array.isArray(value.plugins) || value.plugins.length === 0) throw new TypeError(field + ".plugins must be a non-empty array");
	const plugins = value.plugins.map((plugin, index) => parseReleasePlugin(plugin, `${field}.plugins[${index}]`));
	const seen = /* @__PURE__ */ new Set();
	for (const plugin of plugins) {
		if (seen.has(plugin.id)) throw new TypeError(field + " contains duplicate plugin id " + JSON.stringify(plugin.id));
		seen.add(plugin.id);
	}
	return {
		id,
		version: exactSemver(value.version, field + ".version"),
		profile: safeIdentifier$1(value.profile, field + ".profile"),
		dshRange,
		plugins
	};
}
function releasePluginSpec(plugin) {
	if (plugin.source.kind === "npm") return {
		spec: plugin.source.version,
		source: "npm",
		revision: plugin.source.version
	};
	if (plugin.source.kind === "github") {
		const source = "github:" + plugin.source.repository;
		return {
			spec: source + "#" + plugin.source.revision,
			source,
			revision: plugin.source.revision
		};
	}
	return {
		spec: "artifact:sha256:" + plugin.source.digest,
		source: "artifact",
		revision: plugin.source.version,
		artifactDigest: plugin.source.digest
	};
}
function parseManifestV2(raw, team, devices) {
	exactKeys$4(raw, [
		"schemaVersion",
		"team",
		"devices",
		"profileReleases",
		"assignments"
	], "fleet manifest");
	if (!isRecord$7(raw.profileReleases)) throw new TypeError("profileReleases must be an object");
	const profileReleases = {};
	for (const [rawId, value] of Object.entries(raw.profileReleases)) {
		const id = safeIdentifier$1(rawId, "profile release id");
		profileReleases[id] = parseProfileRelease(id, value, "profileReleases." + id);
	}
	if (Object.keys(profileReleases).length === 0) throw new TypeError("profileReleases must not be empty");
	if (!isRecord$7(raw.assignments)) throw new TypeError("assignments must be an object");
	const assignments = {};
	const plugins = [];
	for (const [rawDeviceId, value] of Object.entries(raw.assignments)) {
		const deviceId = normalizeDeviceId(rawDeviceId, "assignment device id");
		if (devices[deviceId] === void 0) throw new TypeError("assignments." + deviceId + " references an unknown device");
		if (!isRecord$7(value) || Object.keys(value).length === 0) throw new TypeError("assignments." + deviceId + " must be a non-empty profile-to-release object");
		const deviceAssignments = {};
		for (const [rawProfile, rawReleaseId] of Object.entries(value)) {
			const profile = safeIdentifier$1(rawProfile, `assignments.${deviceId} profile`);
			const releaseId = safeIdentifier$1(rawReleaseId, `assignments.${deviceId}.${profile}`);
			const release = profileReleases[releaseId];
			if (release === void 0) throw new TypeError(`assignments.${deviceId}.${profile} references unknown release ${JSON.stringify(releaseId)}`);
			if (release.profile !== profile) throw new TypeError(`assignments.${deviceId}.${profile} references release for profile ${JSON.stringify(release.profile)}`);
			deviceAssignments[profile] = releaseId;
			for (const plugin of release.plugins) plugins.push({
				id: plugin.id,
				...releasePluginSpec(plugin),
				visibility: plugin.visibility,
				releaseId,
				releaseVersion: release.version,
				profiles: [profile],
				...plugin.runtimeModules === void 0 ? {} : { runtimeModules: plugin.runtimeModules },
				target: { devices: [deviceId] }
			});
		}
		assignments[deviceId] = deviceAssignments;
	}
	return {
		schemaVersion: 2,
		team,
		devices,
		plugins,
		v2: {
			profileReleases,
			assignments
		}
	};
}
function parseFleetManifest(source) {
	const raw = parse(source);
	if (!isRecord$7(raw)) throw new TypeError("fleet manifest must be an object");
	if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) throw new TypeError("schemaVersion must equal 1 or 2");
	if (!isRecord$7(raw.team)) throw new TypeError("team must be an object");
	if (raw.schemaVersion === 2) exactKeys$4(raw.team, ["id", "name"], "team");
	const teamId = nonEmpty$1(raw.team.id, "team.id");
	const teamName = raw.team.name === void 0 ? void 0 : nonEmpty$1(raw.team.name, "team.name");
	if (!isRecord$7(raw.devices)) throw new TypeError("devices must be an object");
	const devices = {};
	for (const [id, value] of Object.entries(raw.devices)) {
		const deviceId = normalizeDeviceId(id, "device id");
		if (raw.schemaVersion === 2 && isRecord$7(value)) exactKeys$4(value, [
			"assignedTo",
			"class",
			"channel",
			"labels"
		], "devices." + deviceId);
		devices[deviceId] = parseDevice(value, "devices." + deviceId);
	}
	const team = {
		id: teamId,
		...teamName === void 0 ? {} : { name: teamName }
	};
	if (raw.schemaVersion === 2) return parseManifestV2(raw, team, devices);
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
		team,
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
		const actualArtifactDigest = input.artifactDigests?.[plugin.id];
		const runtimeModules = plugin.runtimeModules ?? [plugin.id];
		const runtimePhase = strongestPhase(input.runtime, runtimeModules);
		let state;
		if (actualSpec === void 0) state = "missing";
		else if (plugin.artifactDigest !== void 0 && actualArtifactDigest !== plugin.artifactDigest) state = "spec-drift";
		else if (plugin.artifactDigest === void 0 && actualSpec !== plugin.spec) state = "spec-drift";
		else if (runtimePhase === "failed") state = "runtime-failed";
		else if (runtimePhase !== "active") state = "runtime-inactive";
		else state = "aligned";
		return {
			id: plugin.id,
			desiredSpec: plugin.spec,
			...plugin.visibility === void 0 ? {} : { visibility: plugin.visibility },
			...plugin.releaseId === void 0 ? {} : { releaseId: plugin.releaseId },
			...plugin.releaseVersion === void 0 ? {} : { releaseVersion: plugin.releaseVersion },
			...plugin.artifactDigest === void 0 ? {} : { desiredArtifactDigest: plugin.artifactDigest },
			...actualArtifactDigest === void 0 ? {} : { actualArtifactDigest },
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
	const localPath = spec.startsWith("file:") ? spec.slice(5) : spec;
	if (/\.tgz$/i.test(localPath) && (spec.startsWith("file:") || localPath.startsWith("/") || localPath.startsWith("./") || localPath.startsWith("../") || /^[A-Za-z]:[\\/]/.test(localPath))) return { source: "artifact" };
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
	if (descriptor.source === "local" || descriptor.source === "artifact") return {
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
function isRecord$6(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmpty(value, field) {
	if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(field + " must be a non-empty string");
	return value.trim();
}
function absolutePath(value, field) {
	const path = nonEmpty(value, field);
	if (!isAbsolute(path) || normalize(path) !== path || path.includes("\0")) throw new TypeError(field + " must be a normalized absolute path");
	return path;
}
function boundedInt(value, field, fallback, min, max) {
	if (value === void 0) return fallback;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${field} must be an integer from ${min} to ${max}`);
	return value;
}
function exactKeys$3(value, allowed, field) {
	const extra = Object.keys(value).filter((key) => !allowed.includes(key));
	if (extra.length > 0) throw new TypeError(field + " contains unsupported fields: " + extra.sort().join(", "));
}
function parseRestart(value) {
	if (!isRecord$6(value)) throw new TypeError("restart must be an object");
	const kind = nonEmpty(value.kind, "restart.kind");
	if (kind === "none") {
		exactKeys$3(value, ["kind"], "restart");
		return { kind: "none" };
	}
	if (kind !== "screen" && kind !== "launchd") throw new TypeError("restart.kind must be none, screen or launchd");
	exactKeys$3(value, kind === "screen" ? [
		"kind",
		"screenBinary",
		"lsofBinary",
		"psBinary",
		"ownerMarkers",
		"sessionName",
		"host",
		"port",
		"managedPorts"
	] : [
		"kind",
		"launchctlBinary",
		"lsofBinary",
		"psBinary",
		"ownerMarkers",
		"serviceTarget",
		"host",
		"port",
		"managedPorts"
	], "restart");
	const host = nonEmpty(value.host, "restart.host");
	if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") throw new TypeError("restart.host must be loopback");
	if (!Array.isArray(value.ownerMarkers) || value.ownerMarkers.length === 0 || value.ownerMarkers.length > 8 || value.ownerMarkers.some((marker) => typeof marker !== "string" || marker.trim() !== marker || marker.length === 0 || marker.length > 240 || /[\r\n\0]/.test(marker))) throw new TypeError("restart.ownerMarkers must contain 1 to 8 fixed command fragments");
	const port = boundedInt(value.port, "restart.port", 0, 1024, 65535);
	const rawManagedPorts = value.managedPorts ?? [port];
	if (!Array.isArray(rawManagedPorts) || rawManagedPorts.length === 0 || rawManagedPorts.length > 16 || rawManagedPorts.some((item) => typeof item !== "number" || !Number.isSafeInteger(item) || item < 1024 || item > 65535) || new Set(rawManagedPorts).size !== rawManagedPorts.length || !rawManagedPorts.includes(port)) throw new TypeError("restart.managedPorts must be 1 to 16 unique ports including restart.port");
	const common = {
		lsofBinary: absolutePath(value.lsofBinary, "restart.lsofBinary"),
		psBinary: absolutePath(value.psBinary, "restart.psBinary"),
		ownerMarkers: value.ownerMarkers,
		host,
		port,
		managedPorts: rawManagedPorts
	};
	if (kind === "screen") {
		const sessionName = nonEmpty(value.sessionName, "restart.sessionName");
		if (!/^[A-Za-z0-9._-]+$/.test(sessionName)) throw new TypeError("restart.sessionName contains unsupported characters");
		return {
			kind: "screen",
			screenBinary: absolutePath(value.screenBinary, "restart.screenBinary"),
			sessionName,
			...common
		};
	}
	const serviceTarget = nonEmpty(value.serviceTarget, "restart.serviceTarget");
	if (!/^(?:gui|user)\/[1-9][0-9]*\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(serviceTarget)) throw new TypeError("restart.serviceTarget must be a fixed gui/UID/label or user/UID/label target");
	return {
		kind: "launchd",
		launchctlBinary: absolutePath(value.launchctlBinary, "restart.launchctlBinary"),
		serviceTarget,
		...common
	};
}
function parseHealth(value) {
	if (value === void 0) return {
		timeoutMs: 45e3,
		requireFleetRpc: false
	};
	if (!isRecord$6(value)) throw new TypeError("health must be an object");
	exactKeys$3(value, [
		"url",
		"timeoutMs",
		"requireFleetRpc"
	], "health");
	let url;
	if (value.url !== void 0) {
		url = nonEmpty(value.url, "health.url");
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
function safeIdentifier(value, field) {
	const id = nonEmpty(value, field);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new TypeError(field + " contains unsupported characters");
	return id;
}
function parseA2A(value) {
	if (value === void 0) return void 0;
	if (!isRecord$6(value)) throw new TypeError("a2a must be an object");
	exactKeys$3(value, [
		"teamId",
		"principalId",
		"privateKeyPath",
		"trustStorePath",
		"maxMessageTtlMs"
	], "a2a");
	return {
		teamId: safeIdentifier(value.teamId, "a2a.teamId"),
		principalId: safeIdentifier(value.principalId, "a2a.principalId"),
		privateKeyPath: absolutePath(value.privateKeyPath, "a2a.privateKeyPath"),
		trustStorePath: absolutePath(value.trustStorePath, "a2a.trustStorePath"),
		maxMessageTtlMs: boundedInt(value.maxMessageTtlMs, "a2a.maxMessageTtlMs", 9e5, 6e4, 864e5)
	};
}
function parseTasks(value) {
	if (value === void 0) return void 0;
	if (!isRecord$6(value)) throw new TypeError("tasks must be an object");
	exactKeys$3(value, [
		"enabled",
		"workspaces",
		"profiles",
		"timeoutMs",
		"maxOutputBytes",
		"maxConcurrent"
	], "tasks");
	if (typeof value.enabled !== "boolean") throw new TypeError("tasks.enabled must be boolean");
	if (!isRecord$6(value.workspaces)) throw new TypeError("tasks.workspaces must be an object");
	const workspaces = {};
	for (const [rawId, path] of Object.entries(value.workspaces)) {
		const id = safeIdentifier(rawId, "tasks workspace id");
		workspaces[id] = absolutePath(path, "tasks.workspaces." + id);
	}
	if (value.enabled && Object.keys(workspaces).length === 0) throw new TypeError("enabled tasks require at least one workspace");
	if (!Array.isArray(value.profiles) || value.profiles.length === 0 || value.profiles.length > 16 || value.profiles.some((profile) => typeof profile !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)) || new Set(value.profiles).size !== value.profiles.length) throw new TypeError("tasks.profiles must contain 1 to 16 unique safe profile ids");
	return {
		enabled: value.enabled,
		workspaces,
		profiles: value.profiles,
		timeoutMs: boundedInt(value.timeoutMs, "tasks.timeoutMs", 36e5, 6e4, 216e5),
		maxOutputBytes: boundedInt(value.maxOutputBytes, "tasks.maxOutputBytes", 1048576, 4096, 1048576),
		maxConcurrent: boundedInt(value.maxConcurrent, "tasks.maxConcurrent", 1, 1, 4)
	};
}
function parseAgentConfig(value) {
	if (!isRecord$6(value)) throw new TypeError("agent config must be an object");
	exactKeys$3(value, [
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
		"health",
		"artifactStore",
		"tarBinary",
		"a2a",
		"tasks"
	], "agent config");
	if (value.schemaVersion !== 1 && value.schemaVersion !== 2) throw new TypeError("agent config schemaVersion must equal 1 or 2");
	const profile = nonEmpty(value.profile, "profile");
	if (!/^[A-Za-z0-9._-]+$/.test(profile)) throw new TypeError("profile contains unsupported characters");
	const artifactStore = value.artifactStore === void 0 ? void 0 : absolutePath(value.artifactStore, "artifactStore");
	const tarBinary = value.tarBinary === void 0 ? void 0 : absolutePath(value.tarBinary, "tarBinary");
	if (value.schemaVersion === 2 && (artifactStore === void 0 || tarBinary === void 0)) throw new TypeError("schemaVersion 2 requires artifactStore and tarBinary");
	const a2a = parseA2A(value.a2a);
	const tasks = parseTasks(value.tasks);
	if (tasks?.enabled === true && a2a === void 0) throw new TypeError("enabled tasks require a2a identity and trust configuration");
	return {
		schemaVersion: value.schemaVersion,
		deviceId: normalizeDeviceId(value.deviceId),
		manifestPath: absolutePath(value.manifestPath, "manifestPath"),
		dshHome: absolutePath(value.dshHome, "dshHome"),
		dshBinary: absolutePath(value.dshBinary, "dshBinary"),
		pnpmBinary: absolutePath(value.pnpmBinary, "pnpmBinary"),
		profile,
		stateDir: absolutePath(value.stateDir, "stateDir"),
		planTtlMs: boundedInt(value.planTtlMs, "planTtlMs", 6e5, 6e4, 36e5),
		restart: parseRestart(value.restart),
		health: parseHealth(value.health),
		...artifactStore === void 0 ? {} : { artifactStore },
		...tarBinary === void 0 ? {} : { tarBinary },
		...a2a === void 0 ? {} : { a2a },
		...tasks === void 0 ? {} : { tasks }
	};
}
function assertReleaseReadyConfig(config) {
	assertMutationReadyConfig(config);
	if (config.schemaVersion !== 2 || config.artifactStore === void 0 || config.tarBinary === void 0) throw mutationConfigError("atomic profile releases require schemaVersion 2 with artifactStore and tarBinary");
}
function assertA2AReadyConfig(config) {
	if (config.schemaVersion !== 2 || config.a2a === void 0 || config.tasks === void 0) throw mutationConfigError("A2A requires schemaVersion 2 with identity, trust and task policy");
}
function mutationConfigError(message) {
	return Object.assign(new TypeError(message), { code: "unsafe-mutation-config" });
}
function assertMutationReadyConfig(config) {
	if (config.restart.kind === "none") throw mutationConfigError("mutation requires a configured DSH restart");
	if (config.health.url === void 0 || config.health.requireFleetRpc !== true) throw mutationConfigError("mutation requires a loopback health URL with Fleet RPC verification");
	let health;
	try {
		health = new URL(config.health.url);
	} catch {
		throw mutationConfigError("mutation health URL is invalid");
	}
	if (health.protocol !== "http:" || health.hostname !== "127.0.0.1" && health.hostname !== "localhost" && health.hostname !== "[::1]" || health.username !== "" || health.password !== "") throw mutationConfigError("mutation health URL must be credential-free loopback HTTP");
	if ((health.port === "" ? 80 : Number(health.port)) !== config.restart.port) throw mutationConfigError("mutation health URL must verify the configured restart port");
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
const PLAN_BODY_KEYS$1 = [
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
const PLAN_KEYS$1 = [
	...PLAN_BODY_KEYS$1,
	"planId",
	"digest"
];
const APPROVAL_KEYS$1 = [
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
function isRecord$5(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertExactKeys$1(value, keys, label) {
	if (!isRecord$5(value)) throw new FleetProtocolError("invalid-payload", label + " must be an object");
	const expected = new Set(keys);
	for (const key of Object.keys(value)) if (!expected.has(key)) throw new FleetProtocolError("invalid-payload", label + " contains unsupported field " + JSON.stringify(key));
	for (const key of keys) if (!Object.hasOwn(value, key)) throw new FleetProtocolError("invalid-payload", label + " is missing field " + JSON.stringify(key));
}
function assertNonEmpty(value, field) {
	if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) throw new FleetProtocolError("invalid-payload", field + " must be a trimmed non-empty string");
}
function assertDigest$1(value, field) {
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
function validatePlanBody$1(value) {
	assertExactKeys$1(value, PLAN_BODY_KEYS$1, "plan body");
	if (value.protocolVersion !== 1) throw new FleetProtocolError("invalid-protocol", "unsupported fleet agent protocol version");
	assertNonEmpty(value.deviceId, "deviceId");
	assertNonEmpty(value.profile, "profile");
	assertDigest$1(value.manifestDigest, "manifestDigest");
	assertDigest$1(value.profileHash, "profileHash");
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
	if (isRecord$5(value)) {
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
	validatePlanBody$1(body);
	const digest = sha256Canonical(body);
	return Object.freeze({
		...body,
		planId: "plan:" + digest,
		digest
	});
}
function validateFleetPlan(value) {
	assertExactKeys$1(value, PLAN_KEYS$1, "plan");
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
	validatePlanBody$1(body);
	assertDigest$1(value.digest, "digest");
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
	assertExactKeys$1(approval, APPROVAL_KEYS$1, "approval");
	if (approval.protocolVersion !== 1) throw new FleetProtocolError("invalid-protocol", "unsupported approval protocol version");
	assertNonEmpty(approval.approvalId, "approvalId");
	assertNonEmpty(approval.principalId, "approval.principalId");
	assertNonEmpty(approval.planId, "approval.planId");
	assertDigest$1(approval.planDigest, "approval.planDigest");
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
const PLUGIN_KEYS$1 = [
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
function isRecord$4(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function rejectUnknownKeys(value, keys, label) {
	if (!isRecord$4(value)) throw new FleetPlannerError("invalid-input", label + " must be an object");
	const allowed = new Set(keys);
	for (const key of Object.keys(value)) if (!allowed.has(key)) throw new FleetPlannerError("invalid-input", label + " contains unsupported field " + JSON.stringify(key));
}
function trimmed$1(value, field) {
	if (typeof value !== "string" || value.trim().length === 0) throw new FleetPlannerError("invalid-input", field + " must be a non-empty string");
	return value.trim();
}
function canonicalNow$1(value) {
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
	rejectUnknownKeys(plugin, PLUGIN_KEYS$1, "plugin");
	const spec = trimmed$1(plugin.spec, "plugin.spec");
	if (plugin.source === void 0) {
		const sourceKind = exactSourceKind(spec);
		if (sourceKind === null) throw new FleetPlannerError("unsupported-source", "stable plans require exact npm semver or github:owner/repo#40sha");
		return {
			sourceKind,
			exactToSpec: spec
		};
	}
	const source = trimmed$1(plugin.source, "plugin.source");
	if (source === "npm") {
		const revision = trimmed$1(plugin.revision, "plugin.revision");
		if (spec !== revision || exactSourceKind(revision) !== "npm") throw new FleetPlannerError("unsupported-source", "npm plans require one exact semver revision");
		return {
			sourceKind: "npm",
			exactToSpec: revision
		};
	}
	if (/^github:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(source)) {
		const revision = trimmed$1(plugin.revision, "plugin.revision");
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
	if (input.manifest.schemaVersion !== 1 || !Array.isArray(input.manifest.plugins) || !isRecord$4(input.manifest.devices)) throw new FleetPlannerError("invalid-input", "planner requires a parsed schemaVersion 1 manifest");
	if (!isRecord$4(input.dependencies)) throw new FleetPlannerError("invalid-input", "dependencies must be an object");
	const deviceId = trimmed$1(input.deviceId, "deviceId");
	const profile = trimmed$1(input.profile, "profile");
	const pluginId = trimmed$1(input.pluginId, "pluginId");
	if (!isSafeNpmPackageName(pluginId)) throw new FleetPlannerError("invalid-input", "pluginId must be one literal lowercase npm package name");
	const observedDshVersion = trimmed$1(input.observedDshVersion, "observedDshVersion");
	if (!isSupportedDshVersion(observedDshVersion)) throw new FleetPlannerError("unsupported-dsh-version", "DSH version is outside the supported agent range");
	const device = input.manifest.devices[deviceId];
	if (device === void 0) throw new FleetPlannerError("unknown-device", "device is not registered in the manifest");
	rejectUnknownKeys(device, DEVICE_KEYS, "device");
	if (device.channel !== "stable") throw new FleetPlannerError("device-not-stable", "this planner slice only supports stable devices");
	const { sourceKind, exactToSpec } = desiredExactSource(selectedPlugin(input.manifest, pluginId, profile, deviceId, device));
	const actualSpec = input.dependencies[pluginId];
	if (actualSpec === exactToSpec) throw new FleetPlannerError("already-aligned", "plugin is already aligned; no plan is created");
	if (actualSpec !== void 0 && (typeof actualSpec !== "string" || actualSpec.trim().length === 0)) throw new FleetPlannerError("invalid-input", "installed dependency spec must be a non-empty string");
	const createdAt = canonicalNow$1(input.now);
	const planTtlMs = input.planTtlMs ?? 3e5;
	if (!Number.isSafeInteger(planTtlMs) || planTtlMs < 6e4 || planTtlMs > 36e5) throw new FleetPlannerError("invalid-input", "planTtlMs must be an integer from 60000 to 3600000");
	const expiresAt = new Date(Date.parse(createdAt) + planTtlMs).toISOString();
	try {
		return createFleetPlan({
			protocolVersion: 1,
			deviceId,
			profile,
			manifestDigest: trimmed$1(input.manifestDigest, "manifestDigest").toLowerCase(),
			profileHash: trimmed$1(input.profileHash, "profileHash").toLowerCase(),
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
const PLAN_BODY_KEYS = [
	"protocolVersion",
	"kind",
	"deviceId",
	"profile",
	"manifestDigest",
	"profileHash",
	"observedDshVersion",
	"releaseId",
	"releaseVersion",
	"releaseDigest",
	"plugins",
	"changes",
	"restartRequired",
	"createdAt",
	"expiresAt"
];
const PLAN_KEYS = [
	...PLAN_BODY_KEYS,
	"planId",
	"digest"
];
const PLUGIN_KEYS = [
	"pluginId",
	"visibility",
	"sourceKind",
	"exactSpec",
	"artifactDigest",
	"packageVersion",
	"integrity",
	"runtimeModules"
];
const CHANGE_KEYS = [
	"pluginId",
	"visibility",
	"sourceKind",
	"action",
	"fromSpecDigest",
	"exactToSpec",
	"artifactDigest"
];
const APPROVAL_KEYS = [
	"protocolVersion",
	"kind",
	"approvalId",
	"principalId",
	"planId",
	"planDigest",
	"deviceId",
	"profile",
	"approvedAt",
	"expiresAt"
];
const APPLIED_KEYS = [
	"schemaVersion",
	"deviceId",
	"profile",
	"releaseId",
	"releaseVersion",
	"releaseDigest",
	"plugins",
	"appliedAt"
];
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertExactKeys(value, keys, label) {
	if (!isRecord$3(value)) throw new FleetProtocolError("invalid-payload", label + " must be an object");
	const expected = new Set(keys);
	for (const key of Object.keys(value)) if (!expected.has(key)) throw new FleetProtocolError("invalid-payload", label + " contains unsupported field " + JSON.stringify(key));
	for (const key of keys) if (!Object.hasOwn(value, key)) throw new FleetProtocolError("invalid-payload", label + " is missing field " + JSON.stringify(key));
}
function assertString(value, field) {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim()) throw new FleetProtocolError("invalid-payload", field + " must be a trimmed non-empty string");
}
function assertIdentifier(value, field) {
	assertString(value, field);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new FleetProtocolError("invalid-payload", field + " contains unsupported characters");
}
function assertDigest(value, field) {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new FleetProtocolError("invalid-digest", field + " must be a lowercase SHA-256 digest");
}
function parseTime(value, field) {
	if (typeof value !== "string") throw new FleetProtocolError("invalid-time", field + " must be a canonical ISO timestamp");
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) throw new FleetProtocolError("invalid-time", field + " must be a canonical ISO timestamp");
	return timestamp;
}
function assertVisibility(value, field) {
	if (value !== "public" && value !== "private") throw new FleetProtocolError("invalid-payload", field + " must be public or private");
}
function assertSourceKind(value, field) {
	if (value !== "npm" && value !== "github" && value !== "artifact") throw new FleetProtocolError("unsupported-source", field + " must be npm, github or artifact");
}
function validateExactSource(sourceKind, exactSpec, artifactDigest, visibility) {
	if (sourceKind === "npm") {
		if (visibility !== "public" || valid(exactSpec) !== exactSpec || artifactDigest !== null) throw new FleetProtocolError("unsupported-source", "npm bindings require a public exact semantic version");
		return;
	}
	if (sourceKind === "github") {
		if (visibility !== "public" || !/^github:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?#[0-9a-f]{40}$/.test(exactSpec) || artifactDigest !== null) throw new FleetProtocolError("unsupported-source", "GitHub bindings require a public repository and exact lowercase commit SHA");
		return;
	}
	if (visibility !== "private" || artifactDigest === null) throw new FleetProtocolError("unsupported-source", "artifact bindings must be private and content addressed");
	assertDigest(artifactDigest, "artifactDigest");
	if (exactSpec !== "artifact:sha256:" + artifactDigest) throw new FleetProtocolError("unsupported-source", "artifact exactSpec must bind its SHA-256 digest");
}
function validatePlugin(value, index) {
	const field = `plugins[${index}]`;
	assertExactKeys(value, PLUGIN_KEYS, field);
	assertString(value.pluginId, field + ".pluginId");
	if (!isSafeNpmPackageName(value.pluginId)) throw new FleetProtocolError("invalid-payload", field + ".pluginId is invalid");
	assertVisibility(value.visibility, field + ".visibility");
	assertSourceKind(value.sourceKind, field + ".sourceKind");
	assertString(value.exactSpec, field + ".exactSpec");
	if (value.artifactDigest !== null) assertDigest(value.artifactDigest, field + ".artifactDigest");
	if (value.packageVersion !== null && valid(value.packageVersion) !== value.packageVersion) throw new FleetProtocolError("invalid-payload", field + ".packageVersion must be an exact semantic version or null");
	if (value.integrity !== null && !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value.integrity)) throw new FleetProtocolError("invalid-payload", field + ".integrity must be one SHA-512 SRI value or null");
	if (!Array.isArray(value.runtimeModules) || value.runtimeModules.length === 0 || value.runtimeModules.some((module) => typeof module !== "string" || module.length === 0 || module !== module.trim())) throw new FleetProtocolError("invalid-payload", field + ".runtimeModules must contain trimmed non-empty strings");
	validateExactSource(value.sourceKind, value.exactSpec, value.artifactDigest, value.visibility);
	if (value.sourceKind === "npm" && (value.packageVersion !== value.exactSpec || value.integrity === null)) throw new FleetProtocolError("unsupported-source", "npm release bindings require version and integrity locks");
	if (value.sourceKind === "github" && (value.packageVersion !== null || value.integrity !== null)) throw new FleetProtocolError("unsupported-source", "GitHub release bindings do not accept packageVersion or integrity");
	if (value.sourceKind === "artifact" && (value.packageVersion === null || value.integrity !== null)) throw new FleetProtocolError("unsupported-source", "artifact release bindings require packageVersion and use digest instead of SRI");
}
function validateChange(value, index) {
	const field = `changes[${index}]`;
	assertExactKeys(value, CHANGE_KEYS, field);
	assertString(value.pluginId, field + ".pluginId");
	if (!isSafeNpmPackageName(value.pluginId)) throw new FleetProtocolError("invalid-payload", field + ".pluginId is invalid");
	assertVisibility(value.visibility, field + ".visibility");
	assertSourceKind(value.sourceKind, field + ".sourceKind");
	if (value.action !== "install" && value.action !== "update" && value.action !== "remove") throw new FleetProtocolError("invalid-action", field + ".action must be install, update or remove");
	if (value.action === "install" ? value.fromSpecDigest !== null : value.fromSpecDigest === null) throw new FleetProtocolError("invalid-action", field + ".fromSpecDigest does not match its action");
	if (value.fromSpecDigest !== null) assertDigest(value.fromSpecDigest, field + ".fromSpecDigest");
	if (value.action === "remove") {
		if (value.exactToSpec !== null || value.artifactDigest !== null) throw new FleetProtocolError("invalid-action", "remove changes must not contain a target spec or artifact digest");
	} else {
		assertString(value.exactToSpec, field + ".exactToSpec");
		if (value.artifactDigest !== null) assertDigest(value.artifactDigest, field + ".artifactDigest");
		validateExactSource(value.sourceKind, value.exactToSpec, value.artifactDigest, value.visibility);
	}
}
function validatePlanBody(value) {
	assertExactKeys(value, PLAN_BODY_KEYS, "release plan body");
	if (value.protocolVersion !== 1 || value.kind !== "profile-release") throw new FleetProtocolError("invalid-protocol", "unsupported release protocol");
	assertIdentifier(value.deviceId, "deviceId");
	assertIdentifier(value.profile, "profile");
	assertDigest(value.manifestDigest, "manifestDigest");
	assertDigest(value.profileHash, "profileHash");
	assertString(value.observedDshVersion, "observedDshVersion");
	if (!isSupportedDshVersion(value.observedDshVersion)) throw new FleetProtocolError("unsupported-dsh-version", "DSH version is outside the supported Agent range");
	assertIdentifier(value.releaseId, "releaseId");
	assertString(value.releaseVersion, "releaseVersion");
	if (valid(value.releaseVersion) !== value.releaseVersion) throw new FleetProtocolError("invalid-payload", "releaseVersion must be an exact semantic version");
	assertDigest(value.releaseDigest, "releaseDigest");
	if (!Array.isArray(value.plugins) || value.plugins.length === 0) throw new FleetProtocolError("invalid-payload", "plugins must not be empty");
	value.plugins.forEach(validatePlugin);
	if (!Array.isArray(value.changes)) throw new FleetProtocolError("invalid-payload", "changes must be an array");
	value.changes.forEach(validateChange);
	const pluginIds = value.plugins.map((plugin) => plugin.pluginId);
	const changeIds = value.changes.map((change) => change.pluginId);
	if (new Set(pluginIds).size !== pluginIds.length || new Set(changeIds).size !== changeIds.length) throw new FleetProtocolError("invalid-payload", "plugin and change ids must be unique");
	if (pluginIds.some((id, index) => index > 0 && id <= pluginIds[index - 1]) || changeIds.some((id, index) => index > 0 && id <= changeIds[index - 1])) throw new FleetProtocolError("invalid-payload", "plugins and changes must be sorted by pluginId");
	const finalIds = new Set(pluginIds);
	for (const change of value.changes) if (change.action === "remove" ? finalIds.has(change.pluginId) : !finalIds.has(change.pluginId)) throw new FleetProtocolError("invalid-action", "change set does not match the final plugin set");
	if (value.restartRequired !== value.changes.length > 0) throw new FleetProtocolError("invalid-payload", "restartRequired must reflect whether the release changes the profile");
	const expectedReleaseDigest = sha256Canonical({
		releaseId: value.releaseId,
		releaseVersion: value.releaseVersion,
		profile: value.profile,
		plugins: value.plugins
	});
	if (value.releaseDigest !== expectedReleaseDigest) throw new FleetProtocolError("plan-integrity-failed", "releaseDigest does not match the final release");
	const createdAt = parseTime(value.createdAt, "createdAt");
	if (parseTime(value.expiresAt, "expiresAt") <= createdAt) throw new FleetProtocolError("invalid-time", "expiresAt must be after createdAt");
}
function createFleetReleasePlan(body) {
	validatePlanBody(body);
	const digest = sha256Canonical(body);
	return Object.freeze({
		...body,
		planId: "release-plan:" + digest,
		digest
	});
}
function validateFleetReleasePlan(value) {
	assertExactKeys(value, PLAN_KEYS, "release plan");
	const body = Object.fromEntries(PLAN_BODY_KEYS.map((key) => [key, value[key]]));
	validatePlanBody(body);
	assertDigest(value.digest, "digest");
	const digest = sha256Canonical(body);
	if (value.digest !== digest || value.planId !== "release-plan:" + digest) throw new FleetProtocolError("plan-integrity-failed", "release plan id or digest does not match its canonical body");
}
function validateFleetReleaseApproval(plan, approval, now) {
	validateFleetReleasePlan(plan);
	assertExactKeys(approval, APPROVAL_KEYS, "release approval");
	if (approval.protocolVersion !== 1 || approval.kind !== "profile-release") throw new FleetProtocolError("invalid-protocol", "unsupported release approval protocol");
	for (const [field, value] of Object.entries({
		approvalId: approval.approvalId,
		principalId: approval.principalId,
		planId: approval.planId,
		deviceId: approval.deviceId,
		profile: approval.profile
	})) assertString(value, field);
	assertDigest(approval.planDigest, "planDigest");
	const approvedAt = parseTime(approval.approvedAt, "approvedAt");
	const expiresAt = parseTime(approval.expiresAt, "approval.expiresAt");
	const nowAt = now instanceof Date ? now.getTime() : parseTime(now, "now");
	if (!Number.isFinite(nowAt)) throw new FleetProtocolError("invalid-time", "now is invalid");
	if (expiresAt <= approvedAt || approvedAt < Date.parse(plan.createdAt) || approvedAt >= Date.parse(plan.expiresAt)) throw new FleetProtocolError("approval-mismatch", "approval time is outside the release plan validity window");
	if (nowAt >= Date.parse(plan.expiresAt)) throw new FleetProtocolError("plan-expired", "release plan has expired");
	if (nowAt >= expiresAt) throw new FleetProtocolError("approval-expired", "release approval has expired");
	if (approval.planId !== plan.planId || approval.planDigest !== plan.digest || approval.deviceId !== plan.deviceId || approval.profile !== plan.profile) throw new FleetProtocolError("approval-mismatch", "release approval does not match its plan");
	return { idempotencyKey: sha256Canonical({
		planDigest: plan.digest,
		approval: JSON.parse(canonicalJson(approval))
	}) };
}
function validateFleetAppliedRelease(value) {
	assertExactKeys(value, APPLIED_KEYS, "applied release");
	if (value.schemaVersion !== 1) throw new FleetProtocolError("invalid-protocol", "unsupported applied release schema");
	assertIdentifier(value.deviceId, "deviceId");
	assertIdentifier(value.profile, "profile");
	assertIdentifier(value.releaseId, "releaseId");
	assertString(value.releaseVersion, "releaseVersion");
	if (valid(value.releaseVersion) !== value.releaseVersion) throw new FleetProtocolError("invalid-payload", "releaseVersion must be exact");
	assertDigest(value.releaseDigest, "releaseDigest");
	if (!Array.isArray(value.plugins) || value.plugins.length === 0) throw new FleetProtocolError("invalid-payload", "plugins must not be empty");
	value.plugins.forEach(validatePlugin);
	const ids = value.plugins.map((plugin) => plugin.pluginId);
	if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && id <= ids[index - 1])) throw new FleetProtocolError("invalid-payload", "applied release plugins must be unique and sorted");
	parseTime(value.appliedAt, "appliedAt");
	if (sha256Canonical({
		releaseId: value.releaseId,
		releaseVersion: value.releaseVersion,
		profile: value.profile,
		plugins: value.plugins
	}) !== value.releaseDigest) throw new FleetProtocolError("plan-integrity-failed", "applied release digest is invalid");
}
var FleetReleasePlannerError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "FleetReleasePlannerError";
		this.code = code;
	}
};
function trimmed(value, field) {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim()) throw new FleetReleasePlannerError("invalid-input", field + " must be a trimmed non-empty string");
	return value;
}
function digest$1(value) {
	return createHash("sha256").update(value, "utf8").digest("hex");
}
function binding(plugin) {
	const runtimeModules = [...plugin.runtimeModules ?? [plugin.id]].sort();
	if (plugin.source.kind === "npm") {
		if (plugin.source.integrity === void 0) throw new FleetReleasePlannerError("invalid-input", "atomic npm releases require a SHA-512 integrity lock for " + plugin.id);
		return {
			pluginId: plugin.id,
			visibility: plugin.visibility,
			sourceKind: "npm",
			exactSpec: plugin.source.version,
			artifactDigest: null,
			packageVersion: plugin.source.version,
			integrity: plugin.source.integrity,
			runtimeModules
		};
	}
	if (plugin.source.kind === "github") return {
		pluginId: plugin.id,
		visibility: plugin.visibility,
		sourceKind: "github",
		exactSpec: "github:" + plugin.source.repository + "#" + plugin.source.revision,
		artifactDigest: null,
		packageVersion: null,
		integrity: null,
		runtimeModules
	};
	return {
		pluginId: plugin.id,
		visibility: plugin.visibility,
		sourceKind: "artifact",
		exactSpec: "artifact:sha256:" + plugin.source.digest,
		artifactDigest: plugin.source.digest,
		packageVersion: plugin.source.version,
		integrity: null,
		runtimeModules
	};
}
function assignedRelease(input) {
	if (input.manifest.schemaVersion !== 2 || input.manifest.v2 === void 0) throw new FleetReleasePlannerError("invalid-input", "atomic release planning requires a parsed schemaVersion 2 manifest");
	const device = input.manifest.devices[input.deviceId];
	if (device === void 0) throw new FleetReleasePlannerError("unknown-device", "device is not registered in the manifest");
	if (device.channel !== "stable") throw new FleetReleasePlannerError("device-not-stable", "atomic release planning is enabled only for stable devices");
	const releaseId = input.manifest.v2.assignments[input.deviceId]?.[input.profile];
	if (releaseId === void 0) throw new FleetReleasePlannerError("release-not-assigned", "no profile release is assigned to this device and profile");
	const release = input.manifest.v2.profileReleases[releaseId];
	if (release === void 0 || release.profile !== input.profile) throw new FleetReleasePlannerError("invalid-input", "assigned release is missing or targets a different profile");
	return release;
}
function currentMatches(binding, actualSpec, artifactDigests) {
	if (actualSpec === void 0) return false;
	return binding.sourceKind === "artifact" ? artifactDigests[binding.pluginId] === binding.artifactDigest : actualSpec === binding.exactSpec;
}
function buildChanges(plugins, dependencies, artifactDigests, previous) {
	const finalIds = new Set(plugins.map((plugin) => plugin.pluginId));
	const changes = [];
	for (const plugin of plugins) {
		const actualSpec = dependencies[plugin.pluginId];
		if (currentMatches(plugin, actualSpec, artifactDigests)) continue;
		changes.push({
			pluginId: plugin.pluginId,
			visibility: plugin.visibility,
			sourceKind: plugin.sourceKind,
			action: actualSpec === void 0 ? "install" : "update",
			fromSpecDigest: actualSpec === void 0 ? null : digest$1(actualSpec),
			exactToSpec: plugin.exactSpec,
			artifactDigest: plugin.artifactDigest
		});
	}
	for (const plugin of previous?.plugins ?? []) {
		if (finalIds.has(plugin.pluginId)) continue;
		const actualSpec = dependencies[plugin.pluginId];
		if (actualSpec === void 0) continue;
		changes.push({
			pluginId: plugin.pluginId,
			visibility: plugin.visibility,
			sourceKind: plugin.sourceKind,
			action: "remove",
			fromSpecDigest: digest$1(actualSpec),
			exactToSpec: null,
			artifactDigest: null
		});
	}
	return changes.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
}
function canonicalNow(value) {
	const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
	if (!Number.isFinite(date.getTime())) throw new FleetReleasePlannerError("invalid-input", "now must be a valid timestamp");
	return date.toISOString();
}
function createReleasePlan(input) {
	const deviceId = trimmed(input.deviceId, "deviceId");
	const profile = trimmed(input.profile, "profile");
	if (deviceId !== input.deviceId || profile !== input.profile) throw new FleetReleasePlannerError("invalid-input", "identity fields must be canonical");
	const observedDshVersion = trimmed(input.observedDshVersion, "observedDshVersion");
	if (!isSupportedDshVersion(observedDshVersion)) throw new FleetReleasePlannerError("unsupported-dsh-version", "DSH version is outside the supported Agent range");
	const release = assignedRelease(input);
	if (!satisfies(observedDshVersion, release.dshRange, { includePrerelease: true })) throw new FleetReleasePlannerError("release-incompatible", "assigned release does not support the observed DSH version");
	const plugins = release.plugins.map(binding).sort((a, b) => a.pluginId.localeCompare(b.pluginId));
	const changes = buildChanges(plugins, input.dependencies, input.artifactDigests ?? {}, input.appliedRelease);
	const createdAt = canonicalNow(input.now);
	const planTtlMs = input.planTtlMs ?? 6e5;
	if (!Number.isSafeInteger(planTtlMs) || planTtlMs < 6e4 || planTtlMs > 36e5) throw new FleetReleasePlannerError("invalid-input", "planTtlMs must be an integer from 60000 to 3600000");
	const releaseDigest = sha256Canonical({
		releaseId: release.id,
		releaseVersion: release.version,
		profile,
		plugins
	});
	try {
		return createFleetReleasePlan({
			protocolVersion: 1,
			kind: "profile-release",
			deviceId,
			profile,
			manifestDigest: trimmed(input.manifestDigest, "manifestDigest").toLowerCase(),
			profileHash: trimmed(input.profileHash, "profileHash").toLowerCase(),
			observedDshVersion,
			releaseId: release.id,
			releaseVersion: release.version,
			releaseDigest,
			plugins,
			changes,
			restartRequired: changes.length > 0,
			createdAt,
			expiresAt: new Date(Date.parse(createdAt) + planTtlMs).toISOString()
		});
	} catch (error) {
		if (error instanceof FleetProtocolError) throw error;
		throw new FleetReleasePlannerError("invalid-input", error instanceof Error ? error.message : String(error));
	}
}
//#endregion
//#region src/host/artifacts.ts
function contained(root, candidate) {
	const path = relative(root, candidate);
	return path === "" || !path.startsWith(".." + sep) && path !== ".." && !isAbsolute(path);
}
function dependencyArtifactPath(profileDir, spec) {
	if (!spec.startsWith("file:")) return null;
	const encoded = spec.slice(5);
	if (encoded.length === 0 || encoded.startsWith("//") || /[?#\0]/.test(encoded)) return null;
	let decoded;
	try {
		decoded = decodeURIComponent(encoded);
	} catch {
		return null;
	}
	if (decoded.length === 0 || decoded.includes("\0")) return null;
	const candidate = isAbsolute(decoded) ? resolve(decoded) : resolve(profileDir, decoded);
	return candidate.endsWith(".tgz") ? candidate : null;
}
async function digestInstalledArtifact(profileDir, artifactStore, spec) {
	const candidate = dependencyArtifactPath(profileDir, spec);
	if (candidate === null) return void 0;
	try {
		const [storePath, candidatePath, originalInfo] = await Promise.all([
			realpath(artifactStore),
			realpath(candidate),
			lstat(candidate)
		]);
		if (originalInfo.isSymbolicLink() || !originalInfo.isFile() || !contained(storePath, candidatePath)) return void 0;
		const handle = await open(candidatePath, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const openedInfo = await handle.stat();
			if (!openedInfo.isFile() || openedInfo.dev !== originalInfo.dev || openedInfo.ino !== originalInfo.ino) return void 0;
			const hash = createHash("sha256");
			const buffer = Buffer.allocUnsafe(65536);
			let position = 0;
			for (;;) {
				const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
				if (bytesRead === 0) break;
				hash.update(buffer.subarray(0, bytesRead));
				position += bytesRead;
			}
			return hash.digest("hex");
		} finally {
			await handle.close();
		}
	} catch {
		return;
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
const MAX_OUTPUT_BYTES$1 = 1048576;
const TERMINATION_GRACE_MS = 2e3;
const TERMINATION_CONFIRM_MS = 5e3;
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
	const path = [.../* @__PURE__ */ new Set([
		dirname(config.pnpmBinary),
		dirname(config.dshBinary),
		dirname(process.execPath),
		"/opt/homebrew/bin",
		"/usr/bin",
		"/bin"
	])].join(":");
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
function abortError() {
	return new AgentRuntimeError("agent-shutdown", "fleet agent shutdown interrupted the controlled command");
}
function throwIfAborted(signal) {
	if (signal?.aborted === true) throw abortError();
}
function processGroupIsAlive(pid) {
	try {
		process.kill(-pid, 0);
		return true;
	} catch (error) {
		return error.code !== "ESRCH";
	}
}
async function waitUntil(predicate, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (predicate()) {
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return true;
}
function runFile(file, args, options = {}) {
	throwIfAborted(options.signal);
	return new Promise((resolve, reject) => {
		const grouped = process.platform !== "win32";
		const child = spawn(file, args, {
			stdio: options.ignoreOutput === true ? "ignore" : [
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
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let settled = false;
		let termination = null;
		let closeCode = null;
		let leaderClosed = false;
		let resolveLeaderClosed;
		const leaderClosedPromise = new Promise((resolve) => {
			resolveLeaderClosed = resolve;
		});
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
			options.signal?.removeEventListener("abort", onAbort);
			action();
		};
		const terminate = (reason) => {
			if (termination !== null || settled) return;
			termination = reason;
			clearTimeout(timer);
			(async () => {
				try {
					killTree("SIGTERM");
					const pid = child.pid;
					if (!(grouped && pid !== void 0 ? await waitUntil(() => processGroupIsAlive(pid), TERMINATION_GRACE_MS) : await waitUntil(() => !leaderClosed, TERMINATION_GRACE_MS))) {
						killTree("SIGKILL");
						if (!(grouped && pid !== void 0 ? await waitUntil(() => processGroupIsAlive(pid), TERMINATION_CONFIRM_MS) : await waitUntil(() => !leaderClosed, TERMINATION_CONFIRM_MS))) {
							finish(() => reject(new AgentRuntimeError("command-cleanup-failed", "controlled command process group could not be terminated")));
							return;
						}
					}
					if (!leaderClosed) await Promise.race([leaderClosedPromise, new Promise((resolve) => setTimeout(resolve, TERMINATION_CONFIRM_MS))]);
					if (!leaderClosed) {
						finish(() => reject(new AgentRuntimeError("command-cleanup-failed", "controlled command leader did not close after termination")));
						return;
					}
					finish(() => reject(reason));
				} catch {
					finish(() => reject(new AgentRuntimeError("command-cleanup-failed", "controlled command process group cleanup failed")));
				}
			})();
		};
		const onAbort = () => terminate(abortError());
		const timer = setTimeout(() => terminate(new AgentRuntimeError("command-timeout", "controlled command exceeded its timeout")), options.timeoutMs ?? 12e4);
		timer.unref();
		options.signal?.addEventListener("abort", onAbort, { once: true });
		if (options.signal?.aborted === true) onAbort();
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk) => {
			const bytes = Buffer.byteLength(chunk);
			if (stdoutBytes < MAX_OUTPUT_BYTES$1) stdout += Buffer.from(chunk).subarray(0, Math.max(0, MAX_OUTPUT_BYTES$1 - stdoutBytes)).toString("utf8");
			stdoutBytes += bytes;
			if (stdoutBytes > MAX_OUTPUT_BYTES$1) terminate(new AgentRuntimeError("command-output-limit", "controlled command exceeded its output limit"));
		});
		child.stderr?.on("data", (chunk) => {
			const bytes = Buffer.byteLength(chunk);
			if (stderrBytes < MAX_OUTPUT_BYTES$1) stderr += Buffer.from(chunk).subarray(0, Math.max(0, MAX_OUTPUT_BYTES$1 - stderrBytes)).toString("utf8");
			stderrBytes += bytes;
			if (stderrBytes > MAX_OUTPUT_BYTES$1) terminate(new AgentRuntimeError("command-output-limit", "controlled command exceeded its output limit"));
		});
		child.once("error", () => {
			leaderClosed = true;
			resolveLeaderClosed?.();
			if (termination === null) finish(() => reject(new AgentRuntimeError("command-unavailable", "required executable is unavailable")));
		});
		child.once("close", (code) => {
			leaderClosed = true;
			closeCode = code;
			resolveLeaderClosed?.();
			if (termination !== null) return;
			if (grouped && child.pid !== void 0 && processGroupIsAlive(child.pid)) {
				terminate(new AgentRuntimeError("command-descendant-leak", "controlled command exited with a live process-group descendant"));
				return;
			}
			const exitCode = closeCode ?? 1;
			if (exitCode !== 0 && options.allowFailure !== true) finish(() => reject(new AgentRuntimeError("command-failed", "controlled command failed")));
			else finish(() => resolve({
				stdout,
				stderr,
				code: exitCode
			}));
		});
	});
}
function sha256(value) {
	return createHash("sha256").update(value, "utf8").digest("hex");
}
async function readRegularFileSnapshot(path) {
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		const info = await handle.stat();
		if (info.isSymbolicLink() || !info.isFile()) throw new AgentRuntimeError("unsafe-profile-file", "profile state accepts regular files only");
		return {
			source: await handle.readFile("utf8"),
			dev: info.dev,
			ino: info.ino,
			mtimeMs: info.mtimeMs
		};
	} catch (error) {
		if (error.code === "ENOENT") return null;
		if (error.code === "ELOOP") throw new AgentRuntimeError("unsafe-profile-file", "profile state accepts regular files only");
		throw error;
	} finally {
		await handle?.close();
	}
}
async function readRegularOptional(path) {
	return (await readRegularFileSnapshot(path))?.source ?? null;
}
async function readProfileSnapshot(config) {
	const dir = profileDir(config);
	let directoryPresent = true;
	try {
		const info = await lstat(dir);
		if (info.isSymbolicLink() || !info.isDirectory()) throw new AgentRuntimeError("unsafe-profile-directory", "profile state accepts a regular directory only");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		directoryPresent = false;
	}
	const files = {};
	for (const name of SNAPSHOT_FILES) files[name] = await readRegularOptional(join(dir, name));
	return {
		directoryPresent,
		files,
		hash: sha256(JSON.stringify(files))
	};
}
async function computeProfileHash(config) {
	return (await readProfileSnapshot(config)).hash;
}
async function readDshVersion(config, signal) {
	const version = (await runFile(config.dshBinary, ["--version"], {
		env: controlledEnv(config),
		timeoutMs: 1e4,
		signal
	})).stdout.trim();
	if (version.length === 0) throw new AgentRuntimeError("dsh-version-unavailable", "DSH version is unavailable");
	return version;
}
async function loadState(config, signal) {
	throwIfAborted(signal);
	const manifestSource = await readFile(config.manifestPath, "utf8");
	const manifest = parseFleetManifest(manifestSource);
	const profile = await readProfileSnapshot(config);
	const profileSource = profile.files["package.json"];
	const parsed = profileSource === null ? {} : JSON.parse(profileSource);
	return {
		manifest,
		manifestDigest: sha256(manifestSource),
		dependencies: parsed.dependencies ?? {},
		profileHash: profile.hash,
		profileSnapshot: profile,
		dshVersion: await readDshVersion(config, signal)
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
async function atomicJson$1(path, value) {
	const directory = dirname(path);
	await ensureDurableDirectory(directory);
	const temporary = path + "." + randomUUID() + ".tmp";
	let handle;
	try {
		handle = await open(temporary, "wx", 384);
		await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
		await handle.sync();
		await handle.close();
		handle = void 0;
		await rename(temporary, path);
		await syncDirectory(directory);
	} catch (error) {
		await handle?.close();
		await rm(temporary, { force: true });
		throw error;
	}
}
async function readJson(path) {
	const source = await readRegularOptional(path);
	return source === null ? null : JSON.parse(source);
}
async function syncDirectory(path) {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}
async function ensureDurableDirectory(path) {
	await mkdir(path, {
		recursive: true,
		mode: 448
	});
	await syncDirectory(path);
	const parent = dirname(path);
	if (parent !== path) await syncDirectory(parent);
}
async function durableWriteFile(path, source) {
	const directory = dirname(path);
	await ensureDurableDirectory(directory);
	const handle = await open(path, "wx", 384);
	try {
		await handle.writeFile(source);
		await handle.sync();
	} finally {
		await handle.close();
	}
	await syncDirectory(directory);
}
async function audit(config, event) {
	await ensureDurableDirectory(config.stateDir);
	const handle = await open(join(config.stateDir, "audit.jsonl"), "a", 384);
	try {
		await handle.writeFile(JSON.stringify({
			eventId: randomUUID(),
			at: (/* @__PURE__ */ new Date()).toISOString(),
			deviceId: config.deviceId,
			...event
		}) + "\n");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await syncDirectory(config.stateDir);
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
	await ensureDurableDirectory(lockDir);
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
			await handle.sync();
		} finally {
			await handle.close();
		}
		await syncDirectory(lockDir);
		break;
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		let owner = null;
		let ageMs = 0;
		let ownerSource = null;
		let ownerIdentity = null;
		try {
			const snapshot = await readRegularFileSnapshot(lockPath);
			if (snapshot === null) continue;
			ageMs = Date.now() - snapshot.mtimeMs;
			ownerSource = snapshot.source;
			ownerIdentity = {
				dev: snapshot.dev,
				ino: snapshot.ino
			};
			owner = JSON.parse(ownerSource);
		} catch (readError) {
			if (readError.code === "ENOENT") continue;
			if (readError.code === "ELOOP") throw new AgentRuntimeError("unsafe-state-file", "fleet lock must be a regular file");
			if (readError instanceof AgentRuntimeError) throw readError;
		}
		const ownerPid = typeof owner?.pid === "number" && Number.isSafeInteger(owner.pid) && owner.pid > 0 ? owner.pid : null;
		if (ownerPid !== null && await processIsAlive(ownerPid) || ownerPid === null && ageMs < 1e4) throw new AgentRuntimeError("agent-busy", "another fleet action is already running for this profile");
		if (ownerSource === null || ownerIdentity === null) throw new AgentRuntimeError("agent-busy", "fleet lock ownership could not be verified");
		const oldToken = typeof owner?.token === "string" && owner.token.length > 0 ? owner.token : ownerSource;
		const claimPath = lockPath + ".reap-" + sha256(oldToken);
		try {
			await link(lockPath, claimPath);
		} catch (claimError) {
			if (claimError.code === "ENOENT") continue;
			if (claimError.code === "EEXIST") throw new AgentRuntimeError("agent-busy", "another fleet agent is reclaiming a stale profile lock");
			throw claimError;
		}
		try {
			const claimed = await readRegularFileSnapshot(claimPath);
			const current = await readRegularFileSnapshot(lockPath);
			if (claimed === null || current === null || claimed.dev !== ownerIdentity.dev || claimed.ino !== ownerIdentity.ino || current.dev !== ownerIdentity.dev || current.ino !== ownerIdentity.ino) continue;
			await rm(lockPath);
			await syncDirectory(lockDir);
		} finally {
			await rm(claimPath, { force: true });
			await syncDirectory(lockDir);
		}
	}
	try {
		return await operation();
	} finally {
		try {
			const source = await readRegularOptional(lockPath);
			if (source !== null) {
				if (JSON.parse(source).token === token) {
					await rm(lockPath, { force: true });
					await syncDirectory(lockDir);
				}
			}
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
	await atomicJson$1(actionPath(config, record.planId), next);
	return next;
}
function transitionAction(record, state, fields = {}) {
	return {
		...record,
		...fields,
		state,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
}
async function saveActionBestEffort(config, record, state, fields = {}) {
	const next = transitionAction(record, state, fields);
	try {
		await atomicJson$1(actionPath(config, record.planId), next);
		return {
			record: next,
			failed: false
		};
	} catch {
		return {
			record: next,
			failed: true
		};
	}
}
async function auditBestEffort(config, event) {
	try {
		await audit(config, event);
		return true;
	} catch {
		return false;
	}
}
async function snapshotProfile(config, plan, profile) {
	if (profile.hash !== plan.profileHash) throw new AgentRuntimeError("profile-snapshot-mismatch", "profile snapshot does not match the approved plan");
	const destination = join(config.stateDir, "snapshots", plan.digest);
	await rm(destination, {
		recursive: true,
		force: true
	});
	await ensureDurableDirectory(destination);
	const present = {};
	for (const name of SNAPSHOT_FILES) {
		const source = profile.files[name];
		if (source !== null) {
			await durableWriteFile(join(destination, name), source);
			present[name] = true;
		} else present[name] = false;
	}
	if (profile.directoryPresent && (present["package.json"] !== true || present["pnpm-lock.yaml"] !== true)) throw new AgentRuntimeError("profile-not-snapshotable", "an existing profile requires package.json and pnpm-lock.yaml for rollback");
	await atomicJson$1(join(destination, "snapshot.json"), {
		planId: plan.planId,
		digest: plan.digest,
		manifestDigest: plan.manifestDigest,
		profileHash: plan.profileHash,
		profileDirectoryPresent: profile.directoryPresent,
		present
	});
	await syncDirectory(destination);
}
async function restoreProfile(config, plan) {
	const source = join(config.stateDir, "snapshots", plan.digest);
	try {
		const info = await lstat(source);
		if (info.isSymbolicLink() || !info.isDirectory()) throw new AgentRuntimeError("unsafe-state-file", "profile snapshot must be a regular directory");
	} catch (error) {
		if (error.code === "ENOENT") throw new AgentRuntimeError("snapshot-missing", "profile snapshot is unavailable");
		throw error;
	}
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
		const files = {};
		for (const name of SNAPSHOT_FILES) files[name] = await readRegularOptional(join(source, name));
		if (sha256(JSON.stringify(files)) !== plan.profileHash || SNAPSHOT_FILES.some((name) => files[name] !== null || metadata.present[name] !== false)) throw new AgentRuntimeError("snapshot-mismatch", "profile snapshot contents do not match the approved plan");
		await rm(targetDir, {
			recursive: true,
			force: true
		});
		return;
	}
	if (metadata.present["package.json"] !== true || metadata.present["pnpm-lock.yaml"] !== true) throw new AgentRuntimeError("snapshot-mismatch", "profile snapshot cannot rebuild the dependency tree");
	const files = {};
	for (const name of SNAPSHOT_FILES) {
		files[name] = await readRegularOptional(join(source, name));
		if (files[name] !== null !== (metadata.present[name] === true)) throw new AgentRuntimeError("snapshot-mismatch", "profile snapshot file set does not match its metadata");
	}
	if (sha256(JSON.stringify(files)) !== plan.profileHash) throw new AgentRuntimeError("snapshot-mismatch", "profile snapshot contents do not match the approved plan");
	await mkdir(targetDir, {
		recursive: true,
		mode: 448
	});
	for (const name of SNAPSHOT_FILES) {
		const destination = join(targetDir, name);
		await rm(destination, { force: true });
		const contents = files[name];
		if (contents !== null) await durableWriteFile(destination, contents);
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
async function listenerPids(config, port, signal) {
	if (config.restart.kind === "none") return [];
	const listeners = await runFile(config.restart.lsofBinary, [
		"-nP",
		"-t",
		"-iTCP:" + String(port),
		"-sTCP:LISTEN"
	], {
		env: controlledEnv(config),
		timeoutMs: 1e4,
		allowFailure: true,
		signal
	});
	const pids = listeners.stdout.trim() === "" ? [] : listeners.stdout.trim().split(/\s+/).map((value) => Number(value));
	if (pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0) || pids.length > 1) throw new AgentRuntimeError("restart-owner-ambiguous", "DSH restart found an ambiguous listener owner");
	return pids;
}
async function verifyListenerOwner(config, pid, port, signal) {
	if (config.restart.kind === "none") throw new AgentRuntimeError("unsafe-mutation-config", "restart owner is not configured");
	const command = (await runFile(config.restart.psBinary, [
		"-p",
		String(pid),
		"-o",
		"command="
	], {
		env: controlledEnv(config),
		timeoutMs: 1e4,
		signal
	})).stdout.trim();
	const hasOwnerMarker = config.restart.ownerMarkers.some((marker) => command.includes(marker));
	const isMainPort = port === config.restart.port;
	const hasWebToken = /(?:^|\s)web(?:\s|$)/.test(command);
	const hasPort = command.includes("--port " + String(config.restart.port));
	if (!hasOwnerMarker || isMainPort && (!hasWebToken || !hasPort)) throw new AgentRuntimeError("restart-owner-mismatch", "configured port is not owned by a recognizable DSH process");
}
async function stopDsh(config, signal) {
	assertMutationReadyConfig(config);
	throwIfAborted(signal);
	const env = controlledEnv(config);
	const ports = config.restart.managedPorts ?? [config.restart.port];
	const owners = /* @__PURE__ */ new Map();
	for (const port of ports) {
		const pid = (await listenerPids(config, port, signal))[0];
		if (pid !== void 0) {
			await verifyListenerOwner(config, pid, port, signal);
			owners.set(port, pid);
		}
	}
	if (config.restart.kind === "screen") await runFile(config.restart.screenBinary, [
		"-S",
		config.restart.sessionName,
		"-X",
		"quit"
	], {
		env,
		timeoutMs: 1e4,
		allowFailure: true,
		signal
	});
	else await runFile(config.restart.launchctlBinary, [
		"kill",
		"SIGTERM",
		config.restart.serviceTarget
	], {
		env,
		timeoutMs: 1e4,
		allowFailure: owners.size === 0,
		signal
	});
	const deadline = Date.now() + 5e3;
	while (Date.now() < deadline) {
		throwIfAborted(signal);
		if ((await Promise.all(ports.map((port) => listenerPids(config, port, signal)))).flat().length === 0) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	if (config.restart.kind === "screen") {
		for (const pid of new Set(owners.values())) try {
			process.kill(pid, "SIGTERM");
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
		for (const pid of new Set(owners.values())) if (await processIsAlive(pid)) try {
			process.kill(pid, "SIGKILL");
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
		if ((await Promise.all(ports.map((port) => listenerPids(config, port, signal)))).flat().length === 0) return;
	}
	throw new AgentRuntimeError("restart-cleanup-failed", "managed DSH listeners did not exit cleanly");
}
async function startDsh(config, signal) {
	assertMutationReadyConfig(config);
	throwIfAborted(signal);
	const env = controlledEnv(config);
	if (config.restart.kind === "screen") {
		if ((await runFile(config.restart.screenBinary, [
			"-dmS",
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
			allowFailure: true,
			ignoreOutput: true,
			signal
		})).code !== 0) throw new AgentRuntimeError("restart-failed", "DSH restart failed");
		return;
	}
	await runFile(config.restart.launchctlBinary, ["kickstart", config.restart.serviceTarget], {
		env,
		timeoutMs: 1e4,
		signal
	});
}
async function restartDsh(config, signal) {
	await stopDsh(config, signal);
	await startDsh(config, signal);
}
async function waitForHttp(url, timeoutMs, signal) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		throwIfAborted(signal);
		try {
			const timeout = AbortSignal.timeout(Math.min(3e3, Math.max(1, deadline - Date.now())));
			const requestSignal = signal === void 0 ? timeout : AbortSignal.any([signal, timeout]);
			const response = await fetch(url, { signal: requestSignal });
			if (response.ok) return response;
			response.status;
		} catch (error) {
			throwIfAborted(signal);
		}
		await new Promise((resolve) => setTimeout(resolve, 350));
	}
	throw new AgentRuntimeError("health-timeout", "DSH health endpoint did not recover before timeout");
}
async function verifyHealth(config, plan, signal, expectedPluginIds = []) {
	assertMutationReadyConfig(config);
	await runFile(config.dshBinary, [
		"--profile",
		config.profile,
		"--dump-config"
	], {
		env: controlledEnv(config),
		timeoutMs: 2e4,
		signal
	});
	if (plan !== void 0) {
		const source = await readRegularOptional(join(profileDir(config), "package.json"));
		if (source === null) throw new AgentRuntimeError("profile-missing", "DSH profile is missing after apply");
		if (JSON.parse(source).dependencies?.[plan.pluginId] !== plan.exactToSpec) throw new AgentRuntimeError("profile-mismatch", "installed dependency does not match the approved plan");
	}
	await waitForHttp(config.health.url, config.health.timeoutMs, signal);
	const endpoint = new URL("/dsh-fleet/status", config.health.url);
	const deadline = Date.now() + config.health.timeoutMs;
	const targetIds = plan === void 0 ? [...expectedPluginIds] : [plan.pluginId];
	let targetPending = targetIds.length > 0;
	let runtimeFailed = false;
	while (Date.now() < deadline) {
		throwIfAborted(signal);
		const rpcId = "fleet-agent-health-" + randomUUID();
		try {
			const timeout = AbortSignal.timeout(Math.min(3e3, Math.max(1, deadline - Date.now())));
			const requestSignal = signal === void 0 ? timeout : AbortSignal.any([signal, timeout]);
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "client-request",
					rpcId,
					method: "status",
					payload: null
				}),
				signal: requestSignal
			});
			if (response.ok) {
				const body = await response.json();
				const failedModules = body.result?.value?.runtime?.failedModules;
				runtimeFailed = Array.isArray(failedModules) && failedModules.length > 0;
				const runtimeHealthy = Array.isArray(failedModules) && failedModules.length === 0 || failedModules === void 0 && targetIds.length === 0;
				const fleetHealthy = body.rpcId === rpcId && body.result?.ok === true && body.result.value?.summary?.failed === 0 && runtimeHealthy;
				const plugins = body.result?.value?.plugins ?? [];
				targetPending = targetIds.some((id) => plugins.find((item) => item.id === id)?.state !== "aligned");
				if (fleetHealthy && !targetPending) return;
			}
		} catch {
			throwIfAborted(signal);
		}
		await new Promise((resolve) => setTimeout(resolve, 350));
	}
	if (runtimeFailed) throw new AgentRuntimeError("runtime-modules-failed", "DSH Loader reports failed runtime modules");
	if (targetPending) throw new AgentRuntimeError("plugin-not-active", "approved plugin did not become active");
	throw new AgentRuntimeError("fleet-rpc-unhealthy", "Fleet RPC reported an unhealthy runtime");
}
function installArgument(plan) {
	return plan.pluginId + "@" + plan.exactToSpec;
}
async function applyPackage(config, plan, signal) {
	await runFile(config.pnpmBinary, ["--version"], {
		env: controlledEnv(config),
		timeoutMs: 1e4,
		signal
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
		timeoutMs: 12e4,
		signal
	});
}
async function inspectAgent(config, now = /* @__PURE__ */ new Date(), signal) {
	const state = await loadState(config, signal);
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
async function createStoredPlan(config, pluginId, now = /* @__PURE__ */ new Date(), signal) {
	const state = await loadState(config, signal);
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
	await atomicJson$1(planPath(config, plan.planId), plan);
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
	let persistenceFailed = false;
	let saved = await saveActionBestEffort(config, record, "rollback", { errorCode: "interrupted-action" });
	let current = saved.record;
	persistenceFailed ||= saved.failed;
	try {
		await restoreProfile(config, plan);
		saved = await saveActionBestEffort(config, current, "rollback-restarting");
		current = saved.record;
		persistenceFailed ||= saved.failed;
		await restartDsh(config);
		saved = await saveActionBestEffort(config, current, "rollback-verifying");
		current = saved.record;
		persistenceFailed ||= saved.failed;
		await verifyHealth(config);
		saved = await saveActionBestEffort(config, current, "rolled-back", { result: "rolled-back" });
		current = saved.record;
		persistenceFailed ||= saved.failed;
		persistenceFailed ||= !await auditBestEffort(config, {
			type: "capability/rolled-back",
			planId: plan.planId,
			result: "interrupted-action"
		});
		if (!persistenceFailed) return current;
	} catch {}
	saved = await saveActionBestEffort(config, current, "manual-intervention", {
		result: "manual-intervention",
		errorCode: persistenceFailed ? "state-persistence-failed" : "rollback-failed"
	});
	current = saved.record;
	await auditBestEffort(config, {
		type: "capability/failed",
		planId: plan.planId,
		result: "manual-intervention"
	});
	return current;
}
async function applyStoredPlanLocked(config, approval, now, signal) {
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
	const currentState = await loadState(config, signal);
	if (currentState.manifestDigest !== plan.manifestDigest || currentState.profileHash !== plan.profileHash || currentState.dshVersion !== plan.observedDshVersion) throw new FleetProtocolError("approval-mismatch", "manifest, profile or DSH version changed after the plan was created");
	await verifyHealth(config, void 0, signal);
	throwIfAborted(signal);
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
	throwIfAborted(signal);
	await snapshotProfile(config, plan, currentState.profileSnapshot);
	if (await computeProfileHash(config) !== plan.profileHash) throw new FleetProtocolError("approval-mismatch", "profile changed while the approved snapshot was being persisted");
	let record = await saveAction(config, recordSeed, "staged");
	await audit(config, {
		type: "plan/approved",
		planId: plan.planId,
		approvalId: approval.approvalId,
		principalId: approval.principalId
	});
	try {
		throwIfAborted(signal);
		record = await saveAction(config, record, "applying");
		if (await computeProfileHash(config) !== plan.profileHash) throw new FleetProtocolError("approval-mismatch", "profile changed immediately before the approved mutation");
		await applyPackage(config, plan, signal);
		throwIfAborted(signal);
		record = await saveAction(config, record, "restarting");
		await restartDsh(config, signal);
		throwIfAborted(signal);
		record = await saveAction(config, record, "verifying");
		await verifyHealth(config, plan, signal);
		throwIfAborted(signal);
		await audit(config, {
			type: "capability/applied",
			planId: plan.planId,
			pluginId: plan.pluginId,
			result: "success"
		});
		record = await saveAction(config, record, "succeeded", { result: "success" });
		return record;
	} catch (error) {
		const errorCode = typeof error.code === "string" ? error.code : "apply-failed";
		let persistenceFailed = false;
		let saved = await saveActionBestEffort(config, record, "rollback", { errorCode });
		record = saved.record;
		persistenceFailed ||= saved.failed;
		persistenceFailed ||= !await auditBestEffort(config, {
			type: "capability/failed",
			planId: plan.planId,
			pluginId: plan.pluginId,
			result: errorCode
		});
		if (errorCode === "command-cleanup-failed") {
			saved = await saveActionBestEffort(config, record, "manual-intervention", {
				result: "manual-intervention",
				errorCode
			});
			record = saved.record;
			await auditBestEffort(config, {
				type: "capability/failed",
				planId: plan.planId,
				result: "manual-intervention"
			});
			return record;
		}
		try {
			await restoreProfile(config, plan);
			saved = await saveActionBestEffort(config, record, "rollback-restarting");
			record = saved.record;
			persistenceFailed ||= saved.failed;
			await restartDsh(config);
			saved = await saveActionBestEffort(config, record, "rollback-verifying");
			record = saved.record;
			persistenceFailed ||= saved.failed;
			await verifyHealth(config);
			saved = await saveActionBestEffort(config, record, "rolled-back", { result: "rolled-back" });
			record = saved.record;
			persistenceFailed ||= saved.failed;
			persistenceFailed ||= !await auditBestEffort(config, {
				type: "capability/rolled-back",
				planId: plan.planId,
				result: errorCode
			});
			if (!persistenceFailed) return record;
		} catch {}
		saved = await saveActionBestEffort(config, record, "manual-intervention", {
			result: "manual-intervention",
			errorCode: persistenceFailed ? "state-persistence-failed" : "rollback-failed"
		});
		record = saved.record;
		await auditBestEffort(config, {
			type: "capability/failed",
			planId: plan.planId,
			result: "manual-intervention"
		});
		return record;
	}
}
async function applyStoredPlan(config, approval, now = /* @__PURE__ */ new Date(), signal) {
	assertMutationReadyConfig(config);
	return withProfileLock(config, () => applyStoredPlanLocked(config, approval, now, signal));
}
function releasePlanPath(config, planId) {
	if (!/^release-plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError("invalid-plan-id", "release plan id is invalid");
	return join(config.stateDir, "release-plans", planId.slice(13) + ".json");
}
function releaseActionPath(config, planId) {
	if (!/^release-plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError("invalid-plan-id", "release plan id is invalid");
	return join(config.stateDir, "release-actions", planId.slice(13) + ".json");
}
function appliedReleasePath(config) {
	return join(config.stateDir, "releases", config.profile + ".json");
}
function releaseProfileNames(plan) {
	const suffix = plan.digest.slice(0, 24);
	return {
		stageProfile: "fleet-stage-" + suffix,
		backupProfile: "fleet-backup-" + suffix,
		failedProfile: "fleet-failed-" + suffix
	};
}
async function regularDirectoryExists(path) {
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink() || !info.isDirectory()) throw new AgentRuntimeError("unsafe-profile-directory", "release swap paths must be regular directories");
		return true;
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}
async function readAppliedRelease(config) {
	const value = await readJson(appliedReleasePath(config));
	if (value === null) return null;
	validateFleetAppliedRelease(value);
	if (value.deviceId !== config.deviceId || value.profile !== config.profile) throw new AgentRuntimeError("applied-release-mismatch", "applied release identity does not match this Agent");
	return value;
}
async function currentArtifactDigests(config, state) {
	const releaseId = state.manifest.v2?.assignments[config.deviceId]?.[config.profile];
	const release = releaseId === void 0 ? void 0 : state.manifest.v2?.profileReleases[releaseId];
	const entries = await Promise.all((release?.plugins ?? []).filter((plugin) => plugin.source.kind === "artifact").map(async (plugin) => {
		const actualSpec = state.dependencies[plugin.id];
		if (actualSpec === void 0) return null;
		const digest = await digestInstalledArtifact(profileDir(config), config.artifactStore, actualSpec);
		return digest === void 0 ? null : [plugin.id, digest];
	}));
	return Object.fromEntries(entries.filter((entry) => entry !== null));
}
async function buildReleasePlan(config, now, signal) {
	const state = await loadState(config, signal);
	const appliedRelease = await readAppliedRelease(config);
	return {
		plan: createReleasePlan({
			manifest: state.manifest,
			manifestDigest: state.manifestDigest,
			dependencies: state.dependencies,
			artifactDigests: await currentArtifactDigests(config, state),
			appliedRelease,
			profileHash: state.profileHash,
			observedDshVersion: state.dshVersion,
			now,
			deviceId: config.deviceId,
			profile: config.profile,
			planTtlMs: config.planTtlMs
		}),
		state,
		appliedRelease
	};
}
async function inspectReleaseAgent(config, now = /* @__PURE__ */ new Date(), signal) {
	assertReleaseReadyConfig(config);
	const { plan, appliedRelease } = await buildReleasePlan(config, now, signal);
	return {
		protocolVersion: 1,
		kind: "profile-release",
		deviceId: plan.deviceId,
		profile: plan.profile,
		dshVersion: plan.observedDshVersion,
		manifestDigest: plan.manifestDigest,
		profileHash: plan.profileHash,
		currentRelease: appliedRelease === null ? null : {
			releaseId: appliedRelease.releaseId,
			releaseVersion: appliedRelease.releaseVersion,
			releaseDigest: appliedRelease.releaseDigest
		},
		assignedRelease: {
			releaseId: plan.releaseId,
			releaseVersion: plan.releaseVersion,
			releaseDigest: plan.releaseDigest
		},
		changes: plan.changes,
		tasks: {
			enabled: config.tasks?.enabled === true && config.a2a !== void 0,
			workspaceIds: Object.keys(config.tasks?.workspaces ?? {}).sort(),
			profiles: [...config.tasks?.profiles ?? []].sort()
		}
	};
}
async function verifyReleaseAgentHealth(config, signal) {
	assertReleaseReadyConfig(config);
	await verifyHealth(config, void 0, signal);
}
async function createStoredReleasePlan(config, now = /* @__PURE__ */ new Date(), signal) {
	assertReleaseReadyConfig(config);
	const { plan } = await buildReleasePlan(config, now, signal);
	await atomicJson$1(releasePlanPath(config, plan.planId), plan);
	await audit(config, {
		type: "profile-release/plan-created",
		planId: plan.planId,
		releaseId: plan.releaseId,
		releaseVersion: plan.releaseVersion,
		changes: plan.changes.map((change) => ({
			pluginId: change.pluginId,
			action: change.action
		}))
	});
	return plan;
}
async function readReleaseAction(config, planId) {
	return readJson(releaseActionPath(config, planId));
}
async function saveReleaseAction(config, record, state, fields = {}) {
	const next = {
		...record,
		...fields,
		state,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	await atomicJson$1(releaseActionPath(config, record.planId), next);
	return next;
}
async function saveReleaseActionBestEffort(config, record, state, fields = {}) {
	const next = {
		...record,
		...fields,
		state,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	try {
		await atomicJson$1(releaseActionPath(config, record.planId), next);
		return {
			record: next,
			failed: false
		};
	} catch {
		return {
			record: next,
			failed: true
		};
	}
}
function configForProfile(config, profile) {
	return {
		...config,
		profile
	};
}
async function resolveReleaseArtifact(config, plugin, signal) {
	if (plugin.sourceKind !== "artifact" || plugin.artifactDigest === null || plugin.packageVersion === null) throw new AgentRuntimeError("artifact-binding-invalid", "private artifact binding is incomplete");
	const path = join(config.artifactStore, plugin.artifactDigest + ".tgz");
	if (await digestInstalledArtifact(profileDir(config), config.artifactStore, "file:" + path) !== plugin.artifactDigest) throw new AgentRuntimeError("artifact-digest-mismatch", "private artifact is missing or does not match its approved digest");
	const extracted = await runFile(config.tarBinary, [
		"-xOf",
		path,
		"package/package.json"
	], {
		env: controlledEnv(config),
		timeoutMs: 2e4,
		signal
	});
	let manifest;
	try {
		manifest = JSON.parse(extracted.stdout);
	} catch {
		throw new AgentRuntimeError("artifact-manifest-invalid", "private artifact package manifest is invalid");
	}
	if (manifest.name !== plugin.pluginId || manifest.version !== plugin.packageVersion || typeof manifest.dsh?.bundle?.patch !== "string") throw new AgentRuntimeError("artifact-identity-mismatch", "private artifact package identity, version or DSH bundle metadata does not match the release");
	return path;
}
async function releaseInstallArgument(config, plugin, signal) {
	if (plugin.sourceKind === "artifact") return resolveReleaseArtifact(config, plugin, signal);
	return plugin.pluginId + "@" + plugin.exactSpec;
}
function objectValue(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function npmLockBindsIntegrity(lockSource, plugin) {
	if (plugin.sourceKind !== "npm" || plugin.integrity === null || plugin.packageVersion === null) return false;
	let lock;
	try {
		lock = objectValue(parse(lockSource));
	} catch {
		return false;
	}
	const rootImporter = objectValue(objectValue(lock?.importers)?.["."]);
	const dependencyGroups = [
		"dependencies",
		"optionalDependencies",
		"devDependencies"
	];
	let dependency = null;
	for (const group of dependencyGroups) {
		const candidate = objectValue(objectValue(rootImporter?.[group])?.[plugin.pluginId]);
		if (candidate !== null) {
			dependency = candidate;
			break;
		}
	}
	if (dependency?.specifier !== plugin.exactSpec || typeof dependency.version !== "string") return false;
	const lockedVersion = dependency.version;
	if (lockedVersion !== plugin.packageVersion && !lockedVersion.startsWith(plugin.packageVersion + "(")) return false;
	const packages = objectValue(lock?.packages);
	if (packages === null) return false;
	const expectedKey = plugin.pluginId + "@" + lockedVersion;
	for (const [rawKey, value] of Object.entries(packages)) {
		if ((rawKey.startsWith("/") ? rawKey.slice(1) : rawKey) !== expectedKey) continue;
		return objectValue(objectValue(value)?.resolution)?.integrity === plugin.integrity;
	}
	return false;
}
async function verifyReleaseProfileFiles(config, plan, profile) {
	const targetConfig = configForProfile(config, profile);
	const source = await readRegularOptional(join(profileDir(targetConfig), "package.json"));
	if (source === null) throw new AgentRuntimeError("profile-missing", "staged release profile is missing");
	const parsed = JSON.parse(source);
	const dependencies = parsed.dependencies ?? {};
	const bundles = parsed.dsh?.profile?.bundles ?? [];
	const lockSource = await readRegularOptional(join(profileDir(targetConfig), "pnpm-lock.yaml"));
	if (lockSource === null) throw new AgentRuntimeError("profile-lock-missing", "release profile lockfile is missing");
	for (const plugin of plan.plugins) {
		const actualSpec = dependencies[plugin.pluginId];
		if (actualSpec === void 0 || !bundles.includes(plugin.pluginId)) throw new AgentRuntimeError("release-profile-mismatch", "release plugin is missing from dependencies or DSH bundles");
		if (plugin.sourceKind === "artifact") {
			if (await digestInstalledArtifact(profileDir(targetConfig), config.artifactStore, actualSpec) !== plugin.artifactDigest) throw new AgentRuntimeError("artifact-digest-mismatch", "materialized private artifact digest does not match the release");
		} else if (actualSpec !== plugin.exactSpec) throw new AgentRuntimeError("release-profile-mismatch", "materialized public plugin spec does not match the release");
		if (plugin.sourceKind === "npm" && !npmLockBindsIntegrity(lockSource, plugin)) throw new AgentRuntimeError("npm-integrity-mismatch", "pnpm lockfile does not contain the approved npm integrity");
	}
	for (const change of plan.changes.filter((change) => change.action === "remove")) if (dependencies[change.pluginId] !== void 0 || bundles.includes(change.pluginId)) throw new AgentRuntimeError("release-profile-mismatch", "retired release plugin remains in the staged profile");
	await runFile(config.dshBinary, [
		"--profile",
		profile,
		"--dump-config"
	], {
		env: controlledEnv(config),
		timeoutMs: 2e4
	});
}
async function stageRelease(config, plan, snapshot, signal) {
	if (!snapshot.directoryPresent || snapshot.files["package.json"] === null || snapshot.files["pnpm-lock.yaml"] === null) throw new AgentRuntimeError("profile-not-stageable", "atomic release requires an existing profile with package.json and pnpm-lock.yaml");
	const { stageProfile } = releaseProfileNames(plan);
	const stageConfig = configForProfile(config, stageProfile);
	const stageDir = profileDir(stageConfig);
	await rm(stageDir, {
		recursive: true,
		force: true
	});
	await ensureDurableDirectory(stageDir);
	for (const name of SNAPSHOT_FILES) {
		const source = snapshot.files[name];
		if (source !== null) await durableWriteFile(join(stageDir, name), source);
	}
	if (await computeProfileHash(stageConfig) !== plan.profileHash) throw new AgentRuntimeError("profile-stage-mismatch", "staged profile does not match the approved source profile");
	await runFile(config.pnpmBinary, ["--version"], {
		env: controlledEnv(config),
		timeoutMs: 1e4,
		signal
	});
	const bindings = new Map(plan.plugins.map((plugin) => [plugin.pluginId, plugin]));
	for (const change of plan.changes) {
		throwIfAborted(signal);
		if (change.action === "remove") {
			await runFile(config.dshBinary, [
				"plugin",
				"--profile",
				stageProfile,
				"remove",
				change.pluginId,
				"--ignore-scripts"
			], {
				env: controlledEnv(config),
				timeoutMs: 12e4,
				signal
			});
			continue;
		}
		const plugin = bindings.get(change.pluginId);
		if (plugin === void 0) throw new AgentRuntimeError("release-plan-invalid", "release change has no final plugin binding");
		const argument = await releaseInstallArgument(config, plugin, signal);
		await runFile(config.dshBinary, [
			"plugin",
			"--profile",
			stageProfile,
			"add",
			argument,
			"--save-exact",
			"--ignore-scripts"
		], {
			env: controlledEnv(config),
			timeoutMs: 12e4,
			signal
		});
	}
	await verifyReleaseProfileFiles(config, plan, stageProfile);
}
async function ensureServiceStarted(config) {
	if (!((await listenerPids(config, config.restart.port))[0] !== void 0)) await startDsh(config);
}
async function swapStagedRelease(config, plan, signal) {
	const names = releaseProfileNames(plan);
	const profilesRoot = dirname(profileDir(config));
	const liveDir = profileDir(config);
	const stageDir = join(profilesRoot, names.stageProfile);
	const backupDir = join(profilesRoot, names.backupProfile);
	if (!await regularDirectoryExists(stageDir)) throw new AgentRuntimeError("release-stage-missing", "staged release directory is missing");
	await rm(backupDir, {
		recursive: true,
		force: true
	});
	await stopDsh(config, signal);
	throwIfAborted(signal);
	await rename(liveDir, backupDir);
	await syncDirectory(profilesRoot);
	try {
		await rename(stageDir, liveDir);
		await syncDirectory(profilesRoot);
	} catch (error) {
		await rename(backupDir, liveDir);
		await syncDirectory(profilesRoot);
		await startDsh(config);
		throw error;
	}
}
async function persistAppliedRelease(config, plan) {
	const applied = {
		schemaVersion: 1,
		deviceId: plan.deviceId,
		profile: plan.profile,
		releaseId: plan.releaseId,
		releaseVersion: plan.releaseVersion,
		releaseDigest: plan.releaseDigest,
		plugins: plan.plugins,
		appliedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	validateFleetAppliedRelease(applied);
	await atomicJson$1(appliedReleasePath(config), applied);
	return applied;
}
async function rollbackRelease(config, plan, record, errorCode) {
	const names = releaseProfileNames(plan);
	const profilesRoot = dirname(profileDir(config));
	const liveDir = profileDir(config);
	const stageDir = join(profilesRoot, names.stageProfile);
	const backupDir = join(profilesRoot, names.backupProfile);
	const failedDir = join(profilesRoot, names.failedProfile);
	let current = (await saveReleaseActionBestEffort(config, record, "rollback", { errorCode })).record;
	try {
		if (await regularDirectoryExists(backupDir)) {
			try {
				await stopDsh(config);
			} catch {
				if ((await listenerPids(config, config.restart.port))[0] !== void 0) throw new AgentRuntimeError("restart-cleanup-failed", "cannot stop the failed release for rollback");
			}
			await rm(failedDir, {
				recursive: true,
				force: true
			});
			if (await regularDirectoryExists(liveDir)) await rename(liveDir, failedDir);
			await rename(backupDir, liveDir);
			await syncDirectory(profilesRoot);
		}
		await rm(stageDir, {
			recursive: true,
			force: true
		});
		current = await saveReleaseAction(config, current, "rollback-restarting");
		await ensureServiceStarted(config);
		current = await saveReleaseAction(config, current, "rollback-verifying");
		await verifyHealth(config);
		await rm(failedDir, {
			recursive: true,
			force: true
		});
		await auditBestEffort(config, {
			type: "profile-release/rolled-back",
			planId: plan.planId,
			releaseId: plan.releaseId,
			result: errorCode
		});
		return saveReleaseAction(config, current, "rolled-back", {
			result: "rolled-back",
			errorCode
		});
	} catch {
		await auditBestEffort(config, {
			type: "profile-release/manual-intervention",
			planId: plan.planId,
			releaseId: plan.releaseId,
			result: errorCode
		});
		return (await saveReleaseActionBestEffort(config, current, "manual-intervention", {
			result: "manual-intervention",
			errorCode: "rollback-failed"
		})).record;
	}
}
async function recoverReleaseInterrupted(config, plan, record) {
	if ((await readAppliedRelease(config))?.releaseDigest === plan.releaseDigest) try {
		await verifyReleaseProfileFiles(config, plan, config.profile);
		await ensureServiceStarted(config);
		await verifyHealth(config, void 0, void 0, plan.plugins.map((plugin) => plugin.pluginId));
		const names = releaseProfileNames(plan);
		const profilesRoot = dirname(profileDir(config));
		await Promise.all([
			rm(join(profilesRoot, names.stageProfile), {
				recursive: true,
				force: true
			}),
			rm(join(profilesRoot, names.backupProfile), {
				recursive: true,
				force: true
			}),
			rm(join(profilesRoot, names.failedProfile), {
				recursive: true,
				force: true
			})
		]);
		return saveReleaseAction(config, record, "succeeded", { result: "success" });
	} catch {}
	return rollbackRelease(config, plan, record, "interrupted-action");
}
async function applyStoredReleasePlanLocked(config, approval, now, signal) {
	const plan = await readJson(releasePlanPath(config, approval.planId));
	if (plan === null) throw new AgentRuntimeError("plan-not-found", "approved release plan was not found");
	validateFleetReleasePlan(plan);
	const existing = await readReleaseAction(config, plan.planId);
	let validation;
	try {
		validation = validateFleetReleaseApproval(plan, approval, now);
	} catch (error) {
		if (existing !== null && ![
			"succeeded",
			"rolled-back",
			"manual-intervention"
		].includes(existing.state)) return recoverReleaseInterrupted(config, plan, existing);
		throw error;
	}
	if (existing !== null) {
		if (existing.idempotencyKey !== validation.idempotencyKey) {
			if (![
				"succeeded",
				"rolled-back",
				"manual-intervention"
			].includes(existing.state)) return recoverReleaseInterrupted(config, plan, existing);
			throw new AgentRuntimeError("idempotency-conflict", "release plan already has a different approval");
		}
		if ([
			"succeeded",
			"rolled-back",
			"manual-intervention"
		].includes(existing.state)) return existing;
		return recoverReleaseInterrupted(config, plan, existing);
	}
	const current = await loadState(config, signal);
	if (current.manifestDigest !== plan.manifestDigest || current.profileHash !== plan.profileHash || current.dshVersion !== plan.observedDshVersion) throw new FleetProtocolError("approval-mismatch", "manifest, profile or DSH version changed after the release plan was created");
	await verifyHealth(config, void 0, signal);
	const names = releaseProfileNames(plan);
	let record = {
		planId: plan.planId,
		planDigest: plan.digest,
		approvalId: approval.approvalId,
		principalId: approval.principalId,
		idempotencyKey: validation.idempotencyKey,
		deviceId: plan.deviceId,
		profile: plan.profile,
		releaseId: plan.releaseId,
		releaseVersion: plan.releaseVersion,
		releaseDigest: plan.releaseDigest,
		stageProfile: names.stageProfile,
		backupProfile: names.backupProfile,
		state: "approved",
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	record = await saveReleaseAction(config, record, "approved");
	await audit(config, {
		type: "profile-release/approved",
		planId: plan.planId,
		releaseId: plan.releaseId,
		approvalId: approval.approvalId,
		principalId: approval.principalId
	});
	let releaseCommitted = false;
	try {
		if (plan.changes.length === 0) {
			await verifyReleaseProfileFiles(config, plan, config.profile);
			await verifyHealth(config, void 0, signal, plan.plugins.map((plugin) => plugin.pluginId));
			await persistAppliedRelease(config, plan);
			releaseCommitted = true;
			record = await saveReleaseAction(config, record, "succeeded", { result: "success" });
			await auditBestEffort(config, {
				type: "profile-release/applied",
				planId: plan.planId,
				releaseId: plan.releaseId,
				result: "adopted"
			});
			return record;
		}
		record = await saveReleaseAction(config, record, "staging");
		await stageRelease(config, plan, current.profileSnapshot, signal);
		throwIfAborted(signal);
		if (await computeProfileHash(config) !== plan.profileHash) throw new FleetProtocolError("approval-mismatch", "live profile changed while the release was staged");
		record = await saveReleaseAction(config, record, "staged");
		record = await saveReleaseAction(config, record, "applying");
		await swapStagedRelease(config, plan, signal);
		throwIfAborted(signal);
		record = await saveReleaseAction(config, record, "restarting");
		await startDsh(config, signal);
		throwIfAborted(signal);
		record = await saveReleaseAction(config, record, "verifying");
		await verifyReleaseProfileFiles(config, plan, config.profile);
		await verifyHealth(config, void 0, signal, plan.plugins.map((plugin) => plugin.pluginId));
		throwIfAborted(signal);
		await persistAppliedRelease(config, plan);
		releaseCommitted = true;
		record = await saveReleaseAction(config, record, "succeeded", { result: "success" });
		await auditBestEffort(config, {
			type: "profile-release/applied",
			planId: plan.planId,
			releaseId: plan.releaseId,
			result: "success"
		});
		const profilesRoot = dirname(profileDir(config));
		await rm(join(profilesRoot, names.backupProfile), {
			recursive: true,
			force: true
		}).catch(() => void 0);
		return record;
	} catch (error) {
		if (releaseCommitted) return recoverReleaseInterrupted(config, plan, record);
		const errorCode = typeof error.code === "string" ? error.code : "release-apply-failed";
		await auditBestEffort(config, {
			type: "profile-release/failed",
			planId: plan.planId,
			releaseId: plan.releaseId,
			result: errorCode
		});
		return rollbackRelease(config, plan, record, errorCode);
	}
}
async function applyStoredReleasePlan(config, approval, now = /* @__PURE__ */ new Date(), signal) {
	assertReleaseReadyConfig(config);
	return withProfileLock(config, () => applyStoredReleasePlanLocked(config, approval, now, signal));
}
async function readOrRecoverReleaseAction(config, planId) {
	assertReleaseReadyConfig(config);
	return withProfileLock(config, async () => {
		const record = await readReleaseAction(config, planId);
		if (record === null || [
			"succeeded",
			"rolled-back",
			"manual-intervention"
		].includes(record.state)) return record;
		const plan = await readJson(releasePlanPath(config, planId));
		if (plan === null) throw new AgentRuntimeError("plan-not-found", "approved release plan was not found");
		validateFleetReleasePlan(plan);
		return recoverReleaseInterrupted(config, plan, record);
	});
}
const FLEET_A2A_KINDS = [
	"task.submit",
	"task.status",
	"task.cancel",
	"task.progress",
	"task.result",
	"approval.request",
	"approval.decision",
	"handoff",
	"receipt"
];
var FleetA2AError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "FleetA2AError";
		this.code = code;
	}
};
const BODY_KEYS = [
	"schemaVersion",
	"teamId",
	"messageId",
	"sender",
	"recipient",
	"kind",
	"issuedAt",
	"expiresAt",
	"payloadDigest",
	"payload"
];
const ENVELOPE_KEYS = [...BODY_KEYS, "signature"];
const SENDER_KEYS = [
	"principalId",
	"deviceId",
	"keyId"
];
const RECIPIENT_KEYS = ["deviceId"];
const MAX_PAYLOAD_BYTES = 49152;
const DEFAULT_TTL_MS = 3e5;
const DEFAULT_MAX_TTL_MS = 9e5;
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys$2(value, keys, field) {
	if (!isRecord$2(value)) throw new FleetA2AError("invalid-envelope", field + " must be an object");
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new FleetA2AError("invalid-envelope", field + " has unsupported or missing fields");
}
function text$1(value, field, maxLength = 128) {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > maxLength || /[\r\n\0]/.test(value)) throw new FleetA2AError("invalid-payload", field + " must be a bounded trimmed string");
	return value;
}
function longText(value, field, maxLength) {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength || value.includes("\0")) throw new FleetA2AError("invalid-payload", field + " must be bounded non-empty text");
	return value;
}
function identifier$2(value, field) {
	const result = text$1(value, field, 64);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(result)) throw new FleetA2AError("invalid-payload", field + " is invalid");
	return result;
}
function messageId(value, field, prefix) {
	const result = text$1(value, field, 64);
	if (!new RegExp("^" + prefix + ":[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").test(result)) throw new FleetA2AError("invalid-payload", field + " must be a namespaced UUID");
	return result;
}
function digest(value, field) {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new FleetA2AError("invalid-envelope", field + " must be a lowercase SHA-256 digest");
	return value;
}
function canonicalTime(value, field) {
	if (typeof value !== "string") throw new FleetA2AError("invalid-time", field + " must be a canonical ISO timestamp");
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) throw new FleetA2AError("invalid-time", field + " must be a canonical ISO timestamp");
	return timestamp;
}
function boundedInteger(value, field, min, max) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new FleetA2AError("invalid-payload", `${field} must be an integer from ${min} to ${max}`);
	return value;
}
function exactPayload(payload, keys, kind) {
	const actual = Object.keys(payload).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new FleetA2AError("invalid-payload", kind + " payload has unsupported or missing fields");
}
function taskId(value) {
	return messageId(value, "payload.taskId", "task");
}
function validateA2APayload(kind, payload) {
	if (!isRecord$2(payload)) throw new FleetA2AError("invalid-payload", kind + " payload must be an object");
	if (Buffer.byteLength(canonicalJson(payload), "utf8") > MAX_PAYLOAD_BYTES) throw new FleetA2AError("invalid-payload", "A2A payload exceeds the size limit");
	if (kind === "task.submit") {
		exactPayload(payload, [
			"taskId",
			"workspaceId",
			"profile",
			"prompt"
		], kind);
		taskId(payload.taskId);
		identifier$2(payload.workspaceId, "payload.workspaceId");
		identifier$2(payload.profile, "payload.profile");
		longText(payload.prompt, "payload.prompt", 32768);
		return;
	}
	if (kind === "task.status" || kind === "task.cancel") {
		exactPayload(payload, ["taskId"], kind);
		taskId(payload.taskId);
		return;
	}
	if (kind === "task.progress") {
		exactPayload(payload, [
			"taskId",
			"state",
			"updatedAt"
		], kind);
		taskId(payload.taskId);
		if (![
			"accepted",
			"running",
			"cancel-requested"
		].includes(text$1(payload.state, "payload.state", 24))) throw new FleetA2AError("invalid-payload", "task progress state is invalid");
		canonicalTime(payload.updatedAt, "payload.updatedAt");
		return;
	}
	if (kind === "task.result") {
		exactPayload(payload, [
			"taskId",
			"state",
			"updatedAt",
			"resultDigest",
			"result",
			"truncated",
			"errorCode"
		], kind);
		taskId(payload.taskId);
		if (![
			"succeeded",
			"failed",
			"cancelled"
		].includes(text$1(payload.state, "payload.state", 16))) throw new FleetA2AError("invalid-payload", "task result state is invalid");
		canonicalTime(payload.updatedAt, "payload.updatedAt");
		if (payload.resultDigest !== null) digest(payload.resultDigest, "payload.resultDigest");
		if (payload.result !== null) longText(payload.result, "payload.result", 32768);
		if (typeof payload.truncated !== "boolean") throw new FleetA2AError("invalid-payload", "payload.truncated must be boolean");
		if (payload.errorCode !== null) identifier$2(payload.errorCode, "payload.errorCode");
		return;
	}
	if (kind === "approval.request") {
		exactPayload(payload, [
			"approvalId",
			"taskId",
			"summary",
			"expiresAt"
		], kind);
		messageId(payload.approvalId, "payload.approvalId", "approval");
		taskId(payload.taskId);
		longText(payload.summary, "payload.summary", 2048);
		canonicalTime(payload.expiresAt, "payload.expiresAt");
		return;
	}
	if (kind === "approval.decision") {
		exactPayload(payload, [
			"approvalId",
			"taskId",
			"decision"
		], kind);
		messageId(payload.approvalId, "payload.approvalId", "approval");
		taskId(payload.taskId);
		if (!["approved", "denied"].includes(text$1(payload.decision, "payload.decision", 16))) throw new FleetA2AError("invalid-payload", "approval decision is invalid");
		return;
	}
	if (kind === "receipt") {
		exactPayload(payload, ["requestMessageId", "status"], kind);
		messageId(payload.requestMessageId, "payload.requestMessageId", "msg");
		if (!["accepted", "stored"].includes(text$1(payload.status, "payload.status", 16))) throw new FleetA2AError("invalid-payload", "receipt status is invalid");
		return;
	}
	exactPayload(payload, [
		"handoffId",
		"taskId",
		"summary",
		"artifactRefs"
	], kind);
	messageId(payload.handoffId, "payload.handoffId", "handoff");
	if (payload.taskId !== null) taskId(payload.taskId);
	longText(payload.summary, "payload.summary", 8192);
	if (!Array.isArray(payload.artifactRefs) || payload.artifactRefs.length > 32 || payload.artifactRefs.some((ref) => {
		try {
			text$1(ref, "payload.artifactRefs[]", 512);
			return false;
		} catch {
			return true;
		}
	})) throw new FleetA2AError("invalid-payload", "handoff artifactRefs are invalid");
}
function privateKey(value) {
	const key = value instanceof Object && "type" in value ? value : createPrivateKey(value);
	if (key.asymmetricKeyType !== "ed25519" || key.type !== "private") throw new FleetA2AError("invalid-envelope", "A2A private key must be Ed25519");
	return key;
}
function publicKey(value) {
	const key = createPublicKey(value);
	if (key.asymmetricKeyType !== "ed25519" || key.type !== "public") throw new FleetA2AError("trust-denied", "trusted A2A key must be Ed25519");
	return key;
}
function a2aKeyId(key) {
	const publicObject = key instanceof Object && "type" in key ? key.type === "private" ? createPublicKey(key) : key : createPublicKey(key);
	if (publicObject.asymmetricKeyType !== "ed25519") throw new FleetA2AError("invalid-envelope", "A2A key must be Ed25519");
	const der = publicObject.export({
		type: "spki",
		format: "der"
	});
	return "ed25519:" + sha256Canonical({ der: Buffer.from(der).toString("base64") });
}
function nowIso(value) {
	const date = value === void 0 ? /* @__PURE__ */ new Date() : value instanceof Date ? new Date(value.getTime()) : new Date(value);
	if (!Number.isFinite(date.getTime())) throw new FleetA2AError("invalid-time", "now must be a valid timestamp");
	return date.toISOString();
}
function createA2AEnvelope(input) {
	if (!FLEET_A2A_KINDS.includes(input.kind)) throw new FleetA2AError("invalid-payload", "unsupported A2A kind");
	validateA2APayload(input.kind, input.payload);
	const key = privateKey(input.privateKey);
	const issuedAt = nowIso(input.now);
	const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
	boundedInteger(ttlMs, "ttlMs", 1e3, DEFAULT_MAX_TTL_MS);
	const body = {
		schemaVersion: 1,
		teamId: identifier$2(input.teamId, "teamId"),
		messageId: input.messageId === void 0 ? "msg:" + randomUUID() : messageId(input.messageId, "messageId", "msg"),
		sender: {
			principalId: identifier$2(input.sender.principalId, "sender.principalId"),
			deviceId: normalizeDeviceId(input.sender.deviceId, "sender.deviceId"),
			keyId: a2aKeyId(key)
		},
		recipient: { deviceId: normalizeDeviceId(input.recipient.deviceId, "recipient.deviceId") },
		kind: input.kind,
		issuedAt,
		expiresAt: new Date(Date.parse(issuedAt) + ttlMs).toISOString(),
		payloadDigest: sha256Canonical(input.payload),
		payload: input.payload
	};
	const signature = sign(null, Buffer.from(canonicalJson(body), "utf8"), key).toString("base64url");
	return {
		...body,
		signature
	};
}
function trustEntry$1(trust, keyId) {
	if (typeof trust.get === "function") return trust.get(keyId);
	return trust[keyId];
}
function verifyA2AEnvelope(value, input) {
	exactKeys$2(value, ENVELOPE_KEYS, "A2A envelope");
	const envelope = value;
	if (envelope.schemaVersion !== 1 || !FLEET_A2A_KINDS.includes(envelope.kind)) throw new FleetA2AError("invalid-envelope", "unsupported A2A envelope version or kind");
	exactKeys$2(envelope.sender, SENDER_KEYS, "sender");
	exactKeys$2(envelope.recipient, RECIPIENT_KEYS, "recipient");
	identifier$2(envelope.teamId, "teamId");
	messageId(envelope.messageId, "messageId", "msg");
	identifier$2(envelope.sender.principalId, "sender.principalId");
	normalizeDeviceId(envelope.sender.deviceId, "sender.deviceId");
	normalizeDeviceId(envelope.recipient.deviceId, "recipient.deviceId");
	if (!/^ed25519:[0-9a-f]{64}$/.test(envelope.sender.keyId)) throw new FleetA2AError("invalid-envelope", "sender.keyId is invalid");
	digest(envelope.payloadDigest, "payloadDigest");
	validateA2APayload(envelope.kind, envelope.payload);
	if (sha256Canonical(envelope.payload) !== envelope.payloadDigest) throw new FleetA2AError("signature-invalid", "A2A payload digest does not match");
	const issuedAt = canonicalTime(envelope.issuedAt, "issuedAt");
	const expiresAt = canonicalTime(envelope.expiresAt, "expiresAt");
	const now = Date.parse(nowIso(input.now));
	const maxTtlMs = input.maxTtlMs ?? DEFAULT_MAX_TTL_MS;
	boundedInteger(maxTtlMs, "maxTtlMs", 1e3, 864e5);
	if (expiresAt <= issuedAt || expiresAt - issuedAt > maxTtlMs || issuedAt > now + 3e4) throw new FleetA2AError("invalid-time", "A2A envelope validity window is invalid");
	if (now >= expiresAt) throw new FleetA2AError("message-expired", "A2A envelope has expired");
	if (envelope.teamId !== input.expectedTeamId || envelope.recipient.deviceId !== input.expectedDeviceId) throw new FleetA2AError("recipient-mismatch", "A2A envelope targets a different team or device");
	const trusted = trustEntry$1(input.trust, envelope.sender.keyId);
	if (trusted === void 0 || trusted.principalId !== envelope.sender.principalId || trusted.deviceId !== envelope.sender.deviceId || !trusted.allowedKinds.includes(envelope.kind)) throw new FleetA2AError("trust-denied", "A2A sender is not trusted for this message kind");
	if (a2aKeyId(trusted.publicKeyPem) !== trusted.keyId || trusted.keyId !== envelope.sender.keyId) throw new FleetA2AError("trust-denied", "A2A trust entry key identity is invalid");
	if (typeof envelope.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) throw new FleetA2AError("signature-invalid", "A2A signature encoding is invalid");
	const signature = Buffer.from(envelope.signature, "base64url");
	const body = Object.fromEntries(BODY_KEYS.map((key) => [key, envelope[key]]));
	if (!verify(null, Buffer.from(canonicalJson(body), "utf8"), publicKey(trusted.publicKeyPem), signature)) throw new FleetA2AError("signature-invalid", "A2A signature is invalid");
	return envelope;
}
//#endregion
//#region src/a2a/runtime.ts
var FleetA2ARuntimeError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "FleetA2ARuntimeError";
		this.code = code;
	}
};
function hash(value) {
	return createHash("sha256").update(value, "utf8").digest("hex");
}
async function ensureDirectory(path) {
	await mkdir(path, {
		recursive: true,
		mode: 448
	});
}
async function atomicJson(path, value) {
	await ensureDirectory(dirname(path));
	const temporary = path + "." + randomUUID() + ".tmp";
	let handle;
	try {
		handle = await open(temporary, "wx", 384);
		await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
		await handle.sync();
		await handle.close();
		handle = void 0;
		await rename(temporary, path);
	} catch (error) {
		await handle?.close();
		await rm(temporary, { force: true });
		throw error;
	}
}
async function atomicText(path, value) {
	await ensureDirectory(dirname(path));
	const temporary = path + "." + randomUUID() + ".tmp";
	let handle;
	try {
		handle = await open(temporary, "wx", 384);
		await handle.writeFile(value);
		await handle.sync();
		await handle.close();
		handle = void 0;
		await rename(temporary, path);
	} catch (error) {
		await handle?.close();
		await rm(temporary, { force: true });
		throw error;
	}
}
async function readRegularFile$1(path, privateFile = false) {
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		const info = await handle.stat();
		if (!info.isFile()) throw new FleetA2ARuntimeError("unsafe-state-file", "A2A state accepts regular files only");
		if (privateFile && (info.mode & 63) !== 0) throw new FleetA2ARuntimeError("unsafe-key-permissions", "A2A private key must not be accessible by group or others");
		return await handle.readFile("utf8");
	} catch (error) {
		if (error.code === "ELOOP") throw new FleetA2ARuntimeError("unsafe-state-file", "A2A state accepts regular files only");
		throw error;
	} finally {
		await handle?.close();
	}
}
function exactKeys$1(value, keys, field) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new FleetA2ARuntimeError("invalid-config", field + " must be an object");
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new FleetA2ARuntimeError("invalid-config", field + " has unsupported or missing fields");
}
async function readA2ATrustStore(config) {
	const raw = JSON.parse(await readRegularFile$1(config.a2a.trustStorePath));
	exactKeys$1(raw, [
		"schemaVersion",
		"teamId",
		"entries"
	], "trust store");
	if (raw.schemaVersion !== 1 || raw.teamId !== config.a2a.teamId || !Array.isArray(raw.entries)) throw new FleetA2ARuntimeError("invalid-config", "trust store schema or team identity is invalid");
	const trust = /* @__PURE__ */ new Map();
	for (let index = 0; index < raw.entries.length; index += 1) {
		const entry = raw.entries[index];
		exactKeys$1(entry, [
			"keyId",
			"principalId",
			"deviceId",
			"publicKeyPem",
			"allowedKinds"
		], `trust store entries[${index}]`);
		if (typeof entry.keyId !== "string" || typeof entry.principalId !== "string" || typeof entry.deviceId !== "string" || typeof entry.publicKeyPem !== "string" || !Array.isArray(entry.allowedKinds) || entry.allowedKinds.some((kind) => typeof kind !== "string" || !FLEET_A2A_KINDS.includes(kind))) throw new FleetA2ARuntimeError("invalid-config", "trust store entry is invalid");
		if (!/^ed25519:[0-9a-f]{64}$/.test(entry.keyId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.principalId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.deviceId) || new Set(entry.allowedKinds).size !== entry.allowedKinds.length) throw new FleetA2ARuntimeError("invalid-config", "trust store entry identity or capabilities are invalid");
		try {
			if (a2aKeyId(entry.publicKeyPem) !== entry.keyId) throw new Error("key mismatch");
		} catch {
			throw new FleetA2ARuntimeError("invalid-config", "trust store entry key identity is invalid");
		}
		if (trust.has(entry.keyId)) throw new FleetA2ARuntimeError("invalid-config", "trust store key ids must be unique");
		trust.set(entry.keyId, entry);
	}
	return trust;
}
async function privateKeyPem(config) {
	return readRegularFile$1(config.a2a.privateKeyPath, true);
}
async function signA2AMessage(config, recipientDeviceId, kind, payload, now = /* @__PURE__ */ new Date()) {
	assertA2AReadyConfig(config);
	return createA2AEnvelope({
		teamId: config.a2a.teamId,
		sender: {
			principalId: config.a2a.principalId,
			deviceId: config.deviceId
		},
		recipient: { deviceId: recipientDeviceId },
		kind,
		payload,
		privateKey: await privateKeyPem(config),
		now,
		ttlMs: Math.min(3e5, config.a2a.maxMessageTtlMs)
	});
}
async function verifyA2AMessage(config, value, now = /* @__PURE__ */ new Date()) {
	assertA2AReadyConfig(config);
	return verifyA2AEnvelope(value, {
		expectedTeamId: config.a2a.teamId,
		expectedDeviceId: config.deviceId,
		trust: await readA2ATrustStore(config),
		now,
		maxTtlMs: config.a2a.maxMessageTtlMs
	});
}
function taskSegment(taskId) {
	const match = /^task:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(taskId);
	if (match?.[1] === void 0) throw new FleetA2ARuntimeError("invalid-task-id", "task id is invalid");
	return match[1];
}
function taskDirectory(config, taskId) {
	return join(config.stateDir, "tasks", taskSegment(taskId));
}
const TASK_STATES = /* @__PURE__ */ new Set([
	"accepted",
	"running",
	"cancel-requested",
	"succeeded",
	"failed",
	"cancelled"
]);
function stateRecord(value, keys, field) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new FleetA2ARuntimeError("invalid-task-state", field + " must be an object");
	const raw = value;
	const actual = Object.keys(raw).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new FleetA2ARuntimeError("invalid-task-state", field + " has unsupported or missing fields");
	return raw;
}
function stateText(value, field, max = 128) {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > max || /[\r\n\0]/.test(value)) throw new FleetA2ARuntimeError("invalid-task-state", field + " is invalid");
	return value;
}
function stateTime(value, field) {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) throw new FleetA2ARuntimeError("invalid-task-state", field + " is invalid");
	return value;
}
function stateDigest(value, field, nullable = false) {
	if (nullable && value === null) return null;
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new FleetA2ARuntimeError("invalid-task-state", field + " is invalid");
	return value;
}
function parseTaskRecord(value, expectedTaskId) {
	const raw = stateRecord(value, [
		"schemaVersion",
		"taskId",
		"requestMessageId",
		"senderDeviceId",
		"senderPrincipalId",
		"workspaceId",
		"profile",
		"promptDigest",
		"state",
		"createdAt",
		"updatedAt",
		"deadlineAt",
		"resultDigest",
		"errorCode"
	], "task record");
	const taskId = stateText(raw.taskId, "task record.taskId");
	taskSegment(taskId);
	const state = stateText(raw.state, "task record.state", 24);
	if (raw.schemaVersion !== 1 || taskId !== expectedTaskId || !TASK_STATES.has(state)) throw new FleetA2ARuntimeError("invalid-task-state", "task record identity, schema or state is invalid");
	const errorCode = raw.errorCode === null ? null : stateText(raw.errorCode, "task record.errorCode", 64);
	return {
		schemaVersion: 1,
		taskId,
		requestMessageId: stateText(raw.requestMessageId, "task record.requestMessageId", 64),
		senderDeviceId: stateText(raw.senderDeviceId, "task record.senderDeviceId", 64),
		senderPrincipalId: stateText(raw.senderPrincipalId, "task record.senderPrincipalId", 64),
		workspaceId: stateText(raw.workspaceId, "task record.workspaceId", 64),
		profile: stateText(raw.profile, "task record.profile", 64),
		promptDigest: stateDigest(raw.promptDigest, "task record.promptDigest"),
		state,
		createdAt: stateTime(raw.createdAt, "task record.createdAt"),
		updatedAt: stateTime(raw.updatedAt, "task record.updatedAt"),
		deadlineAt: stateTime(raw.deadlineAt, "task record.deadlineAt"),
		resultDigest: stateDigest(raw.resultDigest, "task record.resultDigest", true),
		errorCode
	};
}
function parseTaskRequest(value, expectedTaskId) {
	const raw = stateRecord(value, [
		"schemaVersion",
		"taskId",
		"requestMessageId",
		"senderDeviceId",
		"senderPrincipalId",
		"workspaceId",
		"profile",
		"promptDigest",
		"prompt"
	], "task request");
	if (raw.schemaVersion !== 1 || raw.taskId !== expectedTaskId || typeof raw.prompt !== "string" || raw.prompt.length === 0 || raw.prompt.includes("\0")) throw new FleetA2ARuntimeError("invalid-task-state", "task request identity, schema or prompt is invalid");
	const promptDigest = stateDigest(raw.promptDigest, "task request.promptDigest");
	if (hash(raw.prompt) !== promptDigest) throw new FleetA2ARuntimeError("invalid-task-state", "task request prompt digest is invalid");
	return {
		schemaVersion: 1,
		taskId: expectedTaskId,
		requestMessageId: stateText(raw.requestMessageId, "task request.requestMessageId", 64),
		senderDeviceId: stateText(raw.senderDeviceId, "task request.senderDeviceId", 64),
		senderPrincipalId: stateText(raw.senderPrincipalId, "task request.senderPrincipalId", 64),
		workspaceId: stateText(raw.workspaceId, "task request.workspaceId", 64),
		profile: stateText(raw.profile, "task request.profile", 64),
		promptDigest,
		prompt: raw.prompt
	};
}
async function readTaskRecord(config, taskId) {
	try {
		return parseTaskRecord(JSON.parse(await readRegularFile$1(join(taskDirectory(config, taskId), "record.json"))), taskId);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
async function readTaskRequest(config, taskId) {
	try {
		return parseTaskRequest(JSON.parse(await readRegularFile$1(join(taskDirectory(config, taskId), "request.json"))), taskId);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
async function saveTaskRecord(config, record, state, fields = {}) {
	const next = {
		...record,
		...fields,
		state,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	await atomicJson(join(taskDirectory(config, record.taskId), "record.json"), next);
	return next;
}
function workerPayload(record, result) {
	if (record.state === "accepted" || record.state === "running" || record.state === "cancel-requested") return {
		kind: "task.progress",
		payload: {
			taskId: record.taskId,
			state: record.state,
			updatedAt: record.updatedAt
		}
	};
	const preview = result === null || result.trim().length === 0 ? null : result.slice(0, 32768);
	return {
		kind: "task.result",
		payload: {
			taskId: record.taskId,
			state: record.state,
			updatedAt: record.updatedAt,
			resultDigest: record.resultDigest,
			result: preview,
			truncated: result !== null && result.length > 32768,
			errorCode: record.errorCode
		}
	};
}
async function taskResult(config, taskId) {
	let record = await readTaskRecord(config, taskId);
	if (record === null) throw new FleetA2ARuntimeError("task-not-found", "task was not found");
	let result = null;
	try {
		result = await readRegularFile$1(join(taskDirectory(config, taskId), "result.txt"));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (record.state === "accepted" || record.state === "running" || record.state === "cancel-requested") {
		const workerActive = await processLockActive(join(taskDirectory(config, taskId), "worker.lock"));
		if (!workerActive && result !== null && record.state !== "accepted") record = await saveTaskRecord(config, record, "succeeded", {
			resultDigest: hash(result),
			errorCode: null
		});
		else if (!workerActive && record.state === "cancel-requested" && existsSync(join(taskDirectory(config, taskId), "cancel"))) record = await saveTaskRecord(config, record, "cancelled", { errorCode: "cancelled" });
		else if (!workerActive && (record.state === "running" || Date.now() > Date.parse(record.deadlineAt) + 3e4)) record = await saveTaskRecord(config, record, "failed", { errorCode: "worker-lost" });
	}
	return {
		record,
		result
	};
}
async function launchTaskWorker(launch, taskId) {
	const child = spawn(launch.nodeBinary, [
		launch.agentPath,
		"--config",
		launch.configPath,
		"task-worker"
	], {
		detached: process.platform !== "win32",
		stdio: [
			"pipe",
			"ignore",
			"ignore"
		],
		shell: false,
		env: {
			...process.env,
			GIT_TERMINAL_PROMPT: "0"
		}
	});
	child.stdin.on("error", () => void 0);
	child.stdin.end(JSON.stringify({ taskId }) + "\n");
	child.unref();
}
async function staleProcessLock(path) {
	let source;
	try {
		source = await readRegularFile$1(path);
	} catch (error) {
		if (error.code === "ENOENT") return true;
		throw error;
	}
	try {
		const owner = JSON.parse(source);
		if (typeof owner.pid === "number" && Number.isSafeInteger(owner.pid) && owner.pid > 0 && typeof owner.token === "string") return !await processAlive(owner.pid);
	} catch {}
	const info = await lstat(path);
	return Date.now() - info.mtimeMs > 3e4;
}
async function acquireProcessLock(path, busyCode, busyMessage) {
	await ensureDirectory(dirname(path));
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const token = randomUUID();
		let handle;
		try {
			handle = await open(path, "wx", 384);
			await handle.writeFile(JSON.stringify({
				pid: process.pid,
				token,
				at: (/* @__PURE__ */ new Date()).toISOString()
			}) + "\n");
			await handle.sync();
			return {
				path,
				token
			};
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			if (!await staleProcessLock(path)) throw new FleetA2ARuntimeError(busyCode, busyMessage);
			await rm(path, { force: true });
		} finally {
			await handle?.close();
		}
	}
	throw new FleetA2ARuntimeError(busyCode, busyMessage);
}
async function releaseProcessLock(lock) {
	try {
		if (JSON.parse(await readRegularFile$1(lock.path)).token === lock.token) await rm(lock.path, { force: true });
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
}
async function processLockActive(path) {
	try {
		if (!await staleProcessLock(path)) return true;
		await rm(path, { force: true });
		return false;
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}
function taskMatchesEnvelope(record, envelope, payload) {
	return record.promptDigest === hash(payload.prompt) && record.senderDeviceId === envelope.sender.deviceId && record.senderPrincipalId === envelope.sender.principalId && record.workspaceId === payload.workspaceId && record.profile === payload.profile;
}
async function acceptTask(config, envelope, launch) {
	if (!config.tasks.enabled) throw new FleetA2ARuntimeError("tasks-disabled", "remote tasks are disabled on this device");
	const payload = envelope.payload;
	if (config.tasks.workspaces[payload.workspaceId] === void 0 || !config.tasks.profiles.includes(payload.profile)) throw new FleetA2ARuntimeError("task-policy-denied", "task workspace or profile is not allowed by local policy");
	const directory = taskDirectory(config, payload.taskId);
	const promptDigest = hash(payload.prompt);
	await ensureDirectory(directory);
	let creationLock;
	try {
		creationLock = await acquireProcessLock(join(directory, "create.lock"), "task-in-progress", "task creation is already in progress");
	} catch (error) {
		if (error.code !== "task-in-progress") throw error;
		for (let attempt = 0; attempt < 40; attempt += 1) {
			const existing = await readTaskRecord(config, payload.taskId);
			if (existing !== null) {
				if (!taskMatchesEnvelope(existing, envelope, payload)) throw new FleetA2ARuntimeError("task-id-conflict", "task id is already bound to a different request");
				return existing;
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw error;
	}
	try {
		const existing = await readTaskRecord(config, payload.taskId);
		if (existing !== null) {
			if (!taskMatchesEnvelope(existing, envelope, payload)) throw new FleetA2ARuntimeError("task-id-conflict", "task id is already bound to a different request");
			return existing;
		}
		const storedRequest = await readTaskRequest(config, payload.taskId);
		if (storedRequest !== null && (storedRequest.promptDigest !== promptDigest || storedRequest.prompt !== payload.prompt || storedRequest.senderDeviceId !== envelope.sender.deviceId || storedRequest.senderPrincipalId !== envelope.sender.principalId || storedRequest.workspaceId !== payload.workspaceId || storedRequest.profile !== payload.profile)) throw new FleetA2ARuntimeError("task-id-conflict", "task id is already bound to a different request");
		const request = storedRequest ?? {
			schemaVersion: 1,
			taskId: payload.taskId,
			requestMessageId: envelope.messageId,
			senderDeviceId: envelope.sender.deviceId,
			senderPrincipalId: envelope.sender.principalId,
			workspaceId: payload.workspaceId,
			profile: payload.profile,
			promptDigest,
			prompt: payload.prompt
		};
		if (storedRequest === null) await atomicJson(join(directory, "request.json"), request);
		const createdAt = (/* @__PURE__ */ new Date()).toISOString();
		const record = {
			schemaVersion: 1,
			taskId: payload.taskId,
			requestMessageId: request.requestMessageId,
			senderDeviceId: request.senderDeviceId,
			senderPrincipalId: request.senderPrincipalId,
			workspaceId: request.workspaceId,
			profile: request.profile,
			promptDigest: request.promptDigest,
			state: "accepted",
			createdAt,
			updatedAt: createdAt,
			deadlineAt: new Date(Date.parse(createdAt) + config.tasks.timeoutMs).toISOString(),
			resultDigest: null,
			errorCode: null
		};
		await atomicJson(join(directory, "record.json"), record);
		await launchTaskWorker(launch, payload.taskId);
		return record;
	} finally {
		await releaseProcessLock(creationLock);
	}
}
async function requestCancellation(config, taskId) {
	const record = await readTaskRecord(config, taskId);
	if (record === null) throw new FleetA2ARuntimeError("task-not-found", "task was not found");
	if (record.state === "succeeded" || record.state === "failed" || record.state === "cancelled") return record;
	const marker = join(taskDirectory(config, taskId), "cancel");
	let handle;
	try {
		handle = await open(marker, "wx", 384);
		await handle.writeFile((/* @__PURE__ */ new Date()).toISOString() + "\n");
		await handle.sync();
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
	} finally {
		await handle?.close();
	}
	return saveTaskRecord(config, record, "cancel-requested");
}
async function receiptResponse(config, envelope, launch, now) {
	let response;
	if (envelope.kind === "task.submit") response = workerPayload(await acceptTask(config, envelope, launch), null);
	else if (envelope.kind === "task.status") {
		const { record, result } = await taskResult(config, envelope.payload.taskId);
		response = workerPayload(record, result);
	} else if (envelope.kind === "task.cancel") response = workerPayload(await requestCancellation(config, envelope.payload.taskId), null);
	else {
		await atomicJson(join(config.stateDir, "a2a", "inbox", hash(envelope.messageId) + ".json"), envelope);
		response = {
			kind: "receipt",
			payload: {
				requestMessageId: envelope.messageId,
				status: envelope.kind === "handoff" ? "stored" : "accepted"
			}
		};
	}
	return createA2AEnvelope({
		teamId: config.a2a.teamId,
		sender: {
			principalId: config.a2a.principalId,
			deviceId: config.deviceId
		},
		recipient: { deviceId: envelope.sender.deviceId },
		kind: response.kind,
		payload: response.payload,
		privateKey: await privateKeyPem(config),
		now,
		ttlMs: Math.min(3e5, config.a2a.maxMessageTtlMs)
	});
}
async function receiveA2AMessage(config, value, launch, now = /* @__PURE__ */ new Date()) {
	assertA2AReadyConfig(config);
	const envelope = await verifyA2AMessage(config, value, now);
	const receiptPath = join(config.stateDir, "a2a", "receipts", hash(envelope.messageId) + ".json");
	const lockPath = receiptPath + ".lock";
	try {
		return JSON.parse(await readRegularFile$1(receiptPath));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const lock = await acquireProcessLock(lockPath, "message-in-progress", "A2A message is already being processed");
	try {
		try {
			return JSON.parse(await readRegularFile$1(receiptPath));
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		const response = await receiptResponse(config, envelope, launch, now);
		const receipt = {
			requestMessageId: envelope.messageId,
			response
		};
		await atomicJson(receiptPath, receipt);
		return receipt;
	} finally {
		await releaseProcessLock(lock);
	}
}
function taskEnvironment(config) {
	const path = [
		dirname(config.dshBinary),
		dirname(process.execPath),
		"/opt/homebrew/bin",
		"/usr/bin",
		"/bin"
	].join(":");
	const env = {
		DSH_HOME: config.dshHome,
		PATH: path,
		GIT_TERMINAL_PROMPT: "0"
	};
	for (const key of [
		"HOME",
		"USER",
		"LOGNAME",
		"TMPDIR",
		"LANG",
		"LC_ALL",
		"SHELL",
		"TERM"
	]) if (process.env[key] !== void 0) env[key] = process.env[key];
	return env;
}
async function runTaskProcess(config, request, cancelPath) {
	const workspace = config.tasks.workspaces[request.workspaceId];
	if (workspace === void 0 || !config.tasks.profiles.includes(request.profile)) throw new FleetA2ARuntimeError("task-policy-denied", "task no longer matches local policy");
	const workspaceInfo = await lstat(workspace).catch(() => void 0);
	if (workspaceInfo === void 0) throw new FleetA2ARuntimeError("task-policy-denied", "task workspace is unavailable");
	if (workspaceInfo.isSymbolicLink() || !workspaceInfo.isDirectory()) throw new FleetA2ARuntimeError("task-policy-denied", "task workspace must be a real directory");
	return new Promise((resolve, reject) => {
		const grouped = process.platform !== "win32";
		const child = spawn(config.dshBinary, [
			"--profile",
			request.profile,
			request.prompt
		], {
			cwd: workspace,
			env: taskEnvironment(config),
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			shell: false,
			detached: grouped
		});
		let stdout = "";
		let bytes = 0;
		let reason;
		let settled = false;
		const kill = (signal) => {
			try {
				if (grouped && child.pid !== void 0) process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch (error) {
				if (error.code !== "ESRCH") throw error;
			}
		};
		const stop = (next) => {
			if (reason !== void 0 || settled) return;
			reason = next;
			kill("SIGTERM");
			forceTimer = setTimeout(() => kill("SIGKILL"), 2e3);
			forceTimer.unref();
		};
		const timeout = setTimeout(() => stop("timeout"), config.tasks.timeoutMs);
		timeout.unref();
		const cancel = setInterval(() => {
			if (existsSync(cancelPath)) stop("cancelled");
		}, 200);
		cancel.unref();
		let forceTimer;
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			const remaining = config.tasks.maxOutputBytes - bytes;
			if (remaining > 0) stdout += Buffer.from(chunk).subarray(0, remaining).toString("utf8");
			bytes += Buffer.byteLength(chunk);
			if (bytes > config.tasks.maxOutputBytes) stop("output-limit");
		});
		child.stderr.on("data", (chunk) => {
			bytes += chunk.length;
			if (bytes > config.tasks.maxOutputBytes) stop("output-limit");
		});
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			clearInterval(cancel);
			if (forceTimer !== void 0) clearTimeout(forceTimer);
			reject(error);
		});
		child.once("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			clearInterval(cancel);
			if (forceTimer !== void 0) clearTimeout(forceTimer);
			resolve({
				stdout,
				code: code ?? 1,
				...reason === void 0 ? {} : { reason }
			});
		});
	});
}
async function processAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code !== "ESRCH";
	}
}
async function acquireTaskSlot(config, taskId) {
	const directory = join(config.stateDir, "tasks", ".slots");
	await ensureDirectory(directory);
	const token = randomUUID();
	for (;;) {
		for (let index = 0; index < config.tasks.maxConcurrent; index += 1) {
			const path = join(directory, String(index) + ".lock");
			try {
				const handle = await open(path, "wx", 384);
				await handle.writeFile(JSON.stringify({
					pid: process.pid,
					taskId,
					token
				}) + "\n");
				await handle.close();
				return {
					path,
					token
				};
			} catch (error) {
				if (error.code !== "EEXIST") throw error;
				try {
					if (await staleProcessLock(path)) await rm(path, { force: true });
				} catch (readError) {
					if (readError.code === "ENOENT") continue;
					throw readError;
				}
			}
		}
		if (existsSync(join(taskDirectory(config, taskId), "cancel"))) throw new FleetA2ARuntimeError("task-cancelled", "task was cancelled while queued");
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}
async function runTaskWorker(config, taskId) {
	assertA2AReadyConfig(config);
	const directory = taskDirectory(config, taskId);
	const workerLock = join(directory, "worker.lock");
	try {
		if (await readTaskRecord(config, taskId) === null) throw new FleetA2ARuntimeError("task-not-found", "task was not found");
	} catch (error) {
		throw error;
	}
	let worker;
	try {
		worker = await acquireProcessLock(workerLock, "worker-in-progress", "task worker is already running");
	} catch (error) {
		if (error.code === "worker-in-progress") {
			const existing = await readTaskRecord(config, taskId);
			if (existing === null) throw new FleetA2ARuntimeError("task-not-found", "task was not found");
			return existing;
		}
		throw error;
	}
	let slot;
	try {
		let record = await readTaskRecord(config, taskId);
		if (record === null) throw new FleetA2ARuntimeError("task-not-found", "task was not found");
		if ([
			"succeeded",
			"failed",
			"cancelled"
		].includes(record.state)) return record;
		const request = await readTaskRequest(config, taskId);
		if (request === null || request.requestMessageId !== record.requestMessageId || request.senderDeviceId !== record.senderDeviceId || request.senderPrincipalId !== record.senderPrincipalId || request.workspaceId !== record.workspaceId || request.profile !== record.profile || request.promptDigest !== record.promptDigest) throw new FleetA2ARuntimeError("task-request-mismatch", "task request does not match its durable record");
		const cancelPath = join(directory, "cancel");
		if (existsSync(cancelPath)) return saveTaskRecord(config, record, "cancelled", { errorCode: "cancelled" });
		slot = await acquireTaskSlot(config, taskId);
		if (existsSync(cancelPath)) return saveTaskRecord(config, record, "cancelled", { errorCode: "cancelled" });
		record = await saveTaskRecord(config, record, "running");
		const result = await runTaskProcess(config, request, cancelPath);
		if (result.reason === "cancelled") return saveTaskRecord(config, record, "cancelled", { errorCode: "cancelled" });
		if (result.reason !== void 0) return saveTaskRecord(config, record, "failed", { errorCode: result.reason });
		if (result.code !== 0) return saveTaskRecord(config, record, "failed", { errorCode: "dsh-task-failed" });
		await atomicText(join(directory, "result.txt"), result.stdout);
		return saveTaskRecord(config, record, "succeeded", {
			resultDigest: hash(result.stdout),
			errorCode: null
		});
	} catch (error) {
		const record = await readTaskRecord(config, taskId);
		if (record === null || [
			"succeeded",
			"failed",
			"cancelled"
		].includes(record.state)) throw error;
		const code = typeof error.code === "string" ? error.code : "task-worker-failed";
		return saveTaskRecord(config, record, code === "task-cancelled" ? "cancelled" : "failed", { errorCode: code });
	} finally {
		if (slot !== void 0) try {
			if (JSON.parse(await readRegularFile$1(slot.path)).token === slot.token) await rm(slot.path, { force: true });
		} catch {}
		await releaseProcessLock(worker);
	}
}
async function resumeAcceptedTasks(config, launch) {
	assertA2AReadyConfig(config);
	const root = join(config.stateDir, "tasks");
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return 0;
		throw error;
	}
	let resumed = 0;
	for (const entry of entries) {
		if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
		const taskId = "task:" + entry.name;
		const record = await readTaskRecord(config, taskId);
		if (record === null || ![
			"accepted",
			"running",
			"cancel-requested"
		].includes(record.state)) continue;
		if (await processLockActive(join(taskDirectory(config, taskId), "worker.lock"))) continue;
		if (record.state === "accepted" && Date.now() <= Date.parse(record.deadlineAt) + 3e4) {
			await launchTaskWorker(launch, taskId);
			resumed += 1;
		} else await taskResult(config, taskId);
	}
	return resumed;
}
//#endregion
//#region src/agent/doctor.ts
function assertDoctorReady(config) {
	assertReleaseReadyConfig(config);
	assertA2AReadyConfig(config);
}
async function requireExecutable(path, id) {
	const info = await lstat(path);
	if (!info.isFile() && !info.isSymbolicLink()) throw new TypeError(id + " executable path is not a file");
	await access(path, constants.X_OK);
	return id;
}
async function requireRealDirectory(path, id) {
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isDirectory()) throw new TypeError(id + " must be a real directory");
}
async function doctorAgent(config, now = /* @__PURE__ */ new Date(), signal) {
	assertDoctorReady(config);
	const executablePaths = [
		["dsh", config.dshBinary],
		["pnpm", config.pnpmBinary],
		["tar", config.tarBinary]
	];
	if (config.restart.kind === "screen") executablePaths.push(["screen", config.restart.screenBinary], ["lsof", config.restart.lsofBinary], ["ps", config.restart.psBinary]);
	else executablePaths.push(["launchctl", config.restart.launchctlBinary], ["lsof", config.restart.lsofBinary], ["ps", config.restart.psBinary]);
	const executableChecks = await Promise.all(executablePaths.map(([id, path]) => requireExecutable(path, id)));
	await requireRealDirectory(config.artifactStore, "artifactStore");
	for (const [workspaceId, path] of Object.entries(config.tasks.workspaces)) await requireRealDirectory(path, "workspace " + workspaceId);
	const trust = await readA2ATrustStore(config);
	const identityProbe = await signA2AMessage(config, config.deviceId, "handoff", {
		handoffId: "handoff:" + randomUUID(),
		taskId: null,
		summary: "dsh-fleet doctor identity check",
		artifactRefs: []
	}, now);
	const inspection = await inspectReleaseAgent(config, now, signal);
	await verifyReleaseAgentHealth(config, signal);
	return {
		protocolVersion: 1,
		ready: true,
		deviceId: config.deviceId,
		profile: config.profile,
		releaseId: inspection.assignedRelease.releaseId,
		releaseVersion: inspection.assignedRelease.releaseVersion,
		healthVerified: true,
		identityKeyId: identityProbe.sender.keyId,
		trustedPeerCount: trust.size,
		tasksEnabled: config.tasks.enabled,
		workspaceIds: Object.keys(config.tasks.workspaces).sort(),
		executableChecks
	};
}
//#endregion
//#region src/bootstrap/team-pack.ts
const FEDERATION_KINDS = /* @__PURE__ */ new Set([
	"handoff",
	"approval.request",
	"approval.decision",
	"receipt"
]);
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value, allowed, field) {
	const extras = Object.keys(value).filter((key) => !allowed.includes(key));
	if (extras.length > 0) throw new TypeError(field + " contains unsupported fields: " + extras.sort().join(", "));
}
function text(value, field, max = 128) {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > max || /[\r\n\0]/.test(value)) throw new TypeError(field + " must be a bounded trimmed string");
	return value;
}
function publicKeyText(value, field) {
	if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\0")) throw new TypeError(field + " must be a bounded PEM public key");
	const pem = value.replace(/\r\n/g, "\n").trim();
	if (!pem.startsWith("-----BEGIN PUBLIC KEY-----\n") || !pem.endsWith("\n-----END PUBLIC KEY-----")) throw new TypeError(field + " must be a PEM public key");
	return pem + "\n";
}
function identifier$1(value, field) {
	const id = text(value, field, 64);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new TypeError(field + " contains unsupported characters");
	return id;
}
function packageId(value, field) {
	const id = text(value, field, 214);
	if (id !== id.toLowerCase() || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(id)) throw new TypeError(field + " must be a literal lowercase npm package name");
	return id;
}
function exactVersion(value, field) {
	const version = text(value, field, 128);
	if (valid(version) !== version) throw new TypeError(field + " must be an exact semantic version");
	return version;
}
function strings(value, field) {
	if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string")) throw new TypeError(field + " must be a non-empty string array");
	const values = value.map((item, index) => identifier$1(item, `${field}[${index}]`));
	if (new Set(values).size !== values.length) throw new TypeError(field + " must not contain duplicates");
	return values;
}
function runtimeModules(value, field) {
	if (value === void 0) return void 0;
	return strings(value, field);
}
function trustEntry(value, field, federationOnly) {
	if (!isRecord$1(value)) throw new TypeError(field + " must be an object");
	exactKeys(value, [
		"keyId",
		"principalId",
		"deviceId",
		"publicKeyPem",
		"allowedKinds"
	], field);
	const allowedKinds = value.allowedKinds;
	if (!Array.isArray(allowedKinds) || allowedKinds.length === 0 || allowedKinds.some((kind) => typeof kind !== "string" || !FLEET_A2A_KINDS.includes(kind))) throw new TypeError(field + ".allowedKinds is invalid");
	if (federationOnly && allowedKinds.some((kind) => !FEDERATION_KINDS.has(kind))) throw new TypeError(field + " public federation anchors cannot grant task execution");
	if (new Set(allowedKinds).size !== allowedKinds.length) throw new TypeError(field + ".allowedKinds must not contain duplicates");
	const keyId = text(value.keyId, field + ".keyId", 80);
	if (!/^ed25519:[0-9a-f]{64}$/.test(keyId)) throw new TypeError(field + ".keyId is invalid");
	const publicKeyPem = publicKeyText(value.publicKeyPem, field + ".publicKeyPem");
	let derivedKeyId;
	try {
		derivedKeyId = a2aKeyId(publicKeyPem);
	} catch {
		throw new TypeError(field + ".publicKeyPem must contain an Ed25519 public key");
	}
	if (derivedKeyId !== keyId) throw new TypeError(field + ".keyId does not match publicKeyPem");
	return {
		keyId,
		principalId: identifier$1(value.principalId, field + ".principalId"),
		deviceId: identifier$1(value.deviceId, field + ".deviceId"),
		publicKeyPem,
		allowedKinds
	};
}
function parseTeamPack(source) {
	const raw = parse(source);
	if (!isRecord$1(raw)) throw new TypeError("team pack must be an object");
	exactKeys(raw, [
		"schemaVersion",
		"pack",
		"profile",
		"publicPlugins",
		"taskPolicy",
		"trustAnchors"
	], "team pack");
	if (raw.schemaVersion !== 1) throw new TypeError("team pack schemaVersion must equal 1");
	if (!isRecord$1(raw.pack) || !isRecord$1(raw.profile) || !isRecord$1(raw.taskPolicy)) throw new TypeError("team pack sections must be objects");
	exactKeys(raw.pack, ["id", "version"], "pack");
	exactKeys(raw.profile, ["id", "dshRange"], "profile");
	exactKeys(raw.taskPolicy, ["profiles", "workspaceIds"], "taskPolicy");
	if (!Array.isArray(raw.publicPlugins) || raw.publicPlugins.length === 0) throw new TypeError("publicPlugins must be a non-empty array");
	const publicPlugins = raw.publicPlugins.map((value, index) => {
		const field = `publicPlugins[${index}]`;
		if (!isRecord$1(value)) throw new TypeError(field + " must be an object");
		exactKeys(value, [
			"id",
			"source",
			"runtimeModules"
		], field);
		if (!isRecord$1(value.source)) throw new TypeError(field + ".source must be an object");
		const kind = text(value.source.kind, field + ".source.kind");
		let source;
		if (kind === "npm") {
			exactKeys(value.source, [
				"kind",
				"version",
				"integrity"
			], field + ".source");
			const integrity = text(value.source.integrity, field + ".source.integrity", 512);
			if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) throw new TypeError(field + ".source.integrity is invalid");
			source = {
				kind: "npm",
				version: exactVersion(value.source.version, field + ".source.version"),
				integrity
			};
		} else if (kind === "github") {
			exactKeys(value.source, [
				"kind",
				"repository",
				"revision"
			], field + ".source");
			const repository = text(value.source.repository, field + ".source.repository", 256);
			const revision = text(value.source.revision, field + ".source.revision", 40);
			if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[0-9a-f]{40}$/.test(revision)) throw new TypeError(field + ".source must use owner/repository and a lowercase 40-character SHA");
			source = {
				kind: "github",
				repository,
				revision
			};
		} else throw new TypeError(field + ".source.kind must be npm or github");
		const modules = runtimeModules(value.runtimeModules, field + ".runtimeModules");
		return {
			id: packageId(value.id, field + ".id"),
			source,
			...modules === void 0 ? {} : { runtimeModules: modules }
		};
	});
	const ids = publicPlugins.map((plugin) => plugin.id);
	if (new Set(ids).size !== ids.length) throw new TypeError("publicPlugins ids must be unique");
	const trustAnchors = raw.trustAnchors === void 0 ? [] : raw.trustAnchors;
	if (!Array.isArray(trustAnchors)) throw new TypeError("trustAnchors must be an array");
	return {
		schemaVersion: 1,
		pack: {
			id: identifier$1(raw.pack.id, "pack.id"),
			version: exactVersion(raw.pack.version, "pack.version")
		},
		profile: {
			id: identifier$1(raw.profile.id, "profile.id"),
			dshRange: text(raw.profile.dshRange, "profile.dshRange", 256)
		},
		publicPlugins,
		taskPolicy: {
			profiles: strings(raw.taskPolicy.profiles, "taskPolicy.profiles"),
			workspaceIds: strings(raw.taskPolicy.workspaceIds, "taskPolicy.workspaceIds")
		},
		trustAnchors: trustAnchors.map((entry, index) => trustEntry(entry, `trustAnchors[${index}]`, true))
	};
}
function parseTeamOverlay(source) {
	const raw = parse(source);
	if (!isRecord$1(raw)) throw new TypeError("team overlay must be an object");
	exactKeys(raw, [
		"schemaVersion",
		"team",
		"device",
		"release",
		"privatePlugins",
		"workspacePaths",
		"trustedPeers",
		"agent"
	], "team overlay");
	if (raw.schemaVersion !== 1 || !isRecord$1(raw.team) || !isRecord$1(raw.device) || !isRecord$1(raw.release) || !isRecord$1(raw.workspacePaths) || !isRecord$1(raw.agent)) throw new TypeError("team overlay schema or sections are invalid");
	exactKeys(raw.team, ["id", "name"], "team");
	exactKeys(raw.device, [
		"id",
		"assignedTo",
		"class",
		"channel"
	], "device");
	exactKeys(raw.release, ["id", "version"], "release");
	if (raw.device.channel !== "stable") throw new TypeError("device.channel must be stable");
	const privatePluginsRaw = raw.privatePlugins ?? [];
	if (!Array.isArray(privatePluginsRaw)) throw new TypeError("privatePlugins must be an array");
	const privatePlugins = privatePluginsRaw.map((value, index) => {
		const field = `privatePlugins[${index}]`;
		if (!isRecord$1(value)) throw new TypeError(field + " must be an object");
		exactKeys(value, [
			"id",
			"version",
			"digest",
			"runtimeModules"
		], field);
		const digest = text(value.digest, field + ".digest", 64);
		if (!/^[0-9a-f]{64}$/.test(digest)) throw new TypeError(field + ".digest must be lowercase SHA-256");
		const modules = runtimeModules(value.runtimeModules, field + ".runtimeModules");
		return {
			id: packageId(value.id, field + ".id"),
			version: exactVersion(value.version, field + ".version"),
			digest,
			...modules === void 0 ? {} : { runtimeModules: modules }
		};
	});
	const workspacePaths = {};
	for (const [rawId, path] of Object.entries(raw.workspacePaths)) {
		const id = identifier$1(rawId, "workspace id");
		const absolute = text(path, `workspacePaths.${id}`, 1024);
		if (!isAbsolute(absolute) || normalize(absolute) !== absolute) throw new TypeError(`workspacePaths.${id} must be a normalized absolute path`);
		workspacePaths[id] = absolute;
	}
	if (!Array.isArray(raw.trustedPeers)) throw new TypeError("trustedPeers must be an array");
	exactKeys(raw.agent, [
		"dshHome",
		"dshBinary",
		"pnpmBinary",
		"stateDir",
		"artifactStore",
		"tarBinary",
		"planTtlMs",
		"restart",
		"health",
		"maxMessageTtlMs",
		"tasks"
	], "agent");
	if (!isRecord$1(raw.agent.tasks)) throw new TypeError("agent.tasks must be an object");
	exactKeys(raw.agent.tasks, [
		"enabled",
		"timeoutMs",
		"maxOutputBytes",
		"maxConcurrent"
	], "agent.tasks");
	const teamId = identifier$1(raw.team.id, "team.id");
	const deviceId = identifier$1(raw.device.id, "device.id");
	const principalId = identifier$1(raw.device.assignedTo, "device.assignedTo");
	const probe = parseAgentConfig({
		schemaVersion: 2,
		deviceId,
		manifestPath: "/tmp/dsh-fleet-bootstrap/fleet.lock.yaml",
		dshHome: raw.agent.dshHome,
		dshBinary: raw.agent.dshBinary,
		pnpmBinary: raw.agent.pnpmBinary,
		profile: "bootstrap",
		stateDir: raw.agent.stateDir,
		planTtlMs: raw.agent.planTtlMs,
		restart: raw.agent.restart,
		health: raw.agent.health,
		artifactStore: raw.agent.artifactStore,
		tarBinary: raw.agent.tarBinary,
		a2a: {
			teamId,
			principalId,
			privateKeyPath: "/tmp/dsh-fleet-bootstrap/identity.private.pem",
			trustStorePath: "/tmp/dsh-fleet-bootstrap/trust-store.json",
			maxMessageTtlMs: raw.agent.maxMessageTtlMs
		},
		tasks: {
			enabled: raw.agent.tasks.enabled,
			workspaces: workspacePaths,
			profiles: ["bootstrap"],
			timeoutMs: raw.agent.tasks.timeoutMs,
			maxOutputBytes: raw.agent.tasks.maxOutputBytes,
			maxConcurrent: raw.agent.tasks.maxConcurrent
		}
	});
	assertReleaseReadyConfig(probe);
	assertA2AReadyConfig(probe);
	return {
		schemaVersion: 1,
		team: {
			id: teamId,
			...raw.team.name === void 0 ? {} : { name: text(raw.team.name, "team.name", 128) }
		},
		device: {
			id: deviceId,
			assignedTo: principalId,
			class: identifier$1(raw.device.class, "device.class"),
			channel: "stable"
		},
		release: {
			id: identifier$1(raw.release.id, "release.id"),
			version: exactVersion(raw.release.version, "release.version")
		},
		privatePlugins,
		workspacePaths,
		trustedPeers: raw.trustedPeers.map((entry, index) => trustEntry(entry, `trustedPeers[${index}]`, false)),
		agent: {
			dshHome: probe.dshHome,
			dshBinary: probe.dshBinary,
			pnpmBinary: probe.pnpmBinary,
			stateDir: probe.stateDir,
			artifactStore: probe.artifactStore,
			tarBinary: probe.tarBinary,
			planTtlMs: probe.planTtlMs,
			restart: probe.restart,
			health: probe.health,
			maxMessageTtlMs: probe.a2a.maxMessageTtlMs,
			tasks: {
				enabled: probe.tasks.enabled,
				timeoutMs: probe.tasks.timeoutMs,
				maxOutputBytes: probe.tasks.maxOutputBytes,
				maxConcurrent: probe.tasks.maxConcurrent
			}
		}
	};
}
function absoluteOutputPath(value, field) {
	if (!isAbsolute(value) || normalize(value) !== value || value.includes("\0")) throw new TypeError(field + " must be a normalized absolute path");
	return value;
}
function createTeamAgentConfig(pack, overlay, paths) {
	const config = parseAgentConfig({
		schemaVersion: 2,
		deviceId: overlay.device.id,
		manifestPath: absoluteOutputPath(paths.manifestPath, "manifestPath"),
		dshHome: overlay.agent.dshHome,
		dshBinary: overlay.agent.dshBinary,
		pnpmBinary: overlay.agent.pnpmBinary,
		profile: pack.profile.id,
		stateDir: overlay.agent.stateDir,
		planTtlMs: overlay.agent.planTtlMs,
		restart: overlay.agent.restart,
		health: overlay.agent.health,
		artifactStore: overlay.agent.artifactStore,
		tarBinary: overlay.agent.tarBinary,
		a2a: {
			teamId: overlay.team.id,
			principalId: overlay.device.assignedTo,
			privateKeyPath: absoluteOutputPath(paths.privateKeyPath, "privateKeyPath"),
			trustStorePath: absoluteOutputPath(paths.trustStorePath, "trustStorePath"),
			maxMessageTtlMs: overlay.agent.maxMessageTtlMs
		},
		tasks: {
			enabled: overlay.agent.tasks.enabled,
			workspaces: overlay.workspacePaths,
			profiles: pack.taskPolicy.profiles,
			timeoutMs: overlay.agent.tasks.timeoutMs,
			maxOutputBytes: overlay.agent.tasks.maxOutputBytes,
			maxConcurrent: overlay.agent.tasks.maxConcurrent
		}
	});
	assertReleaseReadyConfig(config);
	assertA2AReadyConfig(config);
	return JSON.stringify(config, null, 2) + "\n";
}
function instantiateTeamPack(pack, overlay) {
	const workspaceIds = Object.keys(overlay.workspacePaths).sort();
	const expectedWorkspaceIds = [...pack.taskPolicy.workspaceIds].sort();
	if (workspaceIds.length !== expectedWorkspaceIds.length || workspaceIds.some((id, index) => id !== expectedWorkspaceIds[index])) throw new TypeError("overlay workspacePaths must exactly instantiate the pack workspaceIds");
	const publicIds = new Set(pack.publicPlugins.map((plugin) => plugin.id));
	for (const plugin of overlay.privatePlugins) if (publicIds.has(plugin.id)) throw new TypeError("private plugin id conflicts with a public pack plugin: " + plugin.id);
	const releasePlugins = [...pack.publicPlugins.map((plugin) => ({
		id: plugin.id,
		visibility: "public",
		source: plugin.source,
		...plugin.runtimeModules === void 0 ? {} : { runtimeModules: plugin.runtimeModules }
	})), ...overlay.privatePlugins.map((plugin) => ({
		id: plugin.id,
		visibility: "private",
		source: {
			kind: "artifact",
			version: plugin.version,
			digest: plugin.digest
		},
		...plugin.runtimeModules === void 0 ? {} : { runtimeModules: plugin.runtimeModules }
	}))];
	const manifestObject = {
		schemaVersion: 2,
		team: overlay.team,
		devices: { [overlay.device.id]: {
			assignedTo: overlay.device.assignedTo,
			class: overlay.device.class,
			channel: overlay.device.channel
		} },
		profileReleases: { [overlay.release.id]: {
			version: overlay.release.version,
			profile: pack.profile.id,
			dshRange: pack.profile.dshRange,
			plugins: releasePlugins
		} },
		assignments: { [overlay.device.id]: { [pack.profile.id]: overlay.release.id } }
	};
	const manifestYaml = stringify(manifestObject, { lineWidth: 0 });
	parseFleetManifest(manifestYaml);
	const trustEntries = [...pack.trustAnchors, ...overlay.trustedPeers];
	const keys = /* @__PURE__ */ new Set();
	for (const entry of trustEntries) {
		if (keys.has(entry.keyId)) throw new TypeError("duplicate trust key id: " + entry.keyId);
		keys.add(entry.keyId);
	}
	return {
		manifestYaml,
		trustStoreJson: JSON.stringify({
			schemaVersion: 1,
			teamId: overlay.team.id,
			entries: trustEntries
		}, null, 2) + "\n",
		taskPolicy: {
			profiles: pack.taskPolicy.profiles,
			workspaces: overlay.workspacePaths
		}
	};
}
//#endregion
//#region src/bootstrap/runtime.ts
function identifier(value, field) {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new TypeError(field + " is invalid");
	return value;
}
function safeAbsolutePath(value, field) {
	if (!isAbsolute(value) || normalize(value) !== value || value.includes("\0")) throw new TypeError(field + " must be a normalized absolute path");
	return value;
}
async function ensurePrivateDirectory(path) {
	await mkdir(path, {
		recursive: true,
		mode: 448
	});
	const info = await lstat(path);
	if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("bootstrap output must be a real directory");
	if ((info.mode & 63) !== 0) throw new TypeError("bootstrap output directory must be owner-only (0700)");
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new TypeError("bootstrap output directory must be owned by the current user");
}
async function readRegularFile(path, privateFile = false) {
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		const info = await handle.stat();
		if (!info.isFile()) throw new TypeError("bootstrap inputs must be regular files");
		if (privateFile && (info.mode & 63) !== 0) throw new TypeError("bootstrap private key must be owner-only (0600)");
		if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new TypeError("bootstrap inputs must be owned by the current user");
		return await handle.readFile("utf8");
	} catch (error) {
		if (error.code === "ELOOP") throw new TypeError("bootstrap inputs must not be symbolic links");
		throw error;
	} finally {
		await handle?.close();
	}
}
async function assertMissing(paths) {
	for (const path of paths) try {
		await lstat(path);
		throw new TypeError("bootstrap refuses to overwrite existing output: " + path);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
}
async function writeExclusive(path, contents) {
	let handle;
	try {
		handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 384);
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle?.close();
	}
}
function parseInvite(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("identity invite must be an object");
	const raw = value;
	const expected = [
		"deviceId",
		"keyId",
		"principalId",
		"publicKeyPem",
		"schemaVersion",
		"teamId"
	];
	const actual = Object.keys(raw).sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError("identity invite has unsupported or missing fields");
	if (raw.schemaVersion !== 1 || typeof raw.teamId !== "string" || typeof raw.principalId !== "string" || typeof raw.deviceId !== "string" || typeof raw.keyId !== "string" || typeof raw.publicKeyPem !== "string") throw new TypeError("identity invite is invalid");
	const invite = {
		schemaVersion: 1,
		teamId: identifier(raw.teamId, "identity teamId"),
		principalId: identifier(raw.principalId, "identity principalId"),
		deviceId: normalizeDeviceId(raw.deviceId, "identity deviceId"),
		keyId: raw.keyId,
		publicKeyPem: raw.publicKeyPem
	};
	if (a2aKeyId(invite.publicKeyPem) !== invite.keyId) throw new TypeError("identity invite key id does not match its public key");
	return invite;
}
async function createBootstrapIdentity(input) {
	const outputDirectory = safeAbsolutePath(input.outputDirectory, "outputDirectory");
	const teamId = identifier(input.teamId, "teamId");
	const principalId = identifier(input.principalId, "principalId");
	const deviceId = normalizeDeviceId(input.deviceId);
	await ensurePrivateDirectory(outputDirectory);
	const privateKeyPath = join(outputDirectory, "identity.private.pem");
	const invitePath = join(outputDirectory, "identity.invite.json");
	await assertMissing([privateKeyPath, invitePath]);
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const privateKeyPem = privateKey.export({
		type: "pkcs8",
		format: "pem"
	}).toString();
	const publicKeyPem = publicKey.export({
		type: "spki",
		format: "pem"
	}).toString();
	const keyId = a2aKeyId(publicKey);
	const invite = {
		schemaVersion: 1,
		teamId,
		principalId,
		deviceId,
		keyId,
		publicKeyPem
	};
	const created = [];
	try {
		await writeExclusive(privateKeyPath, privateKeyPem);
		created.push(privateKeyPath);
		await writeExclusive(invitePath, JSON.stringify(invite, null, 2) + "\n");
		created.push(invitePath);
	} catch (error) {
		await Promise.all(created.map((path) => rm(path, { force: true })));
		throw error;
	}
	return {
		privateKeyPath,
		invitePath,
		keyId
	};
}
async function renderBootstrapBundle(input) {
	const outputDirectory = safeAbsolutePath(input.outputDirectory, "outputDirectory");
	const identityDirectory = safeAbsolutePath(input.identityDirectory, "identityDirectory");
	const packPath = safeAbsolutePath(input.packPath, "packPath");
	const overlayPath = safeAbsolutePath(input.overlayPath, "overlayPath");
	await ensurePrivateDirectory(outputDirectory);
	const pack = parseTeamPack(await readRegularFile(packPath));
	const overlay = parseTeamOverlay(await readRegularFile(overlayPath));
	const privateKeyPath = join(identityDirectory, "identity.private.pem");
	const invitePath = join(identityDirectory, "identity.invite.json");
	const privateKeyPem = await readRegularFile(privateKeyPath, true);
	const invite = parseInvite(JSON.parse(await readRegularFile(invitePath)));
	if (invite.teamId !== overlay.team.id || invite.principalId !== overlay.device.assignedTo || invite.deviceId !== overlay.device.id) throw new TypeError("identity invite does not match the overlay team, principal and device");
	if (a2aKeyId(privateKeyPem) !== invite.keyId) throw new TypeError("identity private key does not match the invite");
	if (a2aKeyId(createPublicKey(privateKeyPem).export({
		type: "spki",
		format: "pem"
	}).toString()) !== a2aKeyId(invite.publicKeyPem)) throw new TypeError("identity private and public keys do not match");
	const manifestPath = join(outputDirectory, "fleet.lock.yaml");
	const trustStorePath = join(outputDirectory, "trust-store.json");
	const taskPolicyPath = join(outputDirectory, "task-policy.json");
	const agentConfigPath = join(outputDirectory, "agent.config.json");
	const outputs = [
		manifestPath,
		trustStorePath,
		taskPolicyPath,
		agentConfigPath
	];
	await assertMissing(outputs);
	const instantiated = instantiateTeamPack(pack, overlay);
	const contents = [
		instantiated.manifestYaml,
		instantiated.trustStoreJson,
		JSON.stringify(instantiated.taskPolicy, null, 2) + "\n",
		createTeamAgentConfig(pack, overlay, {
			manifestPath,
			trustStorePath,
			privateKeyPath
		})
	];
	const created = [];
	try {
		for (let index = 0; index < outputs.length; index += 1) {
			const path = outputs[index];
			const content = contents[index];
			if (path === void 0 || content === void 0) throw new TypeError("bootstrap output set is incomplete");
			await writeExclusive(path, content);
			created.push(path);
		}
	} catch (error) {
		await Promise.all(created.map((path) => rm(path, { force: true })));
		throw error;
	}
	return {
		manifestPath,
		trustStorePath,
		taskPolicyPath,
		agentConfigPath,
		manifestDigest: createHash("sha256").update(instantiated.manifestYaml, "utf8").digest("hex")
	};
}
//#endregion
//#region src/host/agent-client.ts
const MAX_OUTPUT_BYTES = 1048576;
const NON_MUTATION_TERMINATION_GRACE_MS = 3e4;
const MUTATION_TERMINATION_GRACE_MS = 6e5;
const LOCAL_GROUP_DRAIN_MS = 2e3;
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
function isMutationCommand(command) {
	return command === "apply" || command === "status" || command === "release-apply" || command === "release-status" || command === "a2a-receive" || command === "tasks-resume";
}
function agentTerminationGraceMs(command) {
	return isMutationCommand(command) ? MUTATION_TERMINATION_GRACE_MS : NON_MUTATION_TERMINATION_GRACE_MS;
}
function safePath(value, field) {
	if (!isAbsolute(value) || normalize(value) !== value || !/^\/[A-Za-z0-9._/-]+$/.test(value)) throw new TypeError(field + " must be a normalized absolute path without shell metacharacters");
	return value;
}
function validateAgentTarget(target) {
	const deviceId = normalizeDeviceId(target.deviceId, "target.deviceId");
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
export { a2aKeyId, applyStoredPlan, applyStoredReleasePlan, assertA2AReadyConfig, assertReleaseReadyConfig, callAgent, canonicalJson, collectFleetUpdates, computeProfileHash, createA2AEnvelope, createAgentClient, createAgentPlan, createBootstrapIdentity, createFleetPlan, createReleasePlan, createStoredPlan, createStoredReleasePlan, createTeamAgentConfig, createUpdateMonitor, doctorAgent, exactSourceKind, inspectAgent, inspectReleaseAgent, instantiateTeamPack, isSupportedDshVersion, parseAgentConfig, parseFleetManifest, parseTeamOverlay, parseTeamPack, readA2ATrustStore, readAction, readAgentConfig, readAppliedRelease, readOrRecoverReleaseAction, receiveA2AMessage, reconcileFleet, renderBootstrapBundle, resumeAcceptedTasks, runTaskWorker, sha256Canonical, systemUpdateProbe, validateAgentTarget, validateFleetPlan, validateFleetPlanApproval, verifyA2AEnvelope };
