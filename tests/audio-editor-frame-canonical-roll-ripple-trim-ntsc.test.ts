/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { planFrameCanonicalRollRippleTrim } from '../src/common/editor/frame-canonical-roll-ripple-trim-planner.ts';
import { projectV10ForCommand } from '../src/common/editor/project-v10-command-projection.ts';
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV15 } from '../src/common/editor/project-v15.ts';
import { brandRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';

const SAMPLE_RATE = 48_000;
const NTSC = Object.freeze({ num: 30_000, den: 1_001 });

test('left ripple anchors linked NTSC presentation from canonical final endpoints', () => {
	const project = linkedNtscProject();
	const plan = planFrameCanonicalRollRippleTrim(project, {
		mode: 'ripple',
		activeClipId: 'active-video',
		edge: 'left',
		requestedBoundarySample: boundary(1),
	});

	assert.equal(plan.kind, 'transform');
	assert.equal(plan.sequenceFrameDelta, 1);
	assert.equal(plan.programFrameDelta, -1);
	assert.equal(plan.resolvedProgramSampleDelta, -boundary(1));
	assert.equal(boundary(2) - boundary(1), 1_601);
	assert.equal(boundary(1) - boundary(0), 1_602);
	assert.deepEqual(plan.previews.map((preview) => [
		preview.clipId,
		preview.timelineStartFrame,
		preview.durationFrames,
	]), [
		['active-video', boundary(0), boundary(1) - boundary(0)],
		['active-audio', boundary(0), boundary(1) - boundary(0)],
		['suffix-video', boundary(1), boundary(3) - boundary(1)],
		['suffix-audio', boundary(1), boundary(3) - boundary(1)],
	]);
	assert.deepEqual(plan.previews.map(({ sourceStartFrame, sourceDurationFrames }) => (
		[sourceStartFrame, sourceDurationFrames]
	)), [
		[101, 1],
		[10_000 + boundary(1), boundary(2) - boundary(1)],
		[300, 2],
		[30_000, boundary(4) - boundary(2)],
	]);
});

test('roll completes a touching counterpart when same-side group closure reaches another lane', () => {
	const project = groupedRollProject();
	const plan = planFrameCanonicalRollRippleTrim(project, {
		mode: 'roll',
		activeClipId: 'left-a',
		edge: 'right',
		requestedBoundarySample: palBoundary(11),
	});

	assert.equal(plan.kind, 'transform');
	assert.deepEqual(plan.edgeClipIds, ['left-a', 'left-b']);
	assert.deepEqual(plan.neighborClipIds, ['right-a', 'right-b']);
	assert.deepEqual(plan.transforms.map(({ clipId }) => clipId), [
		'left-a', 'right-a', 'left-b', 'right-b',
	]);
	assert.deepEqual(plan.previews.map((preview) => [
		preview.clipId,
		preview.timelineStartFrame,
		preview.timelineStartFrame + preview.durationFrames,
	]), [
		['left-a', palBoundary(0), palBoundary(11)],
		['right-a', palBoundary(11), palBoundary(20)],
		['left-b', palBoundary(0), palBoundary(11)],
		['right-b', palBoundary(11), palBoundary(20)],
	]);
});

test('both roll handles and both ripple edges accept positive and negative frame deltas', () => {
	const project = groupedRollProject({ origin: 10 });
	for (const row of [
		{ mode: 'roll' as const, activeClipId: 'left-a', edge: 'right' as const, sign: 1 },
		{ mode: 'roll' as const, activeClipId: 'left-a', edge: 'right' as const, sign: -1 },
		{ mode: 'roll' as const, activeClipId: 'right-a', edge: 'left' as const, sign: 1 },
		{ mode: 'roll' as const, activeClipId: 'right-a', edge: 'left' as const, sign: -1 },
		{ mode: 'ripple' as const, activeClipId: 'left-a', edge: 'right' as const, sign: 1 },
		{ mode: 'ripple' as const, activeClipId: 'left-a', edge: 'right' as const, sign: -1 },
		{ mode: 'ripple' as const, activeClipId: 'left-a', edge: 'left' as const, sign: 1 },
		{ mode: 'ripple' as const, activeClipId: 'left-a', edge: 'left' as const, sign: -1 },
	]) {
		const originalFrame = row.activeClipId === 'right-a'
			? 20
			: row.edge === 'left' ? 10 : 20;
		const plan = planFrameCanonicalRollRippleTrim(project, {
			mode: row.mode,
			activeClipId: row.activeClipId,
			edge: row.edge,
			requestedBoundarySample: palBoundary(originalFrame + row.sign),
		});
		assert.equal(plan.kind, 'transform', `${row.mode} ${row.edge} ${row.sign}`);
		assert.equal(plan.sequenceFrameDelta, row.sign, `${row.mode} ${row.edge} ${row.sign}`);
		assert.equal(
			plan.programFrameDelta,
			row.mode === 'roll' ? 0 : row.edge === 'right' ? row.sign : -row.sign,
			`${row.mode} ${row.edge} ${row.sign}`,
		);
	}
});

test('zero and extreme requests finish structural preflight before bounded clamping', () => {
	const project = groupedRollProject();
	const noop = planFrameCanonicalRollRippleTrim(project, {
		mode: 'ripple', activeClipId: 'left-a', edge: 'right',
		requestedBoundarySample: palBoundary(10),
	});
	assert.equal(noop.kind, 'noop');
	assert.deepEqual(noop.edgeClipIds, ['left-a', 'left-b']);
	assert.deepEqual(noop.shiftedClipIds, ['right-a', 'right-b']);
	assert.deepEqual(noop.transforms, []);
	assert.ok(Object.isFrozen(noop));
	assert.ok(Object.isFrozen(noop.transforms));

	for (const requestedBoundarySample of [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
		const clamped = planFrameCanonicalRollRippleTrim(project, {
			mode: 'ripple', activeClipId: 'left-a', edge: 'right', requestedBoundarySample,
		});
		assert.equal(clamped.kind, 'transform');
		assert.equal(clamped.clamped, true);
		assert.equal(Math.sign(clamped.sequenceFrameDelta), Math.sign(requestedBoundarySample));
	}
});

test('a lock on a relation-reached roll lane cannot be weakened by the request', () => {
	const project = groupedRollProject({ lockSecondLane: true });
	assert.throws(() => planFrameCanonicalRollRippleTrim(project, {
		mode: 'roll', activeClipId: 'left-a', edge: 'right',
		requestedBoundarySample: palBoundary(11), isTrackLocked: () => false,
	}), /lock|track-b/iu);
});

test('extreme requests clamp when the canonical sequence origin is near the safe limit', () => {
	const project = nearMaximumSequenceProject();
	for (const row of [
		{ request: -Number.MAX_SAFE_INTEGER, expectedDelta: -9 },
		{ request: Number.MAX_SAFE_INTEGER, expectedDelta: 15 },
	]) {
		const plan = planFrameCanonicalRollRippleTrim(project, {
			mode: 'ripple', activeClipId: 'active-video', edge: 'right',
			requestedBoundarySample: row.request,
		});
		assert.equal(plan.kind, 'transform');
		assert.equal(plan.sequenceFrameDelta, row.expectedDelta);
		assert.equal(plan.clamped, true);
	}
});

test('affected A/V categories require exactly one audio and one video companion', () => {
	const valid = linkedNtscProject() as Readonly<Record<string, unknown>>;
	const clips = valid.clips as readonly Readonly<Record<string, unknown>>[];
	const tracks = valid.tracks as readonly Readonly<Record<string, unknown>>[];
	const activeAudio = clips.find(({ id }) => id === 'active-audio');
	const audioTrack = tracks.find(({ id }) => id === 'audio-track');
	assert.ok(activeAudio && audioTrack);
	const duplicateAudio = { ...activeAudio, id: 'duplicate-active-audio' };
	const duplicateTrack = {
		...audioTrack,
		id: 'duplicate-audio-track',
		clipIds: ['duplicate-active-audio'],
	};
	const duplicate = brandRuntimeProjectProjection({
		...valid,
		clips: [...clips, duplicateAudio],
		tracks: [...tracks, duplicateTrack],
	});
	assert.throws(() => planFrameCanonicalRollRippleTrim(duplicate, {
		mode: 'ripple', activeClipId: 'active-video', edge: 'left',
		requestedBoundarySample: boundary(1),
	}), /A\/V link.*one audio.*one video|exactly one/iu);

	const orphan = brandRuntimeProjectProjection({
		...valid,
		clips: clips.filter(({ id }) => id !== 'active-audio'),
		tracks: tracks.map((track) => track.id === 'audio-track'
			? { ...track, clipIds: ['suffix-audio'] }
			: track),
	});
	assert.throws(() => planFrameCanonicalRollRippleTrim(orphan, {
		mode: 'ripple', activeClipId: 'active-video', edge: 'left',
		requestedBoundarySample: boundary(1),
	}), /A\/V link.*one audio.*one video|exactly one/iu);
});

test('near-safe sequence origins saturate extreme requested deltas before clamping', () => {
	const project = nearSafeOriginProject();
	for (const requestedBoundarySample of [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
		const plan = planFrameCanonicalRollRippleTrim(project, {
			mode: 'ripple', activeClipId: 'active-video', edge: 'right', requestedBoundarySample,
		});
		assert.equal(plan.kind, 'transform');
		assert.equal(plan.clamped, true);
		assert.equal(Math.sign(plan.sequenceFrameDelta), Math.sign(requestedBoundarySample));
	}
});

function linkedNtscProject(): unknown {
	const videoSource = createVideoSourceV10({
		id: 'video-source', frameCount: 200_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: NTSC, sourceFrameCount: 1_000,
	}, SAMPLE_RATE);
	const audioSource = createAudioSourceV10({
		id: 'audio-source', frameCount: 200_000, sampleRate: SAMPLE_RATE, channelCount: 1,
	});
	const activeVideo = createVideoClipV10({
		id: 'active-video', sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame: 0, sequenceFrameCount: 2,
		sourceInFrame: 100, sourceFrameCount: 2, avLinkId: 'active-link',
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: NTSC }, source: videoSource });
	const suffixVideo = createVideoClipV10({
		id: 'suffix-video', sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame: 2, sequenceFrameCount: 2,
		sourceInFrame: 300, sourceFrameCount: 2, avLinkId: 'suffix-link',
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: NTSC }, source: videoSource });
	const activeAudio = createAudioClipV10({
		id: 'active-audio', sourceId: 'audio-source', avLinkId: 'active-link',
		timelineStartFrame: boundary(0), durationFrames: boundary(2) - boundary(0),
		sourceStartFrame: 10_000, sourceDurationFrames: boundary(2) - boundary(0),
	});
	const suffixAudio = createAudioClipV10({
		id: 'suffix-audio', sourceId: 'audio-source', avLinkId: 'suffix-link',
		timelineStartFrame: boundary(2), durationFrames: boundary(4) - boundary(2),
		sourceStartFrame: 30_000, sourceDurationFrames: boundary(4) - boundary(2),
	});
	const tracks = [
		createVideoTrackV10({
			id: 'video-track', clipIds: ['active-video', 'suffix-video'],
			laneGroupId: 'linked-lanes', locked: false,
		}),
		createAudioTrackV10({
			id: 'audio-track', clipIds: ['active-audio', 'suffix-audio'],
			laneGroupId: 'linked-lanes', locked: false,
		}, SAMPLE_RATE),
	];
	const project = createAudioEditorProjectV15({
		id: 'left-ripple-ntsc', now: '2026-08-11T18:00:00.000Z', sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: NTSC, trackIds: tracks.map(({ id }) => String(id)) }],
		primarySequenceId: 'main', sources: [videoSource, audioSource],
		clips: [activeVideo, activeAudio, suffixVideo, suffixAudio], tracks,
	});
	return projectV10ForCommand(project as unknown as Record<string, unknown>);
}

