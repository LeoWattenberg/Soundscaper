/* SPDX-License-Identifier: AGPL-3.0-only */

export type StorageOperation = 'recording' | 'export' | 'effect' | 'import';
export type StoragePressure = 'normal' | 'warning' | 'critical' | 'unknown';
export type StorageEvictionProtection = 'granted' | 'best-effort' | 'unavailable' | 'unknown';
export type StoragePreflightStatus = 'checking' | 'ready' | 'insufficient' | 'unknown';
export type StorageCleanupStatus = 'idle' | 'running' | 'complete' | 'failed';

export interface StorageEstimate {
	readonly usage: number | null;
	readonly quota: number | null;
}

export interface StoragePreflightSnapshot {
	readonly operation: StorageOperation;
	readonly requiredBytes: number;
	readonly requiredFreeBytes: number;
	readonly status: StoragePreflightStatus;
}

export interface StorageCapacitySnapshot extends StorageEstimate {
	readonly free: number | null;
	readonly pressure: StoragePressure;
	readonly evictionProtection: StorageEvictionProtection;
	readonly persistenceRequestAvailable: boolean;
	readonly updatedAt: number | null;
	readonly cleanupStatus: StorageCleanupStatus;
	readonly cleanupAvailable: boolean;
	readonly lastCleanupAt: number | null;
	readonly lastPreflight: Readonly<StoragePreflightSnapshot> | null;
}

export interface StorageCapacityCopy {
	readonly storageOperationRecording: string;
	readonly storageOperationExport: string;
	readonly storageOperationEffect: string;
	readonly storageOperationImport: string;
	readonly insufficientStorage: string;
	formatBytes(bytes: number): string;
}

export interface StorageCapacityServiceDependencies {
	estimateStorage(): Promise<Readonly<StorageEstimate>>;
	queryPersistentStorage?(): Promise<boolean | null>;
	requestPersistentStorage?(): Promise<boolean>;
	persistenceRequestAvailable?(): boolean;
	cleanupDisposableStorage?(): Promise<void>;
	disposableCleanupAvailable?(): boolean;
	isInactive(): boolean;
	setSnapshot(snapshot: Readonly<StorageCapacitySnapshot>): void;
	publish(): void;
	now?(): number;
	readonly copy: StorageCapacityCopy;
}

export interface StorageCapacityService {
	refreshStorageUsage(): Promise<Readonly<StorageCapacitySnapshot> | null>;
	preflightStorage(requiredBytes: unknown, operation: StorageOperation): Promise<void>;
	requestStoragePersistence(): Promise<Readonly<StorageCapacitySnapshot> | null>;
	cleanupDisposableStorage(): Promise<Readonly<StorageCapacitySnapshot> | null>;
}

export function createInitialStorageCapacitySnapshot(): Readonly<StorageCapacitySnapshot> {
	return Object.freeze({
		usage: null,
		quota: null,
		free: null,
		pressure: 'unknown',
		evictionProtection: 'unknown',
		persistenceRequestAvailable: false,
		updatedAt: null,
		cleanupStatus: 'idle',
		cleanupAvailable: false,
		lastCleanupAt: null,
		lastPreflight: null,
	});
}

