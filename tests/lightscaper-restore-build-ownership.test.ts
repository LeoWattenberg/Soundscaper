/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('restore scalar admission and Session retirement keep their own neutral chunk closure', async () => {
	const roots = ['photo-library-restore-v1.ts', 'photo-library-workflow-slot.ts'].map(name =>
		fileURLToPath(new URL(`../src/common/editor/controller/shared/${name}`, import.meta.url)));
	const result = await build({ entryPoints: roots, bundle: true, write: false, outdir: '/tmp/lightscaper-restore-ownership',
		platform: 'browser', format: 'esm', metafile: true, logLevel: 'silent' });
	for (const root of roots) {
		assert.equal(chunkGroupForModulePath(root), 'editor-photo-library-scalars');
		assert.equal(chunkGroupForModulePath(root.replaceAll('/', '\\')), 'editor-photo-library-scalars');
		assert.notEqual(chunkGroupForModulePath(root + '.foreign'), 'editor-photo-library-scalars');
	}
	for (const path of Object.keys(result.metafile.inputs)) {
		assert.ok(!path.includes('src/lightscaper/'), `Scalar admission acquired the product domain: ${path}`);
		assert.ok(!path.includes('editor/storage/'), `Scalar admission acquired native persistence: ${path}`);
	}
});

test('handwritten restore copy shares the existing photo copy chunk without translated catalog passengers', () => {
	const path = fileURLToPath(new URL('../src/common/i18n/lightscaper-restore-copy.ts', import.meta.url));
	assert.equal(chunkGroupForModulePath(path), 'lightscaper-editor-copy');
	assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'lightscaper-editor-copy');
	assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'lightscaper-editor-copy');
});

test('the shared native migration schema stays with media custody and has no product persistence implementation', async () => {
	const root = fileURLToPath(new URL('../src/common/editor/storage/indexeddb-schema.ts', import.meta.url));
	const result = await build({ entryPoints: [root], bundle: true, write: false, platform: 'browser', format: 'esm', metafile: true, logLevel: 'silent' });
	for (const path of Object.keys(result.metafile.inputs)) {
		assert.equal(chunkGroupForModulePath(path), 'editor-media-custody-storage', path);
		assert.ok(!path.endsWith('/project-repository.ts') && !path.endsWith('/revision-repository.ts'), path);
	}
});
