/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { EAGER_CHUNK_GROUPS } from './helpers/eager-chunk-group-crossings.ts';

test('native linear execution stays optional independently of scalar Frame memory admission', () => {
	const directory = fileURLToPath(new URL('../src/common/editor/', import.meta.url));
	const owner = 'editor-native-image-develop';
	assert.equal(EAGER_CHUNK_GROUPS.has(owner), false);
	for (const module of ['imaging/image-develop-linear-frame-v1.ts', 'imaging/pixel-frame-linear-global-v1.ts',
		'imaging/image-develop-linear-current-v1.ts', 'imaging/image-develop-linear-plan-v1.ts', 'imaging/linear-kernel-planes-v1.ts']) {
		for (const path of [directory + module, (directory + module).replaceAll('/', '\\')]) {
			assert.equal(chunkGroupForModulePath(path), owner);
			assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner);
		}
	}
	for (const module of ['imaging/image-develop-linear-metadata-current-v1.ts', 'imaging/linear-kernel-descriptor-v1.ts', 'photo-library-develop-linear-port-v1.ts']) {
		assert.equal(chunkGroupForModulePath(directory + module), 'editor-imaging');
	}
});
