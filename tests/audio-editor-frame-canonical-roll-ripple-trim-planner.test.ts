/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	planFrameCanonicalRollRippleTrim,
} from '../src/common/editor/frame-canonical-roll-ripple-trim-planner.ts';
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
import {
	videoFrameToSampleFrame,
	type RationalRate,
} from '../src/common/editor/timeline-time.ts';

const SAMPLE_RATE = 48_000;
const PAL = Object.freeze({ num: 24, den: 1 });
const NTSC = Object.freeze({ num: 30_000, den: 1_001 });

interface CommandClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
}

interface CommandTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly locked: boolean;
}

interface CommandProject extends Readonly<Record<string, unknown>> {
	readonly clips: readonly CommandClip[];
	readonly tracks: readonly CommandTrack[];
}

test('roll classifies a selected touching NTSC neighbor and preserves both outer endpoints', () => {
	const project = videoFixture({ rate: NTSC, selectedClipIds: ['active-video', 'suffix-video'] });
	const plan = planFrameCanonicalRollRippleTrim(project, {
		mode: 'roll',
		activeClipId: 'active-video',
		edge: 'right',
		requestedBoundarySample: boundary(11, NTSC),
	});

	assert.equal(plan.kind, 'transform');
	assert.deepEqual(diagnostics(plan), {
		mode: 'roll',
		edge: 'right',
		sequenceId: 'main',
		requestedSequenceFrame: 11,
		appliedSequenceFrame: 11,
		sequenceFrameDelta: 1,
		programFrameDelta: 0,
		resolvedProgramSampleDelta: 0,
		resolvedSourceCutSample: boundary(11, NTSC),
		programEditSample: boundary(11, NTSC),
		clamped: false,
	});
	assert.deepEqual(plan.edgeClipIds, ['active-video']);
	assert.deepEqual(plan.neighborClipIds, ['suffix-video']);
	assert.deepEqual(plan.shiftedClipIds, []);
	assert.deepEqual(plan.transforms.map(({ clipId }) => clipId), [
		'active-video', 'suffix-video',
	]);
	assert.deepEqual(plan.previews.map(previewRange), [
		[boundary(0, NTSC), boundary(11, NTSC), 100, 111],
		[boundary(11, NTSC), boundary(20, NTSC), 201, 210],
	]);
});

test('right ripple extends the edge and shifts the deterministic lane suffix by d', () => {
	const project = videoFixture();
	const plan = planFrameCanonicalRollRippleTrim(project, {
		mode: 'ripple',
		activeClipId: 'active-video',
		edge: 'right',
		requestedBoundarySample: boundary(22, PAL),
	});

	assert.equal(plan.kind, 'transform');
	assert.equal(plan.sequenceFrameDelta, 2);
	assert.equal(plan.programFrameDelta, 2);
	assert.equal(plan.resolvedProgramSampleDelta, boundary(22, PAL) - boundary(20, PAL));
	assert.equal(plan.resolvedSourceCutSample, boundary(22, PAL));
	assert.equal(plan.programEditSample, boundary(22, PAL));
	assert.deepEqual(plan.edgeClipIds, ['active-video']);
	assert.deepEqual(plan.neighborClipIds, []);
	assert.deepEqual(plan.shiftedClipIds, ['suffix-video']);
	assert.deepEqual(plan.previews.map(previewRange), [
		[boundary(10, PAL), boundary(22, PAL), 100, 112],
		[boundary(22, PAL), boundary(27, PAL), 300, 305],
	]);
	const shifted = plan.transforms.find(({ clipId }) => clipId === 'suffix-video');
	assert.ok(shifted);
	assert.equal(Object.hasOwn(shifted.changes, 'sourceStartFrame'), false);
	assert.equal(Object.hasOwn(shifted.changes, 'sourceDurationFrames'), false);
});

