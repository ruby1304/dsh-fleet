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
		function isAgentTargets(value) {
			if (!isRecord(value) || typeof value.enabled !== "boolean" || !Array.isArray(value.targets)) return false;
			return value.targets.every((target) => {
				if (!isRecord(target) || typeof target.deviceId !== "string" || target.transport !== "local" && target.transport !== "ssh" || typeof target.online !== "boolean") return false;
				if (target.errorCode !== void 0 && typeof target.errorCode !== "string") return false;
				if (target.inspection === void 0) return target.online === false;
				const inspection = target.inspection;
				return isRecord(inspection) && inspection.protocolVersion === 1 && typeof inspection.deviceId === "string" && typeof inspection.profile === "string" && typeof inspection.dshVersion === "string" && typeof inspection.manifestDigest === "string" && typeof inspection.profileHash === "string" && Array.isArray(inspection.candidates) && inspection.candidates.every((candidate) => isRecord(candidate) && typeof candidate.pluginId === "string" && (candidate.action === "install" || candidate.action === "update") && (candidate.fromSpec === null || typeof candidate.fromSpec === "string") && typeof candidate.exactToSpec === "string" && (candidate.sourceKind === "npm" || candidate.sourceKind === "github"));
			});
		}
		function isFleetPlan(value) {
			return isRecord(value) && typeof value.planId === "string" && typeof value.digest === "string" && typeof value.deviceId === "string" && typeof value.profile === "string" && typeof value.pluginId === "string" && (value.action === "install" || value.action === "update") && typeof value.exactToSpec === "string" && typeof value.expiresAt === "string";
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
			return isRecord(value) && typeof value.planId === "string" && typeof value.state === "string" && states.has(value.state) && typeof value.pluginId === "string" && typeof value.updatedAt === "string";
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
			if (item.state === "local") return "本地链接";
			if (item.state === "missing") return "未安装";
			if (item.state === "error") return "检查失败";
			return "不支持检查";
		}
		function sourceLabel(item) {
			if (item.kind === "dsh") return "CORE";
			if (item.source === "github") return "GitHub";
			if (item.source === "npm") return "npm";
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
			if (item.currentVersion !== void 0 && item.state === "local") return `${item.currentVersion} · 实时源码`;
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
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Pill, { children: [snapshot.summary.local, " 个本地"] }),
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
		function OperationsView({ targets, plan, action, loading, error, armed, onArm, onReload, onPlan, onApprove }) {
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
						children: "仅允许清单内的精确版本。每次只处理一个插件，并在目标机快照、重启、健康检查；失败自动回滚。"
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
					targets?.targets.map((target) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											color: SM.fg3,
											fontFamily: SM.fontMono
										},
										children: target.inspection?.dshVersion ?? target.errorCode ?? "离线"
									})
								]
							}),
							target.online && target.inspection?.candidates.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
							target.online && target.inspection?.candidates.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									padding: 10,
									color: SM.good
								},
								children: "该设备已经一致"
							})
						]
					}, target.deviceId)),
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
										children: plan.action === "install" ? "INSTALL" : "UPDATE"
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
									}),
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
									" 执行这一精确计划；失败时自动回滚。"
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
								action.pluginId,
								" · ",
								action.updatedAt.slice(0, 19).replace("T", " ")
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
		function FleetCard({ ctx, wide = true }) {
			const [open, setOpen] = (0, react.useState)(false);
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
			const [agentError, setAgentError] = (0, react.useState)(null);
			const [agentLoading, setAgentLoading] = (0, react.useState)(false);
			const [approvalArmed, setApprovalArmed] = (0, react.useState)(false);
			const statusInFlight = (0, react.useRef)(null);
			const updatesInFlight = (0, react.useRef)(null);
			const agentsInFlight = (0, react.useRef)(null);
			const agentMutationInFlight = (0, react.useRef)(false);
			const rootRef = (0, react.useRef)(null);
			const [panelAnchor, setPanelAnchor] = (0, react.useState)();
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
			const requestPlan = (0, react.useCallback)(async (deviceId, pluginId) => {
				if (agentMutationInFlight.current) return;
				agentMutationInFlight.current = true;
				setAgentLoading(true);
				setAgentPlan(null);
				setAgentAction(null);
				setApprovalArmed(false);
				try {
					const result = await ctx.connection.rpc.call(AGENT_CHANNEL, "plan", {
						deviceId,
						pluginId
					});
					setAgentPlan(rpcValue(result, isFleetPlan, "fleet plan unavailable"));
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
				setAgentLoading(true);
				setApprovalArmed(false);
				try {
					const result = await ctx.connection.rpc.call(AGENT_CHANNEL, "approve", {
						approvalId: crypto.randomUUID(),
						deviceId: approvedPlan.deviceId,
						planDigest: approvedPlan.digest,
						planExpiresAt: approvedPlan.expiresAt,
						planId: approvedPlan.planId,
						profile: approvedPlan.profile
					});
					setAgentAction(rpcValue(result, isAgentAction, "fleet action result unavailable"));
					setAgentPlan(null);
					setAgentError(null);
					loadAgentTargets();
				} catch (cause) {
					const applyError = cause instanceof Error ? cause.message : String(cause);
					try {
						const status = await ctx.connection.rpc.call(AGENT_CHANNEL, "action-status", {
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
			(0, react.useEffect)(() => {
				loadStatus();
				const timer = window.setInterval(() => {
					if (!document.hidden) loadStatus();
				}, 3e4);
				return () => window.clearInterval(timer);
			}, [loadStatus]);
			(0, react.useEffect)(() => {
				if (!open || tab !== "updates" || updates !== null || updateError !== null || updateLoading) return;
				loadUpdates("if-stale");
			}, [
				loadUpdates,
				open,
				tab,
				updateError,
				updateLoading,
				updates
			]);
			(0, react.useEffect)(() => {
				if (!open || tab !== "operations" || agentTargets !== null || agentError !== null || agentLoading) return;
				loadAgentTargets();
			}, [
				agentError,
				agentLoading,
				agentTargets,
				loadAgentTargets,
				open,
				tab
			]);
			(0, react.useLayoutEffect)(() => {
				if (!open) return;
				const place = () => {
					const rect = rootRef.current?.getBoundingClientRect();
					if (rect === void 0 || typeof window.innerWidth !== "number" || typeof window.innerHeight !== "number") return;
					const panelWidth = Math.min(380, window.innerWidth - 24);
					const left = Math.max(12, Math.min(rect.left, window.innerWidth - panelWidth - 12));
					const availableHeight = Math.max(120, rect.top - 20);
					setPanelAnchor({
						left,
						bottom: window.innerHeight - rect.top + 8,
						maxHeight: Math.min(Math.floor(window.innerHeight * .68), availableHeight)
					});
				};
				place();
				if (typeof window.addEventListener !== "function") return;
				window.addEventListener("resize", place);
				return () => window.removeEventListener("resize", place);
			}, [open, wide]);
			(0, react.useEffect)(() => {
				if (!open || typeof document.addEventListener !== "function") return;
				const dismiss = (event) => {
					if (event instanceof KeyboardEvent && event.key === "Escape") {
						setOpen(false);
						return;
					}
					if (event instanceof PointerEvent && rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
				};
				document.addEventListener("pointerdown", dismiss);
				document.addEventListener("keydown", dismiss);
				return () => {
					document.removeEventListener("pointerdown", dismiss);
					document.removeEventListener("keydown", dismiss);
				};
			}, [open]);
			const driftIssues = (0, react.useMemo)(() => status === null ? 0 : status.summary.missing + status.summary.drifted + status.summary.failed + status.summary.unmanaged, [status]);
			const availableUpdates = updates?.snapshot?.summary.available ?? 0;
			const updateFailures = updates?.snapshot?.summary.errors ?? 0;
			const runtimeFailures = status?.runtime.failedModules.length ?? 0;
			const tone = statusError !== null || status?.manifest.loaded === false || (status?.summary.failed ?? 0) > 0 || runtimeFailures > 0 || updateError !== null || updateFailures > 0 || agentError !== null || agentAction?.state === "manual-intervention" ? SM.bad : driftIssues > 0 || availableUpdates > 0 || updates?.stale === true ? SM.warn : status === null ? SM.fg3 : SM.good;
			const closedText = status === null ? statusError === null ? "载入中…" : "状态获取失败" : [
				driftIssues === 0 && runtimeFailures === 0 ? "一致" : driftIssues > 0 ? `${driftIssues} 项差异` : void 0,
				runtimeFailures > 0 ? `Loader ${runtimeFailures} 失败` : void 0,
				updateError !== null || updateFailures > 0 ? "更新检查失败" : availableUpdates > 0 ? `${availableUpdates} 个更新` : void 0
			].filter((value) => value !== void 0).join(" · ");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				"data-dsh-fleet-action": true,
				style: {
					position: "relative",
					display: "flex",
					alignItems: "center",
					flex: "none",
					pointerEvents: "auto",
					width: wide ? "100%" : 36,
					height: wide ? 42 : 36,
					margin: wide ? "8px 0 0" : 0,
					minWidth: 0,
					fontFamily: SM.fontSans,
					fontSize: 12,
					color: SM.fg
				},
				children: [open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					role: "dialog",
					"aria-label": "DSH Fleet",
					"data-dsh-fleet-panel": true,
					style: {
						position: "fixed",
						zIndex: 950,
						left: panelAnchor?.left ?? 12,
						bottom: panelAnchor?.bottom ?? 64,
						width: 380,
						maxWidth: "calc(100vw - 24px)",
						maxHeight: panelAnchor?.maxHeight ?? "68vh",
						overflow: "auto",
						border: `1px solid ${SM.border}`,
						borderRadius: 20,
						background: SM.bg,
						boxShadow: SM.shadowCard
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							position: "sticky",
							top: 0,
							zIndex: 1,
							padding: "11px 12px 9px",
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
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, {
									color: tone,
									size: 8
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									style: {
										flex: 1,
										fontSize: 14
									},
									children: "DSH Fleet"
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
							role: "tablist",
							"aria-label": "Fleet 视图",
							style: {
								display: "flex",
								gap: 4,
								marginTop: 9,
								padding: 3,
								borderRadius: 999,
								background: SM.bg2
							},
							children: [
								"status",
								"updates",
								"operations"
							].map((key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "tab",
								"aria-selected": tab === key,
								onClick: () => setTab(key),
								style: {
									flex: 1,
									minHeight: 28,
									border: 0,
									borderRadius: 999,
									background: tab === key ? SM.fg : "transparent",
									color: tab === key ? SM.panel : SM.fg2,
									cursor: "pointer",
									fontFamily: SM.fontSans,
									fontSize: 11.5
								},
								children: key === "status" ? "状态" : key === "updates" ? `更新${availableUpdates > 0 ? ` ${availableUpdates}` : ""}` : "操作"
							}, key))
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { paddingTop: 10 },
						children: tab === "status" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusView, {
							status,
							error: statusError
						}) : tab === "updates" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UpdatesView, {
							updates,
							loading: updateLoading,
							error: updateError,
							onRefresh: () => void loadUpdates("force")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OperationsView, {
							targets: agentTargets,
							plan: agentPlan,
							action: agentAction,
							loading: agentLoading,
							error: agentError,
							armed: approvalArmed,
							onArm: setApprovalArmed,
							onReload: () => {
								setAgentTargets(null);
								setAgentError(null);
								loadAgentTargets();
							},
							onPlan: (deviceId, pluginId) => void requestPlan(deviceId, pluginId),
							onApprove: () => void approvePlan()
						})
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					"aria-label": `DSH Fleet：${closedText}`,
					title: "DSH Fleet",
					"aria-expanded": open,
					onClick: () => setOpen((value) => !value),
					style: {
						position: "relative",
						display: "flex",
						alignItems: "center",
						justifyContent: wide ? "flex-start" : "center",
						gap: 8,
						width: "100%",
						height: wide ? 42 : 36,
						minWidth: 0,
						border: 0,
						borderRadius: wide ? 12 : 999,
						background: open ? "var(--dsw-alias-interactive-bg-hover, #e6e9ed)" : "transparent",
						padding: wide ? "0 10px 0 8px" : 0,
						cursor: "pointer",
						color: "var(--dsw-alias-label-primary, #181a1c)"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								display: "grid",
								placeItems: "center",
								color: "var(--dsw-alias-label-secondary, #5f6670)"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FleetIcon, {})
						}),
						wide && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { whiteSpace: "nowrap" },
								children: "Fleet"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									minWidth: 0,
									marginLeft: "auto",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									color: SM.fg2,
									fontFamily: SM.fontMono,
									fontSize: 10.5,
									fontVariantNumeric: "tabular-nums"
								},
								children: closedText
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, {
								color: tone,
								size: 7
							})
						] }),
						!wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"aria-hidden": "true",
							style: {
								position: "absolute",
								right: 4,
								bottom: 4
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, {
								color: tone,
								size: 6
							})
						})
					]
				})]
			});
		}
		function apply(ctx) {
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-fleet",
				order: 110,
				label: () => "DSH Fleet"
			}, ({ wide = true }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FleetCard, {
				ctx,
				wide
			})));
		}
		//#endregion
		exports.FleetCard = FleetCard;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map