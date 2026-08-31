/* SPDX-License-Identifier: AGPL-3.0-only */

/** Fail-closed staging for the separately built Framescaper native hosts. */

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { assertPathMissing, renameIntoPlaceExclusively } from './exclusive-rename.mjs';
import {
	FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST,
	FRAMESCAPER_MEDIA_HOST_ROOT,
	FRAMESCAPER_MEDIA_HOST_TARGETS,
	canonicalJson,
	verifyFramescaperMediaHostPayloadRelease,
} from './framescaper-media-host-build.mjs';
import {
	FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST,
	FRAMESCAPER_OPENFX_HOST_ROOT,
	verifyFramescaperOpenFxPayloadRelease,
} from './framescaper-openfx-host-build.mjs';

const VERIFIED_RELEASES = new WeakSet();
const SHA256 = /^[a-f\d]{64}$/u;
const MEDIA_RUNTIME_PREFIX = 'native/framescaper-media-host';
const OPENFX_RUNTIME_PREFIX = 'native/framescaper-openfx-host';

export async function verifyFramescaperNativeHostPayloads({
	repositoryRoot,
	target,
	targetSource = 'declared',
}) {
	assert(typeof repositoryRoot === 'string' && repositoryRoot, 'repositoryRoot is required.');
	assert(FRAMESCAPER_MEDIA_HOST_TARGETS.some(({ id }) => id === target),
		`The Framescaper native-host payload manifests have no ${String(target)} target.`);
	assert(targetSource === 'declared' || targetSource === 'build-host',
		'An unsupported Framescaper native-host target source was given.');
	const root = resolve(repositoryRoot);
	const media = await verifiedManifestAsync(
		() => verifyFramescaperMediaHostPayloadRelease({ repositoryRoot: root }),
		'Framescaper media-host payload byte length or digest',
	);
	const openFx = await verifiedManifestAsync(
		() => verifyFramescaperOpenFxPayloadRelease({ repositoryRoot: root }),
		'Framescaper OpenFX-host',
	);
	const [mediaManifestBytes, openFxManifestBytes] = await Promise.all([
		readCanonicalRegularFile(root, FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST,
			'Framescaper media-host payload manifest'),
		readCanonicalRegularFile(root, FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST,
			'Framescaper OpenFX-host payload manifest'),
	]);
	assert(canonicalJson(parseJson(mediaManifestBytes, 'Framescaper media-host payload manifest'))
		=== canonicalJson(media.payload),
	'Framescaper media-host payload manifest changed during verification.');
	assert(canonicalJson(parseJson(openFxManifestBytes, 'Framescaper OpenFX-host payload manifest'))
		=== canonicalJson(openFx.payload),
	'Framescaper OpenFX-host payload manifest changed during verification.');

	const mediaHost = await snapshotMediaHost(root, media, mediaManifestBytes, target);
	const openFxHost = await snapshotOpenFxHost(root, openFx, openFxManifestBytes, target);
	const release = Object.freeze({ repositoryRoot: root, target, targetSource, mediaHost, openFxHost });
	VERIFIED_RELEASES.add(release);
	return release;
}

export function framescaperNativeHostPayloadStageSummary(release) {
	verifyBufferedRelease(release);
	return {
		target: release.target,
		targetSource: release.targetSource,
		mediaHost: hostSummary(release.mediaHost),
		openFxHost: hostSummary(release.openFxHost),
	};
}

export async function stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot }) {
	const snapshot = snapshotRelease(release);
	assert(typeof outputRoot === 'string' && outputRoot, 'outputRoot is required.');
	const root = resolve(outputRoot);
	await Promise.all([
		assertPathMissing(resolve(root, MEDIA_RUNTIME_PREFIX), 'Framescaper media-host payload root'),
		assertPathMissing(resolve(root, OPENFX_RUNTIME_PREFIX), 'Framescaper OpenFX-host payload root'),
	]);
	await stageHost({
		destination: resolve(root, MEDIA_RUNTIME_PREFIX, release.target),
		label: 'Framescaper media-host payload output',
		payloads: snapshot.mediaHost,
	});
	await stageHost({
		destination: resolve(root, OPENFX_RUNTIME_PREFIX, release.target),
		label: 'Framescaper OpenFX-host payload output',
		payloads: snapshot.openFxHost,
	});
	return framescaperNativeHostPayloadStageSummary(release);
}

