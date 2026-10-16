/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipDragMenuItems } from '../src/common/editor/ui/timeline/clip-drag-menu-model.ts';

for (const kind of ['generator', 'still']) test(`${kind} uses existing picture lanes for time-preserving movement`, () => {
	const moved: Array<readonly [string, string]> = [];
	const items = createClipDragMenuItems({ project: {
		tracks: [{ id: 'source', name: 'Title', type: 'video', clipIds: ['title'] },
			{ id: 'picture', name: 'Picture', type: 'video', clipIds: [] },
			{ id: 'sound', name: 'Sound', type: 'audio', clipIds: [] }],
		clips: [{ id: 'title', kind }],
	}, clipId: 'title', blocked: false, copy: { selectTrackClips: 'Select', moveClipPreserveTime: 'Move' },
	select() {}, move: (clipId, trackId) => { moved.push([clipId, trackId]); } });
	assert.equal(items[1]?.disabled, false);
	assert.deepEqual(items[1]?.items?.map(item => item.label), ['Picture']);
	items[1]?.items?.[0]?.onClick?.();
	assert.deepEqual(moved, [['title', 'picture']]);
});

test('a generated visual cannot move to an audio-only destination', () => {
	const items = createClipDragMenuItems({ project: {
		tracks: [{ id: 'source', name: 'Title', type: 'video', clipIds: ['title'] },
			{ id: 'sound', name: 'Sound', type: 'audio', clipIds: [] }], clips: [{ id: 'title', kind: 'generator' }],
	}, clipId: 'title', blocked: false, copy: { selectTrackClips: 'Select', moveClipPreserveTime: 'Move' },
	select() {}, move() {} });
	assert.equal(items[1]?.disabled, true);
	assert.deepEqual(items[1]?.items, []);
});
