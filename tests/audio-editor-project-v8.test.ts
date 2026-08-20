import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createAudioEditorProjectV17,
	validateAudioEditorProjectV17,
} from '../src/common/editor/project-v17.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const NOW = '2026-07-28T12:00:00.000Z';

test('the current media pipeline retains the video-effects lineage', () => {
	const effect = createVideoEffect('chroma-key', { id: 'key' });
	const source = createVideoSource({
		id: 'source',
		frameCount: 1_600,
		sampleRate: 48_000,
		width: 16,
		height: 16,
		frameRate: { num: 30, den: 1 },
		sourceFrameCount: 1,
		videoCodec: 'vp9',
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 30, den: 1 } },
	});
	const sequence = { id: 'main-sequence', rate: { num: 30, den: 1 } };
	const clip = createVideoClip({
		kind: 'video',
		id: 'clip',
		sourceId: 'source',
		sequenceId: sequence.id,
		sequenceStartFrame: 0,
		sequenceFrameCount: 1,
		sourceInFrame: 0,
		sourceFrameCount: 1,
		videoEffects: [effect],
	}, { projectSampleRate: 48_000, sequence, source });
	const track = createVideoTrack({ id: 'track', clipIds: ['clip'] });
	const project = createAudioEditorProjectV17({
		now: NOW,
		sources: [source],
		clips: [clip],
		tracks: [track],
	});
	assert.equal(project.schemaVersion, 17);
	assert.deepEqual((project.clips[0] as { videoEffects: unknown }).videoEffects, [effect]);
	assert.equal(validateAudioEditorProjectV17(project), true);
});
