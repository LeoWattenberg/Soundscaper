/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('direct desktop PCM execution and realtime export keep their semantic lazy owners', () => {
	assert.equal(chunkGroupForModulePath('src/common/editor/audacity-effects/pcm-channel-validation.ts'), 'editor-effect-contracts');
	assert.equal(chunkGroupForModulePath('src/common/editor/desktop-audio-pcm-stream.ts'), 'editor-optional-execution');
	assert.equal(chunkGroupForModulePath('src/common/editor/desktop-audio-pcm-stream-write.ts'), 'editor-optional-execution');
	assert.equal(chunkGroupForModulePath('src/common/editor/controller/export/internal/audio/realtime-desktop-pcm-export.ts'), 'editor-optional-export');
});