test('left ripple maps the source cut once but keeps the final placement anchored', () => {
	const project = videoFixture();
	const plan = planFrameCanonicalRollRippleTrim(project, {
		mode: 'ripple',
		activeClipId: 'active-video',
		edge: 'left',
		requestedBoundarySample: boundary(12, PAL),
	});

	assert.equal(plan.kind, 'transform');
	assert.equal(plan.requestedSequenceFrame, 12);
	assert.equal(plan.appliedSequenceFrame, 12);
	assert.equal(plan.sequenceFrameDelta, 2);
	assert.equal(plan.programFrameDelta, -2);
	assert.equal(plan.resolvedProgramSampleDelta, boundary(10, PAL) - boundary(12, PAL));
	assert.equal(plan.resolvedSourceCutSample, boundary(12, PAL));
	assert.equal(plan.programEditSample, boundary(18, PAL));
	assert.deepEqual(plan.edgeClipIds, ['active-video']);
	assert.deepEqual(plan.shiftedClipIds, ['suffix-video']);
	assert.deepEqual(plan.previews.map(previewRange), [
		[boundary(10, PAL), boundary(18, PAL), 102, 110],
		[boundary(18, PAL), boundary(23, PAL), 300, 305],
	]);
});

test('linked NTSC audio follows its own video phase during a ripple suffix shift', () => {
	const project = linkedNtscFixture();
	const plan = planFrameCanonicalRollRippleTrim(project, {
		mode: 'ripple',
		activeClipId: 'active-video',
		edge: 'right',
		requestedBoundarySample: boundary(2, NTSC),
	});

	assert.equal(plan.kind, 'transform');
	assert.equal(plan.sequenceFrameDelta, 1);
	assert.equal(plan.resolvedProgramSampleDelta, 1_601);
	assert.equal(boundary(2, NTSC) - boundary(1, NTSC), 1_601);
	assert.equal(boundary(3, NTSC) - boundary(2, NTSC), 1_602);
	assert.deepEqual(plan.edgeClipIds, ['active-video', 'active-audio']);
	assert.deepEqual(plan.shiftedClipIds, ['suffix-video', 'suffix-audio']);
	assert.deepEqual(plan.previews.map(previewRange), [
		[boundary(0, NTSC), boundary(2, NTSC), 100, 102],
		[boundary(0, NTSC), boundary(2, NTSC), 10_000, 10_000 + boundary(2, NTSC)],
		[boundary(3, NTSC), boundary(5, NTSC), 300, 302],
		[boundary(3, NTSC), boundary(5, NTSC), 30_000, 30_000 + boundary(2, NTSC)],
	]);
});

test('left ripple uses a separate suffix cut for same-edge lanes with unequal durations', () => {
	const project = unequalLeftRippleFixture();
	const plan = planFrameCanonicalRollRippleTrim(project, {
		mode: 'ripple',
		activeClipId: 'active-a',
		edge: 'left',
		requestedBoundarySample: boundary(12, PAL),
	});

	assert.equal(plan.kind, 'transform');
	assert.equal(plan.sequenceFrameDelta, 2);
	assert.equal(plan.programFrameDelta, -2);
	assert.deepEqual(plan.edgeClipIds, ['active-a', 'active-b']);
	assert.deepEqual(plan.shiftedClipIds, ['suffix-a', 'suffix-b']);
	assert.deepEqual(plan.previews.map((preview) => [preview.clipId, ...previewRange(preview)]), [
		['active-a', boundary(10, PAL), boundary(18, PAL), 102, 110],
		['suffix-a', boundary(18, PAL), boundary(23, PAL), 300, 305],
		['active-b', boundary(10, PAL), boundary(23, PAL), 502, 515],
		['suffix-b', boundary(23, PAL), boundary(28, PAL), 700, 705],
	]);
});

test('plans are deeply frozen and repeated planning never mutates the V15 command projection', () => {
	const project = videoFixture();
	const before = JSON.stringify(project);
	const first = planFrameCanonicalRollRippleTrim(project, {
		mode: 'ripple', activeClipId: 'active-video', edge: 'right',
		requestedBoundarySample: boundary(22, PAL),
	});
	const second = planFrameCanonicalRollRippleTrim(project, {
		mode: 'ripple', activeClipId: 'active-video', edge: 'right',
		requestedBoundarySample: boundary(22, PAL),
	});

	assert.deepEqual(first, second);
	assert.equal(JSON.stringify(project), before);
	assertFrozenPlan(first);
	assert.ok(first.transforms.every(({ changes }) => Object.isFrozen(changes)));
});

test('persisted V15 locks refuse affected work even when a caller predicate tries to weaken them', () => {
	const project = videoFixture({ locked: true });
	assert.equal(project.schemaVersion, 15);
	assert.deepEqual(project.tracks.map(({ locked }) => locked), [true]);

	assert.throws(() => planFrameCanonicalRollRippleTrim(project, {
		mode: 'ripple',
		activeClipId: 'active-video',
		edge: 'right',
		requestedBoundarySample: boundary(22, PAL),
		isTrackLocked: () => false,
	}), /lock|video-track/iu);
});