function nearSafeOriginProject(): unknown {
	const rate = Object.freeze({ num: SAMPLE_RATE, den: 1 });
	const origin = Number.MAX_SAFE_INTEGER - 30;
	const source = createVideoSourceV10({
		id: 'near-safe-source', frameCount: 2_000_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: rate, sourceFrameCount: 1_000,
	}, SAMPLE_RATE);
	const clip = (
		id: string,
		sequenceStartFrame: number,
		sequenceFrameCount: number,
		sourceInFrame: number,
	) => createVideoClipV10({
		id, sourceId: 'near-safe-source', sequenceId: 'main',
		sequenceStartFrame, sequenceFrameCount,
		sourceInFrame, sourceFrameCount: sequenceFrameCount,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate }, source });
	const clips = [
		clip('active-video', origin, 10, 100),
		clip('suffix-video', origin + 10, 5, 300),
	];
	const track = createVideoTrackV10({
		id: 'video-track', clipIds: clips.map(({ id }) => String(id)), locked: false,
	});
	const project = createAudioEditorProjectV15({
		id: 'near-safe-roll-ripple', now: '2026-08-11T19:00:00.000Z', sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate, trackIds: ['video-track'] }],
		primarySequenceId: 'main', sources: [source], clips, tracks: [track],
	});
	return projectV10ForCommand(project as unknown as Record<string, unknown>);
}

