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
