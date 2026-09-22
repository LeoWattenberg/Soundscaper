/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createBoundarySnapIndex,
	resolveBoundarySnap,
	resolveClipMoveBoundarySnap,
} from '../src/common/editor/ui/timeline/boundary-snap.ts';

const sampleRate = 1_000;
const pixelsPerSecond = 1_000;

function project(clips: ReadonlyArray<{ id: string; trackId: string; start: number; duration: number; kind?: string }>) {
	return {
		tracks: [...new Set(clips.map(({ trackId }) => trackId))].map((id) => ({
			id, clipIds: clips.filter((clip) => clip.trackId === id).map(({ id: clipId }) => clipId),
		})),
		clips: clips.map(({ id, start, duration, kind = 'audio' }) => ({ id, kind, timelineStartFrame: start, durationFrames: duration })),
	};
}

test('boundary snapping is within four rounded pixels and includes both clip edges', () => {
	const content = project([{ id: 'a', trackId: 'upper', start: 100, duration: 200 }]);
	assert.deepEqual(resolveBoundarySnap({ project: content, frame: 103, currentTrackId: 'lower',
		pixelsPerSecond, sampleRate }), { frame: 100, snapped: true });
	assert.deepEqual(resolveBoundarySnap({ project: content, frame: 297, currentTrackId: 'lower',
		pixelsPerSecond, sampleRate }), { frame: 300, snapped: true });
	assert.deepEqual(resolveBoundarySnap({ project: content, frame: 104, currentTrackId: 'lower',
		pixelsPerSecond, sampleRate }), { frame: 104, snapped: false });
});

test('a sole same-track candidate wins; ambiguous other-track boundaries do not snap', () => {
	const content = project([
		{ id: 'a', trackId: 'upper', start: 100, duration: 100 },
		{ id: 'b', trackId: 'lower', start: 102, duration: 100 },
	]);
	assert.deepEqual(resolveBoundarySnap({ project: content, frame: 101, currentTrackId: 'lower',
		pixelsPerSecond, sampleRate }), { frame: 102, snapped: true });
	assert.deepEqual(resolveBoundarySnap({ project: content, frame: 101, currentTrackId: 'third',
		pixelsPerSecond, sampleRate }), { frame: 101, snapped: false });
});

test('coincident boundaries resolve toward the selected edge', () => {
	const content = project([
		{ id: 'a', trackId: 'upper', start: 100, duration: 100 },
		{ id: 'b', trackId: 'lower', start: 100, duration: 100 },
	]);
	assert.deepEqual(resolveBoundarySnap({ project: content, frame: 101, currentTrackId: 'third',
		pixelsPerSecond, sampleRate, rightEdge: true }), { frame: 100, snapped: true });
});

test('near-coincident high-rate boundaries favor the moving selection edge', () => {
	const content = project([
		{ id: 'a', trackId: 'upper', start: 100, duration: 100 },
		{ id: 'b', trackId: 'lower', start: 101, duration: 100 },
	]);
	const input = { project: content, frame: 100, currentTrackId: 'third',
		pixelsPerSecond: 96_000, sampleRate: 96_000 };
	assert.deepEqual(resolveBoundarySnap(input), { frame: 100, snapped: true });
	assert.deepEqual(resolveBoundarySnap({ ...input, rightEdge: true }), { frame: 101, snapped: true });
});

test('moving clips do not offer their own edges as snap targets', () => {
	const content = project([{ id: 'moving', trackId: 'lower', start: 100, duration: 100 }]);
	assert.deepEqual(resolveBoundarySnap({ project: content, frame: 102, currentTrackId: 'lower',
		pixelsPerSecond, sampleRate, excludedClipIds: ['moving'] }), { frame: 102, snapped: false });
});

