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
						status.summary.unmanaged
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
		function FleetCard({ ctx }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [tab, setTab] = (0, react.useState)("status");
			const [status, setStatus] = (0, react.useState)(null);
			const [statusError, setStatusError] = (0, react.useState)(null);
			const [statusLoading, setStatusLoading] = (0, react.useState)(false);
			const [updates, setUpdates] = (0, react.useState)(null);
			const [updateError, setUpdateError] = (0, react.useState)(null);
			const [updateLoading, setUpdateLoading] = (0, react.useState)(false);
			const statusInFlight = (0, react.useRef)(null);
			const updatesInFlight = (0, react.useRef)(null);
			const loadStatus = (0, react.useCallback)(async () => {
				if (statusInFlight.current !== null) return statusInFlight.current;
				const request = (async () => {
					setStatusLoading(true);
					try {
						const result = await ctx.connection.rpc.call(CHANNEL, "status", null);
						if (!result.ok || result.value === void 0) throw new Error(result.error?.message ?? "fleet status unavailable");
						setStatus(result.value);
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
						if (!result.ok || result.value === void 0) throw new Error(result.error?.message ?? "update check unavailable");
						setUpdates(result.value);
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
			const driftIssues = (0, react.useMemo)(() => status === null ? 0 : status.summary.missing + status.summary.drifted + status.summary.failed + status.summary.unmanaged, [status]);
			const availableUpdates = updates?.snapshot?.summary.available ?? 0;
			const updateFailures = updates?.snapshot?.summary.errors ?? 0;
			const tone = statusError !== null || status?.manifest.loaded === false || (status?.summary.failed ?? 0) > 0 || updateError !== null || updateFailures > 0 ? SM.bad : driftIssues > 0 || availableUpdates > 0 || updates?.stale === true ? SM.warn : status === null ? SM.fg3 : SM.good;
			const closedText = status === null ? statusError === null ? "载入中…" : "状态获取失败" : [driftIssues === 0 ? "一致" : `${driftIssues} 项差异`, updateError !== null || updateFailures > 0 ? "更新检查失败" : availableUpdates > 0 ? `${availableUpdates} 个更新` : void 0].filter((value) => value !== void 0).join(" · ");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					position: "fixed",
					left: 14,
					bottom: 14,
					zIndex: 950,
					pointerEvents: "auto",
					width: 380,
					maxWidth: "calc(100vw - 28px)",
					fontFamily: SM.fontSans,
					fontSize: 12,
					color: SM.fg
				},
				children: [open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						maxHeight: "68vh",
						overflow: "auto",
						marginBottom: 8,
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
							children: ["status", "updates"].map((key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
								children: key === "status" ? "状态" : `更新${availableUpdates > 0 ? ` ${availableUpdates}` : ""}`
							}, key))
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { paddingTop: 10 },
						children: tab === "status" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusView, {
							status,
							error: statusError
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UpdatesView, {
							updates,
							loading: updateLoading,
							error: updateError,
							onRefresh: () => void loadUpdates("force")
						})
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					"aria-expanded": open,
					onClick: () => setOpen((value) => !value),
					style: {
						display: "flex",
						alignItems: "center",
						gap: 7,
						minHeight: 36,
						border: `1px solid ${SM.borderStrong}`,
						borderRadius: 999,
						background: SM.panel,
						boxShadow: SM.shadowCard,
						padding: "7px 12px",
						cursor: "pointer",
						color: SM.fg
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dot, {
							color: tone,
							size: 8
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Fleet" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								color: SM.fg2,
								fontFamily: SM.fontMono,
								fontVariantNumeric: "tabular-nums"
							},
							children: closedText
						})
					]
				})]
			});
		}
		function apply(ctx) {
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-fleet",
				order: 110,
				label: () => "DSH Fleet"
			}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FleetCard, { ctx })));
		}
		//#endregion
		exports.FleetCard = FleetCard;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map