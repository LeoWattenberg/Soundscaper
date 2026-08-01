/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createStorageCapacityService,
	type StorageCapacityCopy,
	type StorageCapacitySnapshot,
	type StorageDerivativeCleanupReport,
} from './storage-capacity-service.ts';

interface StorageCapacityStore {
	estimateStorage(): Promise<{ readonly usage: number | null; readonly quota: number | null }>;
	queryPersistentStorage?(): Promise<boolean | null>;
	requestPersistentStorage?(): Promise<boolean>;
	supportsPersistentStorage?(): boolean;
	cleanupTemporaryAssets?(): Promise<unknown>;
	trimVideoDerivativeCache?(limits: Readonly<{
		readonly maximumBytes: number;
		readonly maximumEntries: number;
	}>): Promise<Readonly<StorageDerivativeCleanupReport>>;
	getStatus?(): Readonly<{ backend?: string }>;
}

interface StorageCapacityState {
	storageEstimate: Readonly<StorageCapacitySnapshot>;
}

interface StorageCapacityRuntimeOptions {
	readonly store: StorageCapacityStore;
	readonly state: StorageCapacityState;
	readonly copy: StorageCapacityCopy;
	readonly isInactive: () => boolean;
	readonly publish: () => void;
}

/** Adapt the controller composition root to the strict storage-capacity owner. */
export function createControllerStorageCapacityService(options: StorageCapacityRuntimeOptions) {
	const { store } = options;
	return createStorageCapacityService({
		estimateStorage: (operation) => operation === 'project'
			&& store.getStatus?.().backend !== 'indexeddb'
			? { usage: null, quota: null }
			: store.estimateStorage(),
		queryPersistentStorage: async () => store.getStatus?.().backend === 'indexeddb'
			? store.queryPersistentStorage?.() ?? null
			: null,
		requestPersistentStorage: async () => store.getStatus?.().backend === 'indexeddb'
			? store.requestPersistentStorage?.() ?? false
			: false,
		persistenceRequestAvailable: () => (
			store.getStatus?.().backend === 'indexeddb'
			&& store.supportsPersistentStorage?.() === true
		),
		cleanupDisposableStorage: async () => { await store.cleanupTemporaryAssets?.(); },
		disposableCleanupAvailable: () => (
			typeof store.cleanupTemporaryAssets === 'function'
			&& store.getStatus?.().backend === 'indexeddb'
		),
		cleanupDerivativeCache: () => store.trimVideoDerivativeCache?.({
			maximumBytes: 0,
			maximumEntries: 0,
		}) ?? Promise.resolve(emptyDerivativeCleanupReport()),
		derivativeCleanupAvailable: () => typeof store.trimVideoDerivativeCache === 'function',
		isInactive: options.isInactive,
		setSnapshot: (snapshot) => { options.state.storageEstimate = snapshot; },
		publish: options.publish,
		copy: options.copy,
	});
}

function emptyDerivativeCleanupReport(): Readonly<StorageDerivativeCleanupReport> {
	return Object.freeze({
		before: Object.freeze({ bytes: 0, entries: 0 }),
		after: Object.freeze({ bytes: 0, entries: 0 }),
		removedBytes: 0,
		removedEntries: 0,
		skippedEntries: 0,
		satisfied: true,
	});
}
