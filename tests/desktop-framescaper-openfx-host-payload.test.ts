/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createFramescaperOpenFxHostVerifier,
	describeFramescaperOpenFxHostAvailability,
	framescaperOpenFxHostTargetFor,
} from '../desktop/framescaper-openfx-host-payload.ts';

const SCANNER = Buffer.from('synthetic-framescaper-openfx-scanner');
const RUNTIME = Buffer.from('synthetic-framescaper-openfx-runtime');
const SCANNER_SHA256 = digest(SCANNER);
const RUNTIME_SHA256 = digest(RUNTIME);
const MANIFEST_PATH = '/application/config/framescaper-openfx-host-payload-manifest.json';
const SCANNER_PATH =
	'/application/native/framescaper-openfx-host/prebuilt/linux-x64/bin/framescaper-ofx-scanner';
const RUNTIME_PATH =
	'/application/native/framescaper-openfx-host/prebuilt/linux-x64/bin/framescaper-ofx-runtime-host';

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
			return path === SCANNER_PATH ? SCANNER : RUNTIME;
		},
		stat: async (path) => fileStat(path === SCANNER_PATH ? SCANNER.byteLength : RUNTIME.byteLength),
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
			identity: { dev: 7, ino: 19 },
		},
	});
	assert.deepEqual(reads, [MANIFEST_PATH, SCANNER_PATH, RUNTIME_PATH]);
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

test('the OpenFX spawn verifier rechecks both payloads before every process spawn', async () => {
	let scannerReads = 0;
	const verify = createFramescaperOpenFxHostVerifier(location(), {
		readFile: async (path) => {
			if (path === MANIFEST_PATH) return Buffer.from(JSON.stringify(manifest()));
			if (path === SCANNER_PATH) {
				scannerReads += 1;
				return scannerReads === 1 ? SCANNER : Buffer.from('changed');
			}
			return RUNTIME;
		},
		stat: async (path) => fileStat(path === SCANNER_PATH ? SCANNER.byteLength : RUNTIME.byteLength),
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
	const selected = {
		id: 'linux-x64', runtime: 'linux-x64', status: built ? 'built' : 'pending-external',
		blockedBy: built ? null : 'No qualified synthetic OpenFX payload exists.',
		payload: built ? { scannerPayload, runtimeHostPayload } : null,
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
			id: 'linux-x64', runtime: 'linux-x64', scannerPayload, runtimeHostPayload,
		}] : [],
		targets: [selected, ...pending],
	};
}

function productionReadiness(scannerSha256: string, runtimeHostSha256: string) {
	return {
		schemaVersion: 1,
		status: 'reviewed',
		target: 'linux-x64',
		scannerSha256,
		runtimeHostSha256,
		osIsolationAttested: true,
		realThirdPartyExecutionAttested: true,
		reviewedAt: '2026-08-22',
		reviewer: 'synthetic-test-reviewer',
		evidenceSha256: '34'.repeat(32),
	};
}

function ports(value: unknown, reads: string[] = [], alteredPath = '', alteredBytes = RUNTIME) {
	return {
		readFile: async (path: string) => {
			reads.push(path);
			if (path === MANIFEST_PATH) return Buffer.from(JSON.stringify(value));
			if (path === alteredPath) return alteredBytes;
			return path.includes('scanner') ? SCANNER : RUNTIME;
		},
		stat: async (path: string) => fileStat(path.includes('scanner') ? SCANNER.byteLength : RUNTIME.byteLength),
	};
}

function fileStat(size: number) {
	return Object.freeze({ isFile: () => true, isSymbolicLink: () => false, size, dev: 7, ino: 19 });
}

function digest(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}
