/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoundarySnapIndex, resolveBoundarySnap, resolveClipMoveBoundarySnap } from '../src/common/editor/ui/timeline/boundary-snap.ts';

void test('indexed snapping never revisits track membership or loop metadata', () => {
	let memberships = 0;
	let loopReads = 0;
	const clips = Array.from({ length: 10_000 }, (_, ordinal) => ({
		id: `clip-${ordinal}`, kind: 'audio', timelineStartFrame: ordinal * 1_000, durationFrames: 500,
		get opaqueExtensions() { loopReads += 1; return {}; },
	}));
	const ids = clips.map(({ id }) => id);
	const project = { clips, tracks: [{ id: 'track', get clipIds() { memberships += 1; return ids; } }] };
	const index = createBoundarySnapIndex(project);
	memberships = 0;
	loopReads = 0;
	assert.deepEqual(resolveBoundarySnap({ project, index, frame: 2_003, currentTrackId: 'track',
		pixelsPerSecond: 1_000, sampleRate: 1_000 }), { frame: 2_000, snapped: true });
	assert.equal(memberships, 0);
	assert.equal(loopReads, 0);
});

void test('loop snapping keeps offset, internal-only boundaries, exclusions and refreshed snapshots', () => {
	const clip = { id: 'loop', kind: 'audio', timelineStartFrame: 100, durationFrames: 350,
		opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 100, offsetFrames: 20 } } };
	const project = { clips: [clip], tracks: [{ id: 'track', clipIds: [clip.id] }] };
	const index = createBoundarySnapIndex(project);
	const input = { project, index, currentTrackId: 'track', pixelsPerSecond: 1_000, sampleRate: 1_000 };
	assert.deepEqual(resolveBoundarySnap({ ...input, frame: 182 }), { frame: 180, snapped: true });
	assert.deepEqual(resolveBoundarySnap({ ...input, frame: 82 }), { frame: 82, snapped: false });
	assert.deepEqual(resolveBoundarySnap({ ...input, frame: 482 }), { frame: 482, snapped: false });
	assert.deepEqual(resolveBoundarySnap({ ...input, frame: 182, excludedClipIds: ['loop'] }), { frame: 182, snapped: false });
	const updated = { ...project, clips: [{ ...clip, timelineStartFrame: 200 }] };
	assert.deepEqual(resolveBoundarySnap({ ...input, project: updated, frame: 282 }), { frame: 280, snapped: true });
});

void test('microfade candidate and collision queries do not reread distant track geometry', () => {
	let geometryReads = 0;
	const clips = Array.from({ length: 10_000 }, (_, ordinal) => ({
		id: `clip-${ordinal}`, kind: 'audio',
		get timelineStartFrame() { geometryReads += 1; return 1_000 + ordinal * 1_000; },
		get durationFrames() { geometryReads += 1; return 100; },
	}));
	const moving = { id: 'moving', kind: 'audio', timelineStartFrame: 0, durationFrames: 100 };
	const project = { clips: [moving, ...clips], tracks: [{ id: 'track', clipIds: ['moving', ...clips.map(({ id }) => id)] }] };
	const movingClipIds = ['moving'];
	const index = createBoundarySnapIndex(project, movingClipIds);
	geometryReads = 0;
	assert.deepEqual(resolveClipMoveBoundarySnap({ project, index, clipId: moving.id, movingClipIds,
		rawStartFrame: 901, currentTrackId: 'track', destinationTrackId: 'track', pixelsPerSecond: 1_000,
		sampleRate: 1_000, preferRightEdge: true, microfadeNewClips: true }), { startFrame: 902, guideFrame: 1_000 });
	assert.ok(geometryReads < 10, `only the touching neighbor should be read, received ${geometryReads}`);
});
