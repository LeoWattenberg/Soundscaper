import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipDragMenuItems } from '../src/common/editor/ui/timeline/clip-drag-menu-model.ts';

test('clip drag menus select the source track and offer compatible time-preserving destinations', () => {
	const selected: string[][] = [];
	const moved: Array<[string, string]> = [];
	const items = createClipDragMenuItems({
		project: {
			tracks: [{ id: 'a', name: 'A', type: 'audio', clipIds: ['one', 'two'] },
				{ id: 'labels', name: 'Labels', type: 'label' },
				{ id: 'b', name: 'B', type: 'audio', clipIds: [] },
				{ id: 'video', name: 'Video', type: 'video', clipIds: [] }],
			clips: [{ id: 'one', kind: 'audio' }, { id: 'two', kind: 'audio' }],
		},
		clipId: 'one', blocked: false,
		copy: { selectTrackClips: 'Select all clips on this track', moveClipPreserveTime: 'Move to track (preserve time)' },
		select: (ids) => { selected.push([...ids]); },
		move: (clipId, trackId) => { moved.push([clipId, trackId]); },
	});
	items[0]?.onClick?.();
	assert.deepEqual(selected, [['one', 'two']]);
	assert.deepEqual(items[1]?.items?.map((item) => item.label), ['B']);
	items[1]?.items?.[0]?.onClick?.();
	assert.deepEqual(moved, [['one', 'b']]);
});
