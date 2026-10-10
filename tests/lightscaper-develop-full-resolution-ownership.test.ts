/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { build, transformSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { isEagerlyLoadedModule, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

for (const module of ['photo-library-develop-original-port-v1.ts', 'photo-library-develop-full-resolution-port-v1.ts']) {
	test(`${module}: full-resolution contracts retain exact neutral chunk ownership and have no storage or product runtime imports`, async () => {
		const path = `src/common/editor/${module}`;
		for (const spelling of [path, path.replaceAll('/', '\\')]) {
			assert.equal(chunkGroupForModulePath(spelling), 'editor-neutral-foundations');
			assert.notEqual(chunkGroupForModulePath(spelling + '.foreign'), 'editor-neutral-foundations');
		}
		const output = await build({ entryPoints: [fileURLToPath(new URL(`../${path}`, import.meta.url))], bundle: true,
			write: false, platform: 'browser', format: 'esm', metafile: true, logLevel: 'silent' });
		assert.deepEqual(Object.keys(output.metafile.inputs), [path]);
	});
}

test('the shared natural-size recipe evaluator stays outside the startup imaging owner', () => {
	const path = 'src/common/editor/imaging/image-develop-frame-core.ts';
	assert.equal(isEagerlyLoadedModule(path), false, 'Sharing the evaluator must preserve menu-only loading.');
	for (const spelling of [path, path.replaceAll('/', '\\')]) {
		assert.equal(chunkGroupForModulePath(spelling), 'editor-image-develop-recipe');
		assert.notEqual(chunkGroupForModulePath(spelling + '.foreign'), 'editor-image-develop-recipe');
	}
	const owner = chunkGroups.find(group => group.name === 'editor-image-develop-recipe');
	assert.ok(owner);
	assert.equal(owner.includeDependenciesRecursively, false);
	assert.equal(owner.maxSize, 400_000);
});

test('the opted-in product render composition stays lazy and its executable closure acquires no library persistence or Frame controller', async () => {
	const bootstrap = transformSync(readFileSync(new URL('../src/lightscaper/ui/LightscaperBootstrap.tsx', import.meta.url), 'utf8'), { loader: 'tsx', format: 'esm' }).code;
	assert.ok(!staticRelativeDependencies(bootstrap).includes('../photo-develop-render-runtime-v2.ts'));
	assert.match(bootstrap, /import\(["']\.\.\/photo-develop-render-runtime-v2\.ts["']\)/u);
	const output = await build({ entryPoints: [fileURLToPath(new URL('../src/lightscaper/photo-develop-render-runtime-v2.ts', import.meta.url))],
		bundle: true, write: false, platform: 'browser', format: 'esm', metafile: true, logLevel: 'silent' });
	assert.ok(Object.hasOwn(output.metafile.inputs, 'src/common/editor/imaging/image-develop-frame-core.ts'));
	for (const path of Object.keys(output.metafile.inputs)) {
		assert.ok(!path.includes('src/lightscaper/storage/') && !path.includes('editor/storage/') && !path.includes('src/framescaper/'), path);
		assert.ok(!path.endsWith('/photo-library-session.ts') && !path.endsWith('/ffmpeg-runtime-core.js'), path);
	}
});
