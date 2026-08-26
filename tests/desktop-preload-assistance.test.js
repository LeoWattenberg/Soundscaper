/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const STATUS = Object.freeze({
	runtimeAvailable: true,
	runtimeReason: null,
	models: [{
		modelId: 'parakeet-tdt-0.6b-v2',
		version: '2.0.0',
		task: 'speech-recognition',
		availability: 'installable',
		downloadBytes: 661_190_513,
		installedBytes: null,
		attributionRequired: true,
	}],
});

test('the assistance bridge sanitizes status in both directions', async () => {
	const fixture = await loadPreload([{
		...STATUS, modelsDirectory: '/private/models', secretPath: '/private/secret',
		models: [{ ...STATUS.models[0], artifactPath: '/private/models/model.onnx' }],
	}]);

	const status = await fixture.bridge.listAssistanceModels();

	assert.deepEqual(fixture.invocations, [['soundscaper:v1:assistance:list', undefined]]);
	assert.equal('secretPath' in status, false, 'unknown fields never reach the renderer');
	assert.equal('modelsDirectory' in status, false, 'the configured store remains main-process-only');
	assert.equal(Object.isFrozen(status), true);
	assert.equal(Object.isFrozen(status.models[0]), true);
	assert.deepEqual({ ...status.models[0] }, { ...STATUS.models[0] });
});

test('an install request carries only a validated model id', async () => {
	const fixture = await loadPreload([STATUS.models[0]]);

	const model = await fixture.bridge.installAssistanceModel('parakeet-tdt-0.6b-v2');

	assert.deepEqual(fixture.invocations, [[
		'soundscaper:v1:assistance:install', 'parakeet-tdt-0.6b-v2',
	]]);
	assert.equal(model.availability, 'installable');
});

test('a model id the store could not place safely is refused before it is sent', async () => {
	const fixture = await loadPreload([]);

	for (const modelId of ['../escape', 'Model-A', '', 'model/../..']) {
		assert.throws(
			() => fixture.bridge.installAssistanceModel(modelId),
			/Unsupported assistance model id/u,
			modelId,
		);
	}
	assert.deepEqual(fixture.invocations, [], 'nothing reached the main process');
});

test('a malformed status from main is refused rather than passed through', async () => {
	const missingModels = await loadPreload([{ runtimeAvailable: true }]);
	await assert.rejects(missingModels.bridge.listAssistanceModels(), /Malformed assistance status/u);

	const badAvailability = await loadPreload([{ ...STATUS, models: [{ ...STATUS.models[0], availability: 'ready' }] }]);
	await assert.rejects(badAvailability.bridge.listAssistanceModels(), /Unsupported assistance availability/u);

	const badId = await loadPreload([{ ...STATUS, models: [{ ...STATUS.models[0], modelId: '../escape' }] }]);
	await assert.rejects(badId.bridge.listAssistanceModels(), /Unsupported assistance model id/u);
});

test('removal returns the reclaimed byte count', async () => {
	const fixture = await loadPreload([661_190_513]);

	assert.equal(await fixture.bridge.removeAssistanceModel('parakeet-tdt-0.6b-v2'), 661_190_513);
	assert.deepEqual(fixture.invocations, [[
		'soundscaper:v1:assistance:remove', 'parakeet-tdt-0.6b-v2',
	]]);
});

test('install progress is sanitized before it reaches a listener', async () => {
	const fixture = await loadPreload([]);
	const seen = [];

	const unsubscribe = fixture.bridge.onAssistanceInstallProgress((progress) => seen.push(progress));
	fixture.emit('soundscaper:v1:event:assistance-progress', {
		modelId: 'parakeet-tdt-0.6b-v2',
		fileName: 'encoder.int8.onnx',
		completedBytes: 1_000,
		totalBytes: 652_184_296,
		path: '/private/models/encoder.int8.onnx',
	});

	assert.equal(seen.length, 1);
	assert.equal('path' in seen[0], false, 'a filesystem path never crosses the bridge');
	assert.deepEqual({ ...seen[0] }, {
		modelId: 'parakeet-tdt-0.6b-v2',
		fileName: 'encoder.int8.onnx',
		completedBytes: 1_000,
		totalBytes: 652_184_296,
	});
	assert.equal(typeof unsubscribe, 'function');
});

