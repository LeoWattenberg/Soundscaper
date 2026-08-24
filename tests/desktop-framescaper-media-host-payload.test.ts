/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
	createFramescaperMediaHostVerifier,
	describeFramescaperMediaHostAvailability,
	framescaperMediaHostTargetFor,
} from '../desktop/framescaper-media-host-payload.ts';

const BYTES = Buffer.from('synthetic-framescaper-media-host');
const LAUNCHER = Buffer.from('synthetic-media-isolation-launcher');
const PROFILE = Buffer.from('synthetic-media-isolation-profile');
const BROKER = Buffer.from('synthetic-media-isolation-broker');
const LIBRARY = Buffer.from('synthetic-media-runtime-library');
const SHA256 = createHash('sha256').update(BYTES).digest('hex');
const MANIFEST_PATH = '/application/config/framescaper-media-host-payload-manifest.json';
const DEVELOPMENT_PATH =
	'/application/native/framescaper-media-host/prebuilt/linux-x64/framescaper-media-host';
const LAUNCHER_PATH =
	'/application/native/framescaper-media-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-launcher';
const PROFILE_PATH =
	'/application/native/framescaper-media-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-profile.json';
const BROKER_PATH =
	'/application/native/framescaper-media-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-broker.json';
const LIBRARY_PATH =
	'/application/native/framescaper-media-host/prebuilt/linux-x64/lib/libframescaper-media.so';
const EVIDENCE_PATH =
	'/application/config/framescaper-media-host-production-readiness/linux-x64.json';
const PACKAGED_EVIDENCE_PATH =
	'/resources/runtime/native/framescaper-media-host/linux-x64/framescaper-media-host-production-readiness.json';
const KEY = generateKeyPairSync('ed25519');
const KEY_ID = 'synthetic-media-review-v1';

test('the media-host resolver admits only the five exact runtime targets', () => {
	assert.equal(framescaperMediaHostTargetFor('linux', 'x64'), 'linux-x64');
	assert.equal(framescaperMediaHostTargetFor('darwin', 'arm64'), 'mac-arm64');
	assert.equal(framescaperMediaHostTargetFor('win32', 'arm64'), 'win-arm64');
	assert.equal(framescaperMediaHostTargetFor('darwin', 'x64'), null);
	assert.equal(framescaperMediaHostTargetFor('freebsd', 'x64'), null);
});

test('a built current-target payload is selected only after exact byte and identity verification', async () => {
	const reads: string[] = [];
	const availability = await describeFramescaperMediaHostAvailability(location(), {
		readFile: async (path) => {
			reads.push(path);
			return path === MANIFEST_PATH ? Buffer.from(JSON.stringify(manifest())) : payloadBytes(path);
		},
		stat: async (path) => fileStat(payloadBytes(path).byteLength, path),
		resolveReviewPublicKey: () => KEY.publicKey.export({ type: 'spki', format: 'pem' }),
	});
	assert.equal(availability.status, 'available');
	if (availability.status !== 'available') return;
	assert.deepEqual(availability.descriptor, {
		target: 'linux-x64', runtime: 'linux-x64', path: DEVELOPMENT_PATH,
		byteLength: BYTES.byteLength, sha256: SHA256, hostVersion: '1.0.0',
		ffmpegVersion: '9.0.1', identity: { dev: 7, ino: identityFor(DEVELOPMENT_PATH) },
		isolation: {
			launcher: runtimeDescriptor(LAUNCHER_PATH, LAUNCHER),
			sandboxProfile: runtimeDescriptor(PROFILE_PATH, PROFILE),
			brokerPolicy: runtimeDescriptor(BROKER_PATH, BROKER),
			runtimeLibraries: [runtimeDescriptor(LIBRARY_PATH, LIBRARY)],
		},
		productionReadiness: readinessEvidence(),
	});
	assert.deepEqual(reads, [
		MANIFEST_PATH, DEVELOPMENT_PATH, LAUNCHER_PATH, PROFILE_PATH, BROKER_PATH,
		LIBRARY_PATH, EVIDENCE_PATH, EVIDENCE_PATH,
	]);
});

test('packaged payloads resolve only below the verified runtime prefix', async () => {
	const reads: string[] = [];
	const availability = await describeFramescaperMediaHostAvailability({
		...location(), packaged: true, resourcesPath: '/resources',
	}, {
		readFile: async (path) => {
			reads.push(path);
			return path === MANIFEST_PATH ? Buffer.from(JSON.stringify(manifest())) : payloadBytes(path);
		},
		stat: async (path) => fileStat(payloadBytes(path).byteLength, path),
		resolveReviewPublicKey: () => KEY.publicKey.export({ type: 'spki', format: 'pem' }),
	});
	assert.equal(availability.status, 'available');
	if (availability.status !== 'available') return;
	assert.equal(
		availability.descriptor.path,
		'/resources/runtime/native/framescaper-media-host/linux-x64/framescaper-media-host',
	);
	assert.ok(reads.includes(PACKAGED_EVIDENCE_PATH));
});

