/* SPDX-License-Identifier: AGPL-3.0-only */

/** Build-result authentication and exact staging for the codec-only native addon. */

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';

import {
	OS_AUDIO_CODEC_NATIVE_ADDON_VERSION,
	OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME,
	OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME,
	OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX,
	OS_AUDIO_CODEC_NATIVE_TARGETS,
	createOsAudioCodecNativeManifest,
	serializeOsAudioCodecNativeManifest,
} from '../../desktop/os-audio-codec-native-payload.mjs';
import { renameIntoPlaceExclusively } from './exclusive-rename.mjs';

export {
	OS_AUDIO_CODEC_NATIVE_ADDON_VERSION,
	OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME,
	OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME,
	OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX,
	OS_AUDIO_CODEC_NATIVE_TARGETS,
};

const VERIFIED_RELEASES = new WeakSet();
const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_PAYLOAD_BYTES = 64 * 1024 * 1024;

export async function verifyOsAudioCodecNativeBuildResult({
	build, target, sourceRevision, buildPlanSha256,
}) {
	const selectedTarget = targetId(target);
	const expectedSourceRevision = digestValue(sourceRevision, 'source revision');
	const expectedBuildPlan = digestValue(buildPlanSha256, 'build plan digest');
	validateBuildResultShape(build);
	if (build.target !== selectedTarget) {
		throw new TypeError('The OS audio codec native build target does not match the requested target.');
	}
	if (build.sourceRevision !== expectedSourceRevision
		|| build.sourceIdentity.sha256 !== expectedSourceRevision) {
		throw new TypeError('The OS audio codec native source revision does not match the requested source identity.');
	}
	if (build.buildPlanSha256 !== expectedBuildPlan
		|| build.buildPlan.sha256 !== expectedBuildPlan
		|| build.buildPlanSha256 !== build.buildPlan.sha256) {
		throw new TypeError('The OS audio codec native build plan does not match the requested plan identity.');
	}
	const artifactPath = absolutePath(build.artifact.path, 'build artifact path');
	if (basename(artifactPath) !== OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME
		|| !Number.isSafeInteger(build.artifact.byteLength) || build.artifact.byteLength < 1
		|| build.artifact.byteLength > MAXIMUM_PAYLOAD_BYTES
		|| !SHA256.test(String(build.artifact.sha256))) {
		throw new TypeError('The OS audio codec native build artifact descriptor is invalid.');
	}
	const payloadBytes = await readCanonicalRegularFile(artifactPath, 'build payload');
	verifyPayloadBytes(payloadBytes, build.artifact, 'OS audio codec native payload');
	const manifest = createOsAudioCodecNativeManifest({
		target: selectedTarget,
		payload: build.artifact,
		electronHeaders: build.electronHeaders,
		sourceIdentity: build.sourceIdentity,
		sourceRevision: build.sourceRevision,
		buildPlan: build.buildPlan,
		toolchainIdentity: build.toolchainIdentity,
		nativeCanary: build.nativeCanary,
		signing: build.signing,
	});
	const manifestBytes = Buffer.from(serializeOsAudioCodecNativeManifest(manifest));
	const release = Object.freeze({
		manifest,
		manifestBytes,
		manifestSha256: digest(manifestBytes),
		target: selectedTarget,
		payload: Object.freeze({
			path: artifactPath,
			name: OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME,
			byteLength: build.artifact.byteLength,
			sha256: build.artifact.sha256,
			bytes: Buffer.from(payloadBytes),
		}),
	});
	VERIFIED_RELEASES.add(release);
	return release;
}

export function osAudioCodecNativePayloadOutputRoot(runtimeRoot, release) {
	assertRelease(release);
	const root = absolutePath(runtimeRoot, 'runtime root');
	return resolve(root, release.manifest.staging.runtimePrefix, release.target);
}

export function osAudioCodecNativePayloadStageSummary(release) {
	assertRelease(release);
	verifyBufferedRelease(release);
	return deepFreeze({
		target: release.target,
		status: 'built',
		payloadManifest: {
			id: release.manifest.id,
			name: OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME,
			byteLength: release.manifestBytes.byteLength,
			sha256: release.manifestSha256,
		},
		payload: {
			name: release.payload.name,
			byteLength: release.payload.byteLength,
			sha256: release.payload.sha256,
		},
		sourceRevision: release.manifest.sourceRevision,
		buildPlanSha256: release.manifest.buildPlan.sha256,
		nativeCanary: release.manifest.nativeCanary.status,
		signing: structuredClone(release.manifest.signing),
	});
}

export async function stageVerifiedOsAudioCodecNativePayload({ release, outputRoot }) {
	assertRelease(release);
	verifyBufferedRelease(release);
	const destination = targetOutputRoot(outputRoot, release.target);
	const manifestBytes = Buffer.from(release.manifestBytes);
	const payloadBytes = Buffer.from(release.payload.bytes);
	await renameIntoPlaceExclusively(destination, 'OS audio codec native payload output', async (temporary) => {
		await writeFile(resolve(temporary, OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME), manifestBytes,
			{ flag: 'wx', mode: 0o444 });
		await writeFile(resolve(temporary, OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME), payloadBytes,
			{ flag: 'wx', mode: 0o555 });
		return temporary;
	});
	return osAudioCodecNativePayloadStageSummary(release);
}

