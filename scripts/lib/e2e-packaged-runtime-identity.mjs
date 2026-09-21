/* SPDX-License-Identifier: AGPL-3.0-only */

import { posix, win32 } from 'node:path';

import { E2E_PRODUCTS } from './e2e-coverage-build-evidence.mjs';

export function packagedRuntime(profile, name, evidence) {
	const value = profile['soundscaper-packaged-runtime'];
	if (!record(value) || value.schemaVersion !== 4 || !E2E_PRODUCTS.includes(value.productId)
		|| !['linux', 'win32', 'darwin'].includes(value.platform)
		|| !['x64', 'arm64'].includes(value.architecture)
		|| typeof value.executablePath !== 'string' || typeof value.appOrigin !== 'string'
		|| value.appOrigin !== `${value.productId}-app://bundle`
		|| typeof value.baseOrigin !== 'string' || origin(value.baseOrigin) !== value.baseOrigin
		|| !/^http:\/\/127\.0\.0\.1:\d+$/u.test(value.baseOrigin)
		|| !Number.isSafeInteger(value.processId) || value.processId <= 0
		|| value.captureKind !== 'cdp-precise-coverage' || value.capturesChildTargets !== true
		|| value.childTargetStrategy !== 'recursive-auto-attach-paused'
		|| !validTargetAccounting(value)) {
		throw new Error(`Packaged coverage profile ${name} has invalid runtime metadata.`);
	}
	const paths = value.platform === 'win32' ? win32 : posix;
	if (!paths.isAbsolute(value.executablePath)) {
		throw new Error(`Packaged coverage profile ${name} has a relative executable path.`);
	}
	const executable = value.executablePath.replaceAll('\\', '/');
	const expectedAppAsar = value.platform === 'darwin'
		? paths.resolve(paths.dirname(value.executablePath), '../Resources/app.asar')
		: paths.resolve(paths.dirname(value.executablePath), 'resources/app.asar');
	const archive = evidence.electron.get(value.productId)?.packageArchive;
	if (!validRuntimeAppAsar(value.appAsar, expectedAppAsar, archive)) {
		throw new Error(`Packaged coverage profile ${name} has an invalid app.asar identity.`);
	}
	const resourcesPath = value.platform === 'darwin'
		? paths.resolve(paths.dirname(executable), '../Resources')
		: paths.resolve(paths.dirname(executable), 'resources');
	const resourceIdentity = evidence.electron.get(value.productId)?.executableResources;
	const webAssemblyResources = evidence.electron.get(value.productId)?.webAssemblyResources;
	if (!validRuntimeExecutableResources(
		value.executableResources, resourcesPath, resourceIdentity, webAssemblyResources,
	)) {
		throw new Error(`Packaged coverage profile ${name} has an invalid executable-resource identity.`);
	}
	const resources = normalizedInstalledPath(resourcesPath, value.platform);
	return Object.freeze({
		appAsar: `${resources}/app.asar`,
		appOrigin: value.appOrigin,
		architecture: value.architecture,
		baseOrigin: value.baseOrigin,
		platform: value.platform,
		processId: value.processId,
		productId: value.productId,
		resources,
	});
}

/** Reject captured executable bytes that have no corresponding V8 profile entry. */
export function validatePackagedSourceCache(profile, name, classify) {
	const cache = profile['script-source-cache'];
	if (!record(cache) || Object.values(cache).some((source) => typeof source !== 'string')) {
		throw new Error(`Packaged coverage profile ${name} has an invalid script-source cache.`);
	}
	if (!Array.isArray(profile.result) || profile.result.some((entry) => (
		!record(entry) || typeof entry.url !== 'string' || !Array.isArray(entry.functions)
	))) throw new Error(`Packaged profile ${name} has no valid V8 result array.`);
	const observedUrls = new Set(profile.result.map(({ url }) => url));
	for (const url of Object.keys(cache)) {
		if (observedUrls.has(url)) continue;
		if (classify(url) !== null) {
			throw new Error(`Packaged coverage captured source bytes without a V8 entry for ${url}.`);
		}
	}
}

