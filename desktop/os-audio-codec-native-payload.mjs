/* SPDX-License-Identifier: AGPL-3.0-only */

/** Runtime authentication for the target-built Media Foundation/AudioToolbox addon. */

import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export const OS_AUDIO_CODEC_NATIVE_TARGETS = Object.freeze([
	'mac-arm64', 'win-x64', 'win-arm64',
]);
export const OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX = 'native/soundscaper-os-audio-codec';
export const OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME = 'os-audio-codec-native-payload-manifest.json';
export const OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME = 'soundscaper_os_audio_codec.node';
export const OS_AUDIO_CODEC_NATIVE_ADDON_VERSION = '1.0.0';

const MANIFEST_ID = `soundscaper-os-audio-codec-native-${OS_AUDIO_CODEC_NATIVE_ADDON_VERSION}`;
const SHA256 = /^[a-f\d]{64}$/u;
const SOURCE_IDENTITY_ALGORITHM = 'soundscaper-os-audio-codec-source-closure-sha256-v1';
const BUILD_PLAN_ALGORITHM = 'soundscaper-os-audio-codec-build-plan-sha256-v1';
const MAXIMUM_MANIFEST_BYTES = 64 * 1024;
const MAXIMUM_PAYLOAD_BYTES = 64 * 1024 * 1024;
const ELECTRON_HEADERS = Object.freeze({
	version: '43.1.1',
	archive: Object.freeze({
		byteLength: 344_774,
		sha256: 'b1112989ad4c4807a6bf59bfc96ce8d0f0b16962efe9818fa768e5908cc24d21',
	}),
	extractedTree: Object.freeze({
		algorithm: 'framescaper-portable-source-tree-sha256-v1',
		fileCount: 124,
		sha256: '9eae0a9eb7630b1b53f98e4b7c69951aee2a159ff1f564eeed06b78580de62eb',
	}),
});

export function osAudioCodecNativeTargetFor(platform, architecture) {
	if (platform === 'darwin' && architecture === 'arm64') return 'mac-arm64';
	if (platform === 'win32' && (architecture === 'x64' || architecture === 'arm64')) {
		return `win-${architecture}`;
	}
	return null;
}

export async function describeOsAudioCodecNativePayload(location, operations = {}) {
	const platform = location?.platform ?? process.platform;
	const architecture = location?.arch ?? process.arch;
	const target = osAudioCodecNativeTargetFor(platform, architecture);
	if (target === null) {
		return unavailable('unsupported-platform',
			`${platform}-${architecture} is not a supported OS audio codec native target.`);
	}
	let runtimeRoot;
	try { runtimeRoot = absolutePath(location?.runtimeRoot, 'runtime root'); }
	catch (error) { return unavailable('manifest-unreadable', errorMessage(error)); }
	const targetRoot = resolve(runtimeRoot, OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX, target);
	const manifestPath = resolve(targetRoot, OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME);
	const filesystem = filesystemOperations(operations);
	let manifest;
	try {
		const manifestBytes = await readCanonicalRegularFile(
			manifestPath, MAXIMUM_MANIFEST_BYTES, 'OS audio codec native manifest', filesystem,
		);
		manifest = parseCanonicalOsAudioCodecNativeManifest(manifestBytes, target);
	} catch (error) {
		return unavailable('manifest-unreadable', errorMessage(error));
	}
	const payloadPath = resolve(targetRoot, manifest.payload.path);
	let payloadBytes;
	try {
		payloadBytes = await readCanonicalRegularFile(
			payloadPath, MAXIMUM_PAYLOAD_BYTES, 'OS audio codec native payload', filesystem,
		);
	} catch (error) {
		return unavailable(error?.code === 'ENOENT' ? 'payload-missing' : 'payload-digest-mismatch',
			errorMessage(error));
	}
	if (payloadBytes.byteLength !== manifest.payload.byteLength
		|| digest(payloadBytes) !== manifest.payload.sha256) {
		return unavailable('payload-digest-mismatch',
			`The OS audio codec native payload at ${payloadPath} failed exact authentication.`);
	}
	return Object.freeze({
		status: 'available',
		descriptor: Object.freeze({ target, path: payloadPath, sha256: manifest.payload.sha256 }),
	});
}

export function createOsAudioCodecNativeVerifier(location, operations) {
	return async () => {
		const availability = await describeOsAudioCodecNativePayload(location, operations);
		if (availability.status !== 'available') {
			throw new Error(`The OS audio codec native payload is unavailable (${availability.reason}): ${availability.detail}`);
		}
		return availability.descriptor;
	};
}