export function createStorageCapacityService(
	dependencies: StorageCapacityServiceDependencies,
): Readonly<StorageCapacityService> {
	let snapshot = createInitialStorageCapacitySnapshot();
	let preflightGeneration = 0;
	return Object.freeze({
		refreshStorageUsage,
		preflightStorage,
		requestStoragePersistence,
		cleanupDisposableStorage,
	});

	async function refreshStorageUsage(): Promise<Readonly<StorageCapacitySnapshot> | null> {
		const [estimate, persisted] = await Promise.all([
			dependencies.estimateStorage(),
			dependencies.queryPersistentStorage?.() ?? Promise.resolve(null),
		]);
		if (dependencies.isInactive()) return null;
		const persistenceAvailable = canRequestPersistence();
		return update({
			...capacityFromEstimate(estimate),
			evictionProtection: persistenceStatus(persisted, persistenceAvailable),
			persistenceRequestAvailable: persistenceAvailable,
			cleanupAvailable: canCleanupDisposableStorage(),
			updatedAt: now(),
		});
	}

	async function preflightStorage(requiredBytes: unknown, operation: StorageOperation): Promise<void> {
		const required = nonNegativeBytes(requiredBytes);
		const headroom = Math.ceil(required / 10);
		if (required > Number.MAX_SAFE_INTEGER - headroom) {
			throw new RangeError('Storage preflight bytes exceed the supported safe integer range.');
		}
		const requirement = Object.freeze({
			operation,
			requiredBytes: required,
			requiredFreeBytes: required + headroom,
			status: 'checking' as const,
		});
		const generation = preflightGeneration + 1;
		preflightGeneration = generation;
		update({ lastPreflight: requirement });
		let estimate: Readonly<StorageEstimate>;
		try {
			estimate = await dependencies.estimateStorage();
		} catch (error) {
			if (!dependencies.isInactive() && generation === preflightGeneration) {
				updatePreflight(requirement, 'unknown');
			}
			throw error;
		}
		if (dependencies.isInactive()) return;
		const capacity = capacityFromEstimate(estimate);
		if (capacity.free === null) {
			updateCapacityAfterPreflight(capacity, requirement, 'unknown', generation);
			return;
		}
		if (capacity.free >= requirement.requiredFreeBytes) {
			updateCapacityAfterPreflight(capacity, requirement, 'ready', generation);
			return;
		}
		updateCapacityAfterPreflight(capacity, requirement, 'insufficient', generation);
		throw new Error(dependencies.copy.insufficientStorage
			.replace('{operation}', operationLabel(operation))
			.replace('{required}', dependencies.copy.formatBytes(required)));
	}

	async function requestStoragePersistence(): Promise<Readonly<StorageCapacitySnapshot> | null> {
		if (!dependencies.requestPersistentStorage || !canRequestPersistence()) {
			return update({ evictionProtection: 'unavailable', persistenceRequestAvailable: false });
		}
		const granted = await dependencies.requestPersistentStorage();
		if (dependencies.isInactive()) return null;
		return update({
			evictionProtection: granted ? 'granted' : 'best-effort',
			persistenceRequestAvailable: true,
			updatedAt: now(),
		});
	}

	async function cleanupDisposableStorage(): Promise<Readonly<StorageCapacitySnapshot> | null> {
		if (!dependencies.cleanupDisposableStorage || !canCleanupDisposableStorage()) {
			return update({ cleanupAvailable: false });
		}
		update({ cleanupStatus: 'running' });
		try {
			await dependencies.cleanupDisposableStorage();
			if (dependencies.isInactive()) return null;
			update({ cleanupStatus: 'complete', lastCleanupAt: now() });
			return await refreshStorageUsage();
		} catch (error) {
			if (!dependencies.isInactive()) update({ cleanupStatus: 'failed' });
			throw error;
		}
	}

	function update(changes: Partial<StorageCapacitySnapshot>): Readonly<StorageCapacitySnapshot> {
		snapshot = Object.freeze({ ...snapshot, ...changes });
		dependencies.setSnapshot(snapshot);
		dependencies.publish();
		return snapshot;
	}

	function updatePreflight(
		requirement: StoragePreflightSnapshot,
		status: StoragePreflightStatus,
	): Readonly<StorageCapacitySnapshot> {
		return update({ lastPreflight: withStatus(requirement, status) });
	}

	function updateCapacityAfterPreflight(
		capacity: Pick<StorageCapacitySnapshot, 'usage' | 'quota' | 'free' | 'pressure'>,
		requirement: StoragePreflightSnapshot,
		status: StoragePreflightStatus,
		generation: number,
	): Readonly<StorageCapacitySnapshot> {
		if (generation !== preflightGeneration) return snapshot;
		return update({
			...capacity,
			lastPreflight: withStatus(requirement, status),
			updatedAt: now(),
		});
	}

	function now(): number {
		return Math.max(0, Math.floor(dependencies.now?.() ?? Date.now()));
	}

	function canRequestPersistence(): boolean {
		return dependencies.persistenceRequestAvailable?.() ?? Boolean(dependencies.requestPersistentStorage);
	}

	function canCleanupDisposableStorage(): boolean {
		return dependencies.disposableCleanupAvailable?.() ?? Boolean(dependencies.cleanupDisposableStorage);
	}

	function operationLabel(operation: StorageOperation): string {
		if (operation === 'recording') return dependencies.copy.storageOperationRecording;
		if (operation === 'export') return dependencies.copy.storageOperationExport;
		if (operation === 'effect') return dependencies.copy.storageOperationEffect;
		return dependencies.copy.storageOperationImport;
	}
}

function capacityFromEstimate(estimate: Readonly<StorageEstimate>): Pick<StorageCapacitySnapshot,
	'usage' | 'quota' | 'free' | 'pressure'> {
	const usage = finiteOrNull(estimate.usage);
	const quota = finiteOrNull(estimate.quota);
	const free = usage === null || quota === null ? null : Math.max(0, quota - usage);
	return { usage, quota, free, pressure: storagePressure(usage, quota) };
}

function storagePressure(usage: number | null, quota: number | null): StoragePressure {
	if (usage === null || quota === null || quota <= 0) return 'unknown';
	const ratio = usage / quota;
	if (ratio >= 0.9) return 'critical';
	if (ratio >= 0.75) return 'warning';
	return 'normal';
}

function persistenceStatus(
	persisted: boolean | null,
	requestAvailable: boolean,
): StorageEvictionProtection {
	if (persisted === true) return 'granted';
	if (persisted === false) return 'best-effort';
	return requestAvailable ? 'unknown' : 'unavailable';
}

function withStatus(
	requirement: StoragePreflightSnapshot,
	status: StoragePreflightStatus,
): Readonly<StoragePreflightSnapshot> {
	return Object.freeze({ ...requirement, status });
}

function finiteOrNull(value: number | null): number | null {
	return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : null;
}

function nonNegativeBytes(value: unknown): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(number)) {
		throw new RangeError('Storage preflight bytes must be a non-negative safe integer.');
	}
	return number;
}
