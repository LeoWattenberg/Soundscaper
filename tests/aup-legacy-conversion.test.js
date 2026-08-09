import assert from 'node:assert/strict';
import test from 'node:test';

import { convertLegacyAupToProject } from '../src/common/editor/aup-legacy-conversion.js';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';

test('legacy AUP conversion materializes audio and first-class annotations without a dry mix', () => {
	const ids = ['project', 'track', 'source', 'clip', 'labels', 'label'];
	const converted = convertLegacyAupToProject({
		sampleRate: 44_100,
		tempo: { bpm: 100, timeSignature: { numerator: 3, denominator: 4 } },
		selection: { startSeconds: 0.5, endSeconds: 1 },
		metadata: { title: 'Legacy.AUP' },
		tracks: [{
			type: 'audio', name: 'Stereo', rate: 48_000, channelCount: 2, channelLayout: 'stereo',
			sampleFormat: 0x0004000f, gain: 0.5,
			clips: [{
				name: 'Verse', channels: [Float32Array.of(0, 1, 0, -1), Float32Array.of(1, 0, -1, 0)],
				sourceStart: 1, sourceEnd: 4, startSeconds: 1, stretch: 2, speedRatio: 1,
				pitchCents: 200, envelope: [{ frame: 1, value: 0.5 }], color: '2',
			}],
		}, {
			type: 'label', name: 'Markers', labels: [{ title: 'Chorus', startSeconds: 2, endSeconds: 3 }],
		}],
		warnings: [],
		opaqueExtensions: { legacyAupProject: { name: 'project' } },
	}, {
		idFactory: () => ids.shift(),
		now: '2026-07-13T00:00:00.000Z',
	});
	assert.equal(converted.project.schemaVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.equal(converted.project.title, 'Legacy');
	assert.equal(converted.project.sampleRate, 44_100);
	assert.equal(converted.project.sources[0].sampleRate, 48_000);
	assert.equal(converted.project.sources[0].channelCount, 2);
	assert.equal(converted.project.sources[0].sampleFormat, 'float32');
	for (const field of ['channelCount', 'channelLayout', 'sampleRate', 'sampleFormat']) {
		assert.equal(Object.hasOwn(converted.project.tracks[0], field), false);
	}
	assert.equal(converted.project.clips[0].sourceDurationFrames, 3);
	assert.equal(converted.project.clips[0].speedRatio, 0.5);
	assert.equal(converted.project.clips[0].pitchCents, 200);
	assert.equal(converted.project.tracks.some((track) => track.type === 'label'), false);
	assert.equal(converted.project.timelineAnnotations[0].kind, 'region');
	assert.equal(converted.project.timelineAnnotations[0].startFrame, 88_200);
	assert.equal(converted.project.timelineAnnotations[0].endFrame, 132_300);
	assert.equal(converted.sources[0].channels.length, 2);
	assert.equal(validateCurrentAudioEditorProject(converted.project), true);
});

test('legacy AUP conversion canonicalizes its floating tempo into a bounded rational root', () => {
	const converted = convertLegacyAupToProject({
		sampleRate: 48_000,
		tempo: { bpm: 33.333333333333336, timeSignature: { numerator: 4, denominator: 4 } },
		tracks: [],
	}, {
		idFactory: (prefix) => prefix,
		now: '2026-08-09T00:00:00.000Z',
	});
	assert.deepEqual(converted.project.tempoMap.events[0].bpm, { num: 100, den: 3 });
	assert.equal(converted.project.tempo.bpm, 100 / 3);
	assert.equal(validateCurrentAudioEditorProject(converted.project), true);
});