function validTargetAccounting(value) {
	if (!Array.isArray(value.targetTypes)
		|| value.targetTypes.some((type) => typeof type !== 'string' || type === '')
		|| stableJson(value.targetTypes) !== stableJson([...new Set(value.targetTypes)].sort())
		|| !countRecord(value.targetCounts) || !countRecord(value.pausedTargetCounts)
		|| stableJson(value.targetTypes) !== stableJson(Object.keys(value.targetCounts).sort())) return false;
	return Object.entries(value.pausedTargetCounts).every(([type, count]) => (
		count <= (value.targetCounts[type] ?? -1)
	));
}

function countRecord(value) {
	return record(value) && Object.entries(value).every(([type, count]) => (
		type !== '' && Number.isSafeInteger(count) && count > 0
	));
}

function validRuntimeAppAsar(value, expectedPath, evidenceIdentity) {
	if (!record(value) || stableJson(Object.keys(value).sort())
		!== stableJson(['afterCollection', 'beforeLaunch', 'path'])
		|| value.path !== expectedPath || !exactFileIdentity(value.beforeLaunch)
		|| !exactFileIdentity(value.afterCollection) || !exactFileIdentity(evidenceIdentity)) return false;
	return stableJson(value.beforeLaunch) === stableJson(value.afterCollection)
		&& stableJson(value.beforeLaunch) === stableJson(evidenceIdentity);
}

function exactFileIdentity(value) {
	return record(value)
		&& stableJson(Object.keys(value).sort()) === stableJson(['byteLength', 'sha256'])
		&& Number.isSafeInteger(value.byteLength) && value.byteLength >= 0
		&& typeof value.sha256 === 'string' && /^[a-f\d]{64}$/u.test(value.sha256);
}

function validRuntimeExecutableResources(value, expectedPath, evidenceIdentity, expectedWebAssembly) {
	if (!record(value) || stableJson(Object.keys(value).sort())
		!== stableJson(['afterCollection', 'beforeLaunch', 'path', 'webAssemblyResources'])
		|| value.path !== expectedPath || !exactResourceIdentity(value.beforeLaunch)
		|| !exactResourceIdentity(value.afterCollection) || !exactResourceIdentity(evidenceIdentity)
		|| !exactWebAssemblyResources(value.webAssemblyResources)) return false;
	const evidenceWebAssembly = expectedWebAssembly?.map(({ packagedPath: path, byteLength, sha256 }) => (
		{ path, byteLength, sha256 }
	));
	return stableJson(value.beforeLaunch) === stableJson(value.afterCollection)
		&& stableJson(value.beforeLaunch) === stableJson(evidenceIdentity)
		&& stableJson(value.webAssemblyResources) === stableJson(evidenceWebAssembly);
}

function exactWebAssemblyResources(value) {
	return Array.isArray(value) && stableJson(value) === stableJson([...value].sort((left, right) => (
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	))) && value.every((entry) => record(entry)
		&& stableJson(Object.keys(entry).sort()) === stableJson(['byteLength', 'path', 'sha256'])
		&& typeof entry.path === 'string' && /\.wasm$/u.test(entry.path)
		&& exactFileIdentity({ byteLength: entry.byteLength, sha256: entry.sha256 }));
}

function exactResourceIdentity(value) {
	return record(value)
		&& stableJson(Object.keys(value).sort()) === stableJson(['fileCount', 'sha256', 'totalBytes'])
		&& Number.isSafeInteger(value.fileCount) && value.fileCount >= 0
		&& Number.isSafeInteger(value.totalBytes) && value.totalBytes >= 0
		&& typeof value.sha256 === 'string' && /^[a-f\d]{64}$/u.test(value.sha256);
}

function normalizedInstalledPath(path, platform) {
	const slashed = path.replaceAll('\\', '/');
	const unc = platform === 'win32' && slashed.startsWith('//');
	let normalized = slashed.replace(/\/{2,}/gu, '/').replace(/\/$/u, '');
	if (unc) normalized = `/${normalized}`;
	if (platform === 'win32' && /^\/[A-Za-z]:\//u.test(normalized)) normalized = normalized.slice(1);
	return normalized;
}

function origin(url) {
	try { return new URL(url).origin; } catch { return null; }
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
