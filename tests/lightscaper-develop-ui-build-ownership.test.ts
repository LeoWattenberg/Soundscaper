/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

const modules = [
	['src/common/editor/controller/shared/photo-library-develop-command.ts', 'editor-photo-library-scalars'],
	['src/common/editor/controller/shared/photo-library-develop-workflow-v1.ts', 'editor-photo-library-scalars'],
	['src/common/editor/controller/shared/photo-library-develop-presentation-v1.ts', 'editor-pixel-preview-presentation'],
	['src/common/editor/photo-library-develop-proxy-port-v1.ts', 'editor-neutral-foundations'],
	['src/common/i18n/lightscaper-develop-copy.ts', 'lightscaper-editor-copy'],
	['src/common/i18n/lightscaper-develop-menu-copy.ts', 'lightscaper-editor-copy'],
] as const;

test('Develop has exact POSIX/Windows semantic chunk ownership without filename prefix capture', () => {
	for (const [path, group] of modules) {
		assert.equal(chunkGroupForModulePath(path), group, path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), group, path);
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), group, path);
	}
});

test('menu-owned Develop scalar and body closures acquire neither product persistence nor the timeline copy barrel', async () => {
	for (const [path] of modules.slice(0, 3)) {
		const result = await build({ entryPoints: [fileURLToPath(new URL(`../${path}`, import.meta.url))], bundle: true,
			write: false, platform: 'browser', format: 'esm', metafile: true, logLevel: 'silent' });
		for (const leaf of Object.keys(result.metafile.inputs)) {
			assert.ok(!leaf.includes('src/lightscaper/') && !leaf.includes('editor/storage/'), leaf);
			assert.ok(!leaf.endsWith('/editor-copy.js') && !leaf.includes('/i18n/translations/'), leaf);
		}
	}
});
