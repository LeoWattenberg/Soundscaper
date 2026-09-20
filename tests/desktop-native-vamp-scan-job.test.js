/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativePluginScanJobRunner } from '../desktop/native-helper-scan-job.js';

test('the scanner returns exact Vamp analyzer-library observations instead of effect entries', async () => {
	const runner = createNativePluginScanJobRunner({
		addonPath: '/peer', addonSha256: 'f'.repeat(64), platform: 'linux', architecture: 'x64',
		hashFile: async (path) => ({
			byteLength: path.endsWith('a.so') ? 10 : 20,
			sha256: path.endsWith('a.so') ? 'a'.repeat(64) : 'b'.repeat(64),
			identity: { dev: 1, ino: path.endsWith('a.so') ? 2 : 3 },
		}),
		loadAddon: async () => ({
			describe: async () => ({ pluginFormats: ['vamp'] }),
			listPluginCandidates: async () => ['/vamp/a.so', '/vamp/not-vamp.so'],
			scanExactLibrary: async (path, sampleRate, context) => {
				assert.equal(sampleRate, 48_000);
				assert.equal(context.sha256, path.endsWith('a.so') ? 'a'.repeat(64) : 'b'.repeat(64));
				if (path.endsWith('not-vamp.so')) throw Object.assign(new Error('not Vamp'), { code: 'library-malformed' });
				return [descriptor()];
			},
		}),
	});
	const progress = [];
	const handle = runner({
		grant: { rootPath: '/vamp', format: 'vamp', identity: { dev: 1, ino: 1 } },
		resourcePolicy: RESOURCE_POLICY,
		onProgress: (value) => progress.push(value),
	});
	assert.deepEqual(await handle.completion, {
		format: 'vamp', status: 'scanned', detail: 'Skipped 1 library that did not expose an admitted Vamp descriptor set.',
		libraries: [{
			kind: 'analyzer-library', format: 'vamp', libraryPath: '/vamp/a.so', libraryBytes: 10,
			librarySha256: 'a'.repeat(64), identity: { dev: 1, ino: 2 }, platform: 'linux',
			architecture: 'x64', compatibility: 'compatible', descriptors: [descriptor()],
		}],
	});
	assert.deepEqual(progress, [0.5, 1]);
});

test('every refused Vamp scan keeps the analyzer-library result vocabulary', async () => {
	for (const fixture of [
		{
			status: 'unsupported-format', detail: 'This authenticated payload does not implement vamp.',
			addon: { describe: async () => ({ pluginFormats: [] }) },
		},
		{
			status: 'root-unreadable', detail: 'unreadable fixture root',
			addon: {
				describe: async () => ({ pluginFormats: ['vamp'] }),
				listPluginCandidates: async () => { throw new Error('unreadable fixture root'); },
			},
		},
	]) {
		const runner = createNativePluginScanJobRunner({
			addonPath: '/peer', addonSha256: 'f'.repeat(64), platform: 'linux', architecture: 'x64',
			hashFile: async () => { throw new Error('must not hash'); },
			loadAddon: async () => fixture.addon,
		});
		const handle = runner({
			grant: { rootPath: '/vamp', format: 'vamp', identity: { dev: 1, ino: 1 } },
			resourcePolicy: RESOURCE_POLICY, onProgress: () => undefined,
		});
		assert.deepEqual(await handle.completion, {
			format: 'vamp', status: fixture.status, detail: fixture.detail, libraries: [],
		});
	}
});

function descriptor() {
	return {
		kind: 'analyzer', format: 'vamp', identifier: 'org.example.energy', name: 'Energy', description: '',
		maker: 'Example', copyright: '', pluginVersion: 1, vampApiVersion: 2, inputDomain: 'time',
		minimumChannels: 1, maximumChannels: 1, preferredStepSize: 512, preferredBlockSize: 1_024,
		parameters: [], programs: [], outputs: [{
			identifier: 'energy', name: 'Energy', description: '', unit: '', binCount: 1,
			binNames: [], extents: null, quantizeStep: null, sampleType: 'one-sample-per-step',
			sampleRate: null, hasDuration: false,
		}],
	};
}

const RESOURCE_POLICY = Object.freeze({
	maximumInputBytes: 1024, maximumJobDurationMs: 60_000, maximumRssBytes: 1024 ** 3,
	allowNetwork: false, allowChildProcesses: false, allowOutputFiles: false,
});
