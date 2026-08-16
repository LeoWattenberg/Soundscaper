/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The generic native-payload provenance pipeline milestone 5A-0b owns.
 *
 * `native/soundscaper-helper-addon/source-manifest.json` is the single truth
 * about what was built from which sources by which toolchain, but `native/` is
 * never packaged. `config/native-addon-payload-manifest.json` is the derived
 * copy that ships inside the fuse-protected asar, so the packaged application
 * reads its pins from bytes the asar integrity fuse protects while the payload
 * itself lives outside the asar as a verified extraResource. That split is the
 * same argument the FFmpeg runtime already makes, generalized to one payload
 * per target.
 *
 * A target whose payload has not been built is not an error: it stages no
 * payload, reports itself unavailable at runtime, and leaves a truthful Web
 * Core editor. What is an error is a target that claims to be built and cannot
 * produce exactly its pinned bytes.
 */

import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import {
	NATIVE_HELPER_ADDON_ROOT,
	NATIVE_HELPER_ADDON_TARGETS,
	nativeHelperAddonTargetForRuntime,
	readNativeHelperAddonSourceManifest,
} from './native-helper-addon-build.mjs';

export const NATIVE_ADDON_PAYLOAD_MANIFEST_PATH = 'config/native-addon-payload-manifest.json';
export const NATIVE_ADDON_STAGED_MANIFEST_NAME = 'native-addon-payload-manifest.json';
export const NATIVE_ADDON_RUNTIME_PREFIX = 'native';

const VERIFIED_RELEASES = new WeakSet();
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const MAXIMUM_PAYLOAD_BYTES = 64 * 1024 * 1024;

export { NATIVE_HELPER_ADDON_TARGETS, nativeHelperAddonTargetForRuntime };

/**
 * Derives the shipped manifest from the source manifest. Keeping the packaged
 * copy generated rather than hand-maintained means there is exactly one place
 * to record a build, and the audit proves the two agree byte for byte.
 */
export function deriveNativeAddonPayloadManifest(sourceManifest) {
	return {
		schemaVersion: 1,
		id: `${'soundscaper-helper-addon'}-${sourceManifest.addonVersion}`,
		addon: {
			name: 'soundscaper-helper-addon',
			version: sourceManifest.addonVersion,
			napiVersion: sourceManifest.napiVersion,
			license: sourceManifest.license,
			payloadName: sourceManifest.payloadName,
			sourceManifestPath: `${NATIVE_HELPER_ADDON_ROOT}/source-manifest.json`,
		},
		staging: { runtimePrefix: NATIVE_ADDON_RUNTIME_PREFIX, manifestName: NATIVE_ADDON_STAGED_MANIFEST_NAME },
		security: {
			matrixPath: 'config/production-security-matrix.json',
			riskId: 'native-helper-processes',
			controlId: 'verified-native-helper-payload-selection',
		},
		targets: NATIVE_HELPER_ADDON_TARGETS.map(({ id, runtime }) => {
			const record = sourceManifest.targets[id];
			const [platform, architecture] = runtime.split('-');
			return record.status === 'built'
				? {
					id,
					platform,
					arch: architecture,
					status: 'built',
					blockedBy: null,
					toolchainIdentity: record.toolchainIdentity,
					payload: {
						path: `${NATIVE_HELPER_ADDON_ROOT}/prebuilt/${id}/${sourceManifest.payloadName}`,
						byteLength: record.payload.byteLength,
						sha256: record.payload.sha256,
					},
				}
				: {
					id,
					platform,
					arch: architecture,
					status: 'pending-external',
					blockedBy: record.blockedBy,
					toolchainIdentity: null,
					payload: null,
				};
		}),
	};
}

/**
 * Resolves which target a staging run is packaging for. A declared target — the
 * one CI stamps into the environment — always wins. Falling back to the build
 * host is only ever right for a local build of the machine you are sitting at,
 * so the fallback is recorded as such and release assembly refuses it.
 */
