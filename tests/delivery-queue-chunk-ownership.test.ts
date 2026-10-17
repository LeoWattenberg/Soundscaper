/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

test('public delivery queue runner retains the controller owner of its compatibility facade', () => {
	const implementation = 'src/common/editor/delivery-queue-runner.ts';
	const facade = 'src/common/editor/controller/export/internal/delivery/delivery-queue-runner.ts';
	for (const separator of ['/', '\\']) {
		for (const path of [implementation, facade]) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), 'editor-controller-core');
		}
		for (const impostor of [implementation + '.foreign', implementation.replace('.ts', '-extra.ts'),
			implementation.replace('editor/', 'editor/nested/')]) {
			assert.notEqual(chunkGroupForModulePath(impostor.replaceAll('/', separator)), 'editor-controller-core');
		}
	}
	const owner = chunkGroups.find(group => group.name === 'editor-controller-core');
	assert.ok(owner);
	assert.equal(owner.priority, 75);
	assert.equal(owner.maxSize, 400_000);
	assert.equal(owner.includeDependenciesRecursively, false);
});