test('model lifecycle operations are pathless and sanitize every result', async () => {
	const fixture = await loadPreload([
		{ contractVersion: 1, modelId: 'parakeet-tdt-0.6b-v2', outcome: 'cancelled', path: '/private' },
		STATUS.models[0],
		{ installedModelIds: ['parakeet-tdt-0.6b-v2'], incompleteModelIds: [], rejected: [] },
		{ reclaimedBlobBytes: 1, discardedManifestCount: 2, discardedPartialCount: 3,
			discardedPartialBytes: 4, reclaimedBytes: 5, deletedPath: '/private' },
		[{ schemaVersion: 1, modelId: 'parakeet-tdt-0.6b-v2', version: '2.0.0',
			purpose: 'Speech recognition', codeLicense: 'MIT', weightsLicense: 'CC-BY-4.0',
			attributionRequired: true, provenanceSources: ['https://upstream.invalid/repo'],
			upstreamRevision: 'abc123', distributionKind: 'identity-mirrored',
			noticeDocument: '/private/THIRD_PARTY_LICENSES.md' }],
		{ contractVersion: 1, totalBytes: 6, fileCount: 7, sourceRemoved: false,
			modelsDirectory: '/private/new-models' },
	]);

	const cancellation = await fixture.bridge.cancelAssistanceModelInstall('parakeet-tdt-0.6b-v2');
	const seeded = await fixture.bridge.installPreseededAssistanceModel('parakeet-tdt-0.6b-v2');
	const reconciliation = await fixture.bridge.reconcileAssistanceModels();
	const garbage = await fixture.bridge.collectAssistanceModelGarbage();
	const notices = await fixture.bridge.listAssistanceModelNotices();
	const relocation = await fixture.bridge.relocateAssistanceModels();

	assert.equal('path' in cancellation, false);
	assert.equal(seeded.modelId, 'parakeet-tdt-0.6b-v2');
	assert.deepEqual(reconciliation.installedModelIds, ['parakeet-tdt-0.6b-v2']);
	assert.equal('deletedPath' in garbage, false);
	assert.equal('noticeDocument' in notices[0], false);
	assert.equal('modelsDirectory' in relocation, false);
	assert.deepEqual(fixture.invocations, [
		['soundscaper:v1:assistance:install:cancel', 'parakeet-tdt-0.6b-v2'],
		['soundscaper:v1:assistance:install-preseeded', 'parakeet-tdt-0.6b-v2'],
		['soundscaper:v1:assistance:reconcile', undefined],
		['soundscaper:v1:assistance:garbage-collect', undefined],
		['soundscaper:v1:assistance:notices', undefined],
		['soundscaper:v1:assistance:relocate', undefined],
	]);
});

test('native picker cancellation is a typed null and never exposes a selected path', async () => {
	const fixture = await loadPreload([null, null]);

	assert.equal(await fixture.bridge.installPreseededAssistanceModel('parakeet-tdt-0.6b-v2'), null);
	assert.equal(await fixture.bridge.relocateAssistanceModels(), null);
});

async function loadPreload(invocationResults) {
	let bridge;
	const invocations = [];
	const listeners = new Map();
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AggregateError, ArrayBuffer, Array, Number, Object, Promise, RangeError, String, TypeError,
		Uint8Array, URL,
		require: () => ({
			contextBridge: { exposeInMainWorld(name, value) { if (name === 'scapeDesktop') bridge = value.v1; } },
			ipcRenderer: {
				invoke(channel, value) {
					invocations.push([channel, value]);
					const result = invocationResults.shift();
					return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
				},
				send: () => {},
				on: (channel, handler) => listeners.set(channel, handler),
				removeListener: (channel) => listeners.delete(channel),
			},
		}),
	});
	return {
		bridge,
		invocations,
		emit: (channel, value) => listeners.get(channel)?.(null, value),
	};
}
