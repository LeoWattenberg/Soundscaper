/* SPDX-License-Identifier: AGPL-3.0-only */

export type StorageOperation = 'recording' | 'export' | 'effect' | 'project' | 'import';
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

export interface StorageDerivativeCleanupReport {
	readonly before: Readonly<{ readonly bytes: number; readonly entries: number }>;
	readonly after: Readonly<{ readonly bytes: number; readonly entries: number }>;
	readonly removedBytes: number;
	readonly removedEntries: number;
	readonly skippedEntries: number;
	readonly satisfied: boolean;
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
	readonly derivativeCleanupStatus: StorageCleanupStatus;
	readonly derivativeCleanupAvailable: boolean;
	readonly lastDerivativeCleanupAt: number | null;
	readonly lastDerivativeCleanup: Readonly<StorageDerivativeCleanupReport> | null;
	readonly lastPreflight: Readonly<StoragePreflightSnapshot> | null;
}

export interface StorageCapacityCopy {
	readonly storageOperationRecording: string;
	readonly storageOperationExport: string;
	readonly storageOperationEffect: string;
	readonly storageOperationProject: string;
	readonly storageOperationImport: string;
	readonly insufficientStorage: string;
	formatBytes(bytes: number): string;
}

export interface StorageCapacityServiceDependencies {
	estimateStorage(operation?: StorageOperation): PromiseLike<unknown> | unknown;
	queryPersistentStorage?(): Promise<boolean | null>;
	requestPersistentStorage?(): Promise<boolean>;
	persistenceRequestAvailable?(): boolean;
	cleanupDisposableStorage?(): Promise<void>;
	disposableCleanupAvailable?(): boolean;
	cleanupDerivativeCache?(): Promise<Readonly<StorageDerivativeCleanupReport>>;
	derivativeCleanupAvailable?(): boolean;
	isInactive(): boolean;
	setSnapshot(snapshot: Readonly<StorageCapacitySnapshot>): void;
	publish(): void;
	now?(): number;
	readonly copy: StorageCapacityCopy;
}

export interface StorageCapacityService {
	refreshStorageUsage(): Promise<Readonly<StorageCapacitySnapshot> | null>;
	estimateStorageForPreflight(
		requiredBytes: unknown,
		operation: StorageOperation,
		signal?: AbortSignal,
	): Promise<Readonly<StorageEstimate>>;
	preflightStorage(requiredBytes: unknown, operation: StorageOperation): Promise<void>;
	requestStoragePersistence(): Promise<Readonly<StorageCapacitySnapshot> | null>;
	cleanupDisposableStorage(): Promise<Readonly<StorageCapacitySnapshot> | null>;
	cleanupDerivativeCache(): Promise<Readonly<StorageCapacitySnapshot> | null>;
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
		derivativeCleanupStatus: 'idle',
		derivativeCleanupAvailable: false,
		lastDerivativeCleanupAt: null,
		lastDerivativeCleanup: null,
		lastPreflight: null,
	});
}

