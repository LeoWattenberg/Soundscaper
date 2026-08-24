/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
	createFramescaperOpenFxHostVerifier,
	describeFramescaperOpenFxHostAvailability,
	framescaperOpenFxHostTargetFor,
} from '../desktop/framescaper-openfx-host-payload.ts';

const SCANNER = Buffer.from('synthetic-framescaper-openfx-scanner');
const RUNTIME = Buffer.from('synthetic-framescaper-openfx-runtime');
const LAUNCHER = Buffer.from('synthetic-native-isolation-launcher');
const PROFILE = Buffer.from('synthetic-native-isolation-profile');
const BROKER = Buffer.from('synthetic-native-isolation-broker');
const LIBRARY = Buffer.from('synthetic-openfx-runtime-library');
const SCANNER_SHA256 = digest(SCANNER);
const RUNTIME_SHA256 = digest(RUNTIME);
const LAUNCHER_SHA256 = digest(LAUNCHER);
const PROFILE_SHA256 = digest(PROFILE);
const BROKER_SHA256 = digest(BROKER);
const LIBRARY_SHA256 = digest(LIBRARY);
const MANIFEST_PATH = '/application/config/framescaper-openfx-host-payload-manifest.json';
const SCANNER_PATH =
	'/application/native/framescaper-openfx-host/prebuilt/linux-x64/bin/framescaper-ofx-scanner';
const RUNTIME_PATH =
	'/application/native/framescaper-openfx-host/prebuilt/linux-x64/bin/framescaper-ofx-runtime-host';
const LAUNCHER_PATH =
	'/application/native/framescaper-openfx-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-launcher';
const PROFILE_PATH =
	'/application/native/framescaper-openfx-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-profile.json';
const BROKER_PATH =
	'/application/native/framescaper-openfx-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-broker.json';
const LIBRARY_PATH =
	'/application/native/framescaper-openfx-host/prebuilt/linux-x64/lib/ld-linux-x86-64.so.2';
const EVIDENCE_PATH = '/application/config/framescaper-openfx-production-readiness/linux-x64.json';
const PACKAGED_EVIDENCE_PATH =
	'/resources/runtime/native/framescaper-openfx-host/linux-x64/framescaper-openfx-production-readiness.json';
const REVIEW_KEY_ID = 'synthetic-openfx-review-key-v1';
const REVIEW_KEY = generateKeyPairSync('ed25519');

test('the OpenFX host resolver admits only the five exact runtime targets', () => {
	assert.equal(framescaperOpenFxHostTargetFor('linux', 'x64'), 'linux-x64');
	assert.equal(framescaperOpenFxHostTargetFor('darwin', 'arm64'), 'mac-arm64');
	assert.equal(framescaperOpenFxHostTargetFor('win32', 'arm64'), 'win-arm64');
	assert.equal(framescaperOpenFxHostTargetFor('darwin', 'x64'), null);
	assert.equal(framescaperOpenFxHostTargetFor('freebsd', 'x64'), null);
});

test('a built OpenFX target requires two independently authenticated payloads', async () => {
	const reads: string[] = [];
	const availability = await describeFramescaperOpenFxHostAvailability(location(), {
		readFile: async (path) => {
			reads.push(path);
			if (path === MANIFEST_PATH) return Buffer.from(JSON.stringify(manifest()));
			if (path === EVIDENCE_PATH) return productionReadinessEvidenceBytes();
			return payloadBytes(path);
		},
		stat: async (path) => fileStat(path, payloadBytes(path).byteLength),
		resolveReviewPublicKey: () => REVIEW_KEY.publicKey.export({ type: 'spki', format: 'pem' }),
	});
	assert.equal(availability.status, 'available');
	if (availability.status !== 'available') return;
		assert.deepEqual(availability.descriptor, {
		target: 'linux-x64', runtime: 'linux-x64', hostVersion: '1.0.0',
		openfxVersion: '1.5.1', openfxCommit: 'ab77951',
		scanner: {
			path: SCANNER_PATH, byteLength: SCANNER.byteLength, sha256: SCANNER_SHA256,
			identity: { dev: 7, ino: 19 },
		},
			runtimeHost: {
				path: RUNTIME_PATH, byteLength: RUNTIME.byteLength, sha256: RUNTIME_SHA256,
				identity: { dev: 7, ino: identityFor(RUNTIME_PATH) },
			},
			isolation: {
				launcher: runtimeDescriptor(LAUNCHER_PATH, LAUNCHER),
				sandboxProfile: runtimeDescriptor(PROFILE_PATH, PROFILE),
				brokerPolicy: runtimeDescriptor(BROKER_PATH, BROKER),
				runtimeLibraries: [runtimeDescriptor(LIBRARY_PATH, LIBRARY)],
			},
			productionReadiness: productionReadinessEvidence(),
		});
	assert.deepEqual(reads, [
		MANIFEST_PATH, SCANNER_PATH, RUNTIME_PATH, LAUNCHER_PATH, PROFILE_PATH,
		BROKER_PATH, LIBRARY_PATH, EVIDENCE_PATH, EVIDENCE_PATH,
	]);
});

