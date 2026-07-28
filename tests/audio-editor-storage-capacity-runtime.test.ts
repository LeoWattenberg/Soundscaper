/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createControllerStorageCapacityService } from '../src/common/editor/controller/storage-capacity-runtime.ts';
import { createInitialStorageCapacitySnapshot } from '../src/common/editor/controller/storage-capacity-service.ts';

test('controller cleanup delegates only to stale temporary/orphan cleanup', async () => {
	const calls: string[] = [];
	const state = { storageEstimate: createInitialStorageCapacitySnapshot() };
	const service = createControllerStorageCapacityService({
		store: {
			estimateStorage: async () => ({ usage: 10, quota: 100 }),
			cleanupTemporaryAssets: async () => { calls.push('cleanup-temporary-assets'); },
			getStatus: () => ({ backend: 'indexeddb' }),
		},
		state,
		isInactive: () => false,
		publish: () => undefined,
		copy: copyFixture(),
	});

	await service.cleanupDisposableStorage();
	assert.deepEqual(calls, ['cleanup-temporary-assets']);
	assert.equal(state.storageEstimate.cleanupStatus, 'complete');
});

test('controller cleanup is a no-op on the memory fallback', async () => {
	let cleanupCalls = 0;
	const state = { storageEstimate: createInitialStorageCapacitySnapshot() };
	const service = createControllerStorageCapacityService({
		store: {
			estimateStorage: async () => ({ usage: null, quota: null }),
			cleanupTemporaryAssets: async () => { cleanupCalls += 1; },
			getStatus: () => ({ backend: 'memory' }),
		},
		state,
		isInactive: () => false,
		publish: () => undefined,
		copy: copyFixture(),
	});

	await service.refreshStorageUsage();
	await service.cleanupDisposableStorage();
	assert.equal(cleanupCalls, 0);
	assert.equal(state.storageEstimate.cleanupAvailable, false);
});

test('controller persistence stays unavailable when the project store uses memory', async () => {
	let persistCalls = 0;
	const state = { storageEstimate: createInitialStorageCapacitySnapshot() };
	const service = createControllerStorageCapacityService({
		store: {
			estimateStorage: async () => ({ usage: 10, quota: 100 }),
			queryPersistentStorage: async () => true,
			requestPersistentStorage: async () => { persistCalls += 1; return true; },
			supportsPersistentStorage: () => true,
			getStatus: () => ({ backend: 'memory' }),
		},
		state,
		isInactive: () => false,
		publish: () => undefined,
		copy: copyFixture(),
	});

	await service.refreshStorageUsage();
	await service.requestStoragePersistence();
	assert.equal(persistCalls, 0);
	assert.equal(state.storageEstimate.persistenceRequestAvailable, false);
	assert.equal(state.storageEstimate.evictionProtection, 'unavailable');
});

function copyFixture() {
	return {
		storageOperationRecording: 'Recording', storageOperationExport: 'Export',
		storageOperationEffect: 'Effect', storageOperationImport: 'Import',
		insufficientStorage: '{operation} needs {required}.',
		formatBytes: (bytes: number) => `${bytes} B`,
	};
}
