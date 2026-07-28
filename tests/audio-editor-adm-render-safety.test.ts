import assert from 'node:assert/strict';
import test from 'node:test';

import { findUnsafeAdmRenderEffects } from '../src/common/editor/adm-render-safety.ts';

test('ADM render safety identifies stereo-only effects on multichannel signal paths', () => {
	const project = {
		masterChannels: 6,
		sources: [
			{ id: 'stereo-source', channelCount: 2 },
			{ id: 'surround-source', channelCount: 6 },
		],
		clips: [
			{ id: 'stereo-clip', sourceId: 'stereo-source' },
			{ id: 'surround-clip', sourceId: 'surround-source' },
		],
		tracks: [
			{ id: 'stereo', type: 'audio', clipIds: ['stereo-clip'], effects: [{ id: 'safe-stereo-compressor', type: 'compressor' }] },
			{
				id: 'surround',
				type: 'audio',
				clipIds: ['surround-clip'],
				effects: [
					{ id: 'safe-audacity', type: 'audacity-invert' },
					{ id: 'safe-gate', type: 'gate' },
					{ id: 'safe-limiter', type: 'limiter' },
					{ id: 'unsafe-compressor', type: 'compressor' },
				],
			},
			{ id: 'bypassed', type: 'audio', clipIds: ['surround-clip'], effects: [{ id: 'bypassed-reverb', type: 'reverb', bypassed: true }] },
		],
		mixer: {
			groups: [
				{ id: 'stereo-group', effects: [{ id: 'safe-reverb', type: 'reverb' }] },
				{ id: 'surround-group', effects: [{ id: 'unsafe-reverb', type: 'reverb' }] },
			],
			sends: [],
			routes: {
				stereo: { groupId: 'stereo-group' },
				surround: { groupId: 'surround-group' },
			},
		},
		master: {
			effects: [
				{ id: 'safe-eq', type: 'parametric-eq' },
				{ id: 'disabled-limiter', type: 'limiter', enabled: false },
				{ id: 'unsafe-convolver', type: 'convolver' },
			],
		},
	};

	assert.deepEqual(findUnsafeAdmRenderEffects(project, 6), [
		{ scope: 'track', targetId: 'surround', effectId: 'unsafe-compressor', effectType: 'compressor', channelCount: 6 },
		{ scope: 'group', targetId: 'surround-group', effectId: 'unsafe-reverb', effectType: 'reverb', channelCount: 6 },
		{ scope: 'master', targetId: null, effectId: 'unsafe-convolver', effectType: 'convolver', channelCount: 6 },
	]);
});

test('ADM render safety does not restrict mono or stereo deliveries', () => {
	assert.deepEqual(findUnsafeAdmRenderEffects({
		master: { effects: [{ id: 'compressor', type: 'compressor' }] },
	}, 2), []);
});
