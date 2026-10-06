/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioTrackRowPropReader, type AudioTrackRowMemoProps } from '../src/common/editor/ui/timeline/audio-track-row-props.ts';

void test('unrelated selection, drag, snapshot and callback updates retain the row inputs', () => {
	let visualReads = 0;
	const source = { id: 'source', sampleRate: 48_000 };
	const clips = Array.from({ length: 10_000 }, (_, index) => ({ id: `clip-${index}`, timelineStartFrame: index * 1_000, durationFrames: 100 }));
	const props: AudioTrackRowMemoProps = {
		controller: { getClipVisualData() { visualReads++; return { source, available: true }; } },
		track: { id: 'row', type: 'audio' }, trackClips: clips, clipLookup: new Map(clips.map(clip => [clip.id, clip])),
		renderViewportStartFrame: 0, viewportDurationFrames: 100, selectedClipIdSet: new Set(),
		selectedTrackId: 'other', selectedClipId: 'other-clip', automationTargets: [],
		viewModelRevision: { preferences: {} }, onMenu: () => 'first',
	};
	const reader = createAudioTrackRowPropReader();
	const first = reader.read(props); reader.publish(props);
	for (let number = 0; number < 100; number++) {
		const next = { ...props, selectedTrackId: `other-${number}`, selectedClipIdSet: new Set([`other-clip-${number}`]),
			clipDragPreview: { clipId: 'other-clip', trackId: 'other' }, automationTargets: [],
			viewModelRevision: { preferences: {} }, onMenu: () => number };
		assert.deepEqual(reader.read(next), first, 'React.memo sees the same row values');
		reader.publish(next);
	}
	assert.equal(visualReads, 101, 'only the one projected clip is checked, rather than all 10,000');
	assert.equal((first.onMenu as () => unknown)(), 99, 'retained callbacks dispatch through the latest committed closure');
	const speculative = { ...props, onMenu: () => 'speculative' };
	reader.read(speculative);
	assert.equal((first.onMenu as () => unknown)(), 99, 'an uncommitted render cannot replace event ownership');
});

void test('own selection, incoming drags, viewport media publications and preferences invalidate the row', () => {
	let visual = { available: true, peaks: {} };
	const own = { id: 'own', timelineStartFrame: 0, durationFrames: 100 };
	const incoming = { id: 'incoming', timelineStartFrame: 10_000, durationFrames: 100 };
	const props: AudioTrackRowMemoProps = { controller: { getClipVisualData: () => visual }, track: { id: 'row', type: 'audio' },
		trackClips: [own], clipLookup: new Map([[own.id, own], [incoming.id, incoming]]), renderViewportStartFrame: 0,
		viewportDurationFrames: 100, selectedTrackId: 'other', selectedClipIdSet: new Set(), viewModelRevision: { preferences: {} } };
	const reader = createAudioTrackRowPropReader();
	const first = reader.read(props);
	const selected = reader.read({ ...props, selectedTrackId: 'row', selectedClipId: 'own', selectedClipIdSet: new Set(['own']) });
	assert.equal(selected.selectedTrackId, 'row'); assert.equal(selected.selectedClipId, 'own');
	assert.deepEqual([...(selected.selectedClipIdSet as ReadonlySet<string>)], ['own']);
	const preview = { clipId: 'incoming', trackId: 'row' };
	const moved = reader.read({ ...props, clipDragPreview: preview, draggingClipIds: new Set(['incoming']), selectedClipId: 'incoming' });
	assert.equal(moved.clipDragPreview, preview); assert.equal(moved.selectedClipId, 'incoming');
	assert.deepEqual([...(moved.draggingClipIds as ReadonlySet<string>)], ['incoming']);
	visual = { available: true, peaks: {} };
	assert.notEqual(reader.read(props).viewModelRevision, first.viewModelRevision);
	const current = reader.read(props);
	assert.notEqual(reader.read({ ...props, viewModelRevision: { preferences: { waveformVisualization: { detail: true } } } }).viewModelRevision,
		current.viewModelRevision);
});