export async function verifyStagedFramescaperNativeHostPayloads({
	release,
	outputRoot,
	stageManifestPath = null,
	applicationRoot = null,
}) {
	verifyBufferedRelease(release);
	assert(typeof outputRoot === 'string' && outputRoot, 'outputRoot is required.');
	const root = resolve(outputRoot);
	await verifyStagedHost({
		prefix: resolve(root, MEDIA_RUNTIME_PREFIX),
		directory: resolve(root, MEDIA_RUNTIME_PREFIX, release.target),
		label: 'staged Framescaper media-host payload',
		payloads: release.mediaHost.payloads,
	});
	await verifyStagedHost({
		prefix: resolve(root, OPENFX_RUNTIME_PREFIX),
		directory: resolve(root, OPENFX_RUNTIME_PREFIX, release.target),
		label: 'staged Framescaper OpenFX-host payload',
		payloads: release.openFxHost.payloads,
	});
	if (stageManifestPath !== null) {
		const bytes = await readAbsoluteRegularFile(stageManifestPath, 'desktop stage manifest');
		const stage = parseJson(bytes, 'desktop stage manifest');
		assert(canonicalJson(stage.framescaperNativeHosts)
			=== canonicalJson(framescaperNativeHostPayloadStageSummary(release)),
		'The desktop stage manifest does not retain the verified Framescaper native-host summary.');
	}
	if (applicationRoot !== null) {
		await verifyStagedManifestCopy(
			applicationRoot,
			FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST,
			release.mediaHost.manifestBytes,
			'staged Framescaper media-host payload manifest',
		);
		await verifyStagedManifestCopy(
			applicationRoot,
			FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST,
			release.openFxHost.manifestBytes,
			'staged Framescaper OpenFX-host payload manifest',
		);
	}
	return framescaperNativeHostPayloadStageSummary(release);
}

async function snapshotMediaHost(root, release, manifestBytes, targetId) {
	const manifest = release.payload;
	const target = selectedTarget(manifest, targetId, 'media-host');
	const suffix = targetId.startsWith('win-') ? '.exe' : '';
	const expectedPath = `${FRAMESCAPER_MEDIA_HOST_ROOT}/prebuilt/${targetId}/framescaper-media-host${suffix}`;
	const payloads = target.status === 'built'
		? await Promise.all([
			snapshotPayload(root, target.payload, expectedPath, `Framescaper media-host ${targetId}`),
			...mediaIsolationPayloads(target.isolationPayload).map(([label, payload]) => (
				snapshotPayload(root, payload, payload.path, `Framescaper media-host ${targetId} ${label}`)
			)),
		])
		: [];
	return freezeHost({
		manifest, manifestBytes, target, payloads,
	});
}

async function snapshotOpenFxHost(root, release, manifestBytes, targetId) {
	const manifest = release.payload;
	const target = selectedTarget(manifest, targetId, 'OpenFX-host');
	const suffix = targetId.startsWith('win-') ? '.exe' : '';
	const prefix = `${FRAMESCAPER_OPENFX_HOST_ROOT}/prebuilt/${targetId}/bin/`;
	const payloads = target.status === 'built'
		? await Promise.all([
			snapshotPayload(root, target.payload?.scannerPayload,
				`${prefix}framescaper-ofx-scanner${suffix}`, `Framescaper OpenFX ${targetId} scanner`),
			snapshotPayload(root, target.payload?.runtimeHostPayload,
				`${prefix}framescaper-ofx-runtime-host${suffix}`, `Framescaper OpenFX ${targetId} runtime host`),
			...openFxIsolationPayloads(target.payload?.isolationPayload).map(([label, payload]) => (
				snapshotPayload(root, payload, payload.path, `Framescaper OpenFX ${targetId} ${label}`)
			)),
		])
		: [];
	return freezeHost({
		manifest,
		manifestBytes,
		target,
		payloads,
	});
}