test('prepared desktop development resolves only from its staged external runtime', async () => {
	const expected = '/build/runtime/native/framescaper-media-host/linux-x64/framescaper-media-host';
	const reads: string[] = [];
	const availability = await describeFramescaperMediaHostAvailability({
		...location(), externalRuntimeRoot: '/build/runtime',
	}, {
		readFile: async (path) => {
			reads.push(path);
			return path === MANIFEST_PATH ? Buffer.from(JSON.stringify(manifest())) : payloadBytes(path);
		},
		stat: async (path) => fileStat(payloadBytes(path).byteLength, path),
		resolveReviewPublicKey: () => KEY.publicKey.export({ type: 'spki', format: 'pem' }),
	});
	assert.equal(availability.status, 'available');
	assert.equal(availability.status === 'available' ? availability.descriptor.path : null, expected);
	assert.ok(reads.includes(expected));
});

test('pending, missing, altered, and malformed payloads stay explicitly unavailable', async () => {
	const pending = manifest({ built: false });
	const pendingResult = await describeFramescaperMediaHostAvailability(location(), ports(pending));
	assert.equal(pendingResult.status, 'unavailable');
	assert.equal(pendingResult.status === 'unavailable' ? pendingResult.reason : null, 'payload-pending-external');

	for (const [label, alteredManifest, payload, reason] of [
		['missing payload row', { ...manifest(), payloads: [] }, BYTES, 'manifest-unreadable'],
		['duplicate payload row', { ...manifest(), payloads: [manifest().payloads[0], manifest().payloads[0]] }, BYTES,
			'manifest-unreadable'],
		['wrong runtime', manifest({ runtime: 'linux-arm64' }), BYTES, 'manifest-unreadable'],
		['unsafe path', manifest({ path: '../framescaper-media-host' }), BYTES, 'manifest-unreadable'],
		['altered bytes', manifest(), Buffer.from('altered'), 'payload-digest-mismatch'],
	] as const) {
		const result = await describeFramescaperMediaHostAvailability(
			location(), ports(alteredManifest, payload),
		);
		assert.equal(result.status, 'unavailable', label);
		assert.equal(result.status === 'unavailable' ? result.reason : null, reason, label);
	}
});

test('built media bytes remain unavailable without independently signed readiness', async () => {
	const result = await describeFramescaperMediaHostAvailability(
		location(), ports(manifest({ attested: false })),
	);
	assert.equal(result.status, 'unavailable');
	assert.equal(result.status === 'unavailable' ? result.reason : null,
		'production-readiness-unattested');
});

test('the spawn verifier fails closed and rechecks the payload on every call', async () => {
	let payloadReads = 0;
	const verify = createFramescaperMediaHostVerifier(location(), {
		readFile: async (path) => {
			if (path === MANIFEST_PATH) return Buffer.from(JSON.stringify(manifest()));
			if (path === DEVELOPMENT_PATH) {
				payloadReads += 1;
				return payloadReads === 1 ? BYTES : Buffer.from('changed');
			}
			return payloadBytes(path);
		},
		stat: async (path) => fileStat(payloadBytes(path).byteLength, path),
		resolveReviewPublicKey: () => KEY.publicKey.export({ type: 'spki', format: 'pem' }),
	});
	assert.equal((await verify()).target, 'linux-x64');
	await assert.rejects(verify(), /payload-digest-mismatch/u);
});

function location() {
	return Object.freeze({
		applicationRoot: '/application', packaged: false, resourcesPath: '/unused',
		platform: 'linux', arch: 'x64',
	});
}

function manifest(overrides: Readonly<{
	built?: boolean;
	runtime?: string;
	path?: string;
	attested?: boolean;
}> = {}) {
	const built = overrides.built ?? true;
	const runtime = overrides.runtime ?? 'linux-x64';
	const path = overrides.path
		?? 'native/framescaper-media-host/prebuilt/linux-x64/framescaper-media-host';
	const payload = { path, byteLength: BYTES.byteLength, sha256: SHA256 };
	const isolationPayload = isolationManifest();
	const selected = {
		id: 'linux-x64', runtime,
		status: built ? 'built' : 'pending-external',
		blockedBy: built ? null : 'No qualified synthetic payload exists.',
		payload: built ? payload : null,
		isolationPayload: built ? isolationPayload : null,
		productionReadiness: built && (overrides.attested ?? true) ? readinessReference() : null,
	};
	const pending = [
		['linux-arm64', 'linux-arm64'], ['mac-arm64', 'darwin-arm64'],
		['win-x64', 'win32-x64'], ['win-arm64', 'win32-arm64'],
	].map(([id, targetRuntime]) => ({
		id, runtime: targetRuntime, status: 'pending-external',
		blockedBy: 'No qualified synthetic payload exists.', payload: null,
		isolationPayload: null, productionReadiness: null,
	}));
	return {
		schemaVersion: 1,
		id: 'framescaper-media-host-1.0.0',
		sourceManifestPath: 'native/framescaper-media-host/source-manifest.json',
		ffmpeg: {
			version: '9.0.1',
			sha256: 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
		},
		runtimePrefix: 'native/framescaper-media-host',
		payloads: built ? [{ id: 'linux-x64', runtime, ...payload, isolationPayload }] : [],
		targets: [selected, ...pending],
	};
}

