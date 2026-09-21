/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import { E2E_PRODUCTS } from './e2e-coverage-build-evidence.mjs';

const SESSION_PATTERN = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/u;
const NODE_PROFILE_PATTERN = /^coverage-(\d+)-(\d+)-(\d+)\.json$/u;
const MANIFEST_FIELDS = Object.freeze([
	'architecture', 'captureKind', 'capturesChildTargets', 'cdpProfile',
	'childTargetStrategy', 'executableResources', 'hostExecutablePath', 'kind',
	'mainProcessId', 'nodeProfiles', 'pausedTargetCounts', 'platform', 'processExit',
	'productAppAsar', 'productExecutablePath', 'productId', 'schemaVersion', 'sessionId',
	'sourceRevision', 'targetCounts', 'targetTypes',
]);

export const LOCAL_ASSISTANCE_HARNESS_SCRIPTS = Object.freeze([
	'desktop/coverage-checkpoint-exit.mjs',
	'desktop/nightly-tests-assistance-host.mjs',
	'desktop/nightly-tests-main.mjs',
	'scripts/lib/desktop-packaged-product-executable.mjs',
]);

/** Read, authenticate, and classify every private local-assistance session. */
export function assembleLocalAssistanceRawProfiles({ directory, evidence, runRuntime }) {
	if (!existsSync(directory)) throw new Error('Nightly local-assistance coverage directory is missing.');
	const entries = readdirSync(directory, { withFileTypes: true })
		.sort((left, right) => left.name.localeCompare(right.name));
	if (entries.length === 0) throw new Error('Nightly local-assistance coverage has no sessions.');
	const sessions = entries.map((entry) => {
		if (entry.isSymbolicLink() || !entry.isDirectory() || !SESSION_PATTERN.test(entry.name)) {
			throw new Error(`Local-assistance coverage root contains invalid entry ${entry.name}.`);
		}
		return readSession(join(directory, entry.name), entry.name, evidence, runRuntime);
	});
	const products = new Set(sessions.map(({ runtime }) => runtime.productId));
	if (E2E_PRODUCTS.some((productId) => !products.has(productId))) {
		throw new Error('Local-assistance coverage does not identify both product runtimes.');
	}
	const profiles = new Map();
	const observed = new Map();
	for (const session of sessions) appendSessionProfiles(profiles, observed, session, evidence);
	for (const [surface, values] of profiles) {
		const cache = values[0]?.profile['source-map-cache'];
		for (const script of observed.values()) {
			if (script.sourceMap !== null
				&& surface === `nightly-electron-${script.productId}-${script.realm}`) {
				cache[script.coverageUrl] = script.sourceMap;
			}
		}
	}
	return profiles;
}

function readSession(directory, sessionId, evidence, runRuntime) {
	const manifestPath = join(directory, 'session.json');
	const manifest = readJson(manifestPath, `local-assistance session ${sessionId}`);
	const runtime = validateManifest(manifest, sessionId, evidence, runRuntime);
	validateClosedInventory(directory, manifest);
	const cdp = readRecordedProfile(directory, manifest.cdpProfile, 'CDP');
	const node = manifest.nodeProfiles.map((record) => ({
		name: record.fileName,
		profile: readRecordedProfile(directory, record, 'Node'),
		identity: nodeProfileIdentity(record.fileName),
	}));
	return Object.freeze({ cdp, directory, manifest, node, runtime, sessionId });
}

