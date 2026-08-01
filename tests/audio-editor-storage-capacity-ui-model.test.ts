/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createStorageCapacityViewModel,
} from '../src/common/editor/ui/storage-capacity-model.ts';

test('storage capacity UI model exposes all Web Core storage signals', () => {
	const model = createStorageCapacityViewModel({
		usage: 8 * 1024 ** 3,
		quota: 10 * 1024 ** 3,
		free: 2 * 1024 ** 3,
		pressure: 'warning',
		evictionProtection: 'best-effort',
		persistenceRequestAvailable: true,
		updatedAt: 1,
		cleanupStatus: 'idle',
		cleanupAvailable: true,
		lastCleanupAt: null,
		derivativeCleanupStatus: 'idle',
		derivativeCleanupAvailable: true,
		lastDerivativeCleanupAt: null,
		lastDerivativeCleanup: null,
		lastPreflight: {
			operation: 'project',
			requiredBytes: 512 * 1024 ** 2,
			requiredFreeBytes: 564 * 1024 ** 2,
			status: 'ready',
		},
		state: 'indexeddb',
		backend: 'indexeddb',
		persistent: true,
		ephemeral: false,
		degradedReason: null,
	}, 'en');

	assert.equal(model.summary, 'Storage: 2.0 GB free · Warning pressure');
	assert.equal(model.capacity, '8.0 GB used of 10.0 GB · 2.0 GB free');
	assert.equal(model.backend, 'IndexedDB');
	assert.equal(model.evictionProtection, 'Best effort; the browser may evict local data');
	assert.equal(model.preflight, 'Project saving: 512.0 MB requested · 564.0 MB required free · Ready');
	assert.equal(model.requestPersistenceDisabled, false);
	assert.equal(model.cleanupDisabled, false);
	assert.equal(model.derivativeCleanupDisabled, false);
	assert.equal(model.derivativeCleanupLabel, 'Clear reproducible preview cache');
});

test('storage capacity UI model makes memory fallback and unavailable estimates explicit', () => {
	const model = createStorageCapacityViewModel({
		usage: null,
		quota: null,
		free: null,
		pressure: 'unknown',
		evictionProtection: 'unavailable',
		persistenceRequestAvailable: false,
		updatedAt: null,
		cleanupStatus: 'idle',
		cleanupAvailable: false,
		lastCleanupAt: null,
		derivativeCleanupStatus: 'idle',
		derivativeCleanupAvailable: true,
		lastDerivativeCleanupAt: null,
		lastDerivativeCleanup: null,
		lastPreflight: null,
		state: 'memory-ephemeral',
		backend: 'memory',
		persistent: false,
		ephemeral: true,
		degradedReason: 'SecurityError',
	}, 'de');

	assert.equal(model.capacity, 'Speicherbelegung nicht verfügbar');
	assert.equal(model.backend, 'Flüchtiger Arbeitsspeicher-Fallback (SecurityError)');
	assert.equal(model.evictionProtection, 'Schutz vor Verdrängung nicht verfügbar');
	assert.equal(model.preflight, 'Noch keine Speicherprüfung');
	assert.equal(model.requestPersistenceDisabled, true);
	assert.equal(model.cleanupDisabled, true);
	assert.equal(model.derivativeCleanupDisabled, false);
	assert.equal(model.derivativeCleanupLabel, 'Reproduzierbaren Vorschau-Cache leeren');
});

test('storage capacity UI model intentionally falls back to English for unsupported locales', () => {
	const model = createStorageCapacityViewModel({
		usage: null, quota: null, free: null, pressure: 'unknown',
		evictionProtection: 'unknown', persistenceRequestAvailable: false, updatedAt: null,
		cleanupStatus: 'idle', cleanupAvailable: false, lastCleanupAt: null, lastPreflight: null,
		derivativeCleanupStatus: 'idle', derivativeCleanupAvailable: false,
		lastDerivativeCleanupAt: null, lastDerivativeCleanup: null,
		state: 'indexeddb', backend: 'indexeddb', persistent: true, ephemeral: false, degradedReason: null,
	}, 'fr-FR');
	assert.equal(model.capacity, 'Storage estimate unavailable');
	assert.equal(model.preflight, 'No storage preflight yet');
});