test('roll refuses a gap instead of guessing an adjoining clip', () => {
	const project = videoFixture({ suffixStart: 21 });
	assert.throws(() => planFrameCanonicalRollRippleTrim(project, {
		mode: 'roll',
		activeClipId: 'active-video',
		edge: 'right',
		requestedBoundarySample: boundary(11, PAL),
	}), /adjacent|gap|touch/iu);
});

test('ripple refuses a relation-expanded suffix that crosses sequence rates', () => {
	const project = mixedSequenceSuffixFixture();
	assert.throws(() => planFrameCanonicalRollRippleTrim(project, {
		mode: 'ripple',
		activeClipId: 'active-video',
		edge: 'right',
		requestedBoundarySample: boundary(22, PAL),
	}), /rate|sequence/iu);
});

test('a related unseeded lane expands its whole suffix from the initial-lane fallback cut', () => {
	const project = relationSuffixFixture();
	const plan = planFrameCanonicalRollRippleTrim(project, {
		mode: 'ripple',
		activeClipId: 'active-video',
		edge: 'right',
		requestedBoundarySample: boundary(22, PAL),
	});

	assert.equal(plan.kind, 'transform');
	assert.deepEqual(plan.shiftedClipIds, [
		'main-suffix', 'peer-earliest', 'relation-peer', 'peer-later',
	]);
	assert.deepEqual(plan.previews.map((preview) => [
		preview.clipId,
		preview.timelineStartFrame,
		preview.timelineStartFrame + preview.durationFrames,
	]), [
		['active-video', boundary(10, PAL), boundary(22, PAL)],
		['main-suffix', boundary(22, PAL), boundary(27, PAL)],
		['peer-earliest', boundary(23, PAL), boundary(24, PAL)],
		['relation-peer', boundary(24, PAL), boundary(26, PAL)],
		['peer-later', boundary(27, PAL), boundary(32, PAL)],
	]);
});

test('relation peers before the fallback and clips straddling it refuse atomically', () => {
	for (const row of [
		{ name: 'peer before fallback', project: relationSuffixFixture({ peerStart: 18 }) },
		{ name: 'straddling clip', project: relationSuffixFixture({ straddler: true }) },
	]) {
		assert.throws(() => planFrameCanonicalRollRippleTrim(row.project, {
			mode: 'ripple',
			activeClipId: 'active-video',
			edge: 'right',
			requestedBoundarySample: boundary(22, PAL),
		}), /cut|relation|stationary|straddl|suffix/iu, row.name);
	}
});

function videoFixture(options: Readonly<{
	rate?: RationalRate;
	locked?: boolean;
	suffixStart?: number;
	selectedClipIds?: readonly string[];
}> = {}): CommandProject {
	const rate = options.rate ?? PAL;
	const source = videoSource(rate);
	const suffixStart = options.suffixStart ?? 20;
	const clips = [
		videoClip(source, rate, 'active-video', 10, 10, 100),
		videoClip(source, rate, 'suffix-video', suffixStart, 5, 300),
	];
	if (rate === NTSC) {
		clips[0] = videoClip(source, rate, 'active-video', 0, 10, 100);
		clips[1] = videoClip(source, rate, 'suffix-video', 10, 10, 200);
	}
	const track = createVideoTrackV10({
		id: 'video-track',
		clipIds: clips.map(({ id }) => String(id)),
		locked: options.locked ?? false,
	});
	return commandProject({
		rate, sources: [source], clips, tracks: [track],
		selectedClipIds: options.selectedClipIds,
	});
}