function validateManifest(value, sessionId, evidence, runRuntime) {
	if (!record(value) || stableJson(Object.keys(value).sort()) !== stableJson(MANIFEST_FIELDS)
		|| value.schemaVersion !== 1 || value.kind !== 'soundscaper-local-assistance-runtime'
		|| value.sessionId !== sessionId || !E2E_PRODUCTS.includes(value.productId)
		|| !['darwin', 'linux', 'win32'].includes(value.platform)
		|| !['arm64', 'x64'].includes(value.architecture)
		|| value.sourceRevision !== evidence.sourceRevision
		|| value.captureKind !== 'local-assistance-cdp-precise-coverage'
		|| value.capturesChildTargets !== true
		|| value.childTargetStrategy !== 'recursive-auto-attach-paused'
		|| !validTargetAccounting(value)
		|| !Number.isSafeInteger(value.mainProcessId) || value.mainProcessId <= 0
		|| stableJson(value.processExit) !== stableJson({ code: 0, signal: null })
		|| value.platform !== runRuntime?.platform || value.architecture !== runRuntime?.arch) {
		throw new Error(`Local-assistance session ${sessionId} has invalid runtime metadata.`);
	}
	const paths = value.platform === 'win32' ? win32 : posix;
	for (const path of [value.hostExecutablePath, value.productExecutablePath]) {
		if (typeof path !== 'string' || !paths.isAbsolute(path)) {
			throw new Error(`Local-assistance session ${sessionId} has a relative executable path.`);
		}
	}
	const aliasPath = value.productAppAsar?.path;
	if (typeof aliasPath !== 'string' || !paths.isAbsolute(aliasPath)) {
		throw new Error(`Local-assistance session ${sessionId} has an invalid product archive path.`);
	}
	const productRoot = paths.dirname(aliasPath);
	const payloadRoot = paths.join(resourcesPath(value.hostExecutablePath, value.platform), 'nightly-tests');
	if (aliasPath !== paths.join(productRoot, `${value.productId}.asar`)
		|| productRoot !== paths.join(payloadRoot, 'products')
		|| value.productExecutablePath !== packagedProductExecutable(
			productRoot, value.productId, value.platform, value.architecture,
		)) {
		throw new Error(`Local-assistance session ${sessionId} is detached from its product layout.`);
	}
	const productEvidence = evidence.electron.get(value.productId);
	if (!validIdentityWitness(value.productAppAsar, productEvidence.packageArchive)) {
		throw new Error(`Local-assistance session ${sessionId} has an invalid product archive identity.`);
	}
	const resources = resourcesPath(value.productExecutablePath, value.platform);
	if (!validResourceWitness(value.executableResources, resources, productEvidence.executableResources)) {
		throw new Error(`Local-assistance session ${sessionId} has an invalid executable-resource identity.`);
	}
	if (!fileRecord(value.cdpProfile) || value.cdpProfile.fileName !== 'cdp.json'
		|| !Array.isArray(value.nodeProfiles) || value.nodeProfiles.length === 0
		|| value.nodeProfiles.some((entry) => !fileRecord(entry) || !NODE_PROFILE_PATTERN.test(entry.fileName))
		|| stableJson(value.nodeProfiles.map(({ fileName }) => fileName))
			!== stableJson(value.nodeProfiles.map(({ fileName }) => fileName).toSorted())
		|| new Set(value.nodeProfiles.map(({ fileName }) => fileName)).size !== value.nodeProfiles.length) {
		throw new Error(`Local-assistance session ${sessionId} has an invalid raw profile inventory.`);
	}
	if (!value.nodeProfiles.some(({ fileName }) => {
		const identity = nodeProfileIdentity(fileName);
		return identity.pid === value.mainProcessId && identity.threadId === 0;
	})) throw new Error(`Local-assistance session ${sessionId} has no main-process thread 0 profile.`);
	return Object.freeze({
		alias: normalizedInstalledPath(aliasPath, value.platform),
		hostAppAsar: normalizedInstalledPath(hostAppAsar(value.hostExecutablePath, value.platform), value.platform),
		hostResources: normalizedInstalledPath(
			resourcesPath(value.hostExecutablePath, value.platform), value.platform,
		),
		mainProcessId: value.mainProcessId,
		payloadRoot: normalizedInstalledPath(payloadRoot, value.platform),
		platform: value.platform,
		productId: value.productId,
		resources: normalizedInstalledPath(resources, value.platform),
	});
}

function validateClosedInventory(directory, manifest) {
	const entries = readdirSync(directory, { withFileTypes: true })
		.sort((left, right) => left.name.localeCompare(right.name));
	if (entries.some((entry) => entry.isSymbolicLink() || !entry.isFile())) {
		throw new Error(`Local-assistance session ${manifest.sessionId} contains a non-file entry.`);
	}
	const expected = ['session.json', manifest.cdpProfile.fileName,
		...manifest.nodeProfiles.map(({ fileName }) => fileName)].sort();
	if (stableJson(entries.map(({ name }) => name)) !== stableJson(expected)) {
		throw new Error(`Local-assistance session ${manifest.sessionId} has an incomplete raw profile inventory.`);
	}
}

function readRecordedProfile(directory, descriptor, label) {
	const path = join(directory, descriptor.fileName);
	const bytes = readFileSync(path);
	if (bytes.byteLength !== descriptor.byteLength || hash(bytes) !== descriptor.sha256) {
		throw new Error(`Local-assistance ${label} profile ${descriptor.fileName} differs from its inventory.`);
	}
	const profile = parseJson(bytes, `local-assistance ${label} profile ${descriptor.fileName}`);
	resultEntries(profile.result, `${label} profile ${descriptor.fileName}`);
	return profile;
}

