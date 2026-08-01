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

test('controller capacity runtime exposes project preflights', async () => {
	const state = { storageEstimate: createInitialStorageCapacitySnapshot() };
	const service = createControllerStorageCapacityService({
		store: {
			estimateStorage: async () => ({ usage: 900, quota: 1_000 }),
			getStatus: () => ({ backend: 'indexeddb' }),
		},
		state,
		isInactive: () => false,
		publish: () => undefined,
		copy: copyFixture(),
	});

	await assert.rejects(service.preflightStorage(100, 'project'), /Project saving needs 100 B/u);
	assert.equal(state.storageEstimate.lastPreflight?.operation, 'project');
});

test('controller project preflight treats memory fallback capacity as unknown', async () => {
	let estimateCalls = 0;
	const state = { storageEstimate: createInitialStorageCapacitySnapshot() };
	const service = createControllerStorageCapacityService({
		store: {
			estimateStorage: async () => {
				estimateCalls += 1;
				return { usage: 900, quota: 1_000 };
			},
			getStatus: () => ({ backend: 'memory' }),
		},
		state,
		isInactive: () => false,
		publish: () => undefined,
		copy: copyFixture(),
	});

	await assert.doesNotReject(service.preflightStorage(100, 'project'));
	assert.equal(estimateCalls, 0);
	assert.equal(state.storageEstimate.lastPreflight?.status, 'unknown');
	await assert.rejects(service.preflightStorage(100, 'recording'), /Recording needs 100 B/u);
	assert.equal(estimateCalls, 1);
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

test('controller derivative cleanup clears only the reproducible cache and is honest on memory fallback', async () => {
	const calls: unknown[] = [];
	const state = { storageEstimate: createInitialStorageCapacitySnapshot() };
	const service = createControllerStorageCapacityService({
		store: {
			estimateStorage: async () => ({ usage: null, quota: null }),
			trimVideoDerivativeCache: async (limits) => {
				calls.push(limits);
				return {
					before: { bytes: 8, entries: 1 }, after: { bytes: 0, entries: 0 },
					removedBytes: 8, removedEntries: 1, skippedEntries: 0, satisfied: true,
				};
			},
			getStatus: () => ({ backend: 'memory' }),
		},
		state,
		isInactive: () => false,
		publish: () => undefined,
		copy: copyFixture(),
	});

	await service.refreshStorageUsage();
	await service.cleanupDerivativeCache();

	assert.deepEqual(calls, [{ maximumBytes: 0, maximumEntries: 0 }]);
	assert.equal(state.storageEstimate.derivativeCleanupAvailable, true);
	assert.equal(state.storageEstimate.derivativeCleanupStatus, 'complete');
	assert.equal(state.storageEstimate.lastDerivativeCleanup?.removedEntries, 1);
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
		storageOperationEffect: 'Effect', storageOperationProject: 'Project saving',
		storageOperationImport: 'Import',
		insufficientStorage: '{operation} needs {required}.',
		formatBytes: (bytes: number) => `${bytes} B`,
	};
}
