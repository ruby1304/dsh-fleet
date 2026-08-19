import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { lstat, open, readFile, realpath, stat } from "node:fs/promises";
import { arch, homedir, hostname, platform } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { gt, satisfies, valid, validRange } from "semver";
import { parse } from "yaml";
var FleetProtocolError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "FleetProtocolError";
		this.code = code;
	}
};
function isRecord$5(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSupportedDshVersion(value) {
	return valid(value) === value && satisfies(value, ">=0.1.0-rc.7 <0.2.0", { includePrerelease: true });
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
const ROLLBACK_PLAN_BODY_KEYS = [
	"protocolVersion",
	"kind",
	"transitionPlanId",
	"transitionPlanDigest",
	"deviceId",
	"profile",
	"fromManifestDigest",
	"toManifestDigest",
	"fromReleaseDigest",
	"toReleaseDigest",
	"fromProfileHash",
	"toProfileHash",
	"observedDshVersion",
	"observedRuntimeDigest",
	"observedServiceDefinitionDigest",
	"createdAt",
	"expiresAt"
];
const ROLLBACK_PLAN_KEYS = [
	...ROLLBACK_PLAN_BODY_KEYS,
	"planId",
	"digest"
];
function isRecord$4(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertExactKeys(value, keys, label) {
	if (!isRecord$4(value)) throw new FleetProtocolError("invalid-payload", label + " must be an object");
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
function assertNullableDigest(value, field) {
	if (value !== null) assertDigest(value, field);
}
function parseTime(value, field) {
	if (typeof value !== "string") throw new FleetProtocolError("invalid-time", field + " must be a canonical ISO timestamp");
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) throw new FleetProtocolError("invalid-time", field + " must be a canonical ISO timestamp");
	return timestamp;
}
function validateRollbackPlanBody(value) {
	assertExactKeys(value, ROLLBACK_PLAN_BODY_KEYS, "release rollback plan body");
	if (value.protocolVersion !== 2 || value.kind !== "profile-release-rollback") throw new FleetProtocolError("invalid-protocol", "unsupported release rollback protocol");
	if (!/^release-plan:[0-9a-f]{64}$/.test(value.transitionPlanId)) throw new FleetProtocolError("invalid-payload", "transitionPlanId is invalid");
	assertDigest(value.transitionPlanDigest, "transitionPlanDigest");
	if (value.transitionPlanId !== "release-plan:" + value.transitionPlanDigest) throw new FleetProtocolError("plan-integrity-failed", "transition plan id does not match transitionPlanDigest");
	assertIdentifier(value.deviceId, "deviceId");
	assertIdentifier(value.profile, "profile");
	assertDigest(value.fromManifestDigest, "fromManifestDigest");
	assertDigest(value.toManifestDigest, "toManifestDigest");
	assertDigest(value.fromReleaseDigest, "fromReleaseDigest");
	assertNullableDigest(value.toReleaseDigest, "toReleaseDigest");
	assertDigest(value.fromProfileHash, "fromProfileHash");
	assertDigest(value.toProfileHash, "toProfileHash");
	assertString(value.observedDshVersion, "observedDshVersion");
	if (!isSupportedDshVersion(value.observedDshVersion)) throw new FleetProtocolError("unsupported-dsh-version", "DSH version is outside the supported Agent range");
	assertDigest(value.observedRuntimeDigest, "observedRuntimeDigest");
	assertNullableDigest(value.observedServiceDefinitionDigest, "observedServiceDefinitionDigest");
	if (value.fromManifestDigest === value.toManifestDigest && value.fromReleaseDigest === value.toReleaseDigest) throw new FleetProtocolError("invalid-payload", "release rollback must change a manifest or applied release binding");
	const createdAt = parseTime(value.createdAt, "createdAt");
	if (parseTime(value.expiresAt, "expiresAt") <= createdAt) throw new FleetProtocolError("invalid-time", "expiresAt must be after createdAt");
}
function validateFleetReleaseRollbackPlan(value) {
	assertExactKeys(value, ROLLBACK_PLAN_KEYS, "release rollback plan");
	const body = Object.fromEntries(ROLLBACK_PLAN_BODY_KEYS.map((key) => [key, value[key]]));
	validateRollbackPlanBody(body);
	assertDigest(value.digest, "digest");
	const digest = sha256Canonical(body);
	if (value.digest !== digest || value.planId !== "release-rollback-plan:" + digest) throw new FleetProtocolError("plan-integrity-failed", "release rollback plan id or digest does not match its canonical body");
}
const BODY_KEYS$1 = [
	"protocolVersion",
	"kind",
	"deviceId",
	"profile",
	"currentTransitionPlanId",
	"retainedTransitionPlanIds",
	"entries",
	"orphanBackupProfiles",
	"orphanStageProfiles",
	"orphanFailedProfiles",
	"createdAt",
	"expiresAt"
];
const PLAN_KEYS = [
	...BODY_KEYS$1,
	"planId",
	"digest"
];
const ENTRY_KEYS = [
	"transitionPlanId",
	"descriptorDigest",
	"backupProfile",
	"backupManifestDigest",
	"backupProfileHash",
	"reason"
];
function object(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new FleetProtocolError("invalid-payload", label + " must be an object");
	return value;
}
function exact(value, keys, label) {
	const body = object(value, label);
	const actual = Object.keys(body).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new FleetProtocolError("invalid-payload", label + " has unsupported or missing fields");
	return body;
}
function identifier$1(value, label) {
	if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new FleetProtocolError("invalid-payload", label + " is invalid");
}
function digest$1(value, label) {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new FleetProtocolError("invalid-digest", label + " must be a lowercase SHA-256 digest");
}
function transitionId(value, label) {
	if (typeof value !== "string" || !/^release-plan:[0-9a-f]{64}$/.test(value)) throw new FleetProtocolError("invalid-payload", label + " is invalid");
}
function timestamp(value, label) {
	if (typeof value !== "string") throw new FleetProtocolError("invalid-time", label + " must be a canonical timestamp");
	const time = Date.parse(value);
	if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new FleetProtocolError("invalid-time", label + " must be a canonical timestamp");
	return time;
}
function sortedUnique(values, label, validate) {
	if (!Array.isArray(values)) throw new FleetProtocolError("invalid-payload", label + " must be an array");
	values.forEach((value, index) => validate(value, `${label}[${index}]`));
	if (new Set(values).size !== values.length || values.some((value, index) => index > 0 && value <= values[index - 1])) throw new FleetProtocolError("invalid-payload", label + " must be unique and sorted");
	return values;
}
function validateEntry(value, index) {
	const body = exact(value, ENTRY_KEYS, `entries[${index}]`);
	transitionId(body.transitionPlanId, `entries[${index}].transitionPlanId`);
	digest$1(body.descriptorDigest, `entries[${index}].descriptorDigest`);
	if (body.backupProfile === null) {
		if (body.backupManifestDigest !== null || body.backupProfileHash !== null) throw new FleetProtocolError("invalid-payload", "marker-only retention entries cannot bind a backup");
	} else {
		if (typeof body.backupProfile !== "string" || !/^fleet-backup-[0-9a-f]{24}$/.test(body.backupProfile)) throw new FleetProtocolError("invalid-payload", "retention backup profile is invalid");
		digest$1(body.backupManifestDigest, `entries[${index}].backupManifestDigest`);
		digest$1(body.backupProfileHash, `entries[${index}].backupProfileHash`);
	}
	if (body.reason !== "superseded") throw new FleetProtocolError("invalid-payload", "retention reason is invalid");
}
function validateBody(value) {
	exact(value, BODY_KEYS$1, "release retention plan body");
	if (value.protocolVersion !== 1 || value.kind !== "profile-release-retention") throw new FleetProtocolError("invalid-protocol", "unsupported release retention protocol");
	identifier$1(value.deviceId, "deviceId");
	identifier$1(value.profile, "profile");
	if (value.currentTransitionPlanId !== null) transitionId(value.currentTransitionPlanId, "currentTransitionPlanId");
	const retained = sortedUnique(value.retainedTransitionPlanIds, "retainedTransitionPlanIds", transitionId);
	if (retained.length > 2) throw new FleetProtocolError("invalid-payload", "release retention keeps at most the current and previous transitions");
	if (value.currentTransitionPlanId !== null && !retained.includes(value.currentTransitionPlanId)) throw new FleetProtocolError("invalid-payload", "retained transitions must include the current transition");
	if (value.currentTransitionPlanId === null && retained.length !== 0) throw new FleetProtocolError("invalid-payload", "retained transitions require a current transition");
	if (!Array.isArray(value.entries)) throw new FleetProtocolError("invalid-payload", "entries must be an array");
	value.entries.forEach(validateEntry);
	if (value.currentTransitionPlanId === null && value.entries.length !== 0) throw new FleetProtocolError("invalid-payload", "retention entries require a current transition");
	const entryIds = value.entries.map((entry) => entry.transitionPlanId);
	if (new Set(entryIds).size !== entryIds.length || entryIds.some((id, index) => index > 0 && id <= entryIds[index - 1])) throw new FleetProtocolError("invalid-payload", "retention entries must be unique and sorted");
	if (entryIds.some((id) => retained.includes(id))) throw new FleetProtocolError("invalid-payload", "retained transitions cannot be pruned");
	sortedUnique(value.orphanBackupProfiles, "orphanBackupProfiles", (item, label) => {
		if (typeof item !== "string" || !/^fleet-backup-[0-9a-f]{24}$/.test(item)) throw new FleetProtocolError("invalid-payload", label + " is invalid");
	});
	sortedUnique(value.orphanStageProfiles, "orphanStageProfiles", (item, label) => {
		if (typeof item !== "string" || !/^fleet-stage-[0-9a-f]{24}$/.test(item)) throw new FleetProtocolError("invalid-payload", label + " is invalid");
	});
	sortedUnique(value.orphanFailedProfiles, "orphanFailedProfiles", (item, label) => {
		if (typeof item !== "string" || !/^fleet-failed-[0-9a-f]{24}$/.test(item)) throw new FleetProtocolError("invalid-payload", label + " is invalid");
	});
	const createdAt = timestamp(value.createdAt, "createdAt");
	const expiresAt = timestamp(value.expiresAt, "expiresAt");
	if (expiresAt <= createdAt || expiresAt - createdAt > 36e5) throw new FleetProtocolError("invalid-time", "release retention plan lifetime is invalid");
}
function validateFleetReleaseRetentionPlan(value) {
	exact(value, PLAN_KEYS, "release retention plan");
	const body = Object.fromEntries(BODY_KEYS$1.map((key) => [key, value[key]]));
	validateBody(body);
	digest$1(value.digest, "digest");
	if (value.planId !== "release-retention-plan:" + value.digest || sha256Canonical(body) !== value.digest) throw new FleetProtocolError("plan-integrity-failed", "release retention plan identity is invalid");
}
//#endregion
//#region src/shared.ts
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function normalizeDeviceId(value, field = "deviceId") {
	if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(field + " must be a non-empty string");
	const deviceId = value.trim();
	if (!DEVICE_ID_PATTERN.test(deviceId)) throw new TypeError(field + " must be 1 to 64 ASCII letters, digits, dots, underscores or hyphens and start with a letter or digit");
	return deviceId;
}
//#endregion
//#region src/worker/context.ts
const MAX_TASK_TOOL_ARGUMENT_BYTES = 16384;
var WorkerPolicyError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "WorkerPolicyError";
		this.code = code;
	}
};
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function canonicalArguments(toolArguments, maxBytes) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16384) throw new WorkerPolicyError("invalid-context", "maxBytes exceeds the Fleet tool-argument ceiling");
	if (!isRecord$3(toolArguments)) throw new WorkerPolicyError("invalid-arguments", "tool arguments must be a JSON object");
	let canonical;
	try {
		canonical = canonicalJson(toolArguments);
	} catch (error) {
		throw new WorkerPolicyError("invalid-arguments", error instanceof Error ? error.message : "tool arguments are not canonical JSON");
	}
	if (Buffer.byteLength(canonical, "utf8") > maxBytes) throw new WorkerPolicyError("arguments-too-large", `tool arguments exceed ${maxBytes} bytes`);
	return canonical;
}
function digestToolArguments(toolArguments, maxBytes = MAX_TASK_TOOL_ARGUMENT_BYTES) {
	const canonical = canonicalArguments(toolArguments, maxBytes);
	return sha256Canonical(JSON.parse(canonical));
}
const FEDERATION_ADVISORY_KINDS = /* @__PURE__ */ new Set([
	"approval.request",
	"approval.decision",
	"handoff",
	"receipt"
]);
function isFleetFederationAdvisoryKind(kind) {
	return FEDERATION_ADVISORY_KINDS.has(kind);
}
var FleetA2AError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "FleetA2AError";
		this.code = code;
	}
};
const MAX_PAYLOAD_BYTES = 49152;
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value, field, maxLength = 128) {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > maxLength || /[\r\n\0]/.test(value)) throw new FleetA2AError("invalid-payload", field + " must be a bounded trimmed string");
	return value;
}
function longText(value, field, maxLength) {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength || value.includes("\0")) throw new FleetA2AError("invalid-payload", field + " must be bounded non-empty text");
	return value;
}
function identifier(value, field) {
	const result = text(value, field, 64);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(result)) throw new FleetA2AError("invalid-payload", field + " is invalid");
	return result;
}
function messageId(value, field, prefix) {
	const result = text(value, field, 64);
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
			"executionProfileHash",
			"manifestDigest",
			"releaseDigest",
			"policyId",
			"policyDigest",
			"deadline",
			"prompt"
		], kind);
		taskId(payload.taskId);
		identifier(payload.workspaceId, "payload.workspaceId");
		identifier(payload.profile, "payload.profile");
		digest(payload.executionProfileHash, "payload.executionProfileHash");
		digest(payload.manifestDigest, "payload.manifestDigest");
		digest(payload.releaseDigest, "payload.releaseDigest");
		identifier(payload.policyId, "payload.policyId");
		digest(payload.policyDigest, "payload.policyDigest");
		canonicalTime(payload.deadline, "payload.deadline");
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
		].includes(text(payload.state, "payload.state", 24))) throw new FleetA2AError("invalid-payload", "task progress state is invalid");
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
		].includes(text(payload.state, "payload.state", 16))) throw new FleetA2AError("invalid-payload", "task result state is invalid");
		canonicalTime(payload.updatedAt, "payload.updatedAt");
		if (payload.resultDigest !== null) digest(payload.resultDigest, "payload.resultDigest");
		if (payload.result !== null) longText(payload.result, "payload.result", 32768);
		if (typeof payload.truncated !== "boolean") throw new FleetA2AError("invalid-payload", "payload.truncated must be boolean");
		if (payload.errorCode !== null) identifier(payload.errorCode, "payload.errorCode");
		return;
	}
	if (kind === "task.approval.request") {
		exactPayload(payload, [
			"approvalId",
			"taskId",
			"taskBindingDigest",
			"toolCallId",
			"toolName",
			"arguments",
			"argumentsDigest",
			"capability",
			"summary",
			"expiresAt"
		], kind);
		messageId(payload.approvalId, "payload.approvalId", "approval");
		taskId(payload.taskId);
		digest(payload.taskBindingDigest, "payload.taskBindingDigest");
		text(payload.toolCallId, "payload.toolCallId");
		identifier(payload.toolName, "payload.toolName");
		let argumentsDigest;
		try {
			argumentsDigest = digestToolArguments(payload.arguments, MAX_TASK_TOOL_ARGUMENT_BYTES);
		} catch {
			throw new FleetA2AError("invalid-payload", "task approval arguments must be a bounded canonical JSON object");
		}
		digest(payload.argumentsDigest, "payload.argumentsDigest");
		if (payload.argumentsDigest !== argumentsDigest) throw new FleetA2AError("invalid-payload", "task approval argumentsDigest does not match arguments");
		if (![
			"workspace-mutation",
			"command-execution",
			"network-access"
		].includes(text(payload.capability, "payload.capability", 32))) throw new FleetA2AError("invalid-payload", "task approval capability is invalid");
		longText(payload.summary, "payload.summary", 2048);
		canonicalTime(payload.expiresAt, "payload.expiresAt");
		return;
	}
	if (kind === "task.approval.decision") {
		exactPayload(payload, [
			"approvalId",
			"taskId",
			"approvalRequestMessageId",
			"approvalRequestPayloadDigest",
			"taskBindingDigest",
			"toolCallId",
			"argumentsDigest",
			"decision",
			"decidedAt"
		], kind);
		messageId(payload.approvalId, "payload.approvalId", "approval");
		taskId(payload.taskId);
		messageId(payload.approvalRequestMessageId, "payload.approvalRequestMessageId", "msg");
		digest(payload.approvalRequestPayloadDigest, "payload.approvalRequestPayloadDigest");
		digest(payload.taskBindingDigest, "payload.taskBindingDigest");
		text(payload.toolCallId, "payload.toolCallId");
		digest(payload.argumentsDigest, "payload.argumentsDigest");
		if (!["allowed-once", "rejected"].includes(text(payload.decision, "payload.decision", 16))) throw new FleetA2AError("invalid-payload", "task approval decision is invalid");
		canonicalTime(payload.decidedAt, "payload.decidedAt");
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
			"approvalRequestMessageId",
			"approvalRequestPayloadDigest",
			"decision",
			"decidedAt"
		], kind);
		messageId(payload.approvalId, "payload.approvalId", "approval");
		taskId(payload.taskId);
		messageId(payload.approvalRequestMessageId, "payload.approvalRequestMessageId", "msg");
		digest(payload.approvalRequestPayloadDigest, "payload.approvalRequestPayloadDigest");
		if (!["endorsed", "declined"].includes(text(payload.decision, "payload.decision", 16))) throw new FleetA2AError("invalid-payload", "federation approval decision is invalid");
		canonicalTime(payload.decidedAt, "payload.decidedAt");
		return;
	}
	if (kind === "receipt") {
		exactPayload(payload, ["requestMessageId", "status"], kind);
		messageId(payload.requestMessageId, "payload.requestMessageId", "msg");
		if (!["accepted", "stored"].includes(text(payload.status, "payload.status", 16))) throw new FleetA2AError("invalid-payload", "receipt status is invalid");
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
			text(ref, "payload.artifactRefs[]", 512);
			return false;
		} catch {
			return true;
		}
	})) throw new FleetA2AError("invalid-payload", "handoff artifactRefs are invalid");
}
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
	return command === "apply" || command === "status" || command === "release-apply" || command === "release-status" || command === "release-rollback-apply" || command === "release-rollback-status" || command === "release-retention-apply" || command === "release-retention-status" || command === "a2a-receive" || command === "tasks-prune" || command === "tasks-resume" || command === "federation-ack" || command === "federation-prune";
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
function assertAgentIdentity(expectedDeviceId, response) {
	if (!isRecord$1(response) || response.deviceId !== expectedDeviceId) throw new AgentClientError("agent-identity-mismatch", "fleet agent identity does not match the configured target");
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
		"approval-expired": "approval has expired",
		"release-ownership-conflict": "live release binding is no longer owned by the approved transition",
		"rollback-not-available": "the release transition has no usable rollback state",
		"rollback-target-mismatch": "the retained rollback target no longer matches the approved state",
		"rollback-descriptor-invalid": "the durable rollback descriptor is missing or invalid",
		"rollback-backup-missing": "the retained release backup is missing",
		"idempotency-conflict": "the release action already has a different approval",
		"action-state-invalid": "the stored release action no longer matches its approved plan",
		"legacy-task-owner-unbound": "this task was created before signed owner binding; clear the saved task reference and submit a new task"
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
function exactKeys(value, allowed, field) {
	const extras = Object.keys(value).filter((key) => !allowed.includes(key));
	if (extras.length > 0) throw new TypeError(field + " contains unsupported fields: " + extras.sort().join(", "));
}
function safeIdentifier(value, field) {
	const id = nonEmpty(value, field);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new TypeError(field + " must be 1 to 64 ASCII letters, digits, dots, underscores or hyphens");
	return id;
}
function safePackageName(value, field) {
	const id = nonEmpty(value, field);
	if (id.length > 214 || id !== id.toLowerCase() || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(id)) throw new TypeError(field + " must be one literal lowercase npm package name");
	return id;
}
function exactSemver(value, field) {
	const version = nonEmpty(value, field);
	if (valid(version) !== version) throw new TypeError(field + " must be an exact semantic version");
	return version;
}
function sha256Digest$1(value, field) {
	const digest = nonEmpty(value, field);
	if (!/^[0-9a-f]{64}$/.test(digest)) throw new TypeError(field + " must be a lowercase SHA-256 digest");
	return digest;
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
		const devices = strings(value.target.devices, field + ".target.devices")?.map((id, targetIndex) => normalizeDeviceId(id, `${field}.target.devices[${targetIndex}]`));
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
function parseReleaseSource(value, field, visibility) {
	if (!isRecord(value)) throw new TypeError(field + " must be an object");
	const kind = nonEmpty(value.kind, field + ".kind");
	if (kind === "npm") {
		exactKeys(value, [
			"kind",
			"version",
			"integrity"
		], field);
		if (visibility !== "public") throw new TypeError(field + " private plugins must use content-addressed artifact sources");
		const integrity = value.integrity === void 0 ? void 0 : nonEmpty(value.integrity, field + ".integrity");
		if (integrity !== void 0 && !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) throw new TypeError(field + ".integrity must be one SHA-512 Subresource Integrity value");
		return {
			kind: "npm",
			version: exactSemver(value.version, field + ".version"),
			...integrity === void 0 ? {} : { integrity }
		};
	}
	if (kind === "github") {
		exactKeys(value, [
			"kind",
			"repository",
			"revision"
		], field);
		if (visibility !== "public") throw new TypeError(field + " private plugins must use content-addressed artifact sources");
		const repository = nonEmpty(value.repository, field + ".repository");
		if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(repository)) throw new TypeError(field + ".repository must be owner/repository without a URL or revision");
		const revision = nonEmpty(value.revision, field + ".revision");
		if (!/^[0-9a-f]{40}$/.test(revision)) throw new TypeError(field + ".revision must be a lowercase 40-character commit SHA");
		return {
			kind: "github",
			repository,
			revision
		};
	}
	if (kind === "artifact") {
		exactKeys(value, [
			"kind",
			"digest",
			"version"
		], field);
		if (visibility !== "private") throw new TypeError(field + " artifact sources must be declared private");
		return {
			kind: "artifact",
			digest: sha256Digest$1(value.digest, field + ".digest"),
			version: exactSemver(value.version, field + ".version")
		};
	}
	throw new TypeError(field + ".kind must be npm, github or artifact");
}
function parseReleasePlugin(value, field) {
	if (!isRecord(value)) throw new TypeError(field + " must be an object");
	exactKeys(value, [
		"id",
		"visibility",
		"source",
		"runtimeModules"
	], field);
	if (value.visibility !== "public" && value.visibility !== "private") throw new TypeError(field + ".visibility must be public or private");
	const runtimeModules = strings(value.runtimeModules, field + ".runtimeModules");
	return {
		id: safePackageName(value.id, field + ".id"),
		visibility: value.visibility,
		source: parseReleaseSource(value.source, field + ".source", value.visibility),
		...runtimeModules === void 0 ? {} : { runtimeModules }
	};
}
function parseProfileRelease(id, value, field) {
	if (!isRecord(value)) throw new TypeError(field + " must be an object");
	exactKeys(value, [
		"id",
		"version",
		"profile",
		"dshRange",
		"plugins"
	], field);
	if (value.id !== void 0 && safeIdentifier(value.id, field + ".id") !== id) throw new TypeError(field + ".id must match its profileReleases key");
	const dshRange = nonEmpty(value.dshRange, field + ".dshRange");
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
		profile: safeIdentifier(value.profile, field + ".profile"),
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
	exactKeys(raw, [
		"schemaVersion",
		"team",
		"devices",
		"profileReleases",
		"assignments"
	], "fleet manifest");
	if (!isRecord(raw.profileReleases)) throw new TypeError("profileReleases must be an object");
	const profileReleases = {};
	for (const [rawId, value] of Object.entries(raw.profileReleases)) {
		const id = safeIdentifier(rawId, "profile release id");
		profileReleases[id] = parseProfileRelease(id, value, "profileReleases." + id);
	}
	if (Object.keys(profileReleases).length === 0) throw new TypeError("profileReleases must not be empty");
	if (!isRecord(raw.assignments)) throw new TypeError("assignments must be an object");
	const assignments = {};
	const plugins = [];
	for (const [rawDeviceId, value] of Object.entries(raw.assignments)) {
		const deviceId = normalizeDeviceId(rawDeviceId, "assignment device id");
		if (devices[deviceId] === void 0) throw new TypeError("assignments." + deviceId + " references an unknown device");
		if (!isRecord(value) || Object.keys(value).length === 0) throw new TypeError("assignments." + deviceId + " must be a non-empty profile-to-release object");
		const deviceAssignments = {};
		for (const [rawProfile, rawReleaseId] of Object.entries(value)) {
			const profile = safeIdentifier(rawProfile, `assignments.${deviceId} profile`);
			const releaseId = safeIdentifier(rawReleaseId, `assignments.${deviceId}.${profile}`);
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
	if (!isRecord(raw)) throw new TypeError("fleet manifest must be an object");
	if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) throw new TypeError("schemaVersion must equal 1 or 2");
	if (!isRecord(raw.team)) throw new TypeError("team must be an object");
	if (raw.schemaVersion === 2) exactKeys(raw.team, ["id", "name"], "team");
	const teamId = nonEmpty(raw.team.id, "team.id");
	const teamName = raw.team.name === void 0 ? void 0 : nonEmpty(raw.team.name, "team.name");
	if (!isRecord(raw.devices)) throw new TypeError("devices must be an object");
	const devices = {};
	for (const [id, value] of Object.entries(raw.devices)) {
		const deviceId = normalizeDeviceId(id, "device id");
		if (raw.schemaVersion === 2 && isRecord(value)) exactKeys(value, [
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
		team,
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
//#region src/host/runtime-identity.ts
const DSH_PACKAGE_NAME = "@deepseek-ai/dsh";
const MAX_PACKAGE_SEARCH_DEPTH = 8;
function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}
async function readRegularFile(path) {
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		if (!(await handle.stat()).isFile()) throw new TypeError("runtime identity accepts regular files only");
		return await handle.readFile();
	} catch (error) {
		if (error.code === "ELOOP") throw new TypeError("runtime identity accepts regular files only");
		throw error;
	} finally {
		await handle?.close();
	}
}
async function findDshPackage(entrypoint) {
	let directory = dirname(entrypoint);
	for (let depth = 0; depth < MAX_PACKAGE_SEARCH_DEPTH; depth += 1) {
		const candidate = join(directory, "package.json");
		try {
			const packageJson = await readRegularFile(candidate);
			const metadata = JSON.parse(packageJson.toString("utf8"));
			if (metadata.name === DSH_PACKAGE_NAME) {
				if (typeof metadata.version !== "string" || metadata.version.trim() !== metadata.version || metadata.version.length === 0) throw new TypeError("DSH runtime package version is invalid");
				return {
					packageRealpath: await realpath(directory),
					packageJson,
					version: metadata.version
				};
			}
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	throw new TypeError("running DSH package metadata was not found");
}
async function inspectCurrentRuntimeIdentity(input = {}) {
	const execPath = input.execPath ?? process.execPath;
	const entrypointPath = input.entrypointPath ?? process.argv[1];
	if (typeof entrypointPath !== "string" || !isAbsolute(execPath) || !isAbsolute(entrypointPath)) throw new TypeError("runtime identity needs absolute Node and DSH entrypoint paths");
	const [nodeRealpath, dshEntrypointRealpath] = await Promise.all([realpath(execPath), realpath(entrypointPath)]);
	const [entrypoint, packageMetadata] = await Promise.all([readRegularFile(dshEntrypointRealpath), findDshPackage(dshEntrypointRealpath)]);
	const entrypointDigest = sha256(entrypoint);
	const packageJsonDigest = sha256(packageMetadata.packageJson);
	const identity = {
		nodeRealpath,
		dshEntrypointRealpath,
		dshPackageRealpath: packageMetadata.packageRealpath,
		dshVersion: packageMetadata.version,
		entrypointDigest,
		packageJsonDigest
	};
	return {
		...identity,
		runtimeDigest: sha256(JSON.stringify(identity))
	};
}
function validateRuntimeIdentity(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("runtime identity must be an object");
	const body = value;
	const expected = [
		"nodeRealpath",
		"dshEntrypointRealpath",
		"dshPackageRealpath",
		"dshVersion",
		"entrypointDigest",
		"packageJsonDigest",
		"runtimeDigest"
	].sort();
	if (Object.keys(body).sort().join(",") !== expected.join(",")) throw new TypeError("runtime identity has unsupported or missing fields");
	for (const field of [
		"nodeRealpath",
		"dshEntrypointRealpath",
		"dshPackageRealpath"
	]) if (typeof body[field] !== "string" || !isAbsolute(body[field]) || normalize(body[field]) !== body[field]) throw new TypeError("runtime identity path is invalid");
	if (typeof body.dshVersion !== "string" || body.dshVersion.length === 0 || body.dshVersion !== body.dshVersion.trim()) throw new TypeError("runtime identity DSH version is invalid");
	for (const field of [
		"entrypointDigest",
		"packageJsonDigest",
		"runtimeDigest"
	]) if (typeof body[field] !== "string" || !/^[0-9a-f]{64}$/.test(body[field])) throw new TypeError("runtime identity digest is invalid");
	const identity = {
		nodeRealpath: body.nodeRealpath,
		dshEntrypointRealpath: body.dshEntrypointRealpath,
		dshPackageRealpath: body.dshPackageRealpath,
		dshVersion: body.dshVersion,
		entrypointDigest: body.entrypointDigest,
		packageJsonDigest: body.packageJsonDigest
	};
	if (sha256(JSON.stringify(identity)) !== body.runtimeDigest) throw new TypeError("runtime identity digest does not match its fields");
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
		join(homedir(), ".local/bin/dsh"),
		join(homedir(), ".npm-global/bin/dsh")
	].find((candidate) => existsSync(candidate)) ?? "dsh";
}
function resolveConfig(config) {
	const dshHome = expandHome(config?.dshHome ?? process.env.DSH_HOME ?? "~/.dsh");
	const manifestPath = expandHome(config?.manifestPath ?? process.env.DSH_FLEET_MANIFEST ?? "~/.dsh/fleet/fleet.lock.yaml");
	const boundedNumber = (value, fallback, minimum, maximum) => value === void 0 || !Number.isFinite(value) ? fallback : Math.min(maximum, Math.max(minimum, Math.round(value)));
	return {
		deviceId: normalizeDeviceId(config?.deviceId ?? process.env.DSH_FLEET_DEVICE_ID ?? hostname()),
		manifestPath,
		desiredManifestPath: expandHome(config?.desiredManifestPath ?? process.env.DSH_FLEET_DESIRED_MANIFEST ?? manifestPath),
		profile: (config?.profile ?? process.env.DSH_FLEET_PROFILE ?? "web").trim(),
		dshHome,
		dshBinary: expandHome(config?.dshBinary ?? process.env.DSH_FLEET_DSH_BINARY ?? defaultDshBinary()),
		artifactStore: expandHome(config?.artifactStore ?? process.env.DSH_FLEET_ARTIFACT_STORE ?? "~/.dsh/fleet/artifacts"),
		updateCheck: config?.updateCheck !== false,
		updateCacheMs: boundedNumber(config?.updateCacheMs, 216e5, 6e4, 864e5),
		updateTimeoutMs: boundedNumber(config?.updateTimeoutMs, 5e3, 1e3, 15e3),
		convergence: {
			enabled: config?.convergence?.enabled === true,
			principalId: (config?.convergence?.principalId ?? process.env.USER ?? "local-owner").trim(),
			timeoutMs: boundedNumber(config?.convergence?.timeoutMs, 18e4, 5e3, 6e5),
			targets: config?.convergence?.targets ?? [],
			signerDeviceId: config?.convergence?.signerDeviceId === void 0 ? void 0 : normalizeDeviceId(config.convergence.signerDeviceId, "convergence.signerDeviceId")
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
async function collectFleetStatus(ctx, configInput, hostDependencies = {}) {
	const config = resolveConfig(configInput);
	const runtimeIdentity = await (hostDependencies.inspectRuntimeIdentity ?? inspectCurrentRuntimeIdentity)();
	validateRuntimeIdentity(runtimeIdentity);
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
		artifactDigests: Object.fromEntries((await Promise.all(reconcileFleet({
			manifest,
			deviceId: config.deviceId,
			profile: config.profile,
			dependencies,
			bundles,
			runtime: []
		}).plugins.filter((plugin) => plugin.desiredArtifactDigest !== void 0).map(async (plugin) => {
			const digest = await digestInstalledArtifact(join(config.dshHome, "profiles", config.profile), config.artifactStore, dependencies[plugin.id] ?? "");
			return digest === void 0 ? null : [plugin.id, digest];
		}))).filter((entry) => entry !== null)),
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
			version: runtimeIdentity.dshVersion,
			profile: config.profile
		},
		runtimeIdentity,
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
const TASK_CATALOG_STATES = /* @__PURE__ */ new Set([
	"accepted",
	"running",
	"cancel-requested",
	"succeeded",
	"failed",
	"cancelled"
]);
const TERMINAL_TASK_STATES = /* @__PURE__ */ new Set([
	"succeeded",
	"failed",
	"cancelled"
]);
function canonicalTimestamp(value, field) {
	const result = requiredString(value, field);
	const time = Date.parse(result);
	if (!Number.isFinite(time) || new Date(time).toISOString() !== result) throw new TypeError(field + " must be a canonical timestamp");
	return result;
}
function taskCatalog(value, targetDeviceId) {
	const body = closedPayload(value, ["generatedAt", "tasks"], "task catalog");
	if (!Array.isArray(body.tasks)) throw new TypeError("task catalog tasks must be an array");
	const tasks = body.tasks.map((item, index) => {
		const row = closedPayload(item, [
			"createdAt",
			"errorCode",
			"profile",
			"resultDigest",
			"state",
			"targetDeviceId",
			"taskId",
			"updatedAt",
			"workspaceId"
		], `task catalog tasks[${index}]`);
		const taskId = requiredString(row.taskId, `task catalog tasks[${index}].taskId`);
		validateA2APayload("task.status", { taskId });
		const state = requiredString(row.state, `task catalog tasks[${index}].state`);
		if (!TASK_CATALOG_STATES.has(state)) throw new TypeError(`task catalog tasks[${index}].state is invalid`);
		if (row.targetDeviceId !== targetDeviceId) throw new TypeError(`task catalog tasks[${index}] targets another device`);
		const nullable = (field) => {
			const raw = row[field];
			if (raw === null) return null;
			const text = requiredString(raw, `task catalog tasks[${index}].${field}`);
			if (field === "resultDigest" && !/^[0-9a-f]{64}$/.test(text)) throw new TypeError(`task catalog tasks[${index}].resultDigest is invalid`);
			return text;
		};
		return {
			taskId,
			state,
			targetDeviceId,
			workspaceId: requiredString(row.workspaceId, `task catalog tasks[${index}].workspaceId`),
			profile: requiredString(row.profile, `task catalog tasks[${index}].profile`),
			createdAt: canonicalTimestamp(row.createdAt, `task catalog tasks[${index}].createdAt`),
			updatedAt: canonicalTimestamp(row.updatedAt, `task catalog tasks[${index}].updatedAt`),
			errorCode: nullable("errorCode"),
			resultDigest: nullable("resultDigest")
		};
	});
	return {
		generatedAt: canonicalTimestamp(body.generatedAt, "task catalog generatedAt"),
		tasks
	};
}
function taskPruneResult(value) {
	const body = closedPayload(value, ["pruned", "skippedActive"], "task prune result");
	if (typeof body.pruned !== "number" || !Number.isSafeInteger(body.pruned) || body.pruned < 0 || typeof body.skippedActive !== "number" || !Number.isSafeInteger(body.skippedActive) || body.skippedActive < 0) throw new TypeError("task prune result counts must be non-negative integers");
	return {
		pruned: body.pruned,
		skippedActive: body.skippedActive
	};
}
function taskResumeResult(value) {
	const body = closedPayload(value, ["resumed"], "tasks resume result");
	if (typeof body.resumed !== "number" || !Number.isSafeInteger(body.resumed) || body.resumed < 0) throw new TypeError("tasks resume result must be a non-negative integer");
	return { resumed: body.resumed };
}
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FEDERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MESSAGE_ID_PATTERN = /^msg:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AGENT_ACTION_STATES = /* @__PURE__ */ new Set([
	"approved",
	"staging",
	"staged",
	"applying",
	"restarting",
	"verifying",
	"succeeded",
	"rollback",
	"rollback-restarting",
	"rollback-verifying",
	"rolled-back",
	"manual-intervention"
]);
function sha256Digest(value, field) {
	const result = requiredString(value, field);
	if (!SHA256_PATTERN.test(result)) throw new TypeError(field + " must be a lowercase SHA-256 digest");
	return result;
}
function federationIdentifier(value, field) {
	const result = requiredString(value, field);
	if (!FEDERATION_ID_PATTERN.test(result)) throw new TypeError(field + " is invalid");
	return result;
}
function namespacedMessageId(value, field) {
	const result = requiredString(value, field);
	if (!MESSAGE_ID_PATTERN.test(result)) throw new TypeError(field + " is invalid");
	return result;
}
function federationEnvelope(value, label = "federation envelope") {
	const body = closedPayload(value, [
		"expiresAt",
		"issuedAt",
		"kind",
		"messageId",
		"payload",
		"payloadDigest",
		"recipient",
		"schemaVersion",
		"sender",
		"signature",
		"teamId"
	], label);
	if (body.schemaVersion !== 2) throw new TypeError(label + " schemaVersion is invalid");
	const kind = requiredString(body.kind, label + ".kind");
	if (!isFleetFederationAdvisoryKind(kind)) throw new TypeError(label + " kind is not a federation advisory");
	const sender = closedPayload(body.sender, [
		"deviceId",
		"keyId",
		"principalId"
	], label + ".sender");
	const recipient = closedPayload(body.recipient, ["deviceId", "teamId"], label + ".recipient");
	federationIdentifier(body.teamId, label + ".teamId");
	federationIdentifier(sender.principalId, label + ".sender.principalId");
	federationIdentifier(sender.deviceId, label + ".sender.deviceId");
	const keyId = requiredString(sender.keyId, label + ".sender.keyId");
	if (!/^ed25519:[0-9a-f]{64}$/.test(keyId)) throw new TypeError(label + ".sender.keyId is invalid");
	federationIdentifier(recipient.teamId, label + ".recipient.teamId");
	federationIdentifier(recipient.deviceId, label + ".recipient.deviceId");
	namespacedMessageId(body.messageId, label + ".messageId");
	const issuedAt = canonicalTimestamp(body.issuedAt, label + ".issuedAt");
	const expiresAt = canonicalTimestamp(body.expiresAt, label + ".expiresAt");
	if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new TypeError(label + " validity window is invalid");
	sha256Digest(body.payloadDigest, label + ".payloadDigest");
	if (!/^[A-Za-z0-9_-]{86}$/.test(requiredString(body.signature, label + ".signature"))) throw new TypeError(label + ".signature is invalid");
	validateA2APayload(kind, body.payload);
	return value;
}
function federationInbox(value, localTeamId, localDeviceId) {
	if (!Array.isArray(value) || value.length > 100) throw new TypeError("federation inbox must be a bounded array");
	const seen = /* @__PURE__ */ new Set();
	return value.map((entry, index) => {
		const item = closedPayload(entry, [
			"acknowledgement",
			"expired",
			"record"
		], `federation inbox[${index}]`);
		if (typeof item.expired !== "boolean") throw new TypeError(`federation inbox[${index}].expired must be boolean`);
		const record = closedPayload(item.record, [
			"envelope",
			"receivedAt",
			"schemaVersion"
		], `federation inbox[${index}].record`);
		if (record.schemaVersion !== 1) throw new TypeError(`federation inbox[${index}].record schema is invalid`);
		canonicalTimestamp(record.receivedAt, `federation inbox[${index}].record.receivedAt`);
		const envelope = federationEnvelope(record.envelope, `federation inbox[${index}].record.envelope`);
		if (envelope.teamId === localTeamId || envelope.recipient.teamId !== localTeamId || envelope.recipient.deviceId !== localDeviceId) throw new TypeError(`federation inbox[${index}] is not a foreign message for this fixed signer`);
		if (seen.has(envelope.messageId)) throw new TypeError("federation inbox contains duplicate message ids");
		seen.add(envelope.messageId);
		let acknowledgement = null;
		if (item.acknowledgement !== null) {
			const ack = closedPayload(item.acknowledgement, [
				"acknowledgedAt",
				"disposition",
				"messageId",
				"payloadDigest",
				"schemaVersion"
			], `federation inbox[${index}].acknowledgement`);
			if (ack.schemaVersion !== 1 || ack.disposition !== "acknowledged" && ack.disposition !== "dismissed" || ack.messageId !== envelope.messageId || ack.payloadDigest !== envelope.payloadDigest) throw new TypeError(`federation inbox[${index}].acknowledgement does not match its message`);
			canonicalTimestamp(ack.acknowledgedAt, `federation inbox[${index}].acknowledgement.acknowledgedAt`);
			acknowledgement = ack;
		}
		return {
			record: {
				schemaVersion: 1,
				receivedAt: record.receivedAt,
				envelope
			},
			acknowledgement,
			expired: item.expired
		};
	});
}
function federationAcknowledgement(value, expected) {
	const body = closedPayload(value, ["acknowledgement", "status"], "federation acknowledgement result");
	if (body.status !== "acknowledged" && body.status !== "duplicate") throw new TypeError("federation acknowledgement status is invalid");
	const ack = closedPayload(body.acknowledgement, [
		"acknowledgedAt",
		"disposition",
		"messageId",
		"payloadDigest",
		"schemaVersion"
	], "federation acknowledgement");
	if (ack.schemaVersion !== 1 || ack.disposition !== "acknowledged" && ack.disposition !== "dismissed") throw new TypeError("federation acknowledgement is invalid");
	namespacedMessageId(ack.messageId, "federation acknowledgement.messageId");
	sha256Digest(ack.payloadDigest, "federation acknowledgement.payloadDigest");
	canonicalTimestamp(ack.acknowledgedAt, "federation acknowledgement.acknowledgedAt");
	if (ack.messageId !== expected.messageId || ack.payloadDigest !== expected.payloadDigest || ack.disposition !== expected.disposition) throw new TypeError("federation acknowledgement does not match the requested first-final disposition");
	return value;
}
function federationRetentionPlan(value) {
	const body = closedPayload(value, ["candidates", "generatedAt"], "federation retention plan");
	const generatedAt = canonicalTimestamp(body.generatedAt, "federation retention plan.generatedAt");
	if (!Array.isArray(body.candidates) || body.candidates.length > 500) throw new TypeError("federation retention candidates are invalid");
	return {
		generatedAt,
		candidates: body.candidates.map((candidate, index) => {
			const row = closedPayload(candidate, [
				"messageId",
				"payloadDigest",
				"reason"
			], `federation retention candidates[${index}]`);
			if (row.reason !== "acknowledged-retention" && row.reason !== "expired-retention" && row.reason !== "capacity") throw new TypeError(`federation retention candidates[${index}].reason is invalid`);
			const reason = row.reason;
			return {
				messageId: namespacedMessageId(row.messageId, `federation retention candidates[${index}].messageId`),
				payloadDigest: sha256Digest(row.payloadDigest, `federation retention candidates[${index}].payloadDigest`),
				reason
			};
		})
	};
}
function releaseAction(value, deviceId, profile) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("release action is invalid");
	const action = value;
	if (action.deviceId !== deviceId || action.profile !== profile || typeof action.planId !== "string" || typeof action.planDigest !== "string" || !SHA256_PATTERN.test(action.planDigest) || typeof action.releaseId !== "string" || typeof action.releaseVersion !== "string" || typeof action.releaseDigest !== "string" || !SHA256_PATTERN.test(action.releaseDigest) || typeof action.fromManifestDigest !== "string" || !SHA256_PATTERN.test(action.fromManifestDigest) || typeof action.toManifestDigest !== "string" || !SHA256_PATTERN.test(action.toManifestDigest) || action.fromReleaseDigest !== null && (typeof action.fromReleaseDigest !== "string" || !SHA256_PATTERN.test(action.fromReleaseDigest)) || typeof action.toReleaseDigest !== "string" || !SHA256_PATTERN.test(action.toReleaseDigest) || typeof action.rollbackDescriptorDigest !== "string" || !SHA256_PATTERN.test(action.rollbackDescriptorDigest) || typeof action.state !== "string" || !AGENT_ACTION_STATES.has(action.state) || typeof action.updatedAt !== "string") throw new TypeError("release action does not match the requested device and profile");
	canonicalTimestamp(action.updatedAt, "release action.updatedAt");
	return value;
}
function releaseRollbackAction(value, deviceId, profile) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("release rollback action is invalid");
	const action = value;
	if (action.deviceId !== deviceId || action.profile !== profile || typeof action.planId !== "string" || typeof action.planDigest !== "string" || !SHA256_PATTERN.test(action.planDigest) || typeof action.transitionPlanId !== "string" || !/^release-plan:[0-9a-f]{64}$/.test(action.transitionPlanId) || typeof action.fromManifestDigest !== "string" || !SHA256_PATTERN.test(action.fromManifestDigest) || typeof action.toManifestDigest !== "string" || !SHA256_PATTERN.test(action.toManifestDigest) || typeof action.fromReleaseDigest !== "string" || !SHA256_PATTERN.test(action.fromReleaseDigest) || action.toReleaseDigest !== null && (typeof action.toReleaseDigest !== "string" || !SHA256_PATTERN.test(action.toReleaseDigest)) || typeof action.state !== "string" || !AGENT_ACTION_STATES.has(action.state) || typeof action.updatedAt !== "string") throw new TypeError("release rollback action does not match the requested device and profile");
	canonicalTimestamp(action.updatedAt, "release rollback action.updatedAt");
	return value;
}
function releaseRetentionAction(value, expected) {
	const action = closedPayload(value, [
		"activeBackupQuarantinePrepared",
		"activeBackupRemoved",
		"activeTransitionPlanId",
		"approvalId",
		"currentTransitionPlanId",
		"deviceId",
		"idempotencyKey",
		"planDigest",
		"planId",
		"principalId",
		"profile",
		"removedTransitionPlanIds",
		"result",
		"state",
		"updatedAt"
	], "release retention action");
	if (action.planId !== expected.planId || action.planDigest !== expected.planDigest || action.deviceId !== expected.deviceId || action.profile !== expected.profile || action.principalId !== expected.principalId || expected.approvalId !== void 0 && action.approvalId !== expected.approvalId) throw new TypeError("release retention action does not match its approved plan and principal");
	if (typeof action.approvalId !== "string" || !FEDERATION_ID_PATTERN.test(action.approvalId) || typeof action.idempotencyKey !== "string" || !SHA256_PATTERN.test(action.idempotencyKey) || action.currentTransitionPlanId !== null && (typeof action.currentTransitionPlanId !== "string" || !/^release-plan:[0-9a-f]{64}$/.test(action.currentTransitionPlanId)) || action.activeTransitionPlanId !== null && (typeof action.activeTransitionPlanId !== "string" || !/^release-plan:[0-9a-f]{64}$/.test(action.activeTransitionPlanId)) || typeof action.activeBackupQuarantinePrepared !== "boolean" || typeof action.activeBackupRemoved !== "boolean" || !Array.isArray(action.removedTransitionPlanIds)) throw new TypeError("release retention action progress is invalid");
	const removedTransitionPlanIds = action.removedTransitionPlanIds;
	if (removedTransitionPlanIds.some((id) => typeof id !== "string" || !/^release-plan:[0-9a-f]{64}$/.test(id)) || new Set(removedTransitionPlanIds).size !== removedTransitionPlanIds.length || removedTransitionPlanIds.some((id, index) => index > 0 && id <= removedTransitionPlanIds[index - 1])) throw new TypeError("release retention action progress is invalid");
	if (action.currentTransitionPlanId !== null && removedTransitionPlanIds.includes(action.currentTransitionPlanId) || action.activeTransitionPlanId !== null && removedTransitionPlanIds.includes(action.activeTransitionPlanId)) throw new TypeError("release retention action cannot remove an active or current transition");
	canonicalTimestamp(action.updatedAt, "release retention action.updatedAt");
	if (action.state !== "approved" && action.state !== "applying" && action.state !== "succeeded") throw new TypeError("release retention action state is invalid");
	if (action.state === "succeeded" ? action.result !== "success" : action.result !== null) throw new TypeError("release retention action result is inconsistent with its state");
	if (action.activeTransitionPlanId === null && (action.activeBackupQuarantinePrepared !== false || action.activeBackupRemoved !== false)) throw new TypeError("release retention action has unbound backup progress");
	return value;
}
async function digestManifest(path) {
	return createHash("sha256").update(await readFile(path, "utf8"), "utf8").digest("hex");
}
async function loadManifestBinding(path) {
	const source = await readFile(path, "utf8");
	return {
		manifest: parseFleetManifest(source),
		digest: createHash("sha256").update(source, "utf8").digest("hex")
	};
}
function assertAgentConfiguration(expected, response) {
	assertAgentIdentity(expected.deviceId, response);
	if (response.profile !== expected.profile) throw new AgentClientError("agent-profile-mismatch", "fleet agent profile does not match the configured Host profile");
	if (response.manifestDigest !== expected.manifestDigest) throw new AgentClientError("agent-manifest-mismatch", "fleet agent manifest does not match the configured Host manifest");
}
function apply(ctx, config, hostDependencies = {}) {
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
	const assertActiveRoute = async (deviceId) => {
		const binding = await loadManifestBinding(resolved.desiredManifestPath);
		if (binding.manifest.devices[deviceId] === void 0) throw new AgentClientError("target-revoked", "target is not authorized by the active Fleet manifest");
		if (!resolved.convergence.targets.some((target) => target.deviceId === deviceId)) throw new AgentClientError("target-not-found", "fleet target is not configured");
		return binding;
	};
	const callActiveAgent = async (deviceId, command, payload, signal) => {
		await assertActiveRoute(deviceId);
		return agents.call(deviceId, command, payload, signal);
	};
	const federationSigner = async (signal) => {
		const deviceId = resolved.convergence.signerDeviceId;
		if (deviceId === void 0) throw new AgentClientError("a2a-signer-missing", "a fixed local A2A signer is not configured");
		const target = resolved.convergence.targets.find((candidate) => candidate.deviceId === deviceId);
		if (target === void 0 || target.transport !== "local") throw new AgentClientError("a2a-signer-invalid", "A2A signer must be a configured local Agent target");
		const report = await callActiveAgent(deviceId, "doctor", null, signal);
		if (report.protocolVersion !== 1 || report.ready !== true || report.deviceId !== deviceId || !FEDERATION_ID_PATTERN.test(report.teamId) || report.principalId !== resolved.convergence.principalId || !/^ed25519:[0-9a-f]{64}$/.test(report.identityKeyId)) throw new AgentClientError("a2a-signer-unready", "local A2A signer doctor identity is invalid");
		return {
			deviceId,
			teamId: report.teamId,
			principalId: report.principalId,
			keyId: report.identityKeyId
		};
	};
	const signFederationAdvisory = async (recipientTeamId, recipientDeviceId, kind, advisoryPayload, signal) => {
		const signer = await federationSigner(signal);
		const targetTeamId = federationIdentifier(recipientTeamId, "recipientTeamId");
		const targetDeviceId = normalizeDeviceId(federationIdentifier(recipientDeviceId, "recipientDeviceId"));
		if (targetTeamId === signer.teamId) throw new AgentClientError("federation-same-team", "cross-team export requires a foreign recipient team");
		validateA2APayload(kind, advisoryPayload);
		const envelope = federationEnvelope(await callActiveAgent(signer.deviceId, "a2a-sign", {
			recipientDeviceId: targetDeviceId,
			recipientTeamId: targetTeamId,
			kind,
			payload: advisoryPayload
		}, signal), "signed federation export");
		if (envelope.kind !== kind || envelope.teamId !== signer.teamId || envelope.sender.deviceId !== signer.deviceId || envelope.sender.principalId !== signer.principalId || envelope.sender.keyId !== signer.keyId || envelope.recipient.teamId !== targetTeamId || envelope.recipient.deviceId !== targetDeviceId || canonicalJson(envelope.payload) !== canonicalJson(advisoryPayload)) throw new AgentClientError("federation-export-mismatch", "signed federation export does not match its requested binding");
		return envelope;
	};
	const signedTaskCall = async (targetDeviceId, kind, taskPayload, signal) => {
		const signerDeviceId = resolved.convergence.signerDeviceId;
		if (signerDeviceId === void 0) throw new AgentClientError("a2a-signer-missing", "a fixed local A2A signer is not configured");
		const signer = resolved.convergence.targets.find((target) => target.deviceId === signerDeviceId);
		if (signer === void 0 || signer.transport !== "local") throw new AgentClientError("a2a-signer-invalid", "A2A signer must be a configured local Agent target");
		await assertActiveRoute(targetDeviceId);
		await assertActiveRoute(signerDeviceId);
		const envelope = await callActiveAgent(signerDeviceId, "a2a-sign", {
			recipientDeviceId: targetDeviceId,
			kind,
			payload: taskPayload
		}, signal);
		const receipt = await callActiveAgent(targetDeviceId, "a2a-receive", { envelope }, signal);
		if (receipt.requestMessageId !== envelope.messageId || typeof receipt.response !== "object" || receipt.response === null) throw new AgentClientError("a2a-receipt-invalid", "target returned an invalid A2A receipt");
		const verified = await callActiveAgent(signerDeviceId, "a2a-verify", { envelope: receipt.response }, signal);
		if (verified.sender.deviceId !== targetDeviceId || verified.payload.taskId !== taskPayload.taskId || verified.kind !== "task.progress" && verified.kind !== "task.result" && verified.kind !== "task.approval.request") throw new AgentClientError("a2a-response-mismatch", "signed task response does not match the requested target and task");
		return verified;
	};
	host.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
		try {
			if (endpoint === "status") return ok(await collectFleetStatus(host, config, hostDependencies));
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
				const binding = await loadManifestBinding(resolved.desiredManifestPath);
				const targets = await Promise.all(agents.targets.map(async (target) => {
					try {
						const releaseMode = binding.manifest.schemaVersion === 2;
						const inspection = releaseMode ? await callActiveAgent(target.deviceId, "release-inspect", null, signal) : await callActiveAgent(target.deviceId, "inspect", null, signal);
						if (releaseMode && "kind" in inspection && inspection.kind === "profile-release") {
							assertAgentIdentity(target.deviceId, inspection);
							if (!SHA256_PATTERN.test(inspection.observedRuntimeDigest) || inspection.observedServiceDefinitionDigest !== null && !SHA256_PATTERN.test(inspection.observedServiceDefinitionDigest)) throw new AgentClientError("agent-runtime-identity-invalid", "fleet agent runtime identity is invalid");
							if (inspection.profile !== resolved.profile) throw new AgentClientError("agent-profile-mismatch", "fleet agent profile does not match the configured Host profile");
							if (inspection.desiredManifestDigest !== binding.digest) throw new AgentClientError("agent-manifest-mismatch", "fleet agent desired manifest does not match the configured Host manifest");
						} else assertAgentConfiguration({
							deviceId: target.deviceId,
							profile: resolved.profile,
							manifestDigest: binding.digest
						}, inspection);
						let readiness;
						let readinessErrorCode;
						if (releaseMode) try {
							readiness = await callActiveAgent(target.deviceId, "doctor", null, signal);
						} catch (error) {
							readinessErrorCode = error instanceof AgentClientError ? error.code : "agent-readiness-unavailable";
						}
						return {
							...target,
							online: true,
							mode: releaseMode ? "profile-release" : "single-plugin",
							inspection,
							...readiness === void 0 ? {} : { readiness },
							...readinessErrorCode === void 0 ? {} : { readinessErrorCode }
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
				const signerDeviceId = resolved.convergence.signerDeviceId;
				const signerConfig = signerDeviceId === void 0 ? void 0 : agents.targets.find((target) => target.deviceId === signerDeviceId);
				const signerTarget = signerDeviceId === void 0 ? void 0 : targets.find((target) => target.deviceId === signerDeviceId);
				const signer = signerDeviceId === void 0 ? {
					configured: false,
					ready: false,
					errorCode: "a2a-signer-missing"
				} : signerConfig?.transport !== "local" ? {
					configured: true,
					deviceId: signerDeviceId,
					ready: false,
					errorCode: "a2a-signer-invalid"
				} : signerTarget?.online === true && "readiness" in signerTarget ? {
					configured: true,
					deviceId: signerDeviceId,
					ready: true
				} : {
					configured: true,
					deviceId: signerDeviceId,
					ready: false,
					errorCode: "a2a-signer-unready"
				};
				return ok({
					enabled: true,
					signer,
					targets
				});
			}
			if (endpoint === "plan") {
				const body = closedPayload(payload, ["deviceId", "pluginId"], "plan payload");
				const deviceId = requiredString(body.deviceId, "deviceId");
				const pluginId = requiredString(body.pluginId, "pluginId");
				const plan = await callActiveAgent(deviceId, "plan", { pluginId }, signal);
				assertAgentConfiguration({
					deviceId,
					profile: resolved.profile,
					manifestDigest: await digestManifest(resolved.manifestPath)
				}, plan);
				return ok(plan);
			}
			if (endpoint === "release-plan") {
				const deviceId = requiredString(closedPayload(payload, ["deviceId"], "release plan payload").deviceId, "deviceId");
				const plan = await callActiveAgent(deviceId, "release-plan", null, signal);
				assertAgentIdentity(deviceId, plan);
				if (plan.profile !== resolved.profile) throw new AgentClientError("agent-profile-mismatch", "fleet agent profile does not match the configured Host profile");
				if (plan.toManifestDigest !== await digestManifest(resolved.desiredManifestPath)) throw new AgentClientError("agent-manifest-mismatch", "release transition does not target the active Host manifest");
				return ok(plan);
			}
			if (endpoint === "release-rollback-plan") {
				const body = closedPayload(payload, ["deviceId", "transitionPlanId"], "release rollback plan payload");
				const deviceId = normalizeDeviceId(requiredString(body.deviceId, "deviceId"));
				const transitionPlanId = requiredString(body.transitionPlanId, "transitionPlanId");
				const transition = releaseAction(await callActiveAgent(deviceId, "release-status", { planId: transitionPlanId }, signal), deviceId, resolved.profile);
				if (transition.planId !== transitionPlanId || transition.state !== "succeeded" || transition.result !== "success") throw new AgentClientError("rollback-not-available", "only a successfully applied release transition can be rolled back");
				const plan = await callActiveAgent(deviceId, "release-rollback-plan", { transitionPlanId }, signal);
				validateFleetReleaseRollbackPlan(plan);
				const activeManifestDigest = await digestManifest(resolved.desiredManifestPath);
				if (plan.deviceId !== deviceId || plan.profile !== resolved.profile || plan.transitionPlanId !== transitionPlanId || plan.transitionPlanDigest !== transition.planDigest || plan.fromManifestDigest !== transition.toManifestDigest || plan.toManifestDigest !== transition.fromManifestDigest || plan.fromReleaseDigest !== transition.toReleaseDigest || plan.toReleaseDigest !== transition.fromReleaseDigest || plan.fromManifestDigest !== activeManifestDigest) throw new AgentClientError("release-rollback-mismatch", "release rollback plan is not the exact inverse of the active successful transition");
				if (Date.parse(plan.expiresAt) <= Date.now()) throw new AgentClientError("plan-expired", "release rollback plan has expired");
				return ok(plan);
			}
			if (endpoint === "release-retention-plan") {
				const deviceId = normalizeDeviceId(requiredString(closedPayload(payload, ["deviceId"], "release retention plan payload").deviceId, "deviceId"));
				const plan = await callActiveAgent(deviceId, "release-retention-plan", null, signal);
				validateFleetReleaseRetentionPlan(plan);
				assertAgentIdentity(deviceId, plan);
				if (plan.profile !== resolved.profile) throw new AgentClientError("agent-profile-mismatch", "release retention plan profile does not match the configured Host profile");
				if (Date.parse(plan.expiresAt) <= Date.now()) throw new AgentClientError("plan-expired", "release retention plan has expired");
				return ok(plan);
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
					planDigest: sha256Digest(body.planDigest, "planDigest"),
					deviceId,
					profile: requiredString(body.profile, "profile"),
					approvedAt: approvedAt.toISOString(),
					expiresAt: new Date(Math.min(planExpiresAt.getTime(), approvedAt.getTime() + 12e4)).toISOString()
				};
				return ok(await callActiveAgent(deviceId, "apply", { approval }, signal));
			}
			if (endpoint === "release-approve") {
				const body = closedPayload(payload, [
					"approvalId",
					"deviceId",
					"fromManifestDigest",
					"fromReleaseDigest",
					"planDigest",
					"planExpiresAt",
					"planId",
					"profile",
					"toManifestDigest",
					"toReleaseDigest"
				], "release approve payload");
				const deviceId = requiredString(body.deviceId, "deviceId");
				const profile = requiredString(body.profile, "profile");
				if (profile !== resolved.profile) throw new AgentClientError("agent-profile-mismatch", "release approval profile does not match the configured Host profile");
				const fromManifestDigest = sha256Digest(body.fromManifestDigest, "fromManifestDigest");
				const toManifestDigest = sha256Digest(body.toManifestDigest, "toManifestDigest");
				const fromReleaseDigest = body.fromReleaseDigest === null ? null : sha256Digest(body.fromReleaseDigest, "fromReleaseDigest");
				const toReleaseDigest = sha256Digest(body.toReleaseDigest, "toReleaseDigest");
				if (toManifestDigest !== await digestManifest(resolved.desiredManifestPath)) throw new AgentClientError("agent-manifest-mismatch", "release approval no longer targets the desired Host manifest");
				const approvedAt = /* @__PURE__ */ new Date();
				const planExpiresAt = new Date(requiredString(body.planExpiresAt, "planExpiresAt"));
				if (!Number.isFinite(planExpiresAt.getTime()) || planExpiresAt <= approvedAt) throw new TypeError("planExpiresAt must be in the future");
				const approval = {
					protocolVersion: 2,
					kind: "profile-release",
					approvalId: requiredString(body.approvalId, "approvalId"),
					principalId: resolved.convergence.principalId,
					planId: requiredString(body.planId, "planId"),
					planDigest: sha256Digest(body.planDigest, "planDigest"),
					deviceId,
					profile,
					fromManifestDigest,
					toManifestDigest,
					fromReleaseDigest,
					toReleaseDigest,
					approvedAt: approvedAt.toISOString(),
					expiresAt: new Date(Math.min(planExpiresAt.getTime(), approvedAt.getTime() + 12e4)).toISOString()
				};
				return ok(await callActiveAgent(deviceId, "release-apply", { approval }, signal));
			}
			if (endpoint === "release-rollback-approve") {
				const body = closedPayload(payload, [
					"approvalId",
					"deviceId",
					"fromManifestDigest",
					"fromReleaseDigest",
					"planDigest",
					"planExpiresAt",
					"planId",
					"profile",
					"toManifestDigest",
					"toReleaseDigest",
					"transitionPlanId"
				], "release rollback approve payload");
				const deviceId = normalizeDeviceId(requiredString(body.deviceId, "deviceId"));
				const profile = requiredString(body.profile, "profile");
				if (profile !== resolved.profile) throw new AgentClientError("agent-profile-mismatch", "release rollback profile does not match the configured Host profile");
				const transitionPlanId = requiredString(body.transitionPlanId, "transitionPlanId");
				const transition = releaseAction(await callActiveAgent(deviceId, "release-status", { planId: transitionPlanId }, signal), deviceId, profile);
				if (transition.planId !== transitionPlanId || transition.state !== "succeeded" || transition.result !== "success") throw new AgentClientError("rollback-not-available", "release transition is no longer eligible for explicit rollback");
				const fromManifestDigest = sha256Digest(body.fromManifestDigest, "fromManifestDigest");
				const toManifestDigest = sha256Digest(body.toManifestDigest, "toManifestDigest");
				const fromReleaseDigest = sha256Digest(body.fromReleaseDigest, "fromReleaseDigest");
				const toReleaseDigest = body.toReleaseDigest === null ? null : sha256Digest(body.toReleaseDigest, "toReleaseDigest");
				if (fromManifestDigest !== transition.toManifestDigest || toManifestDigest !== transition.fromManifestDigest || fromReleaseDigest !== transition.toReleaseDigest || toReleaseDigest !== transition.fromReleaseDigest || fromManifestDigest !== await digestManifest(resolved.desiredManifestPath)) throw new AgentClientError("release-rollback-mismatch", "release rollback approval does not invert the active successful transition");
				const approvedAt = /* @__PURE__ */ new Date();
				const planExpiresAt = new Date(requiredString(body.planExpiresAt, "planExpiresAt"));
				if (!Number.isFinite(planExpiresAt.getTime()) || planExpiresAt <= approvedAt) throw new TypeError("planExpiresAt must be in the future");
				const approval = {
					protocolVersion: 2,
					kind: "profile-release-rollback",
					approvalId: requiredString(body.approvalId, "approvalId"),
					principalId: resolved.convergence.principalId,
					planId: requiredString(body.planId, "planId"),
					planDigest: sha256Digest(body.planDigest, "planDigest"),
					transitionPlanId,
					deviceId,
					profile,
					fromManifestDigest,
					toManifestDigest,
					fromReleaseDigest,
					toReleaseDigest,
					approvedAt: approvedAt.toISOString(),
					expiresAt: new Date(Math.min(planExpiresAt.getTime(), approvedAt.getTime() + 12e4)).toISOString()
				};
				const action = releaseRollbackAction(await callActiveAgent(deviceId, "release-rollback-apply", { approval }, signal), deviceId, profile);
				if (action.planId !== approval.planId || action.transitionPlanId !== transitionPlanId) throw new AgentClientError("release-rollback-mismatch", "release rollback action does not match its approved plan");
				return ok(action);
			}
			if (endpoint === "release-retention-approve") {
				const body = closedPayload(payload, [
					"approvalId",
					"deviceId",
					"planDigest",
					"planExpiresAt",
					"planId",
					"profile"
				], "release retention approve payload");
				const deviceId = normalizeDeviceId(requiredString(body.deviceId, "deviceId"));
				const profile = federationIdentifier(body.profile, "profile");
				if (profile !== resolved.profile) throw new AgentClientError("agent-profile-mismatch", "release retention approval profile does not match the configured Host profile");
				const planDigest = sha256Digest(body.planDigest, "planDigest");
				const planId = requiredString(body.planId, "planId");
				if (planId !== "release-retention-plan:" + planDigest) throw new TypeError("release retention planId does not match planDigest");
				const approvalId = federationIdentifier(body.approvalId, "approvalId");
				const principalId = federationIdentifier(resolved.convergence.principalId, "principalId");
				const approvedAt = /* @__PURE__ */ new Date();
				const planExpiresAt = new Date(canonicalTimestamp(body.planExpiresAt, "planExpiresAt"));
				if (planExpiresAt <= approvedAt) throw new TypeError("planExpiresAt must be in the future");
				const approval = {
					protocolVersion: 1,
					kind: "profile-release-retention",
					approvalId,
					principalId,
					planId,
					planDigest,
					deviceId,
					profile,
					approvedAt: approvedAt.toISOString(),
					expiresAt: new Date(Math.min(planExpiresAt.getTime(), approvedAt.getTime() + 12e4)).toISOString()
				};
				const action = releaseRetentionAction(await callActiveAgent(deviceId, "release-retention-apply", { approval }, signal), {
					approvalId,
					deviceId,
					planDigest,
					planId,
					principalId,
					profile
				});
				return ok(action);
			}
			if (endpoint === "action-status") {
				const body = closedPayload(payload, ["deviceId", "planId"], "status payload");
				const deviceId = requiredString(body.deviceId, "deviceId");
				const planId = requiredString(body.planId, "planId");
				return ok(await callActiveAgent(deviceId, "status", { planId }, signal));
			}
			if (endpoint === "release-action-status") {
				const body = closedPayload(payload, ["deviceId", "planId"], "release status payload");
				const deviceId = requiredString(body.deviceId, "deviceId");
				const planId = requiredString(body.planId, "planId");
				return ok(await callActiveAgent(deviceId, "release-status", { planId }, signal));
			}
			if (endpoint === "release-rollback-action-status") {
				const body = closedPayload(payload, ["deviceId", "planId"], "release rollback status payload");
				const deviceId = normalizeDeviceId(requiredString(body.deviceId, "deviceId"));
				const planId = requiredString(body.planId, "planId");
				const action = releaseRollbackAction(await callActiveAgent(deviceId, "release-rollback-status", { planId }, signal), deviceId, resolved.profile);
				if (action.planId !== planId) throw new AgentClientError("release-rollback-mismatch", "release rollback status does not match the requested plan");
				return ok(action);
			}
			if (endpoint === "release-retention-action-status") {
				const body = closedPayload(payload, ["deviceId", "planId"], "release retention status payload");
				const deviceId = normalizeDeviceId(requiredString(body.deviceId, "deviceId"));
				const planId = requiredString(body.planId, "planId");
				const match = /^release-retention-plan:([0-9a-f]{64})$/.exec(planId);
				if (match?.[1] === void 0) throw new TypeError("release retention planId is invalid");
				const action = releaseRetentionAction(await callActiveAgent(deviceId, "release-retention-status", { planId }, signal), {
					deviceId,
					planDigest: match[1],
					planId,
					principalId: federationIdentifier(resolved.convergence.principalId, "principalId"),
					profile: resolved.profile
				});
				return ok(action);
			}
			if (endpoint === "federation-list") {
				const body = closedPayload(payload, ["limit"], "federation list payload");
				if (typeof body.limit !== "number" || !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 100) throw new TypeError("federation list limit must be an integer from 1 to 100");
				const signer = await federationSigner(signal);
				return ok(federationInbox(await callActiveAgent(signer.deviceId, "federation-list", { limit: body.limit }, signal), signer.teamId, signer.deviceId));
			}
			if (endpoint === "ack") {
				const body = closedPayload(payload, [
					"disposition",
					"messageId",
					"payloadDigest"
				], "federation acknowledgement payload");
				const disposition = body.disposition;
				if (disposition !== "acknowledged" && disposition !== "dismissed") throw new TypeError("federation acknowledgement disposition is invalid");
				const signer = await federationSigner(signal);
				const acknowledgement = {
					disposition,
					messageId: namespacedMessageId(body.messageId, "messageId"),
					payloadDigest: sha256Digest(body.payloadDigest, "payloadDigest")
				};
				return ok(federationAcknowledgement(await callActiveAgent(signer.deviceId, "federation-ack", acknowledgement, signal), acknowledgement));
			}
			if (endpoint === "retention-plan") {
				if (payload !== null) throw new TypeError("federation retention plan payload must be null");
				const signer = await federationSigner(signal);
				return ok(federationRetentionPlan(await callActiveAgent(signer.deviceId, "federation-retention-plan", {
					acknowledgedRetentionMs: 2592e6,
					expiredRetentionMs: 2592e6,
					maxEntries: 500
				}, signal)));
			}
			if (endpoint === "import") {
				const body = closedPayload(payload, ["envelope"], "federation import payload");
				const signer = await federationSigner(signal);
				const incoming = federationEnvelope(body.envelope, "federation import envelope");
				if (incoming.teamId === signer.teamId || incoming.recipient.teamId !== signer.teamId || incoming.recipient.deviceId !== signer.deviceId) throw new AgentClientError("federation-recipient-mismatch", "federation import must be a foreign advisory addressed to the fixed local signer");
				const receipt = await callActiveAgent(signer.deviceId, "a2a-receive", { envelope: incoming }, signal);
				if (receipt.requestMessageId !== incoming.messageId) throw new AgentClientError("a2a-receipt-invalid", "federation import returned an unrelated receipt");
				const signedReceipt = federationEnvelope(receipt.response, "federation import receipt");
				const expectedStatus = incoming.kind === "handoff" ? "stored" : "accepted";
				if (signedReceipt.kind !== "receipt" || signedReceipt.teamId !== signer.teamId || signedReceipt.sender.deviceId !== signer.deviceId || signedReceipt.sender.principalId !== signer.principalId || signedReceipt.sender.keyId !== signer.keyId || signedReceipt.recipient.teamId !== incoming.teamId || signedReceipt.recipient.deviceId !== incoming.sender.deviceId || signedReceipt.payload.requestMessageId !== incoming.messageId || signedReceipt.payload.status !== expectedStatus) throw new AgentClientError("a2a-receipt-invalid", "federation import returned an invalid signed receipt");
				return ok(signedReceipt);
			}
			if (endpoint === "handoff-export") {
				const body = closedPayload(payload, [
					"artifactRefs",
					"handoffId",
					"recipientDeviceId",
					"recipientTeamId",
					"summary",
					"taskId"
				], "federation handoff export payload");
				const handoffPayload = {
					handoffId: requiredString(body.handoffId, "handoffId"),
					taskId: body.taskId === null ? null : requiredString(body.taskId, "taskId"),
					summary: requiredString(body.summary, "summary"),
					artifactRefs: body.artifactRefs
				};
				return ok(await signFederationAdvisory(requiredString(body.recipientTeamId, "recipientTeamId"), requiredString(body.recipientDeviceId, "recipientDeviceId"), "handoff", handoffPayload, signal));
			}
			if (endpoint === "approval-request-export") {
				const body = closedPayload(payload, [
					"approvalId",
					"expiresAt",
					"recipientDeviceId",
					"recipientTeamId",
					"summary",
					"taskId"
				], "federation approval request export payload");
				const expiresAt = canonicalTimestamp(body.expiresAt, "expiresAt");
				const now = Date.now();
				if (Date.parse(expiresAt) <= now || Date.parse(expiresAt) > now + 864e5) throw new TypeError("federation approval request expiry must be within the next 24 hours");
				const requestPayload = {
					approvalId: requiredString(body.approvalId, "approvalId"),
					taskId: requiredString(body.taskId, "taskId"),
					summary: requiredString(body.summary, "summary"),
					expiresAt
				};
				return ok(await signFederationAdvisory(requiredString(body.recipientTeamId, "recipientTeamId"), requiredString(body.recipientDeviceId, "recipientDeviceId"), "approval.request", requestPayload, signal));
			}
			if (endpoint === "approval-decision-export") {
				const body = closedPayload(payload, ["decision", "request"], "federation approval decision export payload");
				const decision = requiredString(body.decision, "decision");
				if (decision !== "endorsed" && decision !== "declined") throw new TypeError("federation approval decision is invalid");
				const signer = await federationSigner(signal);
				const supplied = federationEnvelope(body.request, "federation approval request");
				if (supplied.kind !== "approval.request" || supplied.teamId === signer.teamId || supplied.recipient.teamId !== signer.teamId || supplied.recipient.deviceId !== signer.deviceId) throw new AgentClientError("federation-approval-mismatch", "approval decision requires a foreign request addressed to the fixed local signer");
				const request = federationEnvelope(await callActiveAgent(signer.deviceId, "a2a-verify", { envelope: supplied }, signal), "verified federation approval request");
				if (request.kind !== "approval.request" || request.messageId !== supplied.messageId || request.payloadDigest !== supplied.payloadDigest || request.teamId !== supplied.teamId || request.sender.deviceId !== supplied.sender.deviceId || Date.parse(request.expiresAt) <= Date.now() || Date.parse(request.payload.expiresAt) <= Date.now()) throw new AgentClientError("federation-approval-mismatch", "verified federation approval request is stale or does not match the supplied envelope");
				const decisionPayload = {
					approvalId: request.payload.approvalId,
					taskId: request.payload.taskId,
					approvalRequestMessageId: request.messageId,
					approvalRequestPayloadDigest: request.payloadDigest,
					decision,
					decidedAt: (/* @__PURE__ */ new Date()).toISOString()
				};
				return ok(await signFederationAdvisory(request.teamId, request.sender.deviceId, "approval.decision", decisionPayload, signal));
			}
			if (endpoint === "task-submit") {
				const body = closedPayload(payload, [
					"policyId",
					"profile",
					"prompt",
					"targetDeviceId",
					"taskId",
					"workspaceId"
				], "task submit payload");
				const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, "targetDeviceId"));
				const taskId = requiredString(body.taskId, "taskId");
				const workspaceId = requiredString(body.workspaceId, "workspaceId");
				const profile = requiredString(body.profile, "profile");
				const policyId = requiredString(body.policyId, "policyId");
				const prompt = requiredString(body.prompt, "prompt");
				validateA2APayload("task.status", { taskId });
				const desiredBinding = await assertActiveRoute(targetDeviceId);
				const liveBinding = await loadManifestBinding(resolved.manifestPath);
				if (desiredBinding.manifest.schemaVersion !== 2 || desiredBinding.manifest.v2?.assignments[targetDeviceId]?.[resolved.profile] === void 0) throw new AgentClientError("task-target-not-assigned", "task target is not assigned to the active profile release");
				const inspection = await callActiveAgent(targetDeviceId, "release-inspect", null, signal);
				assertAgentIdentity(targetDeviceId, inspection);
				if (inspection.profile !== resolved.profile || inspection.liveManifestDigest !== liveBinding.digest || inspection.desiredManifestDigest !== desiredBinding.digest || liveBinding.digest !== desiredBinding.digest) throw new AgentClientError("task-release-mismatch", "task target and Host must agree on the same live and desired Fleet manifest");
				if (inspection.currentRelease === null || inspection.currentRelease.releaseDigest !== inspection.assignedRelease.releaseDigest || inspection.currentRelease.releaseId !== inspection.assignedRelease.releaseId || inspection.currentRelease.releaseVersion !== inspection.assignedRelease.releaseVersion || inspection.changes.length !== 0) throw new AgentClientError("task-target-not-aligned", "task target must be fully aligned with its assigned release");
				if (!inspection.tasks.enabled) throw new AgentClientError("tasks-disabled", "remote tasks are disabled on this target");
				if (!inspection.tasks.workspaceIds.includes(workspaceId) || !inspection.tasks.profiles.includes(profile)) throw new AgentClientError("task-policy-denied", "task workspace or profile is not enabled on this target");
				if (!Array.isArray(inspection.tasks.executionProfiles) || !Array.isArray(inspection.tasks.profiles) || !inspection.tasks.profiles.every((candidate) => typeof candidate === "string")) throw new AgentClientError("task-profile-unbound", "target did not bind its executable task profiles");
				const executionProfileBindings = /* @__PURE__ */ new Map();
				for (const candidate of inspection.tasks.executionProfiles) {
					if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) throw new AgentClientError("task-profile-unbound", "task execution profile hash is missing, duplicated, or invalid");
					const binding = candidate;
					if (Object.keys(binding).length !== 2 || !Object.hasOwn(binding, "profile") || !Object.hasOwn(binding, "profileHash") || typeof binding.profile !== "string" || !inspection.tasks.profiles.includes(binding.profile) || typeof binding.profileHash !== "string" || !SHA256_PATTERN.test(binding.profileHash) || executionProfileBindings.has(binding.profile)) throw new AgentClientError("task-profile-unbound", "task execution profile hash is missing, duplicated, or invalid");
					executionProfileBindings.set(binding.profile, binding.profileHash);
				}
				const executionProfileHash = executionProfileBindings.get(profile);
				if (executionProfileHash === void 0 || executionProfileBindings.size !== inspection.tasks.profiles.length || new Set(inspection.tasks.profiles).size !== inspection.tasks.profiles.length) throw new AgentClientError("task-profile-unbound", "task execution profile hash is missing, duplicated, or invalid");
				const policy = inspection.tasks.policies.find((candidate) => candidate.policyId === policyId);
				if (policy === void 0) throw new AgentClientError("task-policy-denied", "requested task policy is not enabled on this target");
				const timeoutMs = Math.min(6e5, inspection.tasks.timeoutMs ?? 6e5);
				const taskPayload = {
					taskId,
					workspaceId,
					profile,
					executionProfileHash,
					manifestDigest: liveBinding.digest,
					releaseDigest: inspection.currentRelease.releaseDigest,
					policyId: policy.policyId,
					policyDigest: policy.policyDigest,
					deadline: new Date(Date.now() + timeoutMs).toISOString(),
					prompt
				};
				validateA2APayload("task.submit", taskPayload);
				const response = await signedTaskCall(targetDeviceId, "task.submit", taskPayload, signal);
				return ok({
					taskId: taskPayload.taskId,
					response
				});
			}
			if (endpoint === "task-approval-decision") {
				const body = closedPayload(payload, [
					"decision",
					"request",
					"targetDeviceId",
					"taskId"
				], "task approval decision payload");
				const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, "targetDeviceId"));
				const taskId = requiredString(body.taskId, "taskId");
				const decision = requiredString(body.decision, "decision");
				if (decision !== "allowed-once" && decision !== "rejected") throw new TypeError("decision must be allowed-once or rejected");
				const signerDeviceId = resolved.convergence.signerDeviceId;
				if (signerDeviceId === void 0) throw new AgentClientError("a2a-signer-missing", "a fixed local A2A signer is not configured");
				const signer = resolved.convergence.targets.find((target) => target.deviceId === signerDeviceId);
				if (signer === void 0 || signer.transport !== "local") throw new AgentClientError("a2a-signer-invalid", "A2A signer must be a configured local Agent target");
				await assertActiveRoute(targetDeviceId);
				await assertActiveRoute(signerDeviceId);
				const request = await callActiveAgent(signerDeviceId, "a2a-verify", { envelope: body.request }, signal);
				if (request.kind !== "task.approval.request" || request.sender.deviceId !== targetDeviceId || request.payload.taskId !== taskId) throw new AgentClientError("task-approval-mismatch", "signed approval request does not match the target and task");
				const requestPayload = request.payload;
				validateA2APayload("task.approval.request", requestPayload);
				if (Date.parse(requestPayload.expiresAt) <= Date.now()) throw new AgentClientError("task-approval-expired", "signed task approval request has expired");
				const decisionPayload = {
					approvalId: requestPayload.approvalId,
					taskId,
					approvalRequestMessageId: request.messageId,
					approvalRequestPayloadDigest: request.payloadDigest,
					taskBindingDigest: requestPayload.taskBindingDigest,
					toolCallId: requestPayload.toolCallId,
					argumentsDigest: requestPayload.argumentsDigest,
					decision,
					decidedAt: (/* @__PURE__ */ new Date()).toISOString()
				};
				validateA2APayload("task.approval.decision", decisionPayload);
				const envelope = await callActiveAgent(signerDeviceId, "a2a-sign", {
					recipientDeviceId: targetDeviceId,
					kind: "task.approval.decision",
					payload: decisionPayload
				}, signal);
				const receipt = await callActiveAgent(targetDeviceId, "a2a-receive", { envelope }, signal);
				if (receipt.requestMessageId !== envelope.messageId) throw new AgentClientError("a2a-receipt-invalid", "target returned an invalid approval receipt");
				const verified = await callActiveAgent(signerDeviceId, "a2a-verify", { envelope: receipt.response }, signal);
				if (verified.kind !== "receipt" || verified.sender.deviceId !== targetDeviceId || verified.payload.requestMessageId !== envelope.messageId || verified.payload.status !== "accepted") throw new AgentClientError("a2a-response-mismatch", "signed approval receipt does not match the decision");
				return ok({
					taskId,
					response: verified
				});
			}
			if (endpoint === "task-status" || endpoint === "task-cancel") {
				const body = closedPayload(payload, ["targetDeviceId", "taskId"], "task control payload");
				const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, "targetDeviceId"));
				const taskId = requiredString(body.taskId, "taskId");
				validateA2APayload(endpoint === "task-status" ? "task.status" : "task.cancel", { taskId });
				const response = await signedTaskCall(targetDeviceId, endpoint === "task-status" ? "task.status" : "task.cancel", { taskId }, signal);
				return ok({
					taskId,
					response
				});
			}
			if (endpoint === "tasks-list") {
				const body = closedPayload(payload, ["limit", "targetDeviceId"], "tasks-list payload");
				const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, "targetDeviceId"));
				if (typeof body.limit !== "number" || !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 100) throw new TypeError("tasks-list limit must be an integer from 1 to 100");
				return ok(taskCatalog(await callActiveAgent(targetDeviceId, "tasks-list", { limit: body.limit }, signal), targetDeviceId));
			}
			if (endpoint === "tasks-prune") {
				const body = closedPayload(payload, [
					"olderThan",
					"states",
					"targetDeviceId"
				], "tasks-prune payload");
				const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, "targetDeviceId"));
				const olderThan = canonicalTimestamp(body.olderThan, "olderThan");
				if (!Array.isArray(body.states) || body.states.length === 0 || body.states.length > TERMINAL_TASK_STATES.size || body.states.some((state) => typeof state !== "string" || !TERMINAL_TASK_STATES.has(state)) || new Set(body.states).size !== body.states.length) throw new TypeError("tasks-prune states must be unique terminal task states");
				return ok(taskPruneResult(await callActiveAgent(targetDeviceId, "tasks-prune", {
					olderThan,
					states: body.states
				}, signal)));
			}
			if (endpoint === "tasks-resume") {
				const targetDeviceId = normalizeDeviceId(requiredString(closedPayload(payload, ["targetDeviceId"], "tasks resume payload").targetDeviceId, "targetDeviceId"));
				return ok(taskResumeResult(await callActiveAgent(targetDeviceId, "tasks-resume", null, signal)));
			}
			return fail("unknown agent endpoint: " + endpoint);
		} catch (error) {
			if (error instanceof AgentClientError) return fail(error.message);
			return fail(error instanceof Error ? error.message : String(error));
		}
	}, { authority: "loopback" });
}
//#endregion
export { AGENT_RPC_CHANNEL, RPC_CHANNEL, apply, assertAgentConfiguration, collectFleetStatus, inject, name };
