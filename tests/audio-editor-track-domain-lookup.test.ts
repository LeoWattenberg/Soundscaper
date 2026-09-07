/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { findControllerClipTrack } from '../src/common/editor/controller/track-domain-types.ts';
import { createAudioTrack, createLabelTrack } from '../src/common/editor/project-media-factory.ts';

void test('clip ownership lookup skips label tracks before a media track', () => {
	const label = createLabelTrack({ id: 'labels', name: 'Markers' });
	const audio = createAudioTrack({ id: 'audio', name: 'Audio', clipIds: ['clip'] });
	const project = { tracks: [label, audio] };
	assert.equal(findControllerClipTrack(project, 'clip')?.id, 'audio');
	assert.equal(findControllerClipTrack(project, 'missing'), null);
	assert.equal(findControllerClipTrack(project, null), null);
});
