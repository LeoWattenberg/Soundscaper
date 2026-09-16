/* SPDX-License-Identifier: AGPL-3.0-only */

import { STORAGE_CAPACITY_COPY_BY_LOCALE } from '../../i18n/editor-storage-capacity-copy.ts';
import { resolveEditorCopyScope } from '../../i18n/editor-copy-scope.ts';

import type {
	StorageCapacitySnapshot,
	StorageCleanupStatus,
	StorageEvictionProtection,
	StoragePreflightSnapshot,
	StoragePressure,
} from '../controller/shared/storage-capacity-service.ts';
import type { EditorStoreBackend, EditorStoreState } from '../storage/status.ts';

interface StorageUiSnapshot extends StorageCapacitySnapshot {
	readonly state: EditorStoreState;
	readonly backend: EditorStoreBackend;
	readonly persistent: boolean;
	readonly ephemeral: boolean;
	readonly degradedReason: string | null;
}

interface StorageCapacityUiCopy {
	readonly storage: string;
	readonly free: string;
	readonly usedOf: string;
	readonly estimateUnavailable: string;
	readonly indexedDb: string;
	readonly memoryFallback: string;
	readonly protected: string;
	readonly bestEffort: string;
	readonly protectionUnavailable: string;
	readonly protectionUnknown: string;
	readonly noPreflight: string;
	readonly requested: string;
	readonly requiredFree: string;
	readonly pressure: Readonly<Record<StoragePressure, string>>;
	readonly preflightStatus: Readonly<Record<StoragePreflightSnapshot['status'], string>>;
	readonly operation: Readonly<Record<StoragePreflightSnapshot['operation'], string>>;
	readonly capacityLabel: string;
	readonly backendLabel: string;
	readonly evictionLabel: string;
	readonly preflightLabel: string;
	readonly refresh: string;
	readonly requestPersistence: string;
	readonly cleanup: string;
	readonly cleanupRunning: string;
	readonly derivativeCleanup: string;
	readonly derivativeCleanupRunning: string;
}

export interface StorageCapacityViewModel {
	readonly summary: string;
	readonly capacity: string;
	readonly backend: string;
	readonly evictionProtection: string;
	readonly preflight: string;
	readonly capacityLabel: string;
	readonly backendLabel: string;
	readonly evictionLabel: string;
	readonly preflightLabel: string;
	readonly refreshLabel: string;
	readonly requestPersistenceLabel: string;
	readonly cleanupLabel: string;
	readonly derivativeCleanupLabel: string;
	readonly pressure: StoragePressure;
	readonly cleanupStatus: StorageCleanupStatus;
	readonly requestPersistenceDisabled: boolean;
	readonly cleanupDisabled: boolean;
	readonly derivativeCleanupDisabled: boolean;
}


export function createStorageCapacityViewModel(
	storage: Readonly<StorageUiSnapshot>,
	locale = 'en',
	overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<StorageCapacityViewModel> {
	const language = locale.toLowerCase().startsWith('de') ? 'de' : 'en';
	const { pressure, preflightStatus, operation, ...labels } = STORAGE_CAPACITY_COPY_BY_LOCALE[language];
	const copy = Object.freeze({
		...resolveEditorCopyScope('storageCapacity', labels, overrides),
		pressure: resolveEditorCopyScope('storageCapacity.pressure', pressure, overrides),
		preflightStatus: resolveEditorCopyScope('storageCapacity.preflightStatus', preflightStatus, overrides),
		operation: resolveEditorCopyScope('storageCapacity.operation', operation, overrides),
	});
	const free = formatBytes(storage.free, language);
	return Object.freeze({
		summary: `${copy.storage}: ${free ?? '—'} ${copy.free} · ${copy.pressure[storage.pressure]}`,
		capacity: capacityLabel(storage, language, copy),
		backend: backendLabel(storage, copy),
		evictionProtection: evictionLabel(storage.evictionProtection, copy),
		preflight: preflightLabel(storage.lastPreflight, language, copy),
		capacityLabel: copy.capacityLabel,
		backendLabel: copy.backendLabel,
		evictionLabel: copy.evictionLabel,
		preflightLabel: copy.preflightLabel,
		refreshLabel: copy.refresh,
		requestPersistenceLabel: copy.requestPersistence,
		cleanupLabel: storage.cleanupStatus === 'running' ? copy.cleanupRunning : copy.cleanup,
		derivativeCleanupLabel: storage.derivativeCleanupStatus === 'running'
			? copy.derivativeCleanupRunning
			: copy.derivativeCleanup,
		pressure: storage.pressure,
		cleanupStatus: storage.cleanupStatus,
		requestPersistenceDisabled: !storage.persistenceRequestAvailable || storage.evictionProtection === 'granted',
		cleanupDisabled: !storage.cleanupAvailable || storage.cleanupStatus === 'running',
		derivativeCleanupDisabled: !storage.derivativeCleanupAvailable
			|| storage.derivativeCleanupStatus === 'running',
	});
}

function capacityLabel(
	storage: Readonly<StorageUiSnapshot>,
	language: 'de' | 'en',
	copy: StorageCapacityUiCopy,
): string {
	const usage = formatBytes(storage.usage, language);
	const quota = formatBytes(storage.quota, language);
	const free = formatBytes(storage.free, language);
	if (!usage || !quota || !free) return copy.estimateUnavailable;
	return language === 'de'
		? `${usage} ${copy.usedOf} ${quota} · ${free} ${copy.free}`
		: `${usage} ${copy.usedOf} ${quota} · ${free} ${copy.free}`;
}

function backendLabel(storage: Readonly<StorageUiSnapshot>, copy: StorageCapacityUiCopy): string {
	if (storage.backend === 'indexeddb') return copy.indexedDb;
	return `${copy.memoryFallback}${storage.degradedReason ? ` (${storage.degradedReason})` : ''}`;
}

function evictionLabel(value: StorageEvictionProtection, copy: StorageCapacityUiCopy): string {
	if (value === 'granted') return copy.protected;
	if (value === 'best-effort') return copy.bestEffort;
	if (value === 'unavailable') return copy.protectionUnavailable;
	return copy.protectionUnknown;
}

function preflightLabel(
	preflight: Readonly<StoragePreflightSnapshot> | null,
	language: 'de' | 'en',
	copy: StorageCapacityUiCopy,
): string {
	if (!preflight) return copy.noPreflight;
	return `${copy.operation[preflight.operation]}: ${formatBytes(preflight.requiredBytes, language) ?? '—'} ${copy.requested} · ${formatBytes(preflight.requiredFreeBytes, language) ?? '—'} ${copy.requiredFree} · ${copy.preflightStatus[preflight.status]}`;
}

function formatBytes(value: number | null, language: 'de' | 'en'): string | null {
	if (!Number.isFinite(value) || Number(value) < 0) return null;
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let amount = Number(value);
	let unit = 0;
	while (amount >= 1024 && unit < units.length - 1) {
		amount /= 1024;
		unit += 1;
	}
	const formatted = new Intl.NumberFormat(language, {
		minimumFractionDigits: unit === 0 ? 0 : 1,
		maximumFractionDigits: unit === 0 ? 0 : 1,
	}).format(amount);
	return `${formatted} ${units[unit]}`;
}
