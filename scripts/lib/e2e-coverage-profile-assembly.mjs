/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	E2E_REPOSITORY_URL_PREFIX,
} from './e2e-coverage-contract.mjs';
import { E2E_PRODUCTS, normalizeE2ESourceMap } from './e2e-coverage-build-evidence.mjs';
import { validateDesktopRendererDynamicSource } from '../../desktop/renderer-smoke-execution.js';

const SCRIPT_PATTERN = /\.(?:c|m)?js$/u;

export function assembleE2ERawProfiles({ runRoot, evidence, repositoryRoot }) {
	const profiles = new Map(requiredSurfaceIds().map((surface) => [surface, []]));
	assembleBrowserProfiles({
		directory: join(runRoot, 'coverage/v8-browser'),
		evidence,
		profiles,
		repositoryRoot,
	});
	assemblePackagedProfiles({
		directory: join(runRoot, 'coverage/v8-packaged'),
		evidence,
		profiles,
		repositoryRoot,
	});
	return profiles;
}

function assembleBrowserProfiles({ directory, evidence, profiles, repositoryRoot }) {
	const files = readProfiles(directory, 'browser');
	const scriptsByUrl = new Map([...evidence.browser.values()].flatMap(({ scripts }) => (
		scripts.map((script) => [script.coverageUrl, script])
	)));
	const suppliedMaps = new Map();
	for (const { name, profile } of files) {
		for (const [url, cache] of Object.entries(profile['source-map-cache'] ?? {})) {
			const script = scriptsByUrl.get(url);
			if (!script) throw new Error(`Browser coverage has an unmapped first-party browser script ${url}.`);
			if (script.fullSourceMap === null) {
				throw new Error(`Unmapped browser executable ${url} unexpectedly supplied a source map.`);
			}
			const normalized = normalizeRawCache(
				cache,
				script,
				repositoryRoot,
				evidence.sourceRevision,
				`browser profile ${name}`,
			);
			const previous = suppliedMaps.get(url);
			if (previous !== undefined && stableJson(previous) !== stableJson(normalized)) {
				throw new Error(`Browser coverage supplied conflicting source maps for ${url}.`);
			}
			suppliedMaps.set(url, normalized);
		}
	}
	const observed = new Map();
	for (const { name, profile } of files) {
		const grouped = groupEntries(profile.result, (entry) => {
			const script = scriptsByUrl.get(entry.url);
			if (!script) {
				throw new Error(`Browser coverage has an unmapped first-party browser script ${String(entry.url)}.`);
			}
			if (script.sourceMap !== null && !suppliedMaps.has(script.coverageUrl)) {
				throw new Error(`Mapped browser executable ${script.coverageUrl} supplied no source-map evidence.`);
			}
			if (!script.owned) return null;
			return {
				entry: { ...entry, url: script.coverageUrl },
				script,
				surface: browserSurface(script.productId),
			};
		});
		appendGroupedProfiles(profiles, grouped, `browser-${name}`, observed);
	}
	attachObservedMaps(profiles, observed);
}

function assemblePackagedProfiles({ directory, evidence, profiles, repositoryRoot }) {
	const files = readProfiles(directory, 'packaged');
	const cdp = files.filter(({ profile }) => profile['soundscaper-packaged-runtime'] !== undefined);
	const runtimes = cdp.map(({ name, profile }) => packagedRuntime(profile, name));
	if (new Set(runtimes.map(({ productId }) => productId)).size !== E2E_PRODUCTS.length) {
		throw new Error('Packaged coverage does not identify both product runtimes.');
	}
	const observed = new Map();
	for (const { name, profile } of cdp) {
		const runtime = packagedRuntime(profile, name);
		const grouped = groupEntries(profile.result, (entry) => classifyCdpEntry({
			entry,
			evidence,
			profile,
			runtime,
		}));
		appendGroupedProfiles(profiles, grouped, `packaged-cdp-${name}`, observed);
	}
	for (const { name, profile } of files.filter(({ profile }) => (
		profile['soundscaper-packaged-runtime'] === undefined
	))) {
		const classified = [];
		for (const entry of resultEntries(profile.result, `packaged profile ${name}`)) {
			const match = classifyNodeEntry(entry, evidence, runtimes, repositoryRoot);
			if (match !== null) classified.push(match);
		}
		if (classified.length === 0) continue;
		const pidProduct = productForProfilePid(name, runtimes);
		if (pidProduct !== null && classified.some(({ script }) => script.productId !== pidProduct)) {
			throw new Error(`Packaged Node profile ${name} disagrees with its recorded product process.`);
		}
		appendGroupedProfiles(
			profiles,
			groupClassified(classified),
			`packaged-node-${name}`,
			observed,
		);
	}
	attachObservedMaps(profiles, observed);
}

