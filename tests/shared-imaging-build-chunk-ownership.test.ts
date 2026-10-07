/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

test('shared image kernels have one product-neutral owner with independent dependency placement', () => {
	for (const separator of ['/', '\\']) {
		for (const name of ['pixel-frame-canonical-rgba8-v1.ts', 'pixel-frame-resize-v1.ts',
			'pixel-frame-contract-v1.ts', 'image-metadata-model-v1.ts']) {
			const path = `src/common/editor/imaging/${name}`.replaceAll('/', separator);
			assert.equal(chunkGroupForModulePath(path), 'editor-imaging', path);
		}
	}
	const group = chunkGroups.find(candidate => candidate.name === 'editor-imaging');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(group.minSize, 0);
	assert.equal(group.maxSize, 400_000);
});