test('packaged OpenFX payloads resolve only below the external runtime prefix', async () => {
	const reads: string[] = [];
	const availability = await describeFramescaperOpenFxHostAvailability({
		...location(), packaged: true, resourcesPath: '/resources',
	}, ports(manifest(), reads));
	assert.equal(availability.status, 'available');
	if (availability.status !== 'available') return;
	assert.equal(
		availability.descriptor.scanner.path,
		'/resources/runtime/native/framescaper-openfx-host/linux-x64/framescaper-ofx-scanner',
	);
	assert.equal(
		availability.descriptor.runtimeHost.path,
		'/resources/runtime/native/framescaper-openfx-host/linux-x64/framescaper-ofx-runtime-host',
	);
	assert.ok(reads.includes(PACKAGED_EVIDENCE_PATH));
});

test('prepared desktop development resolves both hosts from its staged external runtime', async () => {
	const scanner = '/build/runtime/native/framescaper-openfx-host/linux-x64/framescaper-ofx-scanner';
	const runtime = '/build/runtime/native/framescaper-openfx-host/linux-x64/framescaper-ofx-runtime-host';
	const reads: string[] = [];
	const availability = await describeFramescaperOpenFxHostAvailability({
		...location(), externalRuntimeRoot: '/build/runtime',
	}, {
		readFile: async (path) => {
			reads.push(path);
			if (path === MANIFEST_PATH) return Buffer.from(JSON.stringify(manifest()));
			if (path === EVIDENCE_PATH) return productionReadinessEvidenceBytes();
			return path === scanner ? SCANNER : path === runtime ? RUNTIME : payloadBytes(path);
		},
		stat: async (path) => fileStat(path, path === scanner ? SCANNER.byteLength
			: path === runtime ? RUNTIME.byteLength : payloadBytes(path).byteLength),
		resolveReviewPublicKey: () => REVIEW_KEY.publicKey.export({ type: 'spki', format: 'pem' }),
	});
	assert.equal(availability.status, 'available');
	if (availability.status !== 'available') return;
	assert.equal(availability.descriptor.scanner.path, scanner);
	assert.equal(availability.descriptor.runtimeHost.path, runtime);
	assert.equal(reads.at(-1), EVIDENCE_PATH);
	assert.equal(reads.length, 9);
});

test('OpenFX readiness mutation between independent evidence opens is refused', async () => {
	let evidenceReads = 0;
	const changed = productionReadinessEvidenceBytes();
	changed[changed.byteLength - 1] ^= 1;
	const availability = await describeFramescaperOpenFxHostAvailability(location(), {
		...ports(manifest()),
		readFile: async (path) => {
			if (path === MANIFEST_PATH) return Buffer.from(JSON.stringify(manifest()));
			if (path === EVIDENCE_PATH) {
				evidenceReads += 1;
				return evidenceReads === 1 ? productionReadinessEvidenceBytes() : changed;
			}
			return payloadBytes(path);
		},
	});
	assert.equal(evidenceReads, 2);
	assert.equal(availability.status, 'unavailable');
	assert.equal(availability.status === 'unavailable' ? availability.reason : null,
		'production-readiness-evidence-mismatch');
});

test('pending, partial, altered, and malformed OpenFX payloads remain unavailable', async () => {
	const pending = await describeFramescaperOpenFxHostAvailability(
		location(), ports(manifest({ built: false })),
	);
	assert.equal(pending.status, 'unavailable');
	assert.equal(pending.status === 'unavailable' ? pending.reason : null, 'payload-pending-external');

	for (const [label, value, alteredPath, alteredBytes, reason] of [
		['missing runtime row', { ...manifest(), payloads: [] }, '', RUNTIME, 'manifest-unreadable'],
		['unsafe scanner path', manifest({ scannerPath: '../scanner' }), '', RUNTIME, 'manifest-unreadable'],
		['altered scanner', manifest(), SCANNER_PATH, Buffer.from('altered'), 'payload-digest-mismatch'],
		['altered runtime', manifest(), RUNTIME_PATH, Buffer.from('altered'), 'payload-digest-mismatch'],
	] as const) {
		const result = await describeFramescaperOpenFxHostAvailability(
			location(), ports(value, [], alteredPath, alteredBytes),
		);
		assert.equal(result.status, 'unavailable', label);
		assert.equal(result.status === 'unavailable' ? result.reason : null, reason, label);
	}
});

