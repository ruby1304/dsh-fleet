window.__ModuleLoader__.load({
	id: "dsh-fleet",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/index.tsx
		const inject = ["slots", "connection"];
		const CHANNEL = "/dsh-fleet";
		const AGENT_CHANNEL = "/dsh-fleet-agent";
		const SM = {
			bg: "#eef0f2",
			bg2: "#e6e9ed",
			panel: "#ffffff",
			panelSoft: "#fafbfc",
			fg: "#181a1c",
			fg2: "#5f6670",
			fg3: "#9aa3ad",
			fg4: "#c2cad3",
			good: "#0e8a4f",
			goodSoft: "#e1f3ea",
			bad: "#e0411b",
			badSoft: "#fdecdf",
			warn: "#c98a14",
			warnSoft: "#fbf2dd",
			info: "#0f5f6e",
			infoSoft: "#e0eef0",
			border: "rgba(20,30,50,0.08)",
			borderStrong: "rgba(20,30,50,0.13)",
			shadowCard: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(20,30,50,0.10)",
			fontSans: "\"Noto Sans SC\",\"PingFang SC\",\"Source Han Sans SC\",-apple-system,sans-serif",
			fontMono: "\"JetBrains Mono\",\"SF Mono\",\"Cascadia Code\",Menlo,monospace"
		};
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function hasExactKeys(value, keys) {
			const actual = Object.keys(value).sort();
			const expected = [...keys].sort();
			return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
		}
		function rpcValue(result, guard, fallback) {
			if (!result.ok) throw new Error(result.error.message);
			if (!guard(result.value)) throw new Error(fallback);
			return result.value;
		}
		function isFleetStatus(value) {
			return isRecord(value) && isRecord(value.device) && isRecord(value.runtime) && Array.isArray(value.runtime.failedModules) && value.runtime.failedModules.every((item) => typeof item === "string") && isRecord(value.summary) && Array.isArray(value.plugins);
		}
		function isFleetUpdates(value) {
			return isRecord(value) && typeof value.enabled === "boolean" && typeof value.cached === "boolean" && typeof value.stale === "boolean";
		}
		function isReleaseRetentionInspection(value) {
			if (!isRecord(value) || !hasExactKeys(value, [
				"eligibleCount",
				"invalidTransitionCount",
				"orphanBackupCount",
				"orphanCount",
				"orphanFailedCount",
				"orphanStageCount",
				"retainedCount"
			])) return false;
			if ([
				"eligibleCount",
				"invalidTransitionCount",
				"orphanBackupCount",
				"orphanCount",
				"orphanFailedCount",
				"orphanStageCount",
				"retainedCount"
			].some((field) => typeof value[field] !== "number" || !Number.isSafeInteger(value[field]) || value[field] < 0)) return false;
			const counts = value;
			return counts.orphanCount === counts.orphanBackupCount + counts.orphanStageCount + counts.orphanFailedCount;
		}
		function isAgentTargets(value) {
			if (!isRecord(value) || typeof value.enabled !== "boolean" || !Array.isArray(value.targets)) return false;
			return value.targets.every((target) => {
				if (!isRecord(target) || typeof target.deviceId !== "string" || target.transport !== "local" && target.transport !== "ssh" || typeof target.online !== "boolean") return false;
				if (target.mode !== void 0 && target.mode !== "single-plugin" && target.mode !== "profile-release") return false;
				if (target.errorCode !== void 0 && typeof target.errorCode !== "string") return false;
				if (target.readinessErrorCode !== void 0 && typeof target.readinessErrorCode !== "string") return false;
				if (target.readiness !== void 0 && (!isRecord(target.readiness) || target.readiness.protocolVersion !== 1 || target.readiness.ready !== true || target.readiness.deviceId !== target.deviceId || typeof target.readiness.teamId !== "string" || typeof target.readiness.principalId !== "string" || typeof target.readiness.identityKeyId !== "string" || typeof target.readiness.observedRuntimeDigest !== "string" || !/^[0-9a-f]{64}$/.test(target.readiness.observedRuntimeDigest) || target.readiness.observedServiceDefinitionDigest !== null && (typeof target.readiness.observedServiceDefinitionDigest !== "string" || !/^[0-9a-f]{64}$/.test(target.readiness.observedServiceDefinitionDigest)) || typeof target.readiness.trustedPeerCount !== "number" || !Number.isSafeInteger(target.readiness.trustedPeerCount) || target.readiness.trustedPeerCount < 0 || typeof target.readiness.tasksEnabled !== "boolean" || !Array.isArray(target.readiness.workspaceIds) || target.readiness.workspaceIds.some((id) => typeof id !== "string") || !Array.isArray(target.readiness.taskProfiles) || target.readiness.taskProfiles.some((profile) => typeof profile !== "string") || !Array.isArray(target.readiness.trustedPeers) || target.readiness.trustedPeers.some((peer) => !isRecord(peer) || typeof peer.keyId !== "string" || typeof peer.principalId !== "string" || typeof peer.deviceId !== "string" || !Array.isArray(peer.allowedKinds) || peer.allowedKinds.some((kind) => typeof kind !== "string")))) return false;
				if (target.inspection === void 0) return target.online === false;
				const inspection = target.inspection;
				if (!isRecord(inspection) || inspection.protocolVersion !== 1 || typeof inspection.deviceId !== "string" || typeof inspection.profile !== "string" || typeof inspection.dshVersion !== "string" || typeof inspection.manifestDigest !== "string" || typeof inspection.profileHash !== "string") return false;
				if (inspection.kind === "profile-release") {
					if (!isRecord(inspection.tasks) || !Array.isArray(inspection.tasks.profiles) || !inspection.tasks.profiles.every((profile) => typeof profile === "string")) return false;
					const tasks = inspection.tasks;
					const profiles = tasks.profiles;
					return typeof inspection.liveManifestDigest === "string" && typeof inspection.desiredManifestDigest === "string" && typeof inspection.observedRuntimeDigest === "string" && /^[0-9a-f]{64}$/.test(inspection.observedRuntimeDigest) && (inspection.observedServiceDefinitionDigest === null || typeof inspection.observedServiceDefinitionDigest === "string" && /^[0-9a-f]{64}$/.test(inspection.observedServiceDefinitionDigest)) && isRecord(inspection.assignedRelease) && typeof inspection.assignedRelease.releaseId === "string" && typeof inspection.assignedRelease.releaseVersion === "string" && typeof inspection.assignedRelease.releaseDigest === "string" && (inspection.currentRelease === null || isRecord(inspection.currentRelease) && typeof inspection.currentRelease.releaseId === "string" && typeof inspection.currentRelease.releaseVersion === "string" && typeof inspection.currentRelease.releaseDigest === "string") && Array.isArray(inspection.changes) && inspection.changes.every((change) => isRecord(change) && typeof change.pluginId === "string" && (change.action === "install" || change.action === "update" || change.action === "remove")) && typeof tasks.enabled === "boolean" && Array.isArray(tasks.workspaceIds) && tasks.workspaceIds.every((id) => typeof id === "string") && Array.isArray(tasks.executionProfiles) && tasks.executionProfiles.every((binding) => isRecord(binding) && typeof binding.profile === "string" && profiles.includes(binding.profile) && typeof binding.profileHash === "string" && /^[0-9a-f]{64}$/.test(binding.profileHash)) && tasks.executionProfiles.length === profiles.length && new Set(tasks.executionProfiles.map((binding) => binding.profile)).size === tasks.executionProfiles.length && (tasks.timeoutMs === null || typeof tasks.timeoutMs === "number" && Number.isSafeInteger(tasks.timeoutMs)) && Array.isArray(tasks.policies) && tasks.policies.every((policy) => isRecord(policy) && typeof policy.policyId === "string" && typeof policy.policyDigest === "string" && (policy.permissionMode === "read-only" || policy.permissionMode === "workspace-write")) && isReleaseRetentionInspection(inspection.retention);
				}
				return Array.isArray(inspection.candidates) && inspection.candidates.every((candidate) => isRecord(candidate) && typeof candidate.pluginId === "string" && (candidate.action === "install" || candidate.action === "update") && (candidate.fromSpec === null || typeof candidate.fromSpec === "string") && typeof candidate.exactToSpec === "string" && (candidate.sourceKind === "npm" || candidate.sourceKind === "github"));
			}) && (value.signer === void 0 || isRecord(value.signer) && typeof value.signer.configured === "boolean" && typeof value.signer.ready === "boolean" && (value.signer.deviceId === void 0 || typeof value.signer.deviceId === "string") && (value.signer.errorCode === void 0 || typeof value.signer.errorCode === "string"));
		}
		function isFleetPlan(value) {
			return isRecord(value) && typeof value.planId === "string" && typeof value.digest === "string" && typeof value.deviceId === "string" && typeof value.profile === "string" && typeof value.pluginId === "string" && (value.action === "install" || value.action === "update") && typeof value.exactToSpec === "string" && typeof value.expiresAt === "string";
		}
		function isFleetReleasePlan(value) {
			return isRecord(value) && value.kind === "profile-release" && typeof value.planId === "string" && typeof value.digest === "string" && typeof value.deviceId === "string" && typeof value.profile === "string" && typeof value.fromManifestDigest === "string" && typeof value.toManifestDigest === "string" && (value.fromReleaseDigest === null || typeof value.fromReleaseDigest === "string") && typeof value.toReleaseDigest === "string" && typeof value.observedRuntimeDigest === "string" && /^[0-9a-f]{64}$/.test(value.observedRuntimeDigest) && (value.observedServiceDefinitionDigest === null || typeof value.observedServiceDefinitionDigest === "string" && /^[0-9a-f]{64}$/.test(value.observedServiceDefinitionDigest)) && typeof value.releaseId === "string" && typeof value.releaseVersion === "string" && Array.isArray(value.plugins) && Array.isArray(value.changes) && typeof value.expiresAt === "string";
		}
		function isFleetReleaseRollbackPlan(value) {
			return isRecord(value) && value.protocolVersion === 2 && value.kind === "profile-release-rollback" && typeof value.planId === "string" && /^release-rollback-plan:[0-9a-f]{64}$/.test(value.planId) && typeof value.digest === "string" && /^[0-9a-f]{64}$/.test(value.digest) && value.planId === "release-rollback-plan:" + value.digest && typeof value.transitionPlanId === "string" && /^release-plan:[0-9a-f]{64}$/.test(value.transitionPlanId) && typeof value.transitionPlanDigest === "string" && value.transitionPlanId === "release-plan:" + value.transitionPlanDigest && typeof value.deviceId === "string" && typeof value.profile === "string" && typeof value.fromManifestDigest === "string" && /^[0-9a-f]{64}$/.test(value.fromManifestDigest) && typeof value.toManifestDigest === "string" && /^[0-9a-f]{64}$/.test(value.toManifestDigest) && typeof value.fromReleaseDigest === "string" && /^[0-9a-f]{64}$/.test(value.fromReleaseDigest) && (value.toReleaseDigest === null || typeof value.toReleaseDigest === "string" && /^[0-9a-f]{64}$/.test(value.toReleaseDigest)) && typeof value.fromProfileHash === "string" && /^[0-9a-f]{64}$/.test(value.fromProfileHash) && typeof value.toProfileHash === "string" && /^[0-9a-f]{64}$/.test(value.toProfileHash) && typeof value.observedDshVersion === "string" && typeof value.observedRuntimeDigest === "string" && /^[0-9a-f]{64}$/.test(value.observedRuntimeDigest) && (value.observedServiceDefinitionDigest === null || typeof value.observedServiceDefinitionDigest === "string" && /^[0-9a-f]{64}$/.test(value.observedServiceDefinitionDigest)) && isCanonicalTimestamp(value.createdAt) && isCanonicalTimestamp(value.expiresAt) && Date.parse(value.expiresAt) > Date.parse(value.createdAt);
		}
		const RELEASE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
		const RELEASE_TRANSITION_ID_PATTERN = /^release-plan:[0-9a-f]{64}$/;
		const RELEASE_RETENTION_PLAN_ID_PATTERN = /^release-retention-plan:[0-9a-f]{64}$/;
		const RELEASE_BACKUP_PROFILE_PATTERN = /^fleet-backup-[0-9a-f]{24}$/;
		const RELEASE_STAGE_PROFILE_PATTERN = /^fleet-stage-[0-9a-f]{24}$/;
		const RELEASE_FAILED_PROFILE_PATTERN = /^fleet-failed-[0-9a-f]{24}$/;
		function isSortedUniqueMatching(value, pattern) {
			return Array.isArray(value) && value.every((item) => typeof item === "string" && pattern.test(item)) && value.every((item, index) => index === 0 || item > value[index - 1]);
		}
		function isFleetReleaseRetentionPlan(value) {
			if (!isRecord(value) || !hasExactKeys(value, [
				"createdAt",
				"currentTransitionPlanId",
				"deviceId",
				"digest",
				"entries",
				"expiresAt",
				"kind",
				"orphanBackupProfiles",
				"orphanFailedProfiles",
				"orphanStageProfiles",
				"planId",
				"profile",
				"protocolVersion",
				"retainedTransitionPlanIds"
			]) || value.protocolVersion !== 1 || value.kind !== "profile-release-retention" || typeof value.deviceId !== "string" || !RELEASE_IDENTIFIER_PATTERN.test(value.deviceId) || typeof value.profile !== "string" || !RELEASE_IDENTIFIER_PATTERN.test(value.profile) || typeof value.digest !== "string" || !/^[0-9a-f]{64}$/.test(value.digest) || typeof value.planId !== "string" || !RELEASE_RETENTION_PLAN_ID_PATTERN.test(value.planId) || value.planId !== "release-retention-plan:" + value.digest || !isCanonicalTimestamp(value.createdAt) || !isCanonicalTimestamp(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.createdAt) || Date.parse(value.expiresAt) - Date.parse(value.createdAt) > 36e5 || !isSortedUniqueMatching(value.retainedTransitionPlanIds, RELEASE_TRANSITION_ID_PATTERN) || value.retainedTransitionPlanIds.length > 2 || !isSortedUniqueMatching(value.orphanBackupProfiles, RELEASE_BACKUP_PROFILE_PATTERN) || !isSortedUniqueMatching(value.orphanStageProfiles, RELEASE_STAGE_PROFILE_PATTERN) || !isSortedUniqueMatching(value.orphanFailedProfiles, RELEASE_FAILED_PROFILE_PATTERN) || !Array.isArray(value.entries)) return false;
			const retainedTransitionPlanIds = value.retainedTransitionPlanIds;
			const currentTransitionPlanId = value.currentTransitionPlanId;
			if (currentTransitionPlanId !== null && (typeof currentTransitionPlanId !== "string" || !RELEASE_TRANSITION_ID_PATTERN.test(currentTransitionPlanId))) return false;
			if (currentTransitionPlanId === null ? retainedTransitionPlanIds.length !== 0 || value.entries.length !== 0 : !retainedTransitionPlanIds.includes(currentTransitionPlanId)) return false;
			const entryIds = [];
			for (const entry of value.entries) {
				if (!isRecord(entry) || !hasExactKeys(entry, [
					"backupManifestDigest",
					"backupProfile",
					"backupProfileHash",
					"descriptorDigest",
					"reason",
					"transitionPlanId"
				]) || typeof entry.transitionPlanId !== "string" || !RELEASE_TRANSITION_ID_PATTERN.test(entry.transitionPlanId) || typeof entry.descriptorDigest !== "string" || !/^[0-9a-f]{64}$/.test(entry.descriptorDigest) || entry.reason !== "superseded") return false;
				if (entry.backupProfile === null) {
					if (entry.backupManifestDigest !== null || entry.backupProfileHash !== null) return false;
				} else if (typeof entry.backupProfile !== "string" || !RELEASE_BACKUP_PROFILE_PATTERN.test(entry.backupProfile) || typeof entry.backupManifestDigest !== "string" || !/^[0-9a-f]{64}$/.test(entry.backupManifestDigest) || typeof entry.backupProfileHash !== "string" || !/^[0-9a-f]{64}$/.test(entry.backupProfileHash)) return false;
				entryIds.push(entry.transitionPlanId);
			}
			return entryIds.every((id, index) => (index === 0 || id > entryIds[index - 1]) && !retainedTransitionPlanIds.includes(id));
		}
		function isAgentAction(value) {
			const states = /* @__PURE__ */ new Set([
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
			return isRecord(value) && typeof value.planId === "string" && typeof value.state === "string" && states.has(value.state) && (typeof value.pluginId === "string" || typeof value.releaseId === "string") && typeof value.updatedAt === "string";
		}
		function isReleaseRollbackAction(value) {
			const states = /* @__PURE__ */ new Set([
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
			return isRecord(value) && typeof value.planId === "string" && /^release-rollback-plan:[0-9a-f]{64}$/.test(value.planId) && typeof value.planDigest === "string" && value.planId === "release-rollback-plan:" + value.planDigest && typeof value.transitionPlanId === "string" && typeof value.deviceId === "string" && typeof value.profile === "string" && typeof value.fromManifestDigest === "string" && typeof value.toManifestDigest === "string" && typeof value.fromReleaseDigest === "string" && (value.toReleaseDigest === null || typeof value.toReleaseDigest === "string") && typeof value.state === "string" && states.has(value.state) && isCanonicalTimestamp(value.updatedAt) && (value.result === void 0 || value.result === "success" || value.result === "manual-intervention") && (value.errorCode === void 0 || typeof value.errorCode === "string");
		}
		function isReleaseRetentionAction(value) {
			if (!isRecord(value) || !hasExactKeys(value, [
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
			]) || typeof value.planId !== "string" || !RELEASE_RETENTION_PLAN_ID_PATTERN.test(value.planId) || typeof value.planDigest !== "string" || !/^[0-9a-f]{64}$/.test(value.planDigest) || value.planId !== "release-retention-plan:" + value.planDigest || typeof value.approvalId !== "string" || !RELEASE_IDENTIFIER_PATTERN.test(value.approvalId) || typeof value.principalId !== "string" || !RELEASE_IDENTIFIER_PATTERN.test(value.principalId) || typeof value.idempotencyKey !== "string" || !/^[0-9a-f]{64}$/.test(value.idempotencyKey) || typeof value.deviceId !== "string" || !RELEASE_IDENTIFIER_PATTERN.test(value.deviceId) || typeof value.profile !== "string" || !RELEASE_IDENTIFIER_PATTERN.test(value.profile) || value.currentTransitionPlanId !== null && (typeof value.currentTransitionPlanId !== "string" || !RELEASE_TRANSITION_ID_PATTERN.test(value.currentTransitionPlanId)) || value.activeTransitionPlanId !== null && (typeof value.activeTransitionPlanId !== "string" || !RELEASE_TRANSITION_ID_PATTERN.test(value.activeTransitionPlanId)) || typeof value.activeBackupQuarantinePrepared !== "boolean" || typeof value.activeBackupRemoved !== "boolean" || !isSortedUniqueMatching(value.removedTransitionPlanIds, RELEASE_TRANSITION_ID_PATTERN) || !isCanonicalTimestamp(value.updatedAt) || value.state !== "approved" && value.state !== "applying" && value.state !== "succeeded" || (value.state === "succeeded" ? value.result !== "success" : value.result !== null)) return false;
			if (value.currentTransitionPlanId !== null && value.removedTransitionPlanIds.includes(value.currentTransitionPlanId) || value.activeTransitionPlanId !== null && value.removedTransitionPlanIds.includes(value.activeTransitionPlanId)) return false;
			return value.activeTransitionPlanId !== null || value.activeBackupQuarantinePrepared === false && value.activeBackupRemoved === false;
		}
		function isFleetTaskReply(value) {
			if (!isRecord(value) || typeof value.taskId !== "string" || !isTaskId(value.taskId) || !isRecord(value.response) || !isRecord(value.response.payload)) return false;
			const payload = value.response.payload;
			if (payload.taskId !== value.taskId) return false;
			if (value.response.kind === "task.progress" || value.response.kind === "task.result") return typeof payload.state === "string" && TASK_STATES.has(payload.state) && isCanonicalTimestamp(payload.updatedAt) && (payload.result === void 0 || payload.result === null || typeof payload.result === "string") && (payload.truncated === void 0 || typeof payload.truncated === "boolean") && (payload.errorCode === void 0 || payload.errorCode === null || typeof payload.errorCode === "string");
			if (value.response.kind !== "task.approval.request" || value.response.schemaVersion !== 2 || typeof value.response.teamId !== "string" || typeof value.response.messageId !== "string" || typeof value.response.payloadDigest !== "string" || typeof value.response.signature !== "string" || !isRecord(value.response.sender) || !isRecord(value.response.recipient)) return false;
			return typeof payload.approvalId === "string" && typeof payload.taskBindingDigest === "string" && typeof payload.toolCallId === "string" && typeof payload.toolName === "string" && isRecord(payload.arguments) && typeof payload.argumentsDigest === "string" && (payload.capability === "workspace-mutation" || payload.capability === "command-execution" || payload.capability === "network-access") && typeof payload.summary === "string" && isCanonicalTimestamp(payload.expiresAt);
		}
		function isApprovalDecisionReply(value) {
			return isRecord(value) && typeof value.taskId === "string" && isTaskId(value.taskId) && isRecord(value.response) && value.response.kind === "receipt" && isRecord(value.response.payload) && typeof value.response.payload.requestMessageId === "string" && value.response.payload.status === "accepted";
		}
		const TASK_REFERENCE_STORAGE_KEY = "dsh-fleet.task-reference.v1";
		const TASK_ID_PATTERN = /^task:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
		function isTaskId(value) {
			return TASK_ID_PATTERN.test(value);
		}
		const TASK_STATES = /* @__PURE__ */ new Set([
			"accepted",
			"running",
			"cancel-requested",
			"succeeded",
			"failed",
			"cancelled"
		]);
		function isCanonicalTimestamp(value) {
			if (typeof value !== "string") return false;
			const time = Date.parse(value);
			return Number.isFinite(time) && new Date(time).toISOString() === value;
		}
		const FEDERATION_MESSAGE_ID_PATTERN = /^msg:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
		const FEDERATION_NAMED_ID_PATTERN = /^(?:approval|handoff):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
		const FEDERATION_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
		function isFederationPayload(kind, value) {
			if (!isRecord(value)) return false;
			if (kind === "handoff") return hasExactKeys(value, [
				"artifactRefs",
				"handoffId",
				"summary",
				"taskId"
			]) && typeof value.handoffId === "string" && FEDERATION_NAMED_ID_PATTERN.test(value.handoffId) && value.handoffId.startsWith("handoff:") && (value.taskId === null || typeof value.taskId === "string" && isTaskId(value.taskId)) && typeof value.summary === "string" && value.summary.trim().length > 0 && value.summary.length <= 8192 && !value.summary.includes("\0") && Array.isArray(value.artifactRefs) && value.artifactRefs.length <= 32 && value.artifactRefs.every((ref) => typeof ref === "string" && ref.trim().length > 0 && ref === ref.trim() && ref.length <= 512 && !/[\r\n\0]/.test(ref));
			if (kind === "approval.request") return hasExactKeys(value, [
				"approvalId",
				"expiresAt",
				"summary",
				"taskId"
			]) && typeof value.approvalId === "string" && FEDERATION_NAMED_ID_PATTERN.test(value.approvalId) && value.approvalId.startsWith("approval:") && typeof value.taskId === "string" && isTaskId(value.taskId) && typeof value.summary === "string" && value.summary.trim().length > 0 && value.summary.length <= 2048 && !value.summary.includes("\0") && isCanonicalTimestamp(value.expiresAt);
			if (kind === "approval.decision") return hasExactKeys(value, [
				"approvalId",
				"approvalRequestMessageId",
				"approvalRequestPayloadDigest",
				"decidedAt",
				"decision",
				"taskId"
			]) && typeof value.approvalId === "string" && FEDERATION_NAMED_ID_PATTERN.test(value.approvalId) && value.approvalId.startsWith("approval:") && typeof value.taskId === "string" && isTaskId(value.taskId) && typeof value.approvalRequestMessageId === "string" && FEDERATION_MESSAGE_ID_PATTERN.test(value.approvalRequestMessageId) && typeof value.approvalRequestPayloadDigest === "string" && /^[0-9a-f]{64}$/.test(value.approvalRequestPayloadDigest) && (value.decision === "endorsed" || value.decision === "declined") && isCanonicalTimestamp(value.decidedAt);
			return hasExactKeys(value, ["requestMessageId", "status"]) && typeof value.requestMessageId === "string" && FEDERATION_MESSAGE_ID_PATTERN.test(value.requestMessageId) && (value.status === "accepted" || value.status === "stored");
		}
		function isFederationEnvelope(value) {
			if (!isRecord(value) || !hasExactKeys(value, [
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
			]) || value.schemaVersion !== 2 || typeof value.kind !== "string" || ![
				"handoff",
				"approval.request",
				"approval.decision",
				"receipt"
			].includes(value.kind) || typeof value.teamId !== "string" || !FEDERATION_IDENTIFIER_PATTERN.test(value.teamId) || typeof value.messageId !== "string" || !FEDERATION_MESSAGE_ID_PATTERN.test(value.messageId) || !isCanonicalTimestamp(value.issuedAt) || !isCanonicalTimestamp(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) || typeof value.payloadDigest !== "string" || !/^[0-9a-f]{64}$/.test(value.payloadDigest) || typeof value.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(value.signature) || !isRecord(value.sender) || !hasExactKeys(value.sender, [
				"deviceId",
				"keyId",
				"principalId"
			]) || typeof value.sender.principalId !== "string" || !FEDERATION_IDENTIFIER_PATTERN.test(value.sender.principalId) || typeof value.sender.deviceId !== "string" || !FEDERATION_IDENTIFIER_PATTERN.test(value.sender.deviceId) || typeof value.sender.keyId !== "string" || !/^ed25519:[0-9a-f]{64}$/.test(value.sender.keyId) || !isRecord(value.recipient) || !hasExactKeys(value.recipient, ["deviceId", "teamId"]) || typeof value.recipient.teamId !== "string" || !FEDERATION_IDENTIFIER_PATTERN.test(value.recipient.teamId) || typeof value.recipient.deviceId !== "string" || !FEDERATION_IDENTIFIER_PATTERN.test(value.recipient.deviceId)) return false;
			return isFederationPayload(value.kind, value.payload);
		}
		function isFederationInbox(value) {
			return Array.isArray(value) && value.length <= 100 && value.every((item) => {
				if (!isRecord(item) || !hasExactKeys(item, [
					"acknowledgement",
					"expired",
					"record"
				]) || typeof item.expired !== "boolean" || !isRecord(item.record) || !hasExactKeys(item.record, [
					"envelope",
					"receivedAt",
					"schemaVersion"
				]) || item.record.schemaVersion !== 1 || !isCanonicalTimestamp(item.record.receivedAt) || !isFederationEnvelope(item.record.envelope)) return false;
				if (item.acknowledgement === null) return true;
				const ack = item.acknowledgement;
				return isRecord(ack) && hasExactKeys(ack, [
					"acknowledgedAt",
					"disposition",
					"messageId",
					"payloadDigest",
					"schemaVersion"
				]) && ack.schemaVersion === 1 && (ack.disposition === "acknowledged" || ack.disposition === "dismissed") && ack.messageId === item.record.envelope.messageId && ack.payloadDigest === item.record.envelope.payloadDigest && isCanonicalTimestamp(ack.acknowledgedAt);
			});
		}
		function isFederationAcknowledgement(value) {
			if (!isRecord(value) || !hasExactKeys(value, ["acknowledgement", "status"]) || value.status !== "acknowledged" && value.status !== "duplicate" || !isRecord(value.acknowledgement)) return false;
			const ack = value.acknowledgement;
			return hasExactKeys(ack, [
				"acknowledgedAt",
				"disposition",
				"messageId",
				"payloadDigest",
				"schemaVersion"
			]) && ack.schemaVersion === 1 && (ack.disposition === "acknowledged" || ack.disposition === "dismissed") && typeof ack.messageId === "string" && FEDERATION_MESSAGE_ID_PATTERN.test(ack.messageId) && typeof ack.payloadDigest === "string" && /^[0-9a-f]{64}$/.test(ack.payloadDigest) && isCanonicalTimestamp(ack.acknowledgedAt);
		}
		function isFederationRetentionPlan(value) {
			return isRecord(value) && hasExactKeys(value, ["candidates", "generatedAt"]) && isCanonicalTimestamp(value.generatedAt) && Array.isArray(value.candidates) && value.candidates.length <= 500 && value.candidates.every((candidate) => isRecord(candidate) && hasExactKeys(candidate, [
				"messageId",
				"payloadDigest",
				"reason"
			]) && typeof candidate.messageId === "string" && FEDERATION_MESSAGE_ID_PATTERN.test(candidate.messageId) && typeof candidate.payloadDigest === "string" && /^[0-9a-f]{64}$/.test(candidate.payloadDigest) && (candidate.reason === "acknowledged-retention" || candidate.reason === "expired-retention" || candidate.reason === "capacity"));
		}
		function isFleetTaskCatalog(value) {
			if (!isRecord(value) || Object.keys(value).sort().join(",") !== "generatedAt,tasks" || !isCanonicalTimestamp(value.generatedAt) || !Array.isArray(value.tasks)) return false;
			const taskKeys = "createdAt,errorCode,profile,resultDigest,state,targetDeviceId,taskId,updatedAt,workspaceId";
			return value.tasks.every((task) => isRecord(task) && Object.keys(task).sort().join(",") === taskKeys && typeof task.taskId === "string" && isTaskId(task.taskId) && typeof task.state === "string" && TASK_STATES.has(task.state) && typeof task.targetDeviceId === "string" && task.targetDeviceId.length > 0 && typeof task.workspaceId === "string" && task.workspaceId.length > 0 && typeof task.profile === "string" && task.profile.length > 0 && isCanonicalTimestamp(task.createdAt) && isCanonicalTimestamp(task.updatedAt) && (task.errorCode === null || typeof task.errorCode === "string") && (task.resultDigest === null || typeof task.resultDigest === "string" && /^[0-9a-f]{64}$/.test(task.resultDigest)));
		}
		function isFleetTaskPruneResult(value) {
			return isRecord(value) && Object.keys(value).sort().join(",") === "pruned,skippedActive" && typeof value.pruned === "number" && Number.isSafeInteger(value.pruned) && value.pruned >= 0 && typeof value.skippedActive === "number" && Number.isSafeInteger(value.skippedActive) && value.skippedActive >= 0;
		}
		function isFleetTaskResumeResult(value) {
			return isRecord(value) && Object.keys(value).join(",") === "resumed" && typeof value.resumed === "number" && Number.isSafeInteger(value.resumed) && value.resumed >= 0;
		}
		function taskStateLabel(state) {
			if (state === "accepted") return "已接收";
			if (state === "running") return "执行中";
			if (state === "cancel-requested") return "正在取消";
			if (state === "succeeded") return "已完成";
			if (state === "failed") return "失败";
			return "已取消";
		}
		function taskStateColor(state) {
			if (state === "succeeded") return SM.good;
			if (state === "failed" || state === "cancelled") return SM.bad;
			return SM.warn;
		}
		function isStoredTaskReference(value) {
			if (!isRecord(value) || Object.keys(value).length !== 2 || typeof value.targetDeviceId !== "string" || typeof value.taskId !== "string") return false;
			return value.targetDeviceId.length > 0 && value.targetDeviceId.length <= 256 && !value.targetDeviceId.includes("\0") && isTaskId(value.taskId);
		}
		function readStoredTaskReference() {
			try {
				const storage = window.localStorage;
				if (storage === void 0) return null;
				const raw = storage.getItem(TASK_REFERENCE_STORAGE_KEY);
				if (raw === null) return null;
				const parsed = JSON.parse(raw);
				if (isStoredTaskReference(parsed)) return parsed;
				storage.removeItem(TASK_REFERENCE_STORAGE_KEY);
			} catch {
				try {
					window.localStorage?.removeItem(TASK_REFERENCE_STORAGE_KEY);
				} catch {}
			}
			return null;
		}
		function writeStoredTaskReference(reference) {
			try {
				const storage = window.localStorage;
				if (storage === void 0) return;
				storage.setItem(TASK_REFERENCE_STORAGE_KEY, JSON.stringify({
					targetDeviceId: reference.targetDeviceId,
					taskId: reference.taskId
				}));
			} catch {}
		}
		function clearStoredTaskReference() {
			try {
				window.localStorage?.removeItem(TASK_REFERENCE_STORAGE_KEY);
			} catch {}
		}
		const driftColors = {
			aligned: SM.good,
			missing: SM.bad,
			"spec-drift": SM.warn,
			"runtime-failed": SM.bad,
			"runtime-inactive": SM.warn
		};
		function driftLabel(state) {
			if (state === "aligned") return "一致";
			if (state === "missing") return "缺失";
			if (state === "spec-drift") return "版本漂移";
			if (state === "runtime-failed") return "加载失败";
			return "未激活";
		}
		function updateColor(item) {
			if (item.state === "current") return SM.good;
			if (item.state === "available") return SM.warn;
			if (item.state === "error" || item.state === "missing") return SM.bad;
			if (item.state === "local") return SM.info;
			return SM.fg3;
		}
		function updateLabel(item) {
			if (item.state === "current") return "已是最新";
			if (item.state === "available") return item.changeKind === "head-changed" ? "上游有变化" : "可更新";
			if (item.state === "local") return item.source === "artifact" ? "已固定" : "本地链接";
			if (item.state === "missing") return "未安装";
			if (item.state === "error") return "检查失败";
			return "不支持检查";
		}
		function sourceLabel(item) {
			if (item.kind === "dsh") return "CORE";
			if (item.source === "github") return "GitHub";
			if (item.source === "npm") return "npm";
			if (item.source === "artifact") return "tarball";
			if (item.source === "local") return "local";
			return "other";
		}
		function shortRevision(value) {
			return value?.slice(0, 7);
		}
		function versionText(item) {
			if (item.source === "github") {
				const current = shortRevision(item.currentRevision);
				const latest = shortRevision(item.latestRevision);
				if (current !== void 0 && latest !== void 0) return `${current} → ${latest}`;
				if (latest !== void 0) return `HEAD ${latest}`;
			}
			if (item.currentVersion !== void 0 && item.latestVersion !== void 0) return `${item.currentVersion} → ${item.latestVersion}`;
			if (item.currentVersion !== void 0 && item.state === "local") return item.source === "artifact" ? `${item.currentVersion} · 不可变制品` : `${item.currentVersion} · 实时源码`;
			if (item.latestVersion !== void 0) return `最新 ${item.latestVersion}`;
			if (item.errorCode === "registry-unavailable") return "npm 查询不可用";
			if (item.errorCode === "github-unavailable") return "GitHub 查询不可用";
			if (item.errorCode === "not-installed") return "目标包未安装";
			return "暂无可比较版本";
		}
		function formatCheckedAt(value) {
			const date = new Date(value);
			if (Number.isNaN(date.getTime())) return "未知时间";
			return date.toLocaleString("zh-CN", {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hour12: false
			});
		}
		function Dot({ color, size = 7 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				"aria-hidden": "true",
				style: {
					width: size,
					height: size,
					flexShrink: 0,
					borderRadius: 999,
					background: color
				}
			});
		}
		function Pill({ children, tone = "neutral" }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: {
					display: "inline-flex",
					alignItems: "center",
					minHeight: 20,
					padding: "1px 7px",
					borderRadius: 999,
					background: tone === "warn" ? SM.warnSoft : SM.bg2,
					color: tone === "warn" ? SM.warn : SM.fg2,
					fontFamily: SM.fontMono,
					fontSize: 10.5,
					fontVariantNumeric: "tabular-nums",
					whiteSpace: "nowrap"
				},
				children
			});
		}
		function RefreshIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				"aria-hidden": "true",
				width: "16",
				height: "16",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M20 11a8 8 0 1 0-2.34 5.66" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M20 4v7h-7" })]
			});
		}
		function FleetIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				"aria-hidden": "true",
				width: "18",
				height: "18",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.8",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "3",
						y: "4",
						width: "7",
						height: "6",
						rx: "2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "14",
						y: "4",
						width: "7",
						height: "6",
						rx: "2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "8.5",
						y: "15",
						width: "7",
						height: "5",
						rx: "2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6.5 10v2.5H12M17.5 10v2.5H12M12 12.5V15" })
				]
			});
		}
		function StatusView({ status, error }) {
			if (status === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					padding: 14,
					color: error === null ? SM.fg3 : SM.bad,
					fontFamily: SM.fontMono
				},
				children: error ?? "载入中…"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						margin: "0 12px 10px",
						padding: "8px 10px",
						borderRadius: 10,
						background: SM.badSoft,
						color: SM.bad,
						fontFamily: SM.fontMono
					},
					children: error
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						margin: "0 12px 10px",
						padding: 12,
						borderRadius: 12,
						background: SM.panel
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "grid",
							gridTemplateColumns: "76px minmax(0,1fr)",
							gap: "5px 8px",
							color: SM.fg2
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "设备" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									color: SM.fg,
									fontFamily: SM.fontMono
								},
								children: [status.device.id, status.device.registered ? "" : "（未登记）"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "设备类型" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { fontFamily: SM.fontMono },
								children: status.device.class ?? "—"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "通道" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { fontFamily: SM.fontMono },
								children: status.device.channel ?? "—"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "DSH" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: { fontFamily: SM.fontMono },
								children: [
									status.dsh.version ?? "未知",
									" · ",
									status.dsh.profile
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "清单" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									color: status.manifest.loaded ? SM.good : SM.bad,
									overflowWrap: "anywhere"
								},
								children: status.manifest.loaded ? status.manifest.teamId : status.manifest.error
							})
						]
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						margin: "0 12px 10px",
						padding: "9px 10px",
						borderRadius: 10,
						background: SM.panelSoft,
						color: SM.fg2,
						fontFamily: SM.fontMono,
						fontVariantNumeric: "tabular-nums",
						lineHeight: 1.65
					},
					children: [
						"期望 ",
						status.summary.desired,
						" · 一致 ",
						status.summary.aligned,
						" · 缺失 ",
						status.summary.missing,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
						"漂移 ",
						status.summary.drifted,
						" · 失败 ",
						status.summary.failed,
						" · 未管理 ",
						status.summary.unmanaged,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							title: status.runtime.failedModules.join(", "),
							style: { color: status.runtime.failedModules.length > 0 ? SM.bad : SM.fg2 },
							children: [
								"Loader 失败 ",
								status.runtime.failedModules.length,
								status.runtime.failedModules.length > 0 ? ` · ${status.runtime.failedModules.join(", ")}` : ""
							]
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						margin: "0 12px 12px",
						borderRadius: 12,
						background: SM.panel,
						overflow: "hidden"
					},
					children: [
						status.plugins.map((plugin) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "grid",
								gridTemplateColumns: "8px minmax(0,1fr) auto",
								alignItems: "center",
								gap: 8,
								minHeight: 40,
								padding: "4px 10px",
								borderBottom: `1px solid ${SM.border}`
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { color: driftColors[plugin.state] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									title: plugin.id,
									style: {
										minWidth: 0,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										fontFamily: SM.fontMono
									},
									children: plugin.id
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										color: driftColors[plugin.state],
										whiteSpace: "nowrap"
									},
									children: driftLabel(plugin.state)
								})
							]
						}, plugin.id)),
						status.unmanaged.map((plugin) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "grid",
								gridTemplateColumns: "8px minmax(0,1fr) auto",
								alignItems: "center",
								gap: 8,
								minHeight: 40,
								padding: "4px 10px",
								borderBottom: `1px solid ${SM.border}`
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { color: SM.fg3 }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									title: plugin.id,
									style: {
										minWidth: 0,
										overflow: "hidden",
										textOverflow: "ellipsis",
										fontFamily: SM.fontMono
									},
									children: plugin.id
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: SM.fg3 },
									children: "未管理"
								})
							]
						}, "unmanaged:" + plugin.id)),
						status.plugins.length === 0 && status.unmanaged.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								padding: 12,
								color: SM.fg3
							},
							children: "没有可展示的插件"
						})
					]
				})
			] });
		}
		function UpdatesView({ updates, loading, error, onRefresh }) {
			const snapshot = updates?.snapshot;
			const visibleItems = snapshot?.items.filter((item) => item.kind === "dsh" || item.state !== "current") ?? [];
			const hiddenCurrent = snapshot?.items.filter((item) => item.kind === "plugin" && item.state === "current").length ?? 0;
			const artifactCount = snapshot?.items.filter((item) => item.state === "local" && item.source === "artifact").length ?? 0;
			const liveLocalCount = (snapshot?.summary.local ?? 0) - artifactCount;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: "0 12px 12px" },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							gap: 8,
							marginBottom: 10
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								flex: 1,
								minWidth: 0
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									color: SM.fg,
									fontSize: 13,
									fontWeight: 600
								},
								children: "更新检查"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								title: snapshot?.checkedAt,
								style: {
									color: updates?.stale ? SM.warn : SM.fg3,
									fontSize: 10.5,
									fontFamily: SM.fontMono,
									fontVariantNumeric: "tabular-nums"
								},
								children: snapshot === void 0 ? loading ? "检查中…" : "尚未检查" : `${updates?.stale ? "缓存已过期 · " : ""}${formatCheckedAt(snapshot.checkedAt)}`
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: onRefresh,
							disabled: loading || updates?.enabled === false,
							style: {
								minHeight: 30,
								padding: "4px 10px",
								border: `1px solid ${SM.borderStrong}`,
								borderRadius: 999,
								background: SM.panel,
								color: loading ? SM.fg3 : SM.fg2,
								cursor: loading ? "default" : "pointer",
								fontFamily: SM.fontSans,
								fontSize: 11.5
							},
							children: loading ? "检查中…" : "重新检查"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							marginBottom: 10,
							color: SM.fg3,
							fontSize: 10.5,
							lineHeight: 1.5
						},
						children: "只读比较公开发布源，不会安装、修改配置或重启 DSH。"
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							marginBottom: 10,
							padding: "8px 10px",
							borderRadius: 10,
							background: SM.badSoft,
							color: SM.bad,
							fontFamily: SM.fontMono
						},
						children: error
					}),
					updates?.enabled === false && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							padding: 12,
							borderRadius: 10,
							background: SM.panel,
							color: SM.fg3
						},
						children: "更新检查已在配置中关闭"
					}),
					snapshot !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							flexWrap: "wrap",
							gap: 6,
							marginBottom: 9,
							fontFamily: SM.fontMono,
							fontVariantNumeric: "tabular-nums"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Pill, {
								tone: snapshot.summary.available > 0 ? "warn" : "neutral",
								children: [snapshot.summary.available, " 个变化"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Pill, { children: [snapshot.summary.current, " 个最新"] }),
							artifactCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Pill, { children: [artifactCount, " 个制品"] }),
							liveLocalCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Pill, { children: [liveLocalCount, " 个本地链接"] }),
							snapshot.summary.errors > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Pill, {
								tone: "warn",
								children: [snapshot.summary.errors, " 个失败"]
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							borderRadius: 12,
							background: SM.panel,
							overflow: "hidden"
						},
						children: [
							visibleItems.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "grid",
									gridTemplateColumns: "8px minmax(0,1fr) auto",
									gap: 8,
									alignItems: "center",
									minHeight: 48,
									padding: "5px 10px",
									borderBottom: `1px solid ${SM.border}`
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { color: updateColor(item) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: { minWidth: 0 },
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												display: "flex",
												alignItems: "center",
												gap: 6,
												minWidth: 0
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													title: item.id,
													style: {
														minWidth: 0,
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
														color: SM.fg,
														fontFamily: SM.fontMono,
														fontSize: 11.5
													},
													children: item.kind === "dsh" ? "DSH Core" : item.id
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Pill, { children: sourceLabel(item) }),
												item.sourceUrl !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
													href: item.sourceUrl,
													target: "_blank",
													rel: "noreferrer",
													"aria-label": `打开 ${item.id} 发布源`,
													style: {
														color: SM.fg3,
														textDecoration: "none"
													},
													children: "↗"
												})
											]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											title: [item.currentRevision, item.latestRevision].filter(Boolean).join(" → "),
											style: {
												marginTop: 2,
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
												color: SM.fg3,
												fontFamily: SM.fontMono,
												fontSize: 10.5,
												fontVariantNumeric: "tabular-nums"
											},
											children: versionText(item)
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											color: updateColor(item),
											whiteSpace: "nowrap",
											fontSize: 11
										},
										children: updateLabel(item)
									})
								]
							}, `${item.kind}:${item.id}`)),
							hiddenCurrent > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									padding: "9px 10px",
									color: SM.good,
									fontSize: 11
								},
								children: [hiddenCurrent, " 个插件已是最新"]
							}),
							visibleItems.length === 0 && hiddenCurrent === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									padding: 12,
									color: SM.fg3
								},
								children: "没有可检查的项目"
							})
						]
					})] }),
					snapshot === void 0 && updates?.enabled !== false && !loading && error === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							padding: 12,
							borderRadius: 10,
							background: SM.panel,
							color: SM.fg3
						},
						children: "切到此页时会按需检查；结果缓存 6 小时。"
					})
				]
			});
		}
		function actionLabel(state) {
			if (state === "succeeded") return "已完成";
			if (state === "rolled-back") return "已自动回滚";
			if (state === "manual-intervention") return "需要人工处理";
			if (state.startsWith("rollback")) return "正在回滚";
			if (state === "verifying") return "正在健康检查";
			if (state === "restarting") return "正在重启";
			if (state === "applying") return "正在安装";
			return "正在准备";
		}
		function actionColor(state) {
			if (state === "succeeded") return SM.good;
			if (state === "rolled-back" || state === "manual-intervention" || state.startsWith("rollback")) return SM.bad;
			return SM.warn;
		}
		function OperationsView({ targets, plan, action, rollbackPlan, rollbackAction, retentionPlan, retentionAction, loading, error, armed, rollbackArmed, retentionArmed, onArm, onRollbackArm, onRetentionArm, onReload, onPlan, onApprove, onRollbackPlan, onRollbackApprove, onRetentionPlan, onRetentionApprove }) {
			const rollbackAvailable = action !== null && "releaseId" in action && action.state === "succeeded" && action.result === "success" && typeof action.rollbackDescriptorDigest === "string";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: "0 12px 12px" },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							marginBottom: 10,
							padding: "9px 10px",
							borderRadius: 10,
							background: SM.panelSoft,
							color: SM.fg2,
							lineHeight: 1.55
						},
						children: "v2 设备按完整 Profile Release 原子切换；公开包与私有制品一起审批、验证和回滚。旧版 v1 设备仍保留单插件兼容流程。"
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							marginBottom: 10,
							padding: "9px 10px",
							borderRadius: 10,
							background: SM.badSoft,
							color: SM.bad,
							fontFamily: SM.fontMono
						},
						children: error
					}),
					targets?.enabled === false && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							padding: 12,
							borderRadius: 10,
							background: SM.panel,
							color: SM.fg3
						},
						children: "远程收敛未启用"
					}),
					targets === null && error === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							padding: 12,
							color: SM.fg3
						},
						children: "载入中…"
					}),
					targets?.targets.map((target) => {
						const release = target.inspection !== void 0 && "kind" in target.inspection && target.inspection.kind === "profile-release" ? target.inspection : null;
						const legacy = target.inspection !== void 0 && !("kind" in target.inspection) ? target.inspection : null;
						const releaseRegistered = release !== null && release.changes.length === 0 && release.currentRelease !== null && release.currentRelease.releaseId === release.assignedRelease.releaseId && release.currentRelease.releaseVersion === release.assignedRelease.releaseVersion && release.currentRelease.releaseDigest === release.assignedRelease.releaseDigest;
						const retentionCandidates = release === null ? 0 : release.retention.eligibleCount;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								marginBottom: 10,
								borderRadius: 12,
								background: SM.panel,
								overflow: "hidden"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 8,
										padding: "10px 11px",
										borderBottom: `1px solid ${SM.border}`
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { color: target.online ? SM.good : SM.bad }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: {
												flex: 1,
												fontFamily: SM.fontMono
											},
											children: target.deviceId
										}),
										release !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Pill, { children: "RELEASE" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												color: SM.fg3,
												fontFamily: SM.fontMono
											},
											children: target.inspection?.dshVersion ?? target.errorCode ?? "离线"
										})
									]
								}),
								target.online && release !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { padding: "10px 11px" },
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												display: "flex",
												gap: 8,
												alignItems: "center"
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													flex: 1,
													minWidth: 0
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", {
														style: { fontFamily: SM.fontMono },
														children: [
															release.assignedRelease.releaseId,
															"@",
															release.assignedRelease.releaseVersion
														]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														style: {
															marginTop: 3,
															color: releaseRegistered ? SM.good : SM.warn
														},
														children: releaseRegistered ? "Release 已登记，文件一致" : release.changes.length === 0 ? "文件一致，尚未登记 Release" : `${release.changes.length} 项原子变更`
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														style: {
															marginTop: 3,
															color: release.liveManifestDigest === release.desiredManifestDigest ? SM.good : SM.warn,
															fontFamily: SM.fontMono,
															fontSize: 10.5
														},
														children: [
															"live ",
															release.liveManifestDigest.slice(0, 12),
															" · desired ",
															release.desiredManifestDigest.slice(0, 12)
														]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														style: {
															marginTop: 3,
															color: SM.fg3,
															fontFamily: SM.fontMono,
															fontSize: 10.5
														},
														children: [
															"runtime ",
															release.observedRuntimeDigest.slice(0, 12),
															" · service ",
															release.observedServiceDefinitionDigest?.slice(0, 12) ?? "screen"
														]
													})
												]
											}), !releaseRegistered && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												disabled: loading,
												onClick: () => onPlan(target.deviceId),
												style: {
													minHeight: 30,
													padding: "4px 10px",
													border: 0,
													borderRadius: 9,
													background: SM.infoSoft,
													color: SM.info,
													cursor: loading ? "default" : "pointer",
													fontFamily: SM.fontSans
												},
												children: release.changes.length === 0 ? "生成登记计划" : "生成原子计划"
											})]
										}),
										release.changes.map((change) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												marginTop: 6,
												color: SM.fg3,
												fontFamily: SM.fontMono,
												fontSize: 10.5
											},
											children: [
												change.action.toUpperCase(),
												" · ",
												change.pluginId
											]
										}, change.pluginId)),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												display: "flex",
												alignItems: "center",
												gap: 8,
												marginTop: 8,
												paddingTop: 8,
												borderTop: `1px solid ${SM.border}`
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													flex: 1,
													color: retentionCandidates > 0 ? SM.warn : SM.fg3,
													fontSize: 10.5
												},
												children: [
													"保留 ",
													release.retention.retainedCount,
													" 个 transition · 可清理 ",
													release.retention.eligibleCount,
													" 个 superseded transition · 孤立目录（仅审计、不自动删除）",
													release.retention.orphanCount,
													"（backup ",
													release.retention.orphanBackupCount,
													" / stage ",
													release.retention.orphanStageCount,
													" / failed ",
													release.retention.orphanFailedCount,
													"）",
													release.retention.invalidTransitionCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: {
															display: "block",
															marginTop: 2,
															color: SM.bad
														},
														children: [
															"另有 ",
															release.retention.invalidTransitionCount,
															" 个无效 transition，不会自动清理。"
														]
													})
												]
											}), retentionCandidates > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												disabled: loading,
												onClick: () => onRetentionPlan(target.deviceId),
												style: {
													minHeight: 30,
													padding: "4px 10px",
													border: `1px solid ${SM.borderStrong}`,
													borderRadius: 9,
													background: SM.panel,
													color: SM.warn,
													cursor: loading ? "default" : "pointer",
													fontFamily: SM.fontSans
												},
												children: "预览备份清理"
											})]
										})
									]
								}),
								target.online && legacy?.candidates.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "grid",
										gridTemplateColumns: "minmax(0,1fr) auto",
										gap: 8,
										alignItems: "center",
										minHeight: 48,
										padding: "7px 10px",
										borderBottom: `1px solid ${SM.border}`
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: { minWidth: 0 },
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											title: candidate.pluginId,
											style: {
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
												fontFamily: SM.fontMono
											},
											children: candidate.pluginId
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											title: candidate.exactToSpec,
											style: {
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
												color: SM.fg3,
												fontFamily: SM.fontMono,
												fontSize: 10.5
											},
											children: [
												candidate.action === "install" ? "安装" : "更新",
												" → ",
												candidate.exactToSpec
											]
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: loading,
										onClick: () => onPlan(target.deviceId, candidate.pluginId),
										style: {
											minHeight: 28,
											padding: "4px 9px",
											border: 0,
											borderRadius: 9,
											background: SM.infoSoft,
											color: SM.info,
											cursor: loading ? "default" : "pointer",
											fontFamily: SM.fontSans
										},
										children: "生成计划"
									})]
								}, candidate.pluginId)),
								target.online && legacy?.candidates.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										padding: 10,
										color: SM.good
									},
									children: "该设备已经一致"
								})
							]
						}, target.deviceId);
					}),
					plan !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginBottom: 10,
							padding: 11,
							borderRadius: 12,
							background: SM.panel,
							boxShadow: SM.shadowCard
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 7,
									marginBottom: 8
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { color: SM.warn }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "待批准计划" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											marginLeft: "auto",
											color: SM.fg3,
											fontFamily: SM.fontMono
										},
										children: "kind" in plan ? "PROFILE RELEASE" : plan.action === "install" ? "INSTALL" : "UPDATE"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "grid",
									gridTemplateColumns: "72px minmax(0,1fr)",
									gap: "5px 8px",
									color: SM.fg2
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "设备" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { fontFamily: SM.fontMono },
										children: plan.deviceId
									}),
									"kind" in plan ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Release" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: { fontFamily: SM.fontMono },
											children: [
												plan.releaseId,
												"@",
												plan.releaseVersion
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "插件" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: { fontFamily: SM.fontMono },
											children: [
												plan.plugins.length,
												" 个，",
												plan.changes.length,
												" 项变更"
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "原子性" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "整组 stage → rename → health → rollback" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "运行身份" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: { fontFamily: SM.fontMono },
											children: plan.observedRuntimeDigest.slice(0, 12)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "服务定义" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: { fontFamily: SM.fontMono },
											children: plan.observedServiceDefinitionDigest?.slice(0, 12) ?? "未托管"
										})
									] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "插件" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: { fontFamily: SM.fontMono },
											children: plan.pluginId
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "目标" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											title: plan.exactToSpec,
											style: {
												overflowWrap: "anywhere",
												fontFamily: SM.fontMono
											},
											children: plan.exactToSpec
										})
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "计划" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										title: plan.planId,
										style: { fontFamily: SM.fontMono },
										children: plan.digest.slice(0, 12)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "过期" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontFamily: SM.fontMono,
											fontVariantNumeric: "tabular-nums"
										},
										children: formatCheckedAt(plan.expiresAt)
									})
								]
							}),
							"kind" in plan && plan.changes.map((change) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginTop: 5,
									color: SM.fg3,
									fontFamily: SM.fontMono,
									fontSize: 10.5
								},
								children: [
									change.action.toUpperCase(),
									" · ",
									change.pluginId,
									" · ",
									change.visibility
								]
							}, change.pluginId)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: {
									display: "flex",
									alignItems: "flex-start",
									gap: 8,
									marginTop: 10,
									color: SM.fg2,
									cursor: "pointer"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: armed,
									onChange: (event) => onArm(event.currentTarget.checked)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									"我确认由 ",
									plan.deviceId,
									" 执行这一",
									"kind" in plan ? "完整 Profile Release" : "精确插件计划",
									"；失败时自动回滚。"
								] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: !armed || loading,
								onClick: onApprove,
								style: {
									width: "100%",
									minHeight: 32,
									marginTop: 10,
									border: 0,
									borderRadius: 10,
									background: armed && !loading ? SM.bad : SM.fg4,
									color: SM.panel,
									cursor: armed && !loading ? "pointer" : "default",
									fontFamily: SM.fontSans,
									fontWeight: 600
								},
								children: loading ? "执行中…" : "批准并执行一次"
							})
						]
					}),
					action !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginBottom: 10,
							padding: 10,
							borderRadius: 10,
							background: action.state === "succeeded" ? SM.goodSoft : SM.badSoft,
							color: actionColor(action.state)
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 7
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { color: actionColor(action.state) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: actionLabel(action.state) })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								marginTop: 4,
								fontFamily: SM.fontMono,
								fontVariantNumeric: "tabular-nums"
							},
							children: [
								"releaseId" in action ? `${action.releaseId}@${action.releaseVersion}` : action.pluginId,
								" · ",
								action.updatedAt.slice(0, 19).replace("T", " ")
							]
						})]
					}),
					rollbackAvailable && rollbackPlan === null && rollbackAction === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: loading,
						onClick: () => onRollbackPlan(action.deviceId, action.planId),
						style: {
							width: "100%",
							minHeight: 32,
							marginBottom: 10,
							border: `1px solid ${SM.borderStrong}`,
							borderRadius: 10,
							background: SM.panel,
							color: SM.bad,
							cursor: loading ? "default" : "pointer",
							fontFamily: SM.fontSans
						},
						children: "生成回滚计划"
					}),
					rollbackPlan !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginBottom: 10,
							padding: 11,
							borderRadius: 12,
							background: SM.badSoft,
							color: SM.fg2
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 7,
									marginBottom: 8,
									color: SM.bad
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { color: SM.bad }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "显式 Release 回滚" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: { lineHeight: 1.65 },
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["设备：", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { fontFamily: SM.fontMono },
										children: rollbackPlan.deviceId
									})] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["原 Release 计划：", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										title: rollbackPlan.transitionPlanId,
										style: { fontFamily: SM.fontMono },
										children: rollbackPlan.transitionPlanDigest.slice(0, 12)
									})] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["当前 → 上一版本：", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: { fontFamily: SM.fontMono },
										children: [
											rollbackPlan.fromReleaseDigest.slice(0, 12),
											" → ",
											rollbackPlan.toReleaseDigest?.slice(0, 12) ?? "未登记"
										]
									})] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["运行身份：", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: { fontFamily: SM.fontMono },
										children: [
											rollbackPlan.observedRuntimeDigest.slice(0, 12),
											" · service ",
											rollbackPlan.observedServiceDefinitionDigest?.slice(0, 12) ?? "未托管"
										]
									})] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["计划过期：", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { fontFamily: SM.fontMono },
										children: formatCheckedAt(rollbackPlan.expiresAt)
									})] })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: {
									display: "flex",
									alignItems: "flex-start",
									gap: 8,
									marginTop: 9,
									color: SM.bad,
									cursor: "pointer"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: rollbackArmed,
									onChange: (event) => onRollbackArm(event.currentTarget.checked)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									"我确认将 ",
									rollbackPlan.deviceId,
									" 恢复到该 Release 之前保留的 Profile；这不是普通失败的自动回滚。"
								] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: !rollbackArmed || loading,
								onClick: onRollbackApprove,
								style: {
									width: "100%",
									minHeight: 32,
									marginTop: 9,
									border: 0,
									borderRadius: 10,
									background: rollbackArmed && !loading ? SM.bad : SM.fg4,
									color: SM.panel,
									cursor: rollbackArmed && !loading ? "pointer" : "default",
									fontFamily: SM.fontSans,
									fontWeight: 600
								},
								children: loading ? "回滚中…" : "确认执行回滚"
							})
						]
					}),
					rollbackAction !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginBottom: 10,
							padding: 10,
							borderRadius: 10,
							background: rollbackAction.state === "succeeded" ? SM.goodSoft : SM.badSoft,
							color: actionColor(rollbackAction.state)
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 7
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { color: actionColor(rollbackAction.state) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: rollbackAction.state === "succeeded" ? "已恢复上一版本" : actionLabel(rollbackAction.state) })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								marginTop: 4,
								fontFamily: SM.fontMono,
								fontVariantNumeric: "tabular-nums"
							},
							children: [
								rollbackAction.transitionPlanId.slice(0, 25),
								" · ",
								rollbackAction.updatedAt.slice(0, 19).replace("T", " ")
							]
						})]
					}),
					retentionPlan !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginBottom: 10,
							padding: 11,
							borderRadius: 12,
							background: SM.warnSoft,
							color: SM.fg2
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 7,
									marginBottom: 8,
									color: SM.warn
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { color: SM.warn }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Release 备份清理预览" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: { marginBottom: 7 },
								children: [
									"设备：",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { fontFamily: SM.fontMono },
										children: retentionPlan.deviceId
									}),
									" · 计划过期：",
									formatCheckedAt(retentionPlan.expiresAt)
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginBottom: 7,
									color: SM.good
								},
								children: ["明确保留：", retentionPlan.retainedTransitionPlanIds.length === 0 ? "无已登记 transition" : retentionPlan.retainedTransitionPlanIds.map((id) => id.slice(0, 25)).join("、")]
							}),
							retentionPlan.entries.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginTop: 5,
									padding: 7,
									borderRadius: 8,
									background: SM.panel
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
										style: { color: SM.bad },
										children: "将删除 superseded transition"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										title: entry.transitionPlanId,
										style: {
											marginTop: 2,
											fontFamily: SM.fontMono
										},
										children: entry.transitionPlanId
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: { marginTop: 2 },
										children: ["同时删除备份：", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: { fontFamily: SM.fontMono },
											children: entry.backupProfile ?? "无备份目录，仅删除 transition/descriptor"
										})]
									})
								]
							}, entry.transitionPlanId)),
							retentionPlan.orphanBackupProfiles.map((profile) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginTop: 5,
									color: SM.warn
								},
								children: [
									"发现孤立 backup：",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { fontFamily: SM.fontMono },
										children: profile
									}),
									"；不会由本计划删除，需人工审计。"
								]
							}, profile)),
							retentionPlan.orphanStageProfiles.map((profile) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginTop: 5,
									color: SM.warn
								},
								children: [
									"发现孤立 stage：",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { fontFamily: SM.fontMono },
										children: profile
									}),
									"；不会由本计划删除，需人工审计。"
								]
							}, profile)),
							retentionPlan.orphanFailedProfiles.map((profile) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginTop: 5,
									color: SM.warn
								},
								children: [
									"发现孤立 failed：",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { fontFamily: SM.fontMono },
										children: profile
									}),
									"；不会由本计划删除，需人工审计。"
								]
							}, profile)),
							retentionPlan.entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: { color: SM.good },
								children: "当前计划没有可执行的 superseded transition 删除项；孤立目录仅供审计。"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: {
									display: "flex",
									alignItems: "flex-start",
									gap: 8,
									marginTop: 10,
									color: SM.bad,
									cursor: "pointer"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: retentionArmed,
									onChange: (event) => onRetentionArm(event.currentTarget.checked)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "我确认永久删除上面逐项列出的 exact superseded transition 及其绑定备份；当前与上一 transition 保留，孤立目录不会由本计划删除。" })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: !retentionArmed || loading,
								onClick: onRetentionApprove,
								style: {
									width: "100%",
									minHeight: 32,
									marginTop: 9,
									border: 0,
									borderRadius: 10,
									background: retentionArmed && !loading ? SM.bad : SM.fg4,
									color: SM.panel,
									cursor: retentionArmed && !loading ? "pointer" : "default",
									fontFamily: SM.fontSans,
									fontWeight: 600
								},
								children: loading ? "清理中…" : "确认执行备份清理"
							})] })
						]
					}),
					retentionAction !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginBottom: 10,
							padding: 10,
							borderRadius: 10,
							background: retentionAction.state === "succeeded" ? SM.goodSoft : SM.warnSoft,
							color: retentionAction.state === "succeeded" ? SM.good : SM.warn
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 7
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { color: retentionAction.state === "succeeded" ? SM.good : SM.warn }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: retentionAction.state === "succeeded" ? "备份保留清理已完成" : "备份保留清理进行中" })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: { marginTop: 4 },
							children: [
								"已删除 ",
								retentionAction.removedTransitionPlanIds.length,
								" 个 superseded transition · ",
								formatCheckedAt(retentionAction.updatedAt)
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: onReload,
						disabled: loading,
						style: {
							width: "100%",
							minHeight: 30,
							border: `1px solid ${SM.borderStrong}`,
							borderRadius: 10,
							background: SM.panel,
							color: SM.fg2,
							cursor: loading ? "default" : "pointer",
							fontFamily: SM.fontSans
						},
						children: "刷新目标状态"
					})
				]
			});
		}
		function TasksView({ targets, targetDeviceId, workspaceId, profile, policyId, prompt, taskId, reply, catalog, catalogLoading, catalogError, catalogNotice, pruneArmed, loading, error, onTarget, onWorkspace, onProfile, onPolicy, onPrompt, onTaskId, onClear, onSubmit, onStatus, onCancel, onApprovalDecision, onReloadTargets, onRefreshCatalog, onTrack, onResume, onArmPrune, onPrune }) {
			const releaseTargets = (targets?.targets ?? []).flatMap((target) => {
				const inspection = target.inspection;
				return target.online && inspection !== void 0 && "kind" in inspection && inspection.kind === "profile-release" ? [{
					target,
					deviceId: target.deviceId,
					tasks: inspection.tasks
				}] : [];
			});
			const selected = releaseTargets.find((target) => target.deviceId === targetDeviceId);
			const selectedExecutionProfile = selected?.tasks.executionProfiles.find((binding) => binding.profile === profile);
			const taskPayload = reply !== null && (reply.response.kind === "task.progress" || reply.response.kind === "task.result") ? reply.response.payload : null;
			const approval = reply?.response.kind === "task.approval.request" ? reply.response.payload : null;
			const state = taskPayload?.state;
			const terminal = state === "succeeded" || state === "failed" || state === "cancelled";
			const emptyReason = targets === null ? "正在读取设备与任务策略…" : targets.enabled === false ? "远程收敛尚未启用。请先配置固定 Agent 目标。" : targets.targets.length === 0 ? "尚未配置任何 Agent 目标。" : targets.targets.every((target) => !target.online) ? "所有目标设备均离线；请检查固定传输和 Agent 服务。" : releaseTargets.length === 0 ? "在线目标仍使用旧版单插件模式，尚不支持可恢复任务目录。" : releaseTargets.every((target) => !target.tasks.enabled) ? "目标设备在线，但 A2A 任务策略尚未启用。" : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: "0 12px 12px" },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							marginBottom: 10,
							padding: "9px 10px",
							borderRadius: 10,
							background: SM.panelSoft,
							color: SM.fg2,
							lineHeight: 1.55
						},
						children: "任务通过设备签名的 A2A 消息提交。目标机只接受下方列出的 workspace/profile ID；没有任意 shell、argv 或路径入口。"
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							marginBottom: 10,
							padding: "9px 10px",
							borderRadius: 10,
							background: SM.badSoft,
							color: SM.bad,
							fontFamily: SM.fontMono
						},
						children: error
					}),
					emptyReason !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							marginBottom: 10,
							padding: 12,
							borderRadius: 10,
							background: SM.panel,
							color: SM.fg3
						},
						children: emptyReason
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: onReloadTargets,
						disabled: loading,
						style: {
							width: "100%",
							minHeight: 30,
							marginBottom: 10,
							border: `1px solid ${SM.borderStrong}`,
							borderRadius: 10,
							background: SM.panel,
							color: SM.fg2,
							cursor: loading ? "default" : "pointer",
							fontFamily: SM.fontSans
						},
						children: "重新读取设备状态"
					}),
					(releaseTargets.length > 0 || targetDeviceId !== "") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginBottom: 10,
							padding: 11,
							borderRadius: 12,
							background: SM.panel
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: {
								display: "grid",
								gap: 5,
								marginBottom: 9,
								color: SM.fg2
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "目标设备" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								value: targetDeviceId,
								disabled: loading || taskId !== "",
								onChange: (event) => onTarget(event.currentTarget.value),
								style: {
									minHeight: 34,
									border: `1px solid ${SM.borderStrong}`,
									borderRadius: 9,
									background: SM.panel,
									color: SM.fg
								},
								children: [targetDeviceId !== "" && selected === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: targetDeviceId,
									children: [targetDeviceId, "（已保存）"]
								}), releaseTargets.map((target) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: target.deviceId,
									children: [target.deviceId, target.tasks.enabled ? "" : "（任务关闭）"]
								}, target.deviceId))]
							})]
						}), selected !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								color: SM.fg2,
								lineHeight: 1.65
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
									"策略：",
									selected.tasks.enabled ? "已启用" : "已关闭",
									" · Workspace ",
									selected.tasks.workspaceIds.join(", ") || "无",
									" · Profile ",
									selected.tasks.profiles.join(", ") || "无"
								] }),
								selectedExecutionProfile !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									title: selectedExecutionProfile.profileHash,
									style: {
										fontFamily: SM.fontMono,
										fontSize: 10.5
									},
									children: [
										"execution ",
										selectedExecutionProfile.profile,
										" · ",
										selectedExecutionProfile.profileHash.slice(0, 12)
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										color: selected.target.inspection !== void 0 && "kind" in selected.target.inspection && selected.target.inspection.liveManifestDigest === selected.target.inspection.desiredManifestDigest ? SM.good : SM.warn,
										fontFamily: SM.fontMono,
										fontSize: 10.5
									},
									children: [
										"live ",
										selected.target.inspection !== void 0 && "kind" in selected.target.inspection ? selected.target.inspection.liveManifestDigest.slice(0, 12) : "—",
										" · desired ",
										selected.target.inspection !== void 0 && "kind" in selected.target.inspection ? selected.target.inspection.desiredManifestDigest.slice(0, 12) : "—"
									]
								}),
								selected.target.readiness !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										"身份：",
										selected.target.readiness.teamId,
										"/",
										selected.target.readiness.principalId
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										title: selected.target.readiness.identityKeyId,
										style: {
											overflowWrap: "anywhere",
											fontFamily: SM.fontMono,
											fontSize: 10.5
										},
										children: ["Key ", selected.target.readiness.identityKeyId]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										"受信任 Peer：",
										selected.target.readiness.trustedPeerCount,
										" · Doctor 就绪"
									] })
								] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { color: SM.warn },
									children: ["Doctor：", selected.target.readinessErrorCode ?? "尚无就绪信息"]
								}),
								targets?.signer !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { color: targets.signer.ready ? SM.good : SM.warn },
									children: ["本地签名器：", targets.signer.ready ? `就绪 · ${targets.signer.deviceId}` : targets.signer.errorCode ?? "未就绪"]
								})
							]
						})]
					}),
					selected?.tasks.enabled === true && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: 11,
							borderRadius: 12,
							background: SM.panel
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "grid",
									gridTemplateColumns: "1fr 1fr",
									gap: 8
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: {
										display: "grid",
										gap: 5,
										color: SM.fg2
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Workspace ID" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
										value: workspaceId,
										onChange: (event) => onWorkspace(event.currentTarget.value),
										style: {
											minHeight: 34,
											border: `1px solid ${SM.borderStrong}`,
											borderRadius: 9,
											background: SM.panel,
											color: SM.fg
										},
										children: (selected?.tasks.workspaceIds ?? []).map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: id,
											children: id
										}, id))
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: {
										display: "grid",
										gap: 5,
										color: SM.fg2
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Profile" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
										value: profile,
										onChange: (event) => onProfile(event.currentTarget.value),
										style: {
											minHeight: 34,
											border: `1px solid ${SM.borderStrong}`,
											borderRadius: 9,
											background: SM.panel,
											color: SM.fg
										},
										children: (selected?.tasks.profiles ?? []).map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: id,
											children: id
										}, id))
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: {
									display: "grid",
									gap: 5,
									marginTop: 9,
									color: SM.fg2
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "执行策略" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									value: policyId,
									onChange: (event) => onPolicy(event.currentTarget.value),
									style: {
										minHeight: 34,
										border: `1px solid ${SM.borderStrong}`,
										borderRadius: 9,
										background: SM.panel,
										color: SM.fg
									},
									children: (selected?.tasks.policies ?? []).map((policy) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: policy.policyId,
										children: [
											policy.policyId,
											" · ",
											policy.permissionMode === "read-only" ? "只读" : "工作区写入，逐次审批"
										]
									}, policy.policyId))
								})]
							}),
							selected?.tasks.policies.find((policy) => policy.policyId === policyId)?.permissionMode === "workspace-write" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginTop: 7,
									padding: 7,
									borderRadius: 8,
									background: SM.warnSoft,
									color: SM.warn
								},
								children: "写入、命令和联网工具仍需逐次签名批准；未知工具和越出 workspace 的调用始终拒绝。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: {
									display: "grid",
									gap: 5,
									marginTop: 9,
									color: SM.fg2
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "任务" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									value: prompt,
									onChange: (event) => onPrompt(event.currentTarget.value),
									rows: 5,
									maxLength: 32768,
									placeholder: "描述要由目标 DSH 完成的任务",
									style: {
										resize: "vertical",
										padding: 9,
										border: `1px solid ${SM.borderStrong}`,
										borderRadius: 9,
										background: SM.panel,
										color: SM.fg,
										fontFamily: SM.fontSans
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: loading || taskId !== "" || prompt.trim().length === 0 || workspaceId === "" || profile === "" || policyId === "",
								onClick: onSubmit,
								style: {
									width: "100%",
									minHeight: 34,
									marginTop: 10,
									border: 0,
									borderRadius: 10,
									background: loading || taskId !== "" || prompt.trim().length === 0 ? SM.fg4 : SM.info,
									color: SM.panel,
									cursor: loading || taskId !== "" || prompt.trim().length === 0 || workspaceId === "" || profile === "" || policyId === "" ? "default" : "pointer",
									fontWeight: 600
								},
								children: loading ? "提交中…" : "签名并提交任务"
							}),
							taskId !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginTop: 7,
									color: SM.warn
								},
								children: "已有任务引用；请先查询、取消，或明确清除记录后再新建任务。"
							})
						]
					}),
					targetDeviceId !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-dsh-fleet-task-recovery": true,
						style: {
							marginTop: 10,
							padding: 11,
							borderRadius: 12,
							background: SM.panel
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginBottom: 7,
									color: SM.fg2
								},
								children: ["恢复目标：", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { fontFamily: SM.fontMono },
									children: targetDeviceId
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: {
									display: "grid",
									gap: 5,
									color: SM.fg2
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Task ID" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									"aria-label": "Task ID",
									value: taskId,
									disabled: loading,
									onChange: (event) => onTaskId(event.currentTarget.value.trim()),
									placeholder: "task:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
									autoComplete: "off",
									spellCheck: false,
									style: {
										minHeight: 34,
										padding: "0 9px",
										border: `1px solid ${SM.borderStrong}`,
										borderRadius: 9,
										background: SM.panel,
										color: SM.fg,
										fontFamily: SM.fontMono
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginTop: 6,
									color: SM.fg3
								},
								children: "浏览器会尝试只保存目标设备和 Task ID，不保存任务描述或输出。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 8,
									marginTop: 9
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: loading || !isTaskId(taskId),
									onClick: onStatus,
									style: {
										flex: 1,
										minHeight: 30,
										border: `1px solid ${SM.borderStrong}`,
										borderRadius: 9,
										background: SM.panel,
										color: SM.fg2
									},
									children: "查询任务"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: loading || taskId === "" && reply === null,
									onClick: onClear,
									style: {
										flex: 1,
										minHeight: 30,
										border: 0,
										borderRadius: 9,
										background: SM.bg2,
										color: SM.fg2
									},
									children: "清除记录"
								})]
							})
						]
					}),
					reply !== null && taskPayload !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginTop: 10,
							padding: 11,
							borderRadius: 12,
							background: SM.panel
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 7
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { color: taskStateColor(state) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
										style: { flex: 1 },
										children: taskStateLabel(state)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: {
											color: SM.fg3,
											fontVariantNumeric: "tabular-nums"
										},
										children: ["更新时间：", typeof taskPayload.updatedAt === "string" ? formatCheckedAt(taskPayload.updatedAt) : "—"]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginTop: 5,
									overflowWrap: "anywhere",
									color: SM.fg3,
									fontFamily: SM.fontMono
								},
								children: reply.taskId
							}),
							taskPayload.result !== void 0 && taskPayload.result !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("pre", {
								style: {
									margin: "9px 0 0",
									padding: 9,
									maxHeight: 260,
									overflow: "auto",
									whiteSpace: "pre-wrap",
									borderRadius: 9,
									background: SM.panelSoft,
									color: SM.fg,
									fontFamily: SM.fontMono
								},
								children: [String(taskPayload.result), taskPayload.truncated ? "\n…结果已截断；完整结果保留在目标设备。" : ""]
							}),
							taskPayload.errorCode !== void 0 && taskPayload.errorCode !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginTop: 7,
									color: SM.bad,
									fontFamily: SM.fontMono
								},
								children: String(taskPayload.errorCode)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 8,
									marginTop: 9
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: loading,
									onClick: onStatus,
									style: {
										flex: 1,
										minHeight: 30,
										border: `1px solid ${SM.borderStrong}`,
										borderRadius: 9,
										background: SM.panel,
										color: SM.fg2
									},
									children: "刷新状态"
								}), !terminal && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: loading,
									onClick: onCancel,
									style: {
										flex: 1,
										minHeight: 30,
										border: 0,
										borderRadius: 9,
										background: SM.badSoft,
										color: SM.bad
									},
									children: "请求取消"
								})]
							})
						]
					}),
					reply !== null && approval !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-dsh-fleet-task-approval": true,
						style: {
							marginTop: 10,
							padding: 11,
							borderRadius: 12,
							background: SM.warnSoft,
							border: `1px solid ${SM.warn}`
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 7
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { color: SM.warn }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
										style: { flex: 1 },
										children: "目标机请求一次工具批准"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: { color: Date.parse(approval.expiresAt) <= Date.now() ? SM.bad : SM.fg3 },
										children: ["截止 ", formatCheckedAt(approval.expiresAt)]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginTop: 7,
									color: SM.fg2
								},
								children: [
									"目标 ",
									targetDeviceId,
									" · ",
									approval.capability,
									" · ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { fontFamily: SM.fontMono },
										children: approval.toolName
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginTop: 5,
									color: SM.fg2
								},
								children: approval.summary
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
								style: {
									margin: "8px 0 0",
									padding: 9,
									maxHeight: 260,
									overflow: "auto",
									whiteSpace: "pre-wrap",
									overflowWrap: "anywhere",
									borderRadius: 9,
									background: SM.panel,
									color: SM.fg,
									fontFamily: SM.fontMono
								},
								children: JSON.stringify(approval.arguments, null, 2)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								title: approval.argumentsDigest,
								style: {
									marginTop: 6,
									overflowWrap: "anywhere",
									color: SM.fg3,
									fontFamily: SM.fontMono,
									fontSize: 10.5
								},
								children: ["参数 SHA-256 ", approval.argumentsDigest]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginTop: 6,
									color: SM.fg3
								},
								children: "批准只对这一个 task、tool call 和参数摘要有效，执行一次即消费；不会生成永久授权。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 8,
									marginTop: 9
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: loading || Date.parse(approval.expiresAt) <= Date.now(),
									onClick: () => onApprovalDecision("allowed-once"),
									style: {
										flex: 1,
										minHeight: 32,
										border: 0,
										borderRadius: 9,
										background: SM.warn,
										color: SM.panel,
										fontWeight: 600
									},
									children: "仅允许这一次"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: loading,
									onClick: () => onApprovalDecision("rejected"),
									style: {
										flex: 1,
										minHeight: 32,
										border: 0,
										borderRadius: 9,
										background: SM.badSoft,
										color: SM.bad,
										fontWeight: 600
									},
									children: "拒绝"
								})]
							})
						]
					}),
					targetDeviceId !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginTop: 10,
							padding: 11,
							borderRadius: 12,
							background: SM.panel
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8,
									marginBottom: 8
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
										style: { flex: 1 },
										children: "最近任务"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: catalogLoading,
										onClick: onRefreshCatalog,
										style: {
											minHeight: 28,
											border: `1px solid ${SM.borderStrong}`,
											borderRadius: 8,
											background: SM.panel,
											color: SM.fg2
										},
										children: catalogLoading ? "读取中…" : "刷新"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: loading || catalogLoading || (catalog?.tasks.length ?? 0) === 0,
										onClick: pruneArmed ? onPrune : onArmPrune,
										title: "只删除 30 天前已完成、失败或取消的任务；不会删除活动任务",
										style: {
											minHeight: 28,
											border: 0,
											borderRadius: 8,
											background: pruneArmed ? SM.badSoft : SM.bg2,
											color: pruneArmed ? SM.bad : SM.fg2
										},
										children: pruneArmed ? `确认清理 ${targetDeviceId}` : "准备清理 30 天前终态"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: loading || catalogLoading,
								onClick: onResume,
								style: {
									width: "100%",
									minHeight: 29,
									marginBottom: 7,
									border: `1px solid ${SM.borderStrong}`,
									borderRadius: 8,
									background: SM.panel,
									color: SM.fg2
								},
								children: "检查并恢复未完成任务"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginBottom: 7,
									color: SM.fg3
								},
								children: "读取设备状态不会启动任务；只有点击上方按钮才会检查并恢复目标机上的未完成任务。"
							}),
							pruneArmed && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginBottom: 7,
									padding: 7,
									borderRadius: 8,
									background: SM.badSoft,
									color: SM.bad
								},
								children: [
									"再次点击将永久删除 ",
									targetDeviceId,
									" 上 30 天前已完成、失败或取消的任务元数据；活动任务不会删除。切换目标或刷新目录会取消确认。"
								]
							}),
							catalogNotice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginBottom: 7,
									color: SM.good
								},
								children: catalogNotice
							}),
							catalogError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginBottom: 7,
									color: SM.bad,
									fontFamily: SM.fontMono
								},
								children: catalogError
							}),
							catalog !== null && catalog.tasks.length === 0 && catalogError === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: { color: SM.fg3 },
								children: "该设备还没有可展示的持久任务记录。"
							}),
							catalog?.tasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									padding: "8px 0",
									borderTop: `1px solid ${SM.border}`
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: 7
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, { color: taskStateColor(task.state) }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
												style: { color: taskStateColor(task.state) },
												children: taskStateLabel(task.state)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												style: {
													marginLeft: "auto",
													color: SM.fg3,
													fontVariantNumeric: "tabular-nums"
												},
												children: ["更新时间：", formatCheckedAt(task.updatedAt)]
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: {
											marginTop: 4,
											overflowWrap: "anywhere",
											fontFamily: SM.fontMono,
											fontSize: 10.5
										},
										children: task.taskId
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											marginTop: 3,
											color: SM.fg3
										},
										children: [
											"目标 ",
											task.targetDeviceId,
											" · Workspace ",
											task.workspaceId,
											" · Profile ",
											task.profile
										]
									}),
									task.errorCode !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: {
											marginTop: 3,
											color: SM.bad,
											fontFamily: SM.fontMono
										},
										children: task.errorCode
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: loading || taskId !== "",
										onClick: () => onTrack(task),
										style: {
											width: "100%",
											minHeight: 27,
											marginTop: 6,
											border: `1px solid ${SM.borderStrong}`,
											borderRadius: 8,
											background: SM.panel,
											color: SM.fg2
										},
										children: "跟踪此任务"
									})
								]
							}, task.taskId))
						]
					})
				]
			});
		}
		function CollaborationView({ items, loading, error, notice, retention, importJson, exportKind, recipientTeamId, recipientDeviceId, summary, taskId, artifactRefs, output, onImportJson, onExportKind, onRecipientTeamId, onRecipientDeviceId, onSummary, onTaskId, onArtifactRefs, onReload, onImport, onExport, onAcknowledge, onDecision, onRetentionPlan }) {
			const exportReady = FEDERATION_IDENTIFIER_PATTERN.test(recipientTeamId) && FEDERATION_IDENTIFIER_PATTERN.test(recipientDeviceId) && summary.trim().length > 0 && (exportKind === "handoff" ? taskId === "" || isTaskId(taskId) : isTaskId(taskId));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: "0 12px 12px" },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							marginBottom: 10,
							padding: "9px 10px",
							borderRadius: 10,
							background: SM.panelSoft,
							color: SM.fg2,
							lineHeight: 1.55
						},
						children: "跨团队协作只交换签名的交接与审批元数据。这里不连接 Relay，不执行任务，也不会自动打开 artifactRefs 中的 URL 或文件。"
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							marginBottom: 10,
							padding: 9,
							borderRadius: 9,
							background: SM.badSoft,
							color: SM.bad,
							fontFamily: SM.fontMono
						},
						children: error
					}),
					notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							marginBottom: 10,
							padding: 9,
							borderRadius: 9,
							background: SM.goodSoft,
							color: SM.good
						},
						children: notice
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginBottom: 10,
							padding: 11,
							borderRadius: 12,
							background: SM.panel
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 7,
									alignItems: "center",
									marginBottom: 8
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
										style: { flex: 1 },
										children: "收件箱"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: loading,
										onClick: onRetentionPlan,
										style: {
											minHeight: 28,
											border: 0,
											borderRadius: 8,
											background: SM.bg2,
											color: SM.fg2
										},
										children: "保留计划"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: loading,
										onClick: onReload,
										style: {
											minHeight: 28,
											border: 0,
											borderRadius: 8,
											background: SM.bg2,
											color: SM.fg2
										},
										children: "刷新"
									})
								]
							}),
							items === null && !loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: { color: SM.fg3 },
								children: "尚未读取协作收件箱。"
							}),
							items?.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: { color: SM.fg3 },
								children: "没有跨团队消息。"
							}),
							items?.map((item) => {
								const envelope = item.record.envelope;
								const payload = envelope.payload;
								const acknowledged = item.acknowledgement !== null;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										marginTop: 8,
										padding: 9,
										border: `1px solid ${SM.border}`,
										borderRadius: 10,
										background: SM.panelSoft
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												display: "flex",
												gap: 7,
												alignItems: "center"
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", {
													style: { fontFamily: SM.fontMono },
													children: [
														envelope.teamId,
														"/",
														envelope.sender.deviceId
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Pill, { children: envelope.kind }),
												item.expired && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Pill, {
													tone: "warn",
													children: "已过期"
												}),
												item.acknowledgement !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: {
														marginLeft: "auto",
														color: SM.fg3
													},
													children: item.acknowledgement.disposition === "acknowledged" ? "已确认" : "已忽略"
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: {
												marginTop: 6,
												color: SM.fg2,
												whiteSpace: "pre-wrap",
												overflowWrap: "anywhere"
											},
											children: typeof payload.summary === "string" ? payload.summary : envelope.kind === "receipt" ? `Receipt · ${String(payload.requestMessageId)}` : String(payload.decision ?? envelope.kind)
										}),
										envelope.kind === "handoff" && Array.isArray(payload.artifactRefs) && payload.artifactRefs.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: { marginTop: 6 },
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												style: { color: SM.fg3 },
												children: "artifactRefs（纯文本）"
											}), payload.artifactRefs.map((ref, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												style: {
													marginTop: 2,
													overflowWrap: "anywhere",
													fontFamily: SM.fontMono,
													color: SM.fg2
												},
												children: String(ref)
											}, index))]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												display: "flex",
												gap: 7,
												marginTop: 8
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													disabled: loading || acknowledged,
													onClick: () => onAcknowledge(item, "acknowledged"),
													style: {
														minHeight: 28,
														border: 0,
														borderRadius: 8,
														background: SM.goodSoft,
														color: SM.good
													},
													children: "确认"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													disabled: loading || acknowledged,
													onClick: () => onAcknowledge(item, "dismissed"),
													style: {
														minHeight: 28,
														border: 0,
														borderRadius: 8,
														background: SM.bg2,
														color: SM.fg2
													},
													children: "忽略"
												}),
												envelope.kind === "approval.request" && !item.expired && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													disabled: loading,
													onClick: () => onDecision(item, "endorsed"),
													style: {
														marginLeft: "auto",
														minHeight: 28,
														border: 0,
														borderRadius: 8,
														background: SM.infoSoft,
														color: SM.info
													},
													children: "背书并导出"
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													disabled: loading,
													onClick: () => onDecision(item, "declined"),
													style: {
														minHeight: 28,
														border: 0,
														borderRadius: 8,
														background: SM.badSoft,
														color: SM.bad
													},
													children: "拒绝并导出"
												})] })
											]
										})
									]
								}, envelope.messageId);
							}),
							retention !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginTop: 9,
									padding: 8,
									borderRadius: 9,
									background: SM.warnSoft,
									color: SM.warn
								},
								children: [
									"保留计划仅预览：",
									retention.candidates.length,
									" 条候选，不会自动删除。",
									retention.candidates.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											marginTop: 3,
											fontFamily: SM.fontMono
										},
										children: [
											candidate.messageId,
											" · ",
											candidate.reason
										]
									}, candidate.messageId))
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginBottom: 10,
							padding: 11,
							borderRadius: 12,
							background: SM.panel
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "导入签名 Envelope" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								"aria-label": "导入 Envelope JSON",
								value: importJson,
								disabled: loading,
								maxLength: 65536,
								onChange: (event) => onImportJson(event.currentTarget.value),
								rows: 5,
								placeholder: "粘贴收到的 JSON",
								style: {
									width: "100%",
									boxSizing: "border-box",
									resize: "vertical",
									marginTop: 8,
									padding: 8,
									border: `1px solid ${SM.borderStrong}`,
									borderRadius: 9,
									fontFamily: SM.fontMono
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: loading || importJson.trim() === "",
								onClick: onImport,
								style: {
									width: "100%",
									minHeight: 30,
									marginTop: 7,
									border: 0,
									borderRadius: 9,
									background: SM.infoSoft,
									color: SM.info
								},
								children: "验证并导入"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: 11,
							borderRadius: 12,
							background: SM.panel
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "创建导出 Envelope" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "grid",
									gridTemplateColumns: "1fr 1fr",
									gap: 8,
									marginTop: 8
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: {
											display: "grid",
											gap: 4,
											color: SM.fg2
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "类型" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											value: exportKind,
											disabled: loading,
											onChange: (event) => onExportKind(event.currentTarget.value),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "handoff",
												children: "交接"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "approval.request",
												children: "审批请求"
											})]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: {
											display: "grid",
											gap: 4,
											color: SM.fg2
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "对方 Team" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											value: recipientTeamId,
											disabled: loading,
											maxLength: 64,
											onChange: (event) => onRecipientTeamId(event.currentTarget.value)
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: {
											display: "grid",
											gap: 4,
											color: SM.fg2
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "对方 Device" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											value: recipientDeviceId,
											disabled: loading,
											maxLength: 64,
											onChange: (event) => onRecipientDeviceId(event.currentTarget.value)
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: {
											display: "grid",
											gap: 4,
											color: SM.fg2
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["Task ID", exportKind === "handoff" ? "（可选）" : ""] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											value: taskId,
											disabled: loading,
											maxLength: 64,
											onChange: (event) => onTaskId(event.currentTarget.value)
										})]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: {
									display: "grid",
									gap: 4,
									marginTop: 8,
									color: SM.fg2
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "摘要" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									value: summary,
									disabled: loading,
									onChange: (event) => onSummary(event.currentTarget.value),
									rows: 3,
									maxLength: exportKind === "handoff" ? 8192 : 2048
								})]
							}),
							exportKind === "handoff" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: {
									display: "grid",
									gap: 4,
									marginTop: 8,
									color: SM.fg2
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "artifactRefs（每行一个，只作为文本）" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									value: artifactRefs,
									disabled: loading,
									maxLength: 16384,
									onChange: (event) => onArtifactRefs(event.currentTarget.value),
									rows: 3
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: loading || !exportReady,
								onClick: onExport,
								style: {
									width: "100%",
									minHeight: 30,
									marginTop: 8,
									border: 0,
									borderRadius: 9,
									background: SM.infoSoft,
									color: SM.info
								},
								children: "生成签名 Envelope"
							}),
							output !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: {
									display: "grid",
									gap: 4,
									marginTop: 9,
									color: SM.fg2
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "复制下面的 JSON" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									"aria-label": "导出 Envelope JSON",
									readOnly: true,
									value: output,
									rows: 8,
									style: {
										resize: "vertical",
										fontFamily: SM.fontMono
									}
								})]
							})
						]
					})
				]
			});
		}
		function FleetSettings({ ctx }) {
			const [initialTaskReference] = (0, react.useState)(() => readStoredTaskReference());
			const [tab, setTab] = (0, react.useState)("status");
			const [status, setStatus] = (0, react.useState)(null);
			const [statusError, setStatusError] = (0, react.useState)(null);
			const [statusLoading, setStatusLoading] = (0, react.useState)(false);
			const [updates, setUpdates] = (0, react.useState)(null);
			const [updateError, setUpdateError] = (0, react.useState)(null);
			const [updateLoading, setUpdateLoading] = (0, react.useState)(false);
			const [agentTargets, setAgentTargets] = (0, react.useState)(null);
			const [agentPlan, setAgentPlan] = (0, react.useState)(null);
			const [agentAction, setAgentAction] = (0, react.useState)(null);
			const [rollbackPlan, setRollbackPlan] = (0, react.useState)(null);
			const [rollbackAction, setRollbackAction] = (0, react.useState)(null);
			const [releaseRetentionPlan, setReleaseRetentionPlan] = (0, react.useState)(null);
			const [releaseRetentionAction, setReleaseRetentionAction] = (0, react.useState)(null);
			const [agentError, setAgentError] = (0, react.useState)(null);
			const [agentLoading, setAgentLoading] = (0, react.useState)(false);
			const [approvalArmed, setApprovalArmed] = (0, react.useState)(false);
			const [rollbackArmed, setRollbackArmed] = (0, react.useState)(false);
			const [releaseRetentionArmed, setReleaseRetentionArmed] = (0, react.useState)(false);
			const [taskTarget, setTaskTarget] = (0, react.useState)(initialTaskReference?.targetDeviceId ?? "");
			const [taskWorkspace, setTaskWorkspace] = (0, react.useState)("");
			const [taskProfile, setTaskProfile] = (0, react.useState)("");
			const [taskPolicy, setTaskPolicy] = (0, react.useState)("");
			const [taskPrompt, setTaskPrompt] = (0, react.useState)("");
			const [taskId, setTaskId] = (0, react.useState)(initialTaskReference?.taskId ?? "");
			const [taskReply, setTaskReply] = (0, react.useState)(null);
			const [taskError, setTaskError] = (0, react.useState)(null);
			const [taskLoading, setTaskLoading] = (0, react.useState)(false);
			const [taskCatalog, setTaskCatalog] = (0, react.useState)(null);
			const [taskCatalogTarget, setTaskCatalogTarget] = (0, react.useState)("");
			const [taskCatalogError, setTaskCatalogError] = (0, react.useState)(null);
			const [taskCatalogNotice, setTaskCatalogNotice] = (0, react.useState)(null);
			const [taskCatalogLoading, setTaskCatalogLoading] = (0, react.useState)(false);
			const [taskPruneArmed, setTaskPruneArmed] = (0, react.useState)(false);
			const [federationItems, setFederationItems] = (0, react.useState)(null);
			const [federationLoading, setFederationLoading] = (0, react.useState)(false);
			const [federationError, setFederationError] = (0, react.useState)(null);
			const [federationNotice, setFederationNotice] = (0, react.useState)(null);
			const [federationRetention, setFederationRetention] = (0, react.useState)(null);
			const [federationImportJson, setFederationImportJson] = (0, react.useState)("");
			const [federationExportKind, setFederationExportKind] = (0, react.useState)("handoff");
			const [federationRecipientTeam, setFederationRecipientTeam] = (0, react.useState)("");
			const [federationRecipientDevice, setFederationRecipientDevice] = (0, react.useState)("");
			const [federationSummary, setFederationSummary] = (0, react.useState)("");
			const [federationTaskId, setFederationTaskId] = (0, react.useState)("");
			const [federationArtifactRefs, setFederationArtifactRefs] = (0, react.useState)("");
			const [federationOutput, setFederationOutput] = (0, react.useState)("");
			const statusInFlight = (0, react.useRef)(null);
			const updatesInFlight = (0, react.useRef)(null);
			const agentsInFlight = (0, react.useRef)(null);
			const agentMutationInFlight = (0, react.useRef)(false);
			const taskMutationInFlight = (0, react.useRef)(false);
			const taskCatalogInFlight = (0, react.useRef)(null);
			const taskCatalogMutationInFlight = (0, react.useRef)(false);
			const taskCatalogEpoch = (0, react.useRef)(0);
			const taskPollFailures = (0, react.useRef)(0);
			const taskEpoch = (0, react.useRef)(0);
			const restoredTaskChecked = (0, react.useRef)(false);
			const federationInFlight = (0, react.useRef)(null);
			const federationMutationInFlight = (0, react.useRef)(false);
			const federationEpoch = (0, react.useRef)(0);
			const loadStatus = (0, react.useCallback)(async () => {
				if (statusInFlight.current !== null) return statusInFlight.current;
				const request = (async () => {
					setStatusLoading(true);
					try {
						const result = await ctx.connection.rpc.call(CHANNEL, "status", null);
						setStatus(rpcValue(result, isFleetStatus, "fleet status unavailable"));
						setStatusError(null);
					} catch (cause) {
						setStatusError(cause instanceof Error ? cause.message : String(cause));
					} finally {
						setStatusLoading(false);
					}
				})();
				statusInFlight.current = request;
				try {
					await request;
				} finally {
					statusInFlight.current = null;
				}
			}, [ctx]);
			const loadUpdates = (0, react.useCallback)(async (mode = "if-stale") => {
				if (updatesInFlight.current !== null) return updatesInFlight.current;
				const request = (async () => {
					setUpdateLoading(true);
					try {
						const result = await ctx.connection.rpc.call(CHANNEL, "updates", { mode });
						setUpdates(rpcValue(result, isFleetUpdates, "update check unavailable"));
						setUpdateError(null);
					} catch (cause) {
						setUpdateError(cause instanceof Error ? cause.message : String(cause));
					} finally {
						setUpdateLoading(false);
					}
				})();
				updatesInFlight.current = request;
				try {
					await request;
				} finally {
					updatesInFlight.current = null;
				}
			}, [ctx]);
			const loadAgentTargets = (0, react.useCallback)(async () => {
				if (agentsInFlight.current !== null) return agentsInFlight.current;
				const request = (async () => {
					setAgentLoading(true);
					try {
						const result = await ctx.connection.rpc.call(AGENT_CHANNEL, "targets", null);
						setAgentTargets(rpcValue(result, isAgentTargets, "fleet targets unavailable"));
						setAgentError(null);
					} catch (cause) {
						setAgentError(cause instanceof Error ? cause.message : String(cause));
					} finally {
						setAgentLoading(false);
					}
				})();
				agentsInFlight.current = request;
				try {
					await request;
				} finally {
					agentsInFlight.current = null;
				}
			}, [ctx]);
			const loadFederationInbox = (0, react.useCallback)(async () => {
				if (federationInFlight.current !== null) return federationInFlight.current;
				const requestEpoch = ++federationEpoch.current;
				const request = (async () => {
					setFederationLoading(true);
					try {
						const items = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "federation-list", { limit: 50 }), isFederationInbox, "federation inbox unavailable");
						if (federationEpoch.current !== requestEpoch) return;
						setFederationItems(items);
						setFederationError(null);
					} catch (cause) {
						if (federationEpoch.current !== requestEpoch) return;
						setFederationError(cause instanceof Error ? cause.message : String(cause));
					} finally {
						if (federationEpoch.current === requestEpoch) setFederationLoading(false);
					}
				})();
				federationInFlight.current = request;
				try {
					await request;
				} finally {
					if (federationInFlight.current === request) federationInFlight.current = null;
				}
			}, [ctx]);
			const loadTaskCatalog = (0, react.useCallback)(async (targetDeviceId, force = false) => {
				if (targetDeviceId === "") return;
				const existing = taskCatalogInFlight.current;
				if (!force && existing !== null && existing.targetDeviceId === targetDeviceId) return existing.promise;
				if (force) taskCatalogEpoch.current += 1;
				const requestEpoch = taskCatalogEpoch.current;
				setTaskPruneArmed(false);
				setTaskCatalogLoading(true);
				setTaskCatalogError(null);
				const request = (async () => {
					try {
						const nextCatalog = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "tasks-list", {
							targetDeviceId,
							limit: 20
						}), isFleetTaskCatalog, "fleet task catalog unavailable");
						if (nextCatalog.tasks.some((task) => task.targetDeviceId !== targetDeviceId)) throw new Error("fleet task catalog contains another target");
						if (taskCatalogEpoch.current !== requestEpoch) return;
						setTaskCatalog(nextCatalog);
						setTaskCatalogTarget(targetDeviceId);
						setTaskCatalogError(null);
					} catch (cause) {
						if (taskCatalogEpoch.current !== requestEpoch) return;
						setTaskCatalog(null);
						setTaskCatalogTarget(targetDeviceId);
						setTaskCatalogError(cause instanceof Error ? cause.message : String(cause));
					}
				})();
				const entry = {
					targetDeviceId,
					promise: request
				};
				taskCatalogInFlight.current = entry;
				try {
					await request;
				} finally {
					if (taskCatalogInFlight.current === entry) taskCatalogInFlight.current = null;
					if (taskCatalogEpoch.current === requestEpoch) setTaskCatalogLoading(false);
				}
			}, [ctx]);
			const pruneTaskCatalog = (0, react.useCallback)(async () => {
				if (taskTarget === "" || taskMutationInFlight.current || taskCatalogMutationInFlight.current || taskCatalogInFlight.current !== null) return;
				taskCatalogMutationInFlight.current = true;
				setTaskPruneArmed(false);
				const requestTarget = taskTarget;
				const requestEpoch = taskCatalogEpoch.current;
				let refresh = false;
				setTaskCatalogLoading(true);
				setTaskCatalogError(null);
				setTaskCatalogNotice(null);
				try {
					const olderThan = (/* @__PURE__ */ new Date(Date.now() - 2592e6)).toISOString();
					const outcome = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "tasks-prune", {
						targetDeviceId: requestTarget,
						olderThan,
						states: [
							"succeeded",
							"failed",
							"cancelled"
						]
					}), isFleetTaskPruneResult, "fleet task prune result unavailable");
					if (taskCatalogEpoch.current !== requestEpoch) return;
					setTaskCatalogNotice(`已清理 ${outcome.pruned} 个终态任务；跳过 ${outcome.skippedActive} 个活动任务。`);
					refresh = true;
				} catch (cause) {
					if (taskCatalogEpoch.current !== requestEpoch) return;
					setTaskCatalogError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					taskCatalogMutationInFlight.current = false;
					if (taskCatalogEpoch.current === requestEpoch) setTaskCatalogLoading(false);
				}
				if (refresh && taskCatalogEpoch.current === requestEpoch) await loadTaskCatalog(requestTarget, true);
			}, [
				ctx,
				loadTaskCatalog,
				taskTarget
			]);
			const resumeTasks = (0, react.useCallback)(async () => {
				if (taskTarget === "" || taskMutationInFlight.current || taskCatalogMutationInFlight.current) return;
				taskCatalogMutationInFlight.current = true;
				setTaskPruneArmed(false);
				const requestTarget = taskTarget;
				const requestEpoch = taskCatalogEpoch.current;
				let refresh = false;
				setTaskCatalogLoading(true);
				setTaskCatalogError(null);
				setTaskCatalogNotice(null);
				try {
					const outcome = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "tasks-resume", { targetDeviceId: requestTarget }), isFleetTaskResumeResult, "fleet task resume result unavailable");
					if (taskCatalogEpoch.current !== requestEpoch) return;
					setTaskCatalogNotice(`已检查目标机；恢复 ${outcome.resumed} 个未完成任务。`);
					refresh = true;
				} catch (cause) {
					if (taskCatalogEpoch.current !== requestEpoch) return;
					setTaskCatalogError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					taskCatalogMutationInFlight.current = false;
					if (taskCatalogEpoch.current === requestEpoch) setTaskCatalogLoading(false);
				}
				if (refresh && taskCatalogEpoch.current === requestEpoch) await loadTaskCatalog(requestTarget, true);
			}, [
				ctx,
				loadTaskCatalog,
				taskTarget
			]);
			const requestPlan = (0, react.useCallback)(async (deviceId, pluginId) => {
				if (agentMutationInFlight.current) return;
				agentMutationInFlight.current = true;
				setAgentLoading(true);
				setAgentPlan(null);
				setAgentAction(null);
				setRollbackPlan(null);
				setRollbackAction(null);
				setReleaseRetentionPlan(null);
				setReleaseRetentionAction(null);
				setApprovalArmed(false);
				setRollbackArmed(false);
				setReleaseRetentionArmed(false);
				try {
					const releaseMode = pluginId === void 0;
					const result = await ctx.connection.rpc.call(AGENT_CHANNEL, releaseMode ? "release-plan" : "plan", releaseMode ? { deviceId } : {
						deviceId,
						pluginId
					});
					setAgentPlan(releaseMode ? rpcValue(result, isFleetReleasePlan, "fleet release plan unavailable") : rpcValue(result, isFleetPlan, "fleet plan unavailable"));
					setAgentError(null);
				} catch (cause) {
					setAgentError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					agentMutationInFlight.current = false;
					setAgentLoading(false);
				}
			}, [ctx]);
			const approvePlan = (0, react.useCallback)(async () => {
				if (agentPlan === null || !approvalArmed || agentMutationInFlight.current) return;
				agentMutationInFlight.current = true;
				const approvedPlan = agentPlan;
				const releaseMode = "kind" in approvedPlan;
				setAgentLoading(true);
				setApprovalArmed(false);
				setRollbackPlan(null);
				setRollbackAction(null);
				setRollbackArmed(false);
				setReleaseRetentionPlan(null);
				setReleaseRetentionAction(null);
				setReleaseRetentionArmed(false);
				try {
					const result = await ctx.connection.rpc.call(AGENT_CHANNEL, releaseMode ? "release-approve" : "approve", {
						approvalId: crypto.randomUUID(),
						deviceId: approvedPlan.deviceId,
						planDigest: approvedPlan.digest,
						planExpiresAt: approvedPlan.expiresAt,
						planId: approvedPlan.planId,
						profile: approvedPlan.profile,
						...releaseMode ? {
							fromManifestDigest: approvedPlan.fromManifestDigest,
							toManifestDigest: approvedPlan.toManifestDigest,
							fromReleaseDigest: approvedPlan.fromReleaseDigest,
							toReleaseDigest: approvedPlan.toReleaseDigest
						} : {}
					});
					setAgentAction(rpcValue(result, isAgentAction, "fleet action result unavailable"));
					setAgentPlan(null);
					setAgentError(null);
					loadAgentTargets();
				} catch (cause) {
					const applyError = cause instanceof Error ? cause.message : String(cause);
					try {
						const status = await ctx.connection.rpc.call(AGENT_CHANNEL, releaseMode ? "release-action-status" : "action-status", {
							deviceId: approvedPlan.deviceId,
							planId: approvedPlan.planId
						});
						setAgentAction(rpcValue(status, isAgentAction, "fleet action status unavailable"));
						setAgentPlan(null);
						setAgentError(null);
						loadAgentTargets();
					} catch {
						setAgentError(applyError);
					}
				} finally {
					agentMutationInFlight.current = false;
					setAgentLoading(false);
				}
			}, [
				agentPlan,
				approvalArmed,
				ctx,
				loadAgentTargets
			]);
			const requestRollbackPlan = (0, react.useCallback)(async (deviceId, transitionPlanId) => {
				if (agentMutationInFlight.current) return;
				agentMutationInFlight.current = true;
				setAgentLoading(true);
				setRollbackPlan(null);
				setRollbackAction(null);
				setRollbackArmed(false);
				setReleaseRetentionPlan(null);
				setReleaseRetentionAction(null);
				setReleaseRetentionArmed(false);
				try {
					const next = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "release-rollback-plan", {
						deviceId,
						transitionPlanId
					}), isFleetReleaseRollbackPlan, "fleet release rollback plan unavailable");
					if (next.deviceId !== deviceId || next.transitionPlanId !== transitionPlanId) throw new Error("fleet release rollback plan does not match the requested transition");
					setRollbackPlan(next);
					setAgentError(null);
				} catch (cause) {
					setAgentError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					agentMutationInFlight.current = false;
					setAgentLoading(false);
				}
			}, [ctx]);
			const approveRollbackPlan = (0, react.useCallback)(async () => {
				if (rollbackPlan === null || !rollbackArmed || agentMutationInFlight.current) return;
				agentMutationInFlight.current = true;
				const approvedPlan = rollbackPlan;
				setAgentLoading(true);
				setRollbackArmed(false);
				try {
					const action = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "release-rollback-approve", {
						approvalId: crypto.randomUUID(),
						deviceId: approvedPlan.deviceId,
						fromManifestDigest: approvedPlan.fromManifestDigest,
						fromReleaseDigest: approvedPlan.fromReleaseDigest,
						planDigest: approvedPlan.digest,
						planExpiresAt: approvedPlan.expiresAt,
						planId: approvedPlan.planId,
						profile: approvedPlan.profile,
						toManifestDigest: approvedPlan.toManifestDigest,
						toReleaseDigest: approvedPlan.toReleaseDigest,
						transitionPlanId: approvedPlan.transitionPlanId
					}), isReleaseRollbackAction, "fleet release rollback result unavailable");
					if (action.planId !== approvedPlan.planId || action.transitionPlanId !== approvedPlan.transitionPlanId) throw new Error("fleet release rollback result does not match the approved plan");
					setRollbackAction(action);
					setRollbackPlan(null);
					setAgentError(null);
					loadAgentTargets();
				} catch (cause) {
					const applyError = cause instanceof Error ? cause.message : String(cause);
					try {
						const action = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "release-rollback-action-status", {
							deviceId: approvedPlan.deviceId,
							planId: approvedPlan.planId
						}), isReleaseRollbackAction, "fleet release rollback status unavailable");
						if (action.planId !== approvedPlan.planId || action.transitionPlanId !== approvedPlan.transitionPlanId) throw new Error("fleet release rollback status does not match the approved plan");
						setRollbackAction(action);
						setRollbackPlan(null);
						setAgentError(null);
						loadAgentTargets();
					} catch {
						setAgentError(applyError);
					}
				} finally {
					agentMutationInFlight.current = false;
					setAgentLoading(false);
				}
			}, [
				ctx,
				loadAgentTargets,
				rollbackArmed,
				rollbackPlan
			]);
			const requestReleaseRetentionPlan = (0, react.useCallback)(async (deviceId) => {
				if (agentMutationInFlight.current) return;
				agentMutationInFlight.current = true;
				setAgentLoading(true);
				setAgentPlan(null);
				setAgentAction(null);
				setRollbackPlan(null);
				setRollbackAction(null);
				setApprovalArmed(false);
				setRollbackArmed(false);
				setReleaseRetentionPlan(null);
				setReleaseRetentionAction(null);
				setReleaseRetentionArmed(false);
				try {
					const next = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "release-retention-plan", { deviceId }), isFleetReleaseRetentionPlan, "fleet release retention plan unavailable");
					if (next.deviceId !== deviceId || Date.parse(next.expiresAt) <= Date.now()) throw new Error("fleet release retention plan does not match the requested target or is expired");
					setReleaseRetentionPlan(next);
					setAgentError(null);
				} catch (cause) {
					setAgentError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					agentMutationInFlight.current = false;
					setAgentLoading(false);
				}
			}, [ctx]);
			const approveReleaseRetentionPlan = (0, react.useCallback)(async () => {
				if (releaseRetentionPlan === null || !releaseRetentionArmed || agentMutationInFlight.current) return;
				agentMutationInFlight.current = true;
				const approvedPlan = releaseRetentionPlan;
				const approvalId = crypto.randomUUID();
				setAgentLoading(true);
				setReleaseRetentionArmed(false);
				try {
					const action = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "release-retention-approve", {
						approvalId,
						deviceId: approvedPlan.deviceId,
						planDigest: approvedPlan.digest,
						planExpiresAt: approvedPlan.expiresAt,
						planId: approvedPlan.planId,
						profile: approvedPlan.profile
					}), isReleaseRetentionAction, "fleet release retention result unavailable");
					if (action.planId !== approvedPlan.planId || action.planDigest !== approvedPlan.digest || action.deviceId !== approvedPlan.deviceId || action.profile !== approvedPlan.profile || action.approvalId !== approvalId) throw new Error("fleet release retention result does not match the approved plan");
					setReleaseRetentionAction(action);
					setReleaseRetentionPlan(null);
					setAgentError(null);
					loadAgentTargets();
				} catch (cause) {
					const applyError = cause instanceof Error ? cause.message : String(cause);
					try {
						const action = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "release-retention-action-status", {
							deviceId: approvedPlan.deviceId,
							planId: approvedPlan.planId
						}), isReleaseRetentionAction, "fleet release retention status unavailable");
						if (action.planId !== approvedPlan.planId || action.planDigest !== approvedPlan.digest || action.deviceId !== approvedPlan.deviceId || action.profile !== approvedPlan.profile || action.approvalId !== approvalId) throw new Error("fleet release retention status does not match the approved plan");
						setReleaseRetentionAction(action);
						setReleaseRetentionPlan(null);
						setAgentError(null);
						loadAgentTargets();
					} catch {
						setAgentError(applyError);
					}
				} finally {
					agentMutationInFlight.current = false;
					setAgentLoading(false);
				}
			}, [
				ctx,
				loadAgentTargets,
				releaseRetentionArmed,
				releaseRetentionPlan
			]);
			const taskCall = (0, react.useCallback)(async (endpoint, override) => {
				const effectiveTarget = override?.targetDeviceId ?? taskTarget;
				const effectiveTaskId = override?.taskId ?? taskId.trim();
				if (taskMutationInFlight.current || effectiveTarget === "") return;
				if (endpoint === "task-submit" && taskId !== "") {
					setTaskError("请先处理或清除当前任务引用");
					return;
				}
				const requestTaskId = endpoint === "task-submit" ? "task:" + crypto.randomUUID() : effectiveTaskId;
				if (!isTaskId(requestTaskId)) {
					setTaskError("请输入有效的 Task ID");
					return;
				}
				const requestTarget = effectiveTarget;
				const requestEpoch = endpoint === "task-submit" ? ++taskEpoch.current : taskEpoch.current;
				const reference = {
					targetDeviceId: requestTarget,
					taskId: requestTaskId
				};
				if (endpoint === "task-submit") {
					setTaskId(requestTaskId);
					setTaskReply(null);
					setTaskCatalogNotice(null);
				}
				writeStoredTaskReference(reference);
				taskMutationInFlight.current = true;
				setTaskLoading(true);
				try {
					const payload = endpoint === "task-submit" ? {
						...reference,
						workspaceId: taskWorkspace,
						profile: taskProfile,
						policyId: taskPolicy,
						prompt: taskPrompt.trim()
					} : reference;
					const nextReply = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, endpoint, payload), isFleetTaskReply, "fleet task response unavailable");
					if (nextReply.taskId !== requestTaskId) throw new Error("fleet task response does not match the requested task");
					if (taskEpoch.current !== requestEpoch) return;
					taskPollFailures.current = 0;
					setTaskReply(nextReply);
					setTaskId(nextReply.taskId);
					setTaskError(null);
					const nextState = nextReply.response.kind === "task.progress" || nextReply.response.kind === "task.result" ? nextReply.response.payload.state : void 0;
					if (endpoint !== "task-status" || nextState === "succeeded" || nextState === "failed" || nextState === "cancelled") loadTaskCatalog(requestTarget, true);
				} catch (cause) {
					if (taskEpoch.current !== requestEpoch) return;
					if (endpoint === "task-status") taskPollFailures.current = Math.min(taskPollFailures.current + 1, 4);
					setTaskError(cause instanceof Error ? cause.message : String(cause));
					if (endpoint === "task-submit") loadTaskCatalog(requestTarget, true);
				} finally {
					taskMutationInFlight.current = false;
					setTaskLoading(false);
				}
			}, [
				ctx,
				loadTaskCatalog,
				taskId,
				taskPolicy,
				taskProfile,
				taskPrompt,
				taskTarget,
				taskWorkspace
			]);
			const decideTaskApproval = (0, react.useCallback)(async (decision) => {
				if (taskMutationInFlight.current || taskReply?.response.kind !== "task.approval.request" || taskTarget === "" || !isTaskId(taskId)) return;
				const request = taskReply.response;
				const requestTarget = taskTarget;
				const requestTaskId = taskId;
				const requestEpoch = taskEpoch.current;
				taskMutationInFlight.current = true;
				setTaskLoading(true);
				let refresh = false;
				try {
					if (rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "task-approval-decision", {
						targetDeviceId: requestTarget,
						taskId: requestTaskId,
						request,
						decision
					}), isApprovalDecisionReply, "fleet task approval receipt unavailable").taskId !== requestTaskId || taskEpoch.current !== requestEpoch || taskTarget !== requestTarget || taskId !== requestTaskId) return;
					setTaskReply(null);
					setTaskError(null);
					refresh = true;
				} catch (cause) {
					if (taskEpoch.current === requestEpoch) setTaskError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					taskMutationInFlight.current = false;
					if (taskEpoch.current === requestEpoch) setTaskLoading(false);
				}
				if (refresh && taskEpoch.current === requestEpoch) taskCall("task-status", {
					targetDeviceId: requestTarget,
					taskId: requestTaskId
				});
			}, [
				ctx,
				taskCall,
				taskId,
				taskReply,
				taskTarget
			]);
			const acknowledgeFederation = (0, react.useCallback)(async (item, disposition) => {
				if (federationMutationInFlight.current || item.acknowledgement !== null) return;
				federationMutationInFlight.current = true;
				const requestEpoch = ++federationEpoch.current;
				setFederationLoading(true);
				setFederationNotice(null);
				let refresh = false;
				try {
					const envelope = item.record.envelope;
					const ack = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "ack", {
						disposition,
						messageId: envelope.messageId,
						payloadDigest: envelope.payloadDigest
					}), isFederationAcknowledgement, "federation acknowledgement unavailable");
					if (ack.acknowledgement.messageId !== envelope.messageId || ack.acknowledgement.payloadDigest !== envelope.payloadDigest) throw new Error("federation acknowledgement does not match the selected message");
					if (federationEpoch.current !== requestEpoch) return;
					setFederationNotice(disposition === "acknowledged" ? "消息已确认；首次处置为最终结果。" : "消息已忽略；首次处置为最终结果。");
					setFederationError(null);
					refresh = true;
				} catch (cause) {
					if (federationEpoch.current === requestEpoch) setFederationError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					federationMutationInFlight.current = false;
					if (federationEpoch.current === requestEpoch) setFederationLoading(false);
				}
				if (refresh && federationEpoch.current === requestEpoch) await loadFederationInbox();
			}, [ctx, loadFederationInbox]);
			const importFederation = (0, react.useCallback)(async () => {
				if (federationMutationInFlight.current) return;
				let envelope;
				try {
					const parsed = JSON.parse(federationImportJson);
					if (!isFederationEnvelope(parsed)) throw new Error("粘贴内容不是受支持的严格 Federation Envelope");
					envelope = parsed;
				} catch (cause) {
					setFederationError(cause instanceof Error ? cause.message : String(cause));
					return;
				}
				federationMutationInFlight.current = true;
				const requestEpoch = ++federationEpoch.current;
				setFederationLoading(true);
				setFederationNotice(null);
				let refresh = false;
				try {
					const receipt = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "import", { envelope }), isFederationEnvelope, "signed federation receipt unavailable");
					const expectedStatus = envelope.kind === "handoff" ? "stored" : "accepted";
					if (receipt.kind !== "receipt" || receipt.payload.requestMessageId !== envelope.messageId || receipt.payload.status !== expectedStatus) throw new Error("signed federation receipt does not match the imported message");
					if (federationEpoch.current !== requestEpoch) return;
					setFederationOutput(JSON.stringify(receipt, null, 2));
					setFederationImportJson("");
					setFederationNotice(envelope.kind === "handoff" ? "已验证并保存；下面仅返回签名 receipt。" : "已验证并接收；下面仅返回签名 receipt。");
					setFederationError(null);
					refresh = true;
				} catch (cause) {
					if (federationEpoch.current === requestEpoch) setFederationError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					federationMutationInFlight.current = false;
					if (federationEpoch.current === requestEpoch) setFederationLoading(false);
				}
				if (refresh && federationEpoch.current === requestEpoch) await loadFederationInbox();
			}, [
				ctx,
				federationImportJson,
				loadFederationInbox
			]);
			const exportFederation = (0, react.useCallback)(async () => {
				if (federationMutationInFlight.current) return;
				const recipientTeamId = federationRecipientTeam.trim();
				const recipientDeviceId = federationRecipientDevice.trim();
				const summary = federationSummary.trim();
				const requestTaskId = federationTaskId.trim();
				if (!FEDERATION_IDENTIFIER_PATTERN.test(recipientTeamId) || !FEDERATION_IDENTIFIER_PATTERN.test(recipientDeviceId) || summary === "" || (federationExportKind === "approval.request" ? !isTaskId(requestTaskId) : requestTaskId !== "" && !isTaskId(requestTaskId))) {
					setFederationError("请填写有效的对方 Team/Device、摘要和 Task ID");
					return;
				}
				const refs = federationArtifactRefs.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
				if (refs.length > 32 || refs.some((value) => value.length > 512 || /[\r\n\0]/.test(value))) {
					setFederationError("artifactRefs 最多 32 行，每行不超过 512 字符");
					return;
				}
				federationMutationInFlight.current = true;
				const requestEpoch = ++federationEpoch.current;
				setFederationLoading(true);
				setFederationNotice(null);
				try {
					const endpoint = federationExportKind === "handoff" ? "handoff-export" : "approval-request-export";
					const payload = federationExportKind === "handoff" ? {
						recipientTeamId,
						recipientDeviceId,
						handoffId: "handoff:" + crypto.randomUUID(),
						taskId: requestTaskId === "" ? null : requestTaskId,
						summary,
						artifactRefs: refs
					} : {
						recipientTeamId,
						recipientDeviceId,
						approvalId: "approval:" + crypto.randomUUID(),
						taskId: requestTaskId,
						summary,
						expiresAt: new Date(Date.now() + 9e5).toISOString()
					};
					const envelope = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, endpoint, payload), isFederationEnvelope, "signed federation export unavailable");
					if (envelope.kind !== federationExportKind || envelope.recipient.teamId !== recipientTeamId || envelope.recipient.deviceId !== recipientDeviceId) throw new Error("signed federation export does not match the form");
					if (federationEpoch.current !== requestEpoch) return;
					setFederationOutput(JSON.stringify(envelope, null, 2));
					setFederationError(null);
					setFederationNotice("签名 Envelope 已生成；请人工复制给对方。");
				} catch (cause) {
					if (federationEpoch.current === requestEpoch) setFederationError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					federationMutationInFlight.current = false;
					if (federationEpoch.current === requestEpoch) setFederationLoading(false);
				}
			}, [
				ctx,
				federationArtifactRefs,
				federationExportKind,
				federationRecipientDevice,
				federationRecipientTeam,
				federationSummary,
				federationTaskId
			]);
			const decideFederationApproval = (0, react.useCallback)(async (item, decision) => {
				if (federationMutationInFlight.current || item.record.envelope.kind !== "approval.request" || item.expired) return;
				federationMutationInFlight.current = true;
				const requestEpoch = ++federationEpoch.current;
				setFederationLoading(true);
				setFederationNotice(null);
				try {
					const envelope = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "approval-decision-export", {
						request: item.record.envelope,
						decision
					}), isFederationEnvelope, "signed federation approval decision unavailable");
					if (envelope.kind !== "approval.decision" || envelope.recipient.teamId !== item.record.envelope.teamId || envelope.recipient.deviceId !== item.record.envelope.sender.deviceId || envelope.payload.approvalRequestMessageId !== item.record.envelope.messageId || envelope.payload.approvalRequestPayloadDigest !== item.record.envelope.payloadDigest || envelope.payload.decision !== decision) throw new Error("signed federation approval decision does not match the incoming request");
					if (federationEpoch.current !== requestEpoch) return;
					setFederationOutput(JSON.stringify(envelope, null, 2));
					setFederationError(null);
					setFederationNotice(decision === "endorsed" ? "背书 Envelope 已生成；它不授予任务工具权限。" : "拒绝 Envelope 已生成。");
				} catch (cause) {
					if (federationEpoch.current === requestEpoch) setFederationError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					federationMutationInFlight.current = false;
					if (federationEpoch.current === requestEpoch) setFederationLoading(false);
				}
			}, [ctx]);
			const planFederationRetention = (0, react.useCallback)(async () => {
				if (federationMutationInFlight.current) return;
				federationMutationInFlight.current = true;
				const requestEpoch = ++federationEpoch.current;
				setFederationLoading(true);
				setFederationNotice(null);
				try {
					const plan = rpcValue(await ctx.connection.rpc.call(AGENT_CHANNEL, "retention-plan", null), isFederationRetentionPlan, "federation retention plan unavailable");
					if (federationEpoch.current !== requestEpoch) return;
					setFederationRetention(plan);
					setFederationError(null);
					setFederationNotice("保留计划只读生成，没有删除任何消息。");
				} catch (cause) {
					if (federationEpoch.current === requestEpoch) setFederationError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					federationMutationInFlight.current = false;
					if (federationEpoch.current === requestEpoch) setFederationLoading(false);
				}
			}, [ctx]);
			(0, react.useEffect)(() => {
				loadStatus();
				const timer = window.setInterval(() => {
					if (!document.hidden) loadStatus();
				}, 3e4);
				return () => window.clearInterval(timer);
			}, [loadStatus]);
			(0, react.useEffect)(() => {
				if (initialTaskReference === null || restoredTaskChecked.current) return;
				restoredTaskChecked.current = true;
				taskCall("task-status");
			}, [initialTaskReference, taskCall]);
			(0, react.useEffect)(() => {
				if (tab !== "updates" || updates !== null || updateError !== null || updateLoading) return;
				loadUpdates("if-stale");
			}, [
				loadUpdates,
				tab,
				updateError,
				updateLoading,
				updates
			]);
			(0, react.useEffect)(() => {
				if (tab !== "operations" && tab !== "tasks" || agentTargets !== null || agentError !== null || agentLoading) return;
				loadAgentTargets();
			}, [
				agentError,
				agentLoading,
				agentTargets,
				loadAgentTargets,
				tab
			]);
			(0, react.useEffect)(() => {
				if (tab !== "federation" || federationItems !== null || federationError !== null || federationLoading) return;
				loadFederationInbox();
			}, [
				federationError,
				federationItems,
				federationLoading,
				loadFederationInbox,
				tab
			]);
			(0, react.useEffect)(() => {
				if (tab === "operations") return;
				setApprovalArmed(false);
				setRollbackArmed(false);
				setReleaseRetentionArmed(false);
			}, [tab]);
			(0, react.useEffect)(() => {
				if (agentTargets === null) return;
				const available = agentTargets.targets.flatMap((target) => {
					const inspection = target.inspection;
					return target.online && inspection !== void 0 && "kind" in inspection && inspection.kind === "profile-release" ? [{
						deviceId: target.deviceId,
						tasks: inspection.tasks
					}] : [];
				});
				const selected = taskTarget === "" ? available.find((target) => target.tasks.enabled) ?? available[0] : available.find((target) => target.deviceId === taskTarget);
				if (selected === void 0) return;
				if (taskTarget !== selected.deviceId) {
					taskEpoch.current += 1;
					taskCatalogEpoch.current += 1;
					setTaskTarget(selected.deviceId);
					setTaskCatalog(null);
					setTaskCatalogTarget("");
					setTaskCatalogError(null);
					setTaskCatalogNotice(null);
					setTaskCatalogLoading(false);
					setTaskPruneArmed(false);
				}
				if (!selected.tasks.workspaceIds.includes(taskWorkspace)) setTaskWorkspace(selected.tasks.workspaceIds[0] ?? "");
				if (!selected.tasks.profiles.includes(taskProfile)) setTaskProfile(selected.tasks.profiles[0] ?? "");
				if (!selected.tasks.policies.some((policy) => policy.policyId === taskPolicy)) setTaskPolicy(selected.tasks.policies.find((policy) => policy.policyId === "readonly-v1")?.policyId ?? selected.tasks.policies[0]?.policyId ?? "");
			}, [
				agentTargets,
				taskPolicy,
				taskProfile,
				taskTarget,
				taskWorkspace
			]);
			(0, react.useEffect)(() => {
				if (tab !== "tasks" || taskTarget === "" || taskCatalogTarget === taskTarget || taskCatalogLoading) return;
				loadTaskCatalog(taskTarget);
			}, [
				loadTaskCatalog,
				tab,
				taskCatalogLoading,
				taskCatalogTarget,
				taskTarget
			]);
			(0, react.useEffect)(() => {
				const state = taskReply !== null && (taskReply.response.kind === "task.progress" || taskReply.response.kind === "task.result") ? taskReply.response.payload.state : void 0;
				if (taskLoading || taskTarget === "" || !isTaskId(taskId) || state !== "accepted" && state !== "running" && state !== "cancel-requested") return;
				let cancelled = false;
				let timer;
				const delay = Math.min(2e3 * 2 ** taskPollFailures.current, 3e4);
				const schedule = () => {
					timer = setTimeout(async () => {
						if (cancelled) return;
						if (!document.hidden) await taskCall("task-status");
						if (!cancelled) schedule();
					}, delay);
				};
				schedule();
				return () => {
					cancelled = true;
					if (timer !== void 0) clearTimeout(timer);
				};
			}, [
				taskCall,
				taskError,
				taskId,
				taskLoading,
				taskReply,
				taskTarget
			]);
			const driftIssues = (0, react.useMemo)(() => status === null ? 0 : status.summary.missing + status.summary.drifted + status.summary.failed + status.summary.unmanaged, [status]);
			const availableUpdates = updates?.snapshot?.summary.available ?? 0;
			const updateFailures = updates?.snapshot?.summary.errors ?? 0;
			const runtimeFailures = status?.runtime.failedModules.length ?? 0;
			const tone = statusError !== null || status?.manifest.loaded === false || (status?.summary.failed ?? 0) > 0 || runtimeFailures > 0 || updateError !== null || updateFailures > 0 || agentError !== null || federationError !== null || agentAction?.state === "manual-intervention" || rollbackAction?.state === "manual-intervention" ? SM.bad : driftIssues > 0 || availableUpdates > 0 || updates?.stale === true ? SM.warn : status === null ? SM.fg3 : SM.good;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				"aria-label": "DSH Fleet",
				"data-dsh-fleet-settings": true,
				style: {
					width: "100%",
					height: "100%",
					maxWidth: 960,
					minWidth: 0,
					minHeight: 0,
					display: "flex",
					boxSizing: "border-box",
					overflow: "hidden",
					fontFamily: SM.fontSans,
					fontSize: 12,
					color: SM.fg,
					border: `1px solid ${SM.border}`,
					borderRadius: 18,
					background: SM.bg
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-dsh-fleet-panel": true,
					style: {
						width: "100%",
						height: "100%",
						minWidth: 0,
						minHeight: 0,
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
						background: SM.bg
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "14px 16px 11px",
							background: SM.panel,
							borderBottom: `1px solid ${SM.border}`
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 8
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										display: "grid",
										placeItems: "center",
										color: SM.fg2
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FleetIcon, {})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, {
									color: tone,
									size: 8
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										flex: 1,
										minWidth: 0
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
										style: {
											display: "block",
											fontSize: 15
										},
										children: "DSH Fleet"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { color: SM.fg3 },
										children: "设备、Profile Release 与远程执行"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"aria-label": "刷新状态",
									title: "刷新状态",
									onClick: () => void loadStatus(),
									disabled: statusLoading,
									style: {
										width: 30,
										height: 30,
										display: "grid",
										placeItems: "center",
										border: 0,
										borderRadius: 10,
										background: SM.panelSoft,
										color: statusLoading ? SM.fg3 : SM.fg2,
										cursor: statusLoading ? "default" : "pointer"
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RefreshIcon, {})
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							"data-dsh-fleet-tabs": true,
							role: "tablist",
							"aria-label": "Fleet 视图",
							style: {
								display: "grid",
								gridTemplateColumns: "repeat(auto-fit, minmax(min(48px, 100%), 1fr))",
								gap: 4,
								marginTop: 9,
								padding: 3,
								borderRadius: 12,
								background: SM.bg2
							},
							children: [
								"status",
								"updates",
								"operations",
								"tasks",
								"federation"
							].map((key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "tab",
								"aria-selected": tab === key,
								onClick: () => setTab(key),
								style: {
									minWidth: 0,
									minHeight: 28,
									padding: "0 3px",
									border: 0,
									borderRadius: 9,
									background: tab === key ? SM.fg : "transparent",
									color: tab === key ? SM.panel : SM.fg2,
									cursor: "pointer",
									fontFamily: SM.fontSans,
									fontSize: 11,
									whiteSpace: "normal",
									overflowWrap: "anywhere"
								},
								children: key === "status" ? "状态" : key === "updates" ? `更新${availableUpdates > 0 ? ` ${availableUpdates}` : ""}` : key === "operations" ? "发布" : key === "tasks" ? "任务" : "协作"
							}, key))
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-dsh-fleet-scroll": true,
						style: {
							flex: 1,
							minHeight: 0,
							paddingTop: 10,
							overflowY: "auto",
							overscrollBehavior: "contain",
							background: SM.bg
						},
						children: tab === "status" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusView, {
							status,
							error: statusError
						}) : tab === "updates" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UpdatesView, {
							updates,
							loading: updateLoading,
							error: updateError,
							onRefresh: () => void loadUpdates("force")
						}) : tab === "operations" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OperationsView, {
							targets: agentTargets,
							plan: agentPlan,
							action: agentAction,
							rollbackPlan,
							rollbackAction,
							retentionPlan: releaseRetentionPlan,
							retentionAction: releaseRetentionAction,
							loading: agentLoading,
							error: agentError,
							armed: approvalArmed,
							rollbackArmed,
							retentionArmed: releaseRetentionArmed,
							onArm: setApprovalArmed,
							onRollbackArm: setRollbackArmed,
							onRetentionArm: setReleaseRetentionArmed,
							onReload: () => {
								setApprovalArmed(false);
								setRollbackArmed(false);
								setReleaseRetentionArmed(false);
								setRollbackPlan(null);
								setReleaseRetentionPlan(null);
								setAgentTargets(null);
								setAgentError(null);
								loadAgentTargets();
							},
							onPlan: (deviceId, pluginId) => void requestPlan(deviceId, pluginId),
							onApprove: () => void approvePlan(),
							onRollbackPlan: (deviceId, transitionPlanId) => void requestRollbackPlan(deviceId, transitionPlanId),
							onRollbackApprove: () => void approveRollbackPlan(),
							onRetentionPlan: (deviceId) => void requestReleaseRetentionPlan(deviceId),
							onRetentionApprove: () => void approveReleaseRetentionPlan()
						}) : tab === "tasks" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TasksView, {
							targets: agentTargets,
							targetDeviceId: taskTarget,
							workspaceId: taskWorkspace,
							profile: taskProfile,
							policyId: taskPolicy,
							prompt: taskPrompt,
							taskId,
							reply: taskReply,
							catalog: taskCatalogTarget === taskTarget ? taskCatalog : null,
							catalogLoading: taskCatalogLoading,
							catalogError: taskCatalogTarget === taskTarget ? taskCatalogError : null,
							catalogNotice: taskCatalogNotice,
							pruneArmed: taskPruneArmed,
							loading: taskLoading || agentLoading,
							error: taskError ?? agentError,
							onTarget: (value) => {
								taskEpoch.current += 1;
								taskCatalogEpoch.current += 1;
								taskPollFailures.current = 0;
								setTaskTarget(value);
								setTaskPolicy("");
								setTaskReply(null);
								setTaskId("");
								setTaskError(null);
								setTaskCatalog(null);
								setTaskCatalogTarget("");
								setTaskCatalogError(null);
								setTaskCatalogNotice(null);
								setTaskCatalogLoading(false);
								setTaskPruneArmed(false);
								clearStoredTaskReference();
							},
							onWorkspace: setTaskWorkspace,
							onProfile: setTaskProfile,
							onPolicy: setTaskPolicy,
							onPrompt: setTaskPrompt,
							onTaskId: (value) => {
								taskEpoch.current += 1;
								taskPollFailures.current = 0;
								setTaskId(value);
								setTaskReply(null);
								setTaskError(null);
								clearStoredTaskReference();
							},
							onClear: () => {
								taskEpoch.current += 1;
								taskPollFailures.current = 0;
								setTaskId("");
								setTaskReply(null);
								setTaskError(null);
								clearStoredTaskReference();
							},
							onSubmit: () => void taskCall("task-submit"),
							onStatus: () => void taskCall("task-status"),
							onCancel: () => void taskCall("task-cancel"),
							onApprovalDecision: (decision) => void decideTaskApproval(decision),
							onReloadTargets: () => {
								taskCatalogEpoch.current += 1;
								setAgentTargets(null);
								setAgentError(null);
								setTaskCatalog(null);
								setTaskCatalogTarget("");
								setTaskCatalogError(null);
								setTaskCatalogNotice(null);
								setTaskCatalogLoading(false);
								setTaskPruneArmed(false);
								loadAgentTargets();
							},
							onRefreshCatalog: () => {
								setTaskPruneArmed(false);
								taskCatalogEpoch.current += 1;
								setTaskCatalogTarget("");
								setTaskCatalogError(null);
								setTaskCatalogNotice(null);
								loadTaskCatalog(taskTarget, true);
							},
							onTrack: (task) => {
								taskEpoch.current += 1;
								taskPollFailures.current = 0;
								const reference = {
									targetDeviceId: task.targetDeviceId,
									taskId: task.taskId
								};
								setTaskTarget(reference.targetDeviceId);
								setTaskId(reference.taskId);
								setTaskReply(null);
								setTaskError(null);
								writeStoredTaskReference(reference);
								taskCall("task-status", reference);
							},
							onResume: () => void resumeTasks(),
							onArmPrune: () => setTaskPruneArmed(true),
							onPrune: () => void pruneTaskCatalog()
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CollaborationView, {
							items: federationItems,
							loading: federationLoading,
							error: federationError,
							notice: federationNotice,
							retention: federationRetention,
							importJson: federationImportJson,
							exportKind: federationExportKind,
							recipientTeamId: federationRecipientTeam,
							recipientDeviceId: federationRecipientDevice,
							summary: federationSummary,
							taskId: federationTaskId,
							artifactRefs: federationArtifactRefs,
							output: federationOutput,
							onImportJson: (value) => {
								setFederationImportJson(value);
								setFederationError(null);
							},
							onExportKind: (value) => {
								setFederationExportKind(value);
								setFederationOutput("");
								setFederationError(null);
							},
							onRecipientTeamId: (value) => {
								setFederationRecipientTeam(value);
								setFederationOutput("");
								setFederationError(null);
							},
							onRecipientDeviceId: (value) => {
								setFederationRecipientDevice(value);
								setFederationOutput("");
								setFederationError(null);
							},
							onSummary: (value) => {
								setFederationSummary(value);
								setFederationOutput("");
								setFederationError(null);
							},
							onTaskId: (value) => {
								setFederationTaskId(value);
								setFederationOutput("");
								setFederationError(null);
							},
							onArtifactRefs: (value) => {
								setFederationArtifactRefs(value);
								setFederationOutput("");
								setFederationError(null);
							},
							onReload: () => {
								setFederationRetention(null);
								setFederationNotice(null);
								loadFederationInbox();
							},
							onImport: () => void importFederation(),
							onExport: () => void exportFederation(),
							onAcknowledge: (item, disposition) => void acknowledgeFederation(item, disposition),
							onDecision: (item, decision) => void decideFederationApproval(item, decision),
							onRetentionPlan: () => void planFederationRetention()
						})
					})]
				})
			});
		}
		function FleetCard({ ctx }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FleetSettings, { ctx });
		}
		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-fleet",
				order: 65,
				label: "Fleet"
			}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FleetSettings, { ctx })));
		}
		//#endregion
		exports.FleetCard = FleetCard;
		exports.FleetSettings = FleetSettings;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map