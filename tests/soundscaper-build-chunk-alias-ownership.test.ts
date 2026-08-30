/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('Soundscaper browser alias targets have explicit semantic chunk owners', () => {
	for (const [path, owner] of [
		['src/soundscaper/framescaper-capture-copy.js', 'editor-copy'],
		['src/soundscaper/editor-capture-toolbar-control.tsx', 'editor-shell'],
		['src/soundscaper/editor-framescaper-overlay-model.ts', 'editor-shell'],
		['src/soundscaper/editor-video-preview-product-runtime.ts', 'editor-shell'],
		['src/soundscaper/editor-application-menu-product-runtime.js', 'editor-shell'],
		['src/soundscaper/editor-workspace-application-menu-runtime.ts', 'editor-shell'],
		['src/soundscaper/editor-workspace-panel-runtime.ts', 'editor-shell'],
		['src/soundscaper/local-assistance-deferred-publication.ts', 'editor-optional-assistance'],
	] as const) {
		assert.equal(chunkGroupForModulePath(path), owner, path);
	}
});
