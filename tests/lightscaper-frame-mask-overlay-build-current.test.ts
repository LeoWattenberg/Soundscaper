/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { EAGER_CHUNK_GROUPS, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const directory = fileURLToPath(new URL('../src/common/editor/', import.meta.url));

test('menu-opened Frame draft presentation retains the existing optional pixel owner without an eager runtime importer', () => {
	const module = 'controller/shared/image-develop-draft-presentation-v1.ts', path = directory + module, owner = 'editor-pixel-preview-presentation';
	for (const candidate of [path, path.replaceAll('/', '\\')]) assert.equal(chunkGroupForModulePath(candidate), owner);
	for (const candidate of [path + '.foreign', path.replace('-v1.ts', '-v2.ts')]) assert.notEqual(chunkGroupForModulePath(candidate), owner);
	assert.equal(EAGER_CHUNK_GROUPS.has(owner), false);
	// The display allocator and its temporary mode validator share the optional
	// owner; leaving either in an eager group pulls presentation back into boot.
	for (const dependency of ['imaging/photo-develop-display-frame-v1.ts', 'photo-develop-mask-display-v1.ts']) {
		for (const candidate of [directory + dependency, (directory + dependency).replaceAll('/', '\\')]) assert.equal(chunkGroupForModulePath(candidate), owner);
		assert.notEqual(chunkGroupForModulePath(directory + dependency + '.foreign'), owner);
	}
	const importer = directory + 'ui/dialogs/FramescaperImageDevelopMaskEditorV1.tsx';
	assert.ok(staticRelativeDependencies(transformSync(readFileSync(importer, 'utf8'), { loader: 'tsx', format: 'esm' }).code)
		.includes('../../controller/shared/image-develop-draft-presentation-v1.ts'));
	for (const [source, loader] of [
		[fileURLToPath(new URL('../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts', import.meta.url)), 'ts'],
		[directory + 'ui/dialogs/FramescaperImageDevelopOwnerSurfaceV1.tsx', 'tsx'],
	] as const) assert.ok(staticRelativeDependencies(transformSync(readFileSync(source, 'utf8'), { loader, format: 'esm' }).code)
		.every(specifier => !specifier.endsWith('/image-develop-draft-presentation-v1.ts')));
});