export function createStorageCapacityService(
	dependencies: StorageCapacityServiceDependencies,
): Readonly<StorageCapacityService> {
	let snapshot = createInitialStorageCapacitySnapshot();
	let preflightGeneration = 0;
	let lastSettledPreflight: Readonly<StoragePreflightSnapshot> | null = null;
	return Object.freeze({
		refreshStorageUsage,
		estimateStorageForPreflight,
		preflightStorage,
		requestStoragePersistence,
		cleanupDisposableStorage,
		cleanupDerivativeCache,
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
			derivativeCleanupAvailable: canCleanupDerivativeCache(),
			updatedAt: now(),
		});
	}

	async function estimateStorageForPreflight(
		requiredBytes: unknown,
		operation: StorageOperation,
		signal?: AbortSignal,
	): Promise<Readonly<StorageEstimate>> {
		const requirement = storagePreflightRequirement(requiredBytes, operation);
		signal?.throwIfAborted();
		const generation = preflightGeneration + 1;
		preflightGeneration = generation;
		update({ lastPreflight: requirement });
		let estimate: unknown;
		try {
			estimate = await awaitStorageEstimate(() => dependencies.estimateStorage(operation), signal);
			signal?.throwIfAborted();
		} catch (error) {
			const aborted = signal?.aborted === true;
			if (!dependencies.isInactive() && generation === preflightGeneration) {
				if (aborted) {
					update({ lastPreflight: lastSettledPreflight });
				} else {
					updatePreflight(requirement, 'unknown', generation);
				}
			}
			if (aborted) throw signal.reason;
			throw error;
		}
		const capacity = capacityFromEstimate(estimate);
		const normalized = Object.freeze({ usage: capacity.usage, quota: capacity.quota });
		if (!dependencies.isInactive()) {
			const status = capacity.free === null
				? 'unknown'
				: capacity.free >= requirement.requiredFreeBytes ? 'ready' : 'insufficient';
			updateCapacityAfterPreflight(capacity, requirement, status, generation);
		}
		return normalized;
	}

	async function preflightStorage(
		requiredBytes: unknown,
		operation: StorageOperation,
	): Promise<void> {
		const requirement = storagePreflightRequirement(requiredBytes, operation);
		const estimate = await estimateStorageForPreflight(requirement.requiredBytes, operation);
		const capacity = capacityFromEstimate(estimate);
		if (dependencies.isInactive()
			|| capacity.free === null
			|| capacity.free >= requirement.requiredFreeBytes) return;
		throw new Error(dependencies.copy.insufficientStorage
			.replace('{operation}', operationLabel(operation))
			.replace('{required}', dependencies.copy.formatBytes(requirement.requiredBytes)));
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

	async function cleanupDerivativeCache(): Promise<Readonly<StorageCapacitySnapshot> | null> {
		if (!dependencies.cleanupDerivativeCache || !canCleanupDerivativeCache()) {
			return update({ derivativeCleanupAvailable: false });
		}
		update({ derivativeCleanupStatus: 'running' });
		try {
			const report = await dependencies.cleanupDerivativeCache();
			if (dependencies.isInactive()) return null;
			update({
				derivativeCleanupStatus: 'complete',
				lastDerivativeCleanupAt: now(),
				lastDerivativeCleanup: report,
			});
			return await refreshStorageUsage();
		} catch (error) {
			if (!dependencies.isInactive()) update({ derivativeCleanupStatus: 'failed' });
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
		generation: number,
	): Readonly<StorageCapacitySnapshot> {
		if (generation !== preflightGeneration) return snapshot;
		lastSettledPreflight = withStatus(requirement, status);
		return update({ lastPreflight: lastSettledPreflight });
	}

	function updateCapacityAfterPreflight(
		capacity: Pick<StorageCapacitySnapshot, 'usage' | 'quota' | 'free' | 'pressure'>,
		requirement: StoragePreflightSnapshot,
		status: StoragePreflightStatus,
		generation: number,
	): Readonly<StorageCapacitySnapshot> {
		if (generation !== preflightGeneration) return snapshot;
		lastSettledPreflight = withStatus(requirement, status);
		return update({
			...capacity,
			lastPreflight: lastSettledPreflight,
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

	function canCleanupDerivativeCache(): boolean {
		return dependencies.derivativeCleanupAvailable?.() ?? Boolean(dependencies.cleanupDerivativeCache);
	}

	function operationLabel(operation: StorageOperation): string {
		if (operation === 'recording') return dependencies.copy.storageOperationRecording;
		if (operation === 'export') return dependencies.copy.storageOperationExport;
		if (operation === 'effect') return dependencies.copy.storageOperationEffect;
		if (operation === 'project') return dependencies.copy.storageOperationProject;
		return dependencies.copy.storageOperationImport;
	}
}

function capacityFromEstimate(estimate: unknown): Pick<StorageCapacitySnapshot,
	'usage' | 'quota' | 'free' | 'pressure'> {
	const candidate = estimate && typeof estimate === 'object'
		? estimate as Readonly<{ usage?: unknown; quota?: unknown }>
		: {};
	const usage = finiteOrNull(candidate.usage);
	const quota = finiteOrNull(candidate.quota);
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

function finiteOrNull(value: unknown): number | null {
	return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : null;
}

function storagePreflightRequirement(
	requiredBytes: unknown,
	operation: StorageOperation,
): Readonly<StoragePreflightSnapshot> {
	const required = nonNegativeBytes(requiredBytes);
	const headroom = Math.ceil(required / 10);
	if (required > Number.MAX_SAFE_INTEGER - headroom) {
		throw new RangeError('Storage preflight bytes exceed the supported safe integer range.');
	}
	return Object.freeze({
		operation,
		requiredBytes: required,
		requiredFreeBytes: required + headroom,
		status: 'checking',
	});
}

function awaitStorageEstimate(
	estimate: () => PromiseLike<unknown> | unknown,
	signal?: AbortSignal,
): Promise<unknown> {
	if (!signal) {
		try {
			return Promise.resolve(estimate());
		} catch (error) {
			return Promise.reject(error);
		}
	}
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (complete: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			complete();
		};
		const onAbort = (): void => finish(() => reject(signal.reason));
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}
		let operation: PromiseLike<unknown> | unknown;
		try {
			operation = estimate();
		} catch (error) {
			finish(() => reject(error));
			return;
		}
		void Promise.resolve(operation).then(
			(value) => finish(() => resolve(value)),
			(error: unknown) => finish(() => reject(error)),
		);
	});
}

function nonNegativeBytes(value: unknown): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(number)) {
		throw new RangeError('Storage preflight bytes must be a non-negative safe integer.');
	}
	return number;
}