function groupedRollProject(options: Readonly<{
	lockSecondLane?: boolean;
	origin?: number;
}> = {}): unknown {
	const rate = Object.freeze({ num: 24, den: 1 });
	const origin = options.origin ?? 0;
	const source = createVideoSourceV10({
		id: 'video-source', frameCount: 2_000_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: rate, sourceFrameCount: 1_000,
	}, SAMPLE_RATE);
	const clip = (
		id: string,
		sequenceStartFrame: number,
		sourceInFrame: number,
		groupId: string | null = null,
	) => createVideoClipV10({
		id, sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame, sequenceFrameCount: 10,
		sourceInFrame, sourceFrameCount: 10, groupId,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate }, source });
	const clips = [
		clip('left-a', origin, 100, 'left-group'),
		clip('right-a', origin + 10, 200),
		clip('left-b', origin, 300, 'left-group'),
		clip('right-b', origin + 10, 400),
	];
	const tracks = [
		createVideoTrackV10({ id: 'track-a', clipIds: ['left-a', 'right-a'], locked: false }),
		createVideoTrackV10({
			id: 'track-b', clipIds: ['left-b', 'right-b'],
			locked: options.lockSecondLane === true,
		}),
	];
	const project = createAudioEditorProjectV15({
		id: 'grouped-roll', now: '2026-08-11T18:00:00.000Z', sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate, trackIds: tracks.map(({ id }) => String(id)) }],
		primarySequenceId: 'main', sources: [source], clips, tracks,
	});
	return projectV10ForCommand(project as unknown as Record<string, unknown>);
}

