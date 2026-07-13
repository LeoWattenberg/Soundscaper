import assert from 'node:assert/strict';
import test from 'node:test';

import { convertStructuredAup3ToProjectV2 } from '../src/lib/tools/audio-editor/aup3-conversion.js';
import { validateAudioEditorProject } from '../src/lib/tools/audio-editor/project.js';

test('structured AUP3 conversion materializes audio and labels without a dry mix', () => {
	const ids = ['project', 'track', 'source', 'clip', 'labels', 'label'];
	const converted = convertStructuredAup3ToProjectV2({
		sampleRate: 44_100,
		tempo: { bpm: 100, timeSignature: { numerator: 3, denominator: 4 } },
		selection: { startSeconds: 0.5, endSeconds: 1 },
		metadata: { title: 'Legacy.AUP3' },
		tracks: [{
			type: 'audio', name: 'Stereo', rate: 48_000, channelCount: 2, channelLayout: 'stereo', gain: 0.5,
			clips: [{
				name: 'Verse', channels: [Float32Array.of(0, 1, 0, -1), Float32Array.of(1, 0, -1, 0)],
				sourceStart: 1, sourceEnd: 4, startSeconds: 1, stretch: 2, speedRatio: 1,
				pitchCents: 200, envelope: [{ frame: 1, value: 0.5 }], color: '2',
			}],
		}, {
			type: 'label', name: 'Markers', labels: [{ title: 'Chorus', startSeconds: 2, endSeconds: 3 }],
		}],
		warnings: [],
		opaqueExtensions: { aup3Project: { name: 'project' } },
	}, {
		idFactory: () => ids.shift(),
		now: '2026-07-13T00:00:00.000Z',
	});
	assert.equal(converted.project.schemaVersion, 2);
	assert.equal(converted.project.title, 'Legacy');
	assert.equal(converted.project.sampleRate, 44_100);
	assert.equal(converted.project.tracks[0].channelCount, 2);
	assert.equal(converted.project.clips[0].sourceDurationFrames, 3);
	assert.equal(converted.project.clips[0].speedRatio, 0.5);
	assert.equal(converted.project.clips[0].pitchCents, 200);
	assert.equal(converted.project.tracks[1].labels[0].startFrame, 88_200);
	assert.equal(converted.sources[0].channels.length, 2);
	assert.equal(validateAudioEditorProject(converted.project), true);
});
