/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createStorageCapacityService,
	type StorageCapacityCopy,
	type StorageCapacitySnapshot,
} from './storage-capacity-service.ts';

interface StorageCapacityStore {
	estimateStorage(): Promise<{ readonly usage: number | null; readonly quota: number | null }>;
	queryPersistentStorage?(): Promise<boolean | null>;
	requestPersistentStorage?(): Promise<boolean>;
	supportsPersistentStorage?(): boolean;
	cleanupTemporaryAssets?(): Promise<unknown>;
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
		estimateStorage: () => store.estimateStorage(),
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
		isInactive: options.isInactive,
		setSnapshot: (snapshot) => { options.state.storageEstimate = snapshot; },
		publish: options.publish,
		copy: options.copy,
	});
}
