/* SPDX-License-Identifier: AGPL-3.0-only */

/** Resolve and pin the exact native tools consumed by the media-host recipe. */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, extname, isAbsolute, resolve } from 'node:path';

import {
	fingerprintFramescaperMediaHostToolchainReceipt,
} from '../../native/framescaper-media-host/build/recipe-driver.mjs';

const BASE_ROLES = Object.freeze(['ar', 'c', 'cmake', 'cxx', 'make', 'ninja', 'pkgConfig', 'ranlib', 'shell']);
const OVERRIDES = Object.freeze({
	ar: 'FRAMESCAPER_MEDIA_AR',
	c: 'FRAMESCAPER_MEDIA_CC',
	cmake: 'FRAMESCAPER_MEDIA_CMAKE',
	cxx: 'FRAMESCAPER_MEDIA_CXX',
	make: 'FRAMESCAPER_MEDIA_MAKE',
	msbuild: 'FRAMESCAPER_MEDIA_MSBUILD',
	ninja: 'FRAMESCAPER_MEDIA_NINJA',
	pkgConfig: 'FRAMESCAPER_MEDIA_PKG_CONFIG',
	ranlib: 'FRAMESCAPER_MEDIA_RANLIB',
	rc: 'FRAMESCAPER_MEDIA_RC',
	shell: 'FRAMESCAPER_MEDIA_SHELL',
});
const DEFAULTS = Object.freeze({
	linux: Object.freeze({ ar: 'ar', c: 'cc', cmake: 'cmake', cxx: 'c++', make: 'make',
		ninja: 'ninja', pkgConfig: 'pkg-config', ranlib: 'ranlib', shell: 'bash' }),
	darwin: Object.freeze({ ar: 'ar', c: 'clang', cmake: 'cmake', cxx: 'clang++', make: 'make',
		ninja: 'ninja', pkgConfig: 'pkg-config', ranlib: 'ranlib', shell: 'bash' }),
	win32: Object.freeze({ ar: 'lib', c: 'cl', cmake: 'cmake', cxx: 'cl', make: 'make',
		msbuild: 'msbuild', ninja: 'ninja', pkgConfig: 'pkg-config', ranlib: 'lib', rc: 'rc',
		shell: 'bash' }),
});
const ENVIRONMENT_NAMES = Object.freeze([
	'INCLUDE', 'LIB', 'LIBPATH', 'MACOSX_DEPLOYMENT_TARGET', 'PATH', 'SDKROOT', 'SYSTEMROOT',
]);

export function createFramescaperMediaHostToolchainReceipt(options = {}) {
	const targetId = target(options.targetId);
	const hostRuntime = `${process.platform}-${process.arch}`;
	if (hostRuntime !== runtime(targetId)) {
		throw new Error(`Media-host ${targetId} requires target-native Node.js on ${runtime(targetId)}.`);
	}
	const environment = {};
	for (const name of ENVIRONMENT_NAMES) {
		const value = process.env[name];
		if (typeof value === 'string' && value !== '') environment[name] = value;
	}
	if (!environment.PATH) throw new Error('The media-host toolchain requires PATH.');
	const defaults = DEFAULTS[process.platform];
	if (!defaults) throw new Error(`No media-host toolchain exists for ${process.platform}.`);
	const executables = {};
	for (const role of roles(targetId)) {
		const requested = process.env[OVERRIDES[role]]?.trim() || defaults[role];
		const path = canonicalExecutable(resolveCommand(requested, environment.PATH), role);
		executables[role] = Object.freeze({ path, sha256: sha256(readFileSync(path)) });
	}
	const body = {
		schemaVersion: 1, targetId, hostRuntime,
		executables: Object.freeze(executables),
		environment: Object.freeze(environment),
	};
	return Object.freeze({ ...body, identitySha256: fingerprintFramescaperMediaHostToolchainReceipt(body) });
}

function roles(targetId) {
	return targetId.startsWith('win-') ? [...BASE_ROLES, 'msbuild', 'rc'] : BASE_ROLES;
}

export function writeFramescaperMediaHostToolchainReceipt(options) {
	const path = absentAbsolutePath(options?.path, 'toolchain receipt path');
	const receipt = createFramescaperMediaHostToolchainReceipt({ targetId: options?.targetId });
	writeFileSync(path, `${JSON.stringify(receipt, null, '\t')}\n`, { flag: 'wx', mode: 0o400 });
	return Object.freeze({ path, receipt });
}

function resolveCommand(value, pathValue) {
	if (typeof value !== 'string' || value === '' || value.includes('\0')) {
		throw new TypeError('A media-host tool command is invalid.');
	}
	if (isAbsolute(value)) return resolve(value);
	if (value.includes('/') || value.includes('\\')) {
		throw new TypeError('A media-host tool override must be absolute or one command name.');
	}
	const extensions = process.platform === 'win32'
		? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';') : [''];
	for (const directory of pathValue.split(delimiter)) {
		if (!directory) continue;
		for (const extension of extensions) {
			const candidate = resolve(directory, extname(value) ? value : `${value}${extension.toLowerCase()}`);
			try {
				const canonical = realpathSync(candidate);
				if (lstatSync(canonical).isFile()) return canonical;
			} catch { /* Try the next exact PATH candidate. */ }
		}
	}
	throw new Error(`The media-host tool ${value} is unavailable on PATH.`);
}

function canonicalExecutable(value, role) {
	const path = resolve(value);
	const metadata = lstatSync(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || realpathSync(path) !== path
		|| metadata.size < 1 || metadata.size > 512 * 1024 * 1024) {
		throw new Error(`The media-host ${role} tool is not one canonical executable file.`);
	}
	return path;
}

function target(value) {
	if (!['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'].includes(value)) {
		throw new TypeError('The media-host toolchain target is unsupported.');
	}
	return value;
}
function runtime(value) {
	return value === 'mac-arm64' ? 'darwin-arm64'
		: value.startsWith('win-') ? `win32-${value.slice(4)}` : value;
}
function absentAbsolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`The ${label} must be absolute and normalized.`);
	}
	return value;
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