function nearMaximumSequenceProject(): unknown {
	const rate = Object.freeze({ num: SAMPLE_RATE, den: 1 });
	const origin = Number.MAX_SAFE_INTEGER - 30;
	const source = createVideoSourceV10({
		id: 'video-source', frameCount: 10_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: rate, sourceFrameCount: 1_000,
	}, SAMPLE_RATE);
	const clip = (
		id: string,
		sequenceStartFrame: number,
		sequenceFrameCount: number,
		sourceInFrame: number,
	) => createVideoClipV10({
		id, sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame, sequenceFrameCount,
		sourceInFrame, sourceFrameCount: sequenceFrameCount,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate }, source });
	const clips = [
		clip('active-video', origin, 10, 100),
		clip('suffix-video', origin + 10, 5, 300),
	];
	const track = createVideoTrackV10({
		id: 'video-track', clipIds: ['active-video', 'suffix-video'], locked: false,
	});
	const project = createAudioEditorProjectV15({
		id: 'near-maximum-sequence', now: '2026-08-11T18:00:00.000Z', sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate, trackIds: ['video-track'] }],
		primarySequenceId: 'main', sources: [source], clips, tracks: [track],
	});
	return projectV10ForCommand(project as unknown as Record<string, unknown>);
}

function boundary(frame: number): number {
	return videoFrameToSampleFrame(frame, NTSC, SAMPLE_RATE, 'point');
}

function palBoundary(frame: number): number {
	return videoFrameToSampleFrame(frame, { num: 24, den: 1 }, SAMPLE_RATE, 'point');
}
