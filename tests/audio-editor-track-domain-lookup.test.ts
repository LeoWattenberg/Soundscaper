/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { findControllerClipTrack, findControllerSource } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createAudioTrack, createLabelTrack } from '../src/common/editor/project-media-factory.ts';

void test('clip ownership lookup skips label tracks before a media track', () => {
	const label = createLabelTrack({ id: 'labels', name: 'Markers' });
	const audio = createAudioTrack({ id: 'audio', name: 'Audio', clipIds: ['clip'] });
	const project = { tracks: [label, audio] };
	assert.equal(findControllerClipTrack(project, 'clip')?.id, 'audio');
	assert.equal(findControllerClipTrack(project, 'missing'), null);
	assert.equal(findControllerClipTrack(project, null), null);
});

void test('PCM source lookup does not admit images, video, or incomplete audio records', () => {
	const audio = { id: 'audio', kind: 'audio', storageKey: 'audio', name: 'Audio',
		mimeType: 'audio/wav', frameCount: 100, channelCount: 1, sampleRate: 48_000,
		originalSampleRate: 48_000 };
	const project = { sources: [audio, { id: 'image', kind: 'image' },
		{ ...audio, id: 'video', kind: 'video' }, { id: 'incomplete', kind: 'audio' }] };
	assert.equal(findControllerSource(project, 'audio'), audio);
	for (const id of ['image', 'video', 'incomplete', 'missing']) {
		assert.equal(findControllerSource(project, id), null);
	}
});
