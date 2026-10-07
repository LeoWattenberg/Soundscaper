/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCartMetadata, type CartMetadata } from '../src/common/editor/cart-metadata.ts';
import { normalizeProjectBextMetadata } from '../src/common/editor/project-bext-metadata.ts';
import { prepareImportedWavMetadata } from '../src/common/editor/controller/import/internal/wav-import-metadata.ts';
import { freezeProjectImportOptions } from '../src/common/editor/controller/import/internal/project-import-options.ts';

function importedMetadata(options: Readonly<{ sourceRate?: number; start?: number; spotted?: boolean; destination?: 'timeline' | 'bin' }> = {}) {
	const sourceRate = options.sourceRate ?? 48_000;
	const sourceCart = normalizeCartMetadata({ title: 'Radio take', postTimers: [{ usage: 'SEC1', value: sourceRate / 2 }] });
	const descriptor = {
		sampleRate: sourceRate, cart: sourceCart,
		...(options.spotted ? { bext: normalizeProjectBextMetadata({ timeReference: String(sourceRate * 10) }) } : {}),
	};
	const original = structuredClone(descriptor);
	const result = prepareImportedWavMetadata({
		descriptor, projectSampleRate: 48_000, copy: {}, freezeImportOptions: freezeProjectImportOptions,
		project: { metadata: { cart: null, bext: options.spotted ? normalizeProjectBextMetadata({ timeReference: '432000' }) : null } },
		importOptions: {
			destination: options.destination ?? 'timeline', trackId: null,
			timelineStartFrame: options.start ?? 96_000, timelineStartExplicit: !options.spotted,
		},
	});
	assert.deepEqual(descriptor, original, 'promoting project continuity metadata preserves the original source');
	return result as Readonly<{
		projectCart: CartMetadata | null;
		sourceCart: CartMetadata;
		importOptions: { readonly timelineStartFrame: number };
		warnings: readonly { readonly code: string }[];
	}>;
}

test('CART promotion includes an explicitly dropped recording origin before any output cut', () => {
	const result = importedMetadata();
	assert.deepEqual(result.projectCart!.postTimers, [{ usage: 'SEC1', value: 120_000 }]);
	assert.deepEqual(result.sourceCart.postTimers, [{ usage: 'SEC1', value: 24_000 }]);
});

test('the import origin and the source sample clock are independent CART conversions', () => {
	const result = importedMetadata({ sourceRate: 32_000 });
	assert.deepEqual(result.projectCart!.postTimers, [{ usage: 'SEC1', value: 120_000 }]);
	assert.deepEqual(result.sourceCart.postTimers, [{ usage: 'SEC1', value: 16_000 }]);
});

test('automatically spotted broadcast recordings promote CART at the resolved timeline placement', () => {
	const result = importedMetadata({ sourceRate: 32_000, start: 0, spotted: true });
	assert.equal(result.importOptions.timelineStartFrame, 48_000);
	assert.deepEqual(result.projectCart!.postTimers, [{ usage: 'SEC1', value: 72_000 }]);
});

test('zero-origin timeline and unplaced bin imports retain their source-relative CART timers', () => {
	assert.deepEqual(importedMetadata({ start: 0 }).projectCart!.postTimers, [{ usage: 'SEC1', value: 24_000 }]);
	assert.deepEqual(importedMetadata({ destination: 'bin' }).projectCart!.postTimers, [{ usage: 'SEC1', value: 24_000 }]);
});

test('an unrepresentable placed CART cue warns and retains source metadata rather than inventing a value', () => {
	const result = importedMetadata({ start: 0xffff_ffff });
	assert.equal(result.projectCart, null);
	assert.deepEqual(result.sourceCart.postTimers, [{ usage: 'SEC1', value: 24_000 }]);
	assert.ok(result.warnings.some((warning: { readonly code: string }) => warning.code === 'cart-post-timer-conversion'));
});