export async function verifyStagedOsAudioCodecNativePayload({ release, outputRoot }) {
	assertRelease(release);
	verifyBufferedRelease(release);
	const root = targetOutputRoot(outputRoot, release.target);
	const entries = await readdir(root, { withFileTypes: true });
	const expected = [OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME, OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME].sort();
	const actual = entries.map(({ name }) => name).sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)
		|| entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
		throw new Error(`Staged OS audio codec native payload inventory mismatch: ${actual.join(', ') || '<empty>'}.`);
	}
	const manifestBytes = await readCanonicalRegularFile(
		resolve(root, OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME), 'staged manifest',
	);
	if (!manifestBytes.equals(release.manifestBytes)) {
		throw new Error('The staged OS audio codec native manifest does not match the verified manifest.');
	}
	const payloadBytes = await readCanonicalRegularFile(
		resolve(root, OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME), 'staged payload',
	);
	verifyPayloadBytes(payloadBytes, release.payload, 'Staged OS audio codec native payload');
	return osAudioCodecNativePayloadStageSummary(release);
}

function validateBuildResultShape(build) {
	closed(build, [
		'schemaVersion', 'status', 'target', 'artifact', 'electronHeaders', 'sourceIdentity',
		'sourceRevision', 'buildPlan', 'buildPlanSha256', 'toolchainIdentity', 'nativeCanary',
		'signing',
	], 'build result');
	if (build.schemaVersion !== 1 || build.status !== 'built') {
		throw new TypeError('The OS audio codec native build result identity is invalid.');
	}
	closed(build.artifact, ['path', 'byteLength', 'sha256'], 'build artifact');
	closed(build.electronHeaders, ['version', 'archive', 'extractedTree'], 'Electron headers');
	closed(build.electronHeaders.archive, ['byteLength', 'sha256'], 'Electron header archive');
	closed(build.electronHeaders.extractedTree,
		['algorithm', 'fileCount', 'sha256'], 'Electron header extracted tree');
	closed(build.sourceIdentity, ['algorithm', 'fileCount', 'sha256'], 'source identity');
	closed(build.buildPlan, ['algorithm', 'sha256'], 'build plan');
	closed(build.toolchainIdentity, [
		'cmake', 'generator', 'cxxCompilerId', 'cxxCompilerVersion', 'systemName', 'systemProcessor',
	], 'toolchain identity');
	closed(build.nativeCanary, ['status', 'testCommand'], 'native canary');
}

function verifyBufferedRelease(release) {
	if (digest(release.manifestBytes) !== release.manifestSha256
		|| !release.manifestBytes.equals(Buffer.from(serializeOsAudioCodecNativeManifest(release.manifest)))) {
		throw new Error('The buffered OS audio codec native manifest changed after verification.');
	}
	verifyPayloadBytes(release.payload.bytes, release.payload, 'Buffered OS audio codec native payload');
}

function verifyPayloadBytes(bytes, descriptor, label) {
	if (bytes.byteLength !== descriptor.byteLength) {
		throw new Error(`${label} byte length mismatch.`);
	}
	if (digest(bytes) !== descriptor.sha256) throw new Error(`${label} digest mismatch.`);
}

async function readCanonicalRegularFile(path, label) {
	const first = await lstat(path);
	const canonical = await realpath(path);
	if (!first.isFile() || first.isSymbolicLink() || canonical !== path
		|| !Number.isSafeInteger(Number(first.size)) || Number(first.size) < 1
		|| Number(first.size) > MAXIMUM_PAYLOAD_BYTES) {
		throw new Error(`The OS audio codec native ${label} is not one bounded canonical regular file.`);
	}
	const bytes = await readFile(path);
	const second = await lstat(path);
	if (!sameIdentity(first, second) || bytes.byteLength !== Number(first.size)) {
		throw new Error(`The OS audio codec native ${label} changed while it was reopened.`);
	}
	return bytes;
}

function sameIdentity(left, right) {
	return right.isFile() && !right.isSymbolicLink()
		&& Number(left.dev) === Number(right.dev) && Number(left.ino) === Number(right.ino)
		&& Number(left.size) === Number(right.size) && Number(left.mtimeMs) === Number(right.mtimeMs);
}

function targetOutputRoot(value, target) {
	const output = absolutePath(value, 'output root');
	const suffix = join(OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX, target);
	if (output !== suffix && !output.endsWith(`${sep}${suffix}`)) {
		throw new TypeError('The OS audio codec native output root escaped its dedicated target subtree.');
	}
	return output;
}

function targetId(value) {
	if (typeof value !== 'string' || !OS_AUDIO_CODEC_NATIVE_TARGETS.includes(value)) {
		throw new TypeError(`Unsupported OS audio codec native target ${String(value)}.`);
	}
	return value;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0') || Buffer.byteLength(value) > 4_096) {
		throw new TypeError(`The OS audio codec native ${label} is invalid.`);
	}
	return value;
}

function digestValue(value, label) {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`The OS audio codec native ${label} is invalid.`);
	}
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

function assertRelease(value) {
	if (!value || typeof value !== 'object' || !VERIFIED_RELEASES.has(value)) {
		throw new TypeError('A verified OS audio codec native release is required.');
	}
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