function appendSessionProfiles(profiles, observed, session, evidence) {
	const observedMain = new Set();
	const cdpClassified = classifyCdpProfile(session, evidence);
	appendClassified(profiles, observed, cdpClassified, `local-cdp-${session.sessionId}`);
	for (const node of session.node) {
		const classified = resultEntries(node.profile.result, `Node profile ${node.name}`)
			.map((entry) => classifyNodeEntry(entry, session.runtime, evidence));
		if (node.identity.pid === session.runtime.mainProcessId && node.identity.threadId === 0) {
			for (const match of classified) {
				if (match?.script.realm === 'main') observedMain.add(match.script.coverageUrl);
			}
		}
		appendClassified(profiles, observed, classified, `local-node-${session.sessionId}-${node.name}`);
	}
	if (observedMain.size === 0) {
		throw new Error(`Local-assistance session ${session.sessionId} main profile recorded no product main code.`);
	}
}

function classifyCdpProfile(session, evidence) {
	const cache = session.cdp['script-source-cache'];
	if (!exactKeys(session.cdp, ['result', 'script-source-cache', 'source-map-cache'])
		|| !record(cache) || Object.values(cache).some((source) => typeof source !== 'string')
		|| !record(session.cdp['source-map-cache'])
		|| Object.keys(session.cdp['source-map-cache']).length !== 0) {
		throw new Error(`Local-assistance session ${session.sessionId} has an invalid script-source cache.`);
	}
	const entries = resultEntries(session.cdp.result, `CDP profile ${session.sessionId}`);
	const observed = new Set(entries.map(({ url }) => url));
	for (const url of Object.keys(cache)) {
		if (!observed.has(url)) throw new Error(`Local-assistance source cache has no V8 entry for ${url}.`);
	}
	const classified = entries.map((entry) => classifyCdpEntry(entry, cache, session.runtime, evidence));
	if (!classified.some((match) => match?.script.realm === 'preload')) {
		throw new Error(`Local-assistance session ${session.sessionId} recorded no product preload code.`);
	}
	return classified;
}

function classifyCdpEntry(entry, cache, runtime, evidence) {
	const packagedPath = aliasedPackagedPath(entry.url, runtime);
	if (packagedPath !== null) {
		const script = evidence.electron.get(runtime.productId).scriptsByPackagedPath.get(packagedPath);
		if (!script || script.realm !== 'preload') {
			throw new Error(`Local-assistance CDP coverage has an unmapped product script ${entry.url}.`);
		}
		if (cache[entry.url] !== script.source) {
			throw new Error(`Local-assistance coverage script bytes are stale for ${entry.url}.`);
		}
		return ownedMatch(entry, script);
	}
	const excluded = excludedResource(entry.url, runtime, evidence);
	if (excluded !== null) {
		authenticateExcludedSource(cache[entry.url], excluded, entry.url);
		return null;
	}
	if (productResourceScript(entry.url, runtime)) {
		throw new Error(`Local-assistance CDP coverage has an un-inventoried product resource ${entry.url}.`);
	}
	if (entry.url === '__playwright_evaluation_script__') return null;
	throw new Error(`Local-assistance CDP coverage has an unapproved host script ${entry.url}.`);
}

function classifyNodeEntry(entry, runtime, evidence) {
	const packagedPath = aliasedPackagedPath(entry.url, runtime);
	if (packagedPath !== null) {
		const script = evidence.electron.get(runtime.productId).scriptsByPackagedPath.get(packagedPath);
		if (!script) throw new Error(`Local-assistance Node coverage has an unmapped product script ${entry.url}.`);
		if (script.realm === 'renderer') {
			throw new Error(`Local-assistance Node coverage unexpectedly loaded renderer script ${entry.url}.`);
		}
		return ownedMatch(entry, script);
	}
	if (excludedResource(entry.url, runtime, evidence) !== null) return null;
	if (productResourceScript(entry.url, runtime)) {
		throw new Error(`Local-assistance Node coverage has an un-inventoried product resource ${entry.url}.`);
	}
	const installed = installedFilePath(entry.url, runtime.platform);
	if (installed === null) {
		if (entry.url === '' || isCanonicalNodeInternalUrl(entry.url)) return null;
		throw new Error(`Local-assistance Node coverage has an unapproved non-file script ${entry.url}.`);
	}
	const hostPrefix = `${runtime.hostAppAsar}/`;
	if (pathStartsWith(installed, hostPrefix, runtime.platform)) {
		const relativePath = installed.slice(hostPrefix.length);
		if (!LOCAL_ASSISTANCE_HARNESS_SCRIPTS.includes(relativePath)) {
			throw new Error(`Local-assistance Node coverage has an unapproved launcher script ${entry.url}.`);
		}
		return null;
	}
	if (isAuthenticatedElectronInternalUrl(
		entry.url, runtime.platform, [runtime.hostResources, runtime.resources],
	)) return null;
	if (pathStartsWith(installed, `${runtime.payloadRoot}/`, runtime.platform)) {
		throw new Error(`Local-assistance Node coverage has an unapproved staged script ${entry.url}.`);
	}
	throw new Error(`Local-assistance Node coverage has an unapproved absolute script ${entry.url}.`);
}