function ports(value: unknown, payload = BYTES) {
	return {
		readFile: async (path: string) => path === MANIFEST_PATH
			? Buffer.from(JSON.stringify(value))
			: path === DEVELOPMENT_PATH ? payload : payloadBytes(path),
		stat: async (path: string) => fileStat(
			path === DEVELOPMENT_PATH ? payload.byteLength : payloadBytes(path).byteLength, path,
		),
		resolveReviewPublicKey: () => KEY.publicKey.export({ type: 'spki', format: 'pem' }),
	};
}

function fileStat(size: number, path: string) {
	return Object.freeze({
		isFile: () => true, isSymbolicLink: () => false, size, dev: 7, ino: identityFor(path),
	});
}

function isolationManifest() {
	return {
		launcherPayload: sourceDescriptor(
			'native/framescaper-media-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-launcher',
			LAUNCHER,
		),
		sandboxProfilePayload: sourceDescriptor(
			'native/framescaper-media-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-profile.json',
			PROFILE,
		),
		brokerPolicyPayload: sourceDescriptor(
			'native/framescaper-media-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-broker.json',
			BROKER,
		),
		runtimeLibraryPayloads: [sourceDescriptor(
			'native/framescaper-media-host/prebuilt/linux-x64/lib/libframescaper-media.so',
			LIBRARY,
		)],
	};
}

function readinessReference() {
	const bytes = Buffer.from(JSON.stringify(readinessEvidence()));
	return {
		schemaVersion: 2, status: 'reviewed', target: 'linux-x64',
		evidence: {
			path: 'config/framescaper-media-host-production-readiness/linux-x64.json',
			byteLength: bytes.byteLength, sha256: digest(bytes),
		},
		signature: {
			algorithm: 'ed25519', reviewKeyId: KEY_ID,
			valueBase64: sign(null, bytes, KEY.privateKey).toString('base64'),
		},
	};
}

function readinessEvidence() {
	const isolation = isolationManifest();
	return {
		schemaVersion: 1, kind: 'framescaper-media-host-production-readiness', target: 'linux-x64',
		mediaHostSha256: SHA256,
		runtimeLibraries: [{ name: 'libframescaper-media.so', byteLength: LIBRARY.byteLength,
			sha256: digest(LIBRARY) }],
		launcher: {
			schemaVersion: 1, target: 'linux-x64',
			launcherId: 'framescaper-linux-landlock-seccomp-namespaces-v1',
			launcherPayloadSha256: isolation.launcherPayload.sha256,
			sandboxProfileSha256: isolation.sandboxProfilePayload.sha256,
			brokerPolicySha256: isolation.brokerPolicyPayload.sha256,
			filesystem: 'broker-grant-only', network: 'denied', childProcesses: 'denied',
			dynamicCode: 'denied',
		},
		ffmpegVersion: '9.0.1', osIsolationAttested: true,
		hostileMediaDenialAttested: true, dualStreamFdRemapAttested: true,
		twoHourContinuityAttested: true, reviewedAt: '2026-08-24',
		reviewer: 'synthetic media isolation reviewer',
	};
}

function payloadBytes(path: string): Buffer {
	if (path === EVIDENCE_PATH || path === PACKAGED_EVIDENCE_PATH) {
		return Buffer.from(JSON.stringify(readinessEvidence()));
	}
	if (path.includes('launcher')) return LAUNCHER;
	if (path.includes('profile')) return PROFILE;
	if (path.includes('broker')) return BROKER;
	if (path.includes('libframescaper')) return LIBRARY;
	return BYTES;
}

function sourceDescriptor(path: string, bytes: Buffer) {
	return { path, byteLength: bytes.byteLength, sha256: digest(bytes) };
}

function runtimeDescriptor(path: string, bytes: Buffer) {
	return { ...sourceDescriptor(path, bytes), identity: { dev: 7, ino: identityFor(path) } };
}

function identityFor(path: string): number {
	if (path.includes('launcher')) return 20;
	if (path.includes('profile')) return 21;
	if (path.includes('broker')) return 22;
	if (path.includes('libframescaper')) return 23;
	return 19;
}

function digest(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}