test('a built payload remains unavailable without reviewed production-readiness evidence', async () => {
	const availability = await describeFramescaperOpenFxHostAvailability(
		location(), ports(manifest({ attested: false })),
	);
	assert.equal(availability.status, 'unavailable');
	assert.equal(
		availability.status === 'unavailable' ? availability.reason : null,
		'production-readiness-unattested',
	);
});

test('caller-authored readiness cannot replace reopened signed launcher evidence', async () => {
	const untrusted = generateKeyPairSync('ed25519');
	const availability = await describeFramescaperOpenFxHostAvailability(
		location(), {
			...ports(manifest()),
			resolveReviewPublicKey: () => untrusted.publicKey.export({ type: 'spki', format: 'pem' }),
		},
	);
	assert.equal(availability.status, 'unavailable');
	assert.equal(
		availability.status === 'unavailable' ? availability.reason : null,
		'production-readiness-evidence-mismatch',
	);
});

test('the OpenFX spawn verifier rechecks both payloads before every process spawn', async () => {
	let scannerReads = 0;
	const verify = createFramescaperOpenFxHostVerifier(location(), {
		readFile: async (path) => {
			if (path === MANIFEST_PATH) return Buffer.from(JSON.stringify(manifest()));
			if (path === EVIDENCE_PATH) return productionReadinessEvidenceBytes();
			if (path === SCANNER_PATH) {
				scannerReads += 1;
				return scannerReads === 1 ? SCANNER : Buffer.from('changed');
			}
			return payloadBytes(path);
		},
		stat: async (path) => fileStat(path, payloadBytes(path).byteLength),
		resolveReviewPublicKey: () => REVIEW_KEY.publicKey.export({ type: 'spki', format: 'pem' }),
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
	scannerPath?: string;
	attested?: boolean;
}> = {}) {
	const built = overrides.built ?? true;
	const scannerPayload = {
		path: overrides.scannerPath ?? 'native/framescaper-openfx-host/prebuilt/linux-x64/bin/framescaper-ofx-scanner',
		byteLength: SCANNER.byteLength, sha256: SCANNER_SHA256,
	};
	const runtimeHostPayload = {
		path: 'native/framescaper-openfx-host/prebuilt/linux-x64/bin/framescaper-ofx-runtime-host',
		byteLength: RUNTIME.byteLength, sha256: RUNTIME_SHA256,
	};
	const isolationPayload = {
		launcherPayload: sourceDescriptor(
			'native/framescaper-openfx-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-launcher',
			LAUNCHER,
		),
		sandboxProfilePayload: sourceDescriptor(
			'native/framescaper-openfx-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-profile.json',
			PROFILE,
		),
		brokerPolicyPayload: sourceDescriptor(
			'native/framescaper-openfx-host/prebuilt/linux-x64/isolation/milestone5-native-isolation-broker.json',
			BROKER,
		),
		runtimeLibraryPayloads: [sourceDescriptor(
			'native/framescaper-openfx-host/prebuilt/linux-x64/lib/ld-linux-x86-64.so.2',
			LIBRARY,
		)],
	};
	const selected = {
		id: 'linux-x64', runtime: 'linux-x64', status: built ? 'built' : 'pending-external',
		blockedBy: built ? null : 'No qualified synthetic OpenFX payload exists.',
		payload: built ? { scannerPayload, runtimeHostPayload, isolationPayload } : null,
		productionReadiness: built && (overrides.attested ?? true)
			? productionReadiness(scannerPayload.sha256, runtimeHostPayload.sha256)
			: null,
	};
	const pending = [
		['linux-arm64', 'linux-arm64'], ['mac-arm64', 'darwin-arm64'],
		['win-x64', 'win32-x64'], ['win-arm64', 'win32-arm64'],
	].map(([id, runtime]) => ({
		id, runtime, status: 'pending-external',
		blockedBy: 'No qualified synthetic OpenFX payload exists.', payload: null,
		productionReadiness: null,
	}));
	return {
		schemaVersion: 1, id: 'framescaper-openfx-host-1.0.0',
		sourceManifestPath: 'native/framescaper-openfx-host/source-manifest.json',
		openfx: {
			version: '1.5.1', commit: 'ab77951',
			sha256: '7f4fcde6c4bff3ee1f95a0b73a805e662a3e030999523165b40cfbe76c1ab9f5',
		},
		runtimePrefix: 'native/framescaper-openfx-host',
		payloads: built ? [{
			id: 'linux-x64', runtime: 'linux-x64', scannerPayload, runtimeHostPayload, isolationPayload,
		}] : [],
		targets: [selected, ...pending],
	};
}

function productionReadiness(_scannerSha256: string, _runtimeHostSha256: string) {
	const bytes = productionReadinessEvidenceBytes();
	return {
		schemaVersion: 2, status: 'reviewed', target: 'linux-x64',
		evidence: {
			path: 'config/framescaper-openfx-production-readiness/linux-x64.json',
			byteLength: bytes.byteLength, sha256: digest(bytes),
		},
		signature: {
			algorithm: 'ed25519', reviewKeyId: REVIEW_KEY_ID,
			valueBase64: sign(null, bytes, REVIEW_KEY.privateKey).toString('base64'),
		},
	};
}

function productionReadinessEvidence() {
	return {
		schemaVersion: 1, kind: 'framescaper-openfx-production-readiness', target: 'linux-x64',
		scannerSha256: SCANNER_SHA256, runtimeHostSha256: RUNTIME_SHA256,
		qualifiedGpuBackends: ['opengl', 'opencl', 'cuda'],
		runtimeLibraries: [{ name: 'ld-linux-x86-64.so.2', byteLength: LIBRARY.byteLength, sha256: LIBRARY_SHA256 }],
		launcher: {
			schemaVersion: 1, target: 'linux-x64',
			launcherId: 'framescaper-linux-landlock-seccomp-namespaces-v1',
			launcherPayloadSha256: LAUNCHER_SHA256, sandboxProfileSha256: PROFILE_SHA256,
			brokerPolicySha256: BROKER_SHA256, filesystem: 'broker-only', network: 'denied',
			childProcesses: 'denied', dynamicCode: 'admitted-plugin-only',
		},
		openfxVersion: '1.5.1', osIsolationAttested: true,
		hostilePluginDenialAttested: true, realThirdPartyExecutionAttested: true,
		reviewedAt: '2026-08-22', reviewer: 'synthetic-test-reviewer',
	};
}

function productionReadinessEvidenceBytes() {
	return Buffer.from(JSON.stringify(productionReadinessEvidence()));
}

function ports(value: unknown, reads: string[] = [], alteredPath = '', alteredBytes = RUNTIME) {
	return {
		readFile: async (path: string) => {
			reads.push(path);
			if (path === MANIFEST_PATH) return Buffer.from(JSON.stringify(value));
			if (path === EVIDENCE_PATH || path === PACKAGED_EVIDENCE_PATH) {
				return productionReadinessEvidenceBytes();
			}
			if (path === alteredPath) return alteredBytes;
			return payloadBytes(path);
		},
		stat: async (path: string) => fileStat(path, payloadBytes(path).byteLength),
		resolveReviewPublicKey: () => REVIEW_KEY.publicKey.export({ type: 'spki', format: 'pem' }),
	};
}

function fileStat(path: string, size: number) {
	return Object.freeze({
		isFile: () => true, isSymbolicLink: () => false, size, dev: 7, ino: identityFor(path),
	});
}

function identityFor(path: string): number {
	if (path.includes('scanner')) return 19;
	if (path.includes('runtime-host')) return 20;
	if (path.includes('launcher')) return 21;
	if (path.includes('profile')) return 22;
	if (path.includes('broker')) return 23;
	return 24;
}

function payloadBytes(path: string): Buffer {
	if (path.includes('scanner')) return SCANNER;
	if (path.includes('runtime-host')) return RUNTIME;
	if (path.includes('launcher')) return LAUNCHER;
	if (path.includes('profile')) return PROFILE;
	if (path.includes('broker')) return BROKER;
	return LIBRARY;
}

function runtimeDescriptor(path: string, bytes: Buffer) {
	return { path, byteLength: bytes.byteLength, sha256: digest(bytes), identity: { dev: 7, ino: identityFor(path) } };
}

function sourceDescriptor(path: string, bytes: Buffer) {
	return { path, byteLength: bytes.byteLength, sha256: digest(bytes) };
}

function digest(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}
