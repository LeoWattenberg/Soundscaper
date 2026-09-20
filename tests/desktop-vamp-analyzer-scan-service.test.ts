/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DesktopVampAnalyzerRegistry,
	type VampAnalyzerLibraryObservation,
} from '../desktop/vamp-analyzer-registry.ts';
import {
	DesktopVampAnalyzerScanService,
	projectVampAnalyzerScanForRenderer,
	validateHelperVampAnalyzerScanResult,
} from '../desktop/vamp-analyzer-scan-service.ts';

const OWNER = {};
const ROOT = Object.freeze({
	path: '/usr/lib/vamp', identity: Object.freeze({ dev: 2, ino: 3 }), scanDigest: 'a'.repeat(64),
});

function observation(
	overrides: Partial<VampAnalyzerLibraryObservation> = {},
): VampAnalyzerLibraryObservation {
	return {
		kind: 'analyzer-library', format: 'vamp', libraryPath: '/usr/lib/vamp/markers.so',
		libraryBytes: 8_192, librarySha256: 'b'.repeat(64), identity: { dev: 4, ino: 5 },
		platform: 'linux', architecture: 'x64', compatibility: 'compatible',
		descriptors: [{
			kind: 'analyzer', format: 'vamp', identifier: 'org.example.markers', name: 'Markers',
			description: 'Finds markers', maker: 'Example', copyright: '', pluginVersion: 7,
			vampApiVersion: 2, inputDomain: 'time', minimumChannels: 1, maximumChannels: 2,
			preferredStepSize: 512, preferredBlockSize: 1_024, parameters: [], programs: [],
			outputs: [{
				identifier: 'markers', name: 'Markers', description: '', unit: '', binCount: 1,
				binNames: ['Strength'], extents: null, quantizeStep: null,
				sampleType: 'variable-sample-rate', sampleRate: null, hasDuration: false,
			}],
		}],
		...overrides,
	};
}

function helperResult() {
	return {
		format: 'vamp', status: 'scanned', detail: '', libraries: [observation()],
	};
}

test('Vamp scan admission is exact and its renderer projection drops every library path', () => {
	const admitted = validateHelperVampAnalyzerScanResult(helperResult());
	assert.equal(admitted.libraries[0]?.libraryPath, '/usr/lib/vamp/markers.so');
	const projected = projectVampAnalyzerScanForRenderer(admitted);
	assert.deepEqual(projected, {
		format: 'vamp', status: 'scanned', detail: '', entries: [{
			stableId: 'vif032578a9b17856352322fb79db28e', name: 'Markers', vendor: 'Example',
			version: '7', classification: 'analyzer', compatibility: 'compatible',
		}],
	});
	assert.equal(JSON.stringify(projected).includes('/usr/lib'), false);
	assert.equal(JSON.stringify(projected).includes('libraryPath'), false);
	assert.throws(() => validateHelperVampAnalyzerScanResult({
		...helperResult(), libraries: [{ ...observation(), surprise: true }],
	}), /invalid keys/iu);
	assert.throws(() => validateHelperVampAnalyzerScanResult({
		...helperResult(), format: 'vst3',
	}), /format/iu);
});

test('Vamp scan service requires consent, resolves only main-owned roots, and records libraries', async () => {
	const registry = new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	let consented = false;
	const jobs: unknown[] = [];
	const service = new DesktopVampAnalyzerScanService({
		supervisor: {
			runJob: async (request) => { jobs.push(request); return helperResult(); },
			snapshot: () => ({ state: 'ready', quarantined: false }),
		},
		consent: { isGranted: () => consented },
		quarantine: { isQuarantined: () => false, quarantine: () => undefined },
		roots: { resolve: (rootId, format) => rootId === 'root-1' && format === 'vamp' ? ROOT : null },
		isEnabled: () => true,
		describePayload: async () => ({ status: 'available', descriptor: {} } as never),
		registry,
	});
	assert.equal((await service.scanRoot({ owner: OWNER, rootId: 'root-1', format: 'vamp' })).status,
		'failed');
	consented = true;
	const result = await service.scanRoot({ owner: OWNER, rootId: 'root-1', format: 'vamp' });
	assert.equal(result.status, 'described');
	assert.equal(jobs.length, 1);
	assert.equal((jobs[0] as { kind: string }).kind, 'plugin-scan');
	assert.equal(JSON.stringify(result).includes('/usr/lib'), false);
	assert.equal(registry.describe().entries[0]?.name, 'Markers');
	assert.equal((await service.scanRoot({ owner: OWNER, rootId: 'missing', format: 'vamp' })).status,
		'failed');
});

test('Vamp scanner faults quarantine only their root and owner revocation cancels an in-flight scan', async () => {
	const quarantined: Array<readonly [string, string]> = [];
	let release: ((value: unknown) => void) | undefined;
	const pending = new Promise((resolve) => { release = resolve; });
	const service = new DesktopVampAnalyzerScanService({
		supervisor: {
			runJob: async ({ signal }) => {
				await Promise.race([pending, new Promise((_, reject) => signal?.addEventListener('abort',
					() => reject(signal.reason), { once: true }))]);
				return helperResult();
			},
			snapshot: () => ({ state: 'ready', quarantined: false }),
		},
		consent: { isGranted: () => true },
		quarantine: {
			isQuarantined: () => false,
			quarantine: (digest, reason) => { quarantined.push([digest, reason]); },
		},
		roots: { resolve: () => ROOT }, isEnabled: () => true,
		describePayload: async () => ({ status: 'available', descriptor: {} } as never),
		registry: new DesktopVampAnalyzerRegistry({ isQuarantined: () => false }),
	});
	const scan = service.scanRoot({ owner: OWNER, rootId: 'root-1', format: 'vamp' });
	await new Promise((resolve) => setTimeout(resolve, 0));
	service.revokeOwner(OWNER);
	assert.equal((await scan).status, 'failed');
	assert.deepEqual(quarantined, []);
	release?.(undefined);
});