export function createOsAudioCodecNativeManifest(value) {
	const manifest = {
		schemaVersion: 1,
		id: MANIFEST_ID,
		addon: {
			name: 'soundscaper-os-audio-codec-native',
			version: OS_AUDIO_CODEC_NATIVE_ADDON_VERSION,
			napiVersion: 8,
			license: 'AGPL-3.0-only',
			payloadName: OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME,
		},
		staging: {
			runtimePrefix: OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX,
			manifestName: OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME,
		},
		target: value.target,
		payload: {
			path: OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME,
			byteLength: value.payload.byteLength,
			sha256: value.payload.sha256,
		},
		electronHeaders: structuredClone(value.electronHeaders),
		sourceIdentity: structuredClone(value.sourceIdentity),
		sourceRevision: value.sourceRevision,
		buildPlan: structuredClone(value.buildPlan),
		toolchainIdentity: structuredClone(value.toolchainIdentity),
		nativeCanary: structuredClone(value.nativeCanary),
	};
	validateOsAudioCodecNativeManifest(manifest);
	return deepFreeze(manifest);
}

export function parseCanonicalOsAudioCodecNativeManifest(bytes, expectedTarget = null) {
	if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
		throw new TypeError('The OS audio codec native manifest bytes are invalid.');
	}
	if (bytes.byteLength < 2 || bytes.byteLength > MAXIMUM_MANIFEST_BYTES) {
		throw new RangeError('The OS audio codec native manifest byte length is invalid.');
	}
	let manifest;
	try { manifest = JSON.parse(String(bytes)); }
	catch { throw new TypeError('The OS audio codec native manifest is not JSON.'); }
	validateOsAudioCodecNativeManifest(manifest, expectedTarget);
	if (!Buffer.from(bytes).equals(Buffer.from(serializeOsAudioCodecNativeManifest(manifest)))) {
		throw new TypeError('The OS audio codec native manifest is not canonical.');
	}
	return deepFreeze(manifest);
}

export function serializeOsAudioCodecNativeManifest(manifest) {
	return `${JSON.stringify(manifest, null, '\t')}\n`;
}

export function validateOsAudioCodecNativeManifest(manifest, expectedTarget = null) {
	closed(manifest, [
		'schemaVersion', 'id', 'addon', 'staging', 'target', 'payload', 'electronHeaders',
		'sourceIdentity', 'sourceRevision', 'buildPlan', 'toolchainIdentity', 'nativeCanary',
	], 'manifest');
	if (manifest.schemaVersion !== 1 || manifest.id !== MANIFEST_ID) {
		throw new TypeError('The OS audio codec native manifest identity is invalid.');
	}
	closed(manifest.addon, ['name', 'version', 'napiVersion', 'license', 'payloadName'], 'addon');
	if (manifest.addon.name !== 'soundscaper-os-audio-codec-native'
		|| manifest.addon.version !== OS_AUDIO_CODEC_NATIVE_ADDON_VERSION
		|| manifest.addon.napiVersion !== 8 || manifest.addon.license !== 'AGPL-3.0-only'
		|| manifest.addon.payloadName !== OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME) {
		throw new TypeError('The OS audio codec native addon identity is invalid.');
	}
	closed(manifest.staging, ['runtimePrefix', 'manifestName'], 'staging');
	if (manifest.staging.runtimePrefix !== OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX
		|| manifest.staging.manifestName !== OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME) {
		throw new TypeError('The OS audio codec native staging identity is invalid.');
	}
	const target = targetId(manifest.target);
	if (expectedTarget !== null && target !== targetId(expectedTarget)) {
		throw new TypeError('The OS audio codec native manifest target does not match this runtime.');
	}
	closed(manifest.payload, ['path', 'byteLength', 'sha256'], 'payload');
	if (manifest.payload.path !== OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME
		|| !Number.isSafeInteger(manifest.payload.byteLength) || manifest.payload.byteLength < 1
		|| manifest.payload.byteLength > MAXIMUM_PAYLOAD_BYTES || !digestValue(manifest.payload.sha256)) {
		throw new TypeError('The OS audio codec native payload descriptor is invalid.');
	}
	validateElectronHeaders(manifest.electronHeaders);
	validateSourceIdentity(manifest.sourceIdentity, manifest.sourceRevision);
	validateBuildPlan(manifest.buildPlan);
	validateToolchainIdentity(manifest.toolchainIdentity, target);
	closed(manifest.nativeCanary, ['status', 'testCommand'], 'native canary');
	if (manifest.nativeCanary.status !== 'passed' || manifest.nativeCanary.testCommand !== 'ctest') {
		throw new TypeError('The OS audio codec native canary result is invalid.');
	}
	return manifest;
}