function classifyCdpEntry({ entry, evidence, profile, runtime }) {
	const { productId } = runtime;
	let script;
	let surface;
	if (entry.url.startsWith(`${runtime.appOrigin}/`)) {
		const path = decodedUrlPath(entry.url);
		if (path.startsWith('__e2e-excluded__/')) {
			validateDesktopRendererDynamicSource({
				path,
				productId,
				source: profile['script-source-cache']?.[entry.url],
			});
			return null;
		}
		script = evidence.electron.get(productId).scriptsByArtifactPath.get(`renderer/${path}`);
		surface = electronSurface(productId, 'renderer');
	} else if (origin(entry.url) === runtime.baseOrigin) {
		const path = decodedUrlPath(entry.url);
		script = evidence.browser.get(productId).electronScriptsByPath.get(path);
		surface = electronSurface(productId, 'renderer');
	} else {
		const installed = installedPackagedPath(entry.url, runtime);
		if (installed !== null) {
			script = evidence.electron.get(productId).scriptsByPackagedPath.get(installed);
			if (script?.realm !== 'preload') script = undefined;
			surface = electronSurface(productId, 'preload');
		}
	}
	if (!script) throw new Error(`Packaged coverage has an unmapped first-party packaged script ${String(entry.url)}.`);
	const captured = profile['script-source-cache']?.[entry.url];
	if (captured !== script.source) {
		throw new Error(`Packaged coverage script bytes are stale for ${entry.url}.`);
	}
	if (!script.owned) return null;
	return { entry: { ...entry, url: script.coverageUrl }, script, surface };
}

function classifyNodeEntry(entry, evidence, runtimes, repositoryRoot) {
	// NODE_V8_COVERAGE carries URLs and ranges, but no script-source cache. Bind
	// those URLs to the exact preserved installed path; the evidence manifest,
	// rather than the raw profile alone, authenticates the executable bytes.
	if (entry.url.startsWith('data:')) {
		attestPinnedVendorDataUrl(entry.url, ffmpegCoreJavascriptPin(repositoryRoot));
		return null;
	}
	const matches = [];
	for (const runtime of runtimes) {
		const packagedPath = installedPackagedPath(entry.url, runtime);
		if (packagedPath === null) {
			if (productResourceScript(entry.url, runtime)) {
				throw new Error(`Packaged coverage has an un-inventoried product resource script ${entry.url}.`);
			}
			continue;
		}
		const script = evidence.electron.get(runtime.productId).scriptsByPackagedPath.get(packagedPath);
		if (!script) {
			throw new Error(`Packaged coverage has an unmapped first-party packaged script ${entry.url}.`);
		}
		if (script.realm === 'renderer') {
			throw new Error(`Packaged Node coverage unexpectedly loaded renderer script ${entry.url}.`);
		}
		matches.push({
			entry: { ...entry, url: script.coverageUrl },
			script,
			surface: electronSurface(runtime.productId, script.realm),
		});
	}
	const unique = uniqueMatches(matches);
	if (unique.length > 1) throw new Error(`Packaged script ${entry.url} matches more than one product runtime.`);
	return unique[0] ?? null;
}

/** Decode a source-less vendor module and bind it to the exact shipped pin. */
export function attestPinnedVendorDataUrl(url, descriptor) {
	if (typeof url !== 'string' || !url.startsWith('data:')) return false;
	const prefix = 'data:text/javascript;base64,';
	if (!url.startsWith(prefix) || !descriptor || typeof descriptor !== 'object') {
		throw new Error('Packaged coverage contains an unapproved dynamic data: script.');
	}
	const encoded = url.slice(prefix.length);
	if (encoded === '' || !/^[A-Za-z\d+/]+={0,2}$/u.test(encoded)) {
		throw new Error('Packaged coverage contains a non-canonical vendor data: script.');
	}
	const bytes = Buffer.from(encoded, 'base64');
	if (bytes.toString('base64') !== encoded
		|| bytes.byteLength !== descriptor.byteLength
		|| createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) {
		throw new Error('Packaged coverage vendor data: script does not match the pinned FFmpeg JavaScript.');
	}
	return true;
}

