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
		const colors = {
			aligned: "#16a34a",
			missing: "#dc2626",
			"spec-drift": "#d97706",
			"runtime-failed": "#dc2626",
			"runtime-inactive": "#d97706"
		};
		function stateLabel(state) {
			if (state === "aligned") return "一致";
			if (state === "missing") return "缺失";
			if (state === "spec-drift") return "版本漂移";
			if (state === "runtime-failed") return "加载失败";
			return "未激活";
		}
		function FleetCard({ ctx }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [status, setStatus] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(false);
			const load = (0, react.useCallback)(async () => {
				if (loading) return;
				setLoading(true);
				try {
					const result = await ctx.connection.rpc.call(CHANNEL, "status", null);
					if (!result.ok || result.value === void 0) throw new Error(result.error?.message ?? "fleet status unavailable");
					setStatus(result.value);
					setError(null);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setLoading(false);
				}
			}, [ctx, loading]);
			(0, react.useEffect)(() => {
				load();
				const timer = window.setInterval(() => {
					if (!document.hidden) load();
				}, 3e4);
				return () => window.clearInterval(timer);
			}, []);
			const issues = (0, react.useMemo)(() => status === null ? 0 : status.summary.missing + status.summary.drifted + status.summary.failed + status.summary.unmanaged, [status]);
			const tone = error !== null || status?.manifest.loaded === false ? "#dc2626" : issues > 0 ? "#d97706" : "#16a34a";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					position: "fixed",
					left: 16,
					bottom: 16,
					zIndex: 950,
					pointerEvents: "auto",
					fontFamily: "-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif",
					fontSize: 12,
					color: "#202124"
				},
				children: [open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						width: 360,
						maxHeight: "62vh",
						overflow: "auto",
						marginBottom: 8,
						border: "1px solid rgba(0,0,0,.12)",
						borderRadius: 12,
						background: "#fff",
						boxShadow: "0 8px 28px rgba(0,0,0,.16)",
						padding: 12
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 8,
								marginBottom: 10
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: {
									flex: 1,
									fontSize: 14
								},
								children: "DSH Fleet"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => void load(),
								disabled: loading,
								style: {
									border: 0,
									borderRadius: 7,
									padding: "5px 8px",
									cursor: "pointer"
								},
								children: loading ? "检查中…" : "刷新"
							})]
						}),
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								color: "#dc2626",
								marginBottom: 8
							},
							children: error
						}),
						status !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "grid",
									gridTemplateColumns: "82px 1fr",
									gap: "4px 8px",
									color: "#596069",
									marginBottom: 10
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "设备" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [status.device.id, status.device.registered ? "" : "（未登记）"] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "设备类型" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: status.device.class ?? "—" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "通道" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: status.device.channel ?? "—" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "DSH" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										status.dsh.version ?? "未知",
										" · ",
										status.dsh.profile
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "清单" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { color: status.manifest.loaded ? "#16a34a" : "#dc2626" },
										children: status.manifest.loaded ? status.manifest.teamId : status.manifest.error
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									padding: 8,
									borderRadius: 8,
									background: "#f5f6f7",
									marginBottom: 8
								},
								children: [
									"期望 ",
									status.summary.desired,
									" · 一致 ",
									status.summary.aligned,
									" · 缺失 ",
									status.summary.missing,
									" · 漂移 ",
									status.summary.drifted,
									" · 失败 ",
									status.summary.failed,
									" · 未管理 ",
									status.summary.unmanaged
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: 5
								},
								children: [status.plugins.map((plugin) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "grid",
										gridTemplateColumns: "8px minmax(0,1fr) auto",
										alignItems: "center",
										gap: 7,
										padding: "6px 4px",
										borderBottom: "1px solid rgba(0,0,0,.06)"
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
											width: 7,
											height: 7,
											borderRadius: 99,
											background: colors[plugin.state]
										} }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												minWidth: 0,
												overflow: "hidden",
												textOverflow: "ellipsis"
											},
											title: plugin.id,
											children: plugin.id
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: { color: colors[plugin.state] },
											children: stateLabel(plugin.state)
										})
									]
								}, plugin.id)), status.unmanaged.map((plugin) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "grid",
										gridTemplateColumns: "8px minmax(0,1fr) auto",
										alignItems: "center",
										gap: 7,
										padding: "6px 4px"
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
											width: 7,
											height: 7,
											borderRadius: 99,
											background: "#64748b"
										} }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												minWidth: 0,
												overflow: "hidden",
												textOverflow: "ellipsis"
											},
											children: plugin.id
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: { color: "#64748b" },
											children: "未管理"
										})
									]
								}, "unmanaged:" + plugin.id))]
							})
						] })
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					onClick: () => setOpen((value) => !value),
					style: {
						display: "flex",
						alignItems: "center",
						gap: 7,
						border: "1px solid rgba(0,0,0,.12)",
						borderRadius: 999,
						background: "#fff",
						boxShadow: "0 3px 12px rgba(0,0,0,.12)",
						padding: "7px 11px",
						cursor: "pointer",
						color: "#202124"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
							width: 8,
							height: 8,
							borderRadius: 99,
							background: tone
						} }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Fleet" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { color: "#667085" },
							children: status === null ? "…" : issues === 0 ? "一致" : issues + " 项差异"
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