function openFxIsolationPayloads(value) {
	assert(value && exactKeys(value, [
		'launcherPayload', 'sandboxProfilePayload', 'brokerPolicyPayload', 'runtimeLibraryPayloads',
	]), 'Framescaper OpenFX isolation payload record is incomplete.');
	assert(Array.isArray(value.runtimeLibraryPayloads),
		'Framescaper OpenFX runtime-library payload inventory is invalid.');
	return [
		['isolation launcher', value.launcherPayload],
		['sandbox profile', value.sandboxProfilePayload],
		['broker policy', value.brokerPolicyPayload],
		...value.runtimeLibraryPayloads.map((payload) => ['runtime library', payload]),
	];
}

function mediaIsolationPayloads(value) {
	assert(value && exactKeys(value, [
		'launcherPayload', 'sandboxProfilePayload', 'brokerPolicyPayload', 'runtimeLibraryPayloads',
	]), 'Framescaper media-host isolation payload record is incomplete.');
	assert(Array.isArray(value.runtimeLibraryPayloads),
		'Framescaper media-host runtime-library payload inventory is invalid.');
	return [
		['isolation launcher', value.launcherPayload],
		['sandbox profile', value.sandboxProfilePayload],
		['broker policy', value.brokerPolicyPayload],
		...value.runtimeLibraryPayloads.map((payload) => ['runtime library', payload]),
	];
}

function selectedTarget(manifest, targetId, label) {
	const matches = manifest.targets.filter(({ id }) => id === targetId);
	assert(matches.length === 1, `The Framescaper ${label} manifest must contain exactly one ${targetId} target.`);
	const target = matches[0];
	if (target.status === 'pending-external') {
		assert(target.payload === null && typeof target.blockedBy === 'string',
			`The Framescaper ${label} pending target carries a payload claim.`);
	} else {
		assert(target.status === 'built' && target.payload !== null && target.blockedBy === null,
			`The Framescaper ${label} target has an unsupported payload state.`);
	}
	return target;
}

async function snapshotPayload(root, descriptor, expectedPath, label) {
	assert(descriptor && exactKeys(descriptor, ['path', 'byteLength', 'sha256']),
		`${label} payload record is incomplete.`);
	assert(descriptor.path === expectedPath, `${label} payload path is invalid.`);
	assert(Number.isSafeInteger(descriptor.byteLength) && descriptor.byteLength > 0,
		`${label} payload byte length is invalid.`);
	assert(SHA256.test(String(descriptor.sha256)), `${label} payload digest is invalid.`);
	const bytes = await readCanonicalRegularFile(root, descriptor.path, `${label} payload`);
	verifyBytes(bytes, descriptor, `${label} payload`);
	return Object.freeze({
		path: descriptor.path,
		name: descriptor.path.slice(descriptor.path.lastIndexOf('/') + 1),
		byteLength: descriptor.byteLength,
		sha256: descriptor.sha256,
		bytes,
	});
}

function freezeHost({
	manifest,
	manifestBytes,
	target,
	payloads,
}) {
	const host = Object.freeze({
		manifest,
		manifestBytes,
		manifestSha256: sha256(manifestBytes),
		target,
		payloads: Object.freeze(payloads),
	});
	return host;
}

function hostSummary(host) {
	return {
		payloadManifest: { id: host.manifest.id, sha256: host.manifestSha256 },
		status: host.target.status,
		blockedBy: host.target.blockedBy,
		payloads: host.payloads.map(({ name, byteLength, sha256: digest }) => ({
			name, byteLength, sha256: digest,
		})),
	};
}

function snapshotRelease(release) {
	verifyBufferedRelease(release);
	return {
		mediaHost: release.mediaHost.payloads.map((payload) => ({ ...payload, bytes: Buffer.from(payload.bytes) })),
		openFxHost: release.openFxHost.payloads.map((payload) => ({ ...payload, bytes: Buffer.from(payload.bytes) })),
	};
}

function verifyBufferedRelease(release) {
	assert(VERIFIED_RELEASES.has(release), 'A verified Framescaper native-host payload release is required.');
	for (const [label, host] of [['media-host', release.mediaHost], ['OpenFX-host', release.openFxHost]]) {
		assert(sha256(host.manifestBytes) === host.manifestSha256,
			`Buffered Framescaper ${label} manifest changed after verification.`);
		assert(canonicalJson(parseJson(host.manifestBytes, `buffered Framescaper ${label} manifest`))
			=== canonicalJson(host.manifest),
		`Buffered Framescaper ${label} manifest disagrees with the verified policy.`);
		for (const payload of host.payloads) verifyBytes(payload.bytes, payload, `buffered Framescaper ${label}`);
	}
	return release;
}

