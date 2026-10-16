/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

test('native range completion is a public effects capability shared by both product surfaces', () => {
	const policy = JSON.parse(readFileSync(new URL('../config/controller-domain-policy.json', import.meta.url), 'utf8')) as {
		publicModules: string[];
	};
	assert.ok(policy.publicModules.includes('effects/native-range-mouse-custody.ts'));
});

test('shared native range completion keeps its existing non-recursive controller owner', () => {
	const modulePath = 'src/common/editor/controller/effects/native-range-mouse-custody.ts';
	for (const path of [modulePath, modulePath.replaceAll('/', '\\')]) {
		assert.equal(chunkGroupForModulePath(path), 'editor-controller-core');
	}
	const group = chunkGroups.find((candidate) => candidate.name === 'editor-controller-core');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
});
