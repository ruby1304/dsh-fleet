#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { access, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, unlink } from "node:fs/promises";
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
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
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/constants.js
var require_constants = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		MAX_LENGTH: 256,
		MAX_SAFE_COMPONENT_LENGTH: 16,
		MAX_SAFE_BUILD_LENGTH: 250,
		MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER ||
		/* istanbul ignore next */ 9007199254740991,
		RELEASE_TYPES: [
			"major",
			"premajor",
			"minor",
			"preminor",
			"patch",
			"prepatch",
			"prerelease"
		],
		SEMVER_SPEC_VERSION: "2.0.0",
		FLAG_INCLUDE_PRERELEASE: 1,
		FLAG_LOOSE: 2
	};
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/debug.js
var require_debug = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = typeof process === "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...args) => console.error("SEMVER", ...args) : () => {};
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/re.js
var require_re = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const { MAX_SAFE_COMPONENT_LENGTH, MAX_SAFE_BUILD_LENGTH, MAX_LENGTH } = require_constants();
	const debug = require_debug();
	exports = module.exports = {};
	const re = exports.re = [];
	const safeRe = exports.safeRe = [];
	const src = exports.src = [];
	const safeSrc = exports.safeSrc = [];
	const t = exports.t = {};
	let R = 0;
	const LETTERDASHNUMBER = "[a-zA-Z0-9-]";
	const safeRegexReplacements = [
		["\\s", 1],
		["\\d", MAX_LENGTH],
		[LETTERDASHNUMBER, MAX_SAFE_BUILD_LENGTH]
	];
	const makeSafeRegex = (value) => {
		for (const [token, max] of safeRegexReplacements) value = value.split(`${token}*`).join(`${token}{0,${max}}`).split(`${token}+`).join(`${token}{1,${max}}`);
		return value;
	};
	const createToken = (name, value, isGlobal) => {
		const safe = makeSafeRegex(value);
		const index = R++;
		debug(name, index, value);
		t[name] = index;
		src[index] = value;
		safeSrc[index] = safe;
		re[index] = new RegExp(value, isGlobal ? "g" : void 0);
		safeRe[index] = new RegExp(safe, isGlobal ? "g" : void 0);
	};
	createToken("NUMERICIDENTIFIER", "0|[1-9]\\d*");
	createToken("NUMERICIDENTIFIERLOOSE", "\\d+");
	createToken("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`);
	createToken("MAINVERSION", `(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})`);
	createToken("MAINVERSIONLOOSE", `(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})`);
	createToken("PRERELEASEIDENTIFIER", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIER]})`);
	createToken("PRERELEASEIDENTIFIERLOOSE", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIERLOOSE]})`);
	createToken("PRERELEASE", `(?:-(${src[t.PRERELEASEIDENTIFIER]}(?:\\.${src[t.PRERELEASEIDENTIFIER]})*))`);
	createToken("PRERELEASELOOSE", `(?:-?(${src[t.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${src[t.PRERELEASEIDENTIFIERLOOSE]})*))`);
	createToken("BUILDIDENTIFIER", `${LETTERDASHNUMBER}+`);
	createToken("BUILD", `(?:\\+(${src[t.BUILDIDENTIFIER]}(?:\\.${src[t.BUILDIDENTIFIER]})*))`);
	createToken("FULLPLAIN", `v?${src[t.MAINVERSION]}${src[t.PRERELEASE]}?${src[t.BUILD]}?`);
	createToken("FULL", `^${src[t.FULLPLAIN]}$`);
	createToken("LOOSEPLAIN", `[v=\\s]*${src[t.MAINVERSIONLOOSE]}${src[t.PRERELEASELOOSE]}?${src[t.BUILD]}?`);
	createToken("LOOSE", `^${src[t.LOOSEPLAIN]}$`);
	createToken("GTLT", "((?:<|>)?=?)");
	createToken("XRANGEIDENTIFIERLOOSE", `${src[t.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`);
	createToken("XRANGEIDENTIFIER", `${src[t.NUMERICIDENTIFIER]}|x|X|\\*`);
	createToken("XRANGEPLAIN", `[v=\\s]*(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:${src[t.PRERELEASE]})?${src[t.BUILD]}?)?)?`);
	createToken("XRANGEPLAINLOOSE", `[v=\\s]*(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:${src[t.PRERELEASELOOSE]})?${src[t.BUILD]}?)?)?`);
	createToken("XRANGE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAIN]}$`);
	createToken("XRANGELOOSE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAINLOOSE]}$`);
	createToken("COERCEPLAIN", `(^|[^\\d])(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}})(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?`);
	createToken("COERCE", `${src[t.COERCEPLAIN]}(?:$|[^\\d])`);
	createToken("COERCEFULL", src[t.COERCEPLAIN] + `(?:${src[t.PRERELEASE]})?(?:${src[t.BUILD]})?(?:$|[^\\d])`);
	createToken("COERCERTL", src[t.COERCE], true);
	createToken("COERCERTLFULL", src[t.COERCEFULL], true);
	createToken("LONETILDE", "(?:~>?)");
	createToken("TILDETRIM", `(\\s*)${src[t.LONETILDE]}\\s+`, true);
	exports.tildeTrimReplace = "$1~";
	createToken("TILDE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAIN]}$`);
	createToken("TILDELOOSE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAINLOOSE]}$`);
	createToken("LONECARET", "(?:\\^)");
	createToken("CARETTRIM", `(\\s*)${src[t.LONECARET]}\\s+`, true);
	exports.caretTrimReplace = "$1^";
	createToken("CARET", `^${src[t.LONECARET]}${src[t.XRANGEPLAIN]}$`);
	createToken("CARETLOOSE", `^${src[t.LONECARET]}${src[t.XRANGEPLAINLOOSE]}$`);
	createToken("COMPARATORLOOSE", `^${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]})$|^$`);
	createToken("COMPARATOR", `^${src[t.GTLT]}\\s*(${src[t.FULLPLAIN]})$|^$`);
	createToken("COMPARATORTRIM", `(\\s*)${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]}|${src[t.XRANGEPLAIN]})`, true);
	exports.comparatorTrimReplace = "$1$2$3";
	createToken("HYPHENRANGE", `^\\s*(${src[t.XRANGEPLAIN]})\\s+-\\s+(${src[t.XRANGEPLAIN]})\\s*$`);
	createToken("HYPHENRANGELOOSE", `^\\s*(${src[t.XRANGEPLAINLOOSE]})\\s+-\\s+(${src[t.XRANGEPLAINLOOSE]})\\s*$`);
	createToken("STAR", "(<|>)?=?\\s*\\*");
	createToken("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$");
	createToken("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/parse-options.js
var require_parse_options = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const looseOption = Object.freeze({ loose: true });
	const emptyOpts = Object.freeze({});
	const parseOptions = (options) => {
		if (!options) return emptyOpts;
		if (typeof options !== "object") return looseOption;
		return options;
	};
	module.exports = parseOptions;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/identifiers.js
var require_identifiers = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const numeric = /^[0-9]+$/;
	const compareIdentifiers = (a, b) => {
		if (typeof a === "number" && typeof b === "number") return a === b ? 0 : a < b ? -1 : 1;
		const anum = numeric.test(a);
		const bnum = numeric.test(b);
		if (anum && bnum) {
			a = +a;
			b = +b;
		}
		return a === b ? 0 : anum && !bnum ? -1 : bnum && !anum ? 1 : a < b ? -1 : 1;
	};
	const rcompareIdentifiers = (a, b) => compareIdentifiers(b, a);
	module.exports = {
		compareIdentifiers,
		rcompareIdentifiers
	};
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/classes/semver.js
var require_semver$1 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const debug = require_debug();
	const { MAX_LENGTH, MAX_SAFE_INTEGER } = require_constants();
	const { safeRe: re, t } = require_re();
	const parseOptions = require_parse_options();
	const { compareIdentifiers } = require_identifiers();
	const isPrereleaseIdentifier = (prerelease, identifier) => {
		const identifiers = identifier.split(".");
		if (identifiers.length > prerelease.length) return false;
		for (let i = 0; i < identifiers.length; i++) if (compareIdentifiers(prerelease[i], identifiers[i]) !== 0) return false;
		return true;
	};
	module.exports = class SemVer {
		constructor(version, options) {
			options = parseOptions(options);
			if (version instanceof SemVer) {
				if (version.loose === !!options.loose && version.includePrerelease === !!options.includePrerelease) return version;
				else version = version.version;
			} else if (typeof version !== "string") throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version}".`);
			if (version.length > MAX_LENGTH) throw new TypeError(`version is longer than ${MAX_LENGTH} characters`);
			debug("SemVer", version, options);
			this.options = options;
			this.loose = !!options.loose;
			this.includePrerelease = !!options.includePrerelease;
			const m = version.trim().match(options.loose ? re[t.LOOSE] : re[t.FULL]);
			if (!m) throw new TypeError(`Invalid Version: ${version}`);
			this.raw = version;
			this.major = +m[1];
			this.minor = +m[2];
			this.patch = +m[3];
			if (this.major > MAX_SAFE_INTEGER || this.major < 0) throw new TypeError("Invalid major version");
			if (this.minor > MAX_SAFE_INTEGER || this.minor < 0) throw new TypeError("Invalid minor version");
			if (this.patch > MAX_SAFE_INTEGER || this.patch < 0) throw new TypeError("Invalid patch version");
			if (!m[4]) this.prerelease = [];
			else this.prerelease = m[4].split(".").map((id) => {
				if (/^[0-9]+$/.test(id)) {
					const num = +id;
					if (num >= 0 && num < MAX_SAFE_INTEGER) return num;
				}
				return id;
			});
			this.build = m[5] ? m[5].split(".") : [];
			this.format();
		}
		format() {
			this.version = `${this.major}.${this.minor}.${this.patch}`;
			if (this.prerelease.length) this.version += `-${this.prerelease.join(".")}`;
			return this.version;
		}
		toString() {
			return this.version;
		}
		compare(other) {
			debug("SemVer.compare", this.version, this.options, other);
			if (!(other instanceof SemVer)) {
				if (typeof other === "string" && other === this.version) return 0;
				other = new SemVer(other, this.options);
			}
			if (other.version === this.version) return 0;
			return this.compareMain(other) || this.comparePre(other);
		}
		compareMain(other) {
			if (!(other instanceof SemVer)) other = new SemVer(other, this.options);
			if (this.major < other.major) return -1;
			if (this.major > other.major) return 1;
			if (this.minor < other.minor) return -1;
			if (this.minor > other.minor) return 1;
			if (this.patch < other.patch) return -1;
			if (this.patch > other.patch) return 1;
			return 0;
		}
		comparePre(other) {
			if (!(other instanceof SemVer)) other = new SemVer(other, this.options);
			if (this.prerelease.length && !other.prerelease.length) return -1;
			else if (!this.prerelease.length && other.prerelease.length) return 1;
			else if (!this.prerelease.length && !other.prerelease.length) return 0;
			let i = 0;
			do {
				const a = this.prerelease[i];
				const b = other.prerelease[i];
				debug("prerelease compare", i, a, b);
				if (a === void 0 && b === void 0) return 0;
				else if (b === void 0) return 1;
				else if (a === void 0) return -1;
				else if (a === b) continue;
				else return compareIdentifiers(a, b);
			} while (++i);
		}
		compareBuild(other) {
			if (!(other instanceof SemVer)) other = new SemVer(other, this.options);
			let i = 0;
			do {
				const a = this.build[i];
				const b = other.build[i];
				debug("build compare", i, a, b);
				if (a === void 0 && b === void 0) return 0;
				else if (b === void 0) return 1;
				else if (a === void 0) return -1;
				else if (a === b) continue;
				else return compareIdentifiers(a, b);
			} while (++i);
		}
		inc(release, identifier, identifierBase) {
			if (release.startsWith("pre")) {
				if (!identifier && identifierBase === false) throw new Error("invalid increment argument: identifier is empty");
				if (identifier) {
					const match = `-${identifier}`.match(this.options.loose ? re[t.PRERELEASELOOSE] : re[t.PRERELEASE]);
					if (!match || match[1] !== identifier) throw new Error(`invalid identifier: ${identifier}`);
				}
			}
			switch (release) {
				case "premajor":
					this.prerelease.length = 0;
					this.patch = 0;
					this.minor = 0;
					this.major++;
					this.inc("pre", identifier, identifierBase);
					break;
				case "preminor":
					this.prerelease.length = 0;
					this.patch = 0;
					this.minor++;
					this.inc("pre", identifier, identifierBase);
					break;
				case "prepatch":
					this.prerelease.length = 0;
					this.inc("patch", identifier, identifierBase);
					this.inc("pre", identifier, identifierBase);
					break;
				case "prerelease":
					if (this.prerelease.length === 0) this.inc("patch", identifier, identifierBase);
					this.inc("pre", identifier, identifierBase);
					break;
				case "release":
					if (this.prerelease.length === 0) throw new Error(`version ${this.raw} is not a prerelease`);
					this.prerelease.length = 0;
					break;
				case "major":
					if (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) this.major++;
					this.minor = 0;
					this.patch = 0;
					this.prerelease = [];
					break;
				case "minor":
					if (this.patch !== 0 || this.prerelease.length === 0) this.minor++;
					this.patch = 0;
					this.prerelease = [];
					break;
				case "patch":
					if (this.prerelease.length === 0) this.patch++;
					this.prerelease = [];
					break;
				case "pre": {
					const base = Number(identifierBase) ? 1 : 0;
					if (this.prerelease.length === 0) this.prerelease = [base];
					else {
						let i = this.prerelease.length;
						while (--i >= 0) if (typeof this.prerelease[i] === "number") {
							this.prerelease[i]++;
							i = -2;
						}
						if (i === -1) {
							if (identifier === this.prerelease.join(".") && identifierBase === false) throw new Error("invalid increment argument: identifier already exists");
							this.prerelease.push(base);
						}
					}
					if (identifier) {
						let prerelease = [identifier, base];
						if (identifierBase === false) prerelease = [identifier];
						if (isPrereleaseIdentifier(this.prerelease, identifier)) {
							const prereleaseBase = this.prerelease[identifier.split(".").length];
							if (isNaN(prereleaseBase)) this.prerelease = prerelease;
						} else this.prerelease = prerelease;
					}
					break;
				}
				default: throw new Error(`invalid increment argument: ${release}`);
			}
			this.raw = this.format();
			if (this.build.length) this.raw += `+${this.build.join(".")}`;
			return this;
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/parse.js
var require_parse = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const SemVer = require_semver$1();
	const parse = (version, options, throwErrors = false) => {
		if (version instanceof SemVer) return version;
		try {
			return new SemVer(version, options);
		} catch (er) {
			if (!throwErrors) return null;
			throw er;
		}
	};
	module.exports = parse;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/valid.js
var require_valid$1 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const parse = require_parse();
	const valid = (version, options) => {
		const v = parse(version, options);
		return v ? v.version : null;
	};
	module.exports = valid;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/clean.js
var require_clean = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const parse = require_parse();
	const clean = (version, options) => {
		const s = parse(version.trim().replace(/^[=v]+/, ""), options);
		return s ? s.version : null;
	};
	module.exports = clean;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/inc.js
var require_inc = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const SemVer = require_semver$1();
	const inc = (version, release, options, identifier, identifierBase) => {
		if (typeof options === "string") {
			identifierBase = identifier;
			identifier = options;
			options = void 0;
		}
		try {
			return new SemVer(version instanceof SemVer ? version.version : version, options).inc(release, identifier, identifierBase).version;
		} catch (er) {
			return null;
		}
	};
	module.exports = inc;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/diff.js
var require_diff = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const parse = require_parse();
	const diff = (version1, version2) => {
		const v1 = parse(version1, null, true);
		const v2 = parse(version2, null, true);
		const comparison = v1.compare(v2);
		if (comparison === 0) return null;
		const v1Higher = comparison > 0;
		const highVersion = v1Higher ? v1 : v2;
		const lowVersion = v1Higher ? v2 : v1;
		const highHasPre = !!highVersion.prerelease.length;
		if (!!lowVersion.prerelease.length && !highHasPre) {
			if (!lowVersion.patch && !lowVersion.minor) return "major";
			if (lowVersion.compareMain(highVersion) === 0) {
				if (lowVersion.minor && !lowVersion.patch) return "minor";
				return "patch";
			}
		}
		const prefix = highHasPre ? "pre" : "";
		if (v1.major !== v2.major) return prefix + "major";
		if (v1.minor !== v2.minor) return prefix + "minor";
		if (v1.patch !== v2.patch) return prefix + "patch";
		return "prerelease";
	};
	module.exports = diff;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/major.js
var require_major = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const SemVer = require_semver$1();
	const major = (a, loose) => new SemVer(a, loose).major;
	module.exports = major;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/minor.js
var require_minor = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const SemVer = require_semver$1();
	const minor = (a, loose) => new SemVer(a, loose).minor;
	module.exports = minor;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/patch.js
var require_patch = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const SemVer = require_semver$1();
	const patch = (a, loose) => new SemVer(a, loose).patch;
	module.exports = patch;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/prerelease.js
var require_prerelease = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const parse = require_parse();
	const prerelease = (version, options) => {
		const parsed = parse(version, options);
		return parsed && parsed.prerelease.length ? parsed.prerelease : null;
	};
	module.exports = prerelease;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/compare.js
var require_compare = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const SemVer = require_semver$1();
	const compare = (a, b, loose) => new SemVer(a, loose).compare(new SemVer(b, loose));
	module.exports = compare;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/rcompare.js
var require_rcompare = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const compare = require_compare();
	const rcompare = (a, b, loose) => compare(b, a, loose);
	module.exports = rcompare;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/compare-loose.js
var require_compare_loose = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const compare = require_compare();
	const compareLoose = (a, b) => compare(a, b, true);
	module.exports = compareLoose;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/compare-build.js
var require_compare_build = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const SemVer = require_semver$1();
	const compareBuild = (a, b, loose) => {
		const versionA = new SemVer(a, loose);
		const versionB = new SemVer(b, loose);
		return versionA.compare(versionB) || versionA.compareBuild(versionB);
	};
	module.exports = compareBuild;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/sort.js
var require_sort = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const compareBuild = require_compare_build();
	const sort = (list, loose) => list.sort((a, b) => compareBuild(a, b, loose));
	module.exports = sort;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/rsort.js
var require_rsort = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const compareBuild = require_compare_build();
	const rsort = (list, loose) => list.sort((a, b) => compareBuild(b, a, loose));
	module.exports = rsort;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/gt.js
var require_gt = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const compare = require_compare();
	const gt = (a, b, loose) => compare(a, b, loose) > 0;
	module.exports = gt;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/lt.js
var require_lt = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const compare = require_compare();
	const lt = (a, b, loose) => compare(a, b, loose) < 0;
	module.exports = lt;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/eq.js
var require_eq = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const compare = require_compare();
	const eq = (a, b, loose) => compare(a, b, loose) === 0;
	module.exports = eq;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/neq.js
var require_neq = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const compare = require_compare();
	const neq = (a, b, loose) => compare(a, b, loose) !== 0;
	module.exports = neq;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/gte.js
var require_gte = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const compare = require_compare();
	const gte = (a, b, loose) => compare(a, b, loose) >= 0;
	module.exports = gte;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/lte.js
var require_lte = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const compare = require_compare();
	const lte = (a, b, loose) => compare(a, b, loose) <= 0;
	module.exports = lte;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/cmp.js
var require_cmp = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const eq = require_eq();
	const neq = require_neq();
	const gt = require_gt();
	const gte = require_gte();
	const lt = require_lt();
	const lte = require_lte();
	const cmp = (a, op, b, loose) => {
		switch (op) {
			case "===":
				if (typeof a === "object") a = a.version;
				if (typeof b === "object") b = b.version;
				return a === b;
			case "!==":
				if (typeof a === "object") a = a.version;
				if (typeof b === "object") b = b.version;
				return a !== b;
			case "":
			case "=":
			case "==": return eq(a, b, loose);
			case "!=": return neq(a, b, loose);
			case ">": return gt(a, b, loose);
			case ">=": return gte(a, b, loose);
			case "<": return lt(a, b, loose);
			case "<=": return lte(a, b, loose);
			default: throw new TypeError(`Invalid operator: ${op}`);
		}
	};
	module.exports = cmp;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/coerce.js
var require_coerce = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const SemVer = require_semver$1();
	const parse = require_parse();
	const { safeRe: re, t } = require_re();
	const coerce = (version, options) => {
		if (version instanceof SemVer) return version;
		if (typeof version === "number") version = String(version);
		if (typeof version !== "string") return null;
		options = options || {};
		let match = null;
		if (!options.rtl) match = version.match(options.includePrerelease ? re[t.COERCEFULL] : re[t.COERCE]);
		else {
			const coerceRtlRegex = options.includePrerelease ? re[t.COERCERTLFULL] : re[t.COERCERTL];
			let next;
			while ((next = coerceRtlRegex.exec(version)) && (!match || match.index + match[0].length !== version.length)) {
				if (!match || next.index + next[0].length !== match.index + match[0].length) match = next;
				coerceRtlRegex.lastIndex = next.index + next[1].length + next[2].length;
			}
			coerceRtlRegex.lastIndex = -1;
		}
		if (match === null) return null;
		const major = match[2];
		const minor = match[3] || "0";
		const patch = match[4] || "0";
		const prerelease = options.includePrerelease && match[5] ? `-${match[5]}` : "";
		const build = options.includePrerelease && match[6] ? `+${match[6]}` : "";
		return parse(`${major}.${minor}.${patch}${prerelease}${build}`, options);
	};
	module.exports = coerce;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/truncate.js
var require_truncate = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const parse = require_parse();
	const constants = require_constants();
	const SemVer = require_semver$1();
	const truncate = (version, truncation, options) => {
		if (!constants.RELEASE_TYPES.includes(truncation)) return null;
		const clonedVersion = cloneInputVersion(version, options);
		return clonedVersion && doTruncation(clonedVersion, truncation);
	};
	const cloneInputVersion = (version, options) => {
		const versionStringToParse = version instanceof SemVer ? version.version : version;
		return parse(versionStringToParse, options);
	};
	const doTruncation = (version, truncation) => {
		if (isPrerelease(truncation)) return version.version;
		version.prerelease = [];
		switch (truncation) {
			case "major":
				version.minor = 0;
				version.patch = 0;
				break;
			case "minor": version.patch = 0;
		}
		return version.format();
	};
	const isPrerelease = (type) => {
		return type.startsWith("pre");
	};
	module.exports = truncate;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/internal/lrucache.js
var require_lrucache = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var LRUCache = class {
		constructor() {
			this.max = 1e3;
			this.map = /* @__PURE__ */ new Map();
		}
		get(key) {
			const value = this.map.get(key);
			if (value === void 0) return;
			else {
				this.map.delete(key);
				this.map.set(key, value);
				return value;
			}
		}
		delete(key) {
			return this.map.delete(key);
		}
		set(key, value) {
			if (!this.delete(key) && value !== void 0) {
				if (this.map.size >= this.max) {
					const firstKey = this.map.keys().next().value;
					this.delete(firstKey);
				}
				this.map.set(key, value);
			}
			return this;
		}
	};
	module.exports = LRUCache;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/classes/range.js
var require_range = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const SPACE_CHARACTERS = /\s+/g;
	module.exports = class Range {
		constructor(range, options) {
			options = parseOptions(options);
			if (range instanceof Range) {
				if (range.loose === !!options.loose && range.includePrerelease === !!options.includePrerelease) return range;
				else return new Range(range.raw, options);
			}
			if (range instanceof Comparator) {
				this.raw = range.value;
				this.set = [[range]];
				this.formatted = void 0;
				return this;
			}
			this.options = options;
			this.loose = !!options.loose;
			this.includePrerelease = !!options.includePrerelease;
			this.raw = range.trim().replace(SPACE_CHARACTERS, " ");
			this.set = this.raw.split("||").map((r) => this.parseRange(r.trim())).filter((c) => c.length);
			if (!this.set.length) throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
			if (this.set.length > 1) {
				const first = this.set[0];
				this.set = this.set.filter((c) => !isNullSet(c[0]));
				if (this.set.length === 0) this.set = [first];
				else if (this.set.length > 1) {
					for (const c of this.set) if (c.length === 1 && isAny(c[0])) {
						this.set = [c];
						break;
					}
				}
			}
			this.formatted = void 0;
		}
		get range() {
			if (this.formatted === void 0) {
				this.formatted = "";
				for (let i = 0; i < this.set.length; i++) {
					if (i > 0) this.formatted += "||";
					const comps = this.set[i];
					for (let k = 0; k < comps.length; k++) {
						if (k > 0) this.formatted += " ";
						this.formatted += comps[k].toString().trim();
					}
				}
			}
			return this.formatted;
		}
		format() {
			return this.range;
		}
		toString() {
			return this.range;
		}
		parseRange(range) {
			range = range.replace(BUILDSTRIPRE, "");
			const memoKey = ((this.options.includePrerelease && FLAG_INCLUDE_PRERELEASE) | (this.options.loose && FLAG_LOOSE)) + ":" + range;
			const cached = cache.get(memoKey);
			if (cached) return cached;
			const loose = this.options.loose;
			const hr = loose ? re[t.HYPHENRANGELOOSE] : re[t.HYPHENRANGE];
			range = range.replace(hr, hyphenReplace(this.options.includePrerelease));
			debug("hyphen replace", range);
			range = range.replace(re[t.COMPARATORTRIM], comparatorTrimReplace);
			debug("comparator trim", range);
			range = range.replace(re[t.TILDETRIM], tildeTrimReplace);
			debug("tilde trim", range);
			range = range.replace(re[t.CARETTRIM], caretTrimReplace);
			debug("caret trim", range);
			let rangeList = range.split(" ").map((comp) => parseComparator(comp, this.options)).join(" ").split(/\s+/).map((comp) => replaceGTE0(comp, this.options));
			if (loose) rangeList = rangeList.filter((comp) => {
				debug("loose invalid filter", comp, this.options);
				return !!comp.match(re[t.COMPARATORLOOSE]);
			});
			debug("range list", rangeList);
			const rangeMap = /* @__PURE__ */ new Map();
			const comparators = rangeList.map((comp) => new Comparator(comp, this.options));
			for (const comp of comparators) {
				if (isNullSet(comp)) return [comp];
				rangeMap.set(comp.value, comp);
			}
			if (rangeMap.size > 1 && rangeMap.has("")) rangeMap.delete("");
			const result = [...rangeMap.values()];
			cache.set(memoKey, result);
			return result;
		}
		intersects(range, options) {
			if (!(range instanceof Range)) throw new TypeError("a Range is required");
			return this.set.some((thisComparators) => {
				return isSatisfiable(thisComparators, options) && range.set.some((rangeComparators) => {
					return isSatisfiable(rangeComparators, options) && thisComparators.every((thisComparator) => {
						return rangeComparators.every((rangeComparator) => {
							return thisComparator.intersects(rangeComparator, options);
						});
					});
				});
			});
		}
		test(version) {
			if (!version) return false;
			if (typeof version === "string") try {
				version = new SemVer(version, this.options);
			} catch (er) {
				return false;
			}
			for (let i = 0; i < this.set.length; i++) if (testSet(this.set[i], version, this.options)) return true;
			return false;
		}
	};
	const cache = new (require_lrucache())();
	const parseOptions = require_parse_options();
	const Comparator = require_comparator();
	const debug = require_debug();
	const SemVer = require_semver$1();
	const { safeRe: re, src, t, comparatorTrimReplace, tildeTrimReplace, caretTrimReplace } = require_re();
	const { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } = require_constants();
	const BUILDSTRIPRE = new RegExp(src[t.BUILD], "g");
	const isNullSet = (c) => c.value === "<0.0.0-0";
	const isAny = (c) => c.value === "";
	const isSatisfiable = (comparators, options) => {
		let result = true;
		const remainingComparators = comparators.slice();
		let testComparator = remainingComparators.pop();
		while (result && remainingComparators.length) {
			result = remainingComparators.every((otherComparator) => {
				return testComparator.intersects(otherComparator, options);
			});
			testComparator = remainingComparators.pop();
		}
		return result;
	};
	const parseComparator = (comp, options) => {
		comp = comp.replace(re[t.BUILD], "");
		debug("comp", comp, options);
		comp = replaceCarets(comp, options);
		debug("caret", comp);
		comp = replaceTildes(comp, options);
		debug("tildes", comp);
		comp = replaceXRanges(comp, options);
		debug("xrange", comp);
		comp = replaceStars(comp, options);
		debug("stars", comp);
		return comp;
	};
	const isX = (id) => !id || id.toLowerCase() === "x" || id === "*";
	const invalidXRangeOrder = (M, m, p) => isX(M) && !isX(m) || isX(m) && p && !isX(p);
	const replaceTildes = (comp, options) => {
		return comp.trim().split(/\s+/).map((c) => replaceTilde(c, options)).join(" ");
	};
	const replaceTilde = (comp, options) => {
		const r = options.loose ? re[t.TILDELOOSE] : re[t.TILDE];
		const z = options.includePrerelease ? "-0" : "";
		return comp.replace(r, (_, M, m, p, pr) => {
			debug("tilde", comp, _, M, m, p, pr);
			let ret;
			if (isX(M)) ret = "";
			else if (isX(m)) ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
			else if (isX(p)) ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
			else if (pr) {
				debug("replaceTilde pr", pr);
				ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
			} else ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
			debug("tilde return", ret);
			return ret;
		});
	};
	const replaceCarets = (comp, options) => {
		return comp.trim().split(/\s+/).map((c) => replaceCaret(c, options)).join(" ");
	};
	const replaceCaret = (comp, options) => {
		debug("caret", comp, options);
		const r = options.loose ? re[t.CARETLOOSE] : re[t.CARET];
		const z = options.includePrerelease ? "-0" : "";
		return comp.replace(r, (_, M, m, p, pr) => {
			debug("caret", comp, _, M, m, p, pr);
			let ret;
			if (isX(M)) ret = "";
			else if (isX(m)) ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
			else if (isX(p)) {
				if (M === "0") ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
				else ret = `>=${M}.${m}.0${z} <${+M + 1}.0.0-0`;
			} else if (pr) {
				debug("replaceCaret pr", pr);
				if (M === "0") {
					if (m === "0") ret = `>=${M}.${m}.${p}-${pr} <${M}.${m}.${+p + 1}-0`;
					else ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
				} else ret = `>=${M}.${m}.${p}-${pr} <${+M + 1}.0.0-0`;
			} else {
				debug("no pr");
				if (M === "0") {
					if (m === "0") ret = `>=${M}.${m}.${p} <${M}.${m}.${+p + 1}-0`;
					else ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
				} else ret = `>=${M}.${m}.${p} <${+M + 1}.0.0-0`;
			}
			debug("caret return", ret);
			return ret;
		});
	};
	const replaceXRanges = (comp, options) => {
		debug("replaceXRanges", comp, options);
		return comp.split(/\s+/).map((c) => replaceXRange(c, options)).join(" ");
	};
	const replaceXRange = (comp, options) => {
		comp = comp.trim();
		const r = options.loose ? re[t.XRANGELOOSE] : re[t.XRANGE];
		return comp.replace(r, (ret, gtlt, M, m, p, pr) => {
			debug("xRange", comp, ret, gtlt, M, m, p, pr);
			if (invalidXRangeOrder(M, m, p)) return comp;
			const xM = isX(M);
			const xm = xM || isX(m);
			const xp = xm || isX(p);
			const anyX = xp;
			if (gtlt === "=" && anyX) gtlt = "";
			pr = options.includePrerelease ? "-0" : "";
			if (xM) {
				if (gtlt === ">" || gtlt === "<") ret = "<0.0.0-0";
				else ret = "*";
			} else if (gtlt && anyX) {
				if (xm) m = 0;
				p = 0;
				if (gtlt === ">") {
					gtlt = ">=";
					if (xm) {
						M = +M + 1;
						m = 0;
						p = 0;
					} else {
						m = +m + 1;
						p = 0;
					}
				} else if (gtlt === "<=") {
					gtlt = "<";
					if (xm) M = +M + 1;
					else m = +m + 1;
				}
				if (gtlt === "<") pr = "-0";
				ret = `${gtlt + M}.${m}.${p}${pr}`;
			} else if (xm) ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
			else if (xp) ret = `>=${M}.${m}.0${pr} <${M}.${+m + 1}.0-0`;
			debug("xRange return", ret);
			return ret;
		});
	};
	const replaceStars = (comp, options) => {
		debug("replaceStars", comp, options);
		return comp.trim().replace(re[t.STAR], "");
	};
	const replaceGTE0 = (comp, options) => {
		debug("replaceGTE0", comp, options);
		return comp.trim().replace(re[options.includePrerelease ? t.GTE0PRE : t.GTE0], "");
	};
	const hyphenReplace = (incPr) => ($0, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr) => {
		if (isX(fM)) from = "";
		else if (isX(fm)) from = `>=${fM}.0.0${incPr ? "-0" : ""}`;
		else if (isX(fp)) from = `>=${fM}.${fm}.0${incPr ? "-0" : ""}`;
		else if (fpr) from = `>=${from}`;
		else from = `>=${from}${incPr ? "-0" : ""}`;
		if (isX(tM)) to = "";
		else if (isX(tm)) to = `<${+tM + 1}.0.0-0`;
		else if (isX(tp)) to = `<${tM}.${+tm + 1}.0-0`;
		else if (tpr) to = `<=${tM}.${tm}.${tp}-${tpr}`;
		else if (incPr) to = `<${tM}.${tm}.${+tp + 1}-0`;
		else to = `<=${to}`;
		return `${from} ${to}`.trim();
	};
	const testSet = (set, version, options) => {
		for (let i = 0; i < set.length; i++) if (!set[i].test(version)) return false;
		if (version.prerelease.length && !options.includePrerelease) {
			for (let i = 0; i < set.length; i++) {
				debug(set[i].semver);
				if (set[i].semver === Comparator.ANY) continue;
				if (set[i].semver.prerelease.length > 0) {
					const allowed = set[i].semver;
					if (allowed.major === version.major && allowed.minor === version.minor && allowed.patch === version.patch) return true;
				}
			}
			return false;
		}
		return true;
	};
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/classes/comparator.js
var require_comparator = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const ANY = Symbol("SemVer ANY");
	module.exports = class Comparator {
		static get ANY() {
			return ANY;
		}
		constructor(comp, options) {
			options = parseOptions(options);
			if (comp instanceof Comparator) {
				if (comp.loose === !!options.loose) return comp;
				else comp = comp.value;
			}
			comp = comp.trim().split(/\s+/).join(" ");
			debug("comparator", comp, options);
			this.options = options;
			this.loose = !!options.loose;
			this.parse(comp);
			if (this.semver === ANY) this.value = "";
			else this.value = this.operator + this.semver.version;
			debug("comp", this);
		}
		parse(comp) {
			const r = this.options.loose ? re[t.COMPARATORLOOSE] : re[t.COMPARATOR];
			const m = comp.match(r);
			if (!m) throw new TypeError(`Invalid comparator: ${comp}`);
			this.operator = m[1] !== void 0 ? m[1] : "";
			if (this.operator === "=") this.operator = "";
			if (!m[2]) this.semver = ANY;
			else this.semver = new SemVer(m[2], this.options.loose);
		}
		toString() {
			return this.value;
		}
		test(version) {
			debug("Comparator.test", version, this.options.loose);
			if (this.semver === ANY || version === ANY) return true;
			if (typeof version === "string") try {
				version = new SemVer(version, this.options);
			} catch (er) {
				return false;
			}
			return cmp(version, this.operator, this.semver, this.options);
		}
		intersects(comp, options) {
			if (!(comp instanceof Comparator)) throw new TypeError("a Comparator is required");
			if (this.operator === "") {
				if (this.value === "") return true;
				return new Range(comp.value, options).test(this.value);
			} else if (comp.operator === "") {
				if (comp.value === "") return true;
				return new Range(this.value, options).test(comp.semver);
			}
			options = parseOptions(options);
			if (options.includePrerelease && (this.value === "<0.0.0-0" || comp.value === "<0.0.0-0")) return false;
			if (!options.includePrerelease && (this.value.startsWith("<0.0.0") || comp.value.startsWith("<0.0.0"))) return false;
			if (this.operator.startsWith(">") && comp.operator.startsWith(">")) return true;
			if (this.operator.startsWith("<") && comp.operator.startsWith("<")) return true;
			if (this.semver.version === comp.semver.version && this.operator.includes("=") && comp.operator.includes("=")) return true;
			if (cmp(this.semver, "<", comp.semver, options) && this.operator.startsWith(">") && comp.operator.startsWith("<")) return true;
			if (cmp(this.semver, ">", comp.semver, options) && this.operator.startsWith("<") && comp.operator.startsWith(">")) return true;
			return false;
		}
	};
	const parseOptions = require_parse_options();
	const { safeRe: re, t } = require_re();
	const cmp = require_cmp();
	const debug = require_debug();
	const SemVer = require_semver$1();
	const Range = require_range();
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/functions/satisfies.js
var require_satisfies = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const Range = require_range();
	const satisfies = (version, range, options) => {
		try {
			range = new Range(range, options);
		} catch (er) {
			return false;
		}
		return range.test(version);
	};
	module.exports = satisfies;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/to-comparators.js
var require_to_comparators = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const Range = require_range();
	const toComparators = (range, options) => new Range(range, options).set.map((comp) => comp.map((c) => c.value).join(" ").trim().split(" "));
	module.exports = toComparators;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/max-satisfying.js
var require_max_satisfying = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const SemVer = require_semver$1();
	const Range = require_range();
	const maxSatisfying = (versions, range, options) => {
		let max = null;
		let maxSV = null;
		let rangeObj = null;
		try {
			rangeObj = new Range(range, options);
		} catch (er) {
			return null;
		}
		versions.forEach((v) => {
			if (rangeObj.test(v)) {
				if (!max || maxSV.compare(v) === -1) {
					max = v;
					maxSV = new SemVer(max, options);
				}
			}
		});
		return max;
	};
	module.exports = maxSatisfying;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/min-satisfying.js
var require_min_satisfying = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const SemVer = require_semver$1();
	const Range = require_range();
	const minSatisfying = (versions, range, options) => {
		let min = null;
		let minSV = null;
		let rangeObj = null;
		try {
			rangeObj = new Range(range, options);
		} catch (er) {
			return null;
		}
		versions.forEach((v) => {
			if (rangeObj.test(v)) {
				if (!min || minSV.compare(v) === 1) {
					min = v;
					minSV = new SemVer(min, options);
				}
			}
		});
		return min;
	};
	module.exports = minSatisfying;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/min-version.js
var require_min_version = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const SemVer = require_semver$1();
	const Range = require_range();
	const gt = require_gt();
	const minVersion = (range, loose) => {
		range = new Range(range, loose);
		let minver = new SemVer("0.0.0");
		if (range.test(minver)) return minver;
		minver = new SemVer("0.0.0-0");
		if (range.test(minver)) return minver;
		minver = null;
		for (let i = 0; i < range.set.length; ++i) {
			const comparators = range.set[i];
			let setMin = null;
			comparators.forEach((comparator) => {
				const compver = new SemVer(comparator.semver.version);
				switch (comparator.operator) {
					case ">":
						if (compver.prerelease.length === 0) compver.patch++;
						else compver.prerelease.push(0);
						compver.raw = compver.format();
					case "":
					case ">=":
						if (!setMin || gt(compver, setMin)) setMin = compver;
						break;
					case "<":
					case "<=": break;
					/* istanbul ignore next */
					default: throw new Error(`Unexpected operation: ${comparator.operator}`);
				}
			});
			if (setMin && (!minver || gt(minver, setMin))) minver = setMin;
		}
		if (minver && range.test(minver)) return minver;
		return null;
	};
	module.exports = minVersion;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/valid.js
var require_valid = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const Range = require_range();
	const validRange = (range, options) => {
		try {
			return new Range(range, options).range || "*";
		} catch (er) {
			return null;
		}
	};
	module.exports = validRange;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/outside.js
var require_outside = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const SemVer = require_semver$1();
	const Comparator = require_comparator();
	const { ANY } = Comparator;
	const Range = require_range();
	const satisfies = require_satisfies();
	const gt = require_gt();
	const lt = require_lt();
	const lte = require_lte();
	const gte = require_gte();
	const outside = (version, range, hilo, options) => {
		version = new SemVer(version, options);
		range = new Range(range, options);
		let gtfn, ltefn, ltfn, comp, ecomp;
		switch (hilo) {
			case ">":
				gtfn = gt;
				ltefn = lte;
				ltfn = lt;
				comp = ">";
				ecomp = ">=";
				break;
			case "<":
				gtfn = lt;
				ltefn = gte;
				ltfn = gt;
				comp = "<";
				ecomp = "<=";
				break;
			default: throw new TypeError("Must provide a hilo val of \"<\" or \">\"");
		}
		if (satisfies(version, range, options)) return false;
		for (let i = 0; i < range.set.length; ++i) {
			const comparators = range.set[i];
			let high = null;
			let low = null;
			comparators.forEach((comparator) => {
				if (comparator.semver === ANY) comparator = new Comparator(">=0.0.0");
				high = high || comparator;
				low = low || comparator;
				if (gtfn(comparator.semver, high.semver, options)) high = comparator;
				else if (ltfn(comparator.semver, low.semver, options)) low = comparator;
			});
			if (high.operator === comp || high.operator === ecomp) return false;
			if ((!low.operator || low.operator === comp) && ltefn(version, low.semver)) return false;
			else if (low.operator === ecomp && ltfn(version, low.semver)) return false;
		}
		return true;
	};
	module.exports = outside;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/gtr.js
var require_gtr = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const outside = require_outside();
	const gtr = (version, range, options) => outside(version, range, ">", options);
	module.exports = gtr;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/ltr.js
var require_ltr = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const outside = require_outside();
	const ltr = (version, range, options) => outside(version, range, "<", options);
	module.exports = ltr;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/intersects.js
var require_intersects = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const Range = require_range();
	const intersects = (r1, r2, options) => {
		r1 = new Range(r1, options);
		r2 = new Range(r2, options);
		return r1.intersects(r2, options);
	};
	module.exports = intersects;
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/simplify.js
var require_simplify = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const satisfies = require_satisfies();
	const compare = require_compare();
	module.exports = (versions, range, options) => {
		const set = [];
		let first = null;
		let prev = null;
		const v = versions.sort((a, b) => compare(a, b, options));
		for (const version of v) if (satisfies(version, range, options)) {
			prev = version;
			if (!first) first = version;
		} else {
			if (prev) set.push([first, prev]);
			prev = null;
			first = null;
		}
		if (first) set.push([first, null]);
		const ranges = [];
		for (const [min, max] of set) if (min === max) ranges.push(min);
		else if (!max && min === v[0]) ranges.push("*");
		else if (!max) ranges.push(`>=${min}`);
		else if (min === v[0]) ranges.push(`<=${max}`);
		else ranges.push(`${min} - ${max}`);
		const simplified = ranges.join(" || ");
		const original = typeof range.raw === "string" ? range.raw : String(range);
		return simplified.length < original.length ? simplified : range;
	};
}));
//#endregion
//#region node_modules/.pnpm/semver@7.8.5/node_modules/semver/ranges/subset.js
var require_subset = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const Range = require_range();
	const Comparator = require_comparator();
	const { ANY } = Comparator;
	const satisfies = require_satisfies();
	const compare = require_compare();
	const subset = (sub, dom, options = {}) => {
		if (sub === dom) return true;
		sub = new Range(sub, options);
		dom = new Range(dom, options);
		let sawNonNull = false;
		OUTER: for (const simpleSub of sub.set) {
			for (const simpleDom of dom.set) {
				const isSub = simpleSubset(simpleSub, simpleDom, options);
				sawNonNull = sawNonNull || isSub !== null;
				if (isSub) continue OUTER;
			}
			if (sawNonNull) return false;
		}
		return true;
	};
	const minimumVersionWithPreRelease = [new Comparator(">=0.0.0-0")];
	const minimumVersion = [new Comparator(">=0.0.0")];
	const simpleSubset = (sub, dom, options) => {
		if (sub === dom) return true;
		if (sub.length === 1 && sub[0].semver === ANY) {
			if (dom.length === 1 && dom[0].semver === ANY) return true;
			else if (options.includePrerelease) sub = minimumVersionWithPreRelease;
			else sub = minimumVersion;
		}
		if (dom.length === 1 && dom[0].semver === ANY) {
			if (options.includePrerelease) return true;
			else dom = minimumVersion;
		}
		const eqSet = /* @__PURE__ */ new Set();
		let gt, lt;
		for (const c of sub) if (c.operator === ">" || c.operator === ">=") gt = higherGT(gt, c, options);
		else if (c.operator === "<" || c.operator === "<=") lt = lowerLT(lt, c, options);
		else eqSet.add(c.semver);
		if (eqSet.size > 1) return null;
		let gtltComp;
		if (gt && lt) {
			gtltComp = compare(gt.semver, lt.semver, options);
			if (gtltComp > 0) return null;
			else if (gtltComp === 0 && (gt.operator !== ">=" || lt.operator !== "<=")) return null;
		}
		for (const eq of eqSet) {
			if (gt && !satisfies(eq, String(gt), options)) return null;
			if (lt && !satisfies(eq, String(lt), options)) return null;
			for (const c of dom) if (!satisfies(eq, String(c), options)) return false;
			return true;
		}
		let higher, lower;
		let hasDomLT, hasDomGT;
		let needDomLTPre = lt && !options.includePrerelease && lt.semver.prerelease.length ? lt.semver : false;
		let needDomGTPre = gt && !options.includePrerelease && gt.semver.prerelease.length ? gt.semver : false;
		if (needDomLTPre && needDomLTPre.prerelease.length === 1 && lt.operator === "<" && needDomLTPre.prerelease[0] === 0) needDomLTPre = false;
		for (const c of dom) {
			hasDomGT = hasDomGT || c.operator === ">" || c.operator === ">=";
			hasDomLT = hasDomLT || c.operator === "<" || c.operator === "<=";
			if (gt) {
				if (needDomGTPre) {
					if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomGTPre.major && c.semver.minor === needDomGTPre.minor && c.semver.patch === needDomGTPre.patch) needDomGTPre = false;
				}
				if (c.operator === ">" || c.operator === ">=") {
					higher = higherGT(gt, c, options);
					if (higher === c && higher !== gt) return false;
				} else if (gt.operator === ">=" && !c.test(gt.semver)) return false;
			}
			if (lt) {
				if (needDomLTPre) {
					if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomLTPre.major && c.semver.minor === needDomLTPre.minor && c.semver.patch === needDomLTPre.patch) needDomLTPre = false;
				}
				if (c.operator === "<" || c.operator === "<=") {
					lower = lowerLT(lt, c, options);
					if (lower === c && lower !== lt) return false;
				} else if (lt.operator === "<=" && !c.test(lt.semver)) return false;
			}
			if (!c.operator && (lt || gt) && gtltComp !== 0) return false;
		}
		if (gt && hasDomLT && !lt && gtltComp !== 0) return false;
		if (lt && hasDomGT && !gt && gtltComp !== 0) return false;
		if (needDomGTPre || needDomLTPre) return false;
		return true;
	};
	const higherGT = (a, b, options) => {
		if (!a) return b;
		const comp = compare(a.semver, b.semver, options);
		return comp > 0 ? a : comp < 0 ? b : b.operator === ">" && a.operator === ">=" ? b : a;
	};
	const lowerLT = (a, b, options) => {
		if (!a) return b;
		const comp = compare(a.semver, b.semver, options);
		return comp < 0 ? a : comp > 0 ? b : b.operator === "<" && a.operator === "<=" ? b : a;
	};
	module.exports = subset;
}));
//#endregion
//#region src/agent/protocol.ts
var import_semver = (/* @__PURE__ */ __commonJSMin(((exports, module) => {
	const internalRe = require_re();
	const constants = require_constants();
	const SemVer = require_semver$1();
	const identifiers = require_identifiers();
	module.exports = {
		parse: require_parse(),
		valid: require_valid$1(),
		clean: require_clean(),
		inc: require_inc(),
		diff: require_diff(),
		major: require_major(),
		minor: require_minor(),
		patch: require_patch(),
		prerelease: require_prerelease(),
		compare: require_compare(),
		rcompare: require_rcompare(),
		compareLoose: require_compare_loose(),
		compareBuild: require_compare_build(),
		sort: require_sort(),
		rsort: require_rsort(),
		gt: require_gt(),
		lt: require_lt(),
		eq: require_eq(),
		neq: require_neq(),
		gte: require_gte(),
		lte: require_lte(),
		cmp: require_cmp(),
		coerce: require_coerce(),
		truncate: require_truncate(),
		Comparator: require_comparator(),
		Range: require_range(),
		satisfies: require_satisfies(),
		toComparators: require_to_comparators(),
		maxSatisfying: require_max_satisfying(),
		minSatisfying: require_min_satisfying(),
		minVersion: require_min_version(),
		validRange: require_valid(),
		outside: require_outside(),
		gtr: require_gtr(),
		ltr: require_ltr(),
		intersects: require_intersects(),
		simplifyRange: require_simplify(),
		subset: require_subset(),
		SemVer,
		re: internalRe.re,
		src: internalRe.src,
		tokens: internalRe.t,
		SEMVER_SPEC_VERSION: constants.SEMVER_SPEC_VERSION,
		RELEASE_TYPES: constants.RELEASE_TYPES,
		compareIdentifiers: identifiers.compareIdentifiers,
		rcompareIdentifiers: identifiers.rcompareIdentifiers
	};
})))();
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
const PLAN_KEYS$2 = [
	...PLAN_BODY_KEYS$1,
	"planId",
	"digest"
];
const APPROVAL_KEYS$2 = [
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
function isRecord$9(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertExactKeys$1(value, keys, label) {
	if (!isRecord$9(value)) throw new FleetProtocolError("invalid-payload", label + " must be an object");
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
	return (0, import_semver.valid)(value) === value;
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
	return (0, import_semver.valid)(value) === value && (0, import_semver.satisfies)(value, "0.1.0-rc.8", { includePrerelease: true });
}
function validatePlanBody$1(value) {
	assertExactKeys$1(value, PLAN_BODY_KEYS$1, "plan body");
	if (value.protocolVersion !== 1) throw new FleetProtocolError("invalid-protocol", "unsupported fleet agent protocol version");
	assertNonEmpty(value.deviceId, "deviceId");
	assertNonEmpty(value.profile, "profile");
	assertDigest$1(value.manifestDigest, "manifestDigest");
	assertDigest$1(value.profileHash, "profileHash");
	assertNonEmpty(value.observedDshVersion, "observedDshVersion");
	if (!isSupportedDshVersion(value.observedDshVersion)) throw new FleetProtocolError("unsupported-dsh-version", "DSH version is outside 0.1.0-rc.8");
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
	if (isRecord$9(value)) {
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
	assertExactKeys$1(value, PLAN_KEYS$2, "plan");
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
	assertExactKeys$1(approval, APPROVAL_KEYS$2, "approval");
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
function isRecord$8(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedText(value, field, maxLength = 128) {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > maxLength || /[\r\n\0]/.test(value)) throw new WorkerPolicyError("invalid-context", field + " must be a bounded trimmed string");
	return value;
}
function safeIdentifier$2(value, field) {
	const result = boundedText(value, field, 64);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(result)) throw new WorkerPolicyError("invalid-context", field + " is invalid");
	return result;
}
function namespacedId(value, field, prefix) {
	const result = boundedText(value, field, 64);
	if (!new RegExp("^" + prefix + ":[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").test(result)) throw new WorkerPolicyError("invalid-context", field + " must be a namespaced UUID");
	return result;
}
function digest$5(value, field) {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new WorkerPolicyError("invalid-context", field + " must be a lowercase SHA-256 digest");
	return value;
}
function canonicalTimestamp(value, field) {
	if (typeof value !== "string") throw new WorkerPolicyError("invalid-context", field + " must be a canonical ISO timestamp");
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) throw new WorkerPolicyError("invalid-context", field + " must be a canonical ISO timestamp");
	return value;
}
function absolutePath$1(value, field) {
	const result = boundedText(value, field, 4096);
	if (!isAbsolute(result) || normalize(result) !== result) throw new WorkerPolicyError("invalid-context", field + " must be a normalized absolute path");
	return result;
}
function canonicalArguments(toolArguments, maxBytes) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16384) throw new WorkerPolicyError("invalid-context", "maxBytes exceeds the Fleet tool-argument ceiling");
	if (!isRecord$8(toolArguments)) throw new WorkerPolicyError("invalid-arguments", "tool arguments must be a JSON object");
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
function createTaskBindingDigest(input) {
	const senderKeyId = boundedText(input.sender.keyId, "sender.keyId", 80);
	if (!/^ed25519:[0-9a-f]{64}$/.test(senderKeyId)) throw new WorkerPolicyError("invalid-context", "sender.keyId must be an Ed25519 key id");
	return sha256Canonical({
		schemaVersion: 2,
		teamId: safeIdentifier$2(input.teamId, "teamId"),
		submitMessageId: namespacedId(input.submitMessageId, "submitMessageId", "msg"),
		submitPayloadDigest: digest$5(input.submitPayloadDigest, "submitPayloadDigest"),
		sender: {
			principalId: safeIdentifier$2(input.sender.principalId, "sender.principalId"),
			deviceId: safeIdentifier$2(input.sender.deviceId, "sender.deviceId"),
			keyId: senderKeyId
		},
		recipientDeviceId: safeIdentifier$2(input.recipientDeviceId, "recipientDeviceId"),
		taskId: namespacedId(input.taskId, "taskId", "task"),
		workspaceId: safeIdentifier$2(input.workspaceId, "workspaceId"),
		workspacePath: absolutePath$1(input.workspacePath, "workspacePath"),
		profile: safeIdentifier$2(input.profile, "profile"),
		executionProfileHash: digest$5(input.executionProfileHash, "executionProfileHash"),
		manifestDigest: digest$5(input.manifestDigest, "manifestDigest"),
		releaseDigest: digest$5(input.releaseDigest, "releaseDigest"),
		policyId: safeIdentifier$2(input.policyId, "policyId"),
		policyDigest: digest$5(input.policyDigest, "policyDigest"),
		deadline: canonicalTimestamp(input.deadline, "deadline")
	});
}
function createAllowedOnceToken(input) {
	return {
		schemaVersion: 2,
		approvalId: namespacedId(input.approvalId, "approvalId", "approval"),
		approvalRequestMessageId: namespacedId(input.approvalRequestMessageId, "approvalRequestMessageId", "msg"),
		approvalRequestPayloadDigest: digest$5(input.approvalRequestPayloadDigest, "approvalRequestPayloadDigest"),
		decisionMessageId: namespacedId(input.decisionMessageId, "decisionMessageId", "msg"),
		decisionPayloadDigest: digest$5(input.decisionPayloadDigest, "decisionPayloadDigest"),
		taskBindingDigest: digest$5(input.taskBindingDigest, "taskBindingDigest"),
		executionProfileHash: digest$5(input.executionProfileHash, "executionProfileHash"),
		toolCallId: boundedText(input.toolCallId, "toolCallId"),
		toolName: safeIdentifier$2(input.toolName, "toolName"),
		argumentsDigest: digest$5(input.argumentsDigest, "argumentsDigest"),
		expiresAt: canonicalTimestamp(input.expiresAt, "expiresAt"),
		consumedAt: null
	};
}
const TASK_POLICY_IDS = ["readonly-v1", "workspace-write-ask-v1"];
const SAFE_READ_TOOLS = [
	"glob",
	"grep",
	"read",
	"read_image"
];
const APPROVAL_REQUIRED_TOOLS = [
	"bash",
	"edit",
	"pwsh",
	"web_fetch",
	"web_search",
	"write"
];
const HARD_DENIED_TOOLS = [
	"cordis_define",
	"cordis_inspect_list",
	"cordis_inspect_query",
	"cordis_inspect_self",
	"cordis_run",
	"cordis_stop",
	"cordis_undefine",
	"create_goal",
	"followup_task",
	"interrupt_agent",
	"job_kill",
	"job_list",
	"job_output",
	"list_agents",
	"ralph",
	"report",
	"run_code",
	"send_message",
	"skill",
	"spawn_agent",
	"str_replace_editor",
	"todo_write",
	"update_goal",
	"wait_agent",
	"workflow"
];
function calculateTaskPolicyDigest(policy) {
	return sha256Canonical(policy);
}
function defineTaskPolicy(input) {
	const body = Object.freeze({
		schemaVersion: 1,
		policyId: input.policyId,
		permissionMode: input.permissionMode,
		workspaceScope: "configured-workspace",
		defaultDecision: "deny",
		safeTools: Object.freeze([...SAFE_READ_TOOLS]),
		approvalRequiredTools: Object.freeze([...input.approvalRequiredTools]),
		hardDeniedTools: Object.freeze([...HARD_DENIED_TOOLS]),
		allowBackground: false,
		maxArgumentsBytes: MAX_TASK_TOOL_ARGUMENT_BYTES
	});
	return Object.freeze({
		...body,
		policyDigest: calculateTaskPolicyDigest(body)
	});
}
const LOCAL_TASK_POLICIES = Object.freeze({
	"readonly-v1": defineTaskPolicy({
		policyId: "readonly-v1",
		permissionMode: "read-only",
		approvalRequiredTools: []
	}),
	"workspace-write-ask-v1": defineTaskPolicy({
		policyId: "workspace-write-ask-v1",
		permissionMode: "workspace-write",
		approvalRequiredTools: APPROVAL_REQUIRED_TOOLS
	})
});
function isRecord$7(value) {
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
function exactKeys$4(value, allowed, field) {
	const extra = Object.keys(value).filter((key) => !allowed.includes(key));
	if (extra.length > 0) throw new TypeError(field + " contains unsupported fields: " + extra.sort().join(", "));
}
function parseRestart(value) {
	if (!isRecord$7(value)) throw new TypeError("restart must be an object");
	const kind = nonEmpty$1(value.kind, "restart.kind");
	if (kind === "none") {
		exactKeys$4(value, ["kind"], "restart");
		return { kind: "none" };
	}
	if (kind !== "screen" && kind !== "launchd") throw new TypeError("restart.kind must be none, screen or launchd");
	exactKeys$4(value, kind === "screen" ? [
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
	const host = nonEmpty$1(value.host, "restart.host");
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
		const sessionName = nonEmpty$1(value.sessionName, "restart.sessionName");
		if (!/^[A-Za-z0-9._-]+$/.test(sessionName)) throw new TypeError("restart.sessionName contains unsupported characters");
		return {
			kind: "screen",
			screenBinary: absolutePath(value.screenBinary, "restart.screenBinary"),
			sessionName,
			...common
		};
	}
	const serviceTarget = nonEmpty$1(value.serviceTarget, "restart.serviceTarget");
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
	if (!isRecord$7(value)) throw new TypeError("health must be an object");
	exactKeys$4(value, [
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
function safeIdentifier$1(value, field) {
	const id = nonEmpty$1(value, field);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new TypeError(field + " contains unsupported characters");
	return id;
}
function parseA2A(value) {
	if (value === void 0) return void 0;
	if (!isRecord$7(value)) throw new TypeError("a2a must be an object");
	exactKeys$4(value, [
		"teamId",
		"principalId",
		"privateKeyPath",
		"trustStorePath",
		"maxMessageTtlMs"
	], "a2a");
	return {
		teamId: safeIdentifier$1(value.teamId, "a2a.teamId"),
		principalId: safeIdentifier$1(value.principalId, "a2a.principalId"),
		privateKeyPath: absolutePath(value.privateKeyPath, "a2a.privateKeyPath"),
		trustStorePath: absolutePath(value.trustStorePath, "a2a.trustStorePath"),
		maxMessageTtlMs: boundedInt(value.maxMessageTtlMs, "a2a.maxMessageTtlMs", 9e5, 6e4, 864e5)
	};
}
function parseTasks(value) {
	if (value === void 0) return void 0;
	if (!isRecord$7(value)) throw new TypeError("tasks must be an object");
	exactKeys$4(value, [
		"enabled",
		"workspaces",
		"profiles",
		"timeoutMs",
		"maxOutputBytes",
		"maxConcurrent",
		"policyIds"
	], "tasks");
	if (typeof value.enabled !== "boolean") throw new TypeError("tasks.enabled must be boolean");
	if (!isRecord$7(value.workspaces)) throw new TypeError("tasks.workspaces must be an object");
	const workspaces = {};
	for (const [rawId, path] of Object.entries(value.workspaces)) {
		const id = safeIdentifier$1(rawId, "tasks workspace id");
		workspaces[id] = absolutePath(path, "tasks.workspaces." + id);
	}
	if (value.enabled && Object.keys(workspaces).length === 0) throw new TypeError("enabled tasks require at least one workspace");
	if (!Array.isArray(value.profiles) || value.profiles.length === 0 || value.profiles.length > 16 || value.profiles.some((profile) => typeof profile !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)) || new Set(value.profiles).size !== value.profiles.length) throw new TypeError("tasks.profiles must contain 1 to 16 unique safe profile ids");
	const rawPolicyIds = value.policyIds ?? ["readonly-v1"];
	if (!Array.isArray(rawPolicyIds) || rawPolicyIds.length === 0 || rawPolicyIds.length > TASK_POLICY_IDS.length || rawPolicyIds.some((policyId) => typeof policyId !== "string" || !TASK_POLICY_IDS.includes(policyId)) || new Set(rawPolicyIds).size !== rawPolicyIds.length) throw new TypeError("tasks.policyIds must contain unique installed task policy ids");
	const policyIds = [...rawPolicyIds];
	const policies = {};
	for (const policyId of policyIds) policies[policyId] = LOCAL_TASK_POLICIES[policyId];
	return {
		enabled: value.enabled,
		workspaces,
		profiles: value.profiles,
		timeoutMs: boundedInt(value.timeoutMs, "tasks.timeoutMs", 36e5, 6e4, 216e5),
		maxOutputBytes: boundedInt(value.maxOutputBytes, "tasks.maxOutputBytes", 1048576, 4096, 1048576),
		maxConcurrent: boundedInt(value.maxConcurrent, "tasks.maxConcurrent", 1, 1, 4),
		policyIds,
		policies: Object.freeze(policies)
	};
}
function parseAgentConfig(value) {
	if (!isRecord$7(value)) throw new TypeError("agent config must be an object");
	exactKeys$4(value, [
		"schemaVersion",
		"deviceId",
		"manifestPath",
		"desiredManifestPath",
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
	const profile = nonEmpty$1(value.profile, "profile");
	if (!/^[A-Za-z0-9._-]+$/.test(profile)) throw new TypeError("profile contains unsupported characters");
	const dshHome = absolutePath(value.dshHome, "dshHome");
	const configuredManifestPath = absolutePath(value.manifestPath, "manifestPath");
	const profileManifestPath = join(dshHome, "profiles", profile, "fleet.lock.yaml");
	let manifestPath = configuredManifestPath;
	let desiredManifestPath;
	if (value.schemaVersion === 2) {
		if (value.desiredManifestPath === void 0) {
			manifestPath = profileManifestPath;
			desiredManifestPath = configuredManifestPath;
		} else {
			desiredManifestPath = absolutePath(value.desiredManifestPath, "desiredManifestPath");
			if (configuredManifestPath !== profileManifestPath) throw new TypeError("schemaVersion 2 manifestPath must be the profile-local live Fleet manifest");
		}
	} else if (value.desiredManifestPath !== void 0) throw new TypeError("schemaVersion 1 must not define desiredManifestPath");
	const artifactStore = value.artifactStore === void 0 ? void 0 : absolutePath(value.artifactStore, "artifactStore");
	const tarBinary = value.tarBinary === void 0 ? void 0 : absolutePath(value.tarBinary, "tarBinary");
	if (value.schemaVersion === 2 && (artifactStore === void 0 || tarBinary === void 0)) throw new TypeError("schemaVersion 2 requires artifactStore and tarBinary");
	const a2a = parseA2A(value.a2a);
	const tasks = parseTasks(value.tasks);
	if (tasks?.enabled === true && a2a === void 0) throw new TypeError("enabled tasks require a2a identity and trust configuration");
	return {
		schemaVersion: value.schemaVersion,
		deviceId: normalizeDeviceId(value.deviceId),
		manifestPath,
		...desiredManifestPath === void 0 ? {} : { desiredManifestPath },
		dshHome,
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
	const expectedManifestPath = join(config.dshHome, "profiles", config.profile, "fleet.lock.yaml");
	if (config.schemaVersion !== 2 || config.artifactStore === void 0 || config.tarBinary === void 0 || config.desiredManifestPath === void 0 || config.manifestPath !== expectedManifestPath) throw mutationConfigError("atomic profile releases require schemaVersion 2, a profile-local live manifest, a desired manifest, artifactStore and tarBinary");
}
function assertA2AReadyConfig(config) {
	if (config.schemaVersion !== 2 || config.a2a === void 0 || config.tasks === void 0) throw mutationConfigError("A2A requires schemaVersion 2 with identity, trust and task policy");
	if (config.tasks.policyIds === void 0 || config.tasks.policies === void 0) throw mutationConfigError("A2A task execution requires resolved local task policies");
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
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/identity.js
var require_identity = /* @__PURE__ */ __commonJSMin(((exports) => {
	const ALIAS = Symbol.for("yaml.alias");
	const DOC = Symbol.for("yaml.document");
	const MAP = Symbol.for("yaml.map");
	const PAIR = Symbol.for("yaml.pair");
	const SCALAR = Symbol.for("yaml.scalar");
	const SEQ = Symbol.for("yaml.seq");
	const NODE_TYPE = Symbol.for("yaml.node.type");
	const isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
	const isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
	const isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
	const isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
	const isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
	const isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
	function isCollection(node) {
		if (node && typeof node === "object") switch (node[NODE_TYPE]) {
			case MAP:
			case SEQ: return true;
		}
		return false;
	}
	function isNode(node) {
		if (node && typeof node === "object") switch (node[NODE_TYPE]) {
			case ALIAS:
			case MAP:
			case SCALAR:
			case SEQ: return true;
		}
		return false;
	}
	const hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
	exports.ALIAS = ALIAS;
	exports.DOC = DOC;
	exports.MAP = MAP;
	exports.NODE_TYPE = NODE_TYPE;
	exports.PAIR = PAIR;
	exports.SCALAR = SCALAR;
	exports.SEQ = SEQ;
	exports.hasAnchor = hasAnchor;
	exports.isAlias = isAlias;
	exports.isCollection = isCollection;
	exports.isDocument = isDocument;
	exports.isMap = isMap;
	exports.isNode = isNode;
	exports.isPair = isPair;
	exports.isScalar = isScalar;
	exports.isSeq = isSeq;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/visit.js
var require_visit = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	const BREAK = Symbol("break visit");
	const SKIP = Symbol("skip children");
	const REMOVE = Symbol("remove node");
	/**
	* Apply a visitor to an AST node or document.
	*
	* Walks through the tree (depth-first) starting from `node`, calling a
	* `visitor` function with three arguments:
	*   - `key`: For sequence values and map `Pair`, the node's index in the
	*     collection. Within a `Pair`, `'key'` or `'value'`, correspondingly.
	*     `null` for the root node.
	*   - `node`: The current node.
	*   - `path`: The ancestry of the current node.
	*
	* The return value of the visitor may be used to control the traversal:
	*   - `undefined` (default): Do nothing and continue
	*   - `visit.SKIP`: Do not visit the children of this node, continue with next
	*     sibling
	*   - `visit.BREAK`: Terminate traversal completely
	*   - `visit.REMOVE`: Remove the current node, then continue with the next one
	*   - `Node`: Replace the current node, then continue by visiting it
	*   - `number`: While iterating the items of a sequence or map, set the index
	*     of the next step. This is useful especially if the index of the current
	*     node has changed.
	*
	* If `visitor` is a single function, it will be called with all values
	* encountered in the tree, including e.g. `null` values. Alternatively,
	* separate visitor functions may be defined for each `Map`, `Pair`, `Seq`,
	* `Alias` and `Scalar` node. To define the same visitor function for more than
	* one node type, use the `Collection` (map and seq), `Value` (map, seq & scalar)
	* and `Node` (alias, map, seq & scalar) targets. Of all these, only the most
	* specific defined one will be used for each node.
	*/
	function visit(node, visitor) {
		const visitor_ = initVisitor(visitor);
		if (identity.isDocument(node)) {
			if (visit_(null, node.contents, visitor_, Object.freeze([node])) === REMOVE) node.contents = null;
		} else visit_(null, node, visitor_, Object.freeze([]));
	}
	/** Terminate visit traversal completely */
	visit.BREAK = BREAK;
	/** Do not visit the children of the current node */
	visit.SKIP = SKIP;
	/** Remove the current node */
	visit.REMOVE = REMOVE;
	function visit_(key, node, visitor, path) {
		const ctrl = callVisitor(key, node, visitor, path);
		if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
			replaceNode(key, path, ctrl);
			return visit_(key, ctrl, visitor, path);
		}
		if (typeof ctrl !== "symbol") {
			if (identity.isCollection(node)) {
				path = Object.freeze(path.concat(node));
				for (let i = 0; i < node.items.length; ++i) {
					const ci = visit_(i, node.items[i], visitor, path);
					if (typeof ci === "number") i = ci - 1;
					else if (ci === BREAK) return BREAK;
					else if (ci === REMOVE) {
						node.items.splice(i, 1);
						i -= 1;
					}
				}
			} else if (identity.isPair(node)) {
				path = Object.freeze(path.concat(node));
				const ck = visit_("key", node.key, visitor, path);
				if (ck === BREAK) return BREAK;
				else if (ck === REMOVE) node.key = null;
				const cv = visit_("value", node.value, visitor, path);
				if (cv === BREAK) return BREAK;
				else if (cv === REMOVE) node.value = null;
			}
		}
		return ctrl;
	}
	/**
	* Apply an async visitor to an AST node or document.
	*
	* Walks through the tree (depth-first) starting from `node`, calling a
	* `visitor` function with three arguments:
	*   - `key`: For sequence values and map `Pair`, the node's index in the
	*     collection. Within a `Pair`, `'key'` or `'value'`, correspondingly.
	*     `null` for the root node.
	*   - `node`: The current node.
	*   - `path`: The ancestry of the current node.
	*
	* The return value of the visitor may be used to control the traversal:
	*   - `Promise`: Must resolve to one of the following values
	*   - `undefined` (default): Do nothing and continue
	*   - `visit.SKIP`: Do not visit the children of this node, continue with next
	*     sibling
	*   - `visit.BREAK`: Terminate traversal completely
	*   - `visit.REMOVE`: Remove the current node, then continue with the next one
	*   - `Node`: Replace the current node, then continue by visiting it
	*   - `number`: While iterating the items of a sequence or map, set the index
	*     of the next step. This is useful especially if the index of the current
	*     node has changed.
	*
	* If `visitor` is a single function, it will be called with all values
	* encountered in the tree, including e.g. `null` values. Alternatively,
	* separate visitor functions may be defined for each `Map`, `Pair`, `Seq`,
	* `Alias` and `Scalar` node. To define the same visitor function for more than
	* one node type, use the `Collection` (map and seq), `Value` (map, seq & scalar)
	* and `Node` (alias, map, seq & scalar) targets. Of all these, only the most
	* specific defined one will be used for each node.
	*/
	async function visitAsync(node, visitor) {
		const visitor_ = initVisitor(visitor);
		if (identity.isDocument(node)) {
			if (await visitAsync_(null, node.contents, visitor_, Object.freeze([node])) === REMOVE) node.contents = null;
		} else await visitAsync_(null, node, visitor_, Object.freeze([]));
	}
	/** Terminate visit traversal completely */
	visitAsync.BREAK = BREAK;
	/** Do not visit the children of the current node */
	visitAsync.SKIP = SKIP;
	/** Remove the current node */
	visitAsync.REMOVE = REMOVE;
	async function visitAsync_(key, node, visitor, path) {
		const ctrl = await callVisitor(key, node, visitor, path);
		if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
			replaceNode(key, path, ctrl);
			return visitAsync_(key, ctrl, visitor, path);
		}
		if (typeof ctrl !== "symbol") {
			if (identity.isCollection(node)) {
				path = Object.freeze(path.concat(node));
				for (let i = 0; i < node.items.length; ++i) {
					const ci = await visitAsync_(i, node.items[i], visitor, path);
					if (typeof ci === "number") i = ci - 1;
					else if (ci === BREAK) return BREAK;
					else if (ci === REMOVE) {
						node.items.splice(i, 1);
						i -= 1;
					}
				}
			} else if (identity.isPair(node)) {
				path = Object.freeze(path.concat(node));
				const ck = await visitAsync_("key", node.key, visitor, path);
				if (ck === BREAK) return BREAK;
				else if (ck === REMOVE) node.key = null;
				const cv = await visitAsync_("value", node.value, visitor, path);
				if (cv === BREAK) return BREAK;
				else if (cv === REMOVE) node.value = null;
			}
		}
		return ctrl;
	}
	function initVisitor(visitor) {
		if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) return Object.assign({
			Alias: visitor.Node,
			Map: visitor.Node,
			Scalar: visitor.Node,
			Seq: visitor.Node
		}, visitor.Value && {
			Map: visitor.Value,
			Scalar: visitor.Value,
			Seq: visitor.Value
		}, visitor.Collection && {
			Map: visitor.Collection,
			Seq: visitor.Collection
		}, visitor);
		return visitor;
	}
	function callVisitor(key, node, visitor, path) {
		if (typeof visitor === "function") return visitor(key, node, path);
		if (identity.isMap(node)) return visitor.Map?.(key, node, path);
		if (identity.isSeq(node)) return visitor.Seq?.(key, node, path);
		if (identity.isPair(node)) return visitor.Pair?.(key, node, path);
		if (identity.isScalar(node)) return visitor.Scalar?.(key, node, path);
		if (identity.isAlias(node)) return visitor.Alias?.(key, node, path);
	}
	function replaceNode(key, path, node) {
		const parent = path[path.length - 1];
		if (identity.isCollection(parent)) parent.items[key] = node;
		else if (identity.isPair(parent)) {
			if (key === "key") parent.key = node;
			else parent.value = node;
		} else if (identity.isDocument(parent)) parent.contents = node;
		else {
			const pt = identity.isAlias(parent) ? "alias" : "scalar";
			throw new Error(`Cannot replace node with ${pt} parent`);
		}
	}
	exports.visit = visit;
	exports.visitAsync = visitAsync;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/directives.js
var require_directives = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var visit = require_visit();
	const escapeChars = {
		"!": "%21",
		",": "%2C",
		"[": "%5B",
		"]": "%5D",
		"{": "%7B",
		"}": "%7D"
	};
	const escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
	var Directives = class Directives {
		constructor(yaml, tags) {
			/**
			* The directives-end/doc-start marker `---`. If `null`, a marker may still be
			* included in the document's stringified representation.
			*/
			this.docStart = null;
			/** The doc-end marker `...`.  */
			this.docEnd = false;
			this.yaml = Object.assign({}, Directives.defaultYaml, yaml);
			this.tags = Object.assign({}, Directives.defaultTags, tags);
		}
		clone() {
			const copy = new Directives(this.yaml, this.tags);
			copy.docStart = this.docStart;
			return copy;
		}
		/**
		* During parsing, get a Directives instance for the current document and
		* update the stream state according to the current version's spec.
		*/
		atDocument() {
			const res = new Directives(this.yaml, this.tags);
			switch (this.yaml.version) {
				case "1.1":
					this.atNextDocument = true;
					break;
				case "1.2":
					this.atNextDocument = false;
					this.yaml = {
						explicit: Directives.defaultYaml.explicit,
						version: "1.2"
					};
					this.tags = Object.assign({}, Directives.defaultTags);
			}
			return res;
		}
		/**
		* @param onError - May be called even if the action was successful
		* @returns `true` on success
		*/
		add(line, onError) {
			if (this.atNextDocument) {
				this.yaml = {
					explicit: Directives.defaultYaml.explicit,
					version: "1.1"
				};
				this.tags = Object.assign({}, Directives.defaultTags);
				this.atNextDocument = false;
			}
			const parts = line.trim().split(/[ \t]+/);
			const name = parts.shift();
			switch (name) {
				case "%TAG": {
					if (parts.length !== 2) {
						onError(0, "%TAG directive should contain exactly two parts");
						if (parts.length < 2) return false;
					}
					const [handle, prefix] = parts;
					this.tags[handle] = prefix;
					return true;
				}
				case "%YAML": {
					this.yaml.explicit = true;
					if (parts.length !== 1) {
						onError(0, "%YAML directive should contain exactly one part");
						return false;
					}
					const [version] = parts;
					if (version === "1.1" || version === "1.2") {
						this.yaml.version = version;
						return true;
					} else {
						const isValid = /^\d+\.\d+$/.test(version);
						onError(6, `Unsupported YAML version ${version}`, isValid);
						return false;
					}
				}
				default:
					onError(0, `Unknown directive ${name}`, true);
					return false;
			}
		}
		/**
		* Resolves a tag, matching handles to those defined in %TAG directives.
		*
		* @returns Resolved tag, which may also be the non-specific tag `'!'` or a
		*   `'!local'` tag, or `null` if unresolvable.
		*/
		tagName(source, onError) {
			if (source === "!") return "!";
			if (source[0] !== "!") {
				onError(`Not a valid tag: ${source}`);
				return null;
			}
			if (source[1] === "<") {
				const verbatim = source.slice(2, -1);
				if (verbatim === "!" || verbatim === "!!") {
					onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
					return null;
				}
				if (source[source.length - 1] !== ">") onError("Verbatim tags must end with a >");
				return verbatim;
			}
			const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
			if (!suffix) onError(`The ${source} tag has no suffix`);
			const prefix = this.tags[handle];
			if (prefix) try {
				return prefix + decodeURIComponent(suffix);
			} catch (error) {
				onError(String(error));
				return null;
			}
			if (handle === "!") return source;
			onError(`Could not resolve tag: ${source}`);
			return null;
		}
		/**
		* Given a fully resolved tag, returns its printable string form,
		* taking into account current tag prefixes and defaults.
		*/
		tagString(tag) {
			for (const [handle, prefix] of Object.entries(this.tags)) if (tag.startsWith(prefix)) return handle + escapeTagName(tag.substring(prefix.length));
			return tag[0] === "!" ? tag : `!<${tag}>`;
		}
		toString(doc) {
			const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
			const tagEntries = Object.entries(this.tags);
			let tagNames;
			if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
				const tags = {};
				visit.visit(doc.contents, (_key, node) => {
					if (identity.isNode(node) && node.tag) tags[node.tag] = true;
				});
				tagNames = Object.keys(tags);
			} else tagNames = [];
			for (const [handle, prefix] of tagEntries) {
				if (handle === "!!" && prefix === "tag:yaml.org,2002:") continue;
				if (!doc || tagNames.some((tn) => tn.startsWith(prefix))) lines.push(`%TAG ${handle} ${prefix}`);
			}
			return lines.join("\n");
		}
	};
	Directives.defaultYaml = {
		explicit: false,
		version: "1.2"
	};
	Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
	exports.Directives = Directives;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/anchors.js
var require_anchors = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var visit = require_visit();
	/**
	* Verify that the input string is a valid anchor.
	*
	* Will throw on errors.
	*/
	function anchorIsValid(anchor) {
		if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
			const msg = `Anchor must not contain whitespace or control characters: ${JSON.stringify(anchor)}`;
			throw new Error(msg);
		}
		return true;
	}
	function anchorNames(root) {
		const anchors = /* @__PURE__ */ new Set();
		visit.visit(root, { Value(_key, node) {
			if (node.anchor) anchors.add(node.anchor);
		} });
		return anchors;
	}
	/** Find a new anchor name with the given `prefix` and a one-indexed suffix. */
	function findNewAnchor(prefix, exclude) {
		for (let i = 1;; ++i) {
			const name = `${prefix}${i}`;
			if (!exclude.has(name)) return name;
		}
	}
	function createNodeAnchors(doc, prefix) {
		const aliasObjects = [];
		const sourceObjects = /* @__PURE__ */ new Map();
		let prevAnchors = null;
		return {
			onAnchor: (source) => {
				aliasObjects.push(source);
				prevAnchors ?? (prevAnchors = anchorNames(doc));
				const anchor = findNewAnchor(prefix, prevAnchors);
				prevAnchors.add(anchor);
				return anchor;
			},
			/**
			* With circular references, the source node is only resolved after all
			* of its child nodes are. This is why anchors are set only after all of
			* the nodes have been created.
			*/
			setAnchors: () => {
				for (const source of aliasObjects) {
					const ref = sourceObjects.get(source);
					if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) ref.node.anchor = ref.anchor;
					else {
						const error = /* @__PURE__ */ new Error("Failed to resolve repeated object (this should not happen)");
						error.source = source;
						throw error;
					}
				}
			},
			sourceObjects
		};
	}
	exports.anchorIsValid = anchorIsValid;
	exports.anchorNames = anchorNames;
	exports.createNodeAnchors = createNodeAnchors;
	exports.findNewAnchor = findNewAnchor;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Applies the JSON.parse reviver algorithm as defined in the ECMA-262 spec,
	* in section 24.5.1.1 "Runtime Semantics: InternalizeJSONProperty" of the
	* 2021 edition: https://tc39.es/ecma262/#sec-json.parse
	*
	* Includes extensions for handling Map and Set objects.
	*/
	function applyReviver(reviver, obj, key, val) {
		if (val && typeof val === "object") {
			if (Array.isArray(val)) for (let i = 0, len = val.length; i < len; ++i) {
				const v0 = val[i];
				const v1 = applyReviver(reviver, val, String(i), v0);
				if (v1 === void 0) delete val[i];
				else if (v1 !== v0) val[i] = v1;
			}
			else if (val instanceof Map) for (const k of Array.from(val.keys())) {
				const v0 = val.get(k);
				const v1 = applyReviver(reviver, val, k, v0);
				if (v1 === void 0) val.delete(k);
				else if (v1 !== v0) val.set(k, v1);
			}
			else if (val instanceof Set) for (const v0 of Array.from(val)) {
				const v1 = applyReviver(reviver, val, v0, v0);
				if (v1 === void 0) val.delete(v0);
				else if (v1 !== v0) {
					val.delete(v0);
					val.add(v1);
				}
			}
			else for (const [k, v0] of Object.entries(val)) {
				const v1 = applyReviver(reviver, val, k, v0);
				if (v1 === void 0) delete val[k];
				else if (v1 !== v0) val[k] = v1;
			}
		}
		return reviver.call(obj, key, val);
	}
	exports.applyReviver = applyReviver;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/toJS.js
var require_toJS = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	/**
	* Recursively convert any node or its contents to native JavaScript
	*
	* @param value - The input value
	* @param arg - If `value` defines a `toJSON()` method, use this
	*   as its first argument
	* @param ctx - Conversion context, originally set in Document#toJS(). If
	*   `{ keep: true }` is not set, output should be suitable for JSON
	*   stringification.
	*/
	function toJS(value, arg, ctx) {
		if (Array.isArray(value)) return value.map((v, i) => toJS(v, String(i), ctx));
		if (value && typeof value.toJSON === "function") {
			if (!ctx || !identity.hasAnchor(value)) return value.toJSON(arg, ctx);
			const data = {
				aliasCount: 0,
				count: 1,
				res: void 0
			};
			ctx.anchors.set(value, data);
			ctx.onCreate = (res) => {
				data.res = res;
				delete ctx.onCreate;
			};
			const res = value.toJSON(arg, ctx);
			if (ctx.onCreate) ctx.onCreate(res);
			return res;
		}
		if (typeof value === "bigint" && !ctx?.keep) return Number(value);
		return value;
	}
	exports.toJS = toJS;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Node.js
var require_Node = /* @__PURE__ */ __commonJSMin(((exports) => {
	var applyReviver = require_applyReviver();
	var identity = require_identity();
	var toJS = require_toJS();
	var NodeBase = class {
		constructor(type) {
			Object.defineProperty(this, identity.NODE_TYPE, { value: type });
		}
		/** Create a copy of this node.  */
		clone() {
			const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
			if (this.range) copy.range = this.range.slice();
			return copy;
		}
		/** A plain JavaScript representation of this node. */
		toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
			if (!identity.isDocument(doc)) throw new TypeError("A document argument is required");
			const ctx = {
				anchors: /* @__PURE__ */ new Map(),
				doc,
				keep: true,
				mapAsMap: mapAsMap === true,
				mapKeyWarned: false,
				maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
			};
			const res = toJS.toJS(this, "", ctx);
			if (typeof onAnchor === "function") for (const { count, res } of ctx.anchors.values()) onAnchor(res, count);
			return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
		}
	};
	exports.NodeBase = NodeBase;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Alias.js
var require_Alias = /* @__PURE__ */ __commonJSMin(((exports) => {
	var anchors = require_anchors();
	var visit = require_visit();
	var identity = require_identity();
	var Node = require_Node();
	var toJS = require_toJS();
	var Alias = class extends Node.NodeBase {
		constructor(source) {
			super(identity.ALIAS);
			this.source = source;
			Object.defineProperty(this, "tag", { set() {
				throw new Error("Alias nodes cannot have tags");
			} });
		}
		/**
		* Resolve the value of this alias within `doc`, finding the last
		* instance of the `source` anchor before this node.
		*/
		resolve(doc, ctx) {
			if (ctx?.maxAliasCount === 0) throw new ReferenceError("Alias resolution is disabled");
			let nodes;
			if (ctx?.aliasResolveCache) nodes = ctx.aliasResolveCache;
			else {
				nodes = [];
				visit.visit(doc, { Node: (_key, node) => {
					if (identity.isAlias(node) || identity.hasAnchor(node)) nodes.push(node);
				} });
				if (ctx) ctx.aliasResolveCache = nodes;
			}
			let found = void 0;
			for (const node of nodes) {
				if (node === this) break;
				if (node.anchor === this.source) found = node;
			}
			return found;
		}
		toJSON(_arg, ctx) {
			if (!ctx) return { source: this.source };
			const { anchors, doc, maxAliasCount } = ctx;
			const source = this.resolve(doc, ctx);
			if (!source) {
				const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
				throw new ReferenceError(msg);
			}
			let data = anchors.get(source);
			if (!data) {
				toJS.toJS(source, null, ctx);
				data = anchors.get(source);
			}
			/* istanbul ignore if */
			if (data?.res === void 0) throw new ReferenceError("This should not happen: Alias anchor was not resolved?");
			if (maxAliasCount >= 0) {
				data.count += 1;
				if (data.aliasCount === 0) data.aliasCount = getAliasCount(doc, source, anchors);
				if (data.count * data.aliasCount > maxAliasCount) throw new ReferenceError("Excessive alias count indicates a resource exhaustion attack");
			}
			return data.res;
		}
		toString(ctx, _onComment, _onChompKeep) {
			const src = `*${this.source}`;
			if (ctx) {
				anchors.anchorIsValid(this.source);
				if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
					const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
					throw new Error(msg);
				}
				if (ctx.implicitKey) return `${src} `;
			}
			return src;
		}
	};
	function getAliasCount(doc, node, anchors) {
		if (identity.isAlias(node)) {
			const source = node.resolve(doc);
			const anchor = anchors && source && anchors.get(source);
			return anchor ? anchor.count * anchor.aliasCount : 0;
		} else if (identity.isCollection(node)) {
			let count = 0;
			for (const item of node.items) {
				const c = getAliasCount(doc, item, anchors);
				if (c > count) count = c;
			}
			return count;
		} else if (identity.isPair(node)) {
			const kc = getAliasCount(doc, node.key, anchors);
			const vc = getAliasCount(doc, node.value, anchors);
			return Math.max(kc, vc);
		}
		return 1;
	}
	exports.Alias = Alias;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Node = require_Node();
	var toJS = require_toJS();
	const isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
	var Scalar = class extends Node.NodeBase {
		constructor(value) {
			super(identity.SCALAR);
			this.value = value;
		}
		toJSON(arg, ctx) {
			return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
		}
		toString() {
			return String(this.value);
		}
	};
	Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
	Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
	Scalar.PLAIN = "PLAIN";
	Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
	Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
	exports.Scalar = Scalar;
	exports.isScalarValue = isScalarValue;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/createNode.js
var require_createNode = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Alias = require_Alias();
	var identity = require_identity();
	var Scalar = require_Scalar();
	const defaultTagPrefix = "tag:yaml.org,2002:";
	function findTagObject(value, tagName, tags) {
		if (tagName) {
			const match = tags.filter((t) => t.tag === tagName);
			const tagObj = match.find((t) => !t.format) ?? match[0];
			if (!tagObj) throw new Error(`Tag ${tagName} not found`);
			return tagObj;
		}
		return tags.find((t) => t.identify?.(value) && !t.format);
	}
	function createNode(value, tagName, ctx) {
		if (identity.isDocument(value)) value = value.contents;
		if (identity.isNode(value)) return value;
		if (identity.isPair(value)) {
			const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
			map.items.push(value);
			return map;
		}
		if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) value = value.valueOf();
		const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
		let ref = void 0;
		if (aliasDuplicateObjects && value && typeof value === "object") {
			ref = sourceObjects.get(value);
			if (ref) {
				ref.anchor ?? (ref.anchor = onAnchor(value));
				return new Alias.Alias(ref.anchor);
			} else {
				ref = {
					anchor: null,
					node: null
				};
				sourceObjects.set(value, ref);
			}
		}
		if (tagName?.startsWith("!!")) tagName = defaultTagPrefix + tagName.slice(2);
		let tagObj = findTagObject(value, tagName, schema.tags);
		if (!tagObj) {
			if (value && typeof value.toJSON === "function") value = value.toJSON();
			if (!value || typeof value !== "object") {
				const node = new Scalar.Scalar(value);
				if (ref) ref.node = node;
				return node;
			}
			tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
		}
		if (onTagObj) {
			onTagObj(tagObj);
			delete ctx.onTagObj;
		}
		const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
		if (tagName) node.tag = tagName;
		else if (!tagObj.default) node.tag = tagObj.tag;
		if (ref) ref.node = node;
		return node;
	}
	exports.createNode = createNode;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Collection.js
var require_Collection = /* @__PURE__ */ __commonJSMin(((exports) => {
	var createNode = require_createNode();
	var identity = require_identity();
	var Node = require_Node();
	function collectionFromPath(schema, path, value) {
		let v = value;
		for (let i = path.length - 1; i >= 0; --i) {
			const k = path[i];
			if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
				const a = [];
				a[k] = v;
				v = a;
			} else v = /* @__PURE__ */ new Map([[k, v]]);
		}
		return createNode.createNode(v, void 0, {
			aliasDuplicateObjects: false,
			keepUndefined: false,
			onAnchor: () => {
				throw new Error("This should not happen, please report a bug.");
			},
			schema,
			sourceObjects: /* @__PURE__ */ new Map()
		});
	}
	const isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
	var Collection = class extends Node.NodeBase {
		constructor(type, schema) {
			super(type);
			Object.defineProperty(this, "schema", {
				value: schema,
				configurable: true,
				enumerable: false,
				writable: true
			});
		}
		/**
		* Create a copy of this collection.
		*
		* @param schema - If defined, overwrites the original's schema
		*/
		clone(schema) {
			const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
			if (schema) copy.schema = schema;
			copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
			if (this.range) copy.range = this.range.slice();
			return copy;
		}
		/**
		* Adds a value to the collection. For `!!map` and `!!omap` the value must
		* be a Pair instance or a `{ key, value }` object, which may not have a key
		* that already exists in the map.
		*/
		addIn(path, value) {
			if (isEmptyPath(path)) this.add(value);
			else {
				const [key, ...rest] = path;
				const node = this.get(key, true);
				if (identity.isCollection(node)) node.addIn(rest, value);
				else if (node === void 0 && this.schema) this.set(key, collectionFromPath(this.schema, rest, value));
				else throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
			}
		}
		/**
		* Removes a value from the collection.
		* @returns `true` if the item was found and removed.
		*/
		deleteIn(path) {
			const [key, ...rest] = path;
			if (rest.length === 0) return this.delete(key);
			const node = this.get(key, true);
			if (identity.isCollection(node)) return node.deleteIn(rest);
			else throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
		}
		/**
		* Returns item at `key`, or `undefined` if not found. By default unwraps
		* scalar values from their surrounding node; to disable set `keepScalar` to
		* `true` (collections are always returned intact).
		*/
		getIn(path, keepScalar) {
			const [key, ...rest] = path;
			const node = this.get(key, true);
			if (rest.length === 0) return !keepScalar && identity.isScalar(node) ? node.value : node;
			else return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
		}
		hasAllNullValues(allowScalar) {
			return this.items.every((node) => {
				if (!identity.isPair(node)) return false;
				const n = node.value;
				return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
			});
		}
		/**
		* Checks if the collection includes a value with the key `key`.
		*/
		hasIn(path) {
			const [key, ...rest] = path;
			if (rest.length === 0) return this.has(key);
			const node = this.get(key, true);
			return identity.isCollection(node) ? node.hasIn(rest) : false;
		}
		/**
		* Sets a value in this collection. For `!!set`, `value` needs to be a
		* boolean to add/remove the item from the set.
		*/
		setIn(path, value) {
			const [key, ...rest] = path;
			if (rest.length === 0) this.set(key, value);
			else {
				const node = this.get(key, true);
				if (identity.isCollection(node)) node.setIn(rest, value);
				else if (node === void 0 && this.schema) this.set(key, collectionFromPath(this.schema, rest, value));
				else throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
			}
		}
	};
	exports.Collection = Collection;
	exports.collectionFromPath = collectionFromPath;
	exports.isEmptyPath = isEmptyPath;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Stringifies a comment.
	*
	* Empty comment lines are left empty,
	* lines consisting of a single space are replaced by `#`,
	* and all other lines are prefixed with a `#`.
	*/
	const stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
	function indentComment(comment, indent) {
		if (/^\n+$/.test(comment)) return comment.substring(1);
		return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
	}
	const lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
	exports.indentComment = indentComment;
	exports.lineComment = lineComment;
	exports.stringifyComment = stringifyComment;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = /* @__PURE__ */ __commonJSMin(((exports) => {
	const FOLD_FLOW = "flow";
	const FOLD_BLOCK = "block";
	const FOLD_QUOTED = "quoted";
	/**
	* Tries to keep input at up to `lineWidth` characters, splitting only on spaces
	* not followed by newlines or spaces unless `mode` is `'quoted'`. Lines are
	* terminated with `\n` and started with `indent`.
	*/
	function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
		if (!lineWidth || lineWidth < 0) return text;
		if (lineWidth < minContentWidth) minContentWidth = 0;
		const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
		if (text.length <= endStep) return text;
		const folds = [];
		const escapedFolds = {};
		let end = lineWidth - indent.length;
		if (typeof indentAtStart === "number") {
			if (indentAtStart > lineWidth - Math.max(2, minContentWidth)) folds.push(0);
			else end = lineWidth - indentAtStart;
		}
		let split = void 0;
		let prev = void 0;
		let overflow = false;
		let i = -1;
		let escStart = -1;
		let escEnd = -1;
		if (mode === FOLD_BLOCK) {
			i = consumeMoreIndentedLines(text, i, indent.length);
			if (i !== -1) end = i + endStep;
		}
		for (let ch; ch = text[i += 1];) {
			if (mode === FOLD_QUOTED && ch === "\\") {
				escStart = i;
				switch (text[i + 1]) {
					case "x":
						i += 3;
						break;
					case "u":
						i += 5;
						break;
					case "U":
						i += 9;
						break;
					default: i += 1;
				}
				escEnd = i;
			}
			if (ch === "\n") {
				if (mode === FOLD_BLOCK) i = consumeMoreIndentedLines(text, i, indent.length);
				end = i + indent.length + endStep;
				split = void 0;
			} else {
				if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
					const next = text[i + 1];
					if (next && next !== " " && next !== "\n" && next !== "	") split = i;
				}
				if (i >= end) {
					if (split) {
						folds.push(split);
						end = split + endStep;
						split = void 0;
					} else if (mode === FOLD_QUOTED) {
						while (prev === " " || prev === "	") {
							prev = ch;
							ch = text[i += 1];
							overflow = true;
						}
						const j = i > escEnd + 1 ? i - 2 : escStart - 1;
						if (escapedFolds[j]) return text;
						folds.push(j);
						escapedFolds[j] = true;
						end = j + endStep;
						split = void 0;
					} else overflow = true;
				}
			}
			prev = ch;
		}
		if (overflow && onOverflow) onOverflow();
		if (folds.length === 0) return text;
		if (onFold) onFold();
		let res = text.slice(0, folds[0]);
		for (let i = 0; i < folds.length; ++i) {
			const fold = folds[i];
			const end = folds[i + 1] || text.length;
			if (fold === 0) res = `\n${indent}${text.slice(0, end)}`;
			else {
				if (mode === FOLD_QUOTED && escapedFolds[fold]) res += `${text[fold]}\\`;
				res += `\n${indent}${text.slice(fold + 1, end)}`;
			}
		}
		return res;
	}
	/**
	* Presumes `i + 1` is at the start of a line
	* @returns index of last newline in more-indented block
	*/
	function consumeMoreIndentedLines(text, i, indent) {
		let end = i;
		let start = i + 1;
		let ch = text[start];
		while (ch === " " || ch === "	") if (i < start + indent) ch = text[++i];
		else {
			do
				ch = text[++i];
			while (ch && ch !== "\n");
			end = i;
			start = i + 1;
			ch = text[start];
		}
		return end;
	}
	exports.FOLD_BLOCK = FOLD_BLOCK;
	exports.FOLD_FLOW = FOLD_FLOW;
	exports.FOLD_QUOTED = FOLD_QUOTED;
	exports.foldFlowLines = foldFlowLines;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var foldFlowLines = require_foldFlowLines();
	const getFoldOptions = (ctx, isBlock) => ({
		indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
		lineWidth: ctx.options.lineWidth,
		minContentWidth: ctx.options.minContentWidth
	});
	const containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
	function lineLengthOverLimit(str, lineWidth, indentLength) {
		if (!lineWidth || lineWidth < 0) return false;
		const limit = lineWidth - indentLength;
		const strLen = str.length;
		if (strLen <= limit) return false;
		for (let i = 0, start = 0; i < strLen; ++i) if (str[i] === "\n") {
			if (i - start > limit) return true;
			start = i + 1;
			if (strLen - start <= limit) return false;
		}
		return true;
	}
	function doubleQuotedString(value, ctx) {
		const json = JSON.stringify(value);
		if (ctx.options.doubleQuotedAsJSON) return json;
		const { implicitKey } = ctx;
		const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
		const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
		let str = "";
		let start = 0;
		for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
			if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
				str += json.slice(start, i) + "\\ ";
				i += 1;
				start = i;
				ch = "\\";
			}
			if (ch === "\\") switch (json[i + 1]) {
				case "u":
					{
						str += json.slice(start, i);
						const code = json.substr(i + 2, 4);
						switch (code) {
							case "0000":
								str += "\\0";
								break;
							case "0007":
								str += "\\a";
								break;
							case "000b":
								str += "\\v";
								break;
							case "001b":
								str += "\\e";
								break;
							case "0085":
								str += "\\N";
								break;
							case "00a0":
								str += "\\_";
								break;
							case "2028":
								str += "\\L";
								break;
							case "2029":
								str += "\\P";
								break;
							default: if (code.substr(0, 2) === "00") str += "\\x" + code.substr(2);
							else str += json.substr(i, 6);
						}
						i += 5;
						start = i + 1;
					}
					break;
				case "n":
					if (implicitKey || json[i + 2] === "\"" || json.length < minMultiLineLength) i += 1;
					else {
						str += json.slice(start, i) + "\n\n";
						while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== "\"") {
							str += "\n";
							i += 2;
						}
						str += indent;
						if (json[i + 2] === " ") str += "\\";
						i += 1;
						start = i + 1;
					}
					break;
				default: i += 1;
			}
		}
		str = start ? str + json.slice(start) : json;
		return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
	}
	function singleQuotedString(value, ctx) {
		if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value)) return doubleQuotedString(value, ctx);
		const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
		const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&\n${indent}`) + "'";
		return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
	}
	function quotedString(value, ctx) {
		const { singleQuote } = ctx.options;
		let qs;
		if (singleQuote === false) qs = doubleQuotedString;
		else {
			const hasDouble = value.includes("\"");
			const hasSingle = value.includes("'");
			if (hasDouble && !hasSingle) qs = singleQuotedString;
			else if (hasSingle && !hasDouble) qs = doubleQuotedString;
			else qs = singleQuote ? singleQuotedString : doubleQuotedString;
		}
		return qs(value, ctx);
	}
	let blockEndNewlines;
	try {
		blockEndNewlines = /* @__PURE__ */ new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
	} catch {
		blockEndNewlines = /\n+(?!\n|$)/g;
	}
	function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
		const { blockQuote, commentString, lineWidth } = ctx.options;
		if (!blockQuote || /\n[\t ]+$/.test(value)) return quotedString(value, ctx);
		const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
		const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
		if (!value) return literal ? "|\n" : ">\n";
		let chomp;
		let endStart;
		for (endStart = value.length; endStart > 0; --endStart) {
			const ch = value[endStart - 1];
			if (ch !== "\n" && ch !== "	" && ch !== " ") break;
		}
		let end = value.substring(endStart);
		const endNlPos = end.indexOf("\n");
		if (endNlPos === -1) chomp = "-";
		else if (value === end || endNlPos !== end.length - 1) {
			chomp = "+";
			if (onChompKeep) onChompKeep();
		} else chomp = "";
		if (end) {
			value = value.slice(0, -end.length);
			if (end[end.length - 1] === "\n") end = end.slice(0, -1);
			end = end.replace(blockEndNewlines, `$&${indent}`);
		}
		let startWithSpace = false;
		let startEnd;
		let startNlPos = -1;
		for (startEnd = 0; startEnd < value.length; ++startEnd) {
			const ch = value[startEnd];
			if (ch === " ") startWithSpace = true;
			else if (ch === "\n") startNlPos = startEnd;
			else break;
		}
		let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
		if (start) {
			value = value.substring(start.length);
			start = start.replace(/\n+/g, `$&${indent}`);
		}
		let header = (startWithSpace ? indent ? "2" : "1" : "") + chomp;
		if (comment) {
			header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
			if (onComment) onComment();
		}
		if (!literal) {
			const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
			let literalFallback = false;
			const foldOptions = getFoldOptions(ctx, true);
			if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) foldOptions.onOverflow = () => {
				literalFallback = true;
			};
			const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
			if (!literalFallback) return `>${header}\n${indent}${body}`;
		}
		value = value.replace(/\n+/g, `$&${indent}`);
		return `|${header}\n${indent}${start}${value}${end}`;
	}
	function plainString(item, ctx, onComment, onChompKeep) {
		const { type, value } = item;
		const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
		if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) return quotedString(value, ctx);
		if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
		if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) return blockString(item, ctx, onComment, onChompKeep);
		if (containsDocumentMarker(value)) {
			if (indent === "") {
				ctx.forceBlockIndent = true;
				return blockString(item, ctx, onComment, onChompKeep);
			} else if (implicitKey && indent === indentStep) return quotedString(value, ctx);
		}
		const str = value.replace(/\n+/g, `$&\n${indent}`);
		if (actualString) {
			const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
			const { compat, tags } = ctx.doc.schema;
			if (tags.some(test) || compat?.some(test)) return quotedString(value, ctx);
		}
		return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
	}
	function stringifyString(item, ctx, onComment, onChompKeep) {
		const { implicitKey, inFlow } = ctx;
		const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
		let { type } = item;
		if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
			if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value)) type = Scalar.Scalar.QUOTE_DOUBLE;
		}
		const _stringify = (_type) => {
			switch (_type) {
				case Scalar.Scalar.BLOCK_FOLDED:
				case Scalar.Scalar.BLOCK_LITERAL: return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
				case Scalar.Scalar.QUOTE_DOUBLE: return doubleQuotedString(ss.value, ctx);
				case Scalar.Scalar.QUOTE_SINGLE: return singleQuotedString(ss.value, ctx);
				case Scalar.Scalar.PLAIN: return plainString(ss, ctx, onComment, onChompKeep);
				default: return null;
			}
		};
		let res = _stringify(type);
		if (res === null) {
			const { defaultKeyType, defaultStringType } = ctx.options;
			const t = implicitKey && defaultKeyType || defaultStringType;
			res = _stringify(t);
			if (res === null) throw new Error(`Unsupported default string type ${t}`);
		}
		return res;
	}
	exports.stringifyString = stringifyString;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringify.js
var require_stringify = /* @__PURE__ */ __commonJSMin(((exports) => {
	var anchors = require_anchors();
	var identity = require_identity();
	var stringifyComment = require_stringifyComment();
	var stringifyString = require_stringifyString();
	function createStringifyContext(doc, options) {
		const opt = Object.assign({
			blockQuote: true,
			commentString: stringifyComment.stringifyComment,
			defaultKeyType: null,
			defaultStringType: "PLAIN",
			directives: null,
			doubleQuotedAsJSON: false,
			doubleQuotedMinMultiLineLength: 40,
			falseStr: "false",
			flowCollectionPadding: true,
			indentSeq: true,
			lineWidth: 80,
			minContentWidth: 20,
			nullStr: "null",
			simpleKeys: false,
			singleQuote: null,
			trailingComma: false,
			trueStr: "true",
			verifyAliasOrder: true
		}, doc.schema.toStringOptions, options);
		let inFlow;
		switch (opt.collectionStyle) {
			case "block":
				inFlow = false;
				break;
			case "flow":
				inFlow = true;
				break;
			default: inFlow = null;
		}
		return {
			anchors: /* @__PURE__ */ new Set(),
			doc,
			flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
			indent: "",
			indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
			inFlow,
			options: opt
		};
	}
	function getTagObject(tags, item) {
		if (item.tag) {
			const match = tags.filter((t) => t.tag === item.tag);
			if (match.length > 0) return match.find((t) => t.format === item.format) ?? match[0];
		}
		let tagObj = void 0;
		let obj;
		if (identity.isScalar(item)) {
			obj = item.value;
			let match = tags.filter((t) => t.identify?.(obj));
			if (match.length > 1) {
				const testMatch = match.filter((t) => t.test);
				if (testMatch.length > 0) match = testMatch;
			}
			tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
		} else {
			obj = item;
			tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
		}
		if (!tagObj) {
			const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
			throw new Error(`Tag not resolved for ${name} value`);
		}
		return tagObj;
	}
	function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
		if (!doc.directives) return "";
		const props = [];
		const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
		if (anchor && anchors.anchorIsValid(anchor)) {
			anchors$1.add(anchor);
			props.push(`&${anchor}`);
		}
		const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
		if (tag) props.push(doc.directives.tagString(tag));
		return props.join(" ");
	}
	function stringify(item, ctx, onComment, onChompKeep) {
		if (identity.isPair(item)) return item.toString(ctx, onComment, onChompKeep);
		if (identity.isAlias(item)) {
			if (ctx.doc.directives) return item.toString(ctx);
			if (ctx.resolvedAliases?.has(item)) throw new TypeError(`Cannot stringify circular structure without alias nodes`);
			else {
				if (ctx.resolvedAliases) ctx.resolvedAliases.add(item);
				else ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
				item = item.resolve(ctx.doc);
			}
		}
		let tagObj = void 0;
		const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
		tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
		const props = stringifyProps(node, tagObj, ctx);
		if (props.length > 0) ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
		const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
		if (!props) return str;
		return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}\n${ctx.indent}${str}`;
	}
	exports.createStringifyContext = createStringifyContext;
	exports.stringify = stringify;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Scalar = require_Scalar();
	var stringify = require_stringify();
	var stringifyComment = require_stringifyComment();
	function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
		const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
		let keyComment = identity.isNode(key) && key.comment || null;
		if (simpleKeys) {
			if (keyComment) throw new Error("With simple keys, key nodes cannot have comments");
			if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") throw new Error("With simple keys, collection cannot be used as a key value");
		}
		let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
		ctx = Object.assign({}, ctx, {
			allNullValues: false,
			implicitKey: !explicitKey && (simpleKeys || !allNullValues),
			indent: indent + indentStep
		});
		let keyCommentDone = false;
		let chompKeep = false;
		let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
		if (!explicitKey && !ctx.inFlow && str.length > 1024) {
			if (simpleKeys) throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
			explicitKey = true;
		}
		if (ctx.inFlow) {
			if (allNullValues || value == null) {
				if (keyCommentDone && onComment) onComment();
				return str === "" ? "?" : explicitKey ? `? ${str}` : str;
			}
		} else if (allNullValues && !simpleKeys || value == null && explicitKey) {
			str = `? ${str}`;
			if (keyComment && !keyCommentDone) str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
			else if (chompKeep && onChompKeep) onChompKeep();
			return str;
		}
		if (keyCommentDone) keyComment = null;
		if (explicitKey) {
			if (keyComment) str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
			str = `? ${str}\n${indent}:`;
		} else {
			str = `${str}:`;
			if (keyComment) str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
		}
		let vsb, vcb, valueComment;
		if (identity.isNode(value)) {
			vsb = !!value.spaceBefore;
			vcb = value.commentBefore;
			valueComment = value.comment;
		} else {
			vsb = false;
			vcb = null;
			valueComment = null;
			if (value && typeof value === "object") value = doc.createNode(value);
		}
		ctx.implicitKey = false;
		if (!explicitKey && !keyComment && identity.isScalar(value)) ctx.indentAtStart = str.length + 1;
		chompKeep = false;
		if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) ctx.indent = ctx.indent.substring(2);
		let valueCommentDone = false;
		const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
		let ws = " ";
		if (keyComment || vsb || vcb) {
			ws = vsb ? "\n" : "";
			if (vcb) {
				const cs = commentString(vcb);
				ws += `\n${stringifyComment.indentComment(cs, ctx.indent)}`;
			}
			if (valueStr === "" && !ctx.inFlow) {
				if (ws === "\n" && valueComment) ws = "\n\n";
			} else ws += `\n${ctx.indent}`;
		} else if (!explicitKey && identity.isCollection(value)) {
			const vs0 = valueStr[0];
			const nl0 = valueStr.indexOf("\n");
			const hasNewline = nl0 !== -1;
			const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
			if (hasNewline || !flow) {
				let hasPropsLine = false;
				if (hasNewline && (vs0 === "&" || vs0 === "!")) {
					let sp0 = valueStr.indexOf(" ");
					if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") sp0 = valueStr.indexOf(" ", sp0 + 1);
					if (sp0 === -1 || nl0 < sp0) hasPropsLine = true;
				}
				if (!hasPropsLine) ws = `\n${ctx.indent}`;
			}
		} else if (valueStr === "" || valueStr[0] === "\n") ws = "";
		str += ws + valueStr;
		if (ctx.inFlow) {
			if (valueCommentDone && onComment) onComment();
		} else if (valueComment && !valueCommentDone) str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
		else if (chompKeep && onChompKeep) onChompKeep();
		return str;
	}
	exports.stringifyPair = stringifyPair;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/log.js
var require_log = /* @__PURE__ */ __commonJSMin(((exports) => {
	var node_process$2 = __require("process");
	function debug(logLevel, ...messages) {
		if (logLevel === "debug") console.log(...messages);
	}
	function warn(logLevel, warning) {
		if (logLevel === "debug" || logLevel === "warn") {
			if (typeof node_process$2.emitWarning === "function") node_process$2.emitWarning(warning);
			else console.warn(warning);
		}
	}
	exports.debug = debug;
	exports.warn = warn;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Scalar = require_Scalar();
	const MERGE_KEY = "<<";
	const merge = {
		identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
		default: "key",
		tag: "tag:yaml.org,2002:merge",
		test: /^<<$/,
		resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), { addToJSMap: addMergeToJSMap }),
		stringify: () => MERGE_KEY
	};
	const isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
	function addMergeToJSMap(ctx, map, value) {
		const source = resolveAliasValue(ctx, value);
		if (identity.isSeq(source)) for (const it of source.items) mergeValue(ctx, map, it);
		else if (Array.isArray(source)) for (const it of source) mergeValue(ctx, map, it);
		else mergeValue(ctx, map, source);
	}
	function mergeValue(ctx, map, value) {
		const source = resolveAliasValue(ctx, value);
		if (!identity.isMap(source)) throw new Error("Merge sources must be maps or map aliases");
		const srcMap = source.toJSON(null, ctx, Map);
		for (const [key, value] of srcMap) if (map instanceof Map) {
			if (!map.has(key)) map.set(key, value);
		} else if (map instanceof Set) map.add(key);
		else if (!Object.prototype.hasOwnProperty.call(map, key)) Object.defineProperty(map, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true
		});
		return map;
	}
	function resolveAliasValue(ctx, value) {
		return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
	}
	exports.addMergeToJSMap = addMergeToJSMap;
	exports.isMergeKey = isMergeKey;
	exports.merge = merge;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = /* @__PURE__ */ __commonJSMin(((exports) => {
	var log = require_log();
	var merge = require_merge();
	var stringify = require_stringify();
	var identity = require_identity();
	var toJS = require_toJS();
	function addPairToJSMap(ctx, map, { key, value }) {
		if (identity.isNode(key) && key.addToJSMap) key.addToJSMap(ctx, map, value);
		else if (merge.isMergeKey(ctx, key)) merge.addMergeToJSMap(ctx, map, value);
		else {
			const jsKey = toJS.toJS(key, "", ctx);
			if (map instanceof Map) map.set(jsKey, toJS.toJS(value, jsKey, ctx));
			else if (map instanceof Set) map.add(jsKey);
			else {
				const stringKey = stringifyKey(key, jsKey, ctx);
				const jsValue = toJS.toJS(value, stringKey, ctx);
				if (stringKey in map) Object.defineProperty(map, stringKey, {
					value: jsValue,
					writable: true,
					enumerable: true,
					configurable: true
				});
				else map[stringKey] = jsValue;
			}
		}
		return map;
	}
	function stringifyKey(key, jsKey, ctx) {
		if (jsKey === null) return "";
		if (typeof jsKey !== "object") return String(jsKey);
		if (identity.isNode(key) && ctx?.doc) {
			const strCtx = stringify.createStringifyContext(ctx.doc, {});
			strCtx.anchors = /* @__PURE__ */ new Set();
			for (const node of ctx.anchors.keys()) strCtx.anchors.add(node.anchor);
			strCtx.inFlow = true;
			strCtx.inStringifyKey = true;
			const strKey = key.toString(strCtx);
			if (!ctx.mapKeyWarned) {
				let jsonStr = JSON.stringify(strKey);
				if (jsonStr.length > 40) jsonStr = jsonStr.substring(0, 36) + "...\"";
				log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
				ctx.mapKeyWarned = true;
			}
			return strKey;
		}
		return JSON.stringify(jsKey);
	}
	exports.addPairToJSMap = addPairToJSMap;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Pair.js
var require_Pair = /* @__PURE__ */ __commonJSMin(((exports) => {
	var createNode = require_createNode();
	var stringifyPair = require_stringifyPair();
	var addPairToJSMap = require_addPairToJSMap();
	var identity = require_identity();
	function createPair(key, value, ctx) {
		return new Pair(createNode.createNode(key, void 0, ctx), createNode.createNode(value, void 0, ctx));
	}
	var Pair = class Pair {
		constructor(key, value = null) {
			Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
			this.key = key;
			this.value = value;
		}
		clone(schema) {
			let { key, value } = this;
			if (identity.isNode(key)) key = key.clone(schema);
			if (identity.isNode(value)) value = value.clone(schema);
			return new Pair(key, value);
		}
		toJSON(_, ctx) {
			const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
			return addPairToJSMap.addPairToJSMap(ctx, pair, this);
		}
		toString(ctx, onComment, onChompKeep) {
			return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
		}
	};
	exports.Pair = Pair;
	exports.createPair = createPair;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var stringify = require_stringify();
	var stringifyComment = require_stringifyComment();
	function stringifyCollection(collection, ctx, options) {
		return (ctx.inFlow ?? collection.flow ? stringifyFlowCollection : stringifyBlockCollection)(collection, ctx, options);
	}
	function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
		const { indent, options: { commentString } } = ctx;
		const itemCtx = Object.assign({}, ctx, {
			indent: itemIndent,
			type: null
		});
		let chompKeep = false;
		const lines = [];
		for (let i = 0; i < items.length; ++i) {
			const item = items[i];
			let comment = null;
			if (identity.isNode(item)) {
				if (!chompKeep && item.spaceBefore) lines.push("");
				addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
				if (item.comment) comment = item.comment;
			} else if (identity.isPair(item)) {
				const ik = identity.isNode(item.key) ? item.key : null;
				if (ik) {
					if (!chompKeep && ik.spaceBefore) lines.push("");
					addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
				}
			}
			chompKeep = false;
			let str = stringify.stringify(item, itemCtx, () => comment = null, () => chompKeep = true);
			if (comment) str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
			if (chompKeep && comment) chompKeep = false;
			lines.push(blockItemPrefix + str);
		}
		let str;
		if (lines.length === 0) str = flowChars.start + flowChars.end;
		else {
			str = lines[0];
			for (let i = 1; i < lines.length; ++i) {
				const line = lines[i];
				str += line ? `\n${indent}${line}` : "\n";
			}
		}
		if (comment) {
			str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
			if (onComment) onComment();
		} else if (chompKeep && onChompKeep) onChompKeep();
		return str;
	}
	function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
		const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
		itemIndent += indentStep;
		const itemCtx = Object.assign({}, ctx, {
			indent: itemIndent,
			inFlow: true,
			type: null
		});
		let reqNewline = false;
		let linesAtValue = 0;
		const lines = [];
		for (let i = 0; i < items.length; ++i) {
			const item = items[i];
			let comment = null;
			if (identity.isNode(item)) {
				if (item.spaceBefore) lines.push("");
				addCommentBefore(ctx, lines, item.commentBefore, false);
				if (item.comment) comment = item.comment;
			} else if (identity.isPair(item)) {
				const ik = identity.isNode(item.key) ? item.key : null;
				if (ik) {
					if (ik.spaceBefore) lines.push("");
					addCommentBefore(ctx, lines, ik.commentBefore, false);
					if (ik.comment) reqNewline = true;
				}
				const iv = identity.isNode(item.value) ? item.value : null;
				if (iv) {
					if (iv.comment) comment = iv.comment;
					if (iv.commentBefore) reqNewline = true;
				} else if (item.value == null && ik?.comment) comment = ik.comment;
			}
			if (comment) reqNewline = true;
			let str = stringify.stringify(item, itemCtx, () => comment = null);
			reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
			if (i < items.length - 1) str += ",";
			else if (ctx.options.trailingComma) {
				if (ctx.options.lineWidth > 0) reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
				if (reqNewline) str += ",";
			}
			if (comment) str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
			lines.push(str);
			linesAtValue = lines.length;
		}
		const { start, end } = flowChars;
		if (lines.length === 0) return start + end;
		else {
			if (!reqNewline) {
				const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
				reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
			}
			if (reqNewline) {
				let str = start;
				for (const line of lines) str += line ? `\n${indentStep}${indent}${line}` : "\n";
				return `${str}\n${indent}${end}`;
			} else return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
		}
	}
	function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
		if (comment && chompKeep) comment = comment.replace(/^\n+/, "");
		if (comment) {
			const ic = stringifyComment.indentComment(commentString(comment), indent);
			lines.push(ic.trimStart());
		}
	}
	exports.stringifyCollection = stringifyCollection;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyCollection = require_stringifyCollection();
	var addPairToJSMap = require_addPairToJSMap();
	var Collection = require_Collection();
	var identity = require_identity();
	var Pair = require_Pair();
	var Scalar = require_Scalar();
	function findPair(items, key) {
		const k = identity.isScalar(key) ? key.value : key;
		for (const it of items) if (identity.isPair(it)) {
			if (it.key === key || it.key === k) return it;
			if (identity.isScalar(it.key) && it.key.value === k) return it;
		}
	}
	var YAMLMap = class extends Collection.Collection {
		static get tagName() {
			return "tag:yaml.org,2002:map";
		}
		constructor(schema) {
			super(identity.MAP, schema);
			this.items = [];
		}
		/**
		* A generic collection parsing method that can be extended
		* to other node classes that inherit from YAMLMap
		*/
		static from(schema, obj, ctx) {
			const { keepUndefined, replacer } = ctx;
			const map = new this(schema);
			const add = (key, value) => {
				if (typeof replacer === "function") value = replacer.call(obj, key, value);
				else if (Array.isArray(replacer) && !replacer.includes(key)) return;
				if (value !== void 0 || keepUndefined) map.items.push(Pair.createPair(key, value, ctx));
			};
			if (obj instanceof Map) for (const [key, value] of obj) add(key, value);
			else if (obj && typeof obj === "object") for (const key of Object.keys(obj)) add(key, obj[key]);
			if (typeof schema.sortMapEntries === "function") map.items.sort(schema.sortMapEntries);
			return map;
		}
		/**
		* Adds a value to the collection.
		*
		* @param overwrite - If not set `true`, using a key that is already in the
		*   collection will throw. Otherwise, overwrites the previous value.
		*/
		add(pair, overwrite) {
			let _pair;
			if (identity.isPair(pair)) _pair = pair;
			else if (!pair || typeof pair !== "object" || !("key" in pair)) _pair = new Pair.Pair(pair, pair?.value);
			else _pair = new Pair.Pair(pair.key, pair.value);
			const prev = findPair(this.items, _pair.key);
			const sortEntries = this.schema?.sortMapEntries;
			if (prev) {
				if (!overwrite) throw new Error(`Key ${_pair.key} already set`);
				if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value)) prev.value.value = _pair.value;
				else prev.value = _pair.value;
			} else if (sortEntries) {
				const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
				if (i === -1) this.items.push(_pair);
				else this.items.splice(i, 0, _pair);
			} else this.items.push(_pair);
		}
		delete(key) {
			const it = findPair(this.items, key);
			if (!it) return false;
			return this.items.splice(this.items.indexOf(it), 1).length > 0;
		}
		get(key, keepScalar) {
			const node = findPair(this.items, key)?.value;
			return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
		}
		has(key) {
			return !!findPair(this.items, key);
		}
		set(key, value) {
			this.add(new Pair.Pair(key, value), true);
		}
		/**
		* @param ctx - Conversion context, originally set in Document#toJS()
		* @param {Class} Type - If set, forces the returned collection type
		* @returns Instance of Type, Map, or Object
		*/
		toJSON(_, ctx, Type) {
			const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
			if (ctx?.onCreate) ctx.onCreate(map);
			for (const item of this.items) addPairToJSMap.addPairToJSMap(ctx, map, item);
			return map;
		}
		toString(ctx, onComment, onChompKeep) {
			if (!ctx) return JSON.stringify(this);
			for (const item of this.items) if (!identity.isPair(item)) throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
			if (!ctx.allNullValues && this.hasAllNullValues(false)) ctx = Object.assign({}, ctx, { allNullValues: true });
			return stringifyCollection.stringifyCollection(this, ctx, {
				blockItemPrefix: "",
				flowChars: {
					start: "{",
					end: "}"
				},
				itemIndent: ctx.indent || "",
				onChompKeep,
				onComment
			});
		}
	};
	exports.YAMLMap = YAMLMap;
	exports.findPair = findPair;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/map.js
var require_map = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var YAMLMap = require_YAMLMap();
	exports.map = {
		collection: "map",
		default: true,
		nodeClass: YAMLMap.YAMLMap,
		tag: "tag:yaml.org,2002:map",
		resolve(map, onError) {
			if (!identity.isMap(map)) onError("Expected a mapping for this tag");
			return map;
		},
		createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
	};
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = /* @__PURE__ */ __commonJSMin(((exports) => {
	var createNode = require_createNode();
	var stringifyCollection = require_stringifyCollection();
	var Collection = require_Collection();
	var identity = require_identity();
	var Scalar = require_Scalar();
	var toJS = require_toJS();
	var YAMLSeq = class extends Collection.Collection {
		static get tagName() {
			return "tag:yaml.org,2002:seq";
		}
		constructor(schema) {
			super(identity.SEQ, schema);
			this.items = [];
		}
		add(value) {
			this.items.push(value);
		}
		/**
		* Removes a value from the collection.
		*
		* `key` must contain a representation of an integer for this to succeed.
		* It may be wrapped in a `Scalar`.
		*
		* @returns `true` if the item was found and removed.
		*/
		delete(key) {
			const idx = asItemIndex(key);
			if (typeof idx !== "number") return false;
			return this.items.splice(idx, 1).length > 0;
		}
		get(key, keepScalar) {
			const idx = asItemIndex(key);
			if (typeof idx !== "number") return void 0;
			const it = this.items[idx];
			return !keepScalar && identity.isScalar(it) ? it.value : it;
		}
		/**
		* Checks if the collection includes a value with the key `key`.
		*
		* `key` must contain a representation of an integer for this to succeed.
		* It may be wrapped in a `Scalar`.
		*/
		has(key) {
			const idx = asItemIndex(key);
			return typeof idx === "number" && idx < this.items.length;
		}
		/**
		* Sets a value in this collection. For `!!set`, `value` needs to be a
		* boolean to add/remove the item from the set.
		*
		* If `key` does not contain a representation of an integer, this will throw.
		* It may be wrapped in a `Scalar`.
		*/
		set(key, value) {
			const idx = asItemIndex(key);
			if (typeof idx !== "number") throw new Error(`Expected a valid index, not ${key}.`);
			const prev = this.items[idx];
			if (identity.isScalar(prev) && Scalar.isScalarValue(value)) prev.value = value;
			else this.items[idx] = value;
		}
		toJSON(_, ctx) {
			const seq = [];
			if (ctx?.onCreate) ctx.onCreate(seq);
			let i = 0;
			for (const item of this.items) seq.push(toJS.toJS(item, String(i++), ctx));
			return seq;
		}
		toString(ctx, onComment, onChompKeep) {
			if (!ctx) return JSON.stringify(this);
			return stringifyCollection.stringifyCollection(this, ctx, {
				blockItemPrefix: "- ",
				flowChars: {
					start: "[",
					end: "]"
				},
				itemIndent: (ctx.indent || "") + "  ",
				onChompKeep,
				onComment
			});
		}
		static from(schema, obj, ctx) {
			const { replacer } = ctx;
			const seq = new this(schema);
			if (obj && Symbol.iterator in Object(obj)) {
				let i = 0;
				for (let it of obj) {
					if (typeof replacer === "function") {
						const key = obj instanceof Set ? it : String(i++);
						it = replacer.call(obj, key, it);
					}
					seq.items.push(createNode.createNode(it, void 0, ctx));
				}
			}
			return seq;
		}
	};
	function asItemIndex(key) {
		let idx = identity.isScalar(key) ? key.value : key;
		if (idx && typeof idx === "string") idx = Number(idx);
		return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
	}
	exports.YAMLSeq = YAMLSeq;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/seq.js
var require_seq = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var YAMLSeq = require_YAMLSeq();
	exports.seq = {
		collection: "seq",
		default: true,
		nodeClass: YAMLSeq.YAMLSeq,
		tag: "tag:yaml.org,2002:seq",
		resolve(seq, onError) {
			if (!identity.isSeq(seq)) onError("Expected a sequence for this tag");
			return seq;
		},
		createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
	};
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/string.js
var require_string = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyString = require_stringifyString();
	exports.string = {
		identify: (value) => typeof value === "string",
		default: true,
		tag: "tag:yaml.org,2002:str",
		resolve: (str) => str,
		stringify(item, ctx, onComment, onChompKeep) {
			ctx = Object.assign({ actualString: true }, ctx);
			return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/null.js
var require_null = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	const nullTag = {
		identify: (value) => value == null,
		createNode: () => new Scalar.Scalar(null),
		default: true,
		tag: "tag:yaml.org,2002:null",
		test: /^(?:~|[Nn]ull|NULL)?$/,
		resolve: () => new Scalar.Scalar(null),
		stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
	};
	exports.nullTag = nullTag;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/bool.js
var require_bool$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	const boolTag = {
		identify: (value) => typeof value === "boolean",
		default: true,
		tag: "tag:yaml.org,2002:bool",
		test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
		resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
		stringify({ source, value }, ctx) {
			if (source && boolTag.test.test(source)) {
				if (value === (source[0] === "t" || source[0] === "T")) return source;
			}
			return value ? ctx.options.trueStr : ctx.options.falseStr;
		}
	};
	exports.boolTag = boolTag;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = /* @__PURE__ */ __commonJSMin(((exports) => {
	function stringifyNumber({ format, minFractionDigits, tag, value }) {
		if (typeof value === "bigint") return String(value);
		const num = typeof value === "number" ? value : Number(value);
		if (!isFinite(num)) return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
		let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
		if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
			let i = n.indexOf(".");
			if (i < 0) {
				i = n.length;
				n += ".";
			}
			let d = minFractionDigits - (n.length - i - 1);
			while (d-- > 0) n += "0";
		}
		return n;
	}
	exports.stringifyNumber = stringifyNumber;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/float.js
var require_float$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var stringifyNumber = require_stringifyNumber();
	const floatNaN = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
		resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
		stringify: stringifyNumber.stringifyNumber
	};
	const floatExp = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		format: "EXP",
		test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
		resolve: (str) => parseFloat(str),
		stringify(node) {
			const num = Number(node.value);
			return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
		}
	};
	exports.float = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
		resolve(str) {
			const node = new Scalar.Scalar(parseFloat(str));
			const dot = str.indexOf(".");
			if (dot !== -1 && str[str.length - 1] === "0") node.minFractionDigits = str.length - dot - 1;
			return node;
		},
		stringify: stringifyNumber.stringifyNumber
	};
	exports.floatExp = floatExp;
	exports.floatNaN = floatNaN;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/int.js
var require_int$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyNumber = require_stringifyNumber();
	const intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
	const intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
	function intStringify(node, radix, prefix) {
		const { value } = node;
		if (intIdentify(value) && value >= 0) return prefix + value.toString(radix);
		return stringifyNumber.stringifyNumber(node);
	}
	const intOct = {
		identify: (value) => intIdentify(value) && value >= 0,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "OCT",
		test: /^0o[0-7]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
		stringify: (node) => intStringify(node, 8, "0o")
	};
	const int = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		test: /^[-+]?[0-9]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
		stringify: stringifyNumber.stringifyNumber
	};
	const intHex = {
		identify: (value) => intIdentify(value) && value >= 0,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "HEX",
		test: /^0x[0-9a-fA-F]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
		stringify: (node) => intStringify(node, 16, "0x")
	};
	exports.int = int;
	exports.intHex = intHex;
	exports.intOct = intOct;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/schema.js
var require_schema$2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var map = require_map();
	var _null = require_null();
	var seq = require_seq();
	var string = require_string();
	var bool = require_bool$1();
	var float = require_float$1();
	var int = require_int$1();
	exports.schema = [
		map.map,
		seq.seq,
		string.string,
		_null.nullTag,
		bool.boolTag,
		int.intOct,
		int.int,
		int.intHex,
		float.floatNaN,
		float.floatExp,
		float.float
	];
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/json/schema.js
var require_schema$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var map = require_map();
	var seq = require_seq();
	function intIdentify(value) {
		return typeof value === "bigint" || Number.isInteger(value);
	}
	const stringifyJSON = ({ value }) => JSON.stringify(value);
	const jsonScalars = [
		{
			identify: (value) => typeof value === "string",
			default: true,
			tag: "tag:yaml.org,2002:str",
			resolve: (str) => str,
			stringify: stringifyJSON
		},
		{
			identify: (value) => value == null,
			createNode: () => new Scalar.Scalar(null),
			default: true,
			tag: "tag:yaml.org,2002:null",
			test: /^null$/,
			resolve: () => null,
			stringify: stringifyJSON
		},
		{
			identify: (value) => typeof value === "boolean",
			default: true,
			tag: "tag:yaml.org,2002:bool",
			test: /^true$|^false$/,
			resolve: (str) => str === "true",
			stringify: stringifyJSON
		},
		{
			identify: intIdentify,
			default: true,
			tag: "tag:yaml.org,2002:int",
			test: /^-?(?:0|[1-9][0-9]*)$/,
			resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
			stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
		},
		{
			identify: (value) => typeof value === "number",
			default: true,
			tag: "tag:yaml.org,2002:float",
			test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
			resolve: (str) => parseFloat(str),
			stringify: stringifyJSON
		}
	];
	exports.schema = [map.map, seq.seq].concat(jsonScalars, {
		default: true,
		tag: "",
		test: /^/,
		resolve(str, onError) {
			onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
			return str;
		}
	});
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = /* @__PURE__ */ __commonJSMin(((exports) => {
	var node_buffer = __require("buffer");
	var Scalar = require_Scalar();
	var stringifyString = require_stringifyString();
	exports.binary = {
		identify: (value) => value instanceof Uint8Array,
		default: false,
		tag: "tag:yaml.org,2002:binary",
		/**
		* Returns a Buffer in node and an Uint8Array in browsers
		*
		* To use the resulting buffer as an image, you'll want to do something like:
		*
		*   const blob = new Blob([buffer], { type: 'image/jpeg' })
		*   document.querySelector('#photo').src = URL.createObjectURL(blob)
		*/
		resolve(src, onError) {
			if (typeof node_buffer.Buffer === "function") return node_buffer.Buffer.from(src, "base64");
			else if (typeof atob === "function") {
				const str = atob(src.replace(/[\n\r]/g, ""));
				const buffer = new Uint8Array(str.length);
				for (let i = 0; i < str.length; ++i) buffer[i] = str.charCodeAt(i);
				return buffer;
			} else {
				onError("This environment does not support reading binary tags; either Buffer or atob is required");
				return src;
			}
		},
		stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
			if (!value) return "";
			const buf = value;
			let str;
			if (typeof node_buffer.Buffer === "function") str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
			else if (typeof btoa === "function") {
				let s = "";
				for (let i = 0; i < buf.length; ++i) s += String.fromCharCode(buf[i]);
				str = btoa(s);
			} else throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
			type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
			if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
				const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
				const n = Math.ceil(str.length / lineWidth);
				const lines = new Array(n);
				for (let i = 0, o = 0; i < n; ++i, o += lineWidth) lines[i] = str.substr(o, lineWidth);
				str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
			}
			return stringifyString.stringifyString({
				comment,
				type,
				value: str
			}, ctx, onComment, onChompKeep);
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Pair = require_Pair();
	var Scalar = require_Scalar();
	var YAMLSeq = require_YAMLSeq();
	function resolvePairs(seq, onError) {
		if (identity.isSeq(seq)) for (let i = 0; i < seq.items.length; ++i) {
			let item = seq.items[i];
			if (identity.isPair(item)) continue;
			else if (identity.isMap(item)) {
				if (item.items.length > 1) onError("Each pair must have its own sequence indicator");
				const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
				if (item.commentBefore) pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}\n${pair.key.commentBefore}` : item.commentBefore;
				if (item.comment) {
					const cn = pair.value ?? pair.key;
					cn.comment = cn.comment ? `${item.comment}\n${cn.comment}` : item.comment;
				}
				item = pair;
			}
			seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
		}
		else onError("Expected a sequence for this tag");
		return seq;
	}
	function createPairs(schema, iterable, ctx) {
		const { replacer } = ctx;
		const pairs = new YAMLSeq.YAMLSeq(schema);
		pairs.tag = "tag:yaml.org,2002:pairs";
		let i = 0;
		if (iterable && Symbol.iterator in Object(iterable)) for (let it of iterable) {
			if (typeof replacer === "function") it = replacer.call(iterable, String(i++), it);
			let key, value;
			if (Array.isArray(it)) {
				if (it.length === 2) {
					key = it[0];
					value = it[1];
				} else throw new TypeError(`Expected [key, value] tuple: ${it}`);
			} else if (it && it instanceof Object) {
				const keys = Object.keys(it);
				if (keys.length === 1) {
					key = keys[0];
					value = it[key];
				} else throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
			} else key = it;
			pairs.items.push(Pair.createPair(key, value, ctx));
		}
		return pairs;
	}
	const pairs = {
		collection: "seq",
		default: false,
		tag: "tag:yaml.org,2002:pairs",
		resolve: resolvePairs,
		createNode: createPairs
	};
	exports.createPairs = createPairs;
	exports.pairs = pairs;
	exports.resolvePairs = resolvePairs;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var toJS = require_toJS();
	var YAMLMap = require_YAMLMap();
	var YAMLSeq = require_YAMLSeq();
	var pairs = require_pairs();
	var YAMLOMap = class YAMLOMap extends YAMLSeq.YAMLSeq {
		constructor() {
			super();
			this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
			this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
			this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
			this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
			this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
			this.tag = YAMLOMap.tag;
		}
		/**
		* If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
		* but TypeScript won't allow widening the signature of a child method.
		*/
		toJSON(_, ctx) {
			if (!ctx) return super.toJSON(_);
			const map = /* @__PURE__ */ new Map();
			if (ctx?.onCreate) ctx.onCreate(map);
			for (const pair of this.items) {
				let key, value;
				if (identity.isPair(pair)) {
					key = toJS.toJS(pair.key, "", ctx);
					value = toJS.toJS(pair.value, key, ctx);
				} else key = toJS.toJS(pair, "", ctx);
				if (map.has(key)) throw new Error("Ordered maps must not include duplicate keys");
				map.set(key, value);
			}
			return map;
		}
		static from(schema, iterable, ctx) {
			const pairs$1 = pairs.createPairs(schema, iterable, ctx);
			const omap = new this();
			omap.items = pairs$1.items;
			return omap;
		}
	};
	YAMLOMap.tag = "tag:yaml.org,2002:omap";
	const omap = {
		collection: "seq",
		identify: (value) => value instanceof Map,
		nodeClass: YAMLOMap,
		default: false,
		tag: "tag:yaml.org,2002:omap",
		resolve(seq, onError) {
			const pairs$1 = pairs.resolvePairs(seq, onError);
			const seenKeys = [];
			for (const { key } of pairs$1.items) if (identity.isScalar(key)) {
				if (seenKeys.includes(key.value)) onError(`Ordered maps must not include duplicate keys: ${key.value}`);
				else seenKeys.push(key.value);
			}
			return Object.assign(new YAMLOMap(), pairs$1);
		},
		createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
	};
	exports.YAMLOMap = YAMLOMap;
	exports.omap = omap;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	function boolStringify({ value, source }, ctx) {
		if (source && (value ? trueTag : falseTag).test.test(source)) return source;
		return value ? ctx.options.trueStr : ctx.options.falseStr;
	}
	const trueTag = {
		identify: (value) => value === true,
		default: true,
		tag: "tag:yaml.org,2002:bool",
		test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
		resolve: () => new Scalar.Scalar(true),
		stringify: boolStringify
	};
	const falseTag = {
		identify: (value) => value === false,
		default: true,
		tag: "tag:yaml.org,2002:bool",
		test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
		resolve: () => new Scalar.Scalar(false),
		stringify: boolStringify
	};
	exports.falseTag = falseTag;
	exports.trueTag = trueTag;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var stringifyNumber = require_stringifyNumber();
	const floatNaN = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
		resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
		stringify: stringifyNumber.stringifyNumber
	};
	const floatExp = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		format: "EXP",
		test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
		resolve: (str) => parseFloat(str.replace(/_/g, "")),
		stringify(node) {
			const num = Number(node.value);
			return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
		}
	};
	exports.float = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
		resolve(str) {
			const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
			const dot = str.indexOf(".");
			if (dot !== -1) {
				const f = str.substring(dot + 1).replace(/_/g, "");
				if (f[f.length - 1] === "0") node.minFractionDigits = f.length;
			}
			return node;
		},
		stringify: stringifyNumber.stringifyNumber
	};
	exports.floatExp = floatExp;
	exports.floatNaN = floatNaN;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyNumber = require_stringifyNumber();
	const intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
	function intResolve(str, offset, radix, { intAsBigInt }) {
		const sign = str[0];
		if (sign === "-" || sign === "+") offset += 1;
		str = str.substring(offset).replace(/_/g, "");
		if (intAsBigInt) {
			switch (radix) {
				case 2:
					str = `0b${str}`;
					break;
				case 8:
					str = `0o${str}`;
					break;
				case 16: str = `0x${str}`;
			}
			const n = BigInt(str);
			return sign === "-" ? BigInt(-1) * n : n;
		}
		const n = parseInt(str, radix);
		return sign === "-" ? -1 * n : n;
	}
	function intStringify(node, radix, prefix) {
		const { value } = node;
		if (intIdentify(value)) {
			const str = value.toString(radix);
			return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
		}
		return stringifyNumber.stringifyNumber(node);
	}
	const intBin = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "BIN",
		test: /^[-+]?0b[0-1_]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
		stringify: (node) => intStringify(node, 2, "0b")
	};
	const intOct = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "OCT",
		test: /^[-+]?0[0-7_]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
		stringify: (node) => intStringify(node, 8, "0")
	};
	const int = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		test: /^[-+]?[0-9][0-9_]*$/,
		resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
		stringify: stringifyNumber.stringifyNumber
	};
	const intHex = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "HEX",
		test: /^[-+]?0x[0-9a-fA-F_]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
		stringify: (node) => intStringify(node, 16, "0x")
	};
	exports.int = int;
	exports.intBin = intBin;
	exports.intHex = intHex;
	exports.intOct = intOct;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Pair = require_Pair();
	var YAMLMap = require_YAMLMap();
	var YAMLSet = class YAMLSet extends YAMLMap.YAMLMap {
		constructor(schema) {
			super(schema);
			this.tag = YAMLSet.tag;
		}
		add(key) {
			let pair;
			if (identity.isPair(key)) pair = key;
			else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null) pair = new Pair.Pair(key.key, null);
			else pair = new Pair.Pair(key, null);
			if (!YAMLMap.findPair(this.items, pair.key)) this.items.push(pair);
		}
		/**
		* If `keepPair` is `true`, returns the Pair matching `key`.
		* Otherwise, returns the value of that Pair's key.
		*/
		get(key, keepPair) {
			const pair = YAMLMap.findPair(this.items, key);
			return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
		}
		set(key, value) {
			if (typeof value !== "boolean") throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
			const prev = YAMLMap.findPair(this.items, key);
			if (prev && !value) this.items.splice(this.items.indexOf(prev), 1);
			else if (!prev && value) this.items.push(new Pair.Pair(key));
		}
		toJSON(_, ctx) {
			return super.toJSON(_, ctx, Set);
		}
		toString(ctx, onComment, onChompKeep) {
			if (!ctx) return JSON.stringify(this);
			if (this.hasAllNullValues(true)) return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
			else throw new Error("Set items must all have null values");
		}
		static from(schema, iterable, ctx) {
			const { replacer } = ctx;
			const set = new this(schema);
			if (iterable && Symbol.iterator in Object(iterable)) for (let value of iterable) {
				if (typeof replacer === "function") value = replacer.call(iterable, value, value);
				set.items.push(Pair.createPair(value, null, ctx));
			}
			return set;
		}
	};
	YAMLSet.tag = "tag:yaml.org,2002:set";
	const set = {
		collection: "map",
		identify: (value) => value instanceof Set,
		nodeClass: YAMLSet,
		default: false,
		tag: "tag:yaml.org,2002:set",
		createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
		resolve(map, onError) {
			if (identity.isMap(map)) {
				if (map.hasAllNullValues(true)) return Object.assign(new YAMLSet(), map);
				else onError("Set items must all have null values");
			} else onError("Expected a mapping for this tag");
			return map;
		}
	};
	exports.YAMLSet = YAMLSet;
	exports.set = set;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyNumber = require_stringifyNumber();
	/** Internal types handle bigint as number, because TS can't figure it out. */
	function parseSexagesimal(str, asBigInt) {
		const sign = str[0];
		const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
		const num = (n) => asBigInt ? BigInt(n) : Number(n);
		const res = parts.replace(/_/g, "").split(":").reduce((res, p) => res * num(60) + num(p), num(0));
		return sign === "-" ? num(-1) * res : res;
	}
	/**
	* hhhh:mm:ss.sss
	*
	* Internal types handle bigint as number, because TS can't figure it out.
	*/
	function stringifySexagesimal(node) {
		let { value } = node;
		let num = (n) => n;
		if (typeof value === "bigint") num = (n) => BigInt(n);
		else if (isNaN(value) || !isFinite(value)) return stringifyNumber.stringifyNumber(node);
		let sign = "";
		if (value < 0) {
			sign = "-";
			value *= num(-1);
		}
		const _60 = num(60);
		const parts = [value % _60];
		if (value < 60) parts.unshift(0);
		else {
			value = (value - parts[0]) / _60;
			parts.unshift(value % _60);
			if (value >= 60) {
				value = (value - parts[0]) / _60;
				parts.unshift(value);
			}
		}
		return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
	}
	const intTime = {
		identify: (value) => typeof value === "bigint" || Number.isInteger(value),
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "TIME",
		test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
		resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
		stringify: stringifySexagesimal
	};
	const floatTime = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		format: "TIME",
		test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
		resolve: (str) => parseSexagesimal(str, false),
		stringify: stringifySexagesimal
	};
	const timestamp = {
		identify: (value) => value instanceof Date,
		default: true,
		tag: "tag:yaml.org,2002:timestamp",
		test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
		resolve(str) {
			const match = str.match(timestamp.test);
			if (!match) throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
			const [, year, month, day, hour, minute, second] = match.map(Number);
			const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
			let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
			const tz = match[8];
			if (tz && tz !== "Z") {
				let d = parseSexagesimal(tz, false);
				if (Math.abs(d) < 30) d *= 60;
				date -= 6e4 * d;
			}
			return new Date(date);
		},
		stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
	};
	exports.floatTime = floatTime;
	exports.intTime = intTime;
	exports.timestamp = timestamp;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema = /* @__PURE__ */ __commonJSMin(((exports) => {
	var map = require_map();
	var _null = require_null();
	var seq = require_seq();
	var string = require_string();
	var binary = require_binary();
	var bool = require_bool();
	var float = require_float();
	var int = require_int();
	var merge = require_merge();
	var omap = require_omap();
	var pairs = require_pairs();
	var set = require_set();
	var timestamp = require_timestamp();
	exports.schema = [
		map.map,
		seq.seq,
		string.string,
		_null.nullTag,
		bool.trueTag,
		bool.falseTag,
		int.intBin,
		int.intOct,
		int.int,
		int.intHex,
		float.floatNaN,
		float.floatExp,
		float.float,
		binary.binary,
		merge.merge,
		omap.omap,
		pairs.pairs,
		set.set,
		timestamp.intTime,
		timestamp.floatTime,
		timestamp.timestamp
	];
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/tags.js
var require_tags = /* @__PURE__ */ __commonJSMin(((exports) => {
	var map = require_map();
	var _null = require_null();
	var seq = require_seq();
	var string = require_string();
	var bool = require_bool$1();
	var float = require_float$1();
	var int = require_int$1();
	var schema = require_schema$2();
	var schema$1 = require_schema$1();
	var binary = require_binary();
	var merge = require_merge();
	var omap = require_omap();
	var pairs = require_pairs();
	var schema$2 = require_schema();
	var set = require_set();
	var timestamp = require_timestamp();
	const schemas = /* @__PURE__ */ new Map([
		["core", schema.schema],
		["failsafe", [
			map.map,
			seq.seq,
			string.string
		]],
		["json", schema$1.schema],
		["yaml11", schema$2.schema],
		["yaml-1.1", schema$2.schema]
	]);
	const tagsByName = {
		binary: binary.binary,
		bool: bool.boolTag,
		float: float.float,
		floatExp: float.floatExp,
		floatNaN: float.floatNaN,
		floatTime: timestamp.floatTime,
		int: int.int,
		intHex: int.intHex,
		intOct: int.intOct,
		intTime: timestamp.intTime,
		map: map.map,
		merge: merge.merge,
		null: _null.nullTag,
		omap: omap.omap,
		pairs: pairs.pairs,
		seq: seq.seq,
		set: set.set,
		timestamp: timestamp.timestamp
	};
	const coreKnownTags = {
		"tag:yaml.org,2002:binary": binary.binary,
		"tag:yaml.org,2002:merge": merge.merge,
		"tag:yaml.org,2002:omap": omap.omap,
		"tag:yaml.org,2002:pairs": pairs.pairs,
		"tag:yaml.org,2002:set": set.set,
		"tag:yaml.org,2002:timestamp": timestamp.timestamp
	};
	function getTags(customTags, schemaName, addMergeTag) {
		const schemaTags = schemas.get(schemaName);
		if (schemaTags && !customTags) return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
		let tags = schemaTags;
		if (!tags) {
			if (Array.isArray(customTags)) tags = [];
			else {
				const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
				throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
			}
		}
		if (Array.isArray(customTags)) for (const tag of customTags) tags = tags.concat(tag);
		else if (typeof customTags === "function") tags = customTags(tags.slice());
		if (addMergeTag) tags = tags.concat(merge.merge);
		return tags.reduce((tags, tag) => {
			const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
			if (!tagObj) {
				const tagName = JSON.stringify(tag);
				const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
				throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
			}
			if (!tags.includes(tagObj)) tags.push(tagObj);
			return tags;
		}, []);
	}
	exports.coreKnownTags = coreKnownTags;
	exports.getTags = getTags;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/Schema.js
var require_Schema = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var map = require_map();
	var seq = require_seq();
	var string = require_string();
	var tags = require_tags();
	const sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
	exports.Schema = class Schema {
		constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
			this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
			this.name = typeof schema === "string" && schema || "core";
			this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
			this.tags = tags.getTags(customTags, this.name, merge);
			this.toStringOptions = toStringDefaults ?? null;
			Object.defineProperty(this, identity.MAP, { value: map.map });
			Object.defineProperty(this, identity.SCALAR, { value: string.string });
			Object.defineProperty(this, identity.SEQ, { value: seq.seq });
			this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
		}
		clone() {
			const copy = Object.create(Schema.prototype, Object.getOwnPropertyDescriptors(this));
			copy.tags = this.tags.slice();
			return copy;
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var stringify = require_stringify();
	var stringifyComment = require_stringifyComment();
	function stringifyDocument(doc, options) {
		const lines = [];
		let hasDirectives = options.directives === true;
		if (options.directives !== false && doc.directives) {
			const dir = doc.directives.toString(doc);
			if (dir) {
				lines.push(dir);
				hasDirectives = true;
			} else if (doc.directives.docStart) hasDirectives = true;
		}
		if (hasDirectives) lines.push("---");
		const ctx = stringify.createStringifyContext(doc, options);
		const { commentString } = ctx.options;
		if (doc.commentBefore) {
			if (lines.length !== 1) lines.unshift("");
			const cs = commentString(doc.commentBefore);
			lines.unshift(stringifyComment.indentComment(cs, ""));
		}
		let chompKeep = false;
		let contentComment = null;
		if (doc.contents) {
			if (identity.isNode(doc.contents)) {
				if (doc.contents.spaceBefore && hasDirectives) lines.push("");
				if (doc.contents.commentBefore) {
					const cs = commentString(doc.contents.commentBefore);
					lines.push(stringifyComment.indentComment(cs, ""));
				}
				ctx.forceBlockIndent = !!doc.comment;
				contentComment = doc.contents.comment;
			}
			const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
			let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
			if (contentComment) body += stringifyComment.lineComment(body, "", commentString(contentComment));
			if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") lines[lines.length - 1] = `--- ${body}`;
			else lines.push(body);
		} else lines.push(stringify.stringify(doc.contents, ctx));
		if (doc.directives?.docEnd) {
			if (doc.comment) {
				const cs = commentString(doc.comment);
				if (cs.includes("\n")) {
					lines.push("...");
					lines.push(stringifyComment.indentComment(cs, ""));
				} else lines.push(`... ${cs}`);
			} else lines.push("...");
		} else {
			let dc = doc.comment;
			if (dc && chompKeep) dc = dc.replace(/^\n+/, "");
			if (dc) {
				if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "") lines.push("");
				lines.push(stringifyComment.indentComment(commentString(dc), ""));
			}
		}
		return lines.join("\n") + "\n";
	}
	exports.stringifyDocument = stringifyDocument;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/Document.js
var require_Document = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Alias = require_Alias();
	var Collection = require_Collection();
	var identity = require_identity();
	var Pair = require_Pair();
	var toJS = require_toJS();
	var Schema = require_Schema();
	var stringifyDocument = require_stringifyDocument();
	var anchors = require_anchors();
	var applyReviver = require_applyReviver();
	var createNode = require_createNode();
	var directives = require_directives();
	var Document = class Document {
		constructor(value, replacer, options) {
			/** A comment before this Document */
			this.commentBefore = null;
			/** A comment immediately after this Document */
			this.comment = null;
			/** Errors encountered during parsing. */
			this.errors = [];
			/** Warnings encountered during parsing. */
			this.warnings = [];
			Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
			let _replacer = null;
			if (typeof replacer === "function" || Array.isArray(replacer)) _replacer = replacer;
			else if (options === void 0 && replacer) {
				options = replacer;
				replacer = void 0;
			}
			const opt = Object.assign({
				intAsBigInt: false,
				keepSourceTokens: false,
				logLevel: "warn",
				prettyErrors: true,
				strict: true,
				stringKeys: false,
				uniqueKeys: true,
				version: "1.2"
			}, options);
			this.options = opt;
			let { version } = opt;
			if (options?._directives) {
				this.directives = options._directives.atDocument();
				if (this.directives.yaml.explicit) version = this.directives.yaml.version;
			} else this.directives = new directives.Directives({ version });
			this.setSchema(version, options);
			this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
		}
		/**
		* Create a deep copy of this Document and its contents.
		*
		* Custom Node values that inherit from `Object` still refer to their original instances.
		*/
		clone() {
			const copy = Object.create(Document.prototype, { [identity.NODE_TYPE]: { value: identity.DOC } });
			copy.commentBefore = this.commentBefore;
			copy.comment = this.comment;
			copy.errors = this.errors.slice();
			copy.warnings = this.warnings.slice();
			copy.options = Object.assign({}, this.options);
			if (this.directives) copy.directives = this.directives.clone();
			copy.schema = this.schema.clone();
			copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
			if (this.range) copy.range = this.range.slice();
			return copy;
		}
		/** Adds a value to the document. */
		add(value) {
			if (assertCollection(this.contents)) this.contents.add(value);
		}
		/** Adds a value to the document. */
		addIn(path, value) {
			if (assertCollection(this.contents)) this.contents.addIn(path, value);
		}
		/**
		* Create a new `Alias` node, ensuring that the target `node` has the required anchor.
		*
		* If `node` already has an anchor, `name` is ignored.
		* Otherwise, the `node.anchor` value will be set to `name`,
		* or if an anchor with that name is already present in the document,
		* `name` will be used as a prefix for a new unique anchor.
		* If `name` is undefined, the generated anchor will use 'a' as a prefix.
		*/
		createAlias(node, name) {
			if (!node.anchor) {
				const prev = anchors.anchorNames(this);
				node.anchor = !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
			}
			return new Alias.Alias(node.anchor);
		}
		createNode(value, replacer, options) {
			let _replacer = void 0;
			if (typeof replacer === "function") {
				value = replacer.call({ "": value }, "", value);
				_replacer = replacer;
			} else if (Array.isArray(replacer)) {
				const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
				const asStr = replacer.filter(keyToStr).map(String);
				if (asStr.length > 0) replacer = replacer.concat(asStr);
				_replacer = replacer;
			} else if (options === void 0 && replacer) {
				options = replacer;
				replacer = void 0;
			}
			const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
			const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(this, anchorPrefix || "a");
			const ctx = {
				aliasDuplicateObjects: aliasDuplicateObjects ?? true,
				keepUndefined: keepUndefined ?? false,
				onAnchor,
				onTagObj,
				replacer: _replacer,
				schema: this.schema,
				sourceObjects
			};
			const node = createNode.createNode(value, tag, ctx);
			if (flow && identity.isCollection(node)) node.flow = true;
			setAnchors();
			return node;
		}
		/**
		* Convert a key and a value into a `Pair` using the current schema,
		* recursively wrapping all values as `Scalar` or `Collection` nodes.
		*/
		createPair(key, value, options = {}) {
			const k = this.createNode(key, null, options);
			const v = this.createNode(value, null, options);
			return new Pair.Pair(k, v);
		}
		/**
		* Removes a value from the document.
		* @returns `true` if the item was found and removed.
		*/
		delete(key) {
			return assertCollection(this.contents) ? this.contents.delete(key) : false;
		}
		/**
		* Removes a value from the document.
		* @returns `true` if the item was found and removed.
		*/
		deleteIn(path) {
			if (Collection.isEmptyPath(path)) {
				if (this.contents == null) return false;
				this.contents = null;
				return true;
			}
			return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
		}
		/**
		* Returns item at `key`, or `undefined` if not found. By default unwraps
		* scalar values from their surrounding node; to disable set `keepScalar` to
		* `true` (collections are always returned intact).
		*/
		get(key, keepScalar) {
			return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
		}
		/**
		* Returns item at `path`, or `undefined` if not found. By default unwraps
		* scalar values from their surrounding node; to disable set `keepScalar` to
		* `true` (collections are always returned intact).
		*/
		getIn(path, keepScalar) {
			if (Collection.isEmptyPath(path)) return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
			return identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
		}
		/**
		* Checks if the document includes a value with the key `key`.
		*/
		has(key) {
			return identity.isCollection(this.contents) ? this.contents.has(key) : false;
		}
		/**
		* Checks if the document includes a value at `path`.
		*/
		hasIn(path) {
			if (Collection.isEmptyPath(path)) return this.contents !== void 0;
			return identity.isCollection(this.contents) ? this.contents.hasIn(path) : false;
		}
		/**
		* Sets a value in this document. For `!!set`, `value` needs to be a
		* boolean to add/remove the item from the set.
		*/
		set(key, value) {
			if (this.contents == null) this.contents = Collection.collectionFromPath(this.schema, [key], value);
			else if (assertCollection(this.contents)) this.contents.set(key, value);
		}
		/**
		* Sets a value in this document. For `!!set`, `value` needs to be a
		* boolean to add/remove the item from the set.
		*/
		setIn(path, value) {
			if (Collection.isEmptyPath(path)) this.contents = value;
			else if (this.contents == null) this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
			else if (assertCollection(this.contents)) this.contents.setIn(path, value);
		}
		/**
		* Change the YAML version and schema used by the document.
		* A `null` version disables support for directives, explicit tags, anchors, and aliases.
		* It also requires the `schema` option to be given as a `Schema` instance value.
		*
		* Overrides all previously set schema options.
		*/
		setSchema(version, options = {}) {
			if (typeof version === "number") version = String(version);
			let opt;
			switch (version) {
				case "1.1":
					if (this.directives) this.directives.yaml.version = "1.1";
					else this.directives = new directives.Directives({ version: "1.1" });
					opt = {
						resolveKnownTags: false,
						schema: "yaml-1.1"
					};
					break;
				case "1.2":
				case "next":
					if (this.directives) this.directives.yaml.version = version;
					else this.directives = new directives.Directives({ version });
					opt = {
						resolveKnownTags: true,
						schema: "core"
					};
					break;
				case null:
					if (this.directives) delete this.directives;
					opt = null;
					break;
				default: {
					const sv = JSON.stringify(version);
					throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
				}
			}
			if (options.schema instanceof Object) this.schema = options.schema;
			else if (opt) this.schema = new Schema.Schema(Object.assign(opt, options));
			else throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
		}
		toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
			const ctx = {
				anchors: /* @__PURE__ */ new Map(),
				doc: this,
				keep: !json,
				mapAsMap: mapAsMap === true,
				mapKeyWarned: false,
				maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
			};
			const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
			if (typeof onAnchor === "function") for (const { count, res } of ctx.anchors.values()) onAnchor(res, count);
			return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
		}
		/**
		* A JSON representation of the document `contents`.
		*
		* @param jsonArg Used by `JSON.stringify` to indicate the array index or
		*   property name.
		*/
		toJSON(jsonArg, onAnchor) {
			return this.toJS({
				json: true,
				jsonArg,
				mapAsMap: false,
				onAnchor
			});
		}
		/** A YAML representation of the document. */
		toString(options = {}) {
			if (this.errors.length > 0) throw new Error("Document with errors cannot be stringified");
			if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
				const s = JSON.stringify(options.indent);
				throw new Error(`"indent" option must be a positive integer, not ${s}`);
			}
			return stringifyDocument.stringifyDocument(this, options);
		}
	};
	function assertCollection(contents) {
		if (identity.isCollection(contents)) return true;
		throw new Error("Expected a YAML collection as document contents");
	}
	exports.Document = Document;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/errors.js
var require_errors = /* @__PURE__ */ __commonJSMin(((exports) => {
	var YAMLError = class extends Error {
		constructor(name, pos, code, message) {
			super();
			this.name = name;
			this.code = code;
			this.message = message;
			this.pos = pos;
		}
	};
	var YAMLParseError = class extends YAMLError {
		constructor(pos, code, message) {
			super("YAMLParseError", pos, code, message);
		}
	};
	var YAMLWarning = class extends YAMLError {
		constructor(pos, code, message) {
			super("YAMLWarning", pos, code, message);
		}
	};
	const prettifyError = (src, lc) => (error) => {
		if (error.pos[0] === -1) return;
		error.linePos = error.pos.map((pos) => lc.linePos(pos));
		const { line, col } = error.linePos[0];
		error.message += ` at line ${line}, column ${col}`;
		let ci = col - 1;
		let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
		if (ci >= 60 && lineStr.length > 80) {
			const trimStart = Math.min(ci - 39, lineStr.length - 79);
			lineStr = "…" + lineStr.substring(trimStart);
			ci -= trimStart - 1;
		}
		if (lineStr.length > 80) lineStr = lineStr.substring(0, 79) + "…";
		if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
			let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
			if (prev.length > 80) prev = prev.substring(0, 79) + "…\n";
			lineStr = prev + lineStr;
		}
		if (/[^ ]/.test(lineStr)) {
			let count = 1;
			const end = error.linePos[1];
			if (end?.line === line && end.col > col) count = Math.max(1, Math.min(end.col - col, 80 - ci));
			const pointer = " ".repeat(ci) + "^".repeat(count);
			error.message += `:\n\n${lineStr}\n${pointer}\n`;
		}
	};
	exports.YAMLError = YAMLError;
	exports.YAMLParseError = YAMLParseError;
	exports.YAMLWarning = YAMLWarning;
	exports.prettifyError = prettifyError;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = /* @__PURE__ */ __commonJSMin(((exports) => {
	function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
		let spaceBefore = false;
		let atNewline = startOnNewline;
		let hasSpace = startOnNewline;
		let comment = "";
		let commentSep = "";
		let hasNewline = false;
		let reqSpace = false;
		let tab = null;
		let anchor = null;
		let tag = null;
		let newlineAfterProp = null;
		let comma = null;
		let found = null;
		let start = null;
		for (const token of tokens) {
			if (reqSpace) {
				if (token.type !== "space" && token.type !== "newline" && token.type !== "comma") onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
				reqSpace = false;
			}
			if (tab) {
				if (atNewline && token.type !== "comment" && token.type !== "newline") onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
				tab = null;
			}
			switch (token.type) {
				case "space":
					if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) tab = token;
					hasSpace = true;
					break;
				case "comment": {
					if (!hasSpace) onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
					const cb = token.source.substring(1) || " ";
					if (!comment) comment = cb;
					else comment += commentSep + cb;
					commentSep = "";
					atNewline = false;
					break;
				}
				case "newline":
					if (atNewline) {
						if (comment) comment += token.source;
						else if (!found || indicator !== "seq-item-ind") spaceBefore = true;
					} else commentSep += token.source;
					atNewline = true;
					hasNewline = true;
					if (anchor || tag) newlineAfterProp = token;
					hasSpace = true;
					break;
				case "anchor":
					if (anchor) onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
					if (token.source.endsWith(":")) onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
					anchor = token;
					start ?? (start = token.offset);
					atNewline = false;
					hasSpace = false;
					reqSpace = true;
					break;
				case "tag":
					if (tag) onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
					tag = token;
					start ?? (start = token.offset);
					atNewline = false;
					hasSpace = false;
					reqSpace = true;
					break;
				case indicator:
					if (anchor || tag) onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
					if (found) onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
					found = token;
					atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
					hasSpace = false;
					break;
				case "comma": if (flow) {
					if (comma) onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
					comma = token;
					atNewline = false;
					hasSpace = false;
					break;
				}
				default:
					onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
					atNewline = false;
					hasSpace = false;
			}
		}
		const last = tokens[tokens.length - 1];
		const end = last ? last.offset + last.source.length : offset;
		if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
		if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq")) onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
		return {
			comma,
			found,
			spaceBefore,
			comment,
			hasNewline,
			anchor,
			tag,
			newlineAfterProp,
			end,
			start: start ?? end
		};
	}
	exports.resolveProps = resolveProps;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = /* @__PURE__ */ __commonJSMin(((exports) => {
	function containsNewline(key) {
		if (!key) return null;
		switch (key.type) {
			case "alias":
			case "scalar":
			case "double-quoted-scalar":
			case "single-quoted-scalar":
				if (key.source.includes("\n")) return true;
				if (key.end) {
					for (const st of key.end) if (st.type === "newline") return true;
				}
				return false;
			case "flow-collection":
				for (const it of key.items) {
					for (const st of it.start) if (st.type === "newline") return true;
					if (it.sep) {
						for (const st of it.sep) if (st.type === "newline") return true;
					}
					if (containsNewline(it.key) || containsNewline(it.value)) return true;
				}
				return false;
			default: return true;
		}
	}
	exports.containsNewline = containsNewline;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = /* @__PURE__ */ __commonJSMin(((exports) => {
	var utilContainsNewline = require_util_contains_newline();
	function flowIndentCheck(indent, fc, onError) {
		if (fc?.type === "flow-collection") {
			const end = fc.end[0];
			if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) onError(end, "BAD_INDENT", "Flow end indicator should be more indented than parent", true);
		}
	}
	exports.flowIndentCheck = flowIndentCheck;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	function mapIncludes(ctx, items, search) {
		const { uniqueKeys } = ctx.options;
		if (uniqueKeys === false) return false;
		const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
		return items.some((pair) => isEqual(pair.key, search));
	}
	exports.mapIncludes = mapIncludes;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Pair = require_Pair();
	var YAMLMap = require_YAMLMap();
	var resolveProps = require_resolve_props();
	var utilContainsNewline = require_util_contains_newline();
	var utilFlowIndentCheck = require_util_flow_indent_check();
	var utilMapIncludes = require_util_map_includes();
	const startColMsg = "All mapping items must start at the same column";
	function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
		const map = new ((tag?.nodeClass) ?? YAMLMap.YAMLMap)(ctx.schema);
		if (ctx.atRoot) ctx.atRoot = false;
		let offset = bm.offset;
		let commentEnd = null;
		for (const collItem of bm.items) {
			const { start, key, sep, value } = collItem;
			const keyProps = resolveProps.resolveProps(start, {
				indicator: "explicit-key-ind",
				next: key ?? sep?.[0],
				offset,
				onError,
				parentIndent: bm.indent,
				startOnNewline: true
			});
			const implicitKey = !keyProps.found;
			if (implicitKey) {
				if (key) {
					if (key.type === "block-seq") onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
					else if ("indent" in key && key.indent !== bm.indent) onError(offset, "BAD_INDENT", startColMsg);
				}
				if (!keyProps.anchor && !keyProps.tag && !sep) {
					commentEnd = keyProps.end;
					if (keyProps.comment) {
						if (map.comment) map.comment += "\n" + keyProps.comment;
						else map.comment = keyProps.comment;
					}
					continue;
				}
				if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
			} else if (keyProps.found?.indent !== bm.indent) onError(offset, "BAD_INDENT", startColMsg);
			ctx.atKey = true;
			const keyStart = keyProps.end;
			const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
			if (ctx.schema.compat) utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
			ctx.atKey = false;
			if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode)) onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
			const valueProps = resolveProps.resolveProps(sep ?? [], {
				indicator: "map-value-ind",
				next: value,
				offset: keyNode.range[2],
				onError,
				parentIndent: bm.indent,
				startOnNewline: !key || key.type === "block-scalar"
			});
			offset = valueProps.end;
			if (valueProps.found) {
				if (implicitKey) {
					if (value?.type === "block-map" && !valueProps.hasNewline) onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
					if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024) onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
				}
				const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
				if (ctx.schema.compat) utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
				offset = valueNode.range[2];
				const pair = new Pair.Pair(keyNode, valueNode);
				if (ctx.options.keepSourceTokens) pair.srcToken = collItem;
				map.items.push(pair);
			} else {
				if (implicitKey) onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
				if (valueProps.comment) {
					if (keyNode.comment) keyNode.comment += "\n" + valueProps.comment;
					else keyNode.comment = valueProps.comment;
				}
				const pair = new Pair.Pair(keyNode);
				if (ctx.options.keepSourceTokens) pair.srcToken = collItem;
				map.items.push(pair);
			}
		}
		if (commentEnd && commentEnd < offset) onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
		map.range = [
			bm.offset,
			offset,
			commentEnd ?? offset
		];
		return map;
	}
	exports.resolveBlockMap = resolveBlockMap;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = /* @__PURE__ */ __commonJSMin(((exports) => {
	var YAMLSeq = require_YAMLSeq();
	var resolveProps = require_resolve_props();
	var utilFlowIndentCheck = require_util_flow_indent_check();
	function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
		const seq = new ((tag?.nodeClass) ?? YAMLSeq.YAMLSeq)(ctx.schema);
		if (ctx.atRoot) ctx.atRoot = false;
		if (ctx.atKey) ctx.atKey = false;
		let offset = bs.offset;
		let commentEnd = null;
		for (const { start, value } of bs.items) {
			const props = resolveProps.resolveProps(start, {
				indicator: "seq-item-ind",
				next: value,
				offset,
				onError,
				parentIndent: bs.indent,
				startOnNewline: true
			});
			if (!props.found) {
				if (props.anchor || props.tag || value) {
					if (value?.type === "block-seq") onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
					else onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
				} else {
					commentEnd = props.end;
					if (props.comment) seq.comment = props.comment;
					continue;
				}
			}
			const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
			if (ctx.schema.compat) utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
			offset = node.range[2];
			seq.items.push(node);
		}
		seq.range = [
			bs.offset,
			offset,
			commentEnd ?? offset
		];
		return seq;
	}
	exports.resolveBlockSeq = resolveBlockSeq;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = /* @__PURE__ */ __commonJSMin(((exports) => {
	function resolveEnd(end, offset, reqSpace, onError) {
		let comment = "";
		if (end) {
			let hasSpace = false;
			let sep = "";
			for (const token of end) {
				const { source, type } = token;
				switch (type) {
					case "space":
						hasSpace = true;
						break;
					case "comment": {
						if (reqSpace && !hasSpace) onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
						const cb = source.substring(1) || " ";
						if (!comment) comment = cb;
						else comment += sep + cb;
						sep = "";
						break;
					}
					case "newline":
						if (comment) sep += source;
						hasSpace = true;
						break;
					default: onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
				}
				offset += source.length;
			}
		}
		return {
			comment,
			offset
		};
	}
	exports.resolveEnd = resolveEnd;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Pair = require_Pair();
	var YAMLMap = require_YAMLMap();
	var YAMLSeq = require_YAMLSeq();
	var resolveEnd = require_resolve_end();
	var resolveProps = require_resolve_props();
	var utilContainsNewline = require_util_contains_newline();
	var utilMapIncludes = require_util_map_includes();
	const blockMsg = "Block collections are not allowed within flow collections";
	const isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
	function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
		const isMap = fc.start.source === "{";
		const fcName = isMap ? "flow map" : "flow sequence";
		const coll = new ((tag?.nodeClass) ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq))(ctx.schema);
		coll.flow = true;
		const atRoot = ctx.atRoot;
		if (atRoot) ctx.atRoot = false;
		if (ctx.atKey) ctx.atKey = false;
		let offset = fc.offset + fc.start.source.length;
		for (let i = 0; i < fc.items.length; ++i) {
			const collItem = fc.items[i];
			const { start, key, sep, value } = collItem;
			const props = resolveProps.resolveProps(start, {
				flow: fcName,
				indicator: "explicit-key-ind",
				next: key ?? sep?.[0],
				offset,
				onError,
				parentIndent: fc.indent,
				startOnNewline: false
			});
			if (!props.found) {
				if (!props.anchor && !props.tag && !sep && !value) {
					if (i === 0 && props.comma) onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
					else if (i < fc.items.length - 1) onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
					if (props.comment) {
						if (coll.comment) coll.comment += "\n" + props.comment;
						else coll.comment = props.comment;
					}
					offset = props.end;
					continue;
				}
				if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key)) onError(key, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
			}
			if (i === 0) {
				if (props.comma) onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
			} else {
				if (!props.comma) onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
				if (props.comment) {
					let prevItemComment = "";
					loop: for (const st of start) switch (st.type) {
						case "comma":
						case "space": break;
						case "comment":
							prevItemComment = st.source.substring(1);
							break loop;
						default: break loop;
					}
					if (prevItemComment) {
						let prev = coll.items[coll.items.length - 1];
						if (identity.isPair(prev)) prev = prev.value ?? prev.key;
						if (prev.comment) prev.comment += "\n" + prevItemComment;
						else prev.comment = prevItemComment;
						props.comment = props.comment.substring(prevItemComment.length + 1);
					}
				}
			}
			if (!isMap && !sep && !props.found) {
				const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
				coll.items.push(valueNode);
				offset = valueNode.range[2];
				if (isBlock(value)) onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
			} else {
				ctx.atKey = true;
				const keyStart = props.end;
				const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
				if (isBlock(key)) onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
				ctx.atKey = false;
				const valueProps = resolveProps.resolveProps(sep ?? [], {
					flow: fcName,
					indicator: "map-value-ind",
					next: value,
					offset: keyNode.range[2],
					onError,
					parentIndent: fc.indent,
					startOnNewline: false
				});
				if (valueProps.found) {
					if (!isMap && !props.found && ctx.options.strict) {
						if (sep) for (const st of sep) {
							if (st === valueProps.found) break;
							if (st.type === "newline") {
								onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
								break;
							}
						}
						if (props.start < valueProps.found.offset - 1024) onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
					}
				} else if (value) {
					if ("source" in value && value.source?.[0] === ":") onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
					else onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
				}
				const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
				if (valueNode) {
					if (isBlock(value)) onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
				} else if (valueProps.comment) {
					if (keyNode.comment) keyNode.comment += "\n" + valueProps.comment;
					else keyNode.comment = valueProps.comment;
				}
				const pair = new Pair.Pair(keyNode, valueNode);
				if (ctx.options.keepSourceTokens) pair.srcToken = collItem;
				if (isMap) {
					const map = coll;
					if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode)) onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
					map.items.push(pair);
				} else {
					const map = new YAMLMap.YAMLMap(ctx.schema);
					map.flow = true;
					map.items.push(pair);
					const endRange = (valueNode ?? keyNode).range;
					map.range = [
						keyNode.range[0],
						endRange[1],
						endRange[2]
					];
					coll.items.push(map);
				}
				offset = valueNode ? valueNode.range[2] : valueProps.end;
			}
		}
		const expectedEnd = isMap ? "}" : "]";
		const [ce, ...ee] = fc.end;
		let cePos = offset;
		if (ce?.source === expectedEnd) cePos = ce.offset + ce.source.length;
		else {
			const name = fcName[0].toUpperCase() + fcName.substring(1);
			const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
			onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
			if (ce && ce.source.length !== 1) ee.unshift(ce);
		}
		if (ee.length > 0) {
			const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
			if (end.comment) {
				if (coll.comment) coll.comment += "\n" + end.comment;
				else coll.comment = end.comment;
			}
			coll.range = [
				fc.offset,
				cePos,
				end.offset
			];
		} else coll.range = [
			fc.offset,
			cePos,
			cePos
		];
		return coll;
	}
	exports.resolveFlowCollection = resolveFlowCollection;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Scalar = require_Scalar();
	var YAMLMap = require_YAMLMap();
	var YAMLSeq = require_YAMLSeq();
	var resolveBlockMap = require_resolve_block_map();
	var resolveBlockSeq = require_resolve_block_seq();
	var resolveFlowCollection = require_resolve_flow_collection();
	function resolveCollection(CN, ctx, token, onError, tagName, tag) {
		const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
		const Coll = coll.constructor;
		if (tagName === "!" || tagName === Coll.tagName) {
			coll.tag = Coll.tagName;
			return coll;
		}
		if (tagName) coll.tag = tagName;
		return coll;
	}
	function composeCollection(CN, ctx, token, props, onError) {
		const tagToken = props.tag;
		const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
		if (token.type === "block-seq") {
			const { anchor, newlineAfterProp: nl } = props;
			const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
			if (lastProp && (!nl || nl.offset < lastProp.offset)) onError(lastProp, "MISSING_CHAR", "Missing newline after block sequence props");
		}
		const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
		if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") return resolveCollection(CN, ctx, token, onError, tagName);
		let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
		if (!tag) {
			const kt = ctx.schema.knownTags[tagName];
			if (kt?.collection === expType) {
				ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
				tag = kt;
			} else {
				if (kt) onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
				else onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
				return resolveCollection(CN, ctx, token, onError, tagName);
			}
		}
		const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
		const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
		const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
		node.range = coll.range;
		node.tag = tagName;
		if (tag?.format) node.format = tag.format;
		return node;
	}
	exports.composeCollection = composeCollection;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	function resolveBlockScalar(ctx, scalar, onError) {
		const start = scalar.offset;
		const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
		if (!header) return {
			value: "",
			type: null,
			comment: "",
			range: [
				start,
				start,
				start
			]
		};
		const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
		const lines = scalar.source ? splitLines(scalar.source) : [];
		let chompStart = lines.length;
		for (let i = lines.length - 1; i >= 0; --i) {
			const content = lines[i][1];
			if (content === "" || content === "\r") chompStart = i;
			else break;
		}
		if (chompStart === 0) {
			const value = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
			let end = start + header.length;
			if (scalar.source) end += scalar.source.length;
			return {
				value,
				type,
				comment: header.comment,
				range: [
					start,
					end,
					end
				]
			};
		}
		let trimIndent = scalar.indent + header.indent;
		let offset = scalar.offset + header.length;
		let contentStart = 0;
		for (let i = 0; i < chompStart; ++i) {
			const [indent, content] = lines[i];
			if (content === "" || content === "\r") {
				if (header.indent === 0 && indent.length > trimIndent) trimIndent = indent.length;
			} else {
				if (indent.length < trimIndent) onError(offset + indent.length, "MISSING_CHAR", "Block scalars with more-indented leading empty lines must use an explicit indentation indicator");
				if (header.indent === 0) trimIndent = indent.length;
				contentStart = i;
				if (trimIndent === 0 && !ctx.atRoot) onError(offset, "BAD_INDENT", "Block scalar values in collections must be indented");
				break;
			}
			offset += indent.length + content.length + 1;
		}
		for (let i = lines.length - 1; i >= chompStart; --i) if (lines[i][0].length > trimIndent) chompStart = i + 1;
		let value = "";
		let sep = "";
		let prevMoreIndented = false;
		for (let i = 0; i < contentStart; ++i) value += lines[i][0].slice(trimIndent) + "\n";
		for (let i = contentStart; i < chompStart; ++i) {
			let [indent, content] = lines[i];
			offset += indent.length + content.length + 1;
			const crlf = content[content.length - 1] === "\r";
			if (crlf) content = content.slice(0, -1);
			/* istanbul ignore if already caught in lexer */
			if (content && indent.length < trimIndent) {
				const message = `Block scalar lines must not be less indented than their ${header.indent ? "explicit indentation indicator" : "first line"}`;
				onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
				indent = "";
			}
			if (type === Scalar.Scalar.BLOCK_LITERAL) {
				value += sep + indent.slice(trimIndent) + content;
				sep = "\n";
			} else if (indent.length > trimIndent || content[0] === "	") {
				if (sep === " ") sep = "\n";
				else if (!prevMoreIndented && sep === "\n") sep = "\n\n";
				value += sep + indent.slice(trimIndent) + content;
				sep = "\n";
				prevMoreIndented = true;
			} else if (content === "") {
				if (sep === "\n") value += "\n";
				else sep = "\n";
			} else {
				value += sep + content;
				sep = " ";
				prevMoreIndented = false;
			}
		}
		switch (header.chomp) {
			case "-": break;
			case "+":
				for (let i = chompStart; i < lines.length; ++i) value += "\n" + lines[i][0].slice(trimIndent);
				if (value[value.length - 1] !== "\n") value += "\n";
				break;
			default: value += "\n";
		}
		const end = start + header.length + scalar.source.length;
		return {
			value,
			type,
			comment: header.comment,
			range: [
				start,
				end,
				end
			]
		};
	}
	function parseBlockScalarHeader({ offset, props }, strict, onError) {
		/* istanbul ignore if should not happen */
		if (props[0].type !== "block-scalar-header") {
			onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
			return null;
		}
		const { source } = props[0];
		const mode = source[0];
		let indent = 0;
		let chomp = "";
		let error = -1;
		for (let i = 1; i < source.length; ++i) {
			const ch = source[i];
			if (!chomp && (ch === "-" || ch === "+")) chomp = ch;
			else {
				const n = Number(ch);
				if (!indent && n) indent = n;
				else if (error === -1) error = offset + i;
			}
		}
		if (error !== -1) onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
		let hasSpace = false;
		let comment = "";
		let length = source.length;
		for (let i = 1; i < props.length; ++i) {
			const token = props[i];
			switch (token.type) {
				case "space": hasSpace = true;
				case "newline":
					length += token.source.length;
					break;
				case "comment":
					if (strict && !hasSpace) onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
					length += token.source.length;
					comment = token.source.substring(1);
					break;
				case "error":
					onError(token, "UNEXPECTED_TOKEN", token.message);
					length += token.source.length;
					break;
				/* istanbul ignore next should not happen */
				default: {
					onError(token, "UNEXPECTED_TOKEN", `Unexpected token in block scalar header: ${token.type}`);
					const ts = token.source;
					if (ts && typeof ts === "string") length += ts.length;
				}
			}
		}
		return {
			mode,
			indent,
			chomp,
			comment,
			length
		};
	}
	/** @returns Array of lines split up as `[indent, content]` */
	function splitLines(source) {
		const split = source.split(/\n( *)/);
		const first = split[0];
		const m = first.match(/^( *)/);
		const lines = [m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first]];
		for (let i = 1; i < split.length; i += 2) lines.push([split[i], split[i + 1]]);
		return lines;
	}
	exports.resolveBlockScalar = resolveBlockScalar;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var resolveEnd = require_resolve_end();
	function resolveFlowScalar(scalar, strict, onError) {
		const { offset, type, source, end } = scalar;
		let _type;
		let value;
		const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
		switch (type) {
			case "scalar":
				_type = Scalar.Scalar.PLAIN;
				value = plainValue(source, _onError);
				break;
			case "single-quoted-scalar":
				_type = Scalar.Scalar.QUOTE_SINGLE;
				value = singleQuotedValue(source, _onError);
				break;
			case "double-quoted-scalar":
				_type = Scalar.Scalar.QUOTE_DOUBLE;
				value = doubleQuotedValue(source, _onError);
				break;
			/* istanbul ignore next should not happen */
			default:
				onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
				return {
					value: "",
					type: null,
					comment: "",
					range: [
						offset,
						offset + source.length,
						offset + source.length
					]
				};
		}
		const valueEnd = offset + source.length;
		const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
		return {
			value,
			type: _type,
			comment: re.comment,
			range: [
				offset,
				valueEnd,
				re.offset
			]
		};
	}
	function plainValue(source, onError) {
		let badChar = "";
		switch (source[0]) {
			/* istanbul ignore next should not happen */
			case "	":
				badChar = "a tab character";
				break;
			case ",":
				badChar = "flow indicator character ,";
				break;
			case "%":
				badChar = "directive indicator character %";
				break;
			case "|":
			case ">":
				badChar = `block scalar indicator ${source[0]}`;
				break;
			case "@":
			case "`": badChar = `reserved character ${source[0]}`;
		}
		if (badChar) onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
		return foldLines(source);
	}
	function singleQuotedValue(source, onError) {
		if (source[source.length - 1] !== "'" || source.length === 1) onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
		return foldLines(source.slice(1, -1)).replace(/''/g, "'");
	}
	function foldLines(source) {
		/**
		* The negative lookbehind here and in the `re` RegExp is to
		* prevent causing a polynomial search time in certain cases.
		*
		* The try-catch is for Safari, which doesn't support this yet:
		* https://caniuse.com/js-regexp-lookbehind
		*/
		let first, line;
		try {
			first = /* @__PURE__ */ new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
			line = /* @__PURE__ */ new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
		} catch {
			first = /(.*?)[ \t]*\r?\n/sy;
			line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
		}
		let match = first.exec(source);
		if (!match) return source;
		let res = match[1];
		let sep = " ";
		let pos = first.lastIndex;
		line.lastIndex = pos;
		while (match = line.exec(source)) {
			if (match[1] === "") {
				if (sep === "\n") res += sep;
				else sep = "\n";
			} else {
				res += sep + match[1];
				sep = " ";
			}
			pos = line.lastIndex;
		}
		const last = /[ \t]*(.*)/sy;
		last.lastIndex = pos;
		match = last.exec(source);
		return res + sep + (match?.[1] ?? "");
	}
	function doubleQuotedValue(source, onError) {
		let res = "";
		for (let i = 1; i < source.length - 1; ++i) {
			const ch = source[i];
			if (ch === "\r" && source[i + 1] === "\n") continue;
			if (ch === "\n") {
				const { fold, offset } = foldNewline(source, i);
				res += fold;
				i = offset;
			} else if (ch === "\\") {
				let next = source[++i];
				const cc = escapeCodes[next];
				if (cc) res += cc;
				else if (next === "\n") {
					next = source[i + 1];
					while (next === " " || next === "	") next = source[++i + 1];
				} else if (next === "\r" && source[i + 1] === "\n") {
					next = source[++i + 1];
					while (next === " " || next === "	") next = source[++i + 1];
				} else if (next === "x" || next === "u" || next === "U") {
					const length = next === "x" ? 2 : next === "u" ? 4 : 8;
					res += parseCharCode(source, i + 1, length, onError);
					i += length;
				} else {
					const raw = source.substr(i - 1, 2);
					onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
					res += raw;
				}
			} else if (ch === " " || ch === "	") {
				const wsStart = i;
				let next = source[i + 1];
				while (next === " " || next === "	") next = source[++i + 1];
				if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n")) res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
			} else res += ch;
		}
		if (source[source.length - 1] !== "\"" || source.length === 1) onError(source.length, "MISSING_CHAR", "Missing closing \"quote");
		return res;
	}
	/**
	* Fold a single newline into a space, multiple newlines to N - 1 newlines.
	* Presumes `source[offset] === '\n'`
	*/
	function foldNewline(source, offset) {
		let fold = "";
		let ch = source[offset + 1];
		while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
			if (ch === "\r" && source[offset + 2] !== "\n") break;
			if (ch === "\n") fold += "\n";
			offset += 1;
			ch = source[offset + 1];
		}
		if (!fold) fold = " ";
		return {
			fold,
			offset
		};
	}
	const escapeCodes = {
		"0": "\0",
		a: "\x07",
		b: "\b",
		e: "\x1B",
		f: "\f",
		n: "\n",
		r: "\r",
		t: "	",
		v: "\v",
		N: "",
		_: "\xA0",
		L: "\u2028",
		P: "\u2029",
		" ": " ",
		"\"": "\"",
		"/": "/",
		"\\": "\\",
		"	": "	"
	};
	function parseCharCode(source, offset, length, onError) {
		const cc = source.substr(offset, length);
		const code = cc.length === length && /^[0-9a-fA-F]+$/.test(cc) ? parseInt(cc, 16) : NaN;
		try {
			return String.fromCodePoint(code);
		} catch {
			const raw = source.substr(offset - 2, length + 2);
			onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
			return raw;
		}
	}
	exports.resolveFlowScalar = resolveFlowScalar;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Scalar = require_Scalar();
	var resolveBlockScalar = require_resolve_block_scalar();
	var resolveFlowScalar = require_resolve_flow_scalar();
	function composeScalar(ctx, token, tagToken, onError) {
		const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
		const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
		let tag;
		if (ctx.options.stringKeys && ctx.atKey) tag = ctx.schema[identity.SCALAR];
		else if (tagName) tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
		else if (token.type === "scalar") tag = findScalarTagByTest(ctx, value, token, onError);
		else tag = ctx.schema[identity.SCALAR];
		let scalar;
		try {
			const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
			scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
			scalar = new Scalar.Scalar(value);
		}
		scalar.range = range;
		scalar.source = value;
		if (type) scalar.type = type;
		if (tagName) scalar.tag = tagName;
		if (tag.format) scalar.format = tag.format;
		if (comment) scalar.comment = comment;
		return scalar;
	}
	function findScalarTagByName(schema, value, tagName, tagToken, onError) {
		if (tagName === "!") return schema[identity.SCALAR];
		const matchWithTest = [];
		for (const tag of schema.tags) if (!tag.collection && tag.tag === tagName) {
			if (tag.default && tag.test) matchWithTest.push(tag);
			else return tag;
		}
		for (const tag of matchWithTest) if (tag.test?.test(value)) return tag;
		const kt = schema.knownTags[tagName];
		if (kt && !kt.collection) {
			schema.tags.push(Object.assign({}, kt, {
				default: false,
				test: void 0
			}));
			return kt;
		}
		onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
		return schema[identity.SCALAR];
	}
	function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
		const tag = schema.tags.find((tag) => (tag.default === true || atKey && tag.default === "key") && tag.test?.test(value)) || schema[identity.SCALAR];
		if (schema.compat) {
			const compat = schema.compat.find((tag) => tag.default && tag.test?.test(value)) ?? schema[identity.SCALAR];
			if (tag.tag !== compat.tag) onError(token, "TAG_RESOLVE_FAILED", `Value may be parsed as either ${directives.tagString(tag.tag)} or ${directives.tagString(compat.tag)}`, true);
		}
		return tag;
	}
	exports.composeScalar = composeScalar;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = /* @__PURE__ */ __commonJSMin(((exports) => {
	function emptyScalarPosition(offset, before, pos) {
		if (before) {
			pos ?? (pos = before.length);
			for (let i = pos - 1; i >= 0; --i) {
				let st = before[i];
				switch (st.type) {
					case "space":
					case "comment":
					case "newline":
						offset -= st.source.length;
						continue;
				}
				st = before[++i];
				while (st?.type === "space") {
					offset += st.source.length;
					st = before[++i];
				}
				break;
			}
		}
		return offset;
	}
	exports.emptyScalarPosition = emptyScalarPosition;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Alias = require_Alias();
	var identity = require_identity();
	var composeCollection = require_compose_collection();
	var composeScalar = require_compose_scalar();
	var resolveEnd = require_resolve_end();
	var utilEmptyScalarPosition = require_util_empty_scalar_position();
	const CN = {
		composeNode,
		composeEmptyNode
	};
	function composeNode(ctx, token, props, onError) {
		const atKey = ctx.atKey;
		const { spaceBefore, comment, anchor, tag } = props;
		let node;
		let isSrcToken = true;
		switch (token.type) {
			case "alias":
				node = composeAlias(ctx, token, onError);
				if (anchor || tag) onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
				break;
			case "scalar":
			case "single-quoted-scalar":
			case "double-quoted-scalar":
			case "block-scalar":
				node = composeScalar.composeScalar(ctx, token, tag, onError);
				if (anchor) node.anchor = anchor.source.substring(1);
				break;
			case "block-map":
			case "block-seq":
			case "flow-collection":
				try {
					node = composeCollection.composeCollection(CN, ctx, token, props, onError);
					if (anchor) node.anchor = anchor.source.substring(1);
				} catch (error) {
					onError(token, "RESOURCE_EXHAUSTION", error instanceof Error ? error.message : String(error));
				}
				break;
			default:
				onError(token, "UNEXPECTED_TOKEN", token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`);
				isSrcToken = false;
		}
		node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
		if (anchor && node.anchor === "") onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
		if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) onError(tag ?? token, "NON_STRING_KEY", "With stringKeys, all keys must be strings");
		if (spaceBefore) node.spaceBefore = true;
		if (comment) {
			if (token.type === "scalar" && token.source === "") node.comment = comment;
			else node.commentBefore = comment;
		}
		if (ctx.options.keepSourceTokens && isSrcToken) node.srcToken = token;
		return node;
	}
	function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
		const token = {
			type: "scalar",
			offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
			indent: -1,
			source: ""
		};
		const node = composeScalar.composeScalar(ctx, token, tag, onError);
		if (anchor) {
			node.anchor = anchor.source.substring(1);
			if (node.anchor === "") onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
		}
		if (spaceBefore) node.spaceBefore = true;
		if (comment) {
			node.comment = comment;
			node.range[2] = end;
		}
		return node;
	}
	function composeAlias({ options }, { offset, source, end }, onError) {
		const alias = new Alias.Alias(source.substring(1));
		if (alias.source === "") onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
		if (alias.source.endsWith(":")) onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
		const valueEnd = offset + source.length;
		const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
		alias.range = [
			offset,
			valueEnd,
			re.offset
		];
		if (re.comment) alias.comment = re.comment;
		return alias;
	}
	exports.composeEmptyNode = composeEmptyNode;
	exports.composeNode = composeNode;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Document = require_Document();
	var composeNode = require_compose_node();
	var resolveEnd = require_resolve_end();
	var resolveProps = require_resolve_props();
	function composeDoc(options, directives, { offset, start, value, end }, onError) {
		const opts = Object.assign({ _directives: directives }, options);
		const doc = new Document.Document(void 0, opts);
		const ctx = {
			atKey: false,
			atRoot: true,
			directives: doc.directives,
			options: doc.options,
			schema: doc.schema
		};
		const props = resolveProps.resolveProps(start, {
			indicator: "doc-start",
			next: value ?? end?.[0],
			offset,
			onError,
			parentIndent: 0,
			startOnNewline: true
		});
		if (props.found) {
			doc.directives.docStart = true;
			if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline) onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
		}
		doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
		const contentEnd = doc.contents.range[2];
		const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
		if (re.comment) doc.comment = re.comment;
		doc.range = [
			offset,
			contentEnd,
			re.offset
		];
		return doc;
	}
	exports.composeDoc = composeDoc;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/composer.js
var require_composer = /* @__PURE__ */ __commonJSMin(((exports) => {
	var node_process$1 = __require("process");
	var directives = require_directives();
	var Document = require_Document();
	var errors = require_errors();
	var identity = require_identity();
	var composeDoc = require_compose_doc();
	var resolveEnd = require_resolve_end();
	function getErrorPos(src) {
		if (typeof src === "number") return [src, src + 1];
		if (Array.isArray(src)) return src.length === 2 ? src : [src[0], src[1]];
		const { offset, source } = src;
		return [offset, offset + (typeof source === "string" ? source.length : 1)];
	}
	function parsePrelude(prelude) {
		let comment = "";
		let atComment = false;
		let afterEmptyLine = false;
		for (let i = 0; i < prelude.length; ++i) {
			const source = prelude[i];
			switch (source[0]) {
				case "#":
					comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
					atComment = true;
					afterEmptyLine = false;
					break;
				case "%":
					if (prelude[i + 1]?.[0] !== "#") i += 1;
					atComment = false;
					break;
				default:
					if (!atComment) afterEmptyLine = true;
					atComment = false;
			}
		}
		return {
			comment,
			afterEmptyLine
		};
	}
	/**
	* Compose a stream of CST nodes into a stream of YAML Documents.
	*
	* ```ts
	* import { Composer, Parser } from 'yaml'
	*
	* const src: string = ...
	* const tokens = new Parser().parse(src)
	* const docs = new Composer().compose(tokens)
	* ```
	*/
	var Composer = class {
		constructor(options = {}) {
			this.doc = null;
			this.atDirectives = false;
			this.prelude = [];
			this.errors = [];
			this.warnings = [];
			this.onError = (source, code, message, warning) => {
				const pos = getErrorPos(source);
				if (warning) this.warnings.push(new errors.YAMLWarning(pos, code, message));
				else this.errors.push(new errors.YAMLParseError(pos, code, message));
			};
			this.directives = new directives.Directives({ version: options.version || "1.2" });
			this.options = options;
		}
		decorate(doc, afterDoc) {
			const { comment, afterEmptyLine } = parsePrelude(this.prelude);
			if (comment) {
				const dc = doc.contents;
				if (afterDoc) doc.comment = doc.comment ? `${doc.comment}\n${comment}` : comment;
				else if (afterEmptyLine || doc.directives.docStart || !dc) doc.commentBefore = comment;
				else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
					let it = dc.items[0];
					if (identity.isPair(it)) it = it.key;
					const cb = it.commentBefore;
					it.commentBefore = cb ? `${comment}\n${cb}` : comment;
				} else {
					const cb = dc.commentBefore;
					dc.commentBefore = cb ? `${comment}\n${cb}` : comment;
				}
			}
			if (afterDoc) {
				for (let i = 0; i < this.errors.length; ++i) doc.errors.push(this.errors[i]);
				for (let i = 0; i < this.warnings.length; ++i) doc.warnings.push(this.warnings[i]);
			} else {
				doc.errors = this.errors;
				doc.warnings = this.warnings;
			}
			this.prelude = [];
			this.errors = [];
			this.warnings = [];
		}
		/**
		* Current stream status information.
		*
		* Mostly useful at the end of input for an empty stream.
		*/
		streamInfo() {
			return {
				comment: parsePrelude(this.prelude).comment,
				directives: this.directives,
				errors: this.errors,
				warnings: this.warnings
			};
		}
		/**
		* Compose tokens into documents.
		*
		* @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
		* @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
		*/
		*compose(tokens, forceDoc = false, endOffset = -1) {
			for (const token of tokens) yield* this.next(token);
			yield* this.end(forceDoc, endOffset);
		}
		/** Advance the composer by one CST token. */
		*next(token) {
			if (node_process$1.env.LOG_STREAM) console.dir(token, { depth: null });
			switch (token.type) {
				case "directive":
					this.directives.add(token.source, (offset, message, warning) => {
						const pos = getErrorPos(token);
						pos[0] += offset;
						this.onError(pos, "BAD_DIRECTIVE", message, warning);
					});
					this.prelude.push(token.source);
					this.atDirectives = true;
					break;
				case "document": {
					const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
					if (this.atDirectives && !doc.directives.docStart) this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
					this.decorate(doc, false);
					if (this.doc) yield this.doc;
					this.doc = doc;
					this.atDirectives = false;
					break;
				}
				case "byte-order-mark":
				case "space": break;
				case "comment":
				case "newline":
					this.prelude.push(token.source);
					break;
				case "error": {
					const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
					const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
					if (this.atDirectives || !this.doc) this.errors.push(error);
					else this.doc.errors.push(error);
					break;
				}
				case "doc-end": {
					if (!this.doc) {
						this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", "Unexpected doc-end without preceding document"));
						break;
					}
					this.doc.directives.docEnd = true;
					const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
					this.decorate(this.doc, true);
					if (end.comment) {
						const dc = this.doc.comment;
						this.doc.comment = dc ? `${dc}\n${end.comment}` : end.comment;
					}
					this.doc.range[2] = end.offset;
					break;
				}
				default: this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
			}
		}
		/**
		* Call at end of input to yield any remaining document.
		*
		* @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
		* @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
		*/
		*end(forceDoc = false, endOffset = -1) {
			if (this.doc) {
				this.decorate(this.doc, true);
				yield this.doc;
				this.doc = null;
			} else if (forceDoc) {
				const opts = Object.assign({ _directives: this.directives }, this.options);
				const doc = new Document.Document(void 0, opts);
				if (this.atDirectives) this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
				doc.range = [
					0,
					endOffset,
					endOffset
				];
				this.decorate(doc, false);
				yield doc;
			}
		}
	};
	exports.Composer = Composer;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var resolveBlockScalar = require_resolve_block_scalar();
	var resolveFlowScalar = require_resolve_flow_scalar();
	var errors = require_errors();
	var stringifyString = require_stringifyString();
	function resolveAsScalar(token, strict = true, onError) {
		if (token) {
			const _onError = (pos, code, message) => {
				const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
				if (onError) onError(offset, code, message);
				else throw new errors.YAMLParseError([offset, offset + 1], code, message);
			};
			switch (token.type) {
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
				case "block-scalar": return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
			}
		}
		return null;
	}
	/**
	* Create a new scalar token with `value`
	*
	* Values that represent an actual string but may be parsed as a different type should use a `type` other than `'PLAIN'`,
	* as this function does not support any schema operations and won't check for such conflicts.
	*
	* @param value The string representation of the value, which will have its content properly indented.
	* @param context.end Comments and whitespace after the end of the value, or after the block scalar header. If undefined, a newline will be added.
	* @param context.implicitKey Being within an implicit key may affect the resolved type of the token's value.
	* @param context.indent The indent level of the token.
	* @param context.inFlow Is this scalar within a flow collection? This may affect the resolved type of the token's value.
	* @param context.offset The offset position of the token.
	* @param context.type The preferred type of the scalar token. If undefined, the previous type of the `token` will be used, defaulting to `'PLAIN'`.
	*/
	function createScalarToken(value, context) {
		const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
		const source = stringifyString.stringifyString({
			type,
			value
		}, {
			implicitKey,
			indent: indent > 0 ? " ".repeat(indent) : "",
			inFlow,
			options: {
				blockQuote: true,
				lineWidth: -1
			}
		});
		const end = context.end ?? [{
			type: "newline",
			offset: -1,
			indent,
			source: "\n"
		}];
		switch (source[0]) {
			case "|":
			case ">": {
				const he = source.indexOf("\n");
				const head = source.substring(0, he);
				const body = source.substring(he + 1) + "\n";
				const props = [{
					type: "block-scalar-header",
					offset,
					indent,
					source: head
				}];
				if (!addEndtoBlockProps(props, end)) props.push({
					type: "newline",
					offset: -1,
					indent,
					source: "\n"
				});
				return {
					type: "block-scalar",
					offset,
					indent,
					props,
					source: body
				};
			}
			case "\"": return {
				type: "double-quoted-scalar",
				offset,
				indent,
				source,
				end
			};
			case "'": return {
				type: "single-quoted-scalar",
				offset,
				indent,
				source,
				end
			};
			default: return {
				type: "scalar",
				offset,
				indent,
				source,
				end
			};
		}
	}
	/**
	* Set the value of `token` to the given string `value`, overwriting any previous contents and type that it may have.
	*
	* Best efforts are made to retain any comments previously associated with the `token`,
	* though all contents within a collection's `items` will be overwritten.
	*
	* Values that represent an actual string but may be parsed as a different type should use a `type` other than `'PLAIN'`,
	* as this function does not support any schema operations and won't check for such conflicts.
	*
	* @param token Any token. If it does not include an `indent` value, the value will be stringified as if it were an implicit key.
	* @param value The string representation of the value, which will have its content properly indented.
	* @param context.afterKey In most cases, values after a key should have an additional level of indentation.
	* @param context.implicitKey Being within an implicit key may affect the resolved type of the token's value.
	* @param context.inFlow Being within a flow collection may affect the resolved type of the token's value.
	* @param context.type The preferred type of the scalar token. If undefined, the previous type of the `token` will be used, defaulting to `'PLAIN'`.
	*/
	function setScalarValue(token, value, context = {}) {
		let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
		let indent = "indent" in token ? token.indent : null;
		if (afterKey && typeof indent === "number") indent += 2;
		if (!type) switch (token.type) {
			case "single-quoted-scalar":
				type = "QUOTE_SINGLE";
				break;
			case "double-quoted-scalar":
				type = "QUOTE_DOUBLE";
				break;
			case "block-scalar": {
				const header = token.props[0];
				if (header.type !== "block-scalar-header") throw new Error("Invalid block scalar header");
				type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
				break;
			}
			default: type = "PLAIN";
		}
		const source = stringifyString.stringifyString({
			type,
			value
		}, {
			implicitKey: implicitKey || indent === null,
			indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
			inFlow,
			options: {
				blockQuote: true,
				lineWidth: -1
			}
		});
		switch (source[0]) {
			case "|":
			case ">":
				setBlockScalarValue(token, source);
				break;
			case "\"":
				setFlowScalarValue(token, source, "double-quoted-scalar");
				break;
			case "'":
				setFlowScalarValue(token, source, "single-quoted-scalar");
				break;
			default: setFlowScalarValue(token, source, "scalar");
		}
	}
	function setBlockScalarValue(token, source) {
		const he = source.indexOf("\n");
		const head = source.substring(0, he);
		const body = source.substring(he + 1) + "\n";
		if (token.type === "block-scalar") {
			const header = token.props[0];
			if (header.type !== "block-scalar-header") throw new Error("Invalid block scalar header");
			header.source = head;
			token.source = body;
		} else {
			const { offset } = token;
			const indent = "indent" in token ? token.indent : -1;
			const props = [{
				type: "block-scalar-header",
				offset,
				indent,
				source: head
			}];
			if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0)) props.push({
				type: "newline",
				offset: -1,
				indent,
				source: "\n"
			});
			for (const key of Object.keys(token)) if (key !== "type" && key !== "offset") delete token[key];
			Object.assign(token, {
				type: "block-scalar",
				indent,
				props,
				source: body
			});
		}
	}
	/** @returns `true` if last token is a newline */
	function addEndtoBlockProps(props, end) {
		if (end) for (const st of end) switch (st.type) {
			case "space":
			case "comment":
				props.push(st);
				break;
			case "newline":
				props.push(st);
				return true;
		}
		return false;
	}
	function setFlowScalarValue(token, source, type) {
		switch (token.type) {
			case "scalar":
			case "double-quoted-scalar":
			case "single-quoted-scalar":
				token.type = type;
				token.source = source;
				break;
			case "block-scalar": {
				const end = token.props.slice(1);
				let oa = source.length;
				if (token.props[0].type === "block-scalar-header") oa -= token.props[0].source.length;
				for (const tok of end) tok.offset += oa;
				delete token.props;
				Object.assign(token, {
					type,
					source,
					end
				});
				break;
			}
			case "block-map":
			case "block-seq": {
				const nl = {
					type: "newline",
					offset: token.offset + source.length,
					indent: token.indent,
					source: "\n"
				};
				delete token.items;
				Object.assign(token, {
					type,
					source,
					end: [nl]
				});
				break;
			}
			default: {
				const indent = "indent" in token ? token.indent : -1;
				const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
				for (const key of Object.keys(token)) if (key !== "type" && key !== "offset") delete token[key];
				Object.assign(token, {
					type,
					indent,
					source,
					end
				});
			}
		}
	}
	exports.createScalarToken = createScalarToken;
	exports.resolveAsScalar = resolveAsScalar;
	exports.setScalarValue = setScalarValue;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Stringify a CST document, token, or collection item
	*
	* Fair warning: This applies no validation whatsoever, and
	* simply concatenates the sources in their logical order.
	*/
	const stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
	function stringifyToken(token) {
		switch (token.type) {
			case "block-scalar": {
				let res = "";
				for (const tok of token.props) res += stringifyToken(tok);
				return res + token.source;
			}
			case "block-map":
			case "block-seq": {
				let res = "";
				for (const item of token.items) res += stringifyItem(item);
				return res;
			}
			case "flow-collection": {
				let res = token.start.source;
				for (const item of token.items) res += stringifyItem(item);
				for (const st of token.end) res += st.source;
				return res;
			}
			case "document": {
				let res = stringifyItem(token);
				if (token.end) for (const st of token.end) res += st.source;
				return res;
			}
			default: {
				let res = token.source;
				if ("end" in token && token.end) for (const st of token.end) res += st.source;
				return res;
			}
		}
	}
	function stringifyItem({ start, key, sep, value }) {
		let res = "";
		for (const st of start) res += st.source;
		if (key) res += stringifyToken(key);
		if (sep) for (const st of sep) res += st.source;
		if (value) res += stringifyToken(value);
		return res;
	}
	exports.stringify = stringify;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = /* @__PURE__ */ __commonJSMin(((exports) => {
	const BREAK = Symbol("break visit");
	const SKIP = Symbol("skip children");
	const REMOVE = Symbol("remove item");
	/**
	* Apply a visitor to a CST document or item.
	*
	* Walks through the tree (depth-first) starting from the root, calling a
	* `visitor` function with two arguments when entering each item:
	*   - `item`: The current item, which included the following members:
	*     - `start: SourceToken[]` – Source tokens before the key or value,
	*       possibly including its anchor or tag.
	*     - `key?: Token | null` – Set for pair values. May then be `null`, if
	*       the key before the `:` separator is empty.
	*     - `sep?: SourceToken[]` – Source tokens between the key and the value,
	*       which should include the `:` map value indicator if `value` is set.
	*     - `value?: Token` – The value of a sequence item, or of a map pair.
	*   - `path`: The steps from the root to the current node, as an array of
	*     `['key' | 'value', number]` tuples.
	*
	* The return value of the visitor may be used to control the traversal:
	*   - `undefined` (default): Do nothing and continue
	*   - `visit.SKIP`: Do not visit the children of this token, continue with
	*      next sibling
	*   - `visit.BREAK`: Terminate traversal completely
	*   - `visit.REMOVE`: Remove the current item, then continue with the next one
	*   - `number`: Set the index of the next step. This is useful especially if
	*     the index of the current token has changed.
	*   - `function`: Define the next visitor for this item. After the original
	*     visitor is called on item entry, next visitors are called after handling
	*     a non-empty `key` and when exiting the item.
	*/
	function visit(cst, visitor) {
		if ("type" in cst && cst.type === "document") cst = {
			start: cst.start,
			value: cst.value
		};
		_visit(Object.freeze([]), cst, visitor);
	}
	/** Terminate visit traversal completely */
	visit.BREAK = BREAK;
	/** Do not visit the children of the current item */
	visit.SKIP = SKIP;
	/** Remove the current item */
	visit.REMOVE = REMOVE;
	/** Find the item at `path` from `cst` as the root */
	visit.itemAtPath = (cst, path) => {
		let item = cst;
		for (const [field, index] of path) {
			const tok = item?.[field];
			if (tok && "items" in tok) item = tok.items[index];
			else return void 0;
		}
		return item;
	};
	/**
	* Get the immediate parent collection of the item at `path` from `cst` as the root.
	*
	* Throws an error if the collection is not found, which should never happen if the item itself exists.
	*/
	visit.parentCollection = (cst, path) => {
		const parent = visit.itemAtPath(cst, path.slice(0, -1));
		const field = path[path.length - 1][0];
		const coll = parent?.[field];
		if (coll && "items" in coll) return coll;
		throw new Error("Parent collection not found");
	};
	function _visit(path, item, visitor) {
		let ctrl = visitor(item, path);
		if (typeof ctrl === "symbol") return ctrl;
		for (const field of ["key", "value"]) {
			const token = item[field];
			if (token && "items" in token) {
				for (let i = 0; i < token.items.length; ++i) {
					const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
					if (typeof ci === "number") i = ci - 1;
					else if (ci === BREAK) return BREAK;
					else if (ci === REMOVE) {
						token.items.splice(i, 1);
						i -= 1;
					}
				}
				if (typeof ctrl === "function" && field === "key") ctrl = ctrl(item, path);
			}
		}
		return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
	}
	exports.visit = visit;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst.js
var require_cst = /* @__PURE__ */ __commonJSMin(((exports) => {
	var cstScalar = require_cst_scalar();
	var cstStringify = require_cst_stringify();
	var cstVisit = require_cst_visit();
	/** The byte order mark */
	const BOM = "﻿";
	/** Start of doc-mode */
	const DOCUMENT = "";
	/** Unexpected end of flow-mode */
	const FLOW_END = "";
	/** Next token is a scalar value */
	const SCALAR = "";
	/** @returns `true` if `token` is a flow or block collection */
	const isCollection = (token) => !!token && "items" in token;
	/** @returns `true` if `token` is a flow or block scalar; not an alias */
	const isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
	/* istanbul ignore next */
	/** Get a printable representation of a lexer token */
	function prettyToken(token) {
		switch (token) {
			case BOM: return "<BOM>";
			case DOCUMENT: return "<DOC>";
			case FLOW_END: return "<FLOW_END>";
			case SCALAR: return "<SCALAR>";
			default: return JSON.stringify(token);
		}
	}
	/** Identify the type of a lexer token. May return `null` for unknown tokens. */
	function tokenType(source) {
		switch (source) {
			case BOM: return "byte-order-mark";
			case DOCUMENT: return "doc-mode";
			case FLOW_END: return "flow-error-end";
			case SCALAR: return "scalar";
			case "---": return "doc-start";
			case "...": return "doc-end";
			case "":
			case "\n":
			case "\r\n": return "newline";
			case "-": return "seq-item-ind";
			case "?": return "explicit-key-ind";
			case ":": return "map-value-ind";
			case "{": return "flow-map-start";
			case "}": return "flow-map-end";
			case "[": return "flow-seq-start";
			case "]": return "flow-seq-end";
			case ",": return "comma";
		}
		switch (source[0]) {
			case " ":
			case "	": return "space";
			case "#": return "comment";
			case "%": return "directive-line";
			case "*": return "alias";
			case "&": return "anchor";
			case "!": return "tag";
			case "'": return "single-quoted-scalar";
			case "\"": return "double-quoted-scalar";
			case "|":
			case ">": return "block-scalar-header";
		}
		return null;
	}
	exports.createScalarToken = cstScalar.createScalarToken;
	exports.resolveAsScalar = cstScalar.resolveAsScalar;
	exports.setScalarValue = cstScalar.setScalarValue;
	exports.stringify = cstStringify.stringify;
	exports.visit = cstVisit.visit;
	exports.BOM = BOM;
	exports.DOCUMENT = DOCUMENT;
	exports.FLOW_END = FLOW_END;
	exports.SCALAR = SCALAR;
	exports.isCollection = isCollection;
	exports.isScalar = isScalar;
	exports.prettyToken = prettyToken;
	exports.tokenType = tokenType;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/lexer.js
var require_lexer = /* @__PURE__ */ __commonJSMin(((exports) => {
	var cst = require_cst();
	function isEmpty(ch) {
		switch (ch) {
			case void 0:
			case " ":
			case "\n":
			case "\r":
			case "	": return true;
			default: return false;
		}
	}
	const hexDigits = /* @__PURE__ */ new Set("0123456789ABCDEFabcdef");
	const tagChars = /* @__PURE__ */ new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
	const flowIndicatorChars = /* @__PURE__ */ new Set(",[]{}");
	const invalidAnchorChars = /* @__PURE__ */ new Set(" ,[]{}\n\r	");
	const isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
	/**
	* Splits an input string into lexical tokens, i.e. smaller strings that are
	* easily identifiable by `tokens.tokenType()`.
	*
	* Lexing starts always in a "stream" context. Incomplete input may be buffered
	* until a complete token can be emitted.
	*
	* In addition to slices of the original input, the following control characters
	* may also be emitted:
	*
	* - `\x02` (Start of Text): A document starts with the next token
	* - `\x18` (Cancel): Unexpected end of flow-mode (indicates an error)
	* - `\x1f` (Unit Separator): Next token is a scalar value
	* - `\u{FEFF}` (Byte order mark): Emitted separately outside documents
	*/
	var Lexer = class {
		constructor() {
			/**
			* Flag indicating whether the end of the current buffer marks the end of
			* all input
			*/
			this.atEnd = false;
			/**
			* Explicit indent set in block scalar header, as an offset from the current
			* minimum indent, so e.g. set to 1 from a header `|2+`. Set to -1 if not
			* explicitly set.
			*/
			this.blockScalarIndent = -1;
			/**
			* Block scalars that include a + (keep) chomping indicator in their header
			* include trailing empty lines, which are otherwise excluded from the
			* scalar's contents.
			*/
			this.blockScalarKeep = false;
			/** Current input */
			this.buffer = "";
			/**
			* Flag noting whether the map value indicator : can immediately follow this
			* node within a flow context.
			*/
			this.flowKey = false;
			/** Count of surrounding flow collection levels. */
			this.flowLevel = 0;
			/**
			* Minimum level of indentation required for next lines to be parsed as a
			* part of the current scalar value.
			*/
			this.indentNext = 0;
			/** Indentation level of the current line. */
			this.indentValue = 0;
			/** Position of the next \n character. */
			this.lineEndPos = null;
			/** Stores the state of the lexer if reaching the end of incpomplete input */
			this.next = null;
			/** A pointer to `buffer`; the current position of the lexer. */
			this.pos = 0;
		}
		/**
		* Generate YAML tokens from the `source` string. If `incomplete`,
		* a part of the last line may be left as a buffer for the next call.
		*
		* @returns A generator of lexical tokens
		*/
		*lex(source, incomplete = false) {
			if (source) {
				if (typeof source !== "string") throw TypeError("source is not a string");
				this.buffer = this.buffer ? this.buffer + source : source;
				this.lineEndPos = null;
			}
			this.atEnd = !incomplete;
			let next = this.next ?? "stream";
			while (next && (incomplete || this.hasChars(1))) next = yield* this.parseNext(next);
		}
		atLineEnd() {
			let i = this.pos;
			let ch = this.buffer[i];
			while (ch === " " || ch === "	") ch = this.buffer[++i];
			if (!ch || ch === "#" || ch === "\n") return true;
			if (ch === "\r") return this.buffer[i + 1] === "\n";
			return false;
		}
		charAt(n) {
			return this.buffer[this.pos + n];
		}
		continueScalar(offset) {
			let ch = this.buffer[offset];
			if (this.indentNext > 0) {
				let indent = 0;
				while (ch === " ") ch = this.buffer[++indent + offset];
				if (ch === "\r") {
					const next = this.buffer[indent + offset + 1];
					if (next === "\n" || !next && !this.atEnd) return offset + indent + 1;
				}
				return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
			}
			if (ch === "-" || ch === ".") {
				const dt = this.buffer.substr(offset, 3);
				if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3])) return -1;
			}
			return offset;
		}
		getLine() {
			let end = this.lineEndPos;
			if (typeof end !== "number" || end !== -1 && end < this.pos) {
				end = this.buffer.indexOf("\n", this.pos);
				this.lineEndPos = end;
			}
			if (end === -1) return this.atEnd ? this.buffer.substring(this.pos) : null;
			if (this.buffer[end - 1] === "\r") end -= 1;
			return this.buffer.substring(this.pos, end);
		}
		hasChars(n) {
			return this.pos + n <= this.buffer.length;
		}
		setNext(state) {
			this.buffer = this.buffer.substring(this.pos);
			this.pos = 0;
			this.lineEndPos = null;
			this.next = state;
			return null;
		}
		peek(n) {
			return this.buffer.substr(this.pos, n);
		}
		*parseNext(next) {
			switch (next) {
				case "stream": return yield* this.parseStream();
				case "line-start": return yield* this.parseLineStart();
				case "block-start": return yield* this.parseBlockStart();
				case "doc": return yield* this.parseDocument();
				case "flow": return yield* this.parseFlowCollection();
				case "quoted-scalar": return yield* this.parseQuotedScalar();
				case "block-scalar": return yield* this.parseBlockScalar();
				case "plain-scalar": return yield* this.parsePlainScalar();
			}
		}
		*parseStream() {
			let line = this.getLine();
			if (line === null) return this.setNext("stream");
			if (line[0] === cst.BOM) {
				yield* this.pushCount(1);
				line = line.substring(1);
			}
			if (line[0] === "%") {
				let dirEnd = line.length;
				let cs = line.indexOf("#");
				while (cs !== -1) {
					const ch = line[cs - 1];
					if (ch === " " || ch === "	") {
						dirEnd = cs - 1;
						break;
					} else cs = line.indexOf("#", cs + 1);
				}
				while (true) {
					const ch = line[dirEnd - 1];
					if (ch === " " || ch === "	") dirEnd -= 1;
					else break;
				}
				const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
				yield* this.pushCount(line.length - n);
				this.pushNewline();
				return "stream";
			}
			if (this.atLineEnd()) {
				const sp = yield* this.pushSpaces(true);
				yield* this.pushCount(line.length - sp);
				yield* this.pushNewline();
				return "stream";
			}
			yield cst.DOCUMENT;
			return yield* this.parseLineStart();
		}
		*parseLineStart() {
			const ch = this.charAt(0);
			if (!ch && !this.atEnd) return this.setNext("line-start");
			if (ch === "-" || ch === ".") {
				if (!this.atEnd && !this.hasChars(4)) return this.setNext("line-start");
				const s = this.peek(3);
				if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
					yield* this.pushCount(3);
					this.indentValue = 0;
					this.indentNext = 0;
					return s === "---" ? "doc" : "stream";
				}
			}
			this.indentValue = yield* this.pushSpaces(false);
			if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1))) this.indentNext = this.indentValue;
			return yield* this.parseBlockStart();
		}
		*parseBlockStart() {
			const [ch0, ch1] = this.peek(2);
			if (!ch1 && !this.atEnd) return this.setNext("block-start");
			if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
				const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
				this.indentNext = this.indentValue + 1;
				this.indentValue += n;
				return "block-start";
			}
			return "doc";
		}
		*parseDocument() {
			yield* this.pushSpaces(true);
			const line = this.getLine();
			if (line === null) return this.setNext("doc");
			let n = yield* this.pushIndicators();
			switch (line[n]) {
				case "#": yield* this.pushCount(line.length - n);
				case void 0:
					yield* this.pushNewline();
					return yield* this.parseLineStart();
				case "{":
				case "[":
					yield* this.pushCount(1);
					this.flowKey = false;
					this.flowLevel = 1;
					return "flow";
				case "}":
				case "]":
					yield* this.pushCount(1);
					return "doc";
				case "*":
					yield* this.pushUntil(isNotAnchorChar);
					return "doc";
				case "\"":
				case "'": return yield* this.parseQuotedScalar();
				case "|":
				case ">":
					n += yield* this.parseBlockScalarHeader();
					n += yield* this.pushSpaces(true);
					yield* this.pushCount(line.length - n);
					yield* this.pushNewline();
					return yield* this.parseBlockScalar();
				default: return yield* this.parsePlainScalar();
			}
		}
		*parseFlowCollection() {
			let nl, sp;
			let indent = -1;
			do {
				nl = yield* this.pushNewline();
				if (nl > 0) {
					sp = yield* this.pushSpaces(false);
					this.indentValue = indent = sp;
				} else sp = 0;
				sp += yield* this.pushSpaces(true);
			} while (nl + sp > 0);
			const line = this.getLine();
			if (line === null) return this.setNext("flow");
			if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
				if (!(indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}"))) {
					this.flowLevel = 0;
					yield cst.FLOW_END;
					return yield* this.parseLineStart();
				}
			}
			let n = 0;
			while (line[n] === ",") {
				n += yield* this.pushCount(1);
				n += yield* this.pushSpaces(true);
				this.flowKey = false;
			}
			n += yield* this.pushIndicators();
			switch (line[n]) {
				case void 0: return "flow";
				case "#":
					yield* this.pushCount(line.length - n);
					return "flow";
				case "{":
				case "[":
					yield* this.pushCount(1);
					this.flowKey = false;
					this.flowLevel += 1;
					return "flow";
				case "}":
				case "]":
					yield* this.pushCount(1);
					this.flowKey = true;
					this.flowLevel -= 1;
					return this.flowLevel ? "flow" : "doc";
				case "*":
					yield* this.pushUntil(isNotAnchorChar);
					return "flow";
				case "\"":
				case "'":
					this.flowKey = true;
					return yield* this.parseQuotedScalar();
				case ":": {
					const next = this.charAt(1);
					if (this.flowKey || isEmpty(next) || next === ",") {
						this.flowKey = false;
						yield* this.pushCount(1);
						yield* this.pushSpaces(true);
						return "flow";
					}
				}
				default:
					this.flowKey = false;
					return yield* this.parsePlainScalar();
			}
		}
		*parseQuotedScalar() {
			const quote = this.charAt(0);
			let end = this.buffer.indexOf(quote, this.pos + 1);
			if (quote === "'") while (end !== -1 && this.buffer[end + 1] === "'") end = this.buffer.indexOf("'", end + 2);
			else while (end !== -1) {
				let n = 0;
				while (this.buffer[end - 1 - n] === "\\") n += 1;
				if (n % 2 === 0) break;
				end = this.buffer.indexOf("\"", end + 1);
			}
			const qb = this.buffer.substring(0, end);
			let nl = qb.indexOf("\n", this.pos);
			if (nl !== -1) {
				while (nl !== -1) {
					const cs = this.continueScalar(nl + 1);
					if (cs === -1) break;
					nl = qb.indexOf("\n", cs);
				}
				if (nl !== -1) end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
			}
			if (end === -1) {
				if (!this.atEnd) return this.setNext("quoted-scalar");
				end = this.buffer.length;
			}
			yield* this.pushToIndex(end + 1, false);
			return this.flowLevel ? "flow" : "doc";
		}
		*parseBlockScalarHeader() {
			this.blockScalarIndent = -1;
			this.blockScalarKeep = false;
			let i = this.pos;
			while (true) {
				const ch = this.buffer[++i];
				if (ch === "+") this.blockScalarKeep = true;
				else if (ch > "0" && ch <= "9") this.blockScalarIndent = Number(ch) - 1;
				else if (ch !== "-") break;
			}
			return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
		}
		*parseBlockScalar() {
			let nl = this.pos - 1;
			let indent = 0;
			let ch;
			loop: for (let i = this.pos; ch = this.buffer[i]; ++i) switch (ch) {
				case " ":
					indent += 1;
					break;
				case "\n":
					nl = i;
					indent = 0;
					break;
				case "\r": {
					const next = this.buffer[i + 1];
					if (!next && !this.atEnd) return this.setNext("block-scalar");
					if (next === "\n") break;
				}
				default: break loop;
			}
			if (!ch && !this.atEnd) return this.setNext("block-scalar");
			if (indent >= this.indentNext) {
				if (this.blockScalarIndent === -1) this.indentNext = indent;
				else this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
				do {
					const cs = this.continueScalar(nl + 1);
					if (cs === -1) break;
					nl = this.buffer.indexOf("\n", cs);
				} while (nl !== -1);
				if (nl === -1) {
					if (!this.atEnd) return this.setNext("block-scalar");
					nl = this.buffer.length;
				}
			}
			let i = nl + 1;
			ch = this.buffer[i];
			while (ch === " ") ch = this.buffer[++i];
			if (ch === "	") {
				while (ch === "	" || ch === " " || ch === "\r" || ch === "\n") ch = this.buffer[++i];
				nl = i - 1;
			} else if (!this.blockScalarKeep) do {
				let i = nl - 1;
				let ch = this.buffer[i];
				if (ch === "\r") ch = this.buffer[--i];
				const lastChar = i;
				while (ch === " ") ch = this.buffer[--i];
				if (ch === "\n" && i >= this.pos && i + 1 + indent > lastChar) nl = i;
				else break;
			} while (true);
			yield cst.SCALAR;
			yield* this.pushToIndex(nl + 1, true);
			return yield* this.parseLineStart();
		}
		*parsePlainScalar() {
			const inFlow = this.flowLevel > 0;
			let end = this.pos - 1;
			let i = this.pos - 1;
			let ch;
			while (ch = this.buffer[++i]) if (ch === ":") {
				const next = this.buffer[i + 1];
				if (isEmpty(next) || inFlow && flowIndicatorChars.has(next)) break;
				end = i;
			} else if (isEmpty(ch)) {
				let next = this.buffer[i + 1];
				if (ch === "\r") {
					if (next === "\n") {
						i += 1;
						ch = "\n";
						next = this.buffer[i + 1];
					} else end = i;
				}
				if (next === "#" || inFlow && flowIndicatorChars.has(next)) break;
				if (ch === "\n") {
					const cs = this.continueScalar(i + 1);
					if (cs === -1) break;
					i = Math.max(i, cs - 2);
				}
			} else {
				if (inFlow && flowIndicatorChars.has(ch)) break;
				end = i;
			}
			if (!ch && !this.atEnd) return this.setNext("plain-scalar");
			yield cst.SCALAR;
			yield* this.pushToIndex(end + 1, true);
			return inFlow ? "flow" : "doc";
		}
		*pushCount(n) {
			if (n > 0) {
				yield this.buffer.substr(this.pos, n);
				this.pos += n;
				return n;
			}
			return 0;
		}
		*pushToIndex(i, allowEmpty) {
			const s = this.buffer.slice(this.pos, i);
			if (s) {
				yield s;
				this.pos += s.length;
				return s.length;
			} else if (allowEmpty) yield "";
			return 0;
		}
		*pushIndicators() {
			let n = 0;
			loop: while (true) {
				switch (this.charAt(0)) {
					case "!":
						n += yield* this.pushTag();
						n += yield* this.pushSpaces(true);
						continue loop;
					case "&":
						n += yield* this.pushUntil(isNotAnchorChar);
						n += yield* this.pushSpaces(true);
						continue loop;
					case "-":
					case "?":
					case ":": {
						const inFlow = this.flowLevel > 0;
						const ch1 = this.charAt(1);
						if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
							if (!inFlow) this.indentNext = this.indentValue + 1;
							else if (this.flowKey) this.flowKey = false;
							n += yield* this.pushCount(1);
							n += yield* this.pushSpaces(true);
							continue loop;
						}
					}
				}
				break loop;
			}
			return n;
		}
		*pushTag() {
			if (this.charAt(1) === "<") {
				let i = this.pos + 2;
				let ch = this.buffer[i];
				while (!isEmpty(ch) && ch !== ">") ch = this.buffer[++i];
				return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
			} else {
				let i = this.pos + 1;
				let ch = this.buffer[i];
				while (ch) if (tagChars.has(ch)) ch = this.buffer[++i];
				else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) ch = this.buffer[i += 3];
				else break;
				return yield* this.pushToIndex(i, false);
			}
		}
		*pushNewline() {
			const ch = this.buffer[this.pos];
			if (ch === "\n") return yield* this.pushCount(1);
			else if (ch === "\r" && this.charAt(1) === "\n") return yield* this.pushCount(2);
			else return 0;
		}
		*pushSpaces(allowTabs) {
			let i = this.pos - 1;
			let ch;
			do
				ch = this.buffer[++i];
			while (ch === " " || allowTabs && ch === "	");
			const n = i - this.pos;
			if (n > 0) {
				yield this.buffer.substr(this.pos, n);
				this.pos = i;
			}
			return n;
		}
		*pushUntil(test) {
			let i = this.pos;
			let ch = this.buffer[i];
			while (!test(ch)) ch = this.buffer[++i];
			return yield* this.pushToIndex(i, false);
		}
	};
	exports.Lexer = Lexer;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Tracks newlines during parsing in order to provide an efficient API for
	* determining the one-indexed `{ line, col }` position for any offset
	* within the input.
	*/
	var LineCounter = class {
		constructor() {
			this.lineStarts = [];
			/**
			* Should be called in ascending order. Otherwise, call
			* `lineCounter.lineStarts.sort()` before calling `linePos()`.
			*/
			this.addNewLine = (offset) => this.lineStarts.push(offset);
			/**
			* Performs a binary search and returns the 1-indexed { line, col }
			* position of `offset`. If `line === 0`, `addNewLine` has never been
			* called or `offset` is before the first known newline.
			*/
			this.linePos = (offset) => {
				let low = 0;
				let high = this.lineStarts.length;
				while (low < high) {
					const mid = low + high >> 1;
					if (this.lineStarts[mid] < offset) low = mid + 1;
					else high = mid;
				}
				if (this.lineStarts[low] === offset) return {
					line: low + 1,
					col: 1
				};
				if (low === 0) return {
					line: 0,
					col: offset
				};
				const start = this.lineStarts[low - 1];
				return {
					line: low,
					col: offset - start + 1
				};
			};
		}
	};
	exports.LineCounter = LineCounter;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/parser.js
var require_parser = /* @__PURE__ */ __commonJSMin(((exports) => {
	var node_process = __require("process");
	var cst = require_cst();
	var lexer = require_lexer();
	function includesToken(list, type) {
		for (let i = 0; i < list.length; ++i) if (list[i].type === type) return true;
		return false;
	}
	function findNonEmptyIndex(list) {
		for (let i = 0; i < list.length; ++i) switch (list[i].type) {
			case "space":
			case "comment":
			case "newline": break;
			default: return i;
		}
		return -1;
	}
	function isFlowToken(token) {
		switch (token?.type) {
			case "alias":
			case "scalar":
			case "single-quoted-scalar":
			case "double-quoted-scalar":
			case "flow-collection": return true;
			default: return false;
		}
	}
	function getPrevProps(parent) {
		switch (parent.type) {
			case "document": return parent.start;
			case "block-map": {
				const it = parent.items[parent.items.length - 1];
				return it.sep ?? it.start;
			}
			case "block-seq": return parent.items[parent.items.length - 1].start;
			/* istanbul ignore next should not happen */
			default: return [];
		}
	}
	/** Note: May modify input array */
	function getFirstKeyStartProps(prev) {
		if (prev.length === 0) return [];
		let i = prev.length;
		loop: while (--i >= 0) switch (prev[i].type) {
			case "doc-start":
			case "explicit-key-ind":
			case "map-value-ind":
			case "seq-item-ind":
			case "newline": break loop;
		}
		while (prev[++i]?.type === "space");
		return prev.splice(i, prev.length);
	}
	function arrayPushArray(target, source) {
		if (source.length < 1e5) Array.prototype.push.apply(target, source);
		else for (let i = 0; i < source.length; ++i) target.push(source[i]);
	}
	function fixFlowSeqItems(fc) {
		if (fc.start.type === "flow-seq-start") {
			for (const it of fc.items) if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
				if (it.key) it.value = it.key;
				delete it.key;
				if (isFlowToken(it.value)) {
					if (it.value.end) arrayPushArray(it.value.end, it.sep);
					else it.value.end = it.sep;
				} else arrayPushArray(it.start, it.sep);
				delete it.sep;
			}
		}
	}
	/**
	* A YAML concrete syntax tree (CST) parser
	*
	* ```ts
	* const src: string = ...
	* for (const token of new Parser().parse(src)) {
	*   // token: Token
	* }
	* ```
	*
	* To use the parser with a user-provided lexer:
	*
	* ```ts
	* function* parse(source: string, lexer: Lexer) {
	*   const parser = new Parser()
	*   for (const lexeme of lexer.lex(source))
	*     yield* parser.next(lexeme)
	*   yield* parser.end()
	* }
	*
	* const src: string = ...
	* const lexer = new Lexer()
	* for (const token of parse(src, lexer)) {
	*   // token: Token
	* }
	* ```
	*/
	var Parser = class {
		/**
		* @param onNewLine - If defined, called separately with the start position of
		*   each new line (in `parse()`, including the start of input).
		*/
		constructor(onNewLine) {
			/** If true, space and sequence indicators count as indentation */
			this.atNewLine = true;
			/** If true, next token is a scalar value */
			this.atScalar = false;
			/** Current indentation level */
			this.indent = 0;
			/** Current offset since the start of parsing */
			this.offset = 0;
			/** On the same line with a block map key */
			this.onKeyLine = false;
			/** Top indicates the node that's currently being built */
			this.stack = [];
			/** The source of the current token, set in parse() */
			this.source = "";
			/** The type of the current token, set in parse() */
			this.type = "";
			this.lexer = new lexer.Lexer();
			this.onNewLine = onNewLine;
		}
		/**
		* Parse `source` as a YAML stream.
		* If `incomplete`, a part of the last line may be left as a buffer for the next call.
		*
		* Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
		*
		* @returns A generator of tokens representing each directive, document, and other structure.
		*/
		*parse(source, incomplete = false) {
			if (this.onNewLine && this.offset === 0) this.onNewLine(0);
			for (const lexeme of this.lexer.lex(source, incomplete)) yield* this.next(lexeme);
			if (!incomplete) yield* this.end();
		}
		/**
		* Advance the parser by the `source` of one lexical token.
		*/
		*next(source) {
			this.source = source;
			if (node_process.env.LOG_TOKENS) console.log("|", cst.prettyToken(source));
			if (this.atScalar) {
				this.atScalar = false;
				yield* this.step();
				this.offset += source.length;
				return;
			}
			const type = cst.tokenType(source);
			if (!type) {
				const message = `Not a YAML token: ${source}`;
				yield* this.pop({
					type: "error",
					offset: this.offset,
					message,
					source
				});
				this.offset += source.length;
			} else if (type === "scalar") {
				this.atNewLine = false;
				this.atScalar = true;
				this.type = "scalar";
			} else {
				this.type = type;
				yield* this.step();
				switch (type) {
					case "newline":
						this.atNewLine = true;
						this.indent = 0;
						if (this.onNewLine) this.onNewLine(this.offset + source.length);
						break;
					case "space":
						if (this.atNewLine && source[0] === " ") this.indent += source.length;
						break;
					case "explicit-key-ind":
					case "map-value-ind":
					case "seq-item-ind":
						if (this.atNewLine) this.indent += source.length;
						break;
					case "doc-mode":
					case "flow-error-end": return;
					default: this.atNewLine = false;
				}
				this.offset += source.length;
			}
		}
		/** Call at end of input to push out any remaining constructions */
		*end() {
			while (this.stack.length > 0) yield* this.pop();
		}
		get sourceToken() {
			return {
				type: this.type,
				offset: this.offset,
				indent: this.indent,
				source: this.source
			};
		}
		*step() {
			const top = this.peek(1);
			if (this.type === "doc-end" && top?.type !== "doc-end") {
				while (this.stack.length > 0) yield* this.pop();
				this.stack.push({
					type: "doc-end",
					offset: this.offset,
					source: this.source
				});
				return;
			}
			if (!top) return yield* this.stream();
			switch (top.type) {
				case "document": return yield* this.document(top);
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return yield* this.scalar(top);
				case "block-scalar": return yield* this.blockScalar(top);
				case "block-map": return yield* this.blockMap(top);
				case "block-seq": return yield* this.blockSequence(top);
				case "flow-collection": return yield* this.flowCollection(top);
				case "doc-end": return yield* this.documentEnd(top);
			}
			/* istanbul ignore next should not happen */
			yield* this.pop();
		}
		peek(n) {
			return this.stack[this.stack.length - n];
		}
		*pop(error) {
			const token = error ?? this.stack.pop();
			/* istanbul ignore if should not happen */
			if (!token) yield {
				type: "error",
				offset: this.offset,
				source: "",
				message: "Tried to pop an empty stack"
			};
			else if (this.stack.length === 0) yield token;
			else {
				const top = this.peek(1);
				if (token.type === "block-scalar") token.indent = "indent" in top ? top.indent : 0;
				else if (token.type === "flow-collection" && top.type === "document") token.indent = 0;
				if (token.type === "flow-collection") fixFlowSeqItems(token);
				switch (top.type) {
					case "document":
						top.value = token;
						break;
					case "block-scalar":
						top.props.push(token);
						break;
					case "block-map": {
						const it = top.items[top.items.length - 1];
						if (it.value) {
							top.items.push({
								start: [],
								key: token,
								sep: []
							});
							this.onKeyLine = true;
							return;
						} else if (it.sep) it.value = token;
						else {
							Object.assign(it, {
								key: token,
								sep: []
							});
							this.onKeyLine = !it.explicitKey;
							return;
						}
						break;
					}
					case "block-seq": {
						const it = top.items[top.items.length - 1];
						if (it.value) top.items.push({
							start: [],
							value: token
						});
						else it.value = token;
						break;
					}
					case "flow-collection": {
						const it = top.items[top.items.length - 1];
						if (!it || it.value) top.items.push({
							start: [],
							key: token,
							sep: []
						});
						else if (it.sep) it.value = token;
						else Object.assign(it, {
							key: token,
							sep: []
						});
						return;
					}
					/* istanbul ignore next should not happen */
					default:
						yield* this.pop();
						yield* this.pop(token);
				}
				if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
					const last = token.items[token.items.length - 1];
					if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
						if (top.type === "document") top.end = last.start;
						else top.items.push({ start: last.start });
						token.items.splice(-1, 1);
					}
				}
			}
		}
		*stream() {
			switch (this.type) {
				case "directive-line":
					yield {
						type: "directive",
						offset: this.offset,
						source: this.source
					};
					return;
				case "byte-order-mark":
				case "space":
				case "comment":
				case "newline":
					yield this.sourceToken;
					return;
				case "doc-mode":
				case "doc-start": {
					const doc = {
						type: "document",
						offset: this.offset,
						start: []
					};
					if (this.type === "doc-start") doc.start.push(this.sourceToken);
					this.stack.push(doc);
					return;
				}
			}
			yield {
				type: "error",
				offset: this.offset,
				message: `Unexpected ${this.type} token in YAML stream`,
				source: this.source
			};
		}
		*document(doc) {
			if (doc.value) return yield* this.lineEnd(doc);
			switch (this.type) {
				case "doc-start":
					if (findNonEmptyIndex(doc.start) !== -1) {
						yield* this.pop();
						yield* this.step();
					} else doc.start.push(this.sourceToken);
					return;
				case "anchor":
				case "tag":
				case "space":
				case "comment":
				case "newline":
					doc.start.push(this.sourceToken);
					return;
			}
			const bv = this.startBlockValue(doc);
			if (bv) this.stack.push(bv);
			else yield {
				type: "error",
				offset: this.offset,
				message: `Unexpected ${this.type} token in YAML document`,
				source: this.source
			};
		}
		*scalar(scalar) {
			if (this.type === "map-value-ind") {
				const start = getFirstKeyStartProps(getPrevProps(this.peek(2)));
				let sep;
				if (scalar.end) {
					sep = scalar.end;
					sep.push(this.sourceToken);
					delete scalar.end;
				} else sep = [this.sourceToken];
				const map = {
					type: "block-map",
					offset: scalar.offset,
					indent: scalar.indent,
					items: [{
						start,
						key: scalar,
						sep
					}]
				};
				this.onKeyLine = true;
				this.stack[this.stack.length - 1] = map;
			} else yield* this.lineEnd(scalar);
		}
		*blockScalar(scalar) {
			switch (this.type) {
				case "space":
				case "comment":
				case "newline":
					scalar.props.push(this.sourceToken);
					return;
				case "scalar":
					scalar.source = this.source;
					this.atNewLine = true;
					this.indent = 0;
					if (this.onNewLine) {
						let nl = this.source.indexOf("\n") + 1;
						while (nl !== 0) {
							this.onNewLine(this.offset + nl);
							nl = this.source.indexOf("\n", nl) + 1;
						}
					}
					yield* this.pop();
					break;
				/* istanbul ignore next should not happen */
				default:
					yield* this.pop();
					yield* this.step();
			}
		}
		*blockMap(map) {
			const it = map.items[map.items.length - 1];
			switch (this.type) {
				case "newline":
					this.onKeyLine = false;
					if (it.value) {
						const end = "end" in it.value ? it.value.end : void 0;
						if ((Array.isArray(end) ? end[end.length - 1] : void 0)?.type === "comment") end?.push(this.sourceToken);
						else map.items.push({ start: [this.sourceToken] });
					} else if (it.sep) it.sep.push(this.sourceToken);
					else it.start.push(this.sourceToken);
					return;
				case "space":
				case "comment":
					if (it.value) map.items.push({ start: [this.sourceToken] });
					else if (it.sep) it.sep.push(this.sourceToken);
					else {
						if (this.atIndentedComment(it.start, map.indent)) {
							const end = map.items[map.items.length - 2]?.value?.end;
							if (Array.isArray(end)) {
								arrayPushArray(end, it.start);
								end.push(this.sourceToken);
								map.items.pop();
								return;
							}
						}
						it.start.push(this.sourceToken);
					}
					return;
			}
			if (this.indent >= map.indent) {
				const atMapIndent = !this.onKeyLine && this.indent === map.indent;
				const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
				let start = [];
				if (atNextItem && it.sep && !it.value) {
					const nl = [];
					for (let i = 0; i < it.sep.length; ++i) {
						const st = it.sep[i];
						switch (st.type) {
							case "newline":
								nl.push(i);
								break;
							case "space": break;
							case "comment":
								if (st.indent > map.indent) nl.length = 0;
								break;
							default: nl.length = 0;
						}
					}
					if (nl.length >= 2) start = it.sep.splice(nl[1]);
				}
				switch (this.type) {
					case "anchor":
					case "tag":
						if (atNextItem || it.value) {
							start.push(this.sourceToken);
							map.items.push({ start });
							this.onKeyLine = true;
						} else if (it.sep) it.sep.push(this.sourceToken);
						else it.start.push(this.sourceToken);
						return;
					case "explicit-key-ind":
						if (!it.sep && !it.explicitKey) {
							it.start.push(this.sourceToken);
							it.explicitKey = true;
						} else if (atNextItem || it.value) {
							start.push(this.sourceToken);
							map.items.push({
								start,
								explicitKey: true
							});
						} else this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start: [this.sourceToken],
								explicitKey: true
							}]
						});
						this.onKeyLine = true;
						return;
					case "map-value-ind":
						if (it.explicitKey) {
							if (!it.sep) {
								if (includesToken(it.start, "newline")) Object.assign(it, {
									key: null,
									sep: [this.sourceToken]
								});
								else {
									const start = getFirstKeyStartProps(it.start);
									this.stack.push({
										type: "block-map",
										offset: this.offset,
										indent: this.indent,
										items: [{
											start,
											key: null,
											sep: [this.sourceToken]
										}]
									});
								}
							} else if (it.value) map.items.push({
								start: [],
								key: null,
								sep: [this.sourceToken]
							});
							else if (includesToken(it.sep, "map-value-ind")) this.stack.push({
								type: "block-map",
								offset: this.offset,
								indent: this.indent,
								items: [{
									start,
									key: null,
									sep: [this.sourceToken]
								}]
							});
							else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
								const start = getFirstKeyStartProps(it.start);
								const key = it.key;
								const sep = it.sep;
								sep.push(this.sourceToken);
								delete it.key;
								delete it.sep;
								this.stack.push({
									type: "block-map",
									offset: this.offset,
									indent: this.indent,
									items: [{
										start,
										key,
										sep
									}]
								});
							} else if (start.length > 0) it.sep = it.sep.concat(start, this.sourceToken);
							else it.sep.push(this.sourceToken);
						} else if (!it.sep) Object.assign(it, {
							key: null,
							sep: [this.sourceToken]
						});
						else if (it.value || atNextItem) map.items.push({
							start,
							key: null,
							sep: [this.sourceToken]
						});
						else if (includesToken(it.sep, "map-value-ind")) this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start: [],
								key: null,
								sep: [this.sourceToken]
							}]
						});
						else it.sep.push(this.sourceToken);
						this.onKeyLine = true;
						return;
					case "alias":
					case "scalar":
					case "single-quoted-scalar":
					case "double-quoted-scalar": {
						const fs = this.flowScalar(this.type);
						if (atNextItem || it.value) {
							map.items.push({
								start,
								key: fs,
								sep: []
							});
							this.onKeyLine = true;
						} else if (it.sep) this.stack.push(fs);
						else {
							Object.assign(it, {
								key: fs,
								sep: []
							});
							this.onKeyLine = true;
						}
						return;
					}
					default: {
						const bv = this.startBlockValue(map);
						if (bv) {
							if (bv.type === "block-seq") {
								if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
									yield* this.pop({
										type: "error",
										offset: this.offset,
										message: "Unexpected block-seq-ind on same line with key",
										source: this.source
									});
									return;
								}
							} else if (atMapIndent) map.items.push({ start });
							this.stack.push(bv);
							return;
						}
					}
				}
			}
			yield* this.pop();
			yield* this.step();
		}
		*blockSequence(seq) {
			const it = seq.items[seq.items.length - 1];
			switch (this.type) {
				case "newline":
					if (it.value) {
						const end = "end" in it.value ? it.value.end : void 0;
						if ((Array.isArray(end) ? end[end.length - 1] : void 0)?.type === "comment") end?.push(this.sourceToken);
						else seq.items.push({ start: [this.sourceToken] });
					} else it.start.push(this.sourceToken);
					return;
				case "space":
				case "comment":
					if (it.value) seq.items.push({ start: [this.sourceToken] });
					else {
						if (this.atIndentedComment(it.start, seq.indent)) {
							const end = seq.items[seq.items.length - 2]?.value?.end;
							if (Array.isArray(end)) {
								arrayPushArray(end, it.start);
								end.push(this.sourceToken);
								seq.items.pop();
								return;
							}
						}
						it.start.push(this.sourceToken);
					}
					return;
				case "anchor":
				case "tag":
					if (it.value || this.indent <= seq.indent) break;
					it.start.push(this.sourceToken);
					return;
				case "seq-item-ind":
					if (this.indent !== seq.indent) break;
					if (it.value || includesToken(it.start, "seq-item-ind")) seq.items.push({ start: [this.sourceToken] });
					else it.start.push(this.sourceToken);
					return;
			}
			if (this.indent > seq.indent) {
				const bv = this.startBlockValue(seq);
				if (bv) {
					this.stack.push(bv);
					return;
				}
			}
			yield* this.pop();
			yield* this.step();
		}
		*flowCollection(fc) {
			const it = fc.items[fc.items.length - 1];
			if (this.type === "flow-error-end") {
				let top;
				do {
					yield* this.pop();
					top = this.peek(1);
				} while (top?.type === "flow-collection");
			} else if (fc.end.length === 0) {
				switch (this.type) {
					case "comma":
					case "explicit-key-ind":
						if (!it || it.sep) fc.items.push({ start: [this.sourceToken] });
						else it.start.push(this.sourceToken);
						return;
					case "map-value-ind":
						if (!it || it.value) fc.items.push({
							start: [],
							key: null,
							sep: [this.sourceToken]
						});
						else if (it.sep) it.sep.push(this.sourceToken);
						else Object.assign(it, {
							key: null,
							sep: [this.sourceToken]
						});
						return;
					case "space":
					case "comment":
					case "newline":
					case "anchor":
					case "tag":
						if (!it || it.value) fc.items.push({ start: [this.sourceToken] });
						else if (it.sep) it.sep.push(this.sourceToken);
						else it.start.push(this.sourceToken);
						return;
					case "alias":
					case "scalar":
					case "single-quoted-scalar":
					case "double-quoted-scalar": {
						const fs = this.flowScalar(this.type);
						if (!it || it.value) fc.items.push({
							start: [],
							key: fs,
							sep: []
						});
						else if (it.sep) this.stack.push(fs);
						else Object.assign(it, {
							key: fs,
							sep: []
						});
						return;
					}
					case "flow-map-end":
					case "flow-seq-end":
						fc.end.push(this.sourceToken);
						return;
				}
				const bv = this.startBlockValue(fc);
				/* istanbul ignore else should not happen */
				if (bv) this.stack.push(bv);
				else {
					yield* this.pop();
					yield* this.step();
				}
			} else {
				const parent = this.peek(2);
				if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
					yield* this.pop();
					yield* this.step();
				} else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
					const start = getFirstKeyStartProps(getPrevProps(parent));
					fixFlowSeqItems(fc);
					const sep = fc.end.splice(1, fc.end.length);
					sep.push(this.sourceToken);
					const map = {
						type: "block-map",
						offset: fc.offset,
						indent: fc.indent,
						items: [{
							start,
							key: fc,
							sep
						}]
					};
					this.onKeyLine = true;
					this.stack[this.stack.length - 1] = map;
				} else yield* this.lineEnd(fc);
			}
		}
		flowScalar(type) {
			if (this.onNewLine) {
				let nl = this.source.indexOf("\n") + 1;
				while (nl !== 0) {
					this.onNewLine(this.offset + nl);
					nl = this.source.indexOf("\n", nl) + 1;
				}
			}
			return {
				type,
				offset: this.offset,
				indent: this.indent,
				source: this.source
			};
		}
		startBlockValue(parent) {
			switch (this.type) {
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return this.flowScalar(this.type);
				case "block-scalar-header": return {
					type: "block-scalar",
					offset: this.offset,
					indent: this.indent,
					props: [this.sourceToken],
					source: ""
				};
				case "flow-map-start":
				case "flow-seq-start": return {
					type: "flow-collection",
					offset: this.offset,
					indent: this.indent,
					start: this.sourceToken,
					items: [],
					end: []
				};
				case "seq-item-ind": return {
					type: "block-seq",
					offset: this.offset,
					indent: this.indent,
					items: [{ start: [this.sourceToken] }]
				};
				case "explicit-key-ind": {
					this.onKeyLine = true;
					const start = getFirstKeyStartProps(getPrevProps(parent));
					start.push(this.sourceToken);
					return {
						type: "block-map",
						offset: this.offset,
						indent: this.indent,
						items: [{
							start,
							explicitKey: true
						}]
					};
				}
				case "map-value-ind": {
					this.onKeyLine = true;
					const start = getFirstKeyStartProps(getPrevProps(parent));
					return {
						type: "block-map",
						offset: this.offset,
						indent: this.indent,
						items: [{
							start,
							key: null,
							sep: [this.sourceToken]
						}]
					};
				}
			}
			return null;
		}
		atIndentedComment(start, indent) {
			if (this.type !== "comment") return false;
			if (this.indent <= indent) return false;
			return start.every((st) => st.type === "newline" || st.type === "space");
		}
		*documentEnd(docEnd) {
			if (this.type !== "doc-mode") {
				if (docEnd.end) docEnd.end.push(this.sourceToken);
				else docEnd.end = [this.sourceToken];
				if (this.type === "newline") yield* this.pop();
			}
		}
		*lineEnd(token) {
			switch (this.type) {
				case "comma":
				case "doc-start":
				case "doc-end":
				case "flow-seq-end":
				case "flow-map-end":
				case "map-value-ind":
					yield* this.pop();
					yield* this.step();
					break;
				case "newline": this.onKeyLine = false;
				default:
					if (token.end) token.end.push(this.sourceToken);
					else token.end = [this.sourceToken];
					if (this.type === "newline") yield* this.pop();
			}
		}
	};
	exports.Parser = Parser;
}));
//#endregion
//#region node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/public-api.js
var require_public_api = /* @__PURE__ */ __commonJSMin(((exports) => {
	var composer = require_composer();
	var Document = require_Document();
	var errors = require_errors();
	var log = require_log();
	var identity = require_identity();
	var lineCounter = require_line_counter();
	var parser = require_parser();
	function parseOptions(options) {
		const prettyErrors = options.prettyErrors !== false;
		return {
			lineCounter: options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null,
			prettyErrors
		};
	}
	/**
	* Parse the input as a stream of YAML documents.
	*
	* Documents should be separated from each other by `...` or `---` marker lines.
	*
	* @returns If an empty `docs` array is returned, it will be of type
	*   EmptyStream and contain additional stream information. In
	*   TypeScript, you should use `'empty' in docs` as a type guard for it.
	*/
	function parseAllDocuments(source, options = {}) {
		const { lineCounter, prettyErrors } = parseOptions(options);
		const parser$1 = new parser.Parser(lineCounter?.addNewLine);
		const composer$1 = new composer.Composer(options);
		const docs = Array.from(composer$1.compose(parser$1.parse(source)));
		if (prettyErrors && lineCounter) for (const doc of docs) {
			doc.errors.forEach(errors.prettifyError(source, lineCounter));
			doc.warnings.forEach(errors.prettifyError(source, lineCounter));
		}
		if (docs.length > 0) return docs;
		return Object.assign([], { empty: true }, composer$1.streamInfo());
	}
	/** Parse an input string into a single YAML.Document */
	function parseDocument(source, options = {}) {
		const { lineCounter, prettyErrors } = parseOptions(options);
		const parser$1 = new parser.Parser(lineCounter?.addNewLine);
		const composer$1 = new composer.Composer(options);
		let doc = null;
		for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) if (!doc) doc = _doc;
		else if (doc.options.logLevel !== "silent") {
			doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
			break;
		}
		if (prettyErrors && lineCounter) {
			doc.errors.forEach(errors.prettifyError(source, lineCounter));
			doc.warnings.forEach(errors.prettifyError(source, lineCounter));
		}
		return doc;
	}
	function parse(src, reviver, options) {
		let _reviver = void 0;
		if (typeof reviver === "function") _reviver = reviver;
		else if (options === void 0 && reviver && typeof reviver === "object") options = reviver;
		const doc = parseDocument(src, options);
		if (!doc) return null;
		doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
		if (doc.errors.length > 0) {
			if (doc.options.logLevel !== "silent") throw doc.errors[0];
			else doc.errors = [];
		}
		return doc.toJS(Object.assign({ reviver: _reviver }, options));
	}
	function stringify(value, replacer, options) {
		let _replacer = null;
		if (typeof replacer === "function" || Array.isArray(replacer)) _replacer = replacer;
		else if (options === void 0 && replacer) options = replacer;
		if (typeof options === "string") options = options.length;
		if (typeof options === "number") {
			const indent = Math.round(options);
			options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
		}
		if (value === void 0) {
			const { keepUndefined } = options ?? replacer ?? {};
			if (!keepUndefined) return void 0;
		}
		if (identity.isDocument(value) && !_replacer) return value.toString(options);
		return new Document.Document(value, _replacer, options).toString(options);
	}
	exports.parse = parse;
	exports.parseAllDocuments = parseAllDocuments;
	exports.parseDocument = parseDocument;
	exports.stringify = stringify;
}));
//#endregion
//#region src/host/artifacts.ts
var import_dist = (/* @__PURE__ */ __commonJSMin(((exports) => {
	var composer = require_composer();
	var Document = require_Document();
	var Schema = require_Schema();
	var errors = require_errors();
	var Alias = require_Alias();
	var identity = require_identity();
	var Pair = require_Pair();
	var Scalar = require_Scalar();
	var YAMLMap = require_YAMLMap();
	var YAMLSeq = require_YAMLSeq();
	require_cst();
	var lexer = require_lexer();
	var lineCounter = require_line_counter();
	var parser = require_parser();
	var publicApi = require_public_api();
	var visit = require_visit();
	exports.Composer = composer.Composer;
	exports.Document = Document.Document;
	exports.Schema = Schema.Schema;
	exports.YAMLError = errors.YAMLError;
	exports.YAMLParseError = errors.YAMLParseError;
	exports.YAMLWarning = errors.YAMLWarning;
	exports.Alias = Alias.Alias;
	exports.isAlias = identity.isAlias;
	exports.isCollection = identity.isCollection;
	exports.isDocument = identity.isDocument;
	exports.isMap = identity.isMap;
	exports.isNode = identity.isNode;
	exports.isPair = identity.isPair;
	exports.isScalar = identity.isScalar;
	exports.isSeq = identity.isSeq;
	exports.Pair = Pair.Pair;
	exports.Scalar = Scalar.Scalar;
	exports.YAMLMap = YAMLMap.YAMLMap;
	exports.YAMLSeq = YAMLSeq.YAMLSeq;
	exports.Lexer = lexer.Lexer;
	exports.LineCounter = lineCounter.LineCounter;
	exports.Parser = parser.Parser;
	exports.parse = publicApi.parse;
	exports.parseAllDocuments = publicApi.parseAllDocuments;
	exports.parseDocument = publicApi.parseDocument;
	exports.stringify = publicApi.stringify;
	exports.visit = visit.visit;
	exports.visitAsync = visit.visitAsync;
})))();
function contained$1(root, candidate) {
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
		if (originalInfo.isSymbolicLink() || !originalInfo.isFile() || !contained$1(storePath, candidatePath)) return void 0;
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
function isRecord$6(value) {
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
function exactKeys$3(value, allowed, field) {
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
	if ((0, import_semver.valid)(version) !== version) throw new TypeError(field + " must be an exact semantic version");
	return version;
}
function sha256Digest(value, field) {
	const digest = nonEmpty(value, field);
	if (!/^[0-9a-f]{64}$/.test(digest)) throw new TypeError(field + " must be a lowercase SHA-256 digest");
	return digest;
}
function parseDevice(value, field) {
	if (!isRecord$6(value)) throw new TypeError(field + " must be an object");
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
	if (!isRecord$6(value)) throw new TypeError(field + " must be an object");
	const profiles = strings(value.profiles, field + ".profiles");
	const runtimeModules = strings(value.runtimeModules, field + ".runtimeModules");
	let target;
	if (value.target !== void 0) {
		if (!isRecord$6(value.target)) throw new TypeError(field + ".target must be an object");
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
	if (!isRecord$6(value)) throw new TypeError(field + " must be an object");
	const kind = nonEmpty(value.kind, field + ".kind");
	if (kind === "npm") {
		exactKeys$3(value, [
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
		exactKeys$3(value, [
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
		exactKeys$3(value, [
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
	if (!isRecord$6(value)) throw new TypeError(field + " must be an object");
	exactKeys$3(value, [
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
	if (!isRecord$6(value)) throw new TypeError(field + " must be an object");
	exactKeys$3(value, [
		"id",
		"version",
		"profile",
		"dshRange",
		"plugins"
	], field);
	if (value.id !== void 0 && safeIdentifier(value.id, field + ".id") !== id) throw new TypeError(field + ".id must match its profileReleases key");
	const dshRange = nonEmpty(value.dshRange, field + ".dshRange");
	if ((0, import_semver.validRange)(dshRange) === null) throw new TypeError(field + ".dshRange must be a valid semantic-version range");
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
	exactKeys$3(raw, [
		"schemaVersion",
		"team",
		"devices",
		"profileReleases",
		"assignments"
	], "fleet manifest");
	if (!isRecord$6(raw.profileReleases)) throw new TypeError("profileReleases must be an object");
	const profileReleases = {};
	for (const [rawId, value] of Object.entries(raw.profileReleases)) {
		const id = safeIdentifier(rawId, "profile release id");
		profileReleases[id] = parseProfileRelease(id, value, "profileReleases." + id);
	}
	if (Object.keys(profileReleases).length === 0) throw new TypeError("profileReleases must not be empty");
	if (!isRecord$6(raw.assignments)) throw new TypeError("assignments must be an object");
	const assignments = {};
	const plugins = [];
	for (const [rawDeviceId, value] of Object.entries(raw.assignments)) {
		const deviceId = normalizeDeviceId(rawDeviceId, "assignment device id");
		if (devices[deviceId] === void 0) throw new TypeError("assignments." + deviceId + " references an unknown device");
		if (!isRecord$6(value) || Object.keys(value).length === 0) throw new TypeError("assignments." + deviceId + " must be a non-empty profile-to-release object");
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
	const raw = (0, import_dist.parse)(source);
	if (!isRecord$6(raw)) throw new TypeError("fleet manifest must be an object");
	if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) throw new TypeError("schemaVersion must equal 1 or 2");
	if (!isRecord$6(raw.team)) throw new TypeError("team must be an object");
	if (raw.schemaVersion === 2) exactKeys$3(raw.team, ["id", "name"], "team");
	const teamId = nonEmpty(raw.team.id, "team.id");
	const teamName = raw.team.name === void 0 ? void 0 : nonEmpty(raw.team.name, "team.name");
	if (!isRecord$6(raw.devices)) throw new TypeError("devices must be an object");
	const devices = {};
	for (const [id, value] of Object.entries(raw.devices)) {
		const deviceId = normalizeDeviceId(id, "device id");
		if (raw.schemaVersion === 2 && isRecord$6(value)) exactKeys$3(value, [
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
//#endregion
//#region src/host/runtime-identity.ts
const DSH_PACKAGE_NAME = "@deepseek-ai/dsh";
const MAX_PACKAGE_SEARCH_DEPTH = 8;
function sha256$2(value) {
	return createHash("sha256").update(value).digest("hex");
}
async function readRegularFile$1(path) {
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
			const packageJson = await readRegularFile$1(candidate);
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
	const [entrypoint, packageMetadata] = await Promise.all([readRegularFile$1(dshEntrypointRealpath), findDshPackage(dshEntrypointRealpath)]);
	const entrypointDigest = sha256$2(entrypoint);
	const packageJsonDigest = sha256$2(packageMetadata.packageJson);
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
		runtimeDigest: sha256$2(JSON.stringify(identity))
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
	if (sha256$2(JSON.stringify(identity)) !== body.runtimeDigest) throw new TypeError("runtime identity digest does not match its fields");
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
function isRecord$5(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function rejectUnknownKeys(value, keys, label) {
	if (!isRecord$5(value)) throw new FleetPlannerError("invalid-input", label + " must be an object");
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
	if (input.manifest.schemaVersion !== 1 || !Array.isArray(input.manifest.plugins) || !isRecord$5(input.manifest.devices)) throw new FleetPlannerError("invalid-input", "planner requires a parsed schemaVersion 1 manifest");
	if (!isRecord$5(input.dependencies)) throw new FleetPlannerError("invalid-input", "dependencies must be an object");
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
	"fromManifestDigest",
	"toManifestDigest",
	"fromReleaseDigest",
	"toReleaseDigest",
	"manifestDigest",
	"profileHash",
	"observedDshVersion",
	"observedRuntimeDigest",
	"observedServiceDefinitionDigest",
	"releaseId",
	"releaseVersion",
	"releaseDigest",
	"plugins",
	"changes",
	"restartRequired",
	"createdAt",
	"expiresAt"
];
const PLAN_KEYS$1 = [
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
const APPROVAL_KEYS$1 = [
	"protocolVersion",
	"kind",
	"approvalId",
	"principalId",
	"planId",
	"planDigest",
	"deviceId",
	"profile",
	"fromManifestDigest",
	"toManifestDigest",
	"fromReleaseDigest",
	"toReleaseDigest",
	"approvedAt",
	"expiresAt"
];
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
const ROLLBACK_APPROVAL_KEYS = [
	"protocolVersion",
	"kind",
	"approvalId",
	"principalId",
	"planId",
	"planDigest",
	"transitionPlanId",
	"deviceId",
	"profile",
	"fromManifestDigest",
	"toManifestDigest",
	"fromReleaseDigest",
	"toReleaseDigest",
	"approvedAt",
	"expiresAt"
];
const APPLIED_V1_KEYS = [
	"schemaVersion",
	"deviceId",
	"profile",
	"releaseId",
	"releaseVersion",
	"releaseDigest",
	"plugins",
	"appliedAt"
];
const APPLIED_V2_KEYS = [
	...APPLIED_V1_KEYS,
	"transitionPlanId",
	"transitionPlanDigest"
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
function assertVisibility(value, field) {
	if (value !== "public" && value !== "private") throw new FleetProtocolError("invalid-payload", field + " must be public or private");
}
function assertSourceKind(value, field) {
	if (value !== "npm" && value !== "github" && value !== "artifact") throw new FleetProtocolError("unsupported-source", field + " must be npm, github or artifact");
}
function validateExactSource(sourceKind, exactSpec, artifactDigest, visibility) {
	if (sourceKind === "npm") {
		if (visibility !== "public" || (0, import_semver.valid)(exactSpec) !== exactSpec || artifactDigest !== null) throw new FleetProtocolError("unsupported-source", "npm bindings require a public exact semantic version");
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
	if (value.packageVersion !== null && (0, import_semver.valid)(value.packageVersion) !== value.packageVersion) throw new FleetProtocolError("invalid-payload", field + ".packageVersion must be an exact semantic version or null");
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
	if (value.protocolVersion !== 2 || value.kind !== "profile-release") throw new FleetProtocolError("invalid-protocol", "unsupported release protocol");
	assertIdentifier(value.deviceId, "deviceId");
	assertIdentifier(value.profile, "profile");
	assertDigest(value.fromManifestDigest, "fromManifestDigest");
	assertDigest(value.toManifestDigest, "toManifestDigest");
	assertNullableDigest(value.fromReleaseDigest, "fromReleaseDigest");
	assertDigest(value.toReleaseDigest, "toReleaseDigest");
	assertDigest(value.manifestDigest, "manifestDigest");
	assertDigest(value.profileHash, "profileHash");
	assertString(value.observedDshVersion, "observedDshVersion");
	if (!isSupportedDshVersion(value.observedDshVersion)) throw new FleetProtocolError("unsupported-dsh-version", "DSH version is outside the supported Agent range");
	assertDigest(value.observedRuntimeDigest, "observedRuntimeDigest");
	assertNullableDigest(value.observedServiceDefinitionDigest, "observedServiceDefinitionDigest");
	assertIdentifier(value.releaseId, "releaseId");
	assertString(value.releaseVersion, "releaseVersion");
	if ((0, import_semver.valid)(value.releaseVersion) !== value.releaseVersion) throw new FleetProtocolError("invalid-payload", "releaseVersion must be an exact semantic version");
	assertDigest(value.releaseDigest, "releaseDigest");
	if (value.manifestDigest !== value.toManifestDigest || value.releaseDigest !== value.toReleaseDigest) throw new FleetProtocolError("plan-integrity-failed", "legacy release digest aliases must equal the transition target digests");
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
	if (value.changes.length > 0 && value.restartRequired !== true) throw new FleetProtocolError("invalid-payload", "a plugin change requires a profile restart");
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
	assertExactKeys(value, PLAN_KEYS$1, "release plan");
	const body = Object.fromEntries(PLAN_BODY_KEYS.map((key) => [key, value[key]]));
	validatePlanBody(body);
	assertDigest(value.digest, "digest");
	const digest = sha256Canonical(body);
	if (value.digest !== digest || value.planId !== "release-plan:" + digest) throw new FleetProtocolError("plan-integrity-failed", "release plan id or digest does not match its canonical body");
}
function validateFleetReleaseApproval(plan, approval, now) {
	validateFleetReleasePlan(plan);
	assertExactKeys(approval, APPROVAL_KEYS$1, "release approval");
	if (approval.protocolVersion !== 2 || approval.kind !== "profile-release") throw new FleetProtocolError("invalid-protocol", "unsupported release approval protocol");
	for (const [field, value] of Object.entries({
		approvalId: approval.approvalId,
		principalId: approval.principalId,
		planId: approval.planId,
		deviceId: approval.deviceId,
		profile: approval.profile
	})) assertString(value, field);
	assertDigest(approval.planDigest, "planDigest");
	assertDigest(approval.fromManifestDigest, "fromManifestDigest");
	assertDigest(approval.toManifestDigest, "toManifestDigest");
	assertNullableDigest(approval.fromReleaseDigest, "fromReleaseDigest");
	assertDigest(approval.toReleaseDigest, "toReleaseDigest");
	if (approval.fromManifestDigest !== plan.fromManifestDigest || approval.toManifestDigest !== plan.toManifestDigest || approval.fromReleaseDigest !== plan.fromReleaseDigest || approval.toReleaseDigest !== plan.toReleaseDigest) throw new FleetProtocolError("approval-mismatch", "release approval transition digests do not match its plan");
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
function createFleetReleaseRollbackPlan(body) {
	validateRollbackPlanBody(body);
	const digest = sha256Canonical(body);
	return Object.freeze({
		...body,
		planId: "release-rollback-plan:" + digest,
		digest
	});
}
function validateFleetReleaseRollbackPlan(value) {
	assertExactKeys(value, ROLLBACK_PLAN_KEYS, "release rollback plan");
	const body = Object.fromEntries(ROLLBACK_PLAN_BODY_KEYS.map((key) => [key, value[key]]));
	validateRollbackPlanBody(body);
	assertDigest(value.digest, "digest");
	const digest = sha256Canonical(body);
	if (value.digest !== digest || value.planId !== "release-rollback-plan:" + digest) throw new FleetProtocolError("plan-integrity-failed", "release rollback plan id or digest does not match its canonical body");
}
function validateFleetReleaseRollbackApproval(plan, approval, now) {
	validateFleetReleaseRollbackPlan(plan);
	assertExactKeys(approval, ROLLBACK_APPROVAL_KEYS, "release rollback approval");
	if (approval.protocolVersion !== 2 || approval.kind !== "profile-release-rollback") throw new FleetProtocolError("invalid-protocol", "unsupported release rollback approval protocol");
	for (const [field, value] of Object.entries({
		approvalId: approval.approvalId,
		principalId: approval.principalId,
		planId: approval.planId,
		transitionPlanId: approval.transitionPlanId,
		deviceId: approval.deviceId,
		profile: approval.profile
	})) assertString(value, field);
	assertDigest(approval.planDigest, "planDigest");
	assertDigest(approval.fromManifestDigest, "fromManifestDigest");
	assertDigest(approval.toManifestDigest, "toManifestDigest");
	assertDigest(approval.fromReleaseDigest, "fromReleaseDigest");
	assertNullableDigest(approval.toReleaseDigest, "toReleaseDigest");
	const approvedAt = parseTime(approval.approvedAt, "approvedAt");
	const expiresAt = parseTime(approval.expiresAt, "approval.expiresAt");
	const nowAt = now instanceof Date ? now.getTime() : parseTime(now, "now");
	if (!Number.isFinite(nowAt)) throw new FleetProtocolError("invalid-time", "now is invalid");
	if (expiresAt <= approvedAt || approvedAt < Date.parse(plan.createdAt) || approvedAt >= Date.parse(plan.expiresAt)) throw new FleetProtocolError("approval-mismatch", "approval time is outside the release rollback plan validity window");
	if (nowAt >= Date.parse(plan.expiresAt)) throw new FleetProtocolError("plan-expired", "release rollback plan has expired");
	if (nowAt >= expiresAt) throw new FleetProtocolError("approval-expired", "release rollback approval has expired");
	if (approval.planId !== plan.planId || approval.planDigest !== plan.digest || approval.transitionPlanId !== plan.transitionPlanId || approval.deviceId !== plan.deviceId || approval.profile !== plan.profile || approval.fromManifestDigest !== plan.fromManifestDigest || approval.toManifestDigest !== plan.toManifestDigest || approval.fromReleaseDigest !== plan.fromReleaseDigest || approval.toReleaseDigest !== plan.toReleaseDigest) throw new FleetProtocolError("approval-mismatch", "release rollback approval does not match its plan");
	return { idempotencyKey: sha256Canonical({
		planDigest: plan.digest,
		approval: JSON.parse(canonicalJson(approval))
	}) };
}
function validateFleetAppliedRelease(value) {
	if (value.schemaVersion === 1) assertExactKeys(value, APPLIED_V1_KEYS, "applied release");
	else if (value.schemaVersion === 2) {
		assertExactKeys(value, APPLIED_V2_KEYS, "applied release");
		if (typeof value.transitionPlanId !== "string" || !/^release-plan:[0-9a-f]{64}$/.test(value.transitionPlanId)) throw new FleetProtocolError("invalid-payload", "applied release transitionPlanId is invalid");
		assertDigest(value.transitionPlanDigest, "transitionPlanDigest");
		if (value.transitionPlanId !== "release-plan:" + value.transitionPlanDigest) throw new FleetProtocolError("plan-integrity-failed", "applied release transition binding is invalid");
	} else throw new FleetProtocolError("invalid-protocol", "unsupported applied release schema");
	assertIdentifier(value.deviceId, "deviceId");
	assertIdentifier(value.profile, "profile");
	assertIdentifier(value.releaseId, "releaseId");
	assertString(value.releaseVersion, "releaseVersion");
	if ((0, import_semver.valid)(value.releaseVersion) !== value.releaseVersion) throw new FleetProtocolError("invalid-payload", "releaseVersion must be exact");
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
function digest$4(value) {
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
			fromSpecDigest: actualSpec === void 0 ? null : digest$4(actualSpec),
			exactToSpec: plugin.exactSpec,
			artifactDigest: plugin.artifactDigest
		});
	}
	for (const plugin of previous?.plugins ?? []) {
		if (finalIds.has(plugin.pluginId)) continue;
		const actualSpec = dependencies[plugin.pluginId];
		if (actualSpec === void 0) continue;
		if (!currentMatches(plugin, actualSpec, artifactDigests)) throw new FleetReleasePlannerError("release-ownership-conflict", "live binding for " + plugin.pluginId + " no longer matches the previously applied release marker");
		changes.push({
			pluginId: plugin.pluginId,
			visibility: plugin.visibility,
			sourceKind: plugin.sourceKind,
			action: "remove",
			fromSpecDigest: digest$4(actualSpec),
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
	if (!(0, import_semver.satisfies)(observedDshVersion, release.dshRange, { includePrerelease: true })) throw new FleetReleasePlannerError("release-incompatible", "assigned release does not support the observed DSH version");
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
	const toManifestDigest = trimmed(input.manifestDigest, "manifestDigest").toLowerCase();
	const fromManifestDigest = trimmed(input.liveManifestDigest ?? input.runtimeManifestDigest ?? input.manifestDigest, "liveManifestDigest").toLowerCase();
	try {
		return createFleetReleasePlan({
			protocolVersion: 2,
			kind: "profile-release",
			deviceId,
			profile,
			fromManifestDigest,
			toManifestDigest,
			fromReleaseDigest: input.appliedRelease?.releaseDigest ?? null,
			toReleaseDigest: releaseDigest,
			manifestDigest: toManifestDigest,
			profileHash: trimmed(input.profileHash, "profileHash").toLowerCase(),
			observedDshVersion,
			observedRuntimeDigest: trimmed(input.observedRuntimeDigest, "observedRuntimeDigest").toLowerCase(),
			observedServiceDefinitionDigest: input.observedServiceDefinitionDigest === null ? null : trimmed(input.observedServiceDefinitionDigest, "observedServiceDefinitionDigest").toLowerCase(),
			releaseId: release.id,
			releaseVersion: release.version,
			releaseDigest,
			plugins,
			changes,
			restartRequired: changes.length > 0 || fromManifestDigest !== toManifestDigest,
			createdAt,
			expiresAt: new Date(Date.parse(createdAt) + planTtlMs).toISOString()
		});
	} catch (error) {
		if (error instanceof FleetProtocolError) throw error;
		throw new FleetReleasePlannerError("invalid-input", error instanceof Error ? error.message : String(error));
	}
}
//#endregion
//#region src/worker/profile.ts
const EXECUTION_PROFILE_FILES = [
	"package.json",
	"package-lock.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"cordis.patch.yml",
	"cordis.yml",
	"fleet.lock.yaml"
];
const EXECUTION_PROFILE_FILE_NAMES = new Set(EXECUTION_PROFILE_FILES);
var ExecutionProfileHashError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "ExecutionProfileHashError";
		this.code = code;
	}
};
function profileDirectory(dshHome, profile) {
	if (!isAbsolute(dshHome) || normalize(dshHome) !== dshHome || dshHome === "/" || dshHome.includes("\0")) throw new ExecutionProfileHashError("execution-profile-invalid", "DSH home must be a normalized absolute non-root path");
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)) throw new ExecutionProfileHashError("execution-profile-invalid", "execution profile id is invalid");
	return join(dshHome, "profiles", profile);
}
async function readRegularOptional$1(path) {
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		if (!(await handle.stat()).isFile()) throw new ExecutionProfileHashError("execution-profile-invalid", "execution profile state accepts regular files only");
		return await handle.readFile("utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		if (error.code === "ELOOP") throw new ExecutionProfileHashError("execution-profile-invalid", "execution profile state must not contain symbolic links");
		throw error;
	} finally {
		await handle?.close();
	}
}
/**
* Hashes the complete reproducible DSH profile snapshot. node_modules is
* deliberately represented by package.json plus the npm/pnpm lockfiles and is
* rebuilt with scripts disabled; every other top-level entry is rejected.
*/
async function computeExecutionProfileHash(dshHome, profile) {
	const directory = profileDirectory(dshHome, profile);
	let directoryInfo;
	try {
		directoryInfo = await lstat(directory);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (directoryInfo === void 0 || directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw new ExecutionProfileHashError("execution-profile-invalid", "execution profile must be an existing real directory");
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.name === "node_modules") {
			const info = await lstat(path);
			if (info.isSymbolicLink() || !info.isDirectory()) throw new ExecutionProfileHashError("execution-profile-invalid", "execution profile node_modules must be a real directory");
			continue;
		}
		if (!EXECUTION_PROFILE_FILE_NAMES.has(entry.name)) throw new ExecutionProfileHashError("execution-profile-layout-unsupported", "execution profile contains unsupported top-level state");
		const info = await lstat(path);
		if (info.isSymbolicLink() || !info.isFile()) throw new ExecutionProfileHashError("execution-profile-invalid", "execution profile state accepts regular files only");
	}
	const files = Object.fromEntries(await Promise.all(EXECUTION_PROFILE_FILES.map(async (name) => [name, await readRegularOptional$1(join(directory, name))])));
	return createHash("sha256").update(JSON.stringify(files), "utf8").digest("hex");
}
async function assertExecutionProfileHash(dshHome, profile, expectedHash) {
	if (!/^[0-9a-f]{64}$/.test(expectedHash) || await computeExecutionProfileHash(dshHome, profile) !== expectedHash) throw new ExecutionProfileHashError("execution-profile-invalid", "execution profile no longer matches its signed task binding");
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
function identifier$2(value, label) {
	if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new FleetProtocolError("invalid-payload", label + " is invalid");
}
function digest$3(value, label) {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new FleetProtocolError("invalid-digest", label + " must be a lowercase SHA-256 digest");
}
function transitionId(value, label) {
	if (typeof value !== "string" || !/^release-plan:[0-9a-f]{64}$/.test(value)) throw new FleetProtocolError("invalid-payload", label + " is invalid");
}
function timestamp$1(value, label) {
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
	digest$3(body.descriptorDigest, `entries[${index}].descriptorDigest`);
	if (body.backupProfile === null) {
		if (body.backupManifestDigest !== null || body.backupProfileHash !== null) throw new FleetProtocolError("invalid-payload", "marker-only retention entries cannot bind a backup");
	} else {
		if (typeof body.backupProfile !== "string" || !/^fleet-backup-[0-9a-f]{24}$/.test(body.backupProfile)) throw new FleetProtocolError("invalid-payload", "retention backup profile is invalid");
		digest$3(body.backupManifestDigest, `entries[${index}].backupManifestDigest`);
		digest$3(body.backupProfileHash, `entries[${index}].backupProfileHash`);
	}
	if (body.reason !== "superseded") throw new FleetProtocolError("invalid-payload", "retention reason is invalid");
}
function validateBody(value) {
	exact(value, BODY_KEYS$1, "release retention plan body");
	if (value.protocolVersion !== 1 || value.kind !== "profile-release-retention") throw new FleetProtocolError("invalid-protocol", "unsupported release retention protocol");
	identifier$2(value.deviceId, "deviceId");
	identifier$2(value.profile, "profile");
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
	const createdAt = timestamp$1(value.createdAt, "createdAt");
	const expiresAt = timestamp$1(value.expiresAt, "expiresAt");
	if (expiresAt <= createdAt || expiresAt - createdAt > 36e5) throw new FleetProtocolError("invalid-time", "release retention plan lifetime is invalid");
}
function createFleetReleaseRetentionPlan(body) {
	validateBody(body);
	const digest = sha256Canonical(body);
	return Object.freeze({
		...body,
		planId: "release-retention-plan:" + digest,
		digest
	});
}
function validateFleetReleaseRetentionPlan(value) {
	exact(value, PLAN_KEYS, "release retention plan");
	const body = Object.fromEntries(BODY_KEYS$1.map((key) => [key, value[key]]));
	validateBody(body);
	digest$3(value.digest, "digest");
	if (value.planId !== "release-retention-plan:" + value.digest || sha256Canonical(body) !== value.digest) throw new FleetProtocolError("plan-integrity-failed", "release retention plan identity is invalid");
}
function validateFleetReleaseRetentionApproval(plan, approval, now) {
	validateFleetReleaseRetentionPlan(plan);
	const body = exact(approval, APPROVAL_KEYS, "release retention approval");
	if (body.protocolVersion !== 1 || body.kind !== "profile-release-retention") throw new FleetProtocolError("invalid-protocol", "unsupported release retention approval protocol");
	for (const field of ["approvalId", "principalId"]) identifier$2(body[field], field);
	if (body.planId !== plan.planId || body.deviceId !== plan.deviceId || body.profile !== plan.profile) throw new FleetProtocolError("approval-mismatch", "release retention approval does not match its plan");
	digest$3(body.planDigest, "planDigest");
	if (body.planDigest !== plan.digest) throw new FleetProtocolError("approval-mismatch", "release retention digest does not match its plan");
	const approvedAt = timestamp$1(body.approvedAt, "approvedAt");
	const expiresAt = timestamp$1(body.expiresAt, "approval.expiresAt");
	const nowAt = now instanceof Date ? now.getTime() : timestamp$1(now, "now");
	if (expiresAt <= approvedAt || approvedAt < Date.parse(plan.createdAt) || approvedAt >= Date.parse(plan.expiresAt)) throw new FleetProtocolError("approval-mismatch", "release retention approval is outside its plan window");
	if (expiresAt > Date.parse(plan.expiresAt)) throw new FleetProtocolError("approval-mismatch", "release retention approval cannot outlive its plan");
	if (nowAt >= Date.parse(plan.expiresAt)) throw new FleetProtocolError("plan-expired", "release retention plan has expired");
	if (nowAt >= expiresAt) throw new FleetProtocolError("approval-expired", "release retention approval has expired");
	return { idempotencyKey: sha256Canonical({
		planDigest: plan.digest,
		approval: JSON.parse(canonicalJson(approval))
	}) };
}
//#endregion
//#region src/agent/service-definition.ts
function sha256$1(value) {
	return createHash("sha256").update(value, "utf8").digest("hex");
}
function block(lines, name) {
	const start = lines.findIndex((line) => line.trim() === name + " = {");
	if (start < 0) throw new TypeError("launchd service is missing the " + name + " block");
	const values = [];
	for (let index = start + 1; index < lines.length; index += 1) {
		const value = lines[index].trim();
		if (value === "}") return values;
		if (value.length > 0) values.push(value);
	}
	throw new TypeError("launchd service has an unterminated " + name + " block");
}
function singleValue(lines, name) {
	const prefix = name + " = ";
	const values = lines.map((line) => line.trim()).filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));
	if (values.length !== 1 || values[0].length === 0) throw new TypeError("launchd service has an invalid " + name);
	return values[0];
}
function environmentValue(lines, name) {
	const prefix = name + " => ";
	const values = block(lines, "environment").filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));
	if (values.length !== 1 || values[0].length === 0) throw new TypeError("launchd service environment is missing " + name);
	return values[0];
}
function matches(actual, expected) {
	return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
/**
* launchd argv is part of the approved runtime identity, so accept only the two
* DSH service forms that Fleet has shipped with. In particular, `--no-open`
* belongs exactly between `web` and `--host`; this is not a general flag parser.
*/
function inspectDshWebArguments(programArguments, host, port) {
	if (programArguments.some((argument) => /[\r\n\0]/.test(argument))) throw new TypeError("launchd service must have one exact DSH web argument vector");
	const tail = programArguments.slice(2);
	if (matches(tail, [
		"web",
		"--host",
		host,
		"--port",
		String(port)
	])) return "legacy-rc7";
	if (matches(tail, [
		"web",
		"--no-open",
		"--host",
		host,
		"--port",
		String(port)
	])) return "rc8-no-open";
	throw new TypeError("launchd service DSH web arguments do not match the Agent configuration");
}
async function inspectLaunchdServiceDefinition(input) {
	const lines = input.source.split(/\r?\n/);
	if (lines[0]?.trim() !== input.serviceTarget + " = {") throw new TypeError("launchd service target does not match the configured target");
	const programArguments = block(lines, "arguments");
	const argumentContract = inspectDshWebArguments(programArguments, input.host, input.port);
	if (singleValue(lines, "program") !== programArguments[0]) throw new TypeError("launchd service program does not match argv[0]");
	const dshHome = environmentValue(lines, "DSH_HOME");
	if (dshHome !== input.dshHome) throw new TypeError("launchd service DSH_HOME does not match the Agent configuration");
	const nodePath = programArguments[0];
	const entrypointPath = programArguments[1];
	const runtimeIdentity = await inspectCurrentRuntimeIdentity({
		execPath: nodePath,
		entrypointPath
	});
	if (runtimeIdentity.dshVersion === "0.1.0-rc.7" && argumentContract !== "legacy-rc7") throw new TypeError("launchd service DSH 0.1.0-rc.7 requires the legacy web argument vector");
	if (runtimeIdentity.dshVersion === "0.1.0-rc.8" && argumentContract !== "rc8-no-open") throw new TypeError("launchd service DSH 0.1.0-rc.8 requires --no-open in the fixed web argument position");
	const definition = {
		serviceTarget: input.serviceTarget,
		programArguments,
		dshHome,
		runtimeDigest: runtimeIdentity.runtimeDigest
	};
	const rawPid = singleValue(lines, "pid");
	const pid = Number(rawPid);
	if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError("launchd service pid is invalid");
	return {
		serviceTarget: input.serviceTarget,
		programArguments,
		dshHome,
		runtimeIdentity,
		serviceDefinitionDigest: sha256$1(JSON.stringify(definition)),
		pid
	};
}
//#endregion
//#region src/agent/runtime.ts
const RUNTIME_MANIFEST_FILENAME = "fleet.lock.yaml";
const SNAPSHOT_FILES = [
	"package.json",
	"package-lock.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"cordis.patch.yml",
	"cordis.yml",
	RUNTIME_MANIFEST_FILENAME
];
const REBUILT_PROFILE_DIRECTORY = "node_modules";
const PROFILE_FILE_NAMES = new Set(SNAPSHOT_FILES);
const MAX_OUTPUT_BYTES = 1048576;
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
function runtimeManifestPath(config) {
	return join(profileDir(config), RUNTIME_MANIFEST_FILENAME);
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
		GIT_TERMINAL_PROMPT: "0",
		npm_config_ignore_scripts: "true",
		PNPM_CONFIG_IGNORE_SCRIPTS: "true"
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
			if (stdoutBytes < MAX_OUTPUT_BYTES) stdout += Buffer.from(chunk).subarray(0, Math.max(0, MAX_OUTPUT_BYTES - stdoutBytes)).toString("utf8");
			stdoutBytes += bytes;
			if (stdoutBytes > MAX_OUTPUT_BYTES) terminate(new AgentRuntimeError("command-output-limit", "controlled command exceeded its output limit"));
		});
		child.stderr?.on("data", (chunk) => {
			const bytes = Buffer.byteLength(chunk);
			if (stderrBytes < MAX_OUTPUT_BYTES) stderr += Buffer.from(chunk).subarray(0, Math.max(0, MAX_OUTPUT_BYTES - stderrBytes)).toString("utf8");
			stderrBytes += bytes;
			if (stderrBytes > MAX_OUTPUT_BYTES) terminate(new AgentRuntimeError("command-output-limit", "controlled command exceeded its output limit"));
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
			if (options.allowDescendants !== true && grouped && child.pid !== void 0 && processGroupIsAlive(child.pid)) {
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
async function validateProfileLayout(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.name === REBUILT_PROFILE_DIRECTORY) {
			const info = await lstat(path);
			if (info.isSymbolicLink() || !info.isDirectory()) throw new AgentRuntimeError("unsafe-profile-directory", "profile node_modules must be a regular directory");
			continue;
		}
		if (!PROFILE_FILE_NAMES.has(entry.name)) throw new AgentRuntimeError("profile-layout-unsupported", "profile contains unsupported top-level state");
		const info = await lstat(path);
		if (info.isSymbolicLink() || !info.isFile()) throw new AgentRuntimeError("unsafe-profile-file", "profile state accepts regular files only");
	}
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
	if (directoryPresent) await validateProfileLayout(dir);
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
async function loadDesiredManifest(config) {
	const source = await readFile(config.desiredManifestPath, "utf8");
	return {
		manifest: parseFleetManifest(source),
		manifestDigest: sha256(source),
		source
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
	const deadline = Date.now() + 1e4;
	while (Date.now() < deadline) {
		throwIfAborted(signal);
		const active = (await Promise.all(ports.map((port) => listenerPids(config, port, signal)))).flat();
		const launchdPid = config.restart.kind === "launchd" ? await currentLaunchdPid(config, signal) : null;
		if (active.length === 0 && (config.restart.kind === "screen" || launchdPid === null)) return;
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
async function currentLaunchdPid(config, signal) {
	if (config.restart.kind !== "launchd") return null;
	const result = await runFile(config.restart.launchctlBinary, ["print", config.restart.serviceTarget], {
		env: controlledEnv(config),
		timeoutMs: 1e4,
		allowFailure: true,
		signal
	});
	if (result.code !== 0) return null;
	const matches = [...result.stdout.matchAll(/^\s*pid = ([0-9]+)\s*$/gm)];
	if (matches.length === 0) return null;
	if (matches.length !== 1) throw new AgentRuntimeError("restart-cleanup-failed", "launchd reported an ambiguous DSH process owner");
	const pid = Number(matches[0][1]);
	if (!Number.isSafeInteger(pid) || pid <= 0) throw new AgentRuntimeError("restart-cleanup-failed", "launchd reported an invalid DSH process owner");
	return pid;
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
			allowDescendants: true,
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
async function verifyHealth(config, plan, signal, expectedPluginIds = [], expectedManifestPath) {
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
	let manifestPathMismatch = false;
	let runtimeIdentityInvalid = false;
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
				manifestPathMismatch = expectedManifestPath !== void 0 && body.result?.value?.manifest?.path !== expectedManifestPath;
				const fleetHealthy = body.rpcId === rpcId && body.result?.ok === true && body.result.value?.summary?.failed === 0 && runtimeHealthy && !manifestPathMismatch;
				const plugins = body.result?.value?.plugins ?? [];
				targetPending = targetIds.some((id) => plugins.find((item) => item.id === id)?.state !== "aligned");
				let runtimeIdentity = null;
				if (body.result?.value?.runtimeIdentity !== void 0) try {
					validateRuntimeIdentity(body.result.value.runtimeIdentity);
					runtimeIdentity = body.result.value.runtimeIdentity;
				} catch {
					runtimeIdentityInvalid = true;
				}
				if (fleetHealthy && !targetPending && !runtimeIdentityInvalid) return runtimeIdentity;
			}
		} catch {
			throwIfAborted(signal);
		}
		await new Promise((resolve) => setTimeout(resolve, 350));
	}
	if (runtimeFailed) throw new AgentRuntimeError("runtime-modules-failed", "DSH Loader reports failed runtime modules");
	if (manifestPathMismatch) throw new AgentRuntimeError("fleet-runtime-manifest-path-mismatch", "Fleet runtime is not bound to the profile-local manifest");
	if (runtimeIdentityInvalid) throw new AgentRuntimeError("runtime-identity-invalid", "Fleet RPC returned an invalid runtime identity");
	if (targetPending) throw new AgentRuntimeError("plugin-not-active", "approved plugin did not become active");
	throw new AgentRuntimeError("fleet-rpc-unhealthy", "Fleet RPC reported an unhealthy runtime");
}
async function inspectManagedReleaseRuntime(config, signal, options = {}) {
	const [rpcRuntimeIdentity, configuredDshVersion] = await Promise.all([verifyHealth(config, void 0, signal, options.expectedPluginIds ?? [], runtimeManifestPath(config)), readDshVersion(config, signal)]);
	if (config.restart.kind === "screen") {
		if (rpcRuntimeIdentity === null) throw new AgentRuntimeError("runtime-identity-unavailable", "screen-managed releases require Fleet RPC runtime identity");
		if (rpcRuntimeIdentity.dshVersion !== configuredDshVersion) throw new AgentRuntimeError("runtime-identity-mismatch", "configured DSH and running DSH versions do not match");
		return {
			runtimeIdentity: rpcRuntimeIdentity,
			observedRuntimeDigest: rpcRuntimeIdentity.runtimeDigest,
			observedServiceDefinitionDigest: null
		};
	}
	const printed = await runFile(config.restart.launchctlBinary, ["print", config.restart.serviceTarget], {
		env: controlledEnv(config),
		timeoutMs: 1e4,
		signal
	});
	let service;
	try {
		service = await inspectLaunchdServiceDefinition({
			source: printed.stdout,
			serviceTarget: config.restart.serviceTarget,
			dshHome: config.dshHome,
			host: config.restart.host,
			port: config.restart.port
		});
	} catch (error) {
		throw new AgentRuntimeError("service-definition-invalid", error instanceof Error ? error.message : "launchd service definition is invalid");
	}
	const listenerPid = (await listenerPids(config, config.restart.port, signal))[0];
	if (listenerPid === void 0 || service.pid !== listenerPid) throw new AgentRuntimeError("restart-owner-mismatch", "launchd service PID does not own the configured DSH port");
	await verifyListenerOwner(config, listenerPid, config.restart.port, signal);
	if (service.runtimeIdentity.dshVersion !== configuredDshVersion) throw new AgentRuntimeError("runtime-identity-mismatch", "configured DSH and launchd DSH versions do not match");
	if (rpcRuntimeIdentity === null) {
		if (options.allowLegacyLaunchdIdentity !== true) throw new AgentRuntimeError("runtime-identity-unavailable", "Fleet RPC did not report the running DSH identity");
	} else if (rpcRuntimeIdentity.runtimeDigest !== service.runtimeIdentity.runtimeDigest) throw new AgentRuntimeError("runtime-identity-mismatch", "Fleet RPC and launchd report different DSH runtimes");
	return {
		runtimeIdentity: service.runtimeIdentity,
		observedRuntimeDigest: service.runtimeIdentity.runtimeDigest,
		observedServiceDefinitionDigest: service.serviceDefinitionDigest
	};
}
function assertObservedReleaseRuntime(observation, expected) {
	if (observation.runtimeIdentity.dshVersion !== expected.observedDshVersion || observation.observedRuntimeDigest !== expected.observedRuntimeDigest || observation.observedServiceDefinitionDigest !== expected.observedServiceDefinitionDigest) throw new FleetProtocolError("approval-mismatch", "running DSH or its service definition changed after the plan was created");
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
async function readOrRecoverAction(config, planId) {
	return withProfileLock(config, async () => {
		const record = await readAction(config, planId);
		if (record === null || record.state === "succeeded" || record.state === "rolled-back" || record.state === "manual-intervention") return record;
		assertMutationReadyConfig(config);
		const plan = await readJson(planPath(config, planId));
		if (plan === null) throw new AgentRuntimeError("plan-not-found", "approved plan was not found");
		validateFleetPlan(plan);
		return recoverInterrupted(config, plan, record);
	});
}
function releasePlanPath(config, planId) {
	if (!/^release-plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError("invalid-plan-id", "release plan id is invalid");
	return join(config.stateDir, "release-plans", planId.slice(13) + ".json");
}
function releaseActionPath(config, planId) {
	if (!/^release-plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError("invalid-plan-id", "release plan id is invalid");
	return join(config.stateDir, "release-actions", planId.slice(13) + ".json");
}
function releaseRollbackDescriptorPath(config, transitionPlanId) {
	if (!/^release-plan:[0-9a-f]{64}$/.test(transitionPlanId)) throw new AgentRuntimeError("invalid-plan-id", "release transition plan id is invalid");
	return join(config.stateDir, "release-rollbacks", transitionPlanId.slice(13) + ".json");
}
function releaseRollbackPlanPath(config, planId) {
	if (!/^release-rollback-plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError("invalid-plan-id", "release rollback plan id is invalid");
	return join(config.stateDir, "release-rollback-plans", planId.slice(22) + ".json");
}
function releaseRollbackActionPath(config, planId) {
	if (!/^release-rollback-plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError("invalid-plan-id", "release rollback plan id is invalid");
	return join(config.stateDir, "release-rollback-actions", planId.slice(22) + ".json");
}
function releaseRetentionPlanPath(config, planId) {
	if (!/^release-retention-plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError("invalid-plan-id", "release retention plan id is invalid");
	return join(config.stateDir, "release-retention-plans", planId.slice(23) + ".json");
}
function releaseRetentionActionPath(config, planId) {
	if (!/^release-retention-plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError("invalid-plan-id", "release retention plan id is invalid");
	return join(config.stateDir, "release-retention-actions", planId.slice(23) + ".json");
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
const RELEASE_ROLLBACK_DESCRIPTOR_KEYS = [
	"schemaVersion",
	"transitionPlanId",
	"transitionPlanDigest",
	"deviceId",
	"profile",
	"fromManifestDigest",
	"toManifestDigest",
	"fromReleaseDigest",
	"toReleaseDigest",
	"fromProfileHash",
	"backupProfile",
	"previousAppliedRelease",
	"createdAt"
];
function validateReleaseRollbackDescriptor(value) {
	const body = objectValue(value);
	if (body === null || Object.keys(body).sort().join(",") !== [...RELEASE_ROLLBACK_DESCRIPTOR_KEYS].sort().join(",")) throw new AgentRuntimeError("rollback-descriptor-invalid", "release rollback descriptor has unsupported or missing fields");
	const createdAt = typeof body.createdAt === "string" ? Date.parse(body.createdAt) : NaN;
	if (body.schemaVersion !== 1 || typeof body.transitionPlanId !== "string" || !/^release-plan:[0-9a-f]{64}$/.test(body.transitionPlanId) || typeof body.transitionPlanDigest !== "string" || !/^[0-9a-f]{64}$/.test(body.transitionPlanDigest) || typeof body.deviceId !== "string" || typeof body.profile !== "string" || typeof body.fromManifestDigest !== "string" || !/^[0-9a-f]{64}$/.test(body.fromManifestDigest) || typeof body.toManifestDigest !== "string" || !/^[0-9a-f]{64}$/.test(body.toManifestDigest) || body.fromReleaseDigest !== null && (typeof body.fromReleaseDigest !== "string" || !/^[0-9a-f]{64}$/.test(body.fromReleaseDigest)) || typeof body.toReleaseDigest !== "string" || !/^[0-9a-f]{64}$/.test(body.toReleaseDigest) || typeof body.fromProfileHash !== "string" || !/^[0-9a-f]{64}$/.test(body.fromProfileHash) || body.backupProfile !== null && (typeof body.backupProfile !== "string" || !/^fleet-backup-[0-9a-f]{24}$/.test(body.backupProfile)) || !Number.isFinite(createdAt) || new Date(createdAt).toISOString() !== body.createdAt || body.previousAppliedRelease !== null && typeof body.previousAppliedRelease !== "object") throw new AgentRuntimeError("rollback-descriptor-invalid", "release rollback descriptor is invalid");
	if (body.transitionPlanId !== "release-plan:" + body.transitionPlanDigest) throw new AgentRuntimeError("rollback-descriptor-invalid", "release rollback descriptor transition digest is invalid");
	if (body.previousAppliedRelease !== null) validateFleetAppliedRelease(body.previousAppliedRelease);
}
async function readReleaseRollbackDescriptor(config, transitionPlanId) {
	const value = await readJson(releaseRollbackDescriptorPath(config, transitionPlanId));
	if (value === null) return null;
	validateReleaseRollbackDescriptor(value);
	if (value.deviceId !== config.deviceId || value.profile !== config.profile || value.transitionPlanId !== transitionPlanId) throw new AgentRuntimeError("rollback-descriptor-invalid", "release rollback descriptor identity does not match this Agent");
	return value;
}
async function persistReleaseRollbackDescriptor(config, plan, previousAppliedRelease) {
	const descriptor = {
		schemaVersion: 1,
		transitionPlanId: plan.planId,
		transitionPlanDigest: plan.digest,
		deviceId: plan.deviceId,
		profile: plan.profile,
		fromManifestDigest: plan.fromManifestDigest,
		toManifestDigest: plan.toManifestDigest,
		fromReleaseDigest: plan.fromReleaseDigest,
		toReleaseDigest: plan.toReleaseDigest,
		fromProfileHash: plan.profileHash,
		backupProfile: plan.restartRequired ? releaseProfileNames(plan).backupProfile : null,
		previousAppliedRelease,
		createdAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	validateReleaseRollbackDescriptor(descriptor);
	const existing = await readReleaseRollbackDescriptor(config, plan.planId);
	if (existing !== null) {
		const comparable = {
			...descriptor,
			createdAt: existing.createdAt
		};
		if (sha256Canonical(existing) !== sha256Canonical(comparable)) throw new AgentRuntimeError("rollback-descriptor-conflict", "release rollback descriptor does not match the approved transition");
		return {
			descriptor: existing,
			digest: sha256Canonical(existing)
		};
	}
	await atomicJson$1(releaseRollbackDescriptorPath(config, plan.planId), descriptor);
	return {
		descriptor,
		digest: sha256Canonical(descriptor)
	};
}
async function restoreAppliedReleaseMarker(config, previous) {
	if (previous === null) {
		await ensureDurableDirectory(dirname(appliedReleasePath(config)));
		await rm(appliedReleasePath(config), { force: true });
		await syncDirectory(dirname(appliedReleasePath(config)));
		return;
	}
	validateFleetAppliedRelease(previous);
	await atomicJson$1(appliedReleasePath(config), previous);
}
async function currentArtifactDigests(config, state) {
	const entries = await Promise.all(Object.entries(state.dependencies).map(async ([pluginId, actualSpec]) => {
		const digest = await digestInstalledArtifact(profileDir(config), config.artifactStore, actualSpec);
		return digest === void 0 ? null : [pluginId, digest];
	}));
	return Object.fromEntries(entries.filter((entry) => entry !== null));
}
async function assertReleaseRemovalOwnership(config, state, plan, appliedRelease) {
	for (const change of plan.changes.filter((candidate) => candidate.action === "remove")) {
		const previous = appliedRelease?.plugins.find((plugin) => plugin.pluginId === change.pluginId);
		const liveSpec = state.dependencies[change.pluginId];
		if (previous === void 0 || liveSpec === void 0) throw new AgentRuntimeError("release-ownership-conflict", "retired plugin is no longer owned by the applied release marker");
		if (!(previous.sourceKind === "artifact" ? await digestInstalledArtifact(profileDir(config), config.artifactStore, liveSpec) === previous.artifactDigest : liveSpec === previous.exactSpec)) throw new AgentRuntimeError("release-ownership-conflict", "retired plugin binding no longer matches the applied release marker");
	}
}
async function buildReleasePlan(config, now, signal) {
	const state = await loadState(config, signal);
	const desired = await loadDesiredManifest(config);
	const appliedRelease = await readAppliedRelease(config);
	const runtime = await inspectManagedReleaseRuntime(config, signal, { allowLegacyLaunchdIdentity: true });
	return {
		plan: createReleasePlan({
			manifest: desired.manifest,
			manifestDigest: desired.manifestDigest,
			liveManifestDigest: state.manifestDigest,
			runtimeManifestDigest: state.manifestDigest,
			dependencies: state.dependencies,
			artifactDigests: await currentArtifactDigests(config, state),
			appliedRelease,
			profileHash: state.profileHash,
			observedDshVersion: runtime.runtimeIdentity.dshVersion,
			observedRuntimeDigest: runtime.observedRuntimeDigest,
			observedServiceDefinitionDigest: runtime.observedServiceDefinitionDigest,
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
	const executionProfiles = await Promise.all([...config.tasks?.profiles ?? []].sort().map(async (profile) => ({
		profile,
		profileHash: await computeExecutionProfileHash(config.dshHome, profile)
	})));
	const retention = await releaseRetentionInspection(config);
	return {
		protocolVersion: 1,
		kind: "profile-release",
		deviceId: plan.deviceId,
		profile: plan.profile,
		dshVersion: plan.observedDshVersion,
		manifestDigest: plan.manifestDigest,
		liveManifestDigest: plan.fromManifestDigest,
		desiredManifestDigest: plan.toManifestDigest,
		observedRuntimeDigest: plan.observedRuntimeDigest,
		observedServiceDefinitionDigest: plan.observedServiceDefinitionDigest,
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
			timeoutMs: config.tasks?.timeoutMs ?? null,
			workspaceIds: Object.keys(config.tasks?.workspaces ?? {}).sort(),
			profiles: [...config.tasks?.profiles ?? []].sort(),
			executionProfiles,
			policies: (config.tasks?.policyIds ?? []).flatMap((policyId) => {
				const policy = config.tasks?.policies?.[policyId];
				return policy === void 0 ? [] : [{
					policyId: policy.policyId,
					policyDigest: policy.policyDigest,
					permissionMode: policy.permissionMode
				}];
			}).sort((left, right) => left.policyId.localeCompare(right.policyId))
		},
		retention
	};
}
async function verifyReleaseAgentHealth(config, signal) {
	assertReleaseReadyConfig(config);
	await inspectManagedReleaseRuntime(config, signal, { allowLegacyLaunchdIdentity: true });
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
function assertReleaseActionPlan(record, plan) {
	const names = releaseProfileNames(plan);
	if (record.planId !== plan.planId || record.planDigest !== plan.digest || record.deviceId !== plan.deviceId || record.profile !== plan.profile || record.releaseId !== plan.releaseId || record.releaseVersion !== plan.releaseVersion || record.releaseDigest !== plan.toReleaseDigest || record.fromManifestDigest !== plan.fromManifestDigest || record.toManifestDigest !== plan.toManifestDigest || record.fromReleaseDigest !== plan.fromReleaseDigest || record.toReleaseDigest !== plan.toReleaseDigest || record.stageProfile !== names.stageProfile || record.backupProfile !== names.backupProfile || !/^[0-9a-f]{64}$/.test(record.rollbackDescriptorDigest)) throw new AgentRuntimeError("action-state-invalid", "release action record does not match its transition plan");
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
		lock = objectValue((0, import_dist.parse)(lockSource));
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
	const runtimeManifestSource = await readRegularOptional(runtimeManifestPath(targetConfig));
	if (runtimeManifestSource === null || sha256(runtimeManifestSource) !== plan.manifestDigest) throw new AgentRuntimeError("release-runtime-manifest-mismatch", "release profile does not contain the approved Fleet runtime manifest");
	parseFleetManifest(runtimeManifestSource);
	const source = await readRegularOptional(join(profileDir(targetConfig), "package.json"));
	if (source === null) throw new AgentRuntimeError("profile-missing", "staged release profile is missing");
	const parsed = JSON.parse(source);
	const dependencies = parsed.dependencies ?? {};
	const bundles = parsed.dsh?.profile?.bundles ?? [];
	const lockSource = await readRegularOptional(join(profileDir(targetConfig), "pnpm-lock.yaml"));
	if (lockSource === null) throw new AgentRuntimeError("profile-lock-missing", "release profile lockfile is missing");
	const materializedProfileRoot = await realpath(profileDir(targetConfig));
	for (const plugin of plan.plugins) {
		const actualSpec = dependencies[plugin.pluginId];
		if (actualSpec === void 0 || !bundles.includes(plugin.pluginId)) throw new AgentRuntimeError("release-profile-mismatch", "release plugin is missing from dependencies or DSH bundles");
		if (plugin.sourceKind === "artifact") {
			if (await digestInstalledArtifact(profileDir(targetConfig), config.artifactStore, actualSpec) !== plugin.artifactDigest) throw new AgentRuntimeError("artifact-digest-mismatch", "materialized private artifact digest does not match the release");
		} else if (actualSpec !== plugin.exactSpec) throw new AgentRuntimeError("release-profile-mismatch", "materialized public plugin spec does not match the release");
		if (plugin.sourceKind === "npm" && !npmLockBindsIntegrity(lockSource, plugin)) throw new AgentRuntimeError("npm-integrity-mismatch", "pnpm lockfile does not contain the approved npm integrity");
		let materializedPath;
		try {
			materializedPath = await realpath(join(materializedProfileRoot, "node_modules", plugin.pluginId));
		} catch {
			throw new AgentRuntimeError("release-profile-materialization-missing", "release plugin is missing from the materialized dependency tree");
		}
		const materializedRelative = relative(materializedProfileRoot, materializedPath);
		if (materializedRelative === "" || materializedRelative === ".." || materializedRelative.startsWith(".." + sep) || isAbsolute(materializedRelative)) throw new AgentRuntimeError("release-profile-external-link", "release plugin resolves outside the staged profile");
		const materializedManifest = await readRegularOptional(join(materializedPath, "package.json"));
		if (materializedManifest === null) throw new AgentRuntimeError("release-profile-materialization-missing", "release plugin package metadata is missing");
		const materialized = JSON.parse(materializedManifest);
		if (materialized.name !== plugin.pluginId || plugin.packageVersion !== null && materialized.version !== plugin.packageVersion) throw new AgentRuntimeError("release-profile-materialization-mismatch", "materialized release plugin identity does not match the approved release");
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
async function removeChangedReleaseBindings(config, plan) {
	const removedIds = new Set(plan.changes.filter((change) => change.action === "remove" || change.action === "update").map((change) => change.pluginId));
	if (removedIds.size === 0) return;
	const packagePath = join(profileDir(config), "package.json");
	const source = await readRegularOptional(packagePath);
	if (source === null) throw new AgentRuntimeError("profile-missing", "staged release profile is missing");
	const parsed = JSON.parse(source);
	const dependencies = parsed.dependencies ?? {};
	for (const id of removedIds) {
		const change = plan.changes.find((candidate) => candidate.pluginId === id);
		const liveBinding = dependencies[id];
		if (change === void 0 || change.fromSpecDigest === null || liveBinding === void 0 || sha256(liveBinding) !== change.fromSpecDigest) throw new AgentRuntimeError("release-ownership-conflict", "live release binding no longer matches the approved previous binding");
		delete dependencies[id];
	}
	parsed.dependencies = dependencies;
	const profile = parsed.dsh?.profile;
	if (profile !== void 0) profile.bundles = (profile.bundles ?? []).filter((id) => !removedIds.has(id));
	await rm(packagePath, { force: true });
	await durableWriteFile(packagePath, JSON.stringify(parsed, null, 2) + "\n");
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
	const runtimeManifestSource = await readRegularOptional(config.desiredManifestPath);
	if (runtimeManifestSource === null || sha256(runtimeManifestSource) !== plan.toManifestDigest) throw new AgentRuntimeError("release-runtime-manifest-mismatch", "approved Fleet runtime manifest is missing or changed");
	await rm(runtimeManifestPath(stageConfig), { force: true });
	await durableWriteFile(runtimeManifestPath(stageConfig), runtimeManifestSource);
	await runFile(config.pnpmBinary, ["--version"], {
		env: controlledEnv(config),
		timeoutMs: 1e4,
		signal
	});
	await removeChangedReleaseBindings(stageConfig, plan);
	if (plan.changes.some((change) => change.action === "remove" || change.action === "update")) await runFile(config.pnpmBinary, [
		"install",
		"--lockfile-only",
		"--ignore-scripts"
	], {
		cwd: stageDir,
		env: controlledEnv(config),
		timeoutMs: 12e4,
		signal
	});
	const bindings = new Map(plan.plugins.map((plugin) => [plugin.pluginId, plugin]));
	for (const change of plan.changes) {
		throwIfAborted(signal);
		if (change.action === "remove") continue;
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
	await runFile(config.pnpmBinary, [
		"install",
		"--frozen-lockfile",
		"--ignore-scripts"
	], {
		cwd: stageDir,
		env: controlledEnv(config),
		timeoutMs: 12e4,
		signal
	});
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
		schemaVersion: 2,
		deviceId: plan.deviceId,
		profile: plan.profile,
		releaseId: plan.releaseId,
		releaseVersion: plan.releaseVersion,
		releaseDigest: plan.releaseDigest,
		plugins: plan.plugins,
		appliedAt: (/* @__PURE__ */ new Date()).toISOString(),
		transitionPlanId: plan.planId,
		transitionPlanDigest: plan.digest
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
		const descriptor = await readReleaseRollbackDescriptor(config, plan.planId);
		if (descriptor === null || descriptor.transitionPlanDigest !== plan.digest || sha256Canonical(descriptor) !== record.rollbackDescriptorDigest) throw new AgentRuntimeError("rollback-descriptor-invalid", "release rollback descriptor is missing or does not match the transition");
		const backupExists = await regularDirectoryExists(backupDir);
		if (!backupExists && plan.restartRequired) {
			const liveManifest = await readRegularOptional(runtimeManifestPath(config));
			if (liveManifest === null || sha256(liveManifest) !== plan.fromManifestDigest || await computeProfileHash(config) !== plan.profileHash) throw new AgentRuntimeError("rollback-backup-missing", "release backup is missing after the live profile changed");
		}
		if (backupExists) {
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
		await restoreAppliedReleaseMarker(config, descriptor.previousAppliedRelease);
		current = await saveReleaseAction(config, current, "rollback-restarting");
		await ensureServiceStarted(config);
		current = await saveReleaseAction(config, current, "rollback-verifying");
		assertObservedReleaseRuntime(await inspectManagedReleaseRuntime(config, void 0, {
			allowLegacyLaunchdIdentity: true,
			expectedPluginIds: descriptor.previousAppliedRelease?.plugins.map((plugin) => plugin.pluginId) ?? []
		}), plan);
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
	} catch (rollbackError) {
		const rollbackErrorCode = typeof rollbackError.code === "string" ? rollbackError.code : "rollback-failed";
		await auditBestEffort(config, {
			type: "profile-release/manual-intervention",
			planId: plan.planId,
			releaseId: plan.releaseId,
			result: errorCode
		});
		return (await saveReleaseActionBestEffort(config, current, "manual-intervention", {
			result: "manual-intervention",
			errorCode: rollbackErrorCode
		})).record;
	}
}
async function recoverReleaseInterrupted(config, plan, record) {
	const descriptor = await readReleaseRollbackDescriptor(config, plan.planId);
	if (descriptor === null || descriptor.transitionPlanDigest !== plan.digest || sha256Canonical(descriptor) !== record.rollbackDescriptorDigest) return (await saveReleaseActionBestEffort(config, record, "manual-intervention", {
		result: "manual-intervention",
		errorCode: "rollback-descriptor-invalid"
	})).record;
	if ((await readAppliedRelease(config))?.releaseDigest === plan.releaseDigest) {
		if (descriptor.backupProfile !== null && !await regularDirectoryExists(join(dirname(profileDir(config)), descriptor.backupProfile))) return (await saveReleaseActionBestEffort(config, record, "manual-intervention", {
			result: "manual-intervention",
			errorCode: "rollback-backup-missing"
		})).record;
		try {
			await verifyReleaseProfileFiles(config, plan, config.profile);
			await ensureServiceStarted(config);
			assertObservedReleaseRuntime(await inspectManagedReleaseRuntime(config, void 0, { expectedPluginIds: plan.plugins.map((plugin) => plugin.pluginId) }), plan);
			const names = releaseProfileNames(plan);
			const profilesRoot = dirname(profileDir(config));
			await Promise.all([rm(join(profilesRoot, names.stageProfile), {
				recursive: true,
				force: true
			}), rm(join(profilesRoot, names.failedProfile), {
				recursive: true,
				force: true
			})]);
			return saveReleaseAction(config, record, "succeeded", { result: "success" });
		} catch {}
	}
	return rollbackRelease(config, plan, record, "interrupted-action");
}
async function applyStoredReleasePlanLocked(config, approval, now, signal) {
	const plan = await readJson(releasePlanPath(config, approval.planId));
	if (plan === null) throw new AgentRuntimeError("plan-not-found", "approved release plan was not found");
	validateFleetReleasePlan(plan);
	const existing = await readReleaseAction(config, plan.planId);
	if (existing !== null) assertReleaseActionPlan(existing, plan);
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
	const desired = await loadDesiredManifest(config);
	const currentApplied = await readAppliedRelease(config);
	const currentRuntime = await inspectManagedReleaseRuntime(config, signal, { allowLegacyLaunchdIdentity: true });
	if (current.manifestDigest !== plan.fromManifestDigest || desired.manifestDigest !== plan.toManifestDigest || current.profileHash !== plan.profileHash || current.dshVersion !== plan.observedDshVersion || (currentApplied?.releaseDigest ?? null) !== plan.fromReleaseDigest) throw new FleetProtocolError("approval-mismatch", "live/desired manifest, applied release, profile or DSH version changed after the release plan was created");
	assertObservedReleaseRuntime(currentRuntime, plan);
	await assertReleaseRemovalOwnership(config, current, plan, currentApplied);
	const rollback = await persistReleaseRollbackDescriptor(config, plan, currentApplied);
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
		fromManifestDigest: plan.fromManifestDigest,
		toManifestDigest: plan.toManifestDigest,
		fromReleaseDigest: plan.fromReleaseDigest,
		toReleaseDigest: plan.toReleaseDigest,
		rollbackDescriptorDigest: rollback.digest,
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
		if (!plan.restartRequired) {
			await verifyReleaseProfileFiles(config, plan, config.profile);
			assertObservedReleaseRuntime(await inspectManagedReleaseRuntime(config, signal, { expectedPluginIds: plan.plugins.map((plugin) => plugin.pluginId) }), plan);
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
		const [preSwapProfileHash, preSwapDshVersion, preSwapDesired, preSwapApplied] = await Promise.all([
			computeProfileHash(config),
			readDshVersion(config, signal),
			loadDesiredManifest(config),
			readAppliedRelease(config)
		]);
		if (preSwapProfileHash !== plan.profileHash || preSwapDshVersion !== plan.observedDshVersion || preSwapDesired.manifestDigest !== plan.toManifestDigest || (preSwapApplied?.releaseDigest ?? null) !== plan.fromReleaseDigest) throw new FleetProtocolError("approval-mismatch", "live profile, DSH, desired manifest, or applied release changed while the release was staged");
		assertObservedReleaseRuntime(await inspectManagedReleaseRuntime(config, signal, { allowLegacyLaunchdIdentity: true }), plan);
		await assertReleaseRemovalOwnership(config, current, plan, preSwapApplied);
		record = await saveReleaseAction(config, record, "staged");
		record = await saveReleaseAction(config, record, "applying");
		await swapStagedRelease(config, plan, signal);
		throwIfAborted(signal);
		record = await saveReleaseAction(config, record, "restarting");
		await startDsh(config, signal);
		throwIfAborted(signal);
		record = await saveReleaseAction(config, record, "verifying");
		await verifyReleaseProfileFiles(config, plan, config.profile);
		assertObservedReleaseRuntime(await inspectManagedReleaseRuntime(config, signal, { expectedPluginIds: plan.plugins.map((plugin) => plugin.pluginId) }), plan);
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
		if (record === null) return null;
		const plan = await readJson(releasePlanPath(config, planId));
		if (plan === null) throw new AgentRuntimeError("plan-not-found", "approved release plan was not found");
		validateFleetReleasePlan(plan);
		assertReleaseActionPlan(record, plan);
		if ([
			"succeeded",
			"rolled-back",
			"manual-intervention"
		].includes(record.state)) return record;
		return recoverReleaseInterrupted(config, plan, record);
	});
}
function releaseRollbackForwardProfile(plan) {
	return "fleet-rollforward-" + plan.digest.slice(0, 24);
}
async function readReleaseRollbackAction(config, planId) {
	return readJson(releaseRollbackActionPath(config, planId));
}
function assertReleaseRollbackActionPlan(record, plan) {
	if (record.planId !== plan.planId || record.planDigest !== plan.digest || record.transitionPlanId !== plan.transitionPlanId || record.deviceId !== plan.deviceId || record.profile !== plan.profile || record.fromManifestDigest !== plan.fromManifestDigest || record.toManifestDigest !== plan.toManifestDigest || record.fromReleaseDigest !== plan.fromReleaseDigest || record.toReleaseDigest !== plan.toReleaseDigest) throw new AgentRuntimeError("action-state-invalid", "release rollback action record does not match its plan");
}
async function saveReleaseRollbackAction(config, record, state, fields = {}) {
	const next = {
		...record,
		...fields,
		state,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	await atomicJson$1(releaseRollbackActionPath(config, record.planId), next);
	return next;
}
async function saveReleaseRollbackActionBestEffort(config, record, state, fields = {}) {
	const next = {
		...record,
		...fields,
		state,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	try {
		await atomicJson$1(releaseRollbackActionPath(config, record.planId), next);
	} catch {}
	return next;
}
function assertRollbackDescriptorTransition(descriptor, transition) {
	if (descriptor.transitionPlanId !== transition.planId || descriptor.transitionPlanDigest !== transition.digest || descriptor.fromManifestDigest !== transition.fromManifestDigest || descriptor.toManifestDigest !== transition.toManifestDigest || descriptor.fromReleaseDigest !== transition.fromReleaseDigest || descriptor.toReleaseDigest !== transition.toReleaseDigest || descriptor.fromProfileHash !== transition.profileHash || descriptor.backupProfile !== (transition.restartRequired ? releaseProfileNames(transition).backupProfile : null) || (descriptor.previousAppliedRelease?.releaseDigest ?? null) !== transition.fromReleaseDigest) throw new AgentRuntimeError("rollback-descriptor-invalid", "release rollback descriptor does not match its transition plan");
}
function releaseRetentionQuarantineProfile(plan, transitionPlanId) {
	return "fleet-failed-" + sha256Canonical({
		kind: "release-retention-quarantine",
		planId: plan.planId,
		transitionPlanId
	}).slice(0, 24);
}
async function readRealDirectoryEntries(path) {
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink() || !info.isDirectory()) throw new AgentRuntimeError("unsafe-state-directory", "release retention state accepts real directories only");
		return readdir(path, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
}
async function readRetentionTransitionMaterial(config, transitionPlanId) {
	const transition = await readJson(releasePlanPath(config, transitionPlanId));
	const descriptor = await readReleaseRollbackDescriptor(config, transitionPlanId);
	const action = await readReleaseAction(config, transitionPlanId);
	if (transition === null || descriptor === null || action === null) return null;
	validateFleetReleasePlan(transition);
	if (transition.deviceId !== config.deviceId || transition.profile !== config.profile) throw new AgentRuntimeError("retention-transition-invalid", "release retention transition belongs to another Agent");
	assertRollbackDescriptorTransition(descriptor, transition);
	assertReleaseActionPlan(action, transition);
	const descriptorDigest = sha256Canonical(descriptor);
	if (action.state !== "succeeded" || action.result !== "success" || action.rollbackDescriptorDigest !== descriptorDigest) throw new AgentRuntimeError("retention-transition-invalid", "release retention requires a successful transition with its exact descriptor");
	if (descriptor.backupProfile !== null) {
		const backup = await profileManifestAndHash(config, descriptor.backupProfile);
		if (backup.manifestDigest !== descriptor.fromManifestDigest || backup.profileHash !== descriptor.fromProfileHash) throw new AgentRuntimeError("retention-backup-mismatch", "release backup no longer matches its transition descriptor");
	}
	return {
		transition,
		descriptor,
		descriptorDigest
	};
}
async function successfullyRolledBackTransitionIds(config) {
	const result = /* @__PURE__ */ new Set();
	const entries = (await readRealDirectoryEntries(join(config.stateDir, "release-rollback-actions"))).filter((entry) => /^[0-9a-f]{64}\.json$/.test(entry.name)).sort((left, right) => left.name.localeCompare(right.name));
	if (entries.length > 4096) throw new AgentRuntimeError("retention-inventory-limit", "release rollback action inventory is too large");
	for (const entry of entries) {
		if (entry.isSymbolicLink() || !entry.isFile()) continue;
		const planId = "release-rollback-plan:" + entry.name.slice(0, 64);
		try {
			const plan = await readJson(releaseRollbackPlanPath(config, planId));
			const action = await readReleaseRollbackAction(config, planId);
			if (plan === null || action === null) continue;
			validateFleetReleaseRollbackPlan(plan);
			assertReleaseRollbackActionPlan(action, plan);
			if (plan.deviceId === config.deviceId && plan.profile === config.profile && action.state === "succeeded" && action.result === "success") result.add(plan.transitionPlanId);
		} catch {}
	}
	const releaseActionEntries = (await readRealDirectoryEntries(join(config.stateDir, "release-actions"))).filter((entry) => /^[0-9a-f]{64}\.json$/.test(entry.name)).sort((left, right) => left.name.localeCompare(right.name));
	if (releaseActionEntries.length > 4096) throw new AgentRuntimeError("retention-inventory-limit", "release action inventory is too large");
	for (const entry of releaseActionEntries) {
		if (entry.isSymbolicLink() || !entry.isFile()) continue;
		const transitionPlanId = "release-plan:" + entry.name.slice(0, 64);
		try {
			const plan = await readJson(releasePlanPath(config, transitionPlanId));
			const action = await readReleaseAction(config, transitionPlanId);
			const descriptor = await readReleaseRollbackDescriptor(config, transitionPlanId);
			if (plan === null || action === null || descriptor === null) continue;
			validateFleetReleasePlan(plan);
			assertReleaseActionPlan(action, plan);
			assertRollbackDescriptorTransition(descriptor, plan);
			if (plan.deviceId === config.deviceId && plan.profile === config.profile && action.state === "rolled-back" && action.result === "rolled-back" && action.rollbackDescriptorDigest === sha256Canonical(descriptor)) result.add(transitionPlanId);
		} catch {}
	}
	return result;
}
async function discoverReleaseRetention(config, strictChain) {
	const materials = /* @__PURE__ */ new Map();
	const legalBackupProfiles = /* @__PURE__ */ new Set();
	const rolledBackTransitionPlanIds = await successfullyRolledBackTransitionIds(config);
	let invalidTransitionCount = 0;
	const descriptorEntries = (await readRealDirectoryEntries(join(config.stateDir, "release-rollbacks"))).filter((entry) => /^[0-9a-f]{64}\.json$/.test(entry.name)).sort((left, right) => left.name.localeCompare(right.name));
	if (descriptorEntries.length > 4096) throw new AgentRuntimeError("retention-inventory-limit", "release retention descriptor inventory is too large");
	for (const entry of descriptorEntries) {
		const transitionPlanId = "release-plan:" + entry.name.slice(0, 64);
		try {
			if (entry.isSymbolicLink() || !entry.isFile()) throw new AgentRuntimeError("unsafe-state-file", "release descriptor must be a regular file");
			if (rolledBackTransitionPlanIds.has(transitionPlanId)) continue;
			const material = await readRetentionTransitionMaterial(config, transitionPlanId);
			if (material === null) {
				invalidTransitionCount += 1;
				continue;
			}
			materials.set(transitionPlanId, material);
			if (material.descriptor.backupProfile !== null) legalBackupProfiles.add(material.descriptor.backupProfile);
		} catch {
			invalidTransitionCount += 1;
		}
	}
	const activeStageProfiles = /* @__PURE__ */ new Set();
	const activeFailedProfiles = /* @__PURE__ */ new Set();
	const activeBackupProfiles = /* @__PURE__ */ new Set();
	const actionEntries = (await readRealDirectoryEntries(join(config.stateDir, "release-actions"))).filter((entry) => /^[0-9a-f]{64}\.json$/.test(entry.name)).sort((left, right) => left.name.localeCompare(right.name));
	if (actionEntries.length > 4096) throw new AgentRuntimeError("retention-inventory-limit", "release retention action inventory is too large");
	for (const entry of actionEntries) {
		if (entry.isSymbolicLink() || !entry.isFile()) continue;
		const transitionPlanId = "release-plan:" + entry.name.slice(0, 64);
		try {
			const transition = await readJson(releasePlanPath(config, transitionPlanId));
			const action = await readReleaseAction(config, transitionPlanId);
			if (transition === null || action === null) continue;
			validateFleetReleasePlan(transition);
			assertReleaseActionPlan(action, transition);
			if (![
				"succeeded",
				"rolled-back",
				"manual-intervention"
			].includes(action.state)) {
				activeStageProfiles.add(action.stageProfile);
				activeBackupProfiles.add(action.backupProfile);
				activeFailedProfiles.add(releaseProfileNames(transition).failedProfile);
			}
		} catch {}
	}
	const retiredTransitionPlanIds = new Set(rolledBackTransitionPlanIds);
	const retentionActionEntries = (await readRealDirectoryEntries(join(config.stateDir, "release-retention-actions"))).filter((entry) => /^[0-9a-f]{64}\.json$/.test(entry.name)).sort((left, right) => left.name.localeCompare(right.name));
	if (retentionActionEntries.length > 4096) throw new AgentRuntimeError("retention-inventory-limit", "release retention cleanup inventory is too large");
	for (const entry of retentionActionEntries) {
		if (entry.isSymbolicLink() || !entry.isFile()) continue;
		const planId = "release-retention-plan:" + entry.name.slice(0, 64);
		try {
			const plan = await readJson(releaseRetentionPlanPath(config, planId));
			if (plan === null) continue;
			validateFleetReleaseRetentionPlan(plan);
			const action = await readReleaseRetentionAction(config, plan);
			if (action === null) continue;
			if (action.state === "succeeded") for (const transitionPlanId of action.removedTransitionPlanIds) retiredTransitionPlanIds.add(transitionPlanId);
			else if (action.activeTransitionPlanId !== null) activeFailedProfiles.add(releaseRetentionQuarantineProfile(plan, action.activeTransitionPlanId));
		} catch {}
	}
	const applied = await readAppliedRelease(config);
	const currentTransitionPlanId = applied?.schemaVersion === 2 ? applied.transitionPlanId : null;
	const retainedTransitionPlanIds = [];
	const entries = [];
	const seen = /* @__PURE__ */ new Set();
	let marker = applied;
	let depth = 0;
	while (marker?.schemaVersion === 2) {
		const transitionPlanId = marker.transitionPlanId;
		if (seen.has(transitionPlanId) || seen.size >= 4096) {
			if (strictChain) throw new AgentRuntimeError("retention-chain-invalid", "release retention transition chain is cyclic or too deep");
			invalidTransitionCount += 1;
			break;
		}
		seen.add(transitionPlanId);
		const material = materials.get(transitionPlanId);
		if (material === void 0) {
			if (depth > 0 && retiredTransitionPlanIds.has(transitionPlanId)) break;
			if (strictChain && depth < 2) throw new AgentRuntimeError("retention-chain-invalid", "current or previous release transition has no valid rollback descriptor");
			break;
		}
		if (marker.deviceId !== config.deviceId || marker.profile !== config.profile || marker.transitionPlanDigest !== material.transition.digest || marker.releaseDigest !== material.transition.toReleaseDigest || marker.releaseId !== material.transition.releaseId || marker.releaseVersion !== material.transition.releaseVersion) {
			if (strictChain) throw new AgentRuntimeError("retention-chain-invalid", "applied release marker does not match its transition chain");
			invalidTransitionCount += 1;
			break;
		}
		if (depth < 2) retainedTransitionPlanIds.push(transitionPlanId);
		else entries.push({
			transitionPlanId,
			descriptorDigest: material.descriptorDigest,
			backupProfile: material.descriptor.backupProfile,
			backupManifestDigest: material.descriptor.backupProfile === null ? null : material.descriptor.fromManifestDigest,
			backupProfileHash: material.descriptor.backupProfile === null ? null : material.descriptor.fromProfileHash,
			reason: "superseded"
		});
		marker = material.descriptor.previousAppliedRelease;
		depth += 1;
	}
	const orphanBackupProfiles = [];
	const orphanStageProfiles = [];
	const orphanFailedProfiles = [];
	const profilesRoot = dirname(profileDir(config));
	for (const entry of (await readRealDirectoryEntries(profilesRoot)).sort((left, right) => left.name.localeCompare(right.name))) if (/^fleet-backup-[0-9a-f]{24}$/.test(entry.name) && !legalBackupProfiles.has(entry.name) && !activeBackupProfiles.has(entry.name)) orphanBackupProfiles.push(entry.name);
	else if (/^fleet-stage-[0-9a-f]{24}$/.test(entry.name) && !activeStageProfiles.has(entry.name)) orphanStageProfiles.push(entry.name);
	else if (/^fleet-failed-[0-9a-f]{24}$/.test(entry.name) && !activeFailedProfiles.has(entry.name)) orphanFailedProfiles.push(entry.name);
	return {
		currentTransitionPlanId,
		retainedTransitionPlanIds: retainedTransitionPlanIds.sort(),
		entries: entries.sort((left, right) => left.transitionPlanId.localeCompare(right.transitionPlanId)),
		orphanBackupProfiles,
		orphanStageProfiles,
		orphanFailedProfiles,
		invalidTransitionCount
	};
}
async function releaseRetentionInspection(config) {
	const discovery = await discoverReleaseRetention(config, false);
	const orphanCount = discovery.orphanBackupProfiles.length + discovery.orphanStageProfiles.length + discovery.orphanFailedProfiles.length;
	return {
		retainedCount: discovery.retainedTransitionPlanIds.length,
		eligibleCount: discovery.entries.length,
		orphanBackupCount: discovery.orphanBackupProfiles.length,
		orphanStageCount: discovery.orphanStageProfiles.length,
		orphanFailedCount: discovery.orphanFailedProfiles.length,
		orphanCount,
		invalidTransitionCount: discovery.invalidTransitionCount
	};
}
async function buildReleaseRetentionPlan(config, createdAt, expiresAt) {
	const discovery = await discoverReleaseRetention(config, true);
	return createFleetReleaseRetentionPlan({
		protocolVersion: 1,
		kind: "profile-release-retention",
		deviceId: config.deviceId,
		profile: config.profile,
		currentTransitionPlanId: discovery.currentTransitionPlanId,
		retainedTransitionPlanIds: discovery.retainedTransitionPlanIds,
		entries: discovery.entries,
		orphanBackupProfiles: discovery.orphanBackupProfiles,
		orphanStageProfiles: discovery.orphanStageProfiles,
		orphanFailedProfiles: discovery.orphanFailedProfiles,
		createdAt,
		expiresAt
	});
}
const RELEASE_RETENTION_ACTION_KEYS = [
	"planId",
	"planDigest",
	"approvalId",
	"principalId",
	"idempotencyKey",
	"deviceId",
	"profile",
	"currentTransitionPlanId",
	"state",
	"removedTransitionPlanIds",
	"activeTransitionPlanId",
	"activeBackupQuarantinePrepared",
	"activeBackupRemoved",
	"updatedAt",
	"result"
];
function validateReleaseRetentionAction(value, plan) {
	const body = objectValue(value);
	if (body === null || Object.keys(body).sort().join(",") !== [...RELEASE_RETENTION_ACTION_KEYS].sort().join(",")) throw new AgentRuntimeError("action-state-invalid", "release retention action has unsupported or missing fields");
	const updatedAt = typeof body.updatedAt === "string" ? Date.parse(body.updatedAt) : NaN;
	if (body.planId !== plan.planId || body.planDigest !== plan.digest || body.deviceId !== plan.deviceId || body.profile !== plan.profile || body.currentTransitionPlanId !== plan.currentTransitionPlanId || typeof body.approvalId !== "string" || typeof body.principalId !== "string" || typeof body.idempotencyKey !== "string" || !/^[0-9a-f]{64}$/.test(body.idempotencyKey) || ![
		"approved",
		"applying",
		"succeeded"
	].includes(body.state) || !Array.isArray(body.removedTransitionPlanIds) || body.removedTransitionPlanIds.some((id) => typeof id !== "string") || body.activeTransitionPlanId !== null && typeof body.activeTransitionPlanId !== "string" || typeof body.activeBackupQuarantinePrepared !== "boolean" || typeof body.activeBackupRemoved !== "boolean" || !Number.isFinite(updatedAt) || new Date(updatedAt).toISOString() !== body.updatedAt || body.result !== null && body.result !== "success") throw new AgentRuntimeError("action-state-invalid", "release retention action is invalid");
	const entryIds = plan.entries.map((entry) => entry.transitionPlanId);
	const removed = body.removedTransitionPlanIds;
	if (new Set(removed).size !== removed.length || removed.some((id, index) => !entryIds.includes(id) || index > 0 && id <= removed[index - 1]) || body.activeTransitionPlanId !== null && (!entryIds.includes(body.activeTransitionPlanId) || removed.includes(body.activeTransitionPlanId)) || body.activeTransitionPlanId === null && (body.activeBackupQuarantinePrepared === true || body.activeBackupRemoved === true) || body.activeBackupQuarantinePrepared === true && body.activeBackupRemoved === true || body.state === "succeeded" && (body.result !== "success" || removed.length !== entryIds.length || body.activeTransitionPlanId !== null) || body.state !== "succeeded" && body.result !== null) throw new AgentRuntimeError("action-state-invalid", "release retention action progress is invalid");
}
async function readReleaseRetentionAction(config, plan) {
	const value = await readJson(releaseRetentionActionPath(config, plan.planId));
	if (value === null) return null;
	validateReleaseRetentionAction(value, plan);
	return value;
}
async function saveReleaseRetentionAction(config, value, fields) {
	const next = {
		...value,
		...fields,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	await atomicJson$1(releaseRetentionActionPath(config, value.planId), next);
	return next;
}
function assertRetentionEntryDescriptor(entry, descriptor) {
	if (descriptor.transitionPlanId !== entry.transitionPlanId || sha256Canonical(descriptor) !== entry.descriptorDigest || descriptor.backupProfile !== entry.backupProfile || (descriptor.backupProfile === null ? entry.backupManifestDigest !== null || entry.backupProfileHash !== null : descriptor.fromManifestDigest !== entry.backupManifestDigest || descriptor.fromProfileHash !== entry.backupProfileHash)) throw new AgentRuntimeError("retention-entry-mismatch", "release retention entry no longer matches its descriptor");
}
async function executeReleaseRetention(config, plan, initial) {
	let record = initial;
	for (const entry of plan.entries) {
		if (record.removedTransitionPlanIds.includes(entry.transitionPlanId)) continue;
		if (record.activeTransitionPlanId !== null && record.activeTransitionPlanId !== entry.transitionPlanId) throw new AgentRuntimeError("action-state-invalid", "release retention action has ambiguous progress");
		if (record.activeTransitionPlanId === null) {
			const material = await readRetentionTransitionMaterial(config, entry.transitionPlanId);
			if (material === null) throw new AgentRuntimeError("retention-entry-mismatch", "release retention descriptor disappeared before cleanup");
			assertRetentionEntryDescriptor(entry, material.descriptor);
			record = await saveReleaseRetentionAction(config, record, {
				state: "applying",
				activeTransitionPlanId: entry.transitionPlanId,
				activeBackupQuarantinePrepared: false,
				activeBackupRemoved: entry.backupProfile === null
			});
		}
		if (!record.activeBackupRemoved) {
			const descriptor = await readReleaseRollbackDescriptor(config, entry.transitionPlanId);
			if (descriptor === null) throw new AgentRuntimeError("retention-entry-mismatch", "release retention descriptor disappeared before its backup");
			assertRetentionEntryDescriptor(entry, descriptor);
			if (entry.backupProfile === null || entry.backupManifestDigest === null || entry.backupProfileHash === null) throw new AgentRuntimeError("retention-entry-mismatch", "release retention backup binding is incomplete");
			const profilesRoot = dirname(profileDir(config));
			const backupPath = join(profilesRoot, entry.backupProfile);
			const quarantinePath = join(profilesRoot, releaseRetentionQuarantineProfile(plan, entry.transitionPlanId));
			if (!record.activeBackupQuarantinePrepared) {
				if (await regularDirectoryExists(quarantinePath)) throw new AgentRuntimeError("retention-layout-conflict", "release retention quarantine path is unexpectedly occupied");
				const backup = await profileManifestAndHash(config, entry.backupProfile);
				if (backup.manifestDigest !== entry.backupManifestDigest || backup.profileHash !== entry.backupProfileHash) throw new AgentRuntimeError("retention-backup-mismatch", "release retention backup changed after approval");
				record = await saveReleaseRetentionAction(config, record, { activeBackupQuarantinePrepared: true });
			}
			const backupExists = await regularDirectoryExists(backupPath);
			const quarantineExists = await regularDirectoryExists(quarantinePath);
			if (backupExists && quarantineExists) throw new AgentRuntimeError("retention-layout-conflict", "release retention backup and quarantine both exist");
			if (backupExists) {
				const backup = await profileManifestAndHash(config, entry.backupProfile);
				if (backup.manifestDigest !== entry.backupManifestDigest || backup.profileHash !== entry.backupProfileHash) throw new AgentRuntimeError("retention-backup-mismatch", "release retention backup changed before quarantine");
				await rename(backupPath, quarantinePath);
				await syncDirectory(profilesRoot);
			}
			if (await regularDirectoryExists(quarantinePath)) {
				await rm(quarantinePath, { recursive: true });
				await syncDirectory(profilesRoot);
			}
			record = await saveReleaseRetentionAction(config, record, {
				activeBackupQuarantinePrepared: false,
				activeBackupRemoved: true
			});
		} else if (entry.backupProfile !== null && (await regularDirectoryExists(join(dirname(profileDir(config)), entry.backupProfile)) || await regularDirectoryExists(join(dirname(profileDir(config)), releaseRetentionQuarantineProfile(plan, entry.transitionPlanId))))) throw new AgentRuntimeError("action-state-invalid", "a removed release backup or quarantine reappeared during retention");
		const descriptor = await readReleaseRollbackDescriptor(config, entry.transitionPlanId);
		if (descriptor !== null) {
			assertRetentionEntryDescriptor(entry, descriptor);
			await rm(releaseRollbackDescriptorPath(config, entry.transitionPlanId));
			await syncDirectory(dirname(releaseRollbackDescriptorPath(config, entry.transitionPlanId)));
		}
		record = await saveReleaseRetentionAction(config, record, {
			removedTransitionPlanIds: [...record.removedTransitionPlanIds, entry.transitionPlanId].sort(),
			activeTransitionPlanId: null,
			activeBackupQuarantinePrepared: false,
			activeBackupRemoved: false
		});
		await auditBestEffort(config, {
			type: "profile-release/retention-entry-removed",
			planId: plan.planId,
			transitionPlanId: entry.transitionPlanId,
			backupProfile: entry.backupProfile
		});
	}
	record = await saveReleaseRetentionAction(config, record, {
		state: "succeeded",
		result: "success"
	});
	await auditBestEffort(config, {
		type: "profile-release/retention-applied",
		planId: plan.planId,
		removedTransitionPlanIds: record.removedTransitionPlanIds
	});
	return record;
}
async function createStoredReleaseRetentionPlan(config, now = /* @__PURE__ */ new Date()) {
	assertReleaseReadyConfig(config);
	return withProfileLock(config, async () => {
		if (!Number.isFinite(now.getTime())) throw new AgentRuntimeError("invalid-time", "release retention plan time is invalid");
		const plan = await buildReleaseRetentionPlan(config, now.toISOString(), new Date(now.getTime() + Math.min(config.planTtlMs, 36e5)).toISOString());
		await atomicJson$1(releaseRetentionPlanPath(config, plan.planId), plan);
		await audit(config, {
			type: "profile-release/retention-plan-created",
			planId: plan.planId,
			retainedCount: plan.retainedTransitionPlanIds.length,
			eligibleCount: plan.entries.length,
			orphanCount: plan.orphanBackupProfiles.length + plan.orphanStageProfiles.length + plan.orphanFailedProfiles.length
		});
		return plan;
	});
}
async function applyStoredReleaseRetentionPlan(config, approval, now = /* @__PURE__ */ new Date()) {
	assertReleaseReadyConfig(config);
	return withProfileLock(config, async () => {
		const plan = await readJson(releaseRetentionPlanPath(config, approval.planId));
		if (plan === null) throw new AgentRuntimeError("plan-not-found", "approved release retention plan was not found");
		validateFleetReleaseRetentionPlan(plan);
		let existing = await readReleaseRetentionAction(config, plan);
		const identity = validateFleetReleaseRetentionApproval(plan, approval, approval.approvedAt);
		if (existing !== null) {
			if (existing.idempotencyKey !== identity.idempotencyKey) throw new AgentRuntimeError("idempotency-conflict", "release retention plan already has a different approval");
			if (existing.state === "succeeded") return existing;
			const current = await readAppliedRelease(config);
			if ((current?.schemaVersion === 2 ? current.transitionPlanId : null) !== plan.currentTransitionPlanId) throw new AgentRuntimeError("retention-plan-stale", "a new release invalidated the in-progress retention plan");
			if (existing.state === "approved" && existing.removedTransitionPlanIds.length === 0 && existing.activeTransitionPlanId === null) {
				if ((await buildReleaseRetentionPlan(config, plan.createdAt, plan.expiresAt)).digest !== plan.digest) throw new AgentRuntimeError("retention-plan-stale", "release retention state changed after approval");
			}
			return executeReleaseRetention(config, plan, existing);
		}
		validateFleetReleaseRetentionApproval(plan, approval, now);
		if ((await buildReleaseRetentionPlan(config, plan.createdAt, plan.expiresAt)).digest !== plan.digest) throw new AgentRuntimeError("retention-plan-stale", "release retention state changed after the plan was created");
		existing = {
			planId: plan.planId,
			planDigest: plan.digest,
			approvalId: approval.approvalId,
			principalId: approval.principalId,
			idempotencyKey: identity.idempotencyKey,
			deviceId: plan.deviceId,
			profile: plan.profile,
			currentTransitionPlanId: plan.currentTransitionPlanId,
			state: "approved",
			removedTransitionPlanIds: [],
			activeTransitionPlanId: null,
			activeBackupQuarantinePrepared: false,
			activeBackupRemoved: false,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			result: null
		};
		await atomicJson$1(releaseRetentionActionPath(config, plan.planId), existing);
		await audit(config, {
			type: "profile-release/retention-approved",
			planId: plan.planId,
			approvalId: approval.approvalId,
			principalId: approval.principalId
		});
		return executeReleaseRetention(config, plan, existing);
	});
}
async function readReleaseRetentionActionStatus(config, planId) {
	assertReleaseReadyConfig(config);
	return withProfileLock(config, async () => {
		const plan = await readJson(releaseRetentionPlanPath(config, planId));
		if (plan === null) throw new AgentRuntimeError("plan-not-found", "release retention plan was not found");
		validateFleetReleaseRetentionPlan(plan);
		return readReleaseRetentionAction(config, plan);
	});
}
async function readRollbackTransition(config, transitionPlanId) {
	const transition = await readJson(releasePlanPath(config, transitionPlanId));
	if (transition === null) throw new AgentRuntimeError("plan-not-found", "release transition plan was not found");
	validateFleetReleasePlan(transition);
	if (transition.deviceId !== config.deviceId || transition.profile !== config.profile) throw new AgentRuntimeError("rollback-descriptor-invalid", "release transition identity does not match this Agent");
	const descriptor = await readReleaseRollbackDescriptor(config, transition.planId);
	if (descriptor === null) throw new AgentRuntimeError("rollback-not-available", "release transition has no durable rollback descriptor");
	assertRollbackDescriptorTransition(descriptor, transition);
	return {
		transition,
		descriptor
	};
}
function assertRollbackPlanDescriptor(plan, transition, descriptor) {
	if (transition.digest !== plan.transitionPlanDigest || transition.deviceId !== plan.deviceId || transition.profile !== plan.profile || descriptor.toManifestDigest !== plan.fromManifestDigest || descriptor.fromManifestDigest !== plan.toManifestDigest || descriptor.toReleaseDigest !== plan.fromReleaseDigest || descriptor.fromReleaseDigest !== plan.toReleaseDigest || descriptor.fromProfileHash !== plan.toProfileHash) throw new AgentRuntimeError("rollback-descriptor-invalid", "release rollback plan no longer matches its transition descriptor");
}
async function profileManifestAndHash(config, profile) {
	const targetConfig = configForProfile(config, profile);
	if (!await regularDirectoryExists(profileDir(targetConfig))) throw new AgentRuntimeError("rollback-target-mismatch", "rollback profile directory is missing");
	const source = await readRegularOptional(runtimeManifestPath(targetConfig));
	if (source === null) throw new AgentRuntimeError("release-runtime-manifest-mismatch", "rollback profile has no Fleet runtime manifest");
	parseFleetManifest(source);
	return {
		manifestDigest: sha256(source),
		profileHash: await computeProfileHash(targetConfig)
	};
}
function releaseDigestOf(applied) {
	return applied?.releaseDigest ?? null;
}
async function assertRollbackSourceState(config, plan, descriptor, signal) {
	const current = await loadState(config, signal);
	const currentApplied = await readAppliedRelease(config);
	const runtime = await inspectManagedReleaseRuntime(config, signal);
	if (current.manifestDigest !== plan.fromManifestDigest || current.profileHash !== plan.fromProfileHash || current.dshVersion !== plan.observedDshVersion || releaseDigestOf(currentApplied) !== plan.fromReleaseDigest) throw new AgentRuntimeError("release-ownership-conflict", "live release no longer matches the approved rollback source");
	assertObservedReleaseRuntime(runtime, plan);
	if (descriptor.backupProfile !== null) {
		const backup = await profileManifestAndHash(config, descriptor.backupProfile);
		if (backup.manifestDigest !== plan.toManifestDigest || backup.profileHash !== plan.toProfileHash) throw new AgentRuntimeError("rollback-target-mismatch", "retained release backup no longer matches the approved rollback target");
	}
	return currentApplied;
}
async function assertRollbackTargetProfile(config, plan, descriptor) {
	const target = await profileManifestAndHash(config, config.profile);
	if (target.manifestDigest !== plan.toManifestDigest || target.profileHash !== plan.toProfileHash) throw new AgentRuntimeError("rollback-target-mismatch", "restored release profile does not match the approved rollback target");
	await restoreAppliedReleaseMarker(config, descriptor.previousAppliedRelease);
	if (releaseDigestOf(await readAppliedRelease(config)) !== plan.toReleaseDigest) throw new AgentRuntimeError("rollback-target-mismatch", "restored applied release marker does not match the approved rollback target");
	await ensureServiceStarted(config);
	assertObservedReleaseRuntime(await inspectManagedReleaseRuntime(config, void 0, {
		allowLegacyLaunchdIdentity: true,
		expectedPluginIds: descriptor.previousAppliedRelease?.plugins.map((plugin) => plugin.pluginId) ?? []
	}), plan);
}
async function rollbackCurrentReleaseAfterFailure(config, plan, descriptor, currentApplied) {
	if (descriptor.backupProfile !== null) {
		const profilesRoot = dirname(profileDir(config));
		const liveDir = profileDir(config);
		const backupDir = join(profilesRoot, descriptor.backupProfile);
		const forwardDir = join(profilesRoot, releaseRollbackForwardProfile(plan));
		if (await regularDirectoryExists(forwardDir)) {
			try {
				await stopDsh(config);
			} catch {
				if ((await listenerPids(config, config.restart.port))[0] !== void 0) throw new AgentRuntimeError("restart-cleanup-failed", "cannot stop the failed rollback target");
			}
			if (await regularDirectoryExists(backupDir)) throw new AgentRuntimeError("rollback-layout-conflict", "rollback backup path is unexpectedly occupied");
			if (await regularDirectoryExists(liveDir)) await rename(liveDir, backupDir);
			await rename(forwardDir, liveDir);
			await syncDirectory(profilesRoot);
		}
	}
	await restoreAppliedReleaseMarker(config, currentApplied);
	await ensureServiceStarted(config);
	assertObservedReleaseRuntime(await inspectManagedReleaseRuntime(config, void 0, { expectedPluginIds: currentApplied?.plugins.map((plugin) => plugin.pluginId) ?? [] }), plan);
}
async function executeStoredReleaseRollback(config, plan, descriptor, record, signal) {
	let currentApplied;
	try {
		currentApplied = await assertRollbackSourceState(config, plan, descriptor, signal);
	} catch (error) {
		return saveReleaseRollbackActionBestEffort(config, record, "manual-intervention", {
			result: "manual-intervention",
			errorCode: typeof error.code === "string" ? error.code : "release-rollback-failed"
		});
	}
	let currentRecord = await saveReleaseRollbackAction(config, record, "applying");
	try {
		if (descriptor.backupProfile !== null) {
			const profilesRoot = dirname(profileDir(config));
			const liveDir = profileDir(config);
			const backupDir = join(profilesRoot, descriptor.backupProfile);
			const forwardDir = join(profilesRoot, releaseRollbackForwardProfile(plan));
			await rm(forwardDir, {
				recursive: true,
				force: true
			});
			await stopDsh(config, signal);
			throwIfAborted(signal);
			await rename(liveDir, forwardDir);
			await syncDirectory(profilesRoot);
			try {
				await rename(backupDir, liveDir);
				await syncDirectory(profilesRoot);
			} catch (error) {
				await rename(forwardDir, liveDir);
				await syncDirectory(profilesRoot);
				await startDsh(config);
				throw error;
			}
		}
		currentRecord = await saveReleaseRollbackAction(config, currentRecord, "restarting");
		await ensureServiceStarted(config);
		throwIfAborted(signal);
		currentRecord = await saveReleaseRollbackAction(config, currentRecord, "verifying");
		await assertRollbackTargetProfile(config, plan, descriptor);
		throwIfAborted(signal);
		if (descriptor.backupProfile !== null) await rm(join(dirname(profileDir(config)), releaseRollbackForwardProfile(plan)), {
			recursive: true,
			force: true
		});
		currentRecord = await saveReleaseRollbackAction(config, currentRecord, "succeeded", { result: "success" });
		await auditBestEffort(config, {
			type: "profile-release/rollback-applied",
			planId: plan.planId,
			transitionPlanId: plan.transitionPlanId,
			result: "success"
		});
		return currentRecord;
	} catch (error) {
		const errorCode = typeof error.code === "string" ? error.code : "release-rollback-failed";
		try {
			await rollbackCurrentReleaseAfterFailure(config, plan, descriptor, currentApplied);
		} catch {
			return saveReleaseRollbackActionBestEffort(config, currentRecord, "manual-intervention", {
				result: "manual-intervention",
				errorCode: "rollback-recovery-failed"
			});
		}
		await auditBestEffort(config, {
			type: "profile-release/rollback-failed",
			planId: plan.planId,
			transitionPlanId: plan.transitionPlanId,
			result: errorCode
		});
		return saveReleaseRollbackActionBestEffort(config, currentRecord, "manual-intervention", {
			result: "manual-intervention",
			errorCode
		});
	}
}
async function createStoredReleaseRollbackPlan(config, transitionPlanId, now = /* @__PURE__ */ new Date(), signal) {
	assertReleaseReadyConfig(config);
	return withProfileLock(config, async () => {
		const { transition, descriptor } = await readRollbackTransition(config, transitionPlanId);
		const transitionAction = await readReleaseAction(config, transition.planId);
		if (transitionAction?.state !== "succeeded" || transitionAction.result !== "success") throw new AgentRuntimeError("rollback-not-available", "only a successfully applied release transition can be rolled back");
		const current = await loadState(config, signal);
		const applied = await readAppliedRelease(config);
		const runtime = await inspectManagedReleaseRuntime(config, signal);
		if (current.manifestDigest !== descriptor.toManifestDigest || releaseDigestOf(applied) !== descriptor.toReleaseDigest) throw new AgentRuntimeError("release-ownership-conflict", "live release no longer belongs to the requested transition");
		if (descriptor.backupProfile !== null) {
			const backup = await profileManifestAndHash(config, descriptor.backupProfile);
			if (backup.manifestDigest !== descriptor.fromManifestDigest || backup.profileHash !== descriptor.fromProfileHash) throw new AgentRuntimeError("rollback-target-mismatch", "retained release backup no longer matches the transition source");
		} else if (current.profileHash !== descriptor.fromProfileHash) throw new AgentRuntimeError("rollback-target-mismatch", "marker-only rollback profile no longer matches the transition source");
		if (!Number.isFinite(now.getTime())) throw new AgentRuntimeError("invalid-time", "rollback plan time is invalid");
		const createdAt = now.toISOString();
		const plan = createFleetReleaseRollbackPlan({
			protocolVersion: 2,
			kind: "profile-release-rollback",
			transitionPlanId: transition.planId,
			transitionPlanDigest: transition.digest,
			deviceId: transition.deviceId,
			profile: transition.profile,
			fromManifestDigest: transition.toManifestDigest,
			toManifestDigest: transition.fromManifestDigest,
			fromReleaseDigest: transition.toReleaseDigest,
			toReleaseDigest: transition.fromReleaseDigest,
			fromProfileHash: current.profileHash,
			toProfileHash: descriptor.fromProfileHash,
			observedDshVersion: runtime.runtimeIdentity.dshVersion,
			observedRuntimeDigest: runtime.observedRuntimeDigest,
			observedServiceDefinitionDigest: runtime.observedServiceDefinitionDigest,
			createdAt,
			expiresAt: new Date(now.getTime() + config.planTtlMs).toISOString()
		});
		await atomicJson$1(releaseRollbackPlanPath(config, plan.planId), plan);
		await audit(config, {
			type: "profile-release/rollback-plan-created",
			planId: plan.planId,
			transitionPlanId: transition.planId
		});
		return plan;
	});
}
async function recoverStoredReleaseRollback(config, plan, record) {
	const { transition, descriptor } = await readRollbackTransition(config, plan.transitionPlanId);
	assertRollbackPlanDescriptor(plan, transition, descriptor);
	const liveDir = profileDir(config);
	const forwardDir = join(dirname(liveDir), releaseRollbackForwardProfile(plan));
	if (!await regularDirectoryExists(liveDir) && await regularDirectoryExists(forwardDir)) {
		await rename(forwardDir, liveDir);
		await syncDirectory(dirname(liveDir));
	}
	try {
		const current = await loadState(config);
		const applied = await readAppliedRelease(config);
		if (current.manifestDigest === plan.toManifestDigest && current.profileHash === plan.toProfileHash) {
			if (releaseDigestOf(applied) !== plan.fromReleaseDigest && releaseDigestOf(applied) !== plan.toReleaseDigest) throw new AgentRuntimeError("release-ownership-conflict", "applied release marker no longer belongs to this rollback action");
			await assertRollbackTargetProfile(config, plan, descriptor);
			await rm(forwardDir, {
				recursive: true,
				force: true
			});
			return saveReleaseRollbackAction(config, record, "succeeded", { result: "success" });
		}
		if (current.manifestDigest === plan.fromManifestDigest && current.profileHash === plan.fromProfileHash && releaseDigestOf(applied) === plan.fromReleaseDigest) return executeStoredReleaseRollback(config, plan, descriptor, record);
	} catch {}
	return saveReleaseRollbackActionBestEffort(config, record, "manual-intervention", {
		result: "manual-intervention",
		errorCode: "rollback-recovery-ambiguous"
	});
}
async function applyStoredReleaseRollbackPlan(config, approval, now = /* @__PURE__ */ new Date(), signal) {
	assertReleaseReadyConfig(config);
	return withProfileLock(config, async () => {
		const plan = await readJson(releaseRollbackPlanPath(config, approval.planId));
		if (plan === null) throw new AgentRuntimeError("plan-not-found", "approved release rollback plan was not found");
		validateFleetReleaseRollbackPlan(plan);
		const existing = await readReleaseRollbackAction(config, plan.planId);
		if (existing !== null) assertReleaseRollbackActionPlan(existing, plan);
		const identity = validateFleetReleaseRollbackApproval(plan, approval, approval.approvedAt);
		if (existing !== null) {
			if (existing.idempotencyKey !== identity.idempotencyKey) throw new AgentRuntimeError("idempotency-conflict", "release rollback plan already has a different approval");
			if (existing.state === "succeeded" || existing.state === "manual-intervention") return existing;
			return recoverStoredReleaseRollback(config, plan, existing);
		}
		const validation = validateFleetReleaseRollbackApproval(plan, approval, now);
		const { transition, descriptor } = await readRollbackTransition(config, plan.transitionPlanId);
		assertRollbackPlanDescriptor(plan, transition, descriptor);
		await assertRollbackSourceState(config, plan, descriptor, signal);
		let record = {
			planId: plan.planId,
			planDigest: plan.digest,
			transitionPlanId: plan.transitionPlanId,
			approvalId: approval.approvalId,
			principalId: approval.principalId,
			idempotencyKey: validation.idempotencyKey,
			deviceId: plan.deviceId,
			profile: plan.profile,
			fromManifestDigest: plan.fromManifestDigest,
			toManifestDigest: plan.toManifestDigest,
			fromReleaseDigest: plan.fromReleaseDigest,
			toReleaseDigest: plan.toReleaseDigest,
			state: "approved",
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		record = await saveReleaseRollbackAction(config, record, "approved");
		await audit(config, {
			type: "profile-release/rollback-approved",
			planId: plan.planId,
			transitionPlanId: plan.transitionPlanId,
			approvalId: approval.approvalId,
			principalId: approval.principalId
		});
		return executeStoredReleaseRollback(config, plan, descriptor, record, signal);
	});
}
async function readOrRecoverReleaseRollbackAction(config, planId) {
	assertReleaseReadyConfig(config);
	return withProfileLock(config, async () => {
		const record = await readReleaseRollbackAction(config, planId);
		if (record === null) return null;
		const plan = await readJson(releaseRollbackPlanPath(config, planId));
		if (plan === null) throw new AgentRuntimeError("plan-not-found", "release rollback plan was not found");
		validateFleetReleaseRollbackPlan(plan);
		assertReleaseRollbackActionPlan(record, plan);
		if (record.state === "succeeded" || record.state === "manual-intervention") return record;
		return recoverStoredReleaseRollback(config, plan, record);
	});
}
function safeRuntimeError(error) {
	const code = typeof error.code === "string" && /^[a-z0-9-]+$/.test(error.code) ? error.code : "internal";
	return {
		code,
		message: {
			"unsupported-dsh-version": "target DSH must be exactly 0.1.0-rc.8",
			"already-aligned": "plugin is already aligned",
			"plugin-not-targeted": "plugin is not targeted to this device",
			"plan-not-found": "approved plan was not found",
			"approval-mismatch": "approval no longer matches current target state",
			"plan-expired": "plan has expired",
			"approval-expired": "approval has expired",
			"command-failed": "controlled DSH command failed",
			"command-timeout": "controlled DSH command exceeded its timeout",
			"command-output-limit": "controlled DSH command exceeded its output limit",
			"command-descendant-leak": "controlled command left a background descendant; the profile was rolled back",
			"command-cleanup-failed": "controlled command process cleanup failed; manual intervention is required",
			"agent-shutdown": "fleet agent shutdown interrupted the action",
			"agent-busy": "another fleet action is already running for this profile",
			"unsafe-mutation-config": "mutation requires restart and loopback Fleet RPC health verification",
			"health-timeout": "DSH did not become healthy before timeout",
			"plugin-not-active": "plugin did not become active; profile was rolled back",
			"runtime-modules-failed": "DSH runtime has failed modules; profile was rolled back",
			"profile-layout-unsupported": "profile contains unsupported top-level state and cannot be changed safely",
			"release-ownership-conflict": "live release binding is no longer owned by the approved transition",
			"rollback-not-available": "the release transition has no usable rollback state",
			"rollback-target-mismatch": "the retained rollback target no longer matches the approved state",
			"rollback-descriptor-invalid": "the durable rollback descriptor is missing or invalid",
			"rollback-backup-missing": "the retained release backup is missing",
			"rollback-recovery-ambiguous": "release rollback recovery requires manual intervention",
			"retention-chain-invalid": "current release retention chain is incomplete or invalid",
			"retention-transition-invalid": "release transition is not eligible for retention cleanup",
			"retention-backup-mismatch": "release backup changed and cannot be removed safely",
			"retention-entry-mismatch": "release retention entry no longer matches its durable descriptor",
			"retention-plan-stale": "release retention state changed after the plan was created",
			"retention-layout-conflict": "release retention backup and quarantine layout is unsafe",
			"retention-inventory-limit": "release retention inventory is too large to inspect safely",
			"idempotency-conflict": "the release action already has a different approval",
			"action-state-invalid": "the stored release action no longer matches its approved plan"
		}[code] ?? "fleet agent request failed"
	};
}
//#endregion
//#region src/worker/policy.ts
var TaskPolicyResolutionError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "TaskPolicyResolutionError";
		this.code = code;
	}
};
function isTaskPolicyId(value) {
	return TASK_POLICY_IDS.includes(value);
}
function policyBody(policy) {
	const { policyDigest: _policyDigest, ...body } = policy;
	return body;
}
function hasValidLocalDigest(policy) {
	if (!isTaskPolicyId(policy.policyId)) return false;
	const installed = LOCAL_TASK_POLICIES[policy.policyId];
	return policy.policyDigest === installed.policyDigest && calculateTaskPolicyDigest(policyBody(policy)) === installed.policyDigest;
}
function resolveTaskPolicy(tasks, policyId, policyDigest) {
	if (!isTaskPolicyId(policyId)) throw new TaskPolicyResolutionError("unknown-policy", "requested task policy is not installed");
	if (!/^[0-9a-f]{64}$/.test(policyDigest)) throw new TaskPolicyResolutionError("policy-digest-mismatch", "requested task policy digest is invalid");
	if (tasks.policyIds?.includes(policyId) !== true) throw new TaskPolicyResolutionError("policy-not-enabled", "requested task policy is not enabled locally");
	const policy = tasks.policies?.[policyId];
	if (policy === void 0 || !hasValidLocalDigest(policy)) throw new TaskPolicyResolutionError("invalid-local-policy", "local task policy is missing or has lost integrity");
	if (policy.policyDigest !== policyDigest) throw new TaskPolicyResolutionError("policy-digest-mismatch", "requested task policy digest does not match the local policy");
	return policy;
}
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isWorkspacePath(workspacePath, value, optional) {
	if (value === void 0) return optional;
	if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) return false;
	const root = resolve(workspacePath);
	const target = resolve(root, value);
	const fromRoot = relative(root, target);
	return fromRoot === "" || !fromRoot.startsWith(".." + sep) && fromRoot !== ".." && !isAbsolute(fromRoot);
}
function globPatternStaysWithinWorkspace(value) {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0") || isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return false;
	return !value.split(/[\\/]+/).includes("..");
}
function workspaceScopedToolArguments(toolName, toolArguments, workspacePath) {
	if (toolName === "read" || toolName === "read_image" || toolName === "write" || toolName === "edit") return isWorkspacePath(workspacePath, toolArguments.file_path, false);
	if (toolName === "glob") return isWorkspacePath(workspacePath, toolArguments.path, true) && globPatternStaysWithinWorkspace(toolArguments.pattern);
	if (toolName === "grep") return isWorkspacePath(workspacePath, toolArguments.path, true);
	if (toolName === "bash" || toolName === "pwsh") return isWorkspacePath(workspacePath, toolArguments.workdir, true);
	return true;
}
function contained(root, target) {
	const fromRoot = relative(root, target);
	return fromRoot === "" || !fromRoot.startsWith(".." + sep) && fromRoot !== ".." && !isAbsolute(fromRoot);
}
function filesystemTarget(toolName, toolArguments) {
	if (toolName === "read" || toolName === "read_image") return typeof toolArguments.file_path === "string" ? {
		path: toolArguments.file_path,
		mutable: false
	} : null;
	if (toolName === "write" || toolName === "edit") return typeof toolArguments.file_path === "string" ? {
		path: toolArguments.file_path,
		mutable: true
	} : null;
	if (toolName === "glob" || toolName === "grep" || toolName === "bash" || toolName === "pwsh") {
		const value = toolArguments.path ?? toolArguments.workdir ?? ".";
		return typeof value === "string" ? {
			path: value,
			mutable: false
		} : null;
	}
	return null;
}
/**
* Re-resolves filesystem targets immediately before execution. Lexical scope
* checks alone are insufficient because a path inside the workspace may be a
* symlink to data outside it. Mutable targets also reject every symlink path
* component and existing hard-linked files.
*/
async function validateTaskToolFilesystemScope(input) {
	if (!isAbsolute(input.workspacePath) || resolve(input.workspacePath) !== input.workspacePath || !isRecord$3(input.arguments)) return false;
	const targetInput = filesystemTarget(input.toolName, input.arguments);
	if (targetInput === null) return true;
	let root;
	try {
		root = await realpath(input.workspacePath);
	} catch {
		return false;
	}
	if (root !== input.workspacePath) return false;
	const target = resolve(root, targetInput.path);
	if (!contained(root, target)) return false;
	if (!targetInput.mutable) try {
		return contained(root, await realpath(target));
	} catch {
		return false;
	}
	const pathFromRoot = relative(root, target);
	if (pathFromRoot === "") return false;
	let current = root;
	const segments = pathFromRoot.split(sep);
	for (let index = 0; index < segments.length; index += 1) {
		current = join(current, segments[index]);
		let info;
		try {
			info = await lstat(current);
		} catch (error) {
			if (error.code === "ENOENT") return true;
			return false;
		}
		if (info.isSymbolicLink()) return false;
		let resolved;
		try {
			resolved = await realpath(current);
		} catch {
			return false;
		}
		if (!contained(root, resolved)) return false;
		if (index === segments.length - 1 && info.isFile() && info.nlink > 1) return false;
	}
	return true;
}
function capabilityFor(toolName) {
	if (toolName === "write" || toolName === "edit") return "workspace-mutation";
	if (toolName === "bash" || toolName === "pwsh") return "command-execution";
	if (toolName === "web_search" || toolName === "web_fetch") return "network-access";
	return null;
}
function denied(reason, argumentsDigest) {
	return {
		decision: "deny",
		capability: null,
		argumentsDigest,
		reason
	};
}
function classifyTaskToolCall(input) {
	if (!hasValidLocalDigest(input.policy)) return denied("invalid-policy", null);
	if (!isAbsolute(input.workspacePath) || resolve(input.workspacePath) !== input.workspacePath || !isRecord$3(input.arguments)) return denied("invalid-arguments", null);
	let argumentsDigest;
	try {
		argumentsDigest = digestToolArguments(input.arguments, input.policy.maxArgumentsBytes);
	} catch (error) {
		return denied(error instanceof WorkerPolicyError && error.code === "arguments-too-large" ? "arguments-too-large" : "invalid-arguments", null);
	}
	if (input.policy.hardDeniedTools.includes(input.toolName)) return denied("hard-denied-tool", argumentsDigest);
	const isSafe = input.policy.safeTools.includes(input.toolName);
	const needsApproval = input.policy.approvalRequiredTools.includes(input.toolName);
	if (!isSafe && !needsApproval) return denied(Object.values(LOCAL_TASK_POLICIES).some((policy) => policy.safeTools.includes(input.toolName) || policy.approvalRequiredTools.includes(input.toolName) || policy.hardDeniedTools.includes(input.toolName)) ? "not-permitted-by-policy" : "unknown-tool", argumentsDigest);
	if (!workspaceScopedToolArguments(input.toolName, input.arguments, input.workspacePath)) return denied("workspace-scope-denied", argumentsDigest);
	if ((input.toolName === "bash" || input.toolName === "pwsh") && input.arguments.run_in_background === true) return denied("background-execution-denied", argumentsDigest);
	if (Object.hasOwn(input.arguments, "sandbox_permissions") || Object.hasOwn(input.arguments, "justification")) return denied("permission-escalation-denied", argumentsDigest);
	if (isSafe) return {
		decision: "safe",
		capability: null,
		argumentsDigest,
		reason: "safe-read"
	};
	const capability = capabilityFor(input.toolName);
	if (capability === null) return denied("invalid-policy", argumentsDigest);
	return {
		decision: "ask",
		capability,
		argumentsDigest,
		reason: "signed-approval-required"
	};
}
function record(value, keys, field) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(field + " must be an object");
	const raw = value;
	const actual = Object.keys(raw).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(field + " has unsupported or missing fields");
	return raw;
}
function text$1(value, field, max = 128) {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > max || /[\r\n\0]/.test(value)) throw new TypeError(field + " must be bounded text");
	return value;
}
function id(value, field, prefix) {
	const result = text$1(value, field, 64);
	if (!new RegExp("^" + prefix + ":[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").test(result)) throw new TypeError(field + " must be a namespaced UUID");
	return result;
}
function digest$2(value, field) {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new TypeError(field + " must be a SHA-256 digest");
	return value;
}
function timestamp(value, field) {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) throw new TypeError(field + " must be a canonical timestamp");
	return value;
}
function parseTaskApprovalIntent(value) {
	const raw = record(value, [
		"schemaVersion",
		"approvalId",
		"taskId",
		"taskBindingDigest",
		"executionProfileHash",
		"toolCallId",
		"toolName",
		"arguments",
		"argumentsDigest",
		"capability",
		"expiresAt"
	], "task approval intent");
	if (raw.schemaVersion !== 2 || raw.capability !== "workspace-mutation" && raw.capability !== "command-execution" && raw.capability !== "network-access") throw new TypeError("task approval intent schema or capability is invalid");
	if (typeof raw.arguments !== "object" || raw.arguments === null || Array.isArray(raw.arguments)) throw new TypeError("task approval intent arguments must be an object");
	const argumentsDigest = digest$2(raw.argumentsDigest, "argumentsDigest");
	if (digestToolArguments(raw.arguments) !== argumentsDigest) throw new TypeError("task approval intent arguments digest does not match");
	return {
		schemaVersion: 2,
		approvalId: id(raw.approvalId, "approvalId", "approval"),
		taskId: id(raw.taskId, "taskId", "task"),
		taskBindingDigest: digest$2(raw.taskBindingDigest, "taskBindingDigest"),
		executionProfileHash: digest$2(raw.executionProfileHash, "executionProfileHash"),
		toolCallId: text$1(raw.toolCallId, "toolCallId"),
		toolName: text$1(raw.toolName, "toolName", 64),
		arguments: raw.arguments,
		argumentsDigest,
		capability: raw.capability,
		expiresAt: timestamp(raw.expiresAt, "expiresAt")
	};
}
function approvalSegment(approvalId) {
	return id(approvalId, "approvalId", "approval").slice(9);
}
const FLEET_A2A_KINDS = [
	"task.submit",
	"task.status",
	"task.cancel",
	"task.progress",
	"task.result",
	"task.approval.request",
	"task.approval.decision",
	"approval.request",
	"approval.decision",
	"handoff",
	"receipt"
];
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
const RECIPIENT_KEYS = ["teamId", "deviceId"];
const MAX_PAYLOAD_BYTES = 49152;
const DEFAULT_TTL_MS = 3e5;
const DEFAULT_MAX_TTL_MS = 9e5;
const ABSOLUTE_MAX_TTL_MS = 864e5;
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys$2(value, keys, field) {
	if (!isRecord$2(value)) throw new FleetA2AError("invalid-envelope", field + " must be an object");
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new FleetA2AError("invalid-envelope", field + " has unsupported or missing fields");
}
function text(value, field, maxLength = 128) {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > maxLength || /[\r\n\0]/.test(value)) throw new FleetA2AError("invalid-payload", field + " must be a bounded trimmed string");
	return value;
}
function longText(value, field, maxLength) {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength || value.includes("\0")) throw new FleetA2AError("invalid-payload", field + " must be bounded non-empty text");
	return value;
}
function identifier$1(value, field) {
	const result = text(value, field, 64);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(result)) throw new FleetA2AError("invalid-payload", field + " is invalid");
	return result;
}
function messageId$1(value, field, prefix) {
	const result = text(value, field, 64);
	if (!new RegExp("^" + prefix + ":[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").test(result)) throw new FleetA2AError("invalid-payload", field + " must be a namespaced UUID");
	return result;
}
function digest$1(value, field) {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new FleetA2AError("invalid-envelope", field + " must be a lowercase SHA-256 digest");
	return value;
}
function canonicalTime$1(value, field) {
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
	return messageId$1(value, "payload.taskId", "task");
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
		identifier$1(payload.workspaceId, "payload.workspaceId");
		identifier$1(payload.profile, "payload.profile");
		digest$1(payload.executionProfileHash, "payload.executionProfileHash");
		digest$1(payload.manifestDigest, "payload.manifestDigest");
		digest$1(payload.releaseDigest, "payload.releaseDigest");
		identifier$1(payload.policyId, "payload.policyId");
		digest$1(payload.policyDigest, "payload.policyDigest");
		canonicalTime$1(payload.deadline, "payload.deadline");
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
		canonicalTime$1(payload.updatedAt, "payload.updatedAt");
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
		canonicalTime$1(payload.updatedAt, "payload.updatedAt");
		if (payload.resultDigest !== null) digest$1(payload.resultDigest, "payload.resultDigest");
		if (payload.result !== null) longText(payload.result, "payload.result", 32768);
		if (typeof payload.truncated !== "boolean") throw new FleetA2AError("invalid-payload", "payload.truncated must be boolean");
		if (payload.errorCode !== null) identifier$1(payload.errorCode, "payload.errorCode");
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
		messageId$1(payload.approvalId, "payload.approvalId", "approval");
		taskId(payload.taskId);
		digest$1(payload.taskBindingDigest, "payload.taskBindingDigest");
		text(payload.toolCallId, "payload.toolCallId");
		identifier$1(payload.toolName, "payload.toolName");
		let argumentsDigest;
		try {
			argumentsDigest = digestToolArguments(payload.arguments, MAX_TASK_TOOL_ARGUMENT_BYTES);
		} catch {
			throw new FleetA2AError("invalid-payload", "task approval arguments must be a bounded canonical JSON object");
		}
		digest$1(payload.argumentsDigest, "payload.argumentsDigest");
		if (payload.argumentsDigest !== argumentsDigest) throw new FleetA2AError("invalid-payload", "task approval argumentsDigest does not match arguments");
		if (![
			"workspace-mutation",
			"command-execution",
			"network-access"
		].includes(text(payload.capability, "payload.capability", 32))) throw new FleetA2AError("invalid-payload", "task approval capability is invalid");
		longText(payload.summary, "payload.summary", 2048);
		canonicalTime$1(payload.expiresAt, "payload.expiresAt");
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
		messageId$1(payload.approvalId, "payload.approvalId", "approval");
		taskId(payload.taskId);
		messageId$1(payload.approvalRequestMessageId, "payload.approvalRequestMessageId", "msg");
		digest$1(payload.approvalRequestPayloadDigest, "payload.approvalRequestPayloadDigest");
		digest$1(payload.taskBindingDigest, "payload.taskBindingDigest");
		text(payload.toolCallId, "payload.toolCallId");
		digest$1(payload.argumentsDigest, "payload.argumentsDigest");
		if (!["allowed-once", "rejected"].includes(text(payload.decision, "payload.decision", 16))) throw new FleetA2AError("invalid-payload", "task approval decision is invalid");
		canonicalTime$1(payload.decidedAt, "payload.decidedAt");
		return;
	}
	if (kind === "approval.request") {
		exactPayload(payload, [
			"approvalId",
			"taskId",
			"summary",
			"expiresAt"
		], kind);
		messageId$1(payload.approvalId, "payload.approvalId", "approval");
		taskId(payload.taskId);
		longText(payload.summary, "payload.summary", 2048);
		canonicalTime$1(payload.expiresAt, "payload.expiresAt");
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
		messageId$1(payload.approvalId, "payload.approvalId", "approval");
		taskId(payload.taskId);
		messageId$1(payload.approvalRequestMessageId, "payload.approvalRequestMessageId", "msg");
		digest$1(payload.approvalRequestPayloadDigest, "payload.approvalRequestPayloadDigest");
		if (!["endorsed", "declined"].includes(text(payload.decision, "payload.decision", 16))) throw new FleetA2AError("invalid-payload", "federation approval decision is invalid");
		canonicalTime$1(payload.decidedAt, "payload.decidedAt");
		return;
	}
	if (kind === "receipt") {
		exactPayload(payload, ["requestMessageId", "status"], kind);
		messageId$1(payload.requestMessageId, "payload.requestMessageId", "msg");
		if (!["accepted", "stored"].includes(text(payload.status, "payload.status", 16))) throw new FleetA2AError("invalid-payload", "receipt status is invalid");
		return;
	}
	exactPayload(payload, [
		"handoffId",
		"taskId",
		"summary",
		"artifactRefs"
	], kind);
	messageId$1(payload.handoffId, "payload.handoffId", "handoff");
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
function nowIso$1(value) {
	const date = value === void 0 ? /* @__PURE__ */ new Date() : value instanceof Date ? new Date(value.getTime()) : new Date(value);
	if (!Number.isFinite(date.getTime())) throw new FleetA2AError("invalid-time", "now must be a valid timestamp");
	return date.toISOString();
}
function createA2AEnvelope(input) {
	if (!FLEET_A2A_KINDS.includes(input.kind)) throw new FleetA2AError("invalid-payload", "unsupported A2A kind");
	validateA2APayload(input.kind, input.payload);
	const key = privateKey(input.privateKey);
	const issuedAt = nowIso$1(input.now);
	const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
	boundedInteger(ttlMs, "ttlMs", 1e3, ABSOLUTE_MAX_TTL_MS);
	const body = {
		schemaVersion: 2,
		teamId: identifier$1(input.teamId, "teamId"),
		messageId: input.messageId === void 0 ? "msg:" + randomUUID() : messageId$1(input.messageId, "messageId", "msg"),
		sender: {
			principalId: identifier$1(input.sender.principalId, "sender.principalId"),
			deviceId: normalizeDeviceId(input.sender.deviceId, "sender.deviceId"),
			keyId: a2aKeyId(key)
		},
		recipient: {
			teamId: identifier$1(input.recipient.teamId ?? input.teamId, "recipient.teamId"),
			deviceId: normalizeDeviceId(input.recipient.deviceId, "recipient.deviceId")
		},
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
function trustEntry(trust, keyId) {
	if (typeof trust.get === "function") return trust.get(keyId);
	return trust[keyId];
}
function verifyA2AEnvelope(value, input) {
	exactKeys$2(value, ENVELOPE_KEYS, "A2A envelope");
	const envelope = value;
	if (envelope.schemaVersion !== 2 || !FLEET_A2A_KINDS.includes(envelope.kind)) throw new FleetA2AError("invalid-envelope", "unsupported A2A envelope version or kind");
	exactKeys$2(envelope.sender, SENDER_KEYS, "sender");
	exactKeys$2(envelope.recipient, RECIPIENT_KEYS, "recipient");
	identifier$1(envelope.teamId, "teamId");
	messageId$1(envelope.messageId, "messageId", "msg");
	identifier$1(envelope.sender.principalId, "sender.principalId");
	normalizeDeviceId(envelope.sender.deviceId, "sender.deviceId");
	identifier$1(envelope.recipient.teamId, "recipient.teamId");
	normalizeDeviceId(envelope.recipient.deviceId, "recipient.deviceId");
	if (!/^ed25519:[0-9a-f]{64}$/.test(envelope.sender.keyId)) throw new FleetA2AError("invalid-envelope", "sender.keyId is invalid");
	digest$1(envelope.payloadDigest, "payloadDigest");
	validateA2APayload(envelope.kind, envelope.payload);
	if (sha256Canonical(envelope.payload) !== envelope.payloadDigest) throw new FleetA2AError("signature-invalid", "A2A payload digest does not match");
	const issuedAt = canonicalTime$1(envelope.issuedAt, "issuedAt");
	const expiresAt = canonicalTime$1(envelope.expiresAt, "expiresAt");
	const now = Date.parse(nowIso$1(input.now));
	const maxTtlMs = input.maxTtlMs ?? DEFAULT_MAX_TTL_MS;
	boundedInteger(maxTtlMs, "maxTtlMs", 1e3, ABSOLUTE_MAX_TTL_MS);
	if (expiresAt <= issuedAt || expiresAt - issuedAt > maxTtlMs || issuedAt > now + 3e4) throw new FleetA2AError("invalid-time", "A2A envelope validity window is invalid");
	if (now >= expiresAt) throw new FleetA2AError("message-expired", "A2A envelope has expired");
	if (envelope.recipient.teamId !== input.expectedTeamId || envelope.recipient.deviceId !== input.expectedDeviceId) throw new FleetA2AError("recipient-mismatch", "A2A envelope targets a different team or device");
	if (envelope.teamId !== input.expectedTeamId && !isFleetFederationAdvisoryKind(envelope.kind)) throw new FleetA2AError("trust-denied", "foreign teams may send advisory federation messages only");
	const trusted = trustEntry(input.trust, envelope.sender.keyId);
	if (trusted === void 0 || trusted.teamId !== envelope.teamId || trusted.principalId !== envelope.sender.principalId || trusted.deviceId !== envelope.sender.deviceId || !trusted.allowedKinds.includes(envelope.kind)) throw new FleetA2AError("trust-denied", "A2A sender is not trusted for this message kind");
	if (a2aKeyId(trusted.publicKeyPem) !== trusted.keyId || trusted.keyId !== envelope.sender.keyId) throw new FleetA2AError("trust-denied", "A2A trust entry key identity is invalid");
	if (typeof envelope.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) throw new FleetA2AError("signature-invalid", "A2A signature encoding is invalid");
	const signature = Buffer.from(envelope.signature, "base64url");
	const body = Object.fromEntries(BODY_KEYS.map((key) => [key, envelope[key]]));
	if (!verify(null, Buffer.from(canonicalJson(body), "utf8"), publicKey(trusted.publicKeyPem), signature)) throw new FleetA2AError("signature-invalid", "A2A signature is invalid");
	return envelope;
}
//#endregion
//#region src/federation/inbox.ts
const INBOX_SCHEMA_VERSION = 1;
const ACK_SCHEMA_VERSION = 1;
const MAX_STATE_FILE_BYTES = 65536;
const MESSAGE_ID_PATTERN = /^msg:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const KEY_ID_PATTERN = /^ed25519:[0-9a-f]{64}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
var FleetFederationError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "FleetFederationError";
		this.code = code;
	}
};
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys$1(value, keys, field) {
	if (!isRecord$1(value)) throw new FleetFederationError("invalid-state", field + " must be an object");
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new FleetFederationError("invalid-state", field + " has unsupported or missing fields");
}
function identifier(value, field) {
	if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) throw new FleetFederationError("invalid-state", field + " is invalid");
	return value;
}
function messageId(value, field = "messageId") {
	if (typeof value !== "string" || !MESSAGE_ID_PATTERN.test(value)) throw new FleetFederationError("invalid-state", field + " is invalid");
	return value;
}
function digest(value, field) {
	if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) throw new FleetFederationError("invalid-state", field + " is invalid");
	return value;
}
function canonicalTime(value, field) {
	if (typeof value !== "string") throw new FleetFederationError("invalid-state", field + " is invalid");
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) throw new FleetFederationError("invalid-state", field + " is invalid");
	return value;
}
function nowIso(value) {
	const date = value === void 0 ? /* @__PURE__ */ new Date() : value instanceof Date ? new Date(value.getTime()) : new Date(value);
	if (!Number.isFinite(date.getTime())) throw new FleetFederationError("invalid-state", "time must be valid");
	return date.toISOString();
}
function stateRoot(value) {
	if (typeof value !== "string" || value.length === 0 || value.length > 1024 || value.includes("\0") || !isAbsolute(value) || normalize(value) !== value || value === "/") throw new FleetFederationError("unsafe-state-path", "federation inbox root must be a normalized absolute non-root path");
	return value;
}
function messageSegment(value) {
	const match = MESSAGE_ID_PATTERN.exec(value);
	if (match?.[1] === void 0) throw new FleetFederationError("invalid-state", "messageId is invalid");
	return match[1];
}
function inboxDirectory(rootDirectory) {
	return join(rootDirectory, "inbox");
}
function acknowledgementsDirectory(rootDirectory) {
	return join(rootDirectory, "acknowledgements");
}
function locksDirectory(rootDirectory) {
	return join(rootDirectory, "locks");
}
function inboxPath(rootDirectory, id) {
	return join(inboxDirectory(rootDirectory), messageSegment(id) + ".json");
}
function acknowledgementPath(rootDirectory, id) {
	return join(acknowledgementsDirectory(rootDirectory), messageSegment(id) + ".json");
}
function lockPath(rootDirectory, id) {
	return join(locksDirectory(rootDirectory), messageSegment(id) + ".lock");
}
function assertOwned(info, field) {
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new FleetFederationError("unsafe-state-permissions", field + " must be owned by the current user");
}
async function assertPrivateDirectory(path, field) {
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isDirectory()) throw new FleetFederationError("unsafe-state-path", field + " must be a real directory, not a symlink");
	assertOwned(info, field);
	if ((info.mode & 63) !== 0) throw new FleetFederationError("unsafe-state-permissions", field + " must be owner-only (0700)");
}
async function ensureLayout(rootValue) {
	const rootDirectory = stateRoot(rootValue);
	await mkdir(rootDirectory, {
		recursive: true,
		mode: 448
	});
	await assertPrivateDirectory(rootDirectory, "federation inbox root");
	for (const directory of [
		inboxDirectory(rootDirectory),
		acknowledgementsDirectory(rootDirectory),
		locksDirectory(rootDirectory)
	]) {
		await mkdir(directory, {
			recursive: true,
			mode: 448
		});
		await assertPrivateDirectory(directory, "federation inbox directory");
	}
	return rootDirectory;
}
async function readPrivateJson(path) {
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const info = await handle.stat();
		if (!info.isFile() || info.size > MAX_STATE_FILE_BYTES) throw new FleetFederationError("invalid-state", "federation state must be a bounded regular file");
		assertOwned(info, "federation state file");
		if ((info.mode & 63) !== 0) throw new FleetFederationError("unsafe-state-permissions", "federation state files must be owner-only (0600)");
		const source = await handle.readFile("utf8");
		try {
			return JSON.parse(source);
		} catch {
			throw new FleetFederationError("invalid-state", "federation state file must contain JSON");
		}
	} catch (error) {
		if (error.code === "ELOOP") throw new FleetFederationError("unsafe-state-path", "federation state files cannot be symlinks");
		throw error;
	} finally {
		await handle?.close();
	}
}
async function createExclusivePrivateJson(path, value) {
	const directory = path.slice(0, path.lastIndexOf("/"));
	const temporaryPath = join(directory, ".tmp-" + randomUUID());
	let handle;
	try {
		handle = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 384);
		await handle.writeFile(JSON.stringify(value, null, 2) + "\n", "utf8");
		await handle.sync();
		await handle.close();
		handle = void 0;
		try {
			await link(temporaryPath, path);
			return "created";
		} catch (error) {
			if (error.code === "EEXIST") return "exists";
			throw error;
		}
	} finally {
		await handle?.close();
		try {
			await unlink(temporaryPath);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
}
async function assertPrivateRegularFile(path, field) {
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isFile()) throw new FleetFederationError("unsafe-state-path", field + " must be a real regular file, not a symlink");
	assertOwned(info, field);
	if ((info.mode & 63) !== 0) throw new FleetFederationError("unsafe-state-permissions", field + " must be owner-only (0600)");
}
async function acquireMessageLock(rootDirectory, id) {
	const path = lockPath(rootDirectory, id);
	let handle;
	try {
		handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 384);
		await handle.writeFile(JSON.stringify({
			pid: process.pid,
			createdAt: (/* @__PURE__ */ new Date()).toISOString()
		}) + "\n", "utf8");
		await handle.sync();
	} catch (error) {
		const created = handle !== void 0;
		await handle?.close();
		if (created) try {
			await unlink(path);
		} catch (cleanupError) {
			if (cleanupError.code !== "ENOENT") throw cleanupError;
		}
		if (error.code === "EEXIST") {
			await assertPrivateRegularFile(path, "federation message lock");
			return null;
		}
		if (error.code === "ELOOP") throw new FleetFederationError("unsafe-state-path", "federation message lock cannot be a symlink");
		throw error;
	}
	await handle.close();
	return async () => {
		await assertPrivateRegularFile(path, "federation message lock");
		await unlink(path);
	};
}
function parseStoredEnvelope(value) {
	exactKeys$1(value, [
		"schemaVersion",
		"teamId",
		"messageId",
		"sender",
		"recipient",
		"kind",
		"issuedAt",
		"expiresAt",
		"payloadDigest",
		"payload",
		"signature"
	], "stored federation envelope");
	if (value.schemaVersion !== 2 || typeof value.kind !== "string" || !FLEET_A2A_KINDS.includes(value.kind) || !isFleetFederationAdvisoryKind(value.kind)) throw new FleetFederationError("invalid-state", "stored federation envelope schema or kind is invalid");
	exactKeys$1(value.sender, [
		"principalId",
		"deviceId",
		"keyId"
	], "stored federation sender");
	exactKeys$1(value.recipient, ["teamId", "deviceId"], "stored federation recipient");
	const teamId = identifier(value.teamId, "stored federation sender teamId");
	identifier(value.sender.principalId, "stored federation sender principalId");
	identifier(value.sender.deviceId, "stored federation sender deviceId");
	if (typeof value.sender.keyId !== "string" || !KEY_ID_PATTERN.test(value.sender.keyId)) throw new FleetFederationError("invalid-state", "stored federation sender keyId is invalid");
	const recipientTeamId = identifier(value.recipient.teamId, "stored federation recipient teamId");
	identifier(value.recipient.deviceId, "stored federation recipient deviceId");
	if (teamId === recipientTeamId) throw new FleetFederationError("invalid-state", "federation inbox accepts foreign-team messages only");
	messageId(value.messageId);
	const issuedAt = canonicalTime(value.issuedAt, "stored federation issuedAt");
	const expiresAt = canonicalTime(value.expiresAt, "stored federation expiresAt");
	if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new FleetFederationError("invalid-state", "stored federation validity window is invalid");
	const payloadDigest = digest(value.payloadDigest, "stored federation payloadDigest");
	try {
		validateA2APayload(value.kind, value.payload);
	} catch {
		throw new FleetFederationError("invalid-state", "stored federation payload is invalid");
	}
	if (sha256Canonical(value.payload) !== payloadDigest) throw new FleetFederationError("invalid-state", "stored federation payload digest does not match");
	if (typeof value.signature !== "string" || !SIGNATURE_PATTERN.test(value.signature)) throw new FleetFederationError("invalid-state", "stored federation signature is invalid");
	return value;
}
function parseFederationInboxRecord(value) {
	exactKeys$1(value, [
		"schemaVersion",
		"receivedAt",
		"envelope"
	], "federation inbox record");
	if (value.schemaVersion !== INBOX_SCHEMA_VERSION) throw new FleetFederationError("invalid-state", "federation inbox record schema is invalid");
	return {
		schemaVersion: INBOX_SCHEMA_VERSION,
		receivedAt: canonicalTime(value.receivedAt, "federation receivedAt"),
		envelope: parseStoredEnvelope(value.envelope)
	};
}
function parseFederationAcknowledgement(value) {
	exactKeys$1(value, [
		"schemaVersion",
		"messageId",
		"payloadDigest",
		"disposition",
		"acknowledgedAt"
	], "federation acknowledgement");
	if (value.schemaVersion !== ACK_SCHEMA_VERSION || value.disposition !== "acknowledged" && value.disposition !== "dismissed") throw new FleetFederationError("invalid-state", "federation acknowledgement schema or disposition is invalid");
	return {
		schemaVersion: ACK_SCHEMA_VERSION,
		messageId: messageId(value.messageId),
		payloadDigest: digest(value.payloadDigest, "federation acknowledgement payloadDigest"),
		disposition: value.disposition,
		acknowledgedAt: canonicalTime(value.acknowledgedAt, "federation acknowledgedAt")
	};
}
function verifyForeignFederationEnvelope(value, input) {
	const envelope = verifyA2AEnvelope(value, input);
	if (envelope.teamId === input.expectedTeamId || !isFleetFederationAdvisoryKind(envelope.kind)) throw new FleetFederationError("not-foreign-advisory", "federation inbox accepts verified foreign advisory messages only");
	return envelope;
}
async function receiveFederationEnvelope(input) {
	const receivedAt = nowIso(input.receivedAt ?? input.verification.now);
	const envelope = verifyForeignFederationEnvelope(input.value, {
		...input.verification,
		now: receivedAt
	});
	const path = inboxPath(await ensureLayout(input.rootDirectory), envelope.messageId);
	const record = {
		schemaVersion: INBOX_SCHEMA_VERSION,
		receivedAt,
		envelope
	};
	if (await createExclusivePrivateJson(path, record) === "created") return {
		status: "stored",
		record
	};
	const existing = parseFederationInboxRecord(await readPrivateJson(path));
	if (canonicalJson(existing.envelope) !== canonicalJson(envelope)) throw new FleetFederationError("message-conflict", "messageId is already bound to a different signed envelope");
	return {
		status: "duplicate",
		record: existing
	};
}
async function readInboxRecord(rootDirectory, id) {
	try {
		return parseFederationInboxRecord(await readPrivateJson(inboxPath(rootDirectory, id)));
	} catch (error) {
		if (error.code === "ENOENT") throw new FleetFederationError("message-not-found", "federation inbox message was not found");
		throw error;
	}
}
async function readAcknowledgement(rootDirectory, id) {
	try {
		return parseFederationAcknowledgement(await readPrivateJson(acknowledgementPath(rootDirectory, id)));
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
async function acknowledgeFederationMessage(input) {
	const rootDirectory = await ensureLayout(input.rootDirectory);
	const id = messageId(input.messageId);
	const expectedPayloadDigest = digest(input.expectedPayloadDigest, "expectedPayloadDigest");
	if (input.disposition !== "acknowledged" && input.disposition !== "dismissed") throw new FleetFederationError("invalid-state", "acknowledgement disposition is invalid");
	const release = await acquireMessageLock(rootDirectory, id);
	if (release === null) throw new FleetFederationError("message-busy", "federation message is being updated");
	try {
		const record = await readInboxRecord(rootDirectory, id);
		if (record.envelope.payloadDigest !== expectedPayloadDigest) throw new FleetFederationError("acknowledgement-conflict", "acknowledgement payload digest does not match the stored message");
		const acknowledgedAt = nowIso(input.acknowledgedAt);
		if (Date.parse(acknowledgedAt) < Date.parse(record.receivedAt)) throw new FleetFederationError("invalid-state", "acknowledgement cannot predate receipt");
		const acknowledgement = {
			schemaVersion: ACK_SCHEMA_VERSION,
			messageId: id,
			payloadDigest: expectedPayloadDigest,
			disposition: input.disposition,
			acknowledgedAt
		};
		const path = acknowledgementPath(rootDirectory, id);
		if (await createExclusivePrivateJson(path, acknowledgement) === "created") return {
			status: "acknowledged",
			acknowledgement
		};
		const existing = parseFederationAcknowledgement(await readPrivateJson(path));
		if (existing.messageId !== id || existing.payloadDigest !== expectedPayloadDigest || existing.disposition !== input.disposition) throw new FleetFederationError("acknowledgement-conflict", "the first federation acknowledgement is final");
		return {
			status: "duplicate",
			acknowledgement: existing
		};
	} finally {
		await release();
	}
}
async function existingPrivateDirectory(path, field) {
	try {
		await assertPrivateDirectory(path, field);
		return true;
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}
async function readAllFederationInbox(rootDirectory, now) {
	if (!await existingPrivateDirectory(rootDirectory, "federation inbox root") || !await existingPrivateDirectory(inboxDirectory(rootDirectory), "federation inbox directory")) return [];
	const hasAcknowledgements = await existingPrivateDirectory(acknowledgementsDirectory(rootDirectory), "federation acknowledgements directory");
	const entries = await readdir(inboxDirectory(rootDirectory), { withFileTypes: true });
	const records = [];
	for (const entry of entries) {
		if (!entry.isFile() || !/^[0-9a-f-]{36}\.json$/.test(entry.name)) continue;
		const record = parseFederationInboxRecord(await readPrivateJson(join(inboxDirectory(rootDirectory), entry.name)));
		if (entry.name !== messageSegment(record.envelope.messageId) + ".json") throw new FleetFederationError("invalid-state", "federation inbox filename does not match its message id");
		const acknowledgement = hasAcknowledgements ? await readAcknowledgement(rootDirectory, record.envelope.messageId) : null;
		if (acknowledgement !== null && (acknowledgement.messageId !== record.envelope.messageId || acknowledgement.payloadDigest !== record.envelope.payloadDigest)) throw new FleetFederationError("invalid-state", "federation acknowledgement does not match its inbox message");
		records.push({
			record,
			acknowledgement,
			expired: now >= Date.parse(record.envelope.expiresAt)
		});
	}
	records.sort((left, right) => {
		const time = Date.parse(right.record.receivedAt) - Date.parse(left.record.receivedAt);
		return time === 0 ? left.record.envelope.messageId.localeCompare(right.record.envelope.messageId) : time;
	});
	return records;
}
async function listFederationInbox(rootValue, options = {}) {
	const rootDirectory = stateRoot(rootValue);
	const now = Date.parse(nowIso(options.now));
	const limit = options.limit ?? 100;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new FleetFederationError("invalid-state", "federation inbox limit must be an integer from 1 to 500");
	return (await readAllFederationInbox(rootDirectory, now)).slice(0, limit);
}
/** All federation messages are merely stored; a receipt never means task or tool authorization. */
function federationReceiptPayload(record) {
	return {
		requestMessageId: record.envelope.messageId,
		status: "stored"
	};
}
function retentionInteger(value, field, min, max) {
	if (!Number.isSafeInteger(value) || value < min || value > max) throw new FleetFederationError("retention-invalid", `${field} must be an integer from ${min} to ${max}`);
	return value;
}
/**
* Pure retention planner. Unexpired messages and fresh unacknowledged
* messages are never selected, even if the inbox is above maxEntries.
*/
function planFederationInboxPrune(items, policy, nowValue = /* @__PURE__ */ new Date()) {
	const now = Date.parse(nowIso(nowValue));
	const acknowledgedRetentionMs = retentionInteger(policy.acknowledgedRetentionMs, "acknowledgedRetentionMs", 6e4, 31536e6);
	const expiredRetentionMs = retentionInteger(policy.expiredRetentionMs, "expiredRetentionMs", 6e4, 31536e6);
	const maxEntries = retentionInteger(policy.maxEntries, "maxEntries", 1, 1e5);
	const selected = /* @__PURE__ */ new Map();
	const ordered = [...items].sort((left, right) => Date.parse(left.record.receivedAt) - Date.parse(right.record.receivedAt));
	const seen = /* @__PURE__ */ new Set();
	for (const item of ordered) {
		const id = item.record.envelope.messageId;
		messageId(id);
		digest(item.record.envelope.payloadDigest, "retention payloadDigest");
		canonicalTime(item.record.receivedAt, "retention receivedAt");
		canonicalTime(item.record.envelope.expiresAt, "retention expiresAt");
		if (seen.has(id)) throw new FleetFederationError("invalid-state", "retention items must have unique message ids");
		seen.add(id);
		if (item.acknowledgement !== null && (item.acknowledgement.messageId !== id || item.acknowledgement.payloadDigest !== item.record.envelope.payloadDigest)) throw new FleetFederationError("invalid-state", "retention acknowledgement does not match its message");
		if (item.acknowledgement !== null) canonicalTime(item.acknowledgement.acknowledgedAt, "retention acknowledgedAt");
		const expired = now >= Date.parse(item.record.envelope.expiresAt);
		if (expired && item.acknowledgement !== null && now - Date.parse(item.acknowledgement.acknowledgedAt) >= acknowledgedRetentionMs) selected.set(id, {
			messageId: id,
			payloadDigest: item.record.envelope.payloadDigest,
			reason: "acknowledged-retention"
		});
		else if (expired && item.acknowledgement === null && now - Date.parse(item.record.envelope.expiresAt) >= expiredRetentionMs) selected.set(id, {
			messageId: id,
			payloadDigest: item.record.envelope.payloadDigest,
			reason: "expired-retention"
		});
	}
	let remaining = ordered.length - selected.size;
	if (remaining > maxEntries) for (const item of ordered) {
		if (remaining <= maxEntries) break;
		const id = item.record.envelope.messageId;
		if (selected.has(id)) continue;
		if (now < Date.parse(item.record.envelope.expiresAt)) continue;
		selected.set(id, {
			messageId: id,
			payloadDigest: item.record.envelope.payloadDigest,
			reason: "capacity"
		});
		remaining -= 1;
	}
	return ordered.flatMap((item) => {
		const candidate = selected.get(item.record.envelope.messageId);
		return candidate === void 0 ? [] : [candidate];
	});
}
function parsePruneCandidate(value) {
	exactKeys$1(value, [
		"messageId",
		"payloadDigest",
		"reason"
	], "federation prune candidate");
	if (value.reason !== "acknowledged-retention" && value.reason !== "expired-retention" && value.reason !== "capacity") throw new FleetFederationError("retention-invalid", "federation prune candidate reason is invalid");
	return {
		messageId: messageId(value.messageId, "federation prune candidate messageId"),
		payloadDigest: digest(value.payloadDigest, "federation prune candidate payloadDigest"),
		reason: value.reason
	};
}
async function deleteFederationInboxItem(rootDirectory, expected) {
	const id = expected.record.envelope.messageId;
	let currentRecord;
	try {
		currentRecord = await readInboxRecord(rootDirectory, id);
	} catch (error) {
		if (error instanceof FleetFederationError && error.code === "message-not-found") return false;
		throw error;
	}
	const currentAcknowledgement = await readAcknowledgement(rootDirectory, id);
	if (canonicalJson(currentRecord) !== canonicalJson(expected.record) || canonicalJson(currentAcknowledgement) !== canonicalJson(expected.acknowledgement)) return false;
	if (currentAcknowledgement !== null) {
		const path = acknowledgementPath(rootDirectory, id);
		await assertPrivateRegularFile(path, "federation acknowledgement");
		await unlink(path);
	}
	const path = inboxPath(rootDirectory, id);
	await assertPrivateRegularFile(path, "federation inbox record");
	await unlink(path);
	return true;
}
/**
* Applies only candidates that still occur in a freshly recomputed retention
* plan. Every message is locked, reread and compared before its fixed inbox
* and acknowledgement paths are removed. No caller-provided path is used.
*/
async function applyFederationInboxPrune(input) {
	const nowText = nowIso(input.now);
	const now = Date.parse(nowText);
	planFederationInboxPrune([], input.policy, nowText);
	if (!Array.isArray(input.candidates)) throw new FleetFederationError("retention-invalid", "federation prune candidates must be an array");
	const candidates = input.candidates.map(parsePruneCandidate);
	const seen = /* @__PURE__ */ new Set();
	for (const candidate of candidates) {
		if (seen.has(candidate.messageId)) throw new FleetFederationError("retention-invalid", "federation prune candidates must have unique message ids");
		seen.add(candidate.messageId);
	}
	if (candidates.length === 0) return {
		pruned: [],
		skipped: []
	};
	const rootDirectory = await ensureLayout(input.rootDirectory);
	const result = {
		pruned: [],
		skipped: []
	};
	for (const candidate of candidates) {
		const release = await acquireMessageLock(rootDirectory, candidate.messageId);
		if (release === null) {
			result.skipped.push({
				candidate,
				reason: "busy"
			});
			continue;
		}
		try {
			const items = await readAllFederationInbox(rootDirectory, now);
			const current = items.find((item) => item.record.envelope.messageId === candidate.messageId);
			if (current === void 0) {
				result.skipped.push({
					candidate,
					reason: "missing"
				});
				continue;
			}
			if (current.record.envelope.payloadDigest !== candidate.payloadDigest) {
				result.skipped.push({
					candidate,
					reason: "changed"
				});
				continue;
			}
			const planned = planFederationInboxPrune(items, input.policy, nowText).find((item) => item.messageId === candidate.messageId);
			if (planned === void 0) {
				result.skipped.push({
					candidate,
					reason: "not-eligible"
				});
				continue;
			}
			if (planned.payloadDigest !== candidate.payloadDigest || planned.reason !== candidate.reason) {
				result.skipped.push({
					candidate,
					reason: "plan-changed"
				});
				continue;
			}
			if (now < Date.parse(current.record.envelope.expiresAt)) {
				result.skipped.push({
					candidate,
					reason: "not-eligible"
				});
				continue;
			}
			if (!await deleteFederationInboxItem(rootDirectory, current)) {
				result.skipped.push({
					candidate,
					reason: "changed"
				});
				continue;
			}
			result.pruned.push(candidate);
		} finally {
			await release();
		}
	}
	return result;
}
function safeFederationError(error) {
	const raw = typeof error.code === "string" ? error.code : "internal";
	const messages = {
		"not-foreign-advisory": "only signed foreign advisory messages are accepted",
		"invalid-state": "federation inbox state or request is invalid",
		"unsafe-state-path": "federation inbox contains an unsafe path",
		"unsafe-state-permissions": "federation inbox permissions are unsafe",
		"message-conflict": "federation message id is already bound to different content",
		"acknowledgement-conflict": "the first federation acknowledgement is final",
		"message-not-found": "federation message was not found",
		"message-busy": "federation message is being updated",
		"retention-invalid": "federation retention request is invalid"
	};
	return Object.hasOwn(messages, raw) ? {
		code: raw,
		message: messages[raw]
	} : {
		code: "internal",
		message: "federation request failed"
	};
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
function readStoredReceipt(value, envelope) {
	const raw = stateRecord(value, [
		"schemaVersion",
		"requestEnvelopeDigest",
		"receiptDigest",
		"receipt"
	], "A2A receipt state");
	if (raw.schemaVersion !== 1 || typeof raw.requestEnvelopeDigest !== "string" || !/^[0-9a-f]{64}$/.test(raw.requestEnvelopeDigest) || typeof raw.receiptDigest !== "string" || !/^[0-9a-f]{64}$/.test(raw.receiptDigest)) throw new FleetA2ARuntimeError("receipt-state-invalid", "A2A receipt state is invalid or legacy-unbound");
	if (raw.requestEnvelopeDigest !== sha256Canonical(envelope)) throw new FleetA2ARuntimeError("message-id-conflict", "A2A message id is already bound to a different signed envelope");
	const receiptRaw = stateRecord(raw.receipt, ["requestMessageId", "response"], "A2A receipt");
	if (receiptRaw.requestMessageId !== envelope.messageId || sha256Canonical(raw.receipt) !== raw.receiptDigest || typeof receiptRaw.response !== "object" || receiptRaw.response === null || Array.isArray(receiptRaw.response)) throw new FleetA2ARuntimeError("receipt-state-invalid", "A2A receipt state does not match its request");
	const response = receiptRaw.response;
	try {
		validateA2APayload(response.kind, response.payload);
	} catch {
		throw new FleetA2ARuntimeError("receipt-state-invalid", "A2A receipt response payload is invalid");
	}
	if (response.recipient?.teamId !== envelope.teamId || response.recipient.deviceId !== envelope.sender.deviceId) throw new FleetA2ARuntimeError("receipt-state-invalid", "A2A receipt response targets another sender");
	return raw.receipt;
}
function storedReceipt(envelope, receipt) {
	return {
		schemaVersion: 1,
		requestEnvelopeDigest: sha256Canonical(envelope),
		receiptDigest: sha256Canonical(receipt),
		receipt
	};
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
async function exclusiveJson(path, value) {
	await ensureDirectory(dirname(path));
	let handle;
	try {
		handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 384);
		await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
		await handle.sync();
	} catch (error) {
		if (error.code === "ELOOP") throw new FleetA2ARuntimeError("unsafe-state-file", "A2A state accepts regular files only");
		throw error;
	} finally {
		await handle?.close();
	}
}
async function readRegularFile(path, privateFile = false) {
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		const info = await handle.stat();
		if (!info.isFile()) throw new FleetA2ARuntimeError("unsafe-state-file", "A2A state accepts regular files only");
		if (privateFile && ((info.mode & 63) !== 0 || typeof process.getuid === "function" && info.uid !== process.getuid())) throw new FleetA2ARuntimeError("unsafe-state-permissions", "private A2A state must be owner-only and owned by the current user");
		return await handle.readFile("utf8");
	} catch (error) {
		if (error.code === "ELOOP") throw new FleetA2ARuntimeError("unsafe-state-file", "A2A state accepts regular files only");
		throw error;
	} finally {
		await handle?.close();
	}
}
function exactKeys(value, keys, field) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new FleetA2ARuntimeError("invalid-config", field + " must be an object");
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new FleetA2ARuntimeError("invalid-config", field + " has unsupported or missing fields");
}
async function readA2ATrustStore(config) {
	const raw = JSON.parse(await readRegularFile(config.a2a.trustStorePath));
	exactKeys(raw, [
		"schemaVersion",
		"teamId",
		"entries"
	], "trust store");
	if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2 || raw.teamId !== config.a2a.teamId || !Array.isArray(raw.entries)) throw new FleetA2ARuntimeError("invalid-config", "trust store schema or team identity is invalid");
	const trust = /* @__PURE__ */ new Map();
	for (let index = 0; index < raw.entries.length; index += 1) {
		const entry = raw.entries[index];
		exactKeys(entry, raw.schemaVersion === 1 ? [
			"keyId",
			"principalId",
			"deviceId",
			"publicKeyPem",
			"allowedKinds"
		] : [
			"teamId",
			"keyId",
			"principalId",
			"deviceId",
			"publicKeyPem",
			"allowedKinds"
		], `trust store entries[${index}]`);
		if (typeof entry.keyId !== "string" || typeof entry.principalId !== "string" || typeof entry.deviceId !== "string" || typeof entry.publicKeyPem !== "string" || !Array.isArray(entry.allowedKinds) || entry.allowedKinds.some((kind) => typeof kind !== "string" || !FLEET_A2A_KINDS.includes(kind))) throw new FleetA2ARuntimeError("invalid-config", "trust store entry is invalid");
		const senderTeamId = raw.schemaVersion === 1 ? config.a2a.teamId : entry.teamId;
		if (typeof senderTeamId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(senderTeamId) || !/^ed25519:[0-9a-f]{64}$/.test(entry.keyId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.principalId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.deviceId) || new Set(entry.allowedKinds).size !== entry.allowedKinds.length) throw new FleetA2ARuntimeError("invalid-config", "trust store entry identity or capabilities are invalid");
		try {
			if (a2aKeyId(entry.publicKeyPem) !== entry.keyId) throw new Error("key mismatch");
		} catch {
			throw new FleetA2ARuntimeError("invalid-config", "trust store entry key identity is invalid");
		}
		if (trust.has(entry.keyId)) throw new FleetA2ARuntimeError("invalid-config", "trust store key ids must be unique");
		trust.set(entry.keyId, {
			...entry,
			teamId: senderTeamId
		});
	}
	return trust;
}
async function privateKeyPem(config) {
	return readRegularFile(config.a2a.privateKeyPath, true);
}
async function signA2AMessage(config, recipientDeviceId, kind, payload, now = /* @__PURE__ */ new Date(), recipientTeamId) {
	assertA2AReadyConfig(config);
	const ttlMs = messageTtlMs(config, kind, payload, now, recipientTeamId !== void 0 && recipientTeamId !== config.a2a.teamId);
	return createA2AEnvelope({
		teamId: config.a2a.teamId,
		sender: {
			principalId: config.a2a.principalId,
			deviceId: config.deviceId
		},
		recipient: {
			teamId: recipientTeamId ?? config.a2a.teamId,
			deviceId: recipientDeviceId
		},
		kind,
		payload,
		privateKey: await privateKeyPem(config),
		now,
		ttlMs
	});
}
function messageTtlMs(config, kind, payload, now, foreign) {
	const shortTtlMs = Math.min(3e5, config.a2a.maxMessageTtlMs);
	if (!foreign || !isFleetFederationAdvisoryKind(kind)) return shortTtlMs;
	if (kind !== "approval.request") return config.a2a.maxMessageTtlMs;
	const remainingMs = (typeof payload.expiresAt === "string" ? Date.parse(payload.expiresAt) : NaN) - now.getTime();
	if (!Number.isFinite(remainingMs) || remainingMs < 1e3) throw new FleetA2ARuntimeError("message-expired", "federation approval request expires too soon to sign");
	return Math.min(config.a2a.maxMessageTtlMs, remainingMs);
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
	const schema = typeof value === "object" && value !== null && !Array.isArray(value) ? value.schemaVersion : void 0;
	const legacy = schema === 1;
	const executionBound = schema === 3;
	const raw = stateRecord(value, legacy ? [
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
	] : executionBound ? [
		"schemaVersion",
		"taskId",
		"requestMessageId",
		"senderDeviceId",
		"senderPrincipalId",
		"senderKeyId",
		"workspaceId",
		"workspacePath",
		"profile",
		"executionProfileHash",
		"promptDigest",
		"manifestDigest",
		"releaseDigest",
		"policyId",
		"policyDigest",
		"taskBindingDigest",
		"state",
		"createdAt",
		"updatedAt",
		"deadlineAt",
		"resultDigest",
		"errorCode"
	] : [
		"schemaVersion",
		"taskId",
		"requestMessageId",
		"senderDeviceId",
		"senderPrincipalId",
		"senderKeyId",
		"workspaceId",
		"workspacePath",
		"profile",
		"promptDigest",
		"manifestDigest",
		"releaseDigest",
		"policyId",
		"policyDigest",
		"taskBindingDigest",
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
	if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2 && raw.schemaVersion !== 3 || taskId !== expectedTaskId || !TASK_STATES.has(state)) throw new FleetA2ARuntimeError("invalid-task-state", "task record identity, schema or state is invalid");
	const errorCode = raw.errorCode === null ? null : stateText(raw.errorCode, "task record.errorCode", 64);
	return {
		schemaVersion: raw.schemaVersion,
		taskId,
		requestMessageId: stateText(raw.requestMessageId, "task record.requestMessageId", 64),
		senderDeviceId: stateText(raw.senderDeviceId, "task record.senderDeviceId", 64),
		senderPrincipalId: stateText(raw.senderPrincipalId, "task record.senderPrincipalId", 64),
		senderKeyId: legacy ? null : stateText(raw.senderKeyId, "task record.senderKeyId", 80),
		workspaceId: stateText(raw.workspaceId, "task record.workspaceId", 64),
		workspacePath: legacy ? null : stateText(raw.workspacePath, "task record.workspacePath", 4096),
		profile: stateText(raw.profile, "task record.profile", 64),
		executionProfileHash: executionBound ? stateDigest(raw.executionProfileHash, "task record.executionProfileHash") : null,
		promptDigest: stateDigest(raw.promptDigest, "task record.promptDigest"),
		manifestDigest: legacy ? null : stateDigest(raw.manifestDigest, "task record.manifestDigest"),
		releaseDigest: legacy ? null : stateDigest(raw.releaseDigest, "task record.releaseDigest"),
		policyId: legacy ? null : stateText(raw.policyId, "task record.policyId", 64),
		policyDigest: legacy ? null : stateDigest(raw.policyDigest, "task record.policyDigest"),
		taskBindingDigest: legacy ? null : stateDigest(raw.taskBindingDigest, "task record.taskBindingDigest"),
		state,
		createdAt: stateTime(raw.createdAt, "task record.createdAt"),
		updatedAt: stateTime(raw.updatedAt, "task record.updatedAt"),
		deadlineAt: stateTime(raw.deadlineAt, "task record.deadlineAt"),
		resultDigest: stateDigest(raw.resultDigest, "task record.resultDigest", true),
		errorCode
	};
}
function parseTaskRequest(value, expectedTaskId) {
	const schema = typeof value === "object" && value !== null && !Array.isArray(value) ? value.schemaVersion : void 0;
	const legacy = schema === 1;
	const executionBound = schema === 3;
	const raw = stateRecord(value, legacy ? [
		"schemaVersion",
		"taskId",
		"requestMessageId",
		"senderDeviceId",
		"senderPrincipalId",
		"workspaceId",
		"profile",
		"promptDigest",
		"prompt"
	] : executionBound ? [
		"schemaVersion",
		"taskId",
		"requestMessageId",
		"senderDeviceId",
		"senderPrincipalId",
		"senderKeyId",
		"workspaceId",
		"workspacePath",
		"profile",
		"executionProfileHash",
		"promptDigest",
		"manifestDigest",
		"releaseDigest",
		"policyId",
		"policyDigest",
		"taskBindingDigest",
		"deadline",
		"prompt"
	] : [
		"schemaVersion",
		"taskId",
		"requestMessageId",
		"senderDeviceId",
		"senderPrincipalId",
		"senderKeyId",
		"workspaceId",
		"workspacePath",
		"profile",
		"promptDigest",
		"manifestDigest",
		"releaseDigest",
		"policyId",
		"policyDigest",
		"taskBindingDigest",
		"deadline",
		"prompt"
	], "task request");
	if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2 && raw.schemaVersion !== 3 || raw.taskId !== expectedTaskId || typeof raw.prompt !== "string" || raw.prompt.length === 0 || raw.prompt.includes("\0")) throw new FleetA2ARuntimeError("invalid-task-state", "task request identity, schema or prompt is invalid");
	const promptDigest = stateDigest(raw.promptDigest, "task request.promptDigest");
	if (hash(raw.prompt) !== promptDigest) throw new FleetA2ARuntimeError("invalid-task-state", "task request prompt digest is invalid");
	return {
		schemaVersion: raw.schemaVersion,
		taskId: expectedTaskId,
		requestMessageId: stateText(raw.requestMessageId, "task request.requestMessageId", 64),
		senderDeviceId: stateText(raw.senderDeviceId, "task request.senderDeviceId", 64),
		senderPrincipalId: stateText(raw.senderPrincipalId, "task request.senderPrincipalId", 64),
		senderKeyId: legacy ? null : stateText(raw.senderKeyId, "task request.senderKeyId", 80),
		workspaceId: stateText(raw.workspaceId, "task request.workspaceId", 64),
		workspacePath: legacy ? null : stateText(raw.workspacePath, "task request.workspacePath", 4096),
		profile: stateText(raw.profile, "task request.profile", 64),
		executionProfileHash: executionBound ? stateDigest(raw.executionProfileHash, "task request.executionProfileHash") : null,
		promptDigest,
		manifestDigest: legacy ? null : stateDigest(raw.manifestDigest, "task request.manifestDigest"),
		releaseDigest: legacy ? null : stateDigest(raw.releaseDigest, "task request.releaseDigest"),
		policyId: legacy ? null : stateText(raw.policyId, "task request.policyId", 64),
		policyDigest: legacy ? null : stateDigest(raw.policyDigest, "task request.policyDigest"),
		taskBindingDigest: legacy ? null : stateDigest(raw.taskBindingDigest, "task request.taskBindingDigest"),
		deadline: legacy ? null : stateTime(raw.deadline, "task request.deadline"),
		prompt: raw.prompt
	};
}
async function readTaskRecord(config, taskId) {
	try {
		return parseTaskRecord(JSON.parse(await readRegularFile(join(taskDirectory(config, taskId), "record.json"))), taskId);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
async function taskDirectoryEntries(config) {
	const root = join(config.stateDir, "tasks");
	let info;
	try {
		info = await lstat(root);
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	if (info.isSymbolicLink() || !info.isDirectory()) throw new FleetA2ARuntimeError("unsafe-state-file", "task state root must be a real directory");
	if ((info.mode & 63) !== 0) throw new FleetA2ARuntimeError("unsafe-state-permissions", "task state root must be owner-only");
	return (await readdir(root, { withFileTypes: true })).flatMap((entry) => entry.isDirectory() && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entry.name) ? [{ name: entry.name }] : []);
}
async function listFleetTasks(config, limit = 50, now = /* @__PURE__ */ new Date()) {
	assertA2AReadyConfig(config);
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new FleetA2ARuntimeError("invalid-payload", "task list limit must be an integer from 1 to 100");
	const tasks = (await Promise.all((await taskDirectoryEntries(config)).map(async (entry) => readTaskRecord(config, "task:" + entry.name)))).flatMap((record) => record === null ? [] : [{
		taskId: record.taskId,
		state: record.state,
		targetDeviceId: config.deviceId,
		workspaceId: record.workspaceId,
		profile: record.profile,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		errorCode: record.errorCode,
		resultDigest: record.resultDigest
	}]).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.taskId.localeCompare(left.taskId)).slice(0, limit);
	return {
		generatedAt: now.toISOString(),
		tasks
	};
}
async function pruneFleetTasks(config, input) {
	assertA2AReadyConfig(config);
	const olderThanMs = Date.parse(input.olderThan);
	if (!Number.isFinite(olderThanMs) || new Date(olderThanMs).toISOString() !== input.olderThan) throw new FleetA2ARuntimeError("invalid-payload", "tasks prune olderThan must be a canonical timestamp");
	const allowed = /* @__PURE__ */ new Set([
		"succeeded",
		"failed",
		"cancelled"
	]);
	if (!Array.isArray(input.states) || input.states.length === 0 || input.states.length > allowed.size || input.states.some((state) => !allowed.has(state)) || new Set(input.states).size !== input.states.length) throw new FleetA2ARuntimeError("invalid-payload", "tasks prune states must be unique terminal task states");
	const selected = new Set(input.states);
	let pruned = 0;
	let skippedActive = 0;
	for (const entry of await taskDirectoryEntries(config)) {
		const taskId = "task:" + entry.name;
		const record = await readTaskRecord(config, taskId);
		if (record === null || Date.parse(record.updatedAt) >= olderThanMs) continue;
		if (!selected.has(record.state)) {
			if (!allowed.has(record.state)) skippedActive += 1;
			continue;
		}
		if (await processLockActive(join(taskDirectory(config, taskId), "worker.lock"))) {
			skippedActive += 1;
			continue;
		}
		await rm(taskDirectory(config, taskId), {
			recursive: true,
			force: false
		});
		pruned += 1;
	}
	return {
		pruned,
		skippedActive
	};
}
async function readTaskRequest(config, taskId) {
	try {
		return parseTaskRequest(JSON.parse(await readRegularFile(join(taskDirectory(config, taskId), "request.json"))), taskId);
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
		result = await readRegularFile(join(taskDirectory(config, taskId), "result.txt"));
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
function processLockToken(source) {
	try {
		const owner = JSON.parse(source);
		return typeof owner.token === "string" ? owner.token : null;
	} catch {
		return null;
	}
}
async function readProcessLockSnapshot(path) {
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		const info = await handle.stat();
		if (!info.isFile()) throw new FleetA2ARuntimeError("unsafe-state-file", "A2A lock must be a regular file");
		const source = await handle.readFile("utf8");
		return {
			source,
			token: processLockToken(source),
			dev: info.dev,
			ino: info.ino,
			mtimeMs: info.mtimeMs
		};
	} catch (error) {
		if (error.code === "ENOENT") return null;
		if (error.code === "ELOOP") throw new FleetA2ARuntimeError("unsafe-state-file", "A2A lock must not be a symbolic link");
		throw error;
	} finally {
		await handle?.close();
	}
}
async function observeProcessLock(path) {
	const snapshot = await readProcessLockSnapshot(path);
	if (snapshot === null) return { state: "missing" };
	try {
		const owner = JSON.parse(snapshot.source);
		if (typeof owner.pid === "number" && Number.isSafeInteger(owner.pid) && owner.pid > 0 && snapshot.token !== null) return await processAlive(owner.pid) ? { state: "active" } : {
			state: "stale",
			snapshot
		};
	} catch {}
	return Date.now() - snapshot.mtimeMs > 3e4 ? {
		state: "stale",
		snapshot
	} : { state: "active" };
}
function sameProcessLockIdentity(snapshot, expected) {
	return snapshot !== null && snapshot.dev === expected.dev && snapshot.ino === expected.ino && snapshot.source === expected.source && snapshot.token === expected.token;
}
async function casUnlinkProcessLock(path, expected) {
	const claimPath = path + ".reap-" + hash(expected.source);
	try {
		await link(path, claimPath);
	} catch (error) {
		if (error.code === "ENOENT" || error.code === "EEXIST") return false;
		throw error;
	}
	try {
		const [claimed, current] = await Promise.all([readProcessLockSnapshot(claimPath), readProcessLockSnapshot(path)]);
		if (!sameProcessLockIdentity(claimed, expected) || !sameProcessLockIdentity(current, expected)) return false;
		await rm(path);
		return true;
	} finally {
		await rm(claimPath, { force: true });
	}
}
async function reclaimStaleProcessLock(path, observation, hooks) {
	await hooks?.beforeStaleLockClaim?.(path);
	return casUnlinkProcessLock(path, observation.snapshot);
}
async function createProcessLock(path, fields = {}) {
	const token = randomUUID();
	let handle;
	let createdLock;
	try {
		handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 384);
		const info = await handle.stat();
		const source = JSON.stringify({
			...fields,
			pid: process.pid,
			token,
			at: (/* @__PURE__ */ new Date()).toISOString()
		}) + "\n";
		createdLock = {
			path,
			source,
			token,
			dev: info.dev,
			ino: info.ino
		};
		await handle.writeFile(source);
		await handle.sync();
		return createdLock;
	} catch (error) {
		if (error.code === "EEXIST") return null;
		if (createdLock !== void 0) try {
			await releaseProcessLock(createdLock);
		} catch {}
		throw error;
	} finally {
		await handle?.close();
	}
}
async function acquireProcessLock(path, busyCode, busyMessage, hooks) {
	await ensureDirectory(dirname(path));
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const created = await createProcessLock(path);
		if (created !== null) return created;
		const observation = await observeProcessLock(path);
		if (observation.state === "missing") continue;
		if (observation.state === "active") throw new FleetA2ARuntimeError(busyCode, busyMessage);
		if (!await reclaimStaleProcessLock(path, observation, hooks)) {
			if ((await observeProcessLock(path)).state === "active") throw new FleetA2ARuntimeError(busyCode, busyMessage);
		}
	}
	throw new FleetA2ARuntimeError(busyCode, busyMessage);
}
async function releaseProcessLock(lock) {
	try {
		const snapshot = await readProcessLockSnapshot(lock.path);
		if (snapshot === null || !sameProcessLockIdentity(snapshot, lock)) return;
		await casUnlinkProcessLock(lock.path, snapshot);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
}
async function processLockActive(path) {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const observation = await observeProcessLock(path);
		if (observation.state === "missing") return false;
		if (observation.state === "active") return true;
		if (await reclaimStaleProcessLock(path, observation)) return false;
	}
	return true;
}
function taskMatchesEnvelope(record, envelope, payload) {
	if (record.schemaVersion !== 3 || record.workspacePath === null || record.executionProfileHash === null || record.taskBindingDigest === null) return false;
	let binding;
	try {
		binding = createTaskBindingDigest({
			teamId: envelope.teamId,
			submitMessageId: envelope.messageId,
			submitPayloadDigest: envelope.payloadDigest,
			sender: envelope.sender,
			recipientDeviceId: envelope.recipient.deviceId,
			taskId: payload.taskId,
			workspaceId: payload.workspaceId,
			workspacePath: record.workspacePath,
			profile: payload.profile,
			executionProfileHash: payload.executionProfileHash,
			manifestDigest: payload.manifestDigest,
			releaseDigest: payload.releaseDigest,
			policyId: payload.policyId,
			policyDigest: payload.policyDigest,
			deadline: payload.deadline
		});
	} catch {
		return false;
	}
	return record.promptDigest === hash(payload.prompt) && record.senderDeviceId === envelope.sender.deviceId && record.senderPrincipalId === envelope.sender.principalId && record.senderKeyId === envelope.sender.keyId && record.workspaceId === payload.workspaceId && record.profile === payload.profile && record.executionProfileHash === payload.executionProfileHash && record.manifestDigest === payload.manifestDigest && record.releaseDigest === payload.releaseDigest && record.policyId === payload.policyId && record.policyDigest === payload.policyDigest && record.deadlineAt === payload.deadline && record.taskBindingDigest === binding;
}
async function taskWorkspace(config, workspaceId) {
	const configured = config.tasks.workspaces[workspaceId];
	if (configured === void 0) throw new FleetA2ARuntimeError("task-policy-denied", "task workspace is not allowed by local policy");
	const info = await lstat(configured).catch(() => void 0);
	if (info === void 0 || info.isSymbolicLink() || !info.isDirectory()) throw new FleetA2ARuntimeError("task-policy-denied", "task workspace must be an existing real directory");
	return realpath(configured);
}
async function assertTaskReleaseBinding(config, manifestDigest, releaseDigest) {
	if (hash(await readRegularFile(config.manifestPath)) !== manifestDigest) throw new FleetA2ARuntimeError("task-release-mismatch", "task manifest does not match the active profile manifest");
	const applied = await readAppliedRelease(config);
	if (applied === null || applied.releaseDigest !== releaseDigest) throw new FleetA2ARuntimeError("task-release-mismatch", "task release does not match the active applied release");
}
async function assertTaskExecutionProfile(config, profile, executionProfileHash) {
	try {
		await assertExecutionProfileHash(config.dshHome, profile, executionProfileHash);
	} catch {
		throw new FleetA2ARuntimeError("task-execution-profile-mismatch", "task execution profile no longer matches its signed profile hash");
	}
}
function taskPolicy(config, policyId, policyDigest) {
	try {
		return resolveTaskPolicy(config.tasks, policyId, policyDigest);
	} catch {
		throw new FleetA2ARuntimeError("task-policy-denied", "task policy is not installed, enabled, or digest-matched locally");
	}
}
function assertTaskOwner(record, envelope) {
	if (record.schemaVersion !== 2 && record.schemaVersion !== 3 || record.senderKeyId === null) throw new FleetA2ARuntimeError("legacy-task-owner-unbound", "legacy tasks cannot be controlled through the signed task channel");
	if (record.senderDeviceId !== envelope.sender.deviceId || record.senderPrincipalId !== envelope.sender.principalId || record.senderKeyId !== envelope.sender.keyId) throw new FleetA2ARuntimeError("task-owner-mismatch", "the signed caller does not own this task");
}
function assertBoundTaskState(record, request) {
	if (record.schemaVersion !== 3 || request.schemaVersion !== 3 || record.senderKeyId === null || record.workspacePath === null || record.manifestDigest === null || record.releaseDigest === null || record.executionProfileHash === null || record.policyId === null || record.policyDigest === null || record.taskBindingDigest === null || request.senderKeyId !== record.senderKeyId || request.workspacePath !== record.workspacePath || request.executionProfileHash !== record.executionProfileHash || request.manifestDigest !== record.manifestDigest || request.releaseDigest !== record.releaseDigest || request.policyId !== record.policyId || request.policyDigest !== record.policyDigest || request.taskBindingDigest !== record.taskBindingDigest || request.deadline !== record.deadlineAt) throw new FleetA2ARuntimeError("task-binding-invalid", "task execution requires an intact schema-v3 release, profile and policy binding");
}
async function assertExecutableTaskBinding(config, record, request) {
	assertBoundTaskState(record, request);
	if (request.requestMessageId !== record.requestMessageId || request.senderDeviceId !== record.senderDeviceId || request.senderPrincipalId !== record.senderPrincipalId || request.workspaceId !== record.workspaceId || request.profile !== record.profile || request.promptDigest !== record.promptDigest) throw new FleetA2ARuntimeError("task-request-mismatch", "task request does not match its durable record");
	if (Date.now() >= Date.parse(record.deadlineAt)) throw new FleetA2ARuntimeError("task-timeout", "task deadline has expired");
	await assertTaskReleaseBinding(config, record.manifestDigest, record.releaseDigest);
	await assertTaskExecutionProfile(config, record.profile, record.executionProfileHash);
	const policy = taskPolicy(config, record.policyId, record.policyDigest);
	const workspacePath = await taskWorkspace(config, record.workspaceId);
	if (workspacePath !== record.workspacePath) throw new FleetA2ARuntimeError("task-policy-denied", "task workspace binding changed after acceptance");
	return {
		workspacePath,
		policy
	};
}
async function acceptTask(config, envelope, launch) {
	if (!config.tasks.enabled) throw new FleetA2ARuntimeError("tasks-disabled", "remote tasks are disabled on this device");
	const payload = envelope.payload;
	if (!config.tasks.profiles.includes(payload.profile)) throw new FleetA2ARuntimeError("task-policy-denied", "task workspace or profile is not allowed by local policy");
	const deadline = Date.parse(payload.deadline);
	if (deadline <= Date.now() || deadline > Date.parse(envelope.issuedAt) + config.tasks.timeoutMs) throw new FleetA2ARuntimeError("task-policy-denied", "task deadline is expired or exceeds the local task timeout");
	await assertTaskReleaseBinding(config, payload.manifestDigest, payload.releaseDigest);
	await assertTaskExecutionProfile(config, payload.profile, payload.executionProfileHash);
	taskPolicy(config, payload.policyId, payload.policyDigest);
	const workspacePath = await taskWorkspace(config, payload.workspaceId);
	const taskBindingDigest = createTaskBindingDigest({
		teamId: envelope.teamId,
		submitMessageId: envelope.messageId,
		submitPayloadDigest: envelope.payloadDigest,
		sender: envelope.sender,
		recipientDeviceId: config.deviceId,
		taskId: payload.taskId,
		workspaceId: payload.workspaceId,
		workspacePath,
		profile: payload.profile,
		executionProfileHash: payload.executionProfileHash,
		manifestDigest: payload.manifestDigest,
		releaseDigest: payload.releaseDigest,
		policyId: payload.policyId,
		policyDigest: payload.policyDigest,
		deadline: payload.deadline
	});
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
		if (storedRequest !== null && (storedRequest.schemaVersion !== 3 || storedRequest.promptDigest !== promptDigest || storedRequest.prompt !== payload.prompt || storedRequest.senderDeviceId !== envelope.sender.deviceId || storedRequest.senderPrincipalId !== envelope.sender.principalId || storedRequest.senderKeyId !== envelope.sender.keyId || storedRequest.workspaceId !== payload.workspaceId || storedRequest.workspacePath !== workspacePath || storedRequest.profile !== payload.profile || storedRequest.executionProfileHash !== payload.executionProfileHash || storedRequest.manifestDigest !== payload.manifestDigest || storedRequest.releaseDigest !== payload.releaseDigest || storedRequest.policyId !== payload.policyId || storedRequest.policyDigest !== payload.policyDigest || storedRequest.taskBindingDigest !== taskBindingDigest || storedRequest.deadline !== payload.deadline)) throw new FleetA2ARuntimeError("task-id-conflict", "task id is already bound to a different request");
		const request = storedRequest ?? {
			schemaVersion: 3,
			taskId: payload.taskId,
			requestMessageId: envelope.messageId,
			senderDeviceId: envelope.sender.deviceId,
			senderPrincipalId: envelope.sender.principalId,
			senderKeyId: envelope.sender.keyId,
			workspaceId: payload.workspaceId,
			workspacePath,
			profile: payload.profile,
			executionProfileHash: payload.executionProfileHash,
			promptDigest,
			manifestDigest: payload.manifestDigest,
			releaseDigest: payload.releaseDigest,
			policyId: payload.policyId,
			policyDigest: payload.policyDigest,
			taskBindingDigest,
			deadline: payload.deadline,
			prompt: payload.prompt
		};
		if (storedRequest === null) await atomicJson(join(directory, "request.json"), request);
		const createdAt = (/* @__PURE__ */ new Date()).toISOString();
		const record = {
			schemaVersion: 3,
			taskId: payload.taskId,
			requestMessageId: request.requestMessageId,
			senderDeviceId: request.senderDeviceId,
			senderPrincipalId: request.senderPrincipalId,
			senderKeyId: envelope.sender.keyId,
			workspaceId: request.workspaceId,
			workspacePath,
			profile: request.profile,
			executionProfileHash: payload.executionProfileHash,
			promptDigest: request.promptDigest,
			manifestDigest: payload.manifestDigest,
			releaseDigest: payload.releaseDigest,
			policyId: payload.policyId,
			policyDigest: payload.policyDigest,
			taskBindingDigest,
			state: "accepted",
			createdAt,
			updatedAt: createdAt,
			deadlineAt: payload.deadline,
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
async function approvalDirectories(config, taskId) {
	const root = join(taskDirectory(config, taskId), "approvals");
	let info;
	try {
		info = await lstat(root);
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 63) !== 0 || typeof process.getuid === "function" && info.uid !== process.getuid()) throw new FleetA2ARuntimeError("unsafe-state-permissions", "task approval state must be an owner-only real directory");
	return (await readdir(root, { withFileTypes: true })).flatMap((entry) => entry.isDirectory() && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entry.name) ? [join(root, entry.name)] : []).sort();
}
async function readApprovalIntent(path) {
	try {
		return parseTaskApprovalIntent(JSON.parse(await readRegularFile(path, true)));
	} catch (error) {
		if (error.code === "ENOENT") throw error;
		if (error instanceof FleetA2ARuntimeError) throw error;
		throw new FleetA2ARuntimeError("task-approval-state-invalid", "task approval intent is invalid");
	}
}
async function validatePendingApproval(config, record, policy, intent) {
	if (intent.taskId !== record.taskId || intent.taskBindingDigest !== record.taskBindingDigest || intent.executionProfileHash !== record.executionProfileHash) throw new FleetA2ARuntimeError("task-approval-state-invalid", "task approval intent is bound to another task");
	await assertTaskExecutionProfile(config, record.profile, record.executionProfileHash);
	const classification = classifyTaskToolCall({
		policy,
		workspacePath: record.workspacePath,
		toolName: intent.toolName,
		arguments: intent.arguments
	});
	if (classification.decision !== "ask" || classification.capability !== intent.capability || classification.argumentsDigest !== intent.argumentsDigest) throw new FleetA2ARuntimeError("task-approval-state-invalid", "task approval intent no longer matches local policy");
	if (!await validateTaskToolFilesystemScope({
		workspacePath: record.workspacePath,
		toolName: intent.toolName,
		arguments: intent.arguments
	})) throw new FleetA2ARuntimeError("task-approval-state-invalid", "task approval intent resolves outside the workspace boundary");
}
async function verifyCachedApprovalRequest(config, record, value, now) {
	const privatePem = await privateKeyPem(config);
	const publicPem = createPublicKey(privatePem).export({
		type: "spki",
		format: "pem"
	}).toString();
	const keyId = a2aKeyId(publicPem);
	const envelope = verifyA2AEnvelope(value, {
		expectedTeamId: config.a2a.teamId,
		expectedDeviceId: record.senderDeviceId,
		trust: /* @__PURE__ */ new Map([[keyId, {
			teamId: config.a2a.teamId,
			keyId,
			principalId: config.a2a.principalId,
			deviceId: config.deviceId,
			publicKeyPem: publicPem,
			allowedKinds: ["task.approval.request"]
		}]]),
		now,
		maxTtlMs: config.a2a.maxMessageTtlMs
	});
	if (envelope.kind !== "task.approval.request") throw new FleetA2ARuntimeError("task-approval-state-invalid", "cached task approval request has the wrong kind");
	return envelope;
}
async function approvalRequestEnvelope(config, record, approvalDirectory, intent, now) {
	const path = join(approvalDirectory, "request-envelope.json");
	try {
		return await verifyCachedApprovalRequest(config, record, JSON.parse(await readRegularFile(path, true)), now);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const lock = await acquireProcessLock(path + ".lock", "task-approval-in-progress", "task approval request is being prepared");
	try {
		try {
			return await verifyCachedApprovalRequest(config, record, JSON.parse(await readRegularFile(path, true)), now);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		const payload = {
			approvalId: intent.approvalId,
			taskId: record.taskId,
			taskBindingDigest: record.taskBindingDigest,
			toolCallId: intent.toolCallId,
			toolName: intent.toolName,
			arguments: intent.arguments,
			argumentsDigest: intent.argumentsDigest,
			capability: intent.capability,
			summary: `${intent.toolName} requests one ${intent.capability} execution`,
			expiresAt: intent.expiresAt
		};
		validateA2APayload("task.approval.request", payload);
		const envelope = await signA2AMessage(config, record.senderDeviceId, "task.approval.request", payload, now);
		await atomicJson(path, envelope);
		return envelope;
	} finally {
		await releaseProcessLock(lock);
	}
}
async function pendingApprovalResponse(config, record, now) {
	if (record.schemaVersion !== 3 || record.workspacePath === null || record.executionProfileHash === null || record.policyId === null || record.policyDigest === null || record.taskBindingDigest === null) return null;
	const bound = record;
	const policy = taskPolicy(config, bound.policyId, bound.policyDigest);
	for (const directory of await approvalDirectories(config, record.taskId)) {
		if (existsSync(join(directory, "decision.json")) || existsSync(join(directory, "consumed.json"))) continue;
		const intent = await readApprovalIntent(join(directory, "intent.json"));
		if (Date.parse(intent.expiresAt) <= now.getTime()) continue;
		await validatePendingApproval(config, bound, policy, intent);
		return approvalRequestEnvelope(config, bound, directory, intent, now);
	}
	return null;
}
async function acceptApprovalDecision(config, envelope, now) {
	const payload = envelope.payload;
	const record = await readTaskRecord(config, payload.taskId);
	if (record === null) throw new FleetA2ARuntimeError("task-not-found", "task was not found");
	assertTaskOwner(record, envelope);
	if (record.schemaVersion !== 3 || record.workspacePath === null || record.executionProfileHash === null || record.policyId === null || record.policyDigest === null || record.taskBindingDigest === null || record.taskBindingDigest !== payload.taskBindingDigest) throw new FleetA2ARuntimeError("task-binding-invalid", "approval decision does not match an executable task");
	if (record.state === "succeeded" || record.state === "failed" || record.state === "cancelled") throw new FleetA2ARuntimeError("task-not-active", "approval decisions are accepted only for active tasks");
	const directory = join(taskDirectory(config, payload.taskId), "approvals", approvalSegment(payload.approvalId));
	const intent = await readApprovalIntent(join(directory, "intent.json"));
	await validatePendingApproval(config, record, taskPolicy(config, record.policyId, record.policyDigest), intent);
	const request = await verifyCachedApprovalRequest(config, record, JSON.parse(await readRegularFile(join(directory, "request-envelope.json"), true)), now);
	const requestPayload = request.payload;
	if (payload.approvalId !== intent.approvalId || payload.approvalRequestMessageId !== request.messageId || payload.approvalRequestPayloadDigest !== request.payloadDigest || payload.toolCallId !== intent.toolCallId || payload.argumentsDigest !== intent.argumentsDigest || requestPayload.approvalId !== intent.approvalId || requestPayload.taskBindingDigest !== record.taskBindingDigest) throw new FleetA2ARuntimeError("task-approval-mismatch", "approval decision does not match the signed approval request");
	const decidedAt = Date.parse(payload.decidedAt);
	if (decidedAt < Date.parse(request.issuedAt) || decidedAt > now.getTime() + 3e4 || decidedAt >= Date.parse(intent.expiresAt)) throw new FleetA2ARuntimeError("task-approval-expired", "approval decision is outside the signed approval window");
	const token = payload.decision === "allowed-once" ? createAllowedOnceToken({
		approvalId: payload.approvalId,
		approvalRequestMessageId: request.messageId,
		approvalRequestPayloadDigest: request.payloadDigest,
		decisionMessageId: envelope.messageId,
		decisionPayloadDigest: envelope.payloadDigest,
		taskBindingDigest: record.taskBindingDigest,
		executionProfileHash: record.executionProfileHash,
		toolCallId: intent.toolCallId,
		toolName: intent.toolName,
		argumentsDigest: intent.argumentsDigest,
		expiresAt: intent.expiresAt
	}) : null;
	const decision = {
		schemaVersion: 2,
		decision: payload.decision,
		decisionEnvelope: envelope,
		token
	};
	const lock = await acquireProcessLock(join(directory, "decision.lock"), "task-approval-in-progress", "task approval decision is being recorded");
	try {
		if (existsSync(join(directory, "decision.json"))) {
			if (sha256Canonical(JSON.parse(await readRegularFile(join(directory, "decision.json"), true))) === sha256Canonical(decision)) return;
			throw new FleetA2ARuntimeError("task-approval-already-decided", "the first signed approval decision is final");
		}
		await exclusiveJson(join(directory, "decision.json"), decision);
	} finally {
		await releaseProcessLock(lock);
	}
}
async function requestCancellation(config, envelope) {
	const taskId = envelope.payload.taskId;
	const record = await readTaskRecord(config, taskId);
	if (record === null) throw new FleetA2ARuntimeError("task-not-found", "task was not found");
	assertTaskOwner(record, envelope);
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
	if (envelope.teamId !== config.a2a.teamId) response = {
		kind: "receipt",
		payload: federationReceiptPayload((await receiveFederationEnvelope({
			rootDirectory: join(config.stateDir, "federation"),
			value: envelope,
			verification: {
				expectedTeamId: config.a2a.teamId,
				expectedDeviceId: config.deviceId,
				trust: await readA2ATrustStore(config),
				now,
				maxTtlMs: config.a2a.maxMessageTtlMs
			},
			receivedAt: now
		})).record)
	};
	else if (envelope.kind === "task.submit") response = workerPayload(await acceptTask(config, envelope, launch), null);
	else if (envelope.kind === "task.status") {
		const taskId = envelope.payload.taskId;
		const ownerRecord = await readTaskRecord(config, taskId);
		if (ownerRecord === null) throw new FleetA2ARuntimeError("task-not-found", "task was not found");
		assertTaskOwner(ownerRecord, envelope);
		const approval = await pendingApprovalResponse(config, ownerRecord, now);
		if (approval !== null) return approval;
		const { record, result } = await taskResult(config, taskId);
		response = workerPayload(record, result);
	} else if (envelope.kind === "task.cancel") response = workerPayload(await requestCancellation(config, envelope), null);
	else if (envelope.kind === "task.approval.decision") {
		await acceptApprovalDecision(config, envelope, now);
		response = {
			kind: "receipt",
			payload: {
				requestMessageId: envelope.messageId,
				status: "accepted"
			}
		};
	} else {
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
		recipient: {
			teamId: envelope.teamId,
			deviceId: envelope.sender.deviceId
		},
		kind: response.kind,
		payload: response.payload,
		privateKey: await privateKeyPem(config),
		now,
		ttlMs: messageTtlMs(config, response.kind, response.payload, now, envelope.teamId !== config.a2a.teamId)
	});
}
async function receiveA2AMessage(config, value, launch, now = /* @__PURE__ */ new Date(), lockHooks) {
	assertA2AReadyConfig(config);
	const envelope = await verifyA2AMessage(config, value, now);
	const receiptPath = join(config.stateDir, "a2a", "receipts", hash(envelope.messageId) + ".json");
	const lockPath = receiptPath + ".lock";
	try {
		return readStoredReceipt(JSON.parse(await readRegularFile(receiptPath)), envelope);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	let lock;
	try {
		lock = await acquireProcessLock(lockPath, "message-in-progress", "A2A message is already being processed", lockHooks);
	} catch (error) {
		if (error.code !== "message-in-progress") throw error;
		for (let attempt = 0; attempt < 80; attempt += 1) {
			try {
				return readStoredReceipt(JSON.parse(await readRegularFile(receiptPath)), envelope);
			} catch (readError) {
				if (readError.code !== "ENOENT") throw readError;
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw error;
	}
	try {
		try {
			return readStoredReceipt(JSON.parse(await readRegularFile(receiptPath)), envelope);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		const response = await receiptResponse(config, envelope, launch, now);
		const receipt = {
			requestMessageId: envelope.messageId,
			response
		};
		await atomicJson(receiptPath, storedReceipt(envelope, receipt));
		return receipt;
	} finally {
		await releaseProcessLock(lock);
	}
}
function taskEnvironment(config, input) {
	const path = [
		dirname(config.dshBinary),
		dirname(process.execPath),
		"/opt/homebrew/bin",
		"/usr/bin",
		"/bin"
	].join(":");
	const env = {
		DSH_HOME: config.dshHome,
		DSH_PERMISSION_MODE: input.permissionMode,
		DSH_FLEET_TASK_CONTEXT: input.contextPath,
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
async function runTaskProcess(config, record, request, cancelPath, workerBundlePath) {
	const { workspacePath, policy } = await assertExecutableTaskBinding(config, record, request);
	if (!isAbsolute(workerBundlePath) || normalize(workerBundlePath) !== workerBundlePath || /[\r\n\0]/.test(workerBundlePath)) throw new FleetA2ARuntimeError("worker-bundle-invalid", "task worker bundle path must be a normalized absolute path");
	const workerInfo = await lstat(workerBundlePath).catch(() => void 0);
	if (workerInfo === void 0 || workerInfo.isSymbolicLink() || !workerInfo.isFile() || typeof process.getuid === "function" && workerInfo.uid !== process.getuid()) throw new FleetA2ARuntimeError("worker-bundle-invalid", "task worker bundle must be a real file owned by the current user");
	const directory = taskDirectory(config, record.taskId);
	const contextPath = join(directory, "worker-context.json");
	const approvalsDir = join(directory, "approvals");
	await atomicJson(contextPath, {
		schemaVersion: 2,
		taskId: record.taskId,
		taskBindingDigest: record.taskBindingDigest,
		dshHome: config.dshHome,
		profile: record.profile,
		executionProfileHash: record.executionProfileHash,
		workspacePath,
		policy,
		approvalsDir,
		cancelPath,
		deadline: record.deadlineAt
	});
	const patchPath = join(directory, "worker.patch.yml");
	await atomicText(patchPath, [
		"- update:",
		"    id: approval",
		"    config:",
		"      policy: \"never\"",
		"- insert:",
		"    - id: fleet-task-policy",
		`      name: ${JSON.stringify(workerBundlePath)}`,
		""
	].join("\n"));
	const timeoutMs = Math.min(config.tasks.timeoutMs, Date.parse(record.deadlineAt) - Date.now());
	if (timeoutMs <= 0) throw new FleetA2ARuntimeError("task-timeout", "task deadline has expired");
	return new Promise((resolve, reject) => {
		const grouped = process.platform !== "win32";
		const child = spawn(config.dshBinary, [
			"--profile",
			request.profile,
			"--patch",
			patchPath,
			request.prompt
		], {
			cwd: workspacePath,
			env: taskEnvironment(config, {
				permissionMode: policy.permissionMode,
				contextPath
			}),
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
		const timeout = setTimeout(() => stop("timeout"), timeoutMs);
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
	for (;;) {
		for (let index = 0; index < config.tasks.maxConcurrent; index += 1) {
			const path = join(directory, String(index) + ".lock");
			const created = await createProcessLock(path, { taskId });
			if (created !== null) return created;
			const observation = await observeProcessLock(path);
			if (observation.state === "stale") await reclaimStaleProcessLock(path, observation);
		}
		if (existsSync(join(taskDirectory(config, taskId), "cancel"))) throw new FleetA2ARuntimeError("task-cancelled", "task was cancelled while queued");
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}
async function runTaskWorker(config, taskId, workerBundlePath) {
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
		if (request === null) throw new FleetA2ARuntimeError("task-request-mismatch", "task request is missing");
		await assertExecutableTaskBinding(config, record, request);
		const cancelPath = join(directory, "cancel");
		if (existsSync(cancelPath)) return saveTaskRecord(config, record, "cancelled", { errorCode: "cancelled" });
		slot = await acquireTaskSlot(config, taskId);
		if (existsSync(cancelPath)) return saveTaskRecord(config, record, "cancelled", { errorCode: "cancelled" });
		record = await saveTaskRecord(config, record, "running");
		const result = await runTaskProcess(config, record, request, cancelPath, workerBundlePath);
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
			await releaseProcessLock(slot);
		} catch {}
		await releaseProcessLock(worker);
	}
}
async function resumeAcceptedTasks(config, launch) {
	assertA2AReadyConfig(config);
	if (!config.tasks.enabled) return 0;
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
		if (record.state === "accepted" && Date.now() < Date.parse(record.deadlineAt)) {
			const request = await readTaskRequest(config, taskId);
			if (request === null) {
				await saveTaskRecord(config, record, "failed", { errorCode: "task-request-mismatch" });
				continue;
			}
			try {
				await assertExecutableTaskBinding(config, record, request);
				await launchTaskWorker(launch, taskId);
				resumed += 1;
			} catch (error) {
				await saveTaskRecord(config, record, "failed", { errorCode: typeof error.code === "string" ? error.code : "task-binding-invalid" });
			}
		} else await taskResult(config, taskId);
	}
	return resumed;
}
function safeA2ARuntimeError(error) {
	const raw = typeof error.code === "string" ? error.code : "internal";
	const code = /^[a-z0-9-]+$/.test(raw) ? raw : "internal";
	const messages = {
		"invalid-envelope": "A2A envelope is invalid",
		"invalid-payload": "A2A payload is invalid",
		"invalid-time": "A2A message time window is invalid",
		"message-expired": "A2A message has expired",
		"trust-denied": "A2A sender is not trusted for this action",
		"signature-invalid": "A2A signature is invalid",
		"recipient-mismatch": "A2A message targets another device",
		"tasks-disabled": "remote tasks are disabled on this device",
		"task-policy-denied": "task workspace or profile is not allowed",
		"task-not-found": "task was not found",
		"task-id-conflict": "task id is already bound to a different request",
		"task-in-progress": "task creation is already in progress",
		"invalid-task-state": "durable task state is invalid",
		"message-in-progress": "A2A message is already being processed",
		"message-id-conflict": "A2A message id is bound to another signed request",
		"receipt-state-invalid": "A2A receipt state is invalid",
		"unsafe-key-permissions": "A2A private key permissions are unsafe",
		"unsafe-state-file": "durable task state contains an unsafe file",
		"unsafe-state-permissions": "durable task state permissions are unsafe"
	};
	return {
		code: Object.hasOwn(messages, code) ? code : "internal",
		message: messages[code] ?? "A2A request failed"
	};
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
		observedRuntimeDigest: inspection.observedRuntimeDigest,
		observedServiceDefinitionDigest: inspection.observedServiceDefinitionDigest,
		teamId: config.a2a.teamId,
		principalId: config.a2a.principalId,
		identityKeyId: identityProbe.sender.keyId,
		trustedPeerCount: trust.size,
		trustedPeers: [...trust.values()].map((entry) => ({
			keyId: entry.keyId,
			principalId: entry.principalId,
			deviceId: entry.deviceId,
			allowedKinds: [...entry.allowedKinds]
		})).sort((left, right) => left.deviceId.localeCompare(right.deviceId) || left.keyId.localeCompare(right.keyId)),
		tasksEnabled: config.tasks.enabled,
		workspaceIds: Object.keys(config.tasks.workspaces).sort(),
		taskProfiles: [...config.tasks.profiles].sort(),
		retention: inspection.retention,
		executableChecks
	};
}
//#endregion
//#region src/agent/cli.ts
const MAX_INPUT_BYTES = 65536;
const shutdown = new AbortController();
let receivedSignal;
function beginShutdown(signal) {
	if (receivedSignal !== void 0) return;
	receivedSignal = signal;
	shutdown.abort(/* @__PURE__ */ new Error("fleet agent received " + signal));
}
const onSigint = () => beginShutdown("SIGINT");
const onSigterm = () => beginShutdown("SIGTERM");
process.on("SIGINT", onSigint);
process.on("SIGTERM", onSigterm);
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactObject(value, keys, label) {
	if (!isRecord(value)) throw Object.assign(/* @__PURE__ */ new TypeError(label + " must be an object"), { code: "invalid-payload" });
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw Object.assign(/* @__PURE__ */ new TypeError(label + " has unsupported or missing fields"), { code: "invalid-payload" });
	return value;
}
function stringField(value, field) {
	if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) throw Object.assign(/* @__PURE__ */ new TypeError(field + " must be a trimmed non-empty string"), { code: "invalid-payload" });
	return value;
}
async function readStdin() {
	const chunks = [];
	let size = 0;
	for await (const chunk of process.stdin) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_INPUT_BYTES) throw Object.assign(/* @__PURE__ */ new Error("request body is too large"), { code: "invalid-payload" });
		chunks.push(buffer);
	}
	const source = Buffer.concat(chunks).toString("utf8").trim();
	return source === "" ? null : JSON.parse(source);
}
function parseArgs(argv) {
	if (argv.length !== 3 || argv[0] !== "--config") throw Object.assign(/* @__PURE__ */ new Error("usage: dsh-fleet-agent --config <path> <command>"), { code: "invalid-invocation" });
	const configPath = argv[1];
	if (!isAbsolute(configPath) || normalize(configPath) !== configPath || configPath.includes("\0")) throw Object.assign(/* @__PURE__ */ new Error("config path must be absolute"), { code: "invalid-invocation" });
	const command = argv[2];
	if (![
		"inspect",
		"plan",
		"apply",
		"status",
		"release-inspect",
		"release-plan",
		"release-apply",
		"release-status",
		"release-rollback-plan",
		"release-rollback-apply",
		"release-rollback-status",
		"release-retention-plan",
		"release-retention-apply",
		"release-retention-status",
		"a2a-sign",
		"a2a-verify",
		"a2a-receive",
		"task-worker",
		"tasks-list",
		"tasks-prune",
		"tasks-resume",
		"federation-list",
		"federation-ack",
		"federation-retention-plan",
		"federation-prune",
		"doctor"
	].includes(command)) throw Object.assign(/* @__PURE__ */ new Error("unsupported command"), { code: "invalid-invocation" });
	return {
		configPath,
		command
	};
}
async function dispatch() {
	if (typeof process.getuid === "function" && process.getuid() === 0) throw Object.assign(/* @__PURE__ */ new Error("fleet agent refuses to run as root"), { code: "root-refused" });
	const { configPath, command } = parseArgs(process.argv.slice(2));
	const config = await readAgentConfig(configPath);
	const payload = await readStdin();
	const agentPath = process.argv[1];
	if (agentPath === void 0 || !isAbsolute(agentPath) || normalize(agentPath) !== agentPath) throw Object.assign(/* @__PURE__ */ new Error("fleet agent executable path must be absolute"), { code: "invalid-invocation" });
	const workerLaunch = {
		nodeBinary: process.execPath,
		agentPath,
		configPath
	};
	if (command === "doctor") {
		if (payload !== null && (isRecord(payload) ? Object.keys(payload).length !== 0 : true)) throw Object.assign(/* @__PURE__ */ new Error("doctor payload must be empty"), { code: "invalid-payload" });
		return doctorAgent(config, /* @__PURE__ */ new Date(), shutdown.signal);
	}
	if (command === "a2a-sign") {
		const body = isRecord(payload) && Object.hasOwn(payload, "recipientTeamId") ? exactObject(payload, [
			"kind",
			"payload",
			"recipientDeviceId",
			"recipientTeamId"
		], "A2A sign payload") : exactObject(payload, [
			"kind",
			"payload",
			"recipientDeviceId"
		], "A2A sign payload");
		const kind = stringField(body.kind, "kind");
		if (!FLEET_A2A_KINDS.includes(kind)) throw Object.assign(/* @__PURE__ */ new Error("unsupported A2A kind"), { code: "invalid-payload" });
		if (!isRecord(body.payload)) throw Object.assign(/* @__PURE__ */ new Error("A2A payload must be an object"), { code: "invalid-payload" });
		return signA2AMessage(config, stringField(body.recipientDeviceId, "recipientDeviceId"), kind, body.payload, /* @__PURE__ */ new Date(), body.recipientTeamId === void 0 ? void 0 : stringField(body.recipientTeamId, "recipientTeamId"));
	}
	if (command === "a2a-receive") return receiveA2AMessage(config, exactObject(payload, ["envelope"], "A2A receive payload").envelope, workerLaunch, /* @__PURE__ */ new Date());
	if (command === "a2a-verify") return verifyA2AMessage(config, exactObject(payload, ["envelope"], "A2A verify payload").envelope, /* @__PURE__ */ new Date());
	if (command === "task-worker") return runTaskWorker(config, stringField(exactObject(payload, ["taskId"], "task worker payload").taskId, "taskId"), join(dirname(agentPath), "worker.mjs"));
	if (command === "tasks-list") {
		const body = exactObject(payload, ["limit"], "tasks-list payload");
		if (typeof body.limit !== "number" || !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 100) throw Object.assign(/* @__PURE__ */ new Error("tasks-list limit must be an integer from 1 to 100"), { code: "invalid-payload" });
		return listFleetTasks(config, body.limit);
	}
	if (command === "tasks-prune") {
		const body = exactObject(payload, ["olderThan", "states"], "tasks-prune payload");
		if (!Array.isArray(body.states) || body.states.some((state) => typeof state !== "string")) throw Object.assign(/* @__PURE__ */ new Error("tasks-prune states must be strings"), { code: "invalid-payload" });
		return pruneFleetTasks(config, {
			olderThan: stringField(body.olderThan, "olderThan"),
			states: body.states
		});
	}
	if (command === "tasks-resume") {
		if (payload !== null && (isRecord(payload) ? Object.keys(payload).length !== 0 : true)) throw Object.assign(/* @__PURE__ */ new Error("tasks-resume payload must be empty"), { code: "invalid-payload" });
		return { resumed: await resumeAcceptedTasks(config, workerLaunch) };
	}
	if (command === "federation-list") {
		const body = exactObject(payload, ["limit"], "federation-list payload");
		if (typeof body.limit !== "number" || !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 100) throw Object.assign(/* @__PURE__ */ new Error("federation-list limit must be an integer from 1 to 100"), { code: "invalid-payload" });
		return listFederationInbox(join(config.stateDir, "federation"), { limit: body.limit });
	}
	if (command === "federation-ack") {
		const body = exactObject(payload, [
			"disposition",
			"messageId",
			"payloadDigest"
		], "federation-ack payload");
		const disposition = stringField(body.disposition, "disposition");
		if (disposition !== "acknowledged" && disposition !== "dismissed") throw Object.assign(/* @__PURE__ */ new Error("federation acknowledgement disposition is invalid"), { code: "invalid-payload" });
		return acknowledgeFederationMessage({
			rootDirectory: join(config.stateDir, "federation"),
			messageId: stringField(body.messageId, "messageId"),
			expectedPayloadDigest: stringField(body.payloadDigest, "payloadDigest"),
			disposition,
			acknowledgedAt: /* @__PURE__ */ new Date()
		});
	}
	if (command === "federation-retention-plan") {
		const body = exactObject(payload, [
			"acknowledgedRetentionMs",
			"expiredRetentionMs",
			"maxEntries"
		], "federation retention payload");
		for (const field of [
			"acknowledgedRetentionMs",
			"expiredRetentionMs",
			"maxEntries"
		]) if (typeof body[field] !== "number" || !Number.isSafeInteger(body[field])) throw Object.assign(/* @__PURE__ */ new Error(field + " must be an integer"), { code: "invalid-payload" });
		const items = await listFederationInbox(join(config.stateDir, "federation"), { limit: 500 });
		return {
			generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			candidates: planFederationInboxPrune(items, {
				acknowledgedRetentionMs: body.acknowledgedRetentionMs,
				expiredRetentionMs: body.expiredRetentionMs,
				maxEntries: body.maxEntries
			})
		};
	}
	if (command === "federation-prune") {
		const body = exactObject(payload, ["candidates", "policy"], "federation-prune payload");
		const policy = exactObject(body.policy, [
			"acknowledgedRetentionMs",
			"expiredRetentionMs",
			"maxEntries"
		], "federation-prune policy");
		for (const field of [
			"acknowledgedRetentionMs",
			"expiredRetentionMs",
			"maxEntries"
		]) if (typeof policy[field] !== "number" || !Number.isSafeInteger(policy[field])) throw Object.assign(/* @__PURE__ */ new Error(field + " must be an integer"), { code: "invalid-payload" });
		if (!Array.isArray(body.candidates)) throw Object.assign(/* @__PURE__ */ new Error("federation-prune candidates must be an array"), { code: "invalid-payload" });
		return applyFederationInboxPrune({
			rootDirectory: join(config.stateDir, "federation"),
			candidates: body.candidates,
			policy: {
				acknowledgedRetentionMs: policy.acknowledgedRetentionMs,
				expiredRetentionMs: policy.expiredRetentionMs,
				maxEntries: policy.maxEntries
			},
			now: /* @__PURE__ */ new Date()
		});
	}
	if (command === "release-inspect" || command === "release-plan") {
		if (payload !== null && (isRecord(payload) ? Object.keys(payload).length !== 0 : true)) throw Object.assign(/* @__PURE__ */ new Error(command + " payload must be empty"), { code: "invalid-payload" });
		return command === "release-inspect" ? inspectReleaseAgent(config, /* @__PURE__ */ new Date(), shutdown.signal) : createStoredReleasePlan(config, /* @__PURE__ */ new Date(), shutdown.signal);
	}
	if (command === "release-status") {
		const action = await readOrRecoverReleaseAction(config, stringField(exactObject(payload, ["planId"], "release status payload").planId, "planId"));
		if (action === null) throw Object.assign(/* @__PURE__ */ new Error("release action not found"), { code: "action-not-found" });
		return action;
	}
	if (command === "release-apply") return applyStoredReleasePlan(config, exactObject(payload, ["approval"], "release apply payload").approval, /* @__PURE__ */ new Date(), shutdown.signal);
	if (command === "release-rollback-plan") return createStoredReleaseRollbackPlan(config, stringField(exactObject(payload, ["transitionPlanId"], "release rollback plan payload").transitionPlanId, "transitionPlanId"), /* @__PURE__ */ new Date(), shutdown.signal);
	if (command === "release-rollback-status") {
		const action = await readOrRecoverReleaseRollbackAction(config, stringField(exactObject(payload, ["planId"], "release rollback status payload").planId, "planId"));
		if (action === null) throw Object.assign(/* @__PURE__ */ new Error("release rollback action not found"), { code: "action-not-found" });
		return action;
	}
	if (command === "release-rollback-apply") return applyStoredReleaseRollbackPlan(config, exactObject(payload, ["approval"], "release rollback apply payload").approval, /* @__PURE__ */ new Date(), shutdown.signal);
	if (command === "release-retention-plan") {
		if (payload !== null && (isRecord(payload) ? Object.keys(payload).length !== 0 : true)) throw Object.assign(/* @__PURE__ */ new Error("release retention plan payload must be empty"), { code: "invalid-payload" });
		return createStoredReleaseRetentionPlan(config, /* @__PURE__ */ new Date());
	}
	if (command === "release-retention-status") {
		const action = await readReleaseRetentionActionStatus(config, stringField(exactObject(payload, ["planId"], "release retention status payload").planId, "planId"));
		if (action === null) throw Object.assign(/* @__PURE__ */ new Error("release retention action not found"), { code: "action-not-found" });
		return action;
	}
	if (command === "release-retention-apply") return applyStoredReleaseRetentionPlan(config, exactObject(payload, ["approval"], "release retention apply payload").approval, /* @__PURE__ */ new Date());
	if (command === "inspect") {
		if (payload !== null && (isRecord(payload) ? Object.keys(payload).length !== 0 : true)) throw Object.assign(/* @__PURE__ */ new Error("inspect payload must be empty"), { code: "invalid-payload" });
		return inspectAgent(config, /* @__PURE__ */ new Date(), shutdown.signal);
	}
	if (command === "plan") return createStoredPlan(config, stringField(exactObject(payload, ["pluginId"], "plan payload").pluginId, "pluginId"), /* @__PURE__ */ new Date(), shutdown.signal);
	if (command === "status") {
		const action = await readOrRecoverAction(config, stringField(exactObject(payload, ["planId"], "status payload").planId, "planId"));
		if (action === null) throw Object.assign(/* @__PURE__ */ new Error("action not found"), { code: "action-not-found" });
		return action;
	}
	return applyStoredPlan(config, exactObject(payload, ["approval"], "apply payload").approval, /* @__PURE__ */ new Date(), shutdown.signal);
}
try {
	const value = await dispatch();
	process.stdout.write(JSON.stringify({
		ok: true,
		value
	}) + "\n");
} catch (error) {
	const a2a = safeA2ARuntimeError(error);
	const federation = safeFederationError(error);
	process.stdout.write(JSON.stringify({
		ok: false,
		error: a2a.code !== "internal" ? a2a : federation.code !== "internal" ? federation : safeRuntimeError(error)
	}) + "\n");
} finally {
	process.off("SIGINT", onSigint);
	process.off("SIGTERM", onSigterm);
	if (receivedSignal === "SIGINT") process.exitCode = 130;
	if (receivedSignal === "SIGTERM") process.exitCode = 143;
}
//#endregion
export {};
