import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import { createAudioEditorProjectV7 } from '../src/common/editor/project-v7.ts';

const CHANNELS = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] as const;

test('authored BW64 rejects effects that collapse a multichannel terminal to stereo', () => {
	const project = createAudioEditorProjectV7({
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
		/stereo-only|compressor.*six-channel|multichannel.*compressor/iu,
	);
});