async function stageHost({
	destination,
	label,
	payloads,
}) {
	if (payloads.length === 0) return;
	await renameIntoPlaceExclusively(destination, label, async (temporary) => {
		for (const payload of payloads) {
			await writeFile(resolve(temporary, payload.name), payload.bytes, { flag: 'wx', mode: 0o755 });
		}
		return temporary;
	});
}

async function verifyStagedHost({
	prefix,
	directory,
	label,
	payloads,
}) {
	if (payloads.length === 0) {
		await assertPathMissing(prefix, label);
		return;
	}
	const targetEntries = await readdir(prefix, { withFileTypes: true });
	assert(targetEntries.length === 1 && targetEntries[0].isDirectory()
		&& !targetEntries[0].isSymbolicLink() && resolve(prefix, targetEntries[0].name) === directory,
	`${label} target inventory mismatch: ${targetEntries.map(({ name }) => name).join(', ') || '<empty>'}.`);
	const entries = await readdir(directory, { withFileTypes: true });
	const actual = entries.map(({ name }) => name).sort();
	const expected = payloads.map(({ name }) => name).sort();
	assert(canonicalJson(actual) === canonicalJson(expected),
		`${label} inventory mismatch: ${actual.join(', ') || '<empty>'}.`);
	for (const entry of entries) {
		assert(entry.isFile() && !entry.isSymbolicLink(), `${label} entry is not a regular file: ${entry.name}.`);
		const bytes = await readAbsoluteRegularFile(resolve(directory, entry.name), `${label} ${entry.name}`);
		const descriptor = payloads.find(({ name }) => name === entry.name) ?? null;
		assert(descriptor !== null, `${label} ${entry.name} has no authenticated descriptor.`);
		verifyBytes(bytes, descriptor, `${label} ${entry.name}`);
	}
}

async function readCanonicalRegularFile(root, relativePath, label) {
	assertSafeRelativePath(relativePath, `${label} path`);
	let current = resolve(root);
	const components = relativePath.split('/');
	for (let index = 0; index < components.length; index += 1) {
		current = resolve(current, components[index]);
		const metadata = await lstat(current);
		assert(!metadata.isSymbolicLink(), `${label} contains a symbolic link: ${relativePath}.`);
		assert(index === components.length - 1 ? metadata.isFile() : metadata.isDirectory(),
			`${label} is not a canonical regular file: ${relativePath}.`);
	}
	return readFile(current);
}

async function readAbsoluteRegularFile(path, label) {
	const metadata = await lstat(path);
	assert(metadata.isFile() && !metadata.isSymbolicLink(), `${label} is not a canonical regular file.`);
	return readFile(path);
}

async function verifyStagedManifestCopy(applicationRoot, relativePath, expected, label) {
	assert(typeof applicationRoot === 'string' && applicationRoot, 'applicationRoot is required.');
	const bytes = await readCanonicalRegularFile(resolve(applicationRoot), relativePath, label);
	assert(bytes.equals(expected), `${label} does not match the verified policy manifest.`);
}

function assertSafeRelativePath(path, label) {
	assert(typeof path === 'string' && path && !path.includes('\\') && !path.startsWith('/'),
		`${label} is unsafe.`);
	assert(path.split('/').every((component) => component && component !== '.' && component !== '..'),
		`${label} is unsafe.`);
}

function verifyBytes(bytes, descriptor, label) {
	assert(bytes.byteLength === descriptor.byteLength,
		`${label} byte length mismatch: expected ${descriptor.byteLength}, received ${bytes.byteLength}.`);
	assert(sha256(bytes) === descriptor.sha256, `${label} digest mismatch.`);
}

function exactKeys(value, keys) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

async function verifiedManifestAsync(operation, label) {
	try {
		return await operation();
	} catch (error) {
		throw new Error(`${label} payload verification failed: ${errorMessage(error)}`, { cause: error });
	}
}

function parseJson(bytes, label) {
	try { return JSON.parse(String(bytes)); }
	catch (error) { throw new Error(`${label} is invalid JSON: ${errorMessage(error)}`, { cause: error }); }
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
