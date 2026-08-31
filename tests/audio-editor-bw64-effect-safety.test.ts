import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import { createEffect } from '../src/common/editor/effects.js';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const CHANNELS = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] as const;

test('authored BW64 rejects effects that collapse a multichannel terminal to stereo', () => {
	const project = createCurrentAudioEditorProject({
		now: '2026-07-28T12:00:00.000Z',
		masterChannels: 6,
		sources: [{
			id: 'source', storageKey: 'pcm/source', frameCount: 4, channelCount: 6,
			sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 4 }],
		tracks: [{
			type: 'audio', id: 'bed', clipIds: ['clip'],
			effects: [{ id: 'compressor', type: 'compressor', enabled: true, params: {} }],
		}],
		metadata: { adm: {
			mode: 'authored',
			programme: { name: 'Programme', language: '' },
			content: { name: 'Content', language: '' },
			bed: {
				name: 'Bed', layout: '5.1',
				assignments: CHANNELS.map((bedChannel, sourceChannel) => ({
					stripKind: 'track', stripId: 'bed', sourceChannel, bedChannel, gain: 1,
				})),
			},
		} },
	});

	assert.throws(
		() => createExportPlan(project, { format: 'bw64', dither: 'none' }),
		/terminal channel width|compressor.*six-channel|multichannel.*compressor/iu,
	);
});

test('ordinary Soundscaper multichannel export refuses a stereo-only reverb', () => {
	const source = createAudioSource({
		id: 'surround-source', storageKey: 'pcm/surround-source', frameCount: 4,
		channelCount: 6, sampleRate: 48_000, sampleFormat: 'float32',
	});
	const clip = createAudioClip({
		id: 'surround-clip', sourceId: source.id, timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
	});
	const project = createSoundscaperProject({
		id: 'ordinary-surround-effect', title: 'Ordinary surround effect',
		now: '2026-08-31T12:00:00.000Z', masterChannels: 6,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'bed', name: 'Bed', clipIds: [clip.id] })],
		sequences: [{ id: 'main-sequence', trackIds: ['bed'] }],
		primarySequenceId: 'main-sequence',
		master: {
			effectsActive: true,
			effects: [createEffect('reverb', { id: 'master-reverb' })],
		},
	});

	assert.throws(
		() => createExportPlan(project, {
			format: 'wav', channelCount: 6, channelMapping: 'preserve', includeTail: false,
		}),
		/multichannel.*reverb|reverb.*channel width/iu,
	);
});
