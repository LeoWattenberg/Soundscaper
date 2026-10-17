/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

const modules = [
	['src/common/editor/controller/shared/photo-library-develop-command.ts', 'editor-photo-library-scalars'],
	['src/common/editor/controller/shared/photo-library-develop-workflow-v1.ts', 'editor-photo-library-scalars'],
	['src/common/editor/controller/shared/photo-library-develop-settings-intent.ts', 'editor-photo-library-scalars'],
	['src/common/editor/controller/shared/photo-library-develop-settings-workflow-v1.ts', 'editor-photo-library-scalars'],
	['src/common/editor/controller/shared/photo-library-develop-presentation-v1.ts', 'editor-pixel-preview-presentation'],
	['src/common/editor/photo-library-develop-proxy-port-v1.ts', 'editor-neutral-foundations'],
	['src/common/editor/native-media-plan-canonical-form.ts', 'editor-neutral-foundations'],
	['src/common/editor/video-visual-preset-v24.ts', 'editor-imaging'],
	['src/common/i18n/lightscaper-develop-copy.ts', 'lightscaper-develop-copy'],
	['src/common/i18n/lightscaper-develop-menu-copy.ts', 'lightscaper-editor-copy'],
	['src/common/i18n/lightscaper-develop-settings-copy.ts', 'lightscaper-develop-copy'],
] as const;

test('Develop has exact POSIX/Windows semantic chunk ownership without filename prefix capture', () => {
	for (const [path, group] of modules) {
		for (const rooted of [path, path.replaceAll('/', '\\')]) {
			assert.equal(chunkGroupForModulePath(rooted), group, rooted);
			assert.notEqual(chunkGroupForModulePath(rooted + '.foreign'), group, rooted);
			assert.notEqual(chunkGroupForModulePath(rooted.replace(/\.ts$/u, '-foreign.ts')), group, rooted);
		}
	}
});

test('menu-owned Develop scalar and body closures acquire neither product persistence nor the timeline copy barrel', async () => {
	for (const [path] of modules.filter(([path]) => path.includes('/controller/'))) {
		const result = await build({ entryPoints: [fileURLToPath(new URL(`../${path}`, import.meta.url))], bundle: true,
			write: false, platform: 'browser', format: 'esm', metafile: true, logLevel: 'silent' });
		for (const leaf of Object.keys(result.metafile.inputs)) {
			assert.ok(!leaf.includes('src/lightscaper/') && !leaf.includes('editor/storage/'), leaf);
			assert.ok(!leaf.endsWith('/editor-copy.js') && !leaf.includes('/i18n/translations/'), leaf);
		}
	}
});
