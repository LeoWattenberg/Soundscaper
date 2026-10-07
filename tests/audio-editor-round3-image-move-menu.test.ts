/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipDragMenuItems } from '../src/common/editor/ui/timeline/clip-drag-menu-model.ts';

test('image clips offer video-track destinations and retain their time-preserving move callback', () => {
	const moved: Array<readonly [string, string]> = [];
	const items = createClipDragMenuItems({ project: {
		tracks: [{ id: 'source', name: 'Images', type: 'video', clipIds: ['poster'] },
			{ id: 'destination', name: 'Background', type: 'video', clipIds: ['background'] },
			{ id: 'sound', name: 'Sound', type: 'audio', clipIds: [] }, { id: 'labels', name: 'Labels', type: 'label' }],
		clips: [{ id: 'poster', kind: 'image' }, { id: 'background', kind: 'image' }],
	}, clipId: 'poster', blocked: false, copy: { selectTrackClips: 'Select clips', moveClipPreserveTime: 'Move to track' },
	select() {}, move: (clipId, trackId) => { moved.push([clipId, trackId]); } });
	assert.equal(items[1]?.disabled, false);
	assert.deepEqual(items[1]?.items?.map(item => item.label), ['Background']);
	items[1]?.items?.[0]?.onClick?.(); assert.deepEqual(moved, [['poster', 'destination']]);
});
