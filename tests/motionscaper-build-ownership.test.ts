/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { motionChunkGroups } from '../scripts/lib/build-motion-chunks.mjs';

test('motion scene and lazy raster runtime have distinct semantic chunk owners', () => {
	const owner = (path: string) => motionChunkGroups.find((group) => group.test.test(path))?.name;
	assert.equal(owner('/src/common/editor/motion-composition.ts'), 'motion-domain');
	assert.equal(owner('/src/common/editor/motion-canvaskit-browser.ts'), 'motion-raster');
	assert.equal(owner('/src/common/editor/controller/composition/motion-raster-runtime.ts'), 'motion-raster');
	assert.equal(owner('/config/motionscaper-raster-runtime.json'), 'motion-raster');
	assert.equal(owner('/node_modules/canvaskit-wasm/bin/canvaskit.js'), 'motion-raster');
	assert.equal(owner('/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2?url'), 'motion-raster');
	assert.equal(owner('/src/common/editor/ui/motionscaper/MotionscaperShell.tsx'), undefined);
});

test('Motionscaper menu surfaces cannot move their dynamic entry into the eager shell', async () => {
	const { chunkGroupForModulePath } = await import('../scripts/lib/build-chunk-groups.mjs');
	for (const name of ['MotionscaperShell.tsx', 'shell-menu.ts', 'motionscaper-copy.ts', 'motionscaper-shell.css']) assert.equal(chunkGroupForModulePath(`src/common/editor/ui/motionscaper/${name}`), 'editor-shell', name);
	for (const name of ['MotionOperatorsDialog.tsx', 'MotionOperatorForm.tsx', 'MotionShapeCollection.tsx', 'MotionPathsDialog.tsx', 'MotionPropertyGraph.tsx', 'motion-plane-geometry.ts', 'MotionscaperDocumentRuntime.tsx', 'MotionPreviewDialog.tsx']) {
		assert.equal(chunkGroupForModulePath(`src/common/editor/ui/motionscaper/${name}`), null, name);
	}
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/AudioEditorApplicationHeader.jsx'), 'editor-shell');
});
