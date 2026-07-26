/* SPDX-License-Identifier: AGPL-3.0-only */

export type StorageOperation = 'recording' | 'export' | 'effect' | 'import';

export interface StorageEstimate {
	readonly usage: number | null;
	readonly quota: number | null;
}

interface StorageCapacityCopy {
	readonly storageOperationRecording: string;
	readonly storageOperationExport: string;
	readonly storageOperationEffect: string;
	readonly storageOperationImport: string;
	readonly insufficientStorage: string;
	formatBytes(bytes: number): string;
}

export interface StorageCapacityServiceDependencies {
	estimateStorage(): Promise<Readonly<StorageEstimate>>;
	isInactive(): boolean;
	setEstimate(estimate: Readonly<StorageEstimate>): void;
	publish(): void;
	readonly copy: StorageCapacityCopy;
}

export interface StorageCapacityService {
	refreshStorageUsage(): Promise<Readonly<StorageEstimate> | null>;
	preflightStorage(requiredBytes: unknown, operation: StorageOperation): Promise<void>;
}

export function createStorageCapacityService(
	dependencies: StorageCapacityServiceDependencies,
): Readonly<StorageCapacityService> {
	return Object.freeze({ refreshStorageUsage, preflightStorage });

	async function refreshStorageUsage(): Promise<Readonly<StorageEstimate> | null> {
		const estimate = await dependencies.estimateStorage();
		if (dependencies.isInactive()) return null;
		const normalized = Object.freeze({
			usage: finiteOrNull(estimate.usage),
			quota: finiteOrNull(estimate.quota),
		});
		dependencies.setEstimate(normalized);
		dependencies.publish();
		return normalized;
	}

	async function preflightStorage(requiredBytes: unknown, operation: StorageOperation): Promise<void> {
		const estimate = await dependencies.estimateStorage();
		if (!Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) return;
		const available = Math.max(0, Number(estimate.quota) - Number(estimate.usage));
		const required = Math.max(0, Number(requiredBytes) || 0);
		if (available >= required * 1.1) return;
		throw new Error(dependencies.copy.insufficientStorage
			.replace('{operation}', operationLabel(operation))
			.replace('{required}', dependencies.copy.formatBytes(required)));
	}

	function operationLabel(operation: StorageOperation): string {
		if (operation === 'recording') return dependencies.copy.storageOperationRecording;
		if (operation === 'export') return dependencies.copy.storageOperationExport;
		if (operation === 'effect') return dependencies.copy.storageOperationEffect;
		return dependencies.copy.storageOperationImport;
	}
}

function finiteOrNull(value: number | null): number | null {
	return Number.isFinite(value) ? Number(value) : null;
}
