/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { FRAMESCAPER_PROJECT_FOUNDATION_CHUNK_TEST } from '../scripts/lib/build-chunk-tests.mjs';
import {
	dynamicRelativeImports,
	resolveRelativeModule,
	staticRelativeDependencies,
} from './helpers/eager-chunk-group-crossings.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FOUNDATION = 'framescaper-project-foundations';
const CARRIER = 'src/framescaper/timeline-image-picture-carrier.ts';
const AVAILABILITY = 'src/framescaper/editor-native-action-bridge-availability.ts';

for (const path of [CARRIER, AVAILABILITY]) {
	test(`${path} shares the existing project foundation owner`, () => {
		for (const spelling of [path, path.replaceAll('/', '\\')]) {
			assert.equal(chunkGroupForModulePath(spelling), FOUNDATION);
			assert.ok(FRAMESCAPER_PROJECT_FOUNDATION_CHUNK_TEST.test(spelling));
			assert.equal(FRAMESCAPER_PROJECT_FOUNDATION_CHUNK_TEST.test(
				spelling.replace('.ts', '-controller.ts'),
			), false, 'the foundation claims the exact inert leaf');
		}
	});
}

test('the two shared leaves add no dependency outside existing foundation and imaging owners', () => {
	for (const path of [CARRIER, AVAILABILITY]) {
		const absolute = resolve(ROOT, path);
		const source = readFileSync(absolute, 'utf8');
		assert.deepEqual(dynamicRelativeImports(source), [], 'these leaves load no implementation');
		const dependencies = staticRelativeDependencies(source);
		if (path === AVAILABILITY) assert.deepEqual(dependencies, [], 'capability admission has no runtime dependency');
		for (const specifier of dependencies) {
			const dependency = resolveRelativeModule(absolute, specifier);
			assert.ok(dependency, `${path} -> ${specifier} must resolve`);
			const target = relative(ROOT, dependency).replaceAll('\\', '/');
			const owner = chunkGroupForModulePath(target);
			assert.ok(owner === FOUNDATION || owner === 'editor-imaging', `${path} -> ${target} [${owner}]`);
		}
	}
});

test('co-locating the leaves retains foundation bounds and the optional resource preview', () => {
	const group = chunkGroups.find(candidate => candidate.name === FOUNDATION);
	assert.ok(group);
	assert.equal(group.priority, 98);
	assert.equal(group.maxSize, 490_000);
	assert.equal(group.minSize, undefined);
	assert.equal(group.includeDependenciesRecursively, false);
	for (const path of [
		'src/framescaper/editor-selected-timeline-image-image-preview.ts',
		'src/framescaper/editor-selected-timeline-image-resource-preview-v16.ts',
	]) {
		assert.equal(FRAMESCAPER_PROJECT_FOUNDATION_CHUNK_TEST.test(path), false);
		assert.equal(chunkGroupForModulePath(path), 'editor-optional-surfaces');
	}
	assert.equal(FRAMESCAPER_PROJECT_FOUNDATION_CHUNK_TEST.test(
		'src/framescaper/selected-native-media-openfx-resource-v16.ts',
	), false, 'the render adapter retains its dependency layer');
});