function linkedNtscFixture(): CommandProject {
	const video = videoSource(NTSC);
	const audio = createAudioSourceV10({
		id: 'audio-source', frameCount: 200_000, sampleRate: SAMPLE_RATE, channelCount: 1,
	});
	const activeVideo = videoClip(video, NTSC, 'active-video', 0, 1, 100, 'active-link');
	const suffixVideo = videoClip(video, NTSC, 'suffix-video', 2, 2, 300, 'suffix-link');
	const activeAudio = createAudioClipV10({
		id: 'active-audio', sourceId: 'audio-source', avLinkId: 'active-link',
		timelineStartFrame: boundary(0, NTSC),
		durationFrames: boundary(1, NTSC),
		sourceStartFrame: 10_000,
		sourceDurationFrames: boundary(1, NTSC),
	});
	const suffixAudio = createAudioClipV10({
		id: 'suffix-audio', sourceId: 'audio-source', avLinkId: 'suffix-link',
		timelineStartFrame: boundary(2, NTSC),
		durationFrames: boundary(4, NTSC) - boundary(2, NTSC),
		sourceStartFrame: 30_000,
		sourceDurationFrames: boundary(4, NTSC) - boundary(2, NTSC),
	});
	const tracks = [
		createVideoTrackV10({
			id: 'video-track', clipIds: ['active-video', 'suffix-video'],
			locked: false, laneGroupId: 'linked-lanes',
		}),
		createAudioTrackV10({
			id: 'audio-track', clipIds: ['active-audio', 'suffix-audio'],
			locked: false, laneGroupId: 'linked-lanes',
		}, SAMPLE_RATE),
	];
	return commandProject({
		rate: NTSC,
		sources: [video, audio],
		clips: [activeVideo, activeAudio, suffixVideo, suffixAudio],
		tracks,
	});
}

function unequalLeftRippleFixture(): CommandProject {
	const source = videoSource(PAL);
	const clips = [
		{ ...videoClip(source, PAL, 'active-a', 10, 10, 100), groupId: 'edge-group' },
		videoClip(source, PAL, 'suffix-a', 20, 5, 300),
		{ ...videoClip(source, PAL, 'active-b', 10, 15, 500), groupId: 'edge-group' },
		videoClip(source, PAL, 'suffix-b', 25, 5, 700),
	];
	const tracks = [
		createVideoTrackV10({ id: 'track-a', clipIds: ['active-a', 'suffix-a'], locked: false }),
		createVideoTrackV10({ id: 'track-b', clipIds: ['active-b', 'suffix-b'], locked: false }),
	];
	return commandProject({ rate: PAL, sources: [source], clips, tracks });
}

function mixedSequenceSuffixFixture(): CommandProject {
	const source = videoSource(PAL);
	const clips = [
		videoClip(source, PAL, 'active-video', 10, 10, 100),
		{ ...videoClip(source, PAL, 'suffix-video', 20, 5, 300), groupId: 'suffix-group' },
		{ ...videoClip(source, NTSC, 'other-video', 20, 5, 500),
			sequenceId: 'other', groupId: 'suffix-group' },
	];
	const tracks = [
		createVideoTrackV10({
			id: 'main-track', clipIds: ['active-video', 'suffix-video'], locked: false,
		}),
		createVideoTrackV10({ id: 'other-track', clipIds: ['other-video'], locked: false }),
	];
	const project = createAudioEditorProjectV15({
		id: 'mixed-suffix-rate', now: '2026-08-11T16:00:00.000Z', sampleRate: SAMPLE_RATE,
		sequences: [
			{ id: 'main', rate: PAL, trackIds: ['main-track'] },
			{ id: 'other', rate: NTSC, trackIds: ['other-track'] },
		],
		primarySequenceId: 'main', sources: [source], clips, tracks,
	});
	return projectV10ForCommand(
		project as unknown as Record<string, unknown>,
	) as unknown as CommandProject;
}

function relationSuffixFixture(options: Readonly<{
	peerStart?: number;
	straddler?: boolean;
}> = {}): CommandProject {
	const source = videoSource(PAL);
	const peerStart = options.peerStart ?? 22;
	const clips = [
		videoClip(source, PAL, 'active-video', 10, 10, 100),
		{ ...videoClip(source, PAL, 'main-suffix', 20, 5, 300), groupId: 'suffix-group' },
	];
	const peerClipIds: string[] = [];
	if (options.straddler === true) {
		clips.push(videoClip(source, PAL, 'peer-straddler', 19, 2, 400));
		peerClipIds.push('peer-straddler');
	} else if (peerStart >= 20) {
		clips.push(videoClip(source, PAL, 'peer-earliest', 21, 1, 400));
		peerClipIds.push('peer-earliest');
	}
	clips.push({
		...videoClip(source, PAL, 'relation-peer', peerStart, 2, 500),
		groupId: 'suffix-group',
	});
	clips.push(videoClip(source, PAL, 'peer-later', 25, 5, 700));
	peerClipIds.push('relation-peer', 'peer-later');
	const tracks = [
		createVideoTrackV10({
			id: 'main-track', clipIds: ['active-video', 'main-suffix'], locked: false,
		}),
		createVideoTrackV10({ id: 'peer-track', clipIds: peerClipIds, locked: false }),
	];
	return commandProject({ rate: PAL, sources: [source], clips, tracks });
}

