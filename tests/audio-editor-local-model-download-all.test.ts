/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	LocalModelManagerBridge,
	LocalModelManagerModel,
} from '../src/common/editor/ui/local-model-manager-bridge.ts';
import { createLocalModelManagerStore } from '../src/common/editor/ui/local-model-manager-store.ts';

const MODELS = ['speech-model', 'vad-model'].map((modelId) => Object.freeze({
	modelId, version: '1.0.0', task: 'speech-recognition', availability: 'installable' as const,
	downloadBytes: 100, installedBytes: null, attributionRequired: false,
} satisfies LocalModelManagerModel));

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((complete, fail) => { resolve = complete; reject = fail; });
	return { promise, resolve, reject };
}

function fixture() {
	const requests: string[] = [];
	const cancellations: string[] = [];
	const installs = new Map(MODELS.map((model) => [model.modelId, deferred<unknown>()]));
	const started = new Map(MODELS.map((model) => [model.modelId, deferred<void>()]));
	const cancellationAcknowledged = deferred<void>();
	let models: readonly LocalModelManagerModel[] = MODELS;
	let progressListener: ((value: unknown) => void) | null = null;
	const bridge: LocalModelManagerBridge = {
		listAssistanceModels: async () => ({ runtimeAvailable: true, runtimeReason: null, models }),
		installAssistanceModel: async (modelId) => {
			requests.push(modelId);
			started.get(modelId)!.resolve();
			const result = await installs.get(modelId)!.promise;
			models = models.map((model) => model.modelId === modelId
				? { ...model, availability: 'installed', installedBytes: model.downloadBytes } : model);
			return result;
		},
		cancelAssistanceModelInstall: async (modelId) => {
			cancellations.push(modelId);
			installs.get(modelId)!.reject(new Error('The download was cancelled.'));
			await cancellationAcknowledged.promise;
			return { contractVersion: 1, modelId, outcome: 'cancelled' };
		},
		installPreseededAssistanceModel: async () => null,
		reconcileAssistanceModels: async () => ({ installedModelIds: [], incompleteModelIds: [], rejected: [] }),
		collectAssistanceModelGarbage: async () => ({ reclaimedBlobBytes: 0, discardedManifestCount: 0,
			discardedPartialCount: 0, discardedPartialBytes: 0, reclaimedBytes: 0 }),
		listAssistanceModelNotices: async () => [],
		relocateAssistanceModels: async () => null,
		removeAssistanceModel: async () => 0,
		onAssistanceInstallProgress: (listener) => {
			progressListener = listener;
			return () => { progressListener = null; };
		},
	};
	return {
		store: createLocalModelManagerStore(bridge), requests, cancellations,
		started, installs, cancellationAcknowledged,
		progress: (modelId: string) => progressListener?.({
			modelId, fileName: 'model.onnx', completedBytes: 50, totalBytes: 100,
		}),
		complete(modelId: string) {
			const model = MODELS.find((candidate) => candidate.modelId === modelId)!;
			installs.get(modelId)!.resolve({ ...model, availability: 'installed', installedBytes: 100 });
		},
	};
}

test('download all installs models sequentially and reuses per-model progress', async () => {
	const current = fixture();
	const disconnect = current.store.connect();
	await current.store.load();
	const operation = current.store.installAll(['speech-model', 'vad-model', 'speech-model']);
	await current.started.get('speech-model')!.promise;
	assert.deepEqual(current.requests, ['speech-model']);
	current.progress('speech-model');
	assert.deepEqual(current.store.getSnapshot().progress, [{
		modelId: 'speech-model', fileName: 'model.onnx', completedBytes: 50, totalBytes: 100,
	}]);
	current.complete('speech-model');
	await current.started.get('vad-model')!.promise;
	assert.deepEqual(current.requests, ['speech-model', 'vad-model']);
	assert.deepEqual(current.store.getSnapshot().installingModelIds, ['vad-model']);
	current.complete('vad-model');
	await operation;
	assert.deepEqual(current.requests, ['speech-model', 'vad-model']);
	assert.ok(current.store.getSnapshot().models.every((model) => model.availability === 'installed'));
	assert.deepEqual(current.store.getSnapshot().busyModelIds, []);
	disconnect();
	disconnect();
});

test('download all stops after an install failure and preserves the error', async () => {
	const current = fixture();
	await current.store.load();
	const operation = current.store.installAll(['speech-model', 'vad-model']);
	await current.started.get('speech-model')!.promise;
	current.installs.get('speech-model')!.reject(new Error('Model authentication failed.'));
	await operation;
	assert.deepEqual(current.requests, ['speech-model']);
	assert.deepEqual(current.store.getSnapshot().error, {
		modelId: 'speech-model', message: 'Model authentication failed.',
	});
});

test('an already aborted download-all request starts no transfers', async () => {
	const current = fixture();
	await current.store.load();
	const controller = new AbortController();
	controller.abort();
	await current.store.installAll(['speech-model', 'vad-model'], controller.signal);
	assert.deepEqual(current.requests, []);
	assert.deepEqual(current.cancellations, []);
});

test('aborting download all cancels the active transfer, awaits acknowledgement and stops the queue', async (t) => {
	const current = fixture();
	await current.store.load();
	const controller = new AbortController();
	let removedListeners = 0;
	const removeListener = controller.signal.removeEventListener.bind(controller.signal);
	t.mock.method(controller.signal, 'removeEventListener', (
		type: string, listener: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions,
	) => {
		if (type === 'abort') removedListeners += 1;
		if (listener !== null) removeListener(type, listener, options);
	});
	let completed = false;
	const operation = current.store.installAll(['speech-model', 'vad-model'], controller.signal)
		.then(() => { completed = true; });
	await current.started.get('speech-model')!.promise;
	controller.abort();
	controller.abort();
	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(current.cancellations, ['speech-model']);
	assert.equal(completed, false);
	assert.deepEqual(current.store.getSnapshot().cancellingModelIds, ['speech-model']);
	current.cancellationAcknowledged.resolve();
	await operation;
	assert.equal(completed, true);
	assert.deepEqual(current.requests, ['speech-model']);
	assert.deepEqual(current.store.getSnapshot().busyModelIds, []);
	assert.equal(current.store.getSnapshot().error, null);
	assert.equal(removedListeners, 1);
});
