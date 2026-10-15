/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { EAGER_CHUNK_GROUPS } from './helpers/eager-chunk-group-crossings.ts';

test('native RAW body proof stays optional while inert Source4 metadata can share startup ownership', () => {
	const prefix = 'src/common/editor/', path = prefix + 'timeline-image-raw-pack-current-v1.ts', owner = 'editor-raw-original-proof';
	for (const separator of ['/', '\\']) {
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), owner);
		for (const neighbor of ['timeline-image-model-v4.ts', 'timeline-image-raw-receipt-v1.ts', 'timeline-image-raw-original-plan-current-v1.ts',
			'timeline-image-raw-pack-current-v2.ts', 'internal/timeline-image-raw-pack-current-v1.ts']) {
			assert.notEqual(chunkGroupForModulePath((prefix + neighbor).replaceAll('/', separator)), owner);
		}
		assert.notEqual(chunkGroupForModulePath((path + '.foreign').replaceAll('/', separator)), owner);
	}
	const group = chunkGroups.find(group => group.name === owner); assert.ok(group);
	assert.equal(EAGER_CHUNK_GROUPS.has(owner), false); assert.equal(group.includeDependenciesRecursively, false);
});

test('RAW memory metadata shares existing owners while menu-owned repair authoring stays optional', () => {
	const paths = [
		['src/framescaper/internal/timeline-image-raw-working-plan-current-v1.ts', 'framescaper-timeline-images'],
		['src/framescaper/editor-scape-asset-plan-finishing.ts', 'framescaper-timeline-images'],
		['config/lightscaper-libraw-runtime-manifest.json', 'editor-codec-foundations'],
		['src/common/editor/timeline-image-model-v4.ts', 'editor-imaging'],
		...['timeline-image-model-v2', 'timeline-image-model-v3', 'timeline-image-model-current-v1', 'timeline-image-pack-source-current-v1',
			'internal/timeline-image-model-editable-kernel-v1', 'image-develop-handoff-provenance-v1', 'image-develop-handoff-provenance-v2',
			'image-develop-handoff-provenance-current-v1', 'internal/image-develop-handoff-provenance-kernel-v1']
			.map(name => [`src/common/editor/${name}.ts`, 'editor-imaging'] as const),
		['src/common/editor/timeline-image-raw-receipt-v1.ts', 'editor-imaging'],
		['src/common/editor/timeline-image-raw-original-plan-current-v1.ts', 'editor-imaging'],
		['src/common/editor/controller/shared/image-repair-spots-authoring-v1.ts', 'editor-pixel-preview-presentation'],
		['src/common/editor/controller/shared/photo-library-repair-spots-authoring-v1.ts', 'editor-pixel-preview-presentation'],
		['src/common/editor/controller/shared/internal/image-repair-spots-authoring-kernel-v1.ts', 'editor-pixel-preview-presentation'],
	] as const;
	for (const [path, owner] of paths) for (const separator of ['/', '\\']) assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), owner);
	assert.equal(EAGER_CHUNK_GROUPS.has('editor-pixel-preview-presentation'), false);
});
