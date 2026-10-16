/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SELECTION_BOUNDARY_HIT_WIDTH,
	createTimelineSelectionBoundaryEdit,
	resolveTimelineSelectionBoundaryEdge,
	previewTimelineSelectionBoundaryEdit,
} from '../src/common/editor/ui/timeline/selection-pointer-edit.ts';

const selection = { startFrame: 100, endFrame: 300, trackIds: ['track-a', 'track-b'] };
const project = {
	sampleRate: 1_000,
	snap: { enabled: false, unit: 'samples', mode: 'nearest' },
	tracks: [{ id: 'track-a', clipIds: ['clip-a'] }, { id: 'track-b', clipIds: [] }],
	clips: [{ id: 'clip-a', timelineStartFrame: 50, durationFrames: 400 }],
};

function edge(frame: number, shiftKey = false, trackId = 'track-a') {
	return resolveTimelineSelectionBoundaryEdge({
		selection, frame, pixelsPerSecond: 1_000, sampleRate: 1_000,
		trackId, selectedTrackIds: new Set(selection.trackIds), shiftKey,
	});
}

test('selection boundary targets match Audacity three-pixel tolerance and left-edge ties', () => {
	assert.equal(SELECTION_BOUNDARY_HIT_WIDTH, 3);
	assert.equal(edge(97), 'start');
	assert.equal(edge(96), null);
	assert.equal(edge(303), 'end');
	assert.equal(edge(304), null);
	assert.equal(edge(200), null);
	assert.equal(edge(200, true), 'start');
	assert.equal(edge(201, true), 'end');
	assert.equal(edge(50, true), 'start');
	assert.equal(edge(500, true), 'end');
});

test('plain boundary editing is available only on selected tracks and excludes point selections', () => {
	assert.equal(edge(100, false, 'track-c'), null);
	assert.equal(edge(100, true, 'track-c'), 'start');
	assert.equal(resolveTimelineSelectionBoundaryEdge({
		selection: { startFrame: 100, endFrame: 100 }, frame: 100,
		pixelsPerSecond: 1_000, sampleRate: 1_000,
		trackId: 'track-a', selectedTrackIds: new Set(['track-a']), shiftKey: false,
	}), null);
});

test('Shift point selection uses the left cursor before the point and the right cursor at or after it', () => {
	const input = {
		selection: { startFrame: 200, endFrame: 200 },
		pixelsPerSecond: 1_000, sampleRate: 1_000,
		trackId: 'track-a', selectedTrackIds: new Set(['track-a']), shiftKey: true,
	};
	assert.equal(resolveTimelineSelectionBoundaryEdge({ ...input, frame: 100 }), 'start');
	assert.equal(resolveTimelineSelectionBoundaryEdge({ ...input, frame: 200 }), 'end');
	assert.equal(resolveTimelineSelectionBoundaryEdge({ ...input, frame: 300 }), 'end');
});

test('selection boundary hit testing scales with zoom and rejects invalid geometry', () => {
	const input = {
		selection, pixelsPerSecond: 100, sampleRate: 1_000,
		trackId: 'track-a', selectedTrackIds: new Set(selection.trackIds), shiftKey: false,
	};
	assert.equal(resolveTimelineSelectionBoundaryEdge({ ...input, frame: 70 }), 'start');
	assert.equal(resolveTimelineSelectionBoundaryEdge({ ...input, frame: 69 }), null);
	assert.equal(resolveTimelineSelectionBoundaryEdge({ ...input, frame: NaN }), null);
	assert.equal(resolveTimelineSelectionBoundaryEdge({ ...input, frame: 100, pixelsPerSecond: 0 }), null);
});

test('editing pins the opposite endpoint, preserves track scope, and crosses or collapses freely', () => {
	const session = createTimelineSelectionBoundaryEdit(selection, 'start', 900, ['track-c']);
	assert.equal(session.anchorFrame, 300);
	assert.deepEqual(session.trackIds, ['track-a', 'track-b']);
	assert.notEqual(session.trackIds, selection.trackIds);
	assert.deepEqual(previewTimelineSelectionBoundaryEdit({
		session, project, rawFrame: 200, currentTrackId: 'track-a', pixelsPerSecond: 1_000, sampleRate: 1_000,
	}).selection, { startFrame: 200, endFrame: 300, trackIds: ['track-a', 'track-b'] });
	const crossed = previewTimelineSelectionBoundaryEdit({
		session, project, rawFrame: 400, currentTrackId: 'track-a', pixelsPerSecond: 1_000, sampleRate: 1_000,
	});
	assert.deepEqual(crossed.selection, { startFrame: 300, endFrame: 400, trackIds: ['track-a', 'track-b'] });
	assert.equal(session.edge, 'start', 'crossing retains the original directional cursor');
	assert.equal(previewTimelineSelectionBoundaryEdit({
		session, project, rawFrame: 300, currentTrackId: 'track-a', pixelsPerSecond: 1_000, sampleRate: 1_000,
	}).selection.endFrame, 300);
});

test('Shift editing without a range starts at the independent playhead on the pointed track', () => {
	const session = createTimelineSelectionBoundaryEdit({ startFrame: 0, endFrame: 0 }, 'start', 200, ['track-b']);
	assert.equal(session.anchorFrame, 200);
	assert.deepEqual(session.trackIds, ['track-b']);
	assert.deepEqual(previewTimelineSelectionBoundaryEdit({
		session, project, rawFrame: 100, currentTrackId: 'track-b', pixelsPerSecond: 1_000, sampleRate: 1_000,
	}).selection, { startFrame: 100, endFrame: 200, trackIds: ['track-b'] });
});

test('boundary editing snaps only the moving endpoint and keeps the exact pinned anchor', () => {
	const session = createTimelineSelectionBoundaryEdit({ ...selection, startFrame: 103 }, 'end', 0);
	const result = previewTimelineSelectionBoundaryEdit({
		session, project: { ...project, snap: { enabled: true, unit: 'centiseconds', mode: 'nearest' } },
		rawFrame: 327, currentTrackId: 'track-a', pixelsPerSecond: 1_000, sampleRate: 1_000,
	});
	assert.deepEqual(result.selection, { startFrame: 103, endFrame: 330, trackIds: ['track-a', 'track-b'] });
	assert.deepEqual(result.guideFrames, []);
	const itemSnap = previewTimelineSelectionBoundaryEdit({
		session, project, rawFrame: 448, currentTrackId: 'track-a', pixelsPerSecond: 1_000, sampleRate: 1_000,
	});
	assert.equal(itemSnap.selection.endFrame, 450);
	assert.deepEqual(itemSnap.guideFrames, [450]);
});
