/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
	chunkGroupForModulePath,
	chunkGroups,
	EDITOR_OPTIONAL_SURFACE_CHUNK_TEST,
	FRAMESCAPER_TIMELINE_IMAGE_CHUNK_TEST,
} from '../scripts/lib/build-chunk-groups.mjs';
import {
	dynamicRelativeImports,
	EAGER_CHUNK_GROUPS,
	eagerlyReachableModules,
	isEagerlyLoadedModule,
	resolveRelativeModule,
	sourceModules,
	staticRelativeDependencies,
} from './helpers/eager-chunk-group-crossings.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONTROLLER = 'src/framescaper/editor-selected-timeline-image-image-preview-controller.ts';
const IMAGE_PREVIEW = 'src/framescaper/editor-selected-timeline-image-image-preview.ts';
const RESOURCE_PREVIEW = 'src/framescaper/editor-selected-timeline-image-resource-preview-v16.ts';
const FINISHING_PREVIEW = 'src/framescaper/editor-selected-finishing-visual-preview.ts';

test('the named current resource preview belongs to the existing optional preview owner', () => {
	for (const path of [RESOURCE_PREVIEW, RESOURCE_PREVIEW.replaceAll('/', '\\')]) {
		assert.ok(FRAMESCAPER_TIMELINE_IMAGE_CHUNK_TEST.test(path), 'the broader timeline predicate also matches this name');
		assert.ok(EDITOR_OPTIONAL_SURFACE_CHUNK_TEST.test(path), 'the exact optional predicate must take precedence');
		assert.equal(chunkGroupForModulePath(path), 'editor-optional-surfaces', path);
	}
	assert.equal(chunkGroupForModulePath(IMAGE_PREVIEW), 'editor-optional-surfaces');
	assert.equal(chunkGroupForModulePath(CONTROLLER), 'framescaper-timeline-images');
	assert.equal(EDITOR_OPTIONAL_SURFACE_CHUNK_TEST.test(RESOURCE_PREVIEW.replace('.ts', '-controller.ts')), false,
		'the new optional entry names only the implementation');
	const optional = chunkGroups.find(group => group.name === 'editor-optional-surfaces');
	const timeline = chunkGroups.find(group => group.name === 'framescaper-timeline-images');
	assert.ok(optional); assert.ok(timeline);
	assert.ok(Number(optional.priority) > Number(timeline.priority));
	assert.equal(optional.includeDependenciesRecursively, false);
	assert.equal(timeline.includeDependenciesRecursively, false);
	assert.equal(EAGER_CHUNK_GROUPS.has('editor-optional-surfaces'), false);
	assert.equal(EAGER_CHUNK_GROUPS.has('framescaper-timeline-images'), true);
});

test('the current resource implementation retains the actual controller dynamic preview seam', () => {
	const controller = readFileSync(resolve(ROOT, CONTROLLER), 'utf8');
	assert.ok(dynamicRelativeImports(controller).includes('./editor-selected-timeline-image-image-preview.ts'));
	assert.ok(!staticRelativeDependencies(controller).includes('./editor-selected-timeline-image-image-preview.ts'));
	const preview = readFileSync(resolve(ROOT, IMAGE_PREVIEW), 'utf8');
	assert.ok(staticRelativeDependencies(preview).includes('./editor-selected-timeline-image-resource-preview-v16.ts'));
	const importers = sourceModules(resolve(ROOT, 'src/framescaper')).filter(absolute =>
		staticRelativeDependencies(readFileSync(absolute, 'utf8')).some(specifier =>
			resolveRelativeModule(absolute, specifier) === resolve(ROOT, RESOURCE_PREVIEW)));
	assert.deepEqual(importers, [resolve(ROOT, IMAGE_PREVIEW)], 'the renderer is shared only by the deferred preview caller');
});

test('the resource and retained finishing renderers remain outside the eager static graph', () => {
	const reached = eagerlyReachableModules();
	assert.ok(reached.has(resolve(ROOT, CONTROLLER)), 'the controller still composes at startup');
	assert.equal(isEagerlyLoadedModule(CONTROLLER), true);
	for (const path of [IMAGE_PREVIEW, RESOURCE_PREVIEW, FINISHING_PREVIEW]) {
		assert.ok(!reached.has(resolve(ROOT, path)), `${path} must stay behind the dynamic preview import`);
		assert.equal(isEagerlyLoadedModule(path), false, `${path} must not join an eager chunk by ownership`);
	}
});
