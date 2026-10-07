/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('the photo shell follows its own lazy bootstrap instead of the audio shell owner', () => {
	// Claiming this sole-consumer UI as editor-shell makes shared site/copy imports
	// point back into LightscaperBootstrap and creates a static chunk cycle.
	for (const separator of ['/', '\\']) {
		for (const path of [
			'src/common/editor/ui/lightscaper/LightscaperApp.tsx',
			'src/common/editor/ui/lightscaper/lightscaper.css',
			'src/common/editor/ui/lightscaper/library/PhotoLibrary.tsx',
			'src/lightscaper/ui/LightscaperBootstrap.tsx',
		]) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), null, path);
		}
	}
});

test('photo shell isolation preserves the shared audio/video shell owner', () => {
	for (const path of [
		'src/common/editor/ui/AudioEditorMenuBar.jsx',
		'src/common/editor/ui/application-menu/product-runtime.ts',
		'src/common/products.js',
		'src/common/url.ts',
	]) {
		assert.equal(chunkGroupForModulePath(path), 'editor-shell', path);
	}
});
