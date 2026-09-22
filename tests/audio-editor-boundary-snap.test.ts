/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveBoundarySnap,
	resolveClipMoveBoundarySnap,
} from '../src/common/editor/ui/timeline/boundary-snap.ts';

const sampleRate = 1_000;
const pixelsPerSecond = 1_000;

function project(clips: ReadonlyArray<{ id: string; trackId: string; start: number; duration: number }>) {
	return {
		tracks: [...new Set(clips.map(({ trackId }) => trackId))].map((id) => ({
			id, clipIds: clips.filter((clip) => clip.trackId === id).map(({ id: clipId }) => clipId),
		})),
		clips: clips.map(({ id, start, duration }) => ({ id, timelineStartFrame: start, durationFrames: duration })),
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
