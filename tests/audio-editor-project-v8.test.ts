import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorProjectV7 } from '../src/common/editor/project-v7.ts';
import {
	createAudioEditorProjectV8,
	createVideoClipV8,
	createVideoSourceV8,
	createVideoTrackV8,
} from '../src/common/editor/project-v8.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const NOW = '2026-07-28T12:00:00.000Z';

test('V8 stores the second effect batch while V7 remains frozen', () => {
	const effect = createVideoEffect('chroma-key', { id: 'key' });
	const clip = createVideoClipV8({
		id: 'clip',
		sourceId: 'source',
		durationFrames: 1,
		sourceDurationFrames: 1,
		videoEffects: [effect],
	});
	const source = createVideoSourceV8({
		id: 'source',
		frameCount: 1,
		width: 16,
		height: 16,
		frameRate: 30,
		videoCodec: 'vp9',
	});
	const track = createVideoTrackV8({ id: 'track', clipIds: ['clip'] });
	const project = createAudioEditorProjectV8({ now: NOW, sources: [source], clips: [clip], tracks: [track] });
	assert.equal(project.schemaVersion, 8);
	assert.deepEqual((project.clips[0] as { videoEffects: unknown }).videoEffects, [effect]);
	assert.throws(() => createAudioEditorProjectV7({ now: NOW, clips: [clip] }), /not supported by this schema/u);
});
