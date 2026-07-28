import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTerminalChannelWidths } from '../src/common/editor/terminal-channel-widths.ts';

test('terminal channel widths follow the widest source routed into each strip', () => {
	const widths = resolveTerminalChannelWidths({
		sources: [
			{ id: 'stereo-source', channelCount: 2 },
			{ id: 'surround-source', channelCount: 6 },
		],
		clips: [
			{ id: 'stereo-clip', sourceId: 'stereo-source' },
			{ id: 'surround-clip', sourceId: 'surround-source' },
		],
		tracks: [
			{ id: 'direct', type: 'audio', clipIds: ['stereo-clip'] },
			{ id: 'stereo-grouped', type: 'audio', clipIds: ['stereo-clip'] },
			{ id: 'surround-grouped', type: 'audio', clipIds: ['surround-clip'] },
			{ id: 'empty', type: 'audio', clipIds: [] },
		],
		mixer: {
			groups: [{ id: 'stereo-group' }, { id: 'surround-group' }, { id: 'empty-group' }],
			sends: [{ id: 'surround-send' }, { id: 'disabled-send' }],
			routes: {
				'stereo-grouped': { groupId: 'stereo-group' },
				'surround-grouped': {
					groupId: 'surround-group',
					sends: { 'surround-send': 0.5, 'disabled-send': 0 },
				},
			},
		},
	});

	assert.deepEqual(Object.fromEntries(widths.tracks), {
		direct: 2,
		'stereo-grouped': 2,
		'surround-grouped': 6,
		empty: 2,
	});
	assert.deepEqual(Object.fromEntries(widths.groups), {
		'stereo-group': 2,
		'surround-group': 6,
		'empty-group': 2,
	});
	assert.deepEqual(Object.fromEntries(widths.sends), {
		'surround-send': 6,
		'disabled-send': 2,
	});
});

test('terminal channel widths clamp media layouts to the supported Web Audio range', () => {
	const widths = resolveTerminalChannelWidths({
		sources: [{ id: 'source', channelCount: 64 }],
		clips: [{ id: 'clip', sourceId: 'source' }],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
	});

	assert.equal(widths.tracks.get('track'), 32);
});

test('terminal channel widths keep mono-fed buses mono and fall back only for unfed buses', () => {
	const widths = resolveTerminalChannelWidths({
		sources: [{ id: 'mono-source', channelCount: 1 }],
		clips: [{ id: 'mono-clip', sourceId: 'mono-source' }],
		tracks: [{ id: 'mono', type: 'audio', clipIds: ['mono-clip'] }],
		mixer: {
			groups: [{ id: 'mono-group' }, { id: 'unfed-group' }],
			sends: [{ id: 'mono-send' }, { id: 'unfed-send' }],
			routes: {
				mono: { groupId: 'mono-group', sends: { 'mono-send': 0.5 } },
			},
		},
	});

	assert.deepEqual(Object.fromEntries(widths.groups), {
		'mono-group': 1,
		'unfed-group': 2,
	});
	assert.deepEqual(Object.fromEntries(widths.sends), {
		'mono-send': 1,
		'unfed-send': 2,
	});
});
