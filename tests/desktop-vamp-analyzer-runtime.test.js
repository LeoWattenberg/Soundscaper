/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
	resolve(specifier, context, nextResolve) {
		const prefix = './project-library-runtime/desktop/';
		if (specifier.startsWith(prefix)) {
			return nextResolve(`./${specifier.slice(prefix.length).replace(/\.js$/u, '.ts')}`, context);
		}
		return nextResolve(specifier, context);
	},
});

const { createDesktopVampAnalyzerRuntime } = await import('../desktop/vamp-analyzer-runtime.mjs');

const OWNER = {};
const DIGEST = 'e'.repeat(64);

function observation() {
	return {
		kind: 'analyzer-library', format: 'vamp', libraryPath: '/usr/lib/vamp/onsets.so',
		libraryBytes: 8192, librarySha256: DIGEST, identity: { dev: 1, ino: 2 },
		platform: 'linux', architecture: 'x64', compatibility: 'compatible', descriptors: [{
			kind: 'analyzer', format: 'vamp', identifier: 'org.example.onsets', name: 'Onsets',
			description: '', maker: 'Example', copyright: '', pluginVersion: 3, vampApiVersion: 2,
			inputDomain: 'time', minimumChannels: 1, maximumChannels: 2,
			preferredStepSize: 256, preferredBlockSize: 1024,
			parameters: [{ identifier: 'threshold', name: 'Threshold', description: '', unit: '',
				minimumValue: 0, maximumValue: 1, defaultValue: 0.5, quantizeStep: null, valueNames: [] }],
			programs: ['Default'], outputs: [{ identifier: 'onsets', name: 'Onsets', description: '',
				unit: '', binCount: 1, binNames: [], extents: null, quantizeStep: null,
				sampleType: 'variable-sample-rate', sampleRate: null, hasDuration: false }],
		}],
	};
}

function harness() {
	const persisted = [];
	const calls = [];
	const allowances = {
		observe: (...args) => { calls.push(['observe', ...args]); },
		apply: (registry) => registry.describe(),
		rebind: async () => false,
		capture: async (registry) => { persisted.push(registry.describe()); },
	};
	const runtime = createDesktopVampAnalyzerRuntime({
		supervisor: {
			runJob: async () => ({ format: 'vamp', status: 'scanned', detail: '', libraries: [observation()] }),
			snapshot: () => ({ state: 'ready', quarantined: false }),
		},
		consent: { isGranted: () => true },
		quarantine: { isQuarantined: () => false, quarantine: () => undefined },
		roots: { resolve: () => ({ path: '/usr/lib/vamp', identity: { dev: 1, ino: 1 }, scanDigest: 'f'.repeat(64) }) },
		isEnabled: () => true,
		describePayload: async () => ({ status: 'available', descriptor: {} }),
		allowances,
		backend: {
			open: async () => ({
				configure: async () => ({ outputs: observation().descriptors[0].outputs }),
				process: async () => [{ outputId: 'onsets', timestamp: { seconds: 0, nanoseconds: 0 },
					duration: null, values: [1], label: 'onset' }],
				finish: async () => [], cancel: async (reason) => { calls.push(['cancel', reason]); },
				close: async () => { calls.push(['close']); },
			}),
		},
		mintSessionId: () => 'vamp_session_1',
	});
	return { runtime, calls, persisted };
}

test('runtime publishes a pathless catalog only after explicit installation allowance', async () => {
	const { runtime, persisted } = harness();
	const scanned = await runtime.scanRoot(OWNER, { rootId: 'standard', format: 'vamp' });
	assert.equal(scanned.status, 'described');
	assert.deepEqual(runtime.catalog(), []);
	const inventory = runtime.registryView();
	const installationId = inventory.entries[0].installations[0].installationId;
	await runtime.setInstallationAllowed(installationId, true);
	const catalog = runtime.catalog();
	assert.equal(catalog.length, 1);
	assert.equal(catalog[0].stableId, installationId);
	assert.equal(catalog[0].configuration.preferredBlockSize, 1024);
	assert.equal(JSON.stringify(catalog).includes('/usr/lib'), false);
	assert.equal(persisted.length, 1);
	assert.equal(runtime.pluginRegistryEntries()[0].kind, 'analyzer');
});

test('runtime binds the renderer analyzer identity while streaming finite PCM', async () => {
	const { runtime } = harness();
	await runtime.scanRoot(OWNER, { rootId: 'standard', format: 'vamp' });
	const installationId = runtime.registryView().entries[0].installations[0].installationId;
	await runtime.setInstallationAllowed(installationId, true);
	const descriptor = runtime.catalog()[0];
	await assert.rejects(() => runtime.start(OWNER, {
		analyzerId: descriptor.analyzerId, stableId: descriptor.stableId,
		binarySha256: '0'.repeat(64), sessionId: null,
	}), /identity/iu);
	const session = await runtime.start(OWNER, {
		analyzerId: descriptor.analyzerId, stableId: descriptor.stableId,
		binarySha256: descriptor.binarySha256, sessionId: null,
	});
	await runtime.configure(OWNER, {
		sessionId: session.sessionId, sampleRate: 48000, channelCount: 1,
		stepSize: 2, blockSize: 4, frameCount: 4, parameters: { threshold: 0.5 },
		program: 'Default',
	});
	const batch = await runtime.pushPcm(OWNER, {
		sessionId: session.sessionId, startFrame: 0, channels: [Float32Array.of(0, 0, 0, 0)],
	});
	assert.equal(batch.features[0].label, 'onset');
	assert.equal((await runtime.finish(OWNER, { sessionId: session.sessionId })).session.state, 'finished');
});

test('withdrawing allowance actively cancels an analyzer session', async () => {
	const { runtime, calls } = harness();
	await runtime.scanRoot(OWNER, { rootId: 'standard', format: 'vamp' });
	const installationId = runtime.registryView().entries[0].installations[0].installationId;
	await runtime.setInstallationAllowed(installationId, true);
	const descriptor = runtime.catalog()[0];
	await runtime.start(OWNER, { analyzerId: descriptor.analyzerId, stableId: descriptor.stableId,
		binarySha256: descriptor.binarySha256, sessionId: null });
	await runtime.setInstallationAllowed(installationId, false);
	assert.deepEqual(calls.slice(-2), [['cancel', 'allowance-withdrawn'], ['close']]);
});