export function resolveNativeAddonPayloadTarget({
	platform = null,
	arch = null,
	hostPlatform = process.platform,
	hostArch = process.arch,
} = {}) {
	const declaredPlatform = typeof platform === 'string' ? platform.trim() : '';
	const declaredArch = typeof arch === 'string' ? arch.trim() : '';
	if (declaredPlatform && declaredArch) {
		const declared = NATIVE_HELPER_ADDON_TARGETS.find(({ id }) => id === `${declaredPlatform}-${declaredArch}`);
		assert(declared, `The declared desktop target ${declaredPlatform}-${declaredArch} is not a claimed milestone-5A target.`);
		return Object.freeze({ id: declared.id, source: 'declared' });
	}
	assert(!declaredPlatform && !declaredArch,
		'A desktop target must declare both its platform and its architecture, or neither.');
	const host = nativeHelperAddonTargetForRuntime(hostPlatform, hostArch);
	assert(host, `The build host ${hostPlatform}-${hostArch} is not a claimed milestone-5A target.`);
	return Object.freeze({ id: host.id, source: 'build-host' });
}

export function serializeNativeAddonPayloadManifest(manifest) {
	return `${JSON.stringify(manifest, null, '\t')}\n`;
}

export async function repinNativeAddonPayloadManifest({ repositoryRoot }) {
	const derived = deriveNativeAddonPayloadManifest(readNativeHelperAddonSourceManifest(repositoryRoot));
	const text = serializeNativeAddonPayloadManifest(derived);
	await writeFile(resolve(repositoryRoot, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH), text);
	return derived;
}

/**
 * Verifies the shipped manifest against the source manifest and, when the
 * selected target is built, against the payload bytes on disk. `target` is
 * required: silently defaulting to the build host's architecture is exactly how
 * a wrong-arch package gets produced.
 */
export async function verifyNativeAddonPayloadManifest({ repositoryRoot, target, targetSource = 'declared' }) {
	assert(typeof repositoryRoot === 'string' && repositoryRoot, 'repositoryRoot is required');
	assert(typeof target === 'string' && target, 'A native addon payload target is required and never inferred.');
	assert(targetSource === 'declared' || targetSource === 'build-host', 'An unsupported native addon target source was given.');
	const root = resolve(repositoryRoot);
	const manifestBytes = await readRegularFile(root, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH, 'native addon payload manifest');
	const manifest = parseJson(manifestBytes, 'native addon payload manifest');
	validateManifestShape(manifest);
	const derived = deriveNativeAddonPayloadManifest(readNativeHelperAddonSourceManifest(root));
	assert(canonicalJson(manifest) === canonicalJson(derived),
		'The shipped native addon payload manifest disagrees with the pinned source manifest; run npm run build:native-helper-addon.');

	const selected = manifest.targets.find(({ id }) => id === target);
	assert(selected, `The native addon payload manifest has no ${target} target.`);
	let payload = null;
	if (selected.status === 'built') {
		const bytes = await readRegularFile(root, selected.payload.path, `native addon payload ${target}`);
		verifyDescriptorBytes(bytes, selected.payload, `native addon payload ${target}`);
		payload = Object.freeze({ ...selected.payload, name: manifest.addon.payloadName, bytes });
	}
	deepFreeze(manifest);
	const release = Object.freeze({
		repositoryRoot: root,
		manifest,
		manifestBytes,
		manifestSha256: sha256(manifestBytes),
		target: selected,
		targetSource,
		payload,
	});
	VERIFIED_RELEASES.add(release);
	return release;
}

export function nativeAddonPayloadStageSummary(release) {
	assertVerifiedRelease(release);
	return {
		addon: release.manifest.addon.name,
		version: release.manifest.addon.version,
		napiVersion: release.manifest.addon.napiVersion,
		license: release.manifest.addon.license,
		payloadManifest: { id: release.manifest.id, sha256: release.manifestSha256 },
		target: release.target.id,
		targetSource: release.targetSource,
		status: release.target.status,
		blockedBy: release.target.blockedBy,
		payload: release.payload === null
			? null
			: { name: release.payload.name, byteLength: release.payload.byteLength, sha256: release.payload.sha256 },
	};
}

export function verifyBufferedNativeAddonPayload(release) {
	assertVerifiedRelease(release);
	assert(sha256(release.manifestBytes) === release.manifestSha256,
		'Buffered native addon payload manifest changed after validation');
	assert(canonicalJson(parseJson(release.manifestBytes, 'buffered native addon payload manifest')) === canonicalJson(release.manifest),
		'Buffered native addon payload manifest disagrees with the validated policy');
	if (release.payload) {
		verifyDescriptorBytes(release.payload.bytes, release.payload, `buffered native addon payload ${release.target.id}`);
	}
	return release;
}