function validateElectronHeaders(value) {
	closed(value, ['version', 'archive', 'extractedTree'], 'Electron Node-API headers');
	closed(value.archive, ['byteLength', 'sha256'], 'Electron Node-API header archive');
	closed(value.extractedTree, ['algorithm', 'fileCount', 'sha256'], 'Electron Node-API header tree');
	if (value.version !== ELECTRON_HEADERS.version
		|| value.archive.byteLength !== ELECTRON_HEADERS.archive.byteLength
		|| value.archive.sha256 !== ELECTRON_HEADERS.archive.sha256
		|| value.extractedTree.algorithm !== ELECTRON_HEADERS.extractedTree.algorithm
		|| value.extractedTree.fileCount !== ELECTRON_HEADERS.extractedTree.fileCount
		|| value.extractedTree.sha256 !== ELECTRON_HEADERS.extractedTree.sha256) {
		throw new TypeError('The pinned Electron Node-API headers identity is invalid.');
	}
}

function validateSourceIdentity(value, revision) {
	closed(value, ['algorithm', 'fileCount', 'sha256'], 'source identity');
	if (value.algorithm !== SOURCE_IDENTITY_ALGORITHM
		|| !Number.isSafeInteger(value.fileCount) || value.fileCount < 1 || value.fileCount > 1_024
		|| !digestValue(value.sha256) || revision !== value.sha256) {
		throw new TypeError('The OS audio codec repository source identity is invalid.');
	}
}

function validateBuildPlan(value) {
	closed(value, ['algorithm', 'sha256'], 'build plan');
	if (value.algorithm !== BUILD_PLAN_ALGORITHM || !digestValue(value.sha256)) {
		throw new TypeError('The OS audio codec native build plan identity is invalid.');
	}
}

function validateToolchainIdentity(value, target) {
	closed(value, [
		'cmake', 'generator', 'cxxCompilerId', 'cxxCompilerVersion', 'systemName', 'systemProcessor',
	], 'toolchain identity');
	for (const [name, text] of Object.entries(value)) boundedText(text, `toolchain identity ${name}`);
	const processor = value.systemProcessor.toLowerCase();
	const correctSystem = target === 'mac-arm64'
		? value.systemName === 'Darwin' && (processor === 'arm64' || processor === 'aarch64')
		: value.systemName === 'Windows' && (target === 'win-arm64'
			? processor === 'arm64' || processor === 'aarch64'
			: processor === 'amd64' || processor === 'x86_64' || processor === 'x64');
	if (!correctSystem) throw new TypeError('The OS audio codec native toolchain identity does not match its target.');
}

async function readCanonicalRegularFile(path, maximumBytes, label, operations) {
	const first = await operations.lstat(path);
	const canonical = await operations.realpath(path);
	if (!first.isFile() || first.isSymbolicLink() || canonical !== path
		|| !Number.isSafeInteger(Number(first.size)) || Number(first.size) < 1
		|| Number(first.size) > maximumBytes) {
		throw new Error(`The ${label} is not one bounded canonical regular file.`);
	}
	const bytes = Buffer.from(await operations.readFile(path));
	const second = await operations.lstat(path);
	if (!sameIdentity(first, second) || bytes.byteLength !== Number(first.size)) {
		throw new Error(`The ${label} changed while it was reopened.`);
	}
	return bytes;
}

function filesystemOperations(value) {
	const operations = value && typeof value === 'object' ? value : {};
	return Object.freeze({
		readFile: operations.readFile ?? readFile,
		lstat: operations.lstat ?? lstat,
		realpath: operations.realpath ?? realpath,
	});
}

function sameIdentity(left, right) {
	return right.isFile() && !right.isSymbolicLink()
		&& Number(left.dev) === Number(right.dev) && Number(left.ino) === Number(right.ino)
		&& Number(left.size) === Number(right.size) && Number(left.mtimeMs) === Number(right.mtimeMs);
}

function targetId(value) {
	if (typeof value !== 'string' || !OS_AUDIO_CODEC_NATIVE_TARGETS.includes(value)) {
		throw new TypeError(`Unsupported OS audio codec native target ${String(value)}.`);
	}
	return value;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')
		|| Buffer.byteLength(value) > 4_096 || resolve(value) !== value) {
		throw new TypeError(`The OS audio codec native ${label} is invalid.`);
	}
	return value;
}

function boundedText(value, label) {
	if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value) > 512
		|| value.includes('\0') || /[\r\n]/u.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function closed(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| JSON.stringify(Reflect.ownKeys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new TypeError(`The OS audio codec native ${label} has an inexact shape.`);
	}
	return value;
}

function digestValue(value) { return typeof value === 'string' && SHA256.test(value); }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function unavailable(reason, detail) { return Object.freeze({ status: 'unavailable', reason, detail }); }
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