test('a cached snap index preserves ambiguity and excluded moving clips without revisiting the project', () => {
	const content = project([
		{ id: 'moving', trackId: 'lower', start: 100, duration: 100 },
		{ id: 'other', trackId: 'upper', start: 102, duration: 100 },
		{ id: 'far', trackId: 'third', start: 600, duration: 100 },
	]);
	const excludedClipIds = ['moving'];
	const index = createBoundarySnapIndex(content, excludedClipIds);
	let reads = 0;
	const observed = { ...content, get clips() { reads++; return content.clips; } };
	const observedIndex = createBoundarySnapIndex(observed, excludedClipIds);
	reads = 0;
	const input = { project: observed, index: observedIndex, frame: 101,
		currentTrackId: 'lower', pixelsPerSecond, sampleRate, excludedClipIds };
	assert.deepEqual(resolveBoundarySnap(input), { frame: 102, snapped: true });
	assert.deepEqual(resolveBoundarySnap({ ...input, frame: 103 }), { frame: 102, snapped: true });
	assert.equal(reads, 0, 'repeated indexed lookups should not scan the project');
	assert.deepEqual(resolveBoundarySnap({ project: content, index, frame: 101,
		currentTrackId: 'lower', pixelsPerSecond, sampleRate }), { frame: 100, snapped: true },
	'exclusions from one gesture must not be applied to another');
});

test('a cached snap index refreshes when the project snapshot changes', () => {
	const original = project([{ id: 'a', trackId: 'upper', start: 100, duration: 100 }]);
	const index = createBoundarySnapIndex(original);
	const updated = project([{ id: 'a', trackId: 'upper', start: 300, duration: 100 }]);
	assert.deepEqual(resolveBoundarySnap({ project: updated, index, frame: 101,
		currentTrackId: 'upper', pixelsPerSecond, sampleRate }), { frame: 101, snapped: false });
	assert.deepEqual(resolveBoundarySnap({ project: updated, index, frame: 301,
		currentTrackId: 'upper', pixelsPerSecond, sampleRate }), { frame: 300, snapped: true });
});

test('cached boundary lookup preserves multiple nearby candidates and selected-edge tie breaking', () => {
	const content = project([
		{ id: 'a', trackId: 'upper', start: 100, duration: 100 },
		{ id: 'b', trackId: 'lower', start: 101, duration: 100 },
		{ id: 'c', trackId: 'third', start: 102, duration: 100 },
	]);
	const index = createBoundarySnapIndex(content);
	const input = { project: content, index, frame: 101, currentTrackId: 'fourth',
		pixelsPerSecond, sampleRate };
	assert.deepEqual(resolveBoundarySnap(input), { frame: 101, snapped: false });
	assert.deepEqual(resolveBoundarySnap({ ...input, currentTrackId: 'lower' }),
		{ frame: 101, snapped: true });
	const coincident = project([
		{ id: 'a', trackId: 'upper', start: 100, duration: 100 },
		{ id: 'b', trackId: 'lower', start: 101, duration: 100 },
	]);
	const coincidentIndex = createBoundarySnapIndex(coincident);
	const coincidentInput = { project: coincident, index: coincidentIndex, frame: 100,
		currentTrackId: 'third', pixelsPerSecond: 96_000, sampleRate: 96_000 };
	assert.deepEqual(resolveBoundarySnap(coincidentInput), { frame: 100, snapped: true });
	assert.deepEqual(resolveBoundarySnap({ ...coincidentInput, rightEdge: true }),
		{ frame: 101, snapped: true });
});

test('label and other non-clip tracks do not interrupt boundary lookup', () => {
	const content = { ...project([{ id: 'a', trackId: 'audio', start: 100, duration: 100 }]),
		tracks: [{ id: 'labels' }, { id: 'audio', clipIds: ['a'] }] };
	assert.deepEqual(resolveBoundarySnap({ project: content, frame: 102, currentTrackId: 'labels',
		pixelsPerSecond, sampleRate }), { frame: 100, snapped: true });
});