export function isCanonicalNodeInternalUrl(url) {
	if (!/^node:[A-Za-z\d_./-]+$/u.test(url)) return false;
	return !url.slice('node:'.length).split('/').some((part) => part === '' || part === '.' || part === '..');
}

export function isAuthenticatedElectronInternalUrl(url, platform, resourceRoots) {
	const path = installedFilePath(url, platform);
	if (path === null) return false;
	for (const root of resourceRoots) {
		const prefix = `${root}/`;
		if (!pathStartsWith(path, prefix, platform)) continue;
		const relativePath = path.slice(prefix.length);
		if (relativePath.split('/').some((part) => part === '' || part === '.' || part === '..')) return false;
		if (/^(?:default_app|electron)\.asar\//iu.test(relativePath)) return true;
	}
	return false;
}

function appendClassified(profiles, observed, values, prefix) {
	const grouped = new Map();
	for (const value of values) {
		if (value === null) continue;
		observed.set(value.script.coverageUrl, value.script);
		const list = grouped.get(value.surface) ?? [];
		list.push(value.entry);
		grouped.set(value.surface, list);
	}
	for (const [surface, result] of grouped) {
		const list = profiles.get(surface) ?? [];
		list.push({ name: safeName(`${prefix}-${surface}.json`),
			profile: { result, 'source-map-cache': {} } });
		profiles.set(surface, list);
	}
}

function ownedMatch(entry, script) {
	if (!script.owned) return null;
	return { entry: { ...entry, url: script.coverageUrl }, script,
		surface: `nightly-electron-${script.productId}-${script.realm}` };
}

function aliasedPackagedPath(url, runtime) {
	const path = installedFilePath(url, runtime.platform);
	if (path === null) return null;
	const prefix = `${runtime.alias}/`;
	if (!pathStartsWith(path, prefix, runtime.platform)) return null;
	return `app.asar/${path.slice(prefix.length)}`;
}

function excludedResource(url, runtime, evidence) {
	const path = resourceRelativePath(url, runtime);
	return path === null ? null
		: evidence.electron.get(runtime.productId).excludedRuntimeScriptsByPath.get(path) ?? null;
}

function productResourceScript(url, runtime) {
	const path = resourceRelativePath(url, runtime);
	return path !== null && !/^(?:default_app|electron)\.asar\//iu.test(path);
}

function resourceRelativePath(url, runtime) {
	const path = installedFilePath(url, runtime.platform);
	if (path === null) return null;
	const prefix = `${runtime.resources}/`;
	return pathStartsWith(path, prefix, runtime.platform) ? path.slice(prefix.length) : null;
}

function installedFilePath(url, platform) {
	if (typeof url !== 'string') return null;
	const paths = platform === 'win32' ? win32 : posix;
	let path;
	if (url.startsWith('file:')) {
		try { path = fileURLToPath(url, { windows: platform === 'win32' }); }
		catch { return null; }
	} else if (paths.isAbsolute(url)) path = url;
	else return null;
	return normalizedInstalledPath(path, platform);
}

function normalizedInstalledPath(path, platform) {
	const slashed = path.replaceAll('\\', '/');
	const unc = platform === 'win32' && slashed.startsWith('//');
	let normalized = slashed.replace(/\/{2,}/gu, '/').replace(/\/$/u, '');
	if (unc) normalized = `/${normalized}`;
	if (platform === 'win32' && /^\/[A-Za-z]:\//u.test(normalized)) normalized = normalized.slice(1);
	return normalized;
}

function pathStartsWith(path, prefix, platform) {
	return platform === 'win32'
		? path.toLowerCase().startsWith(prefix.toLowerCase())
		: path.startsWith(prefix);
}

function resourcesPath(executable, platform) {
	const paths = platform === 'win32' ? win32 : posix;
	return platform === 'darwin'
		? paths.resolve(paths.dirname(executable), '../Resources')
		: paths.resolve(paths.dirname(executable), 'resources');
}

function packagedProductExecutable(productRoot, productId, platform, architecture) {
	const paths = platform === 'win32' ? win32 : posix;
	const displayName = productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	const root = paths.join(productRoot, productId);
	if (platform === 'win32') return paths.join(root,
		`win${architecture === 'x64' ? '' : `-${architecture}`}-unpacked`, `${displayName}.exe`);
	if (platform === 'darwin') return paths.join(root,
		`mac${architecture === 'x64' ? '' : `-${architecture}`}`, `${displayName}.app`,
		'Contents', 'MacOS', displayName);
	return paths.join(root, `linux${architecture === 'x64' ? '' : `-${architecture}`}-unpacked`, productId);
}

function hostAppAsar(executable, platform) {
	return joinPlatform(platform, resourcesPath(executable, platform), 'app.asar');
}

function joinPlatform(platform, ...parts) {
	return (platform === 'win32' ? win32 : posix).join(...parts);
}

function validIdentityWitness(value, expected) {
	return record(value) && exactKeys(value, ['afterCollection', 'beforeLaunch', 'path'])
		&& stableJson(value.beforeLaunch) === stableJson(expected)
		&& stableJson(value.afterCollection) === stableJson(expected);
}

function validResourceWitness(value, path, expected) {
	return validIdentityWitness(value, expected) && value.path === path;
}

function validTargetAccounting(value) {
	return Array.isArray(value.targetTypes)
		&& stableJson(value.targetTypes) === stableJson([...new Set(value.targetTypes)].sort())
		&& countRecord(value.targetCounts) && countRecord(value.pausedTargetCounts)
		&& stableJson(value.targetTypes) === stableJson(Object.keys(value.targetCounts).sort())
		&& Object.entries(value.pausedTargetCounts).every(([type, count]) => count <= (value.targetCounts[type] ?? -1));
}

function countRecord(value) {
	return record(value) && Object.entries(value).every(([type, count]) =>
		type !== '' && Number.isSafeInteger(count) && count > 0);
}

function authenticateExcludedSource(source, descriptor, url) {
	const bytes = typeof source === 'string' ? Buffer.from(source) : null;
	if (bytes === null || bytes.byteLength !== descriptor.byteLength || hash(bytes) !== descriptor.sha256) {
		throw new Error(`Local-assistance excluded runtime script bytes are stale for ${url}.`);
	}
}

function nodeProfileIdentity(name) {
	const match = NODE_PROFILE_PATTERN.exec(name);
	if (match === null) throw new Error(`Local-assistance Node profile ${name} has an invalid filename.`);
	return { pid: Number(match[1]), threadId: Number(match[3]) };
}

function resultEntries(value, label) {
	if (!Array.isArray(value) || value.some((entry) => !record(entry)
		|| typeof entry.url !== 'string' || !Array.isArray(entry.functions))) {
		throw new Error(`Local-assistance ${label} has no valid V8 result array.`);
	}
	return value;
}

function fileRecord(value) {
	return record(value) && exactKeys(value, ['byteLength', 'fileName', 'sha256'])
		&& typeof value.fileName === 'string' && !value.fileName.includes('/') && !value.fileName.includes('\\')
		&& Number.isSafeInteger(value.byteLength) && value.byteLength > 0
		&& typeof value.sha256 === 'string' && /^[a-f\d]{64}$/u.test(value.sha256);
}

function exactKeys(value, keys) {
	return stableJson(Object.keys(value).sort()) === stableJson([...keys].sort());
}

function safeName(value) {
	return value.replaceAll(/[^A-Za-z0-9._-]+/gu, '-').slice(0, 180);
}

function readJson(path, label) {
	return parseJson(readFileSync(path), label);
}

function parseJson(bytes, label) {
	try { return JSON.parse(bytes.toString('utf8')); }
	catch (cause) { throw new Error(`The ${label} is not readable JSON.`, { cause }); }
}

function hash(value) {
	return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (record(value)) return `{${Object.keys(value).sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
	return JSON.stringify(value);
}

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