function ffmpegCoreJavascriptPin(repositoryRoot) {
	const manifest = readJson(
		resolve(repositoryRoot, 'config/ffmpeg-runtime-manifest.json'),
		'FFmpeg runtime manifest',
	);
	const descriptor = manifest?.runtime?.files?.find(({ name }) => name === 'ffmpeg-core.js');
	if (!descriptor || !Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength <= 0
		|| typeof descriptor.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(descriptor.sha256)) {
		throw new Error('FFmpeg runtime manifest has no pinned JavaScript payload.');
	}
	return Object.freeze({ byteLength: descriptor.byteLength, sha256: descriptor.sha256 });
}

function packagedRuntime(profile, name) {
	const value = profile['soundscaper-packaged-runtime'];
	if (!record(value) || value.schemaVersion !== 1 || !E2E_PRODUCTS.includes(value.productId)
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
	const resourcesPath = value.platform === 'darwin'
		? paths.resolve(paths.dirname(executable), '../Resources')
		: paths.resolve(paths.dirname(executable), 'resources');
	const resources = normalizedInstalledPath(resourcesPath, value.platform);
	return Object.freeze({
		appAsar: `${resources}/app.asar`,
		appOrigin: value.appOrigin,
		baseOrigin: value.baseOrigin,
		platform: value.platform,
		processId: value.processId,
		productId: value.productId,
		resources,
	});
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

function installedPackagedPath(url, runtime) {
	const pathname = installedFilePath(url, runtime.platform);
	if (pathname === null) return null;
	const prefix = `${runtime.appAsar}/`;
	const comparison = runtime.platform === 'win32' ? pathname.toLowerCase() : pathname;
	const expected = runtime.platform === 'win32' ? prefix.toLowerCase() : prefix;
	if (!comparison.startsWith(expected)) return null;
	return `app.asar/${pathname.slice(prefix.length)}`;
}

function installedFilePath(url, platform) {
	if (typeof url !== 'string') return null;
	const paths = platform === 'win32' ? win32 : posix;
	let pathname;
	if (url.startsWith('file:')) {
		try { pathname = fileURLToPath(url, { windows: platform === 'win32' }); }
		catch { return null; }
	} else {
		if (!paths.isAbsolute(url)) return null;
		pathname = url;
	}
	return normalizedInstalledPath(pathname, platform);
}

function productResourceScript(url, runtime) {
	const path = installedFilePath(url, runtime.platform);
	if (path === null || !SCRIPT_PATTERN.test(path)) return false;
	const actual = runtime.platform === 'win32' ? path.toLowerCase() : path;
	const root = runtime.platform === 'win32' ? runtime.resources.toLowerCase() : runtime.resources;
	if (!actual.startsWith(`${root}/`)) return false;
	const relativePath = actual.slice(root.length + 1);
	return !/^(?:default_app|electron)\.asar\//u.test(relativePath);
}

function normalizedInstalledPath(path, platform) {
	const slashed = path.replaceAll('\\', '/');
	const unc = platform === 'win32' && slashed.startsWith('//');
	let normalized = slashed.replace(/\/{2,}/gu, '/').replace(/\/$/u, '');
	if (unc) normalized = `/${normalized}`;
	if (platform === 'win32' && /^\/[A-Za-z]:\//u.test(normalized)) normalized = normalized.slice(1);
	return normalized;
}

function normalizeRawCache(cache, script, repositoryRoot, sourceRevision, label) {
	if (!record(cache) || !Array.isArray(cache.lineLengths) || !record(cache.data)) {
		throw new Error(`${label} has an invalid source-map cache for ${script.coverageUrl}.`);
	}
	validatePortableRepositorySources(cache.data, repositoryRoot, label);
	const normalized = normalizeE2ESourceMap(cache.data, repositoryRoot, label, sourceRevision);
	if (stableJson(normalized.map) !== stableJson(script.fullSourceMap)
		|| stableJson(cache.lineLengths) !== stableJson(sourceLineLengths(script.source))) {
		throw new Error(`${label} source map is stale for ${script.coverageUrl}.`);
	}
	return script.sourceMap;
}

function validatePortableRepositorySources(map, repositoryRoot, label) {
	if (!Array.isArray(map.sources)) return;
	for (const [index, source] of map.sources.entries()) {
		if (typeof source !== 'string') continue;
		if (!source.startsWith(E2E_REPOSITORY_URL_PREFIX)) {
			let pathname = '';
			try { pathname = decodeURIComponent(new URL(source).pathname).replaceAll('\\', '/'); }
			catch { /* A virtual or package source is not repository-owned. */ }
			if (!pathname.includes('/node_modules/') && !pathname.includes('/vendor/')
				&& /(?:^|\/)(?:src|desktop)\//u.test(pathname)) {
				throw new Error(`${label} has a non-portable repository source ${source}.`);
			}
			continue;
		}
		const path = decodeURIComponent(source.slice(E2E_REPOSITORY_URL_PREFIX.length));
		if ((!path.startsWith('src/') && !path.startsWith('desktop/'))
			|| path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
			throw new Error(`${label} has an unsafe portable repository source ${source}.`);
		}
		const content = map.sourcesContent?.[index];
		if (content !== readFileSync(resolve(repositoryRoot, path), 'utf8')) {
			throw new Error(`${label} has stale embedded source bytes for ${source}.`);
		}
	}
}

function appendGroupedProfiles(profiles, grouped, name, observed) {
	for (const [surface, classified] of grouped) {
		for (const { script } of classified) observed.set(script.coverageUrl, script);
		profiles.get(surface).push({
			name: safeProfileName(`${name}-${surface}.json`),
			profile: { result: classified.map(({ entry }) => entry), 'source-map-cache': {} },
		});
	}
}

function attachObservedMaps(profiles, observed) {
	for (const [surface, surfaceProfiles] of profiles) {
		if (surfaceProfiles.length === 0) continue;
		const cache = surfaceProfiles[0].profile['source-map-cache'];
		for (const script of observed.values()) {
			if (script.sourceMap !== null && surfaceForScript(script) === surface) {
				cache[script.coverageUrl] = script.sourceMap;
			}
		}
	}
}

function groupEntries(entries, classify) {
	return groupClassified(resultEntries(entries, 'coverage profile').map(classify));
}

function groupClassified(classified) {
	const grouped = new Map();
	for (const value of classified) {
		if (value === null) continue;
		const values = grouped.get(value.surface) ?? [];
		values.push(value);
		grouped.set(value.surface, values);
	}
	return grouped;
}

function resultEntries(value, label) {
	if (!Array.isArray(value)) throw new Error(`${label} has no V8 result array.`);
	for (const entry of value) {
		if (!record(entry) || typeof entry.url !== 'string' || !Array.isArray(entry.functions)) {
			throw new Error(`${label} has an invalid V8 result entry.`);
		}
	}
	return value;
}

function readProfiles(directory, label) {
	if (!existsSync(directory)) throw new Error(`Nightly ${label} coverage directory is missing.`);
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
		.sort((left, right) => left.name.localeCompare(right.name))
		.map(({ name }) => ({ name, profile: readJson(join(directory, name), `${label} profile ${name}`) }));
}

function productForProfilePid(name, runtimes) {
	const match = /^coverage-(\d+)-/u.exec(name);
	if (match === null) return null;
	const products = new Set(runtimes
		.filter(({ processId }) => processId === Number(match[1]))
		.map(({ productId }) => productId));
	if (products.size > 1) throw new Error(`Packaged process ${match[1]} identifies two products.`);
	return [...products][0] ?? null;
}

function uniqueMatches(matches) {
	return [...new Map(matches.map((match) => [
		`${match.script.productId}:${match.script.artifactPath}`,
		match,
	])).values()];
}

function surfaceForScript(script) {
	return script.runtime === 'browser'
		? browserSurface(script.productId)
		: electronSurface(script.productId, script.realm);
}

function browserSurface(productId) {
	return `browser-chromium-${productId}-renderer`;
}

function electronSurface(productId, realm) {
	return `nightly-electron-${productId}-${realm}`;
}

function requiredSurfaceIds() {
	return E2E_PRODUCTS.flatMap((productId) => [
		browserSurface(productId),
		electronSurface(productId, 'main'),
		electronSurface(productId, 'preload'),
		electronSurface(productId, 'renderer'),
	]).sort();
}

function decodedUrlPath(url) {
	return decodeURIComponent(new URL(url).pathname).replaceAll('\\', '/').replace(/^\/+/u, '');
}

function origin(url) {
	try { return new URL(url).origin; } catch { return null; }
}

function safeProfileName(value) {
	return value.replaceAll(/[^A-Za-z0-9._-]+/gu, '-').slice(0, 180);
}

function sourceLineLengths(value) {
	const lines = String(value).split('\n');
	if (lines.length > 1 && lines.at(-1) === '') lines.pop();
	return lines.map((line) => line.length);
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function readJson(path, label) {
	try { return JSON.parse(readFileSync(path, 'utf8')); }
	catch (error) { throw new Error(`The ${label} is not readable JSON.`, { cause: error }); }
}

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