export function snapshotVerifiedNativeAddonPayload(release) {
	verifyBufferedNativeAddonPayload(release);
	return {
		manifestBytes: Buffer.from(release.manifestBytes),
		payload: release.payload === null ? null : { ...release.payload, bytes: Buffer.from(release.payload.bytes) },
	};
}

export async function stageVerifiedNativeAddonPayload({ release, outputRoot }) {
	const snapshot = snapshotVerifiedNativeAddonPayload(release);
	assert(typeof outputRoot === 'string' && outputRoot, 'outputRoot is required');
	const destination = resolve(outputRoot);
	const parent = dirname(destination);
	await mkdir(parent, { recursive: true });
	await assertPathMissing(destination, 'native addon payload output');
	const temporary = await mkdtemp(resolve(parent, `.${basename(destination)}-`));
	try {
		await writeFile(resolve(temporary, release.manifest.staging.manifestName), snapshot.manifestBytes, { flag: 'wx' });
		if (snapshot.payload) {
			await writeFile(resolve(temporary, snapshot.payload.name), snapshot.payload.bytes, { flag: 'wx', mode: 0o755 });
		}
		await assertPathMissing(destination, 'native addon payload output');
		await rename(temporary, destination);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
	return nativeAddonPayloadStageSummary(release);
}

export async function verifyStagedNativeAddonPayload({ release, outputRoot, stageManifestPath }) {
	verifyBufferedNativeAddonPayload(release);
	const expectedNames = [
		release.manifest.staging.manifestName,
		...(release.payload ? [release.payload.name] : []),
	].sort();
	const entries = await readdir(outputRoot, { withFileTypes: true });
	const actualNames = entries.map(({ name }) => name).sort();
	assert(canonicalJson(actualNames) === canonicalJson(expectedNames),
		`Staged native addon payload inventory mismatch: ${actualNames.join(', ') || '<empty>'}`);
	for (const entry of entries) {
		assert(entry.isFile() && !entry.isSymbolicLink(), `Staged native addon payload entry is not a regular file: ${entry.name}`);
	}
	const stagedManifest = await readFile(resolve(outputRoot, release.manifest.staging.manifestName));
	assert(stagedManifest.equals(release.manifestBytes),
		'Staged native addon payload manifest does not match the verified policy manifest');
	if (release.payload) {
		const bytes = await readFile(resolve(outputRoot, release.payload.name));
		verifyDescriptorBytes(bytes, release.payload, `staged native addon payload ${release.target.id}`);
	}
	if (stageManifestPath) {
		const stage = parseJson(await readStagedRegularFile(stageManifestPath, 'desktop stage manifest'), 'desktop stage manifest');
		assert(canonicalJson(stage.nativeAddons) === canonicalJson(nativeAddonPayloadStageSummary(release)),
			'Desktop stage manifest does not retain the verified native addon payload summary');
	}
	return nativeAddonPayloadStageSummary(release);
}

function validateManifestShape(manifest) {
	assertPlainObject(manifest, 'manifest');
	assertExactKeys(manifest, ['schemaVersion', 'id', 'addon', 'staging', 'security', 'targets'], 'manifest');
	assert(manifest.schemaVersion === 1, 'native addon payload manifest schemaVersion must be 1');
	assertPlainObject(manifest.addon, 'addon');
	assertExactKeys(manifest.addon,
		['name', 'version', 'napiVersion', 'license', 'payloadName', 'sourceManifestPath'], 'addon');
	assert(manifest.addon.license === 'AGPL-3.0-only', 'addon.license must be AGPL-3.0-only');
	assert(Number.isSafeInteger(manifest.addon.napiVersion) && manifest.addon.napiVersion >= 8,
		'addon.napiVersion must target Node-API 8 or later');
	assertPlainObject(manifest.staging, 'staging');
	assertExactKeys(manifest.staging, ['runtimePrefix', 'manifestName'], 'staging');
	assert(manifest.staging.runtimePrefix === NATIVE_ADDON_RUNTIME_PREFIX, 'staging.runtimePrefix is invalid');
	assertPlainObject(manifest.security, 'security');
	assertExactKeys(manifest.security, ['matrixPath', 'riskId', 'controlId'], 'security');
	assert(manifest.security.riskId === 'native-helper-processes', 'security.riskId is invalid');
	assert(Array.isArray(manifest.targets), 'targets must be an array');
	assert(canonicalJson(manifest.targets.map(({ id }) => id))
		=== canonicalJson(NATIVE_HELPER_ADDON_TARGETS.map(({ id }) => id)),
		'targets must be exactly the five claimed milestone-5A targets, in order');
	for (const target of manifest.targets) validateTargetShape(target, manifest.addon.payloadName);
}

function validateTargetShape(target, payloadName) {
	assertPlainObject(target, 'target');
	assertExactKeys(target, ['id', 'platform', 'arch', 'status', 'blockedBy', 'toolchainIdentity', 'payload'], `target ${target.id}`);
	const claimed = NATIVE_HELPER_ADDON_TARGETS.find(({ id }) => id === target.id);
	assert(claimed && claimed.runtime === `${target.platform}-${target.arch}`,
		`target ${target.id} does not name its runtime platform and architecture`);
	if (target.status === 'pending-external') {
		assert(target.payload === null && target.toolchainIdentity === null,
			`target ${target.id} is pending-external and must pin nothing`);
		assert(typeof target.blockedBy === 'string' && target.blockedBy.trim().length >= 8,
			`target ${target.id} requires a named blocker`);
		return;
	}
	assert(target.status === 'built', `target ${target.id} has an unsupported status`);
	assert(target.blockedBy === null, `target ${target.id} is built and must not carry a blocker`);
	assert(typeof target.toolchainIdentity === 'string' && target.toolchainIdentity.trim(),
		`target ${target.id} must record the toolchain that produced it`);
	assertPlainObject(target.payload, `target ${target.id} payload`);
	assertExactKeys(target.payload, ['path', 'byteLength', 'sha256'], `target ${target.id} payload`);
	assert(target.payload.path === `${NATIVE_HELPER_ADDON_ROOT}/prebuilt/${target.id}/${payloadName}`,
		`target ${target.id} payload path is invalid`);
	assert(Number.isSafeInteger(target.payload.byteLength)
		&& target.payload.byteLength > 0 && target.payload.byteLength <= MAXIMUM_PAYLOAD_BYTES,
		`target ${target.id} payload byte length is invalid`);
	assert(SHA256_PATTERN.test(target.payload.sha256), `target ${target.id} payload digest is invalid`);
}

function verifyDescriptorBytes(bytes, descriptor, label) {
	assert(bytes.byteLength === descriptor.byteLength,
		`${label} byte length mismatch: expected ${descriptor.byteLength}, received ${bytes.byteLength}`);
	assert(sha256(bytes) === descriptor.sha256, `${label} digest mismatch`);
}

async function readRegularFile(root, relativePath, label) {
	assertSafeRelativePath(relativePath, `${label} path`);
	let current = root;
	for (const component of relativePath.split('/')) {
		current = resolve(current, component);
		const metadata = await lstat(current);
		assert(!metadata.isSymbolicLink(), `${label} contains a symbolic link: ${relativePath}`);
	}
	const metadata = await lstat(current);
	assert(metadata.isFile(), `${label} is not a regular file: ${relativePath}`);
	assert(metadata.size <= MAXIMUM_PAYLOAD_BYTES, `${label} is too large: ${relativePath}`);
	return readFile(current);
}

async function readStagedRegularFile(path, label) {
	const metadata = await lstat(path);
	assert(metadata.isFile() && !metadata.isSymbolicLink(), `${label} is not a regular file: ${path}`);
	return readFile(path);
}

async function assertPathMissing(path, label) {
	try {
		await lstat(path);
	} catch (error) {
		if (error?.code === 'ENOENT') return;
		throw error;
	}
	throw new Error(`${label} already exists: ${path}`);
}

function assertSafeRelativePath(value, label) {
	assert(typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('\\'), `${label} is invalid`);
	assert(value.split('/').every((part) => part && part !== '.' && part !== '..'), `${label} is invalid`);
}

function assertVerifiedRelease(release) {
	assert(VERIFIED_RELEASES.has(release), 'A verified native addon payload release is required');
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

function assertPlainObject(value, label) {
	assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
}

function assertExactKeys(value, keys, label) {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	assert(canonicalJson(actual) === canonicalJson(expected),
		`${label} keys must be exactly ${expected.join(', ')}; received ${actual.join(', ') || '<none>'}`);
}

function parseJson(bytes, label) {
	try {
		return JSON.parse(String(bytes));
	} catch (error) {
		throw new Error(`${label} is invalid JSON: ${error.message}`, { cause: error });
	}
}

export function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
