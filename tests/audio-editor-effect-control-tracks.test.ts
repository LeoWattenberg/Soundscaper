/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { audioEffectControlTracks } from '../src/common/editor/audio-effect-control-tracks.ts';

test('Auto Duck control choices retain audio order and omit their own track and nonsignal tracks', () => {
	const tracks = [
		{ id: 'labels', type: 'label' }, { id: 'video', type: 'video' },
		{ id: 'vocal', type: 'audio' }, { id: 'folder', type: 'folder' },
		{ id: 'speech', type: 'audio' }, { id: 'still', type: 'image' },
		{ id: 'music', type: 'audio' },
	];
	assert.deepEqual(audioEffectControlTracks(tracks, 'vocal'), [tracks[4], tracks[6]]);
	assert.deepEqual(audioEffectControlTracks(tracks, null), [tracks[2], tracks[4], tracks[6]]);
	assert.equal(audioEffectControlTracks(tracks, 'vocal')[0], tracks[4]);
});

test('Auto Duck has no usable control when only its audio track and labels exist', () => {
	assert.deepEqual(audioEffectControlTracks([
		{ id: 'labels', type: 'label' }, { id: 'own', type: 'audio' },
	], 'own'), []);
});
