/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('the saved scalar limits join inert foundations without acquiring timeline domains', () => {
	for (const separator of ['/', '\\']) {
		const path = 'src/common/editor/photo-library-saved-collection-port-v1.ts'.replaceAll('/', separator);
		assert.equal(chunkGroupForModulePath(path), 'editor-neutral-foundations');
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'editor-neutral-foundations');
	}
});

test('query navigation and saved scalar command admission retain the exact photo scalar owner', () => {
	for (const module of ['query-navigation', 'saved-command']) for (const separator of ['/', '\\']) {
		const path = `src/common/editor/controller/shared/photo-library-${module}.ts`.replaceAll('/', separator);
		assert.equal(chunkGroupForModulePath(path), 'editor-photo-library-scalars');
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'editor-photo-library-scalars');
	}
});

test('saved filter labels remain in the lazy photo copy owner', () => {
	const path = 'src/common/i18n/lightscaper-saved-filter-copy.ts';
	assert.equal(chunkGroupForModulePath(path), 'lightscaper-editor-copy');
	assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'lightscaper-editor-copy');
	assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'lightscaper-editor-copy');
});
