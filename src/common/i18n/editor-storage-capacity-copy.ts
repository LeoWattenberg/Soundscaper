/* SPDX-License-Identifier: AGPL-3.0-only */

export const STORAGE_CAPACITY_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
		storage: 'Storage', free: 'free', usedOf: 'used of', estimateUnavailable: 'Storage estimate unavailable',
		indexedDb: 'IndexedDB', memoryFallback: 'Ephemeral memory fallback', protected: 'Protected from browser eviction',
		bestEffort: 'Best effort; the browser may evict local data', protectionUnavailable: 'Eviction protection unavailable',
		protectionUnknown: 'Eviction protection not checked', noPreflight: 'No storage preflight yet', requested: 'requested', requiredFree: 'required free',
		pressure: { normal: 'Normal pressure', warning: 'Warning pressure', critical: 'Critical pressure', unknown: 'Unknown pressure' },
		preflightStatus: { checking: 'Checking', ready: 'Ready', insufficient: 'Insufficient space', unknown: 'Quota unavailable' },
		operation: { recording: 'Recording', export: 'Export', effect: 'Effect processing', project: 'Project saving', import: 'Import' },
		capacityLabel: 'Capacity', backendLabel: 'Storage backend', evictionLabel: 'Eviction protection',
		preflightLabel: 'Last required free-space check', refresh: 'Refresh estimate',
		requestPersistence: 'Request persistent storage', cleanup: 'Clean orphaned temporary files', cleanupRunning: 'Cleaning temporary files',
		derivativeCleanup: 'Clear reproducible preview cache', derivativeCleanupRunning: 'Clearing preview cache',
	}),
	de: Object.freeze({
		storage: 'Speicher', free: 'frei', usedOf: 'belegt von', estimateUnavailable: 'Speicherbelegung nicht verfügbar',
		indexedDb: 'IndexedDB', memoryFallback: 'Flüchtiger Arbeitsspeicher-Fallback', protected: 'Vor Verdrängung durch den Browser geschützt',
		bestEffort: 'Best-Effort; der Browser kann lokale Daten verdrängen', protectionUnavailable: 'Schutz vor Verdrängung nicht verfügbar',
		protectionUnknown: 'Schutz vor Verdrängung nicht geprüft', noPreflight: 'Noch keine Speicherprüfung', requested: 'angefordert', requiredFree: 'frei benötigt',
		pressure: { normal: 'Normaler Speicherdruck', warning: 'Erhöhter Speicherdruck', critical: 'Kritischer Speicherdruck', unknown: 'Speicherdruck unbekannt' },
		preflightStatus: { checking: 'Wird geprüft', ready: 'Bereit', insufficient: 'Nicht genügend Speicher', unknown: 'Kontingent nicht verfügbar' },
		operation: { recording: 'Aufnahme', export: 'Export', effect: 'Effektverarbeitung', project: 'Projekt speichern', import: 'Import' },
		capacityLabel: 'Kapazität', backendLabel: 'Speicher-Backend', evictionLabel: 'Verdrängungsschutz',
		preflightLabel: 'Letzte Prüfung des Speicherbedarfs', refresh: 'Schätzung aktualisieren',
		requestPersistence: 'Dauerhaften Speicher anfordern', cleanup: 'Verwaiste temporäre Dateien bereinigen', cleanupRunning: 'Temporäre Dateien werden bereinigt',
		derivativeCleanup: 'Reproduzierbaren Vorschau-Cache leeren', derivativeCleanupRunning: 'Vorschau-Cache wird geleert',
	}),
});
