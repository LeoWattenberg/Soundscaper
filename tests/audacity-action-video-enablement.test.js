/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateAudacityEnableWhen } from '../src/common/editor/audacity-action-parity.js';

test('video tracks never satisfy audio enablement predicates', () => {
	const context = {
		snapshot: {
			project: {
				tracks: [{ id: 'video-1', type: 'video', clipIds: ['clip-1'], effects: [] }],
				clips: [{ id: 'clip-1', kind: 'video', sourceId: 'source-1' }],
				selection: { trackIds: ['video-1'], clipIds: ['clip-1'], startFrame: 0, endFrame: 100 },
			},
			selectedTrackId: 'video-1',
			selectedClipId: 'clip-1',
		},
	};
	assert.equal(evaluateAudacityEnableWhen('track-selected', context), true);
	for (const predicate of [
		'project-has-audio', 'audio-track-selected', 'editable-audio-track-selected',
		'stereo-track-selected', 'compatible-mono-tracks', 'audio-selection',
	]) assert.equal(evaluateAudacityEnableWhen(predicate, context), false, predicate);
});
