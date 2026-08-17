import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { arch, homedir, hostname, platform } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
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
	return {
		id: nonEmpty(value.id, field + ".id"),
		spec: nonEmpty(value.spec, field + ".spec"),
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
	const seen = /* @__PURE__ */ new Set();
	for (const plugin of plugins) {
		if (seen.has(plugin.id)) throw new TypeError("duplicate plugin id " + JSON.stringify(plugin.id));
		seen.add(plugin.id);
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
//#region src/index.ts
const name = "fleet";
const inject = ["connection", "loader"];
const RPC_CHANNEL = "/dsh-fleet";
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
function resolveConfig(config) {
	const dshHome = expandHome(config?.dshHome ?? process.env.DSH_HOME ?? "~/.dsh");
	const defaultBinary = join(homedir(), ".local/bin/dsh");
	return {
		deviceId: (config?.deviceId ?? process.env.DSH_FLEET_DEVICE_ID ?? hostname()).trim(),
		manifestPath: expandHome(config?.manifestPath ?? process.env.DSH_FLEET_MANIFEST ?? "~/.dsh/fleet/fleet.lock.yaml"),
		profile: (config?.profile ?? process.env.DSH_FLEET_PROFILE ?? "web").trim(),
		dshHome,
		dshBinary: expandHome(config?.dshBinary ?? process.env.DSH_FLEET_DSH_BINARY ?? (existsSync(defaultBinary) ? defaultBinary : "dsh"))
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
		runtime: runtimeSnapshot(ctx.loader)
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
function apply(ctx, config) {
	const host = ctx;
	host.connection.rpc.handle(RPC_CHANNEL, async (endpoint) => {
		try {
			if (endpoint !== "status") return fail("unknown endpoint: " + endpoint);
			return ok(await collectFleetStatus(host, config));
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}, { authority: "loopback" });
}
//#endregion
export { RPC_CHANNEL, apply, collectFleetStatus, inject, name };