test('clip move excludes moving clips and chooses the edge closest to pointer-down', () => {
	const content = project([
		{ id: 'moving', trackId: 'lower', start: 50, duration: 100 },
		{ id: 'other', trackId: 'upper', start: 101, duration: 98 },
	]);
	const input = { project: content, clipId: 'moving', movingClipIds: ['moving'],
		rawStartFrame: 100, currentTrackId: 'lower', pixelsPerSecond, sampleRate };
	assert.deepEqual(resolveClipMoveBoundarySnap({ ...input, preferRightEdge: false }), {
		startFrame: 101, guideFrame: 101,
	});
	assert.deepEqual(resolveClipMoveBoundarySnap({ ...input, preferRightEdge: true }), {
		startFrame: 99, guideFrame: 199,
	});
	const index = createBoundarySnapIndex(content, input.movingClipIds);
	assert.deepEqual(resolveClipMoveBoundarySnap({ ...input, index, preferRightEdge: false }), {
		startFrame: 101, guideFrame: 101,
	});
	assert.deepEqual(resolveClipMoveBoundarySnap({ ...input, index, preferRightEdge: true }), {
		startFrame: 99, guideFrame: 199,
	});
});

test('an already aligned clip edge does not displace a nearby moving edge', () => {
	const content = project([
		{ id: 'moving', trackId: 'lower', start: 50, duration: 100 },
		{ id: 'other', trackId: 'upper', start: 101, duration: 99 },
	]);
	assert.deepEqual(resolveClipMoveBoundarySnap({
		project: content, clipId: 'moving', movingClipIds: ['moving'],
		rawStartFrame: 100, currentTrackId: 'lower', pixelsPerSecond, sampleRate,
		preferRightEdge: true,
	}), { startFrame: 101, guideFrame: 101 });
});

test('an audio clip snaps into a two millisecond overlap at either same-track edge', () => {
	const content = project([
		{ id: 'moving', trackId: 'audio', start: 20, duration: 100 },
		{ id: 'anchor', trackId: 'audio', start: 200, duration: 100 },
	]);
	const input = { project: content, clipId: 'moving', movingClipIds: ['moving'],
		currentTrackId: 'audio', destinationTrackId: 'audio', pixelsPerSecond,
		sampleRate, microfadeNewClips: true };
	assert.deepEqual(resolveClipMoveBoundarySnap({ ...input, rawStartFrame: 101,
		preferRightEdge: true }), { startFrame: 102, guideFrame: 200 });
	assert.deepEqual(resolveClipMoveBoundarySnap({ ...input, rawStartFrame: 301,
		preferRightEdge: false }), { startFrame: 298, guideFrame: 300 });
	assert.deepEqual(resolveClipMoveBoundarySnap({ ...input, rawStartFrame: 100,
		preferRightEdge: true }), { startFrame: 102, guideFrame: 200 });
	assert.deepEqual(resolveClipMoveBoundarySnap({ ...input, rawStartFrame: 101,
		preferRightEdge: true, microfadeNewClips: false }), { startFrame: 100, guideFrame: 200 });
});

test('the microfade overlap requires a single audio clip and an audio neighbor on its destination track', () => {
	const content = project([
		{ id: 'moving', trackId: 'audio', start: 20, duration: 100 },
		{ id: 'anchor', trackId: 'other', start: 200, duration: 100 },
	]);
	const input = { project: content, clipId: 'moving', movingClipIds: ['moving'],
		currentTrackId: 'audio', destinationTrackId: 'audio', pixelsPerSecond,
		sampleRate, microfadeNewClips: true, rawStartFrame: 101, preferRightEdge: true };
	assert.deepEqual(resolveClipMoveBoundarySnap(input), { startFrame: 100, guideFrame: 200 });
	assert.deepEqual(resolveClipMoveBoundarySnap({ ...input, destinationTrackId: 'other' }), {
		startFrame: 102, guideFrame: 200,
	});
	assert.deepEqual(resolveClipMoveBoundarySnap({ ...input, destinationTrackId: 'other',
		movingClipIds: ['moving', 'another'] }), { startFrame: 100, guideFrame: 200 });
	const video = project([
		{ id: 'moving', trackId: 'audio', start: 20, duration: 100 },
		{ id: 'anchor', trackId: 'audio', start: 200, duration: 100, kind: 'video' },
	]);
	assert.deepEqual(resolveClipMoveBoundarySnap({ ...input, project: video }), {
		startFrame: 100, guideFrame: 200,
	});
});
