/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialStorageCapacitySnapshot } from '../src/common/editor/controller/shared/storage-capacity-service.ts';
import { createStorageCapacityViewModel } from '../src/common/editor/ui/storage-capacity-model.ts';

const storage = Object.freeze({
	...createInitialStorageCapacitySnapshot(),
	usage: 2.5 * 1024 ** 3,
	quota: 10 * 1024 ** 3,
	free: 7.5 * 1024 ** 3,
	pressure: 'normal' as const,
	state: 'indexeddb' as const,
	backend: 'indexeddb' as const,
	persistent: true,
	ephemeral: false,
	degradedReason: null,
	lastPreflight: Object.freeze({
		operation: 'project' as const,
		requiredBytes: 1.5 * 1024 ** 2,
		requiredFreeBytes: 1.65 * 1024 ** 2,
		status: 'ready' as const,
	}),
});

for (const locale of ['fr-FR', 'pl-PL', 'de-DE', 'en-US']) {
	test(`storage quantities retain the ${locale} workspace's number format`, () => {
		const model = createStorageCapacityViewModel(storage, locale);
		const formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
		assert.ok(model.summary.includes(`${formatter.format(7.5)} GB`), model.summary);
		assert.ok(model.capacity.includes(`${formatter.format(2.5)} GB`), model.capacity);
		assert.ok(model.capacity.includes(`${formatter.format(10)} GB`), model.capacity);
		assert.ok(model.preflight.includes(`${formatter.format(1.5)} MB`), model.preflight);
		assert.ok(model.preflight.includes(`${formatter.format(1.65)} MB`), model.preflight);
	});
}
