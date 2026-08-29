/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { LocalModelManagerBridge } from '../src/common/editor/ui/local-model-manager-bridge.ts';
import { createLocalModelManagerStore } from '../src/common/editor/ui/local-model-manager-store.ts';

const SPEECH_MODEL = Object.freeze({
	modelId: 'parakeet-tdt-0.6b-v2', version: '2.0.0', task: 'speech-recognition' as const,
	availability: 'installable' as const, downloadBytes: 661_190_513,
	installedBytes: null, attributionRequired: false,
});
const VAD_MODEL = Object.freeze({
	modelId: 'silero-vad-v5', version: '5.1.2', task: 'voice-activity-detection' as const,
	availability: 'installable' as const, downloadBytes: 2_327_752,
	installedBytes: null, attributionRequired: false,
});
const INSTALLED_VAD_MODEL = Object.freeze({
	...VAD_MODEL, availability: 'installed' as const, installedBytes: VAD_MODEL.downloadBytes,
});

test('a concurrent install success cannot erase another model failure', async () => {
	const speechInstall = deferred<unknown>();
	const vadInstall = deferred<unknown>();
	let listCount = 0;
	const bridge = {
		listAssistanceModels: async () => {
			listCount += 1;
			return managerStatus(listCount === 1
				? [SPEECH_MODEL, VAD_MODEL]
				: [SPEECH_MODEL, INSTALLED_VAD_MODEL]);
		},
		installAssistanceModel: (modelId: string) => modelId === SPEECH_MODEL.modelId
			? speechInstall.promise
			: vadInstall.promise,
	} as unknown as LocalModelManagerBridge;
	const store = createLocalModelManagerStore(bridge);
	await store.load();

	const speechOperation = store.install(SPEECH_MODEL.modelId);
	const vadOperation = store.install(VAD_MODEL.modelId);
	speechInstall.reject(new Error('The speech model download failed authentication.'));
	await speechOperation;
	assert.deepEqual(store.getSnapshot().error, {
		modelId: SPEECH_MODEL.modelId,
		message: 'The speech model download failed authentication.',
	});

	vadInstall.resolve(INSTALLED_VAD_MODEL);
	await vadOperation;

	assert.deepEqual(store.getSnapshot().models, [SPEECH_MODEL, INSTALLED_VAD_MODEL]);
	assert.deepEqual(store.getSnapshot().error, {
		modelId: SPEECH_MODEL.modelId,
		message: 'The speech model download failed authentication.',
	});
});

function managerStatus(models: readonly unknown[]) {
	return Object.freeze({ runtimeAvailable: true, runtimeReason: null, models: Object.freeze(models) });
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return Object.freeze({ promise, resolve, reject });
}
