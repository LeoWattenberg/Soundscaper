/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	StorageCapacitySnapshot,
	StorageCleanupStatus,
	StorageEvictionProtection,
	StoragePreflightSnapshot,
	StoragePressure,
} from '../controller/storage-capacity-service.ts';
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
	readonly pressure: StoragePressure;
	readonly cleanupStatus: StorageCleanupStatus;
	readonly requestPersistenceDisabled: boolean;
	readonly cleanupDisabled: boolean;
}

const COPY: Readonly<Record<'de' | 'en', StorageCapacityUiCopy>> = Object.freeze({
	en: Object.freeze({
		storage: 'Storage', free: 'free', usedOf: 'used of', estimateUnavailable: 'Storage estimate unavailable',
		indexedDb: 'IndexedDB', memoryFallback: 'Ephemeral memory fallback', protected: 'Protected from browser eviction',
		bestEffort: 'Best effort; the browser may evict local data', protectionUnavailable: 'Eviction protection unavailable',
		protectionUnknown: 'Eviction protection not checked', noPreflight: 'No storage preflight yet', requested: 'requested', requiredFree: 'required free',
		pressure: { normal: 'Normal pressure', warning: 'Warning pressure', critical: 'Critical pressure', unknown: 'Unknown pressure' },
		preflightStatus: { checking: 'Checking', ready: 'Ready', insufficient: 'Insufficient space', unknown: 'Quota unavailable' },
		operation: { recording: 'Recording', export: 'Export', effect: 'Effect processing', import: 'Import' },
		capacityLabel: 'Capacity', backendLabel: 'Storage backend', evictionLabel: 'Eviction protection',
		preflightLabel: 'Last required free-space check', refresh: 'Refresh estimate',
		requestPersistence: 'Request persistent storage', cleanup: 'Clean orphaned temporary files', cleanupRunning: 'Cleaning temporary files…',
	}),
	de: Object.freeze({
		storage: 'Speicher', free: 'frei', usedOf: 'belegt von', estimateUnavailable: 'Speicherbelegung nicht verfügbar',
		indexedDb: 'IndexedDB', memoryFallback: 'Flüchtiger Arbeitsspeicher-Fallback', protected: 'Vor Verdrängung durch den Browser geschützt',
		bestEffort: 'Best-Effort; der Browser kann lokale Daten verdrängen', protectionUnavailable: 'Schutz vor Verdrängung nicht verfügbar',
		protectionUnknown: 'Schutz vor Verdrängung nicht geprüft', noPreflight: 'Noch keine Speicherprüfung', requested: 'angefordert', requiredFree: 'frei benötigt',
		pressure: { normal: 'Normaler Speicherdruck', warning: 'Erhöhter Speicherdruck', critical: 'Kritischer Speicherdruck', unknown: 'Speicherdruck unbekannt' },
		preflightStatus: { checking: 'Wird geprüft', ready: 'Bereit', insufficient: 'Nicht genügend Speicher', unknown: 'Kontingent nicht verfügbar' },
		operation: { recording: 'Aufnahme', export: 'Export', effect: 'Effektverarbeitung', import: 'Import' },
		capacityLabel: 'Kapazität', backendLabel: 'Speicher-Backend', evictionLabel: 'Verdrängungsschutz',
		preflightLabel: 'Letzte Prüfung des Speicherbedarfs', refresh: 'Schätzung aktualisieren',
		requestPersistence: 'Dauerhaften Speicher anfordern', cleanup: 'Verwaiste temporäre Dateien bereinigen', cleanupRunning: 'Temporäre Dateien werden bereinigt…',
	}),
});

export function createStorageCapacityViewModel(
	storage: Readonly<StorageUiSnapshot>,
	locale = 'en',
): Readonly<StorageCapacityViewModel> {
	const language = locale.toLowerCase().startsWith('de') ? 'de' : 'en';
	const copy = COPY[language];
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
		pressure: storage.pressure,
		cleanupStatus: storage.cleanupStatus,
		requestPersistenceDisabled: !storage.persistenceRequestAvailable || storage.evictionProtection === 'granted',
		cleanupDisabled: !storage.cleanupAvailable || storage.cleanupStatus === 'running',
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
