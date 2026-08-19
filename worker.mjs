import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
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
(/* @__PURE__ */ __commonJSMin(((exports, module) => {
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
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
	if (isRecord$3(value)) {
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
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedText(value, field, maxLength = 128) {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > maxLength || /[\r\n\0]/.test(value)) throw new WorkerPolicyError("invalid-context", field + " must be a bounded trimmed string");
	return value;
}
function safeIdentifier(value, field) {
	const result = boundedText(value, field, 64);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(result)) throw new WorkerPolicyError("invalid-context", field + " is invalid");
	return result;
}
function namespacedId(value, field, prefix) {
	const result = boundedText(value, field, 64);
	if (!new RegExp("^" + prefix + ":[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").test(result)) throw new WorkerPolicyError("invalid-context", field + " must be a namespaced UUID");
	return result;
}
function digest$2(value, field) {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new WorkerPolicyError("invalid-context", field + " must be a lowercase SHA-256 digest");
	return value;
}
function canonicalTimestamp(value, field) {
	if (typeof value !== "string") throw new WorkerPolicyError("invalid-context", field + " must be a canonical ISO timestamp");
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) throw new WorkerPolicyError("invalid-context", field + " must be a canonical ISO timestamp");
	return value;
}
function canonicalArguments(toolArguments, maxBytes) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16384) throw new WorkerPolicyError("invalid-context", "maxBytes exceeds the Fleet tool-argument ceiling");
	if (!isRecord$2(toolArguments)) throw new WorkerPolicyError("invalid-arguments", "tool arguments must be a JSON object");
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
function validateAllowedOnceToken(token) {
	if (token.schemaVersion !== 2) throw new WorkerPolicyError("invalid-context", "allowed-once token schema is unsupported");
	namespacedId(token.approvalId, "approvalId", "approval");
	namespacedId(token.approvalRequestMessageId, "approvalRequestMessageId", "msg");
	digest$2(token.approvalRequestPayloadDigest, "approvalRequestPayloadDigest");
	namespacedId(token.decisionMessageId, "decisionMessageId", "msg");
	digest$2(token.decisionPayloadDigest, "decisionPayloadDigest");
	digest$2(token.taskBindingDigest, "taskBindingDigest");
	digest$2(token.executionProfileHash, "executionProfileHash");
	boundedText(token.toolCallId, "toolCallId");
	safeIdentifier(token.toolName, "toolName");
	digest$2(token.argumentsDigest, "argumentsDigest");
	canonicalTimestamp(token.expiresAt, "expiresAt");
	if (token.consumedAt !== null) canonicalTimestamp(token.consumedAt, "consumedAt");
}
function consumeAllowedOnceToken(token, execution, now, maxArgumentsBytes = MAX_TASK_TOOL_ARGUMENT_BYTES) {
	try {
		validateAllowedOnceToken(token);
	} catch {
		return {
			allowed: false,
			reason: "invalid-token",
			token
		};
	}
	if (token.consumedAt !== null) return {
		allowed: false,
		reason: "already-consumed",
		token
	};
	let consumedAt;
	try {
		consumedAt = canonicalTimestamp(now instanceof Date ? now.toISOString() : now, "now");
	} catch {
		return {
			allowed: false,
			reason: "invalid-token",
			token
		};
	}
	if (Date.parse(consumedAt) >= Date.parse(token.expiresAt)) return {
		allowed: false,
		reason: "expired",
		token
	};
	if (execution.taskBindingDigest !== token.taskBindingDigest || execution.executionProfileHash !== token.executionProfileHash || execution.toolCallId !== token.toolCallId || execution.toolName !== token.toolName) return {
		allowed: false,
		reason: "binding-mismatch",
		token
	};
	let argumentsDigest;
	try {
		argumentsDigest = digestToolArguments(execution.arguments, maxArgumentsBytes);
	} catch {
		return {
			allowed: false,
			reason: "invalid-arguments",
			token
		};
	}
	if (argumentsDigest !== token.argumentsDigest) return {
		allowed: false,
		reason: "binding-mismatch",
		token
	};
	return {
		allowed: true,
		reason: "allowed-once",
		token: {
			...token,
			consumedAt
		}
	};
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
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text$1(value, field, maxLength = 128) {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > maxLength || /[\r\n\0]/.test(value)) throw new FleetA2AError("invalid-payload", field + " must be a bounded trimmed string");
	return value;
}
function longText(value, field, maxLength) {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength || value.includes("\0")) throw new FleetA2AError("invalid-payload", field + " must be bounded non-empty text");
	return value;
}
function identifier(value, field) {
	const result = text$1(value, field, 64);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(result)) throw new FleetA2AError("invalid-payload", field + " is invalid");
	return result;
}
function messageId(value, field, prefix) {
	const result = text$1(value, field, 64);
	if (!new RegExp("^" + prefix + ":[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").test(result)) throw new FleetA2AError("invalid-payload", field + " must be a namespaced UUID");
	return result;
}
function digest$1(value, field) {
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
	if (!isRecord$1(payload)) throw new FleetA2AError("invalid-payload", kind + " payload must be an object");
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
		digest$1(payload.executionProfileHash, "payload.executionProfileHash");
		digest$1(payload.manifestDigest, "payload.manifestDigest");
		digest$1(payload.releaseDigest, "payload.releaseDigest");
		identifier(payload.policyId, "payload.policyId");
		digest$1(payload.policyDigest, "payload.policyDigest");
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
		if (payload.resultDigest !== null) digest$1(payload.resultDigest, "payload.resultDigest");
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
		digest$1(payload.taskBindingDigest, "payload.taskBindingDigest");
		text$1(payload.toolCallId, "payload.toolCallId");
		identifier(payload.toolName, "payload.toolName");
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
		].includes(text$1(payload.capability, "payload.capability", 32))) throw new FleetA2AError("invalid-payload", "task approval capability is invalid");
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
		digest$1(payload.approvalRequestPayloadDigest, "payload.approvalRequestPayloadDigest");
		digest$1(payload.taskBindingDigest, "payload.taskBindingDigest");
		text$1(payload.toolCallId, "payload.toolCallId");
		digest$1(payload.argumentsDigest, "payload.argumentsDigest");
		if (!["allowed-once", "rejected"].includes(text$1(payload.decision, "payload.decision", 16))) throw new FleetA2AError("invalid-payload", "task approval decision is invalid");
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
		digest$1(payload.approvalRequestPayloadDigest, "payload.approvalRequestPayloadDigest");
		if (!["endorsed", "declined"].includes(text$1(payload.decision, "payload.decision", 16))) throw new FleetA2AError("invalid-payload", "federation approval decision is invalid");
		canonicalTime(payload.decidedAt, "payload.decidedAt");
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
//#endregion
//#region src/worker/policy.ts
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
function isRecord(value) {
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
	if (!isAbsolute(input.workspacePath) || resolve(input.workspacePath) !== input.workspacePath || !isRecord(input.arguments)) return false;
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
	if (!isAbsolute(input.workspacePath) || resolve(input.workspacePath) !== input.workspacePath || !isRecord(input.arguments)) return denied("invalid-arguments", null);
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
//#endregion
//#region src/worker/profile.ts
const EXECUTION_PROFILE_FILES = [
	"package.json",
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
async function readRegularOptional(path) {
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
* deliberately represented by package.json + pnpm-lock.yaml and is rebuilt
* with scripts disabled; every other top-level entry is rejected.
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
	const files = Object.fromEntries(await Promise.all(EXECUTION_PROFILE_FILES.map(async (name) => [name, await readRegularOptional(join(directory, name))])));
	return createHash("sha256").update(JSON.stringify(files), "utf8").digest("hex");
}
async function assertExecutionProfileHash(dshHome, profile, expectedHash) {
	if (!/^[0-9a-f]{64}$/.test(expectedHash) || await computeExecutionProfileHash(dshHome, profile) !== expectedHash) throw new ExecutionProfileHashError("execution-profile-invalid", "execution profile no longer matches its signed task binding");
}
function record(value, keys, field) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(field + " must be an object");
	const raw = value;
	const actual = Object.keys(raw).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(field + " has unsupported or missing fields");
	return raw;
}
function text(value, field, max = 128) {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > max || /[\r\n\0]/.test(value)) throw new TypeError(field + " must be bounded text");
	return value;
}
function id(value, field, prefix) {
	const result = text(value, field, 64);
	if (!new RegExp("^" + prefix + ":[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").test(result)) throw new TypeError(field + " must be a namespaced UUID");
	return result;
}
function digest(value, field) {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new TypeError(field + " must be a SHA-256 digest");
	return value;
}
function timestamp(value, field) {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) throw new TypeError(field + " must be a canonical timestamp");
	return value;
}
function absolutePath(value, field) {
	const result = text(value, field, 4096);
	if (!isAbsolute(result) || normalize(result) !== result) throw new TypeError(field + " must be a normalized absolute path");
	return result;
}
function parsePolicy(value) {
	const raw = record(value, [
		"schemaVersion",
		"policyId",
		"permissionMode",
		"workspaceScope",
		"defaultDecision",
		"safeTools",
		"approvalRequiredTools",
		"hardDeniedTools",
		"allowBackground",
		"maxArgumentsBytes",
		"policyDigest"
	], "worker policy");
	if (raw.schemaVersion !== 1 || raw.policyId !== "readonly-v1" && raw.policyId !== "workspace-write-ask-v1" || raw.permissionMode !== "read-only" && raw.permissionMode !== "workspace-write" || raw.workspaceScope !== "configured-workspace" || raw.defaultDecision !== "deny" || raw.allowBackground !== false || !Number.isSafeInteger(raw.maxArgumentsBytes) || typeof raw.maxArgumentsBytes !== "number" || raw.maxArgumentsBytes < 1 || raw.maxArgumentsBytes > 16384) throw new TypeError("worker policy is invalid");
	for (const field of [
		"safeTools",
		"approvalRequiredTools",
		"hardDeniedTools"
	]) {
		const values = raw[field];
		if (!Array.isArray(values) || values.some((item) => typeof item !== "string") || new Set(values).size !== values.length) throw new TypeError("worker policy tool lists are invalid");
	}
	const policy = raw;
	const { policyDigest: rawDigest, ...body } = policy;
	if (digest(rawDigest, "worker policy digest") !== calculateTaskPolicyDigest(body)) throw new TypeError("worker policy digest does not match");
	return policy;
}
function parseTaskWorkerContext(value) {
	const raw = record(value, [
		"schemaVersion",
		"taskId",
		"taskBindingDigest",
		"dshHome",
		"profile",
		"executionProfileHash",
		"workspacePath",
		"policy",
		"approvalsDir",
		"cancelPath",
		"deadline"
	], "task worker context");
	if (raw.schemaVersion !== 2) throw new TypeError("task worker context schema is unsupported");
	return {
		schemaVersion: 2,
		taskId: id(raw.taskId, "taskId", "task"),
		taskBindingDigest: digest(raw.taskBindingDigest, "taskBindingDigest"),
		dshHome: absolutePath(raw.dshHome, "dshHome"),
		profile: text(raw.profile, "profile", 64),
		executionProfileHash: digest(raw.executionProfileHash, "executionProfileHash"),
		workspacePath: absolutePath(raw.workspacePath, "workspacePath"),
		policy: parsePolicy(raw.policy),
		approvalsDir: absolutePath(raw.approvalsDir, "approvalsDir"),
		cancelPath: absolutePath(raw.cancelPath, "cancelPath"),
		deadline: timestamp(raw.deadline, "deadline")
	};
}
function approvalSegment(approvalId) {
	return id(approvalId, "approvalId", "approval").slice(9);
}
//#endregion
//#region src/worker/index.ts
const name = "fleet-task-policy";
const inject = ["tools"];
function ownerOnly(info, field) {
	if ((info.mode & 63) !== 0) throw new Error(field + " must be owner-only");
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error(field + " must be owned by the current user");
}
async function readPrivateFile(path) {
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		const info = await handle.stat();
		if (!info.isFile()) throw new Error("Fleet task policy state must use regular files");
		ownerOnly(info, "Fleet task policy state");
		return await handle.readFile("utf8");
	} catch (error) {
		if (error.code === "ELOOP") throw new Error("Fleet task policy state must not use symbolic links");
		throw error;
	} finally {
		await handle?.close();
	}
}
async function ensurePrivateDirectory(path) {
	await mkdir(path, {
		recursive: true,
		mode: 448
	});
	const info = await lstat(path);
	if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Fleet task approval state must be a real directory");
	ownerOnly(info, "Fleet task approval directory");
}
async function writeExclusiveJson(path, value) {
	await ensurePrivateDirectory(dirname(path));
	let handle;
	try {
		handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 384);
		await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
		await handle.sync();
	} finally {
		await handle?.close();
	}
}
async function replacePrivateJson(path, value) {
	await ensurePrivateDirectory(dirname(path));
	const temporary = path + "." + randomUUID() + ".tmp";
	try {
		await writeExclusiveJson(temporary, value);
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}
function decisionFile(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("approval decision must be an object");
	const raw = value;
	const expected = [
		"decision",
		"decisionEnvelope",
		"schemaVersion",
		"token"
	];
	const actual = Object.keys(raw).sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error("approval decision has unsupported or missing fields");
	if (raw.schemaVersion !== 2 || raw.decision !== "allowed-once" && raw.decision !== "rejected" || typeof raw.decisionEnvelope !== "object" || raw.decisionEnvelope === null || Array.isArray(raw.decisionEnvelope)) throw new Error("approval decision is invalid");
	const envelope = raw.decisionEnvelope;
	if (envelope.kind !== "task.approval.decision") throw new Error("approval decision envelope kind is invalid");
	validateA2APayload(envelope.kind, envelope.payload);
	if (envelope.payload.decision !== raw.decision) throw new Error("approval decision does not match its signed payload");
	if (raw.decision === "rejected") {
		if (raw.token !== null) throw new Error("rejected approval must not contain a token");
		return {
			schemaVersion: 2,
			decision: "rejected",
			decisionEnvelope: envelope,
			token: null
		};
	}
	if (typeof raw.token !== "object" || raw.token === null || Array.isArray(raw.token)) throw new Error("allowed approval token is missing");
	return {
		schemaVersion: 2,
		decision: "allowed-once",
		decisionEnvelope: envelope,
		token: raw.token
	};
}
async function waitForApproval(worker, execution, classification) {
	if (classification.decision !== "ask" || classification.capability === null || classification.argumentsDigest === null || typeof execution.arguments !== "object" || execution.arguments === null || Array.isArray(execution.arguments)) return false;
	const approvalId = "approval:" + randomUUID();
	const approvalDirectory = join(worker.approvalsDir, approvalSegment(approvalId));
	await ensurePrivateDirectory(approvalDirectory);
	const expiresAt = new Date(Math.min(Date.parse(worker.deadline), Date.now() + 3e5)).toISOString();
	if (Date.parse(expiresAt) <= Date.now()) return false;
	const intent = {
		schemaVersion: 2,
		approvalId,
		taskId: worker.taskId,
		taskBindingDigest: worker.taskBindingDigest,
		executionProfileHash: worker.executionProfileHash,
		toolCallId: execution.callId,
		toolName: execution.name,
		arguments: execution.arguments,
		argumentsDigest: classification.argumentsDigest,
		capability: classification.capability,
		expiresAt
	};
	await writeExclusiveJson(join(approvalDirectory, "intent.json"), intent);
	const decisionPath = join(approvalDirectory, "decision.json");
	const consumedPath = join(approvalDirectory, "consumed.json");
	while (!execution.signal.aborted && !existsSync(worker.cancelPath) && Date.now() < Date.parse(expiresAt)) {
		try {
			const decision = decisionFile(JSON.parse(await readPrivateFile(decisionPath)));
			if (decision.decision === "rejected" || decision.token === null || existsSync(consumedPath)) return false;
			const result = consumeAllowedOnceToken(decision.token, {
				taskBindingDigest: worker.taskBindingDigest,
				executionProfileHash: worker.executionProfileHash,
				toolCallId: execution.callId,
				toolName: execution.name,
				arguments: execution.arguments
			}, /* @__PURE__ */ new Date());
			if (!result.allowed) return false;
			await writeExclusiveJson(consumedPath, result.token);
			return true;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	await replacePrivateJson(join(approvalDirectory, "expired.json"), { expiredAt: (/* @__PURE__ */ new Date()).toISOString() });
	return false;
}
async function apply(ctx) {
	const contextPath = process.env.DSH_FLEET_TASK_CONTEXT;
	if (contextPath === void 0 || contextPath.length === 0) throw new Error("DSH_FLEET_TASK_CONTEXT is required");
	const worker = parseTaskWorkerContext(JSON.parse(await readPrivateFile(contextPath)));
	if (Date.now() >= Date.parse(worker.deadline)) throw new Error("Fleet task context has expired");
	await assertExecutionProfileHash(worker.dshHome, worker.profile, worker.executionProfileHash);
	await ensurePrivateDirectory(worker.approvalsDir);
	const runtime = ctx;
	const granted = /* @__PURE__ */ new WeakSet();
	runtime.on("tools/pre-execute", async (execution, next) => {
		try {
			await assertExecutionProfileHash(worker.dshHome, worker.profile, worker.executionProfileHash);
		} catch {
			return {
				kind: "deny",
				reason: "Fleet task policy denied: execution profile changed after task acceptance"
			};
		}
		const classification = classifyTaskToolCall({
			policy: worker.policy,
			workspacePath: worker.workspacePath,
			toolName: execution.name,
			arguments: execution.arguments
		});
		if (classification.decision === "deny") return {
			kind: "deny",
			reason: "Fleet task policy denied: " + classification.reason
		};
		if (!await validateTaskToolFilesystemScope({
			workspacePath: worker.workspacePath,
			toolName: execution.name,
			arguments: execution.arguments
		})) return {
			kind: "deny",
			reason: "Fleet task policy denied: resolved path escapes or changes the workspace boundary"
		};
		if (classification.decision === "safe") return next();
		if (!await waitForApproval(worker, execution, classification)) return {
			kind: "deny",
			reason: "Fleet signed approval was rejected, expired, cancelled, or unavailable"
		};
		try {
			await assertExecutionProfileHash(worker.dshHome, worker.profile, worker.executionProfileHash);
		} catch {
			return {
				kind: "deny",
				reason: "Fleet task policy denied: execution profile changed during approval"
			};
		}
		granted.add(execution);
		return next();
	}, { prepend: true });
	runtime.tools.guard((execution) => {
		const classification = classifyTaskToolCall({
			policy: worker.policy,
			workspacePath: worker.workspacePath,
			toolName: execution.name,
			arguments: execution.arguments
		});
		if (classification.decision === "safe") return void 0;
		if (classification.decision === "ask" && granted.delete(execution)) return void 0;
		return "Fleet final execution guard denied this tool call";
	});
}
//#endregion
export { apply, inject, name };