function videoSource(rate: RationalRate): Record<string, unknown> {
	return createVideoSourceV10({
		id: 'video-source', frameCount: 2_000_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: rate, sourceFrameCount: 1_000,
	}, SAMPLE_RATE);
}

function videoClip(
	source: Record<string, unknown>,
	rate: RationalRate,
	id: string,
	sequenceStartFrame: number,
	sequenceFrameCount: number,
	sourceInFrame: number,
	avLinkId: string | null = null,
): Record<string, unknown> {
	return createVideoClipV10({
		id, sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame, sequenceFrameCount,
		sourceInFrame, sourceFrameCount: sequenceFrameCount,
		avLinkId,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate }, source });
}

function commandProject(input: Readonly<{
	rate: RationalRate;
	sources: readonly Record<string, unknown>[];
	clips: readonly Record<string, unknown>[];
	tracks: readonly Record<string, unknown>[];
	selectedClipIds?: readonly string[];
}>): CommandProject {
	const project = createAudioEditorProjectV15({
		id: 'roll-ripple', now: '2026-08-11T16:00:00.000Z', sampleRate: SAMPLE_RATE,
		sequences: [{
			id: 'main', rate: input.rate,
			trackIds: input.tracks.map(({ id }) => String(id)),
		}],
		primarySequenceId: 'main',
		sources: input.sources,
		clips: input.clips,
		tracks: input.tracks,
		selection: input.selectedClipIds == null ? undefined : {
			startFrame: 0, endFrame: 0, trackIds: [],
			clipIds: input.selectedClipIds, frequencyRange: null,
		},
	});
	const projection = projectV10ForCommand(
		project as unknown as Record<string, unknown>,
	) as unknown as CommandProject;
	assert.equal(projection.schemaVersion, 15);
	assert.ok(projection.tracks.every(({ locked }) => typeof locked === 'boolean'));
	return projection;
}

function diagnostics(plan: Readonly<{
	mode: string;
	edge: string;
	sequenceId: string;
	requestedSequenceFrame: number;
	appliedSequenceFrame: number;
	sequenceFrameDelta: number;
	programFrameDelta: number;
	resolvedProgramSampleDelta: number;
	resolvedSourceCutSample: number;
	programEditSample: number;
	clamped: boolean;
}>) {
	return {
		mode: plan.mode,
		edge: plan.edge,
		sequenceId: plan.sequenceId,
		requestedSequenceFrame: plan.requestedSequenceFrame,
		appliedSequenceFrame: plan.appliedSequenceFrame,
		sequenceFrameDelta: plan.sequenceFrameDelta,
		programFrameDelta: plan.programFrameDelta,
		resolvedProgramSampleDelta: plan.resolvedProgramSampleDelta,
		resolvedSourceCutSample: plan.resolvedSourceCutSample,
		programEditSample: plan.programEditSample,
		clamped: plan.clamped,
	};
}

function previewRange(preview: Readonly<{
	timelineStartFrame: number;
	durationFrames: number;
	sourceStartFrame: number;
	sourceDurationFrames: number;
}>): readonly number[] {
	return [
		preview.timelineStartFrame,
		preview.timelineStartFrame + preview.durationFrames,
		preview.sourceStartFrame,
		preview.sourceStartFrame + preview.sourceDurationFrames,
	];
}

function assertFrozenPlan(plan: Readonly<{
	edgeClipIds: readonly string[];
	neighborClipIds: readonly string[];
	shiftedClipIds: readonly string[];
	transforms: readonly Readonly<{ changes: Readonly<Record<string, unknown>> }>[];
	previews: readonly object[];
}>): void {
	assert.ok(Object.isFrozen(plan));
	assert.ok(Object.isFrozen(plan.edgeClipIds));
	assert.ok(Object.isFrozen(plan.neighborClipIds));
	assert.ok(Object.isFrozen(plan.shiftedClipIds));
	assert.ok(Object.isFrozen(plan.transforms));
	assert.ok(Object.isFrozen(plan.previews));
	assert.ok(plan.transforms.every(Object.isFrozen));
	assert.ok(plan.previews.every(Object.isFrozen));
}

function boundary(frame: number, rate: RationalRate): number {
	return videoFrameToSampleFrame(frame, rate, SAMPLE_RATE, 'point');
}
