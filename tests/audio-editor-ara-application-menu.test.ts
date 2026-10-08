/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplicationMenuProductItems as createCommonProductItems } from '../src/common/editor/ui/application-menu-product-items.js';
import { createApplicationMenuProductItems as createSoundscaperProductItems } from '../src/soundscaper/editor-application-menu-product-runtime.js';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

interface MenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly disabled?: boolean;
	readonly onClick?: () => unknown;
}

const project = { id: 'project', sampleRate: 48_000, sequences: [], subsequences: [], sources: [],
	clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0, durationFrames: 48_000 }],
	tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
};

test('ARA dialog belongs to the menu-loaded optional surface chunk', () => {
	assert.equal(chunkGroupForModulePath('/src/common/editor/ui/workspace/AraClipEditorSurface.tsx'), 'editor-optional-surfaces');
});

for (const [productId, createProductItems] of [
	['soundscaper', createSoundscaperProductItems], ['framescaper', createCommonProductItems],
] as const) {
	test(`${productId} product menu retains the opt-in ARA action for a selected audio clip`, () => {
		let opens = 0;
		const input = { productId, capabilities: {}, project, editBlocked: false, copy: {},
			snapshot: { selectedClipId: 'clip', readOnly: false },
			actions: { araClipEditing: { open: () => { opens++; } } },
		};
		const items: readonly MenuItem[] = createProductItems(input).effect;
		const ara = items.find(item => item.id === 'ara-clip-editor');
		assert.equal(ara?.label, 'Edit selected clip with ARA');
		assert.equal(ara?.disabled, false);
		ara?.onClick?.();
		assert.equal(opens, 1);
		const filtered = filterProductMenus([{ id: 'effect', items }], {
			audioEffects: productId === 'soundscaper',
		}, productId) as readonly Readonly<{ items: readonly MenuItem[] }>[];
		assert.equal(filtered[0]?.items.some(item => item.id === 'ara-clip-editor'), true);
		const browserItems: readonly MenuItem[] = createProductItems({ ...input, actions: {} }).effect;
		assert.equal(browserItems.some(item => item.id === 'ara-clip-editor'), false);
		const readOnlyItems: readonly MenuItem[] = createProductItems({ ...input,
			snapshot: { selectedClipId: 'clip', readOnly: true } }).effect;
		const disabled = readOnlyItems.find(item => item.id === 'ara-clip-editor');
		assert.equal(disabled?.disabled, true);
		assert.equal(disabled?.onClick, undefined);
	});
}
