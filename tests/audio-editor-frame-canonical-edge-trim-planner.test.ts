/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { planFrameCanonicalEdgeTrim } from '../src/common/editor/frame-canonical-edge-trim-planner.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
	type MediaClipLeaf,
	type MediaTrackLeaf,
} from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { brandRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import {
	sampleFrameToVideoFrame,
	videoFrameToSampleFrame,
	type RationalRate,
} from '../src/common/editor/timeline-time.ts';

const SAMPLE_RATE = 48_000;
const PAL = Object.freeze({ num: 24, den: 1 });
const NTSC = Object.freeze({ num: 30_000, den: 1_001 });

interface CommandClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind: 'audio' | 'video';
}

interface CommandTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly clipIds: readonly string[];
}

interface CommandSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
}

interface CommandProject extends Readonly<Record<string, unknown>> {
	readonly clips: readonly CommandClip[];
	readonly tracks: readonly CommandTrack[];
	readonly sources: readonly CommandSource[];
	readonly sequences: readonly Readonly<Record<string, unknown>>[];
}

test('left and right plans use one integer sequence boundary and absolute endpoint arithmetic', () => {
	const leftProject = fixture();
	const left = planFrameCanonicalEdgeTrim(leftProject, {
		activeClipId: 'video', edge: 'left', requestedBoundarySample: boundary(13, PAL),
	});
	assert.equal(left.kind, 'transform');
	assert.deepEqual(diagnostics(left), {
		requestedSequenceFrame: 13,
		appliedSequenceFrame: 13,
		sequenceFrameDelta: 3,
		resolvedSampleDelta: 6_000,
		clamped: false,
	});
	assert.deepEqual(left.participantClipIds, ['video']);
	assert.deepEqual(left.transforms, [{
		clipId: 'video', trackId: 'video-track', changes: {
			timelineStartFrame: 26_000,
			durationFrames: 14_000,
			sourceStartFrame: 106,
			sourceDurationFrames: 14,
		},
		sequencePlacement: { sequenceStartFrame: 13, sequenceFrameCount: 7 },
		sequenceTrimRange: { startFrame: 3, endFrame: 10 },
	}]);
	assert.deepEqual(left.previews, [{
		clipId: 'video', trackId: 'video-track',
		timelineStartFrame: 26_000, durationFrames: 14_000,
		sourceStartFrame: 106, sourceDurationFrames: 14,
		trimStartFrames: 0, trimEndFrames: 0,
		fadeInFrames: 0, fadeOutFrames: 0,
	}]);

	const rightProject = fixture();
	const right = planFrameCanonicalEdgeTrim(rightProject, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(22, PAL),
	});
	assert.equal(right.kind, 'transform');
	assert.deepEqual(diagnostics(right), {
		requestedSequenceFrame: 22,
		appliedSequenceFrame: 22,
		sequenceFrameDelta: 2,
		resolvedSampleDelta: 4_000,
		clamped: false,
	});
	assert.deepEqual(right.transforms, [{
		clipId: 'video', trackId: 'video-track', changes: {
			durationFrames: 24_000,
			sourceStartFrame: 100,
			sourceDurationFrames: 24,
		},
		sequencePlacement: { sequenceStartFrame: 10, sequenceFrameCount: 12 },
		sequenceTrimRange: { startFrame: 0, endFrame: 12 },
	}]);
	assert.deepEqual(right.previews.map(previewRange), [[20_000, 44_000, 100, 124]]);
});

test('NTSC conformance, nonzero origins, unequal source rates, and exact mapping ties round once', () => {
	const project = fixture({
		rate: NTSC,
		sequenceStartFrame: 7,
		sequenceFrameCount: 4,
		sourceInFrame: 100,
		sourceFrameCount: 10,
		sourceRate: { num: 25, den: 1 },
	});
	const originalStart = boundary(7, NTSC);
	const requestedBoundarySample = originalStart + 801;
	const expectedRequestedFrame = sampleFrameToVideoFrame(
		requestedBoundarySample, NTSC, SAMPLE_RATE, 'point',
	);
	const plan = planFrameCanonicalEdgeTrim(project, {
		activeClipId: 'video', edge: 'left', requestedBoundarySample,
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(plan.requestedSequenceFrame, expectedRequestedFrame);
	assert.equal(plan.appliedSequenceFrame, 8);
	assert.equal(plan.sequenceFrameDelta, 1);
	assert.equal(plan.resolvedSampleDelta, boundary(8, NTSC) - originalStart);
	assert.equal(plan.clamped, false);
	assert.deepEqual(plan.transforms, [{
		clipId: 'video', trackId: 'video-track', changes: {
			timelineStartFrame: boundary(8, NTSC),
			durationFrames: boundary(11, NTSC) - boundary(8, NTSC),
			sourceStartFrame: 103,
			sourceDurationFrames: 7,
		},
		sequencePlacement: { sequenceStartFrame: 8, sequenceFrameCount: 3 },
		sequenceTrimRange: { startFrame: 1, endFrame: 4 },
	}]);
	assert.deepEqual(plan.previews.map(previewRange), [[
		boundary(8, NTSC), boundary(11, NTSC), 103, 110,
	]]);
});

test('the common source clamp preserves every participant and returns an explicit frozen no-op', () => {
	const constrained = fixture({ linkedAudio: true, audioSourceStartFrame: 2_000 });
	const plan = planFrameCanonicalEdgeTrim(constrained, {
		activeClipId: 'video', edge: 'left', requestedBoundarySample: boundary(5, PAL),
	});
	assert.equal(plan.kind, 'transform');
	assert.deepEqual(diagnostics(plan), {
		requestedSequenceFrame: 5,
		appliedSequenceFrame: 9,
		sequenceFrameDelta: -1,
		resolvedSampleDelta: -2_000,
		clamped: true,
	});
	assert.deepEqual(plan.participantClipIds, ['video', 'audio']);
	assert.deepEqual(plan.previews.map(previewRange), [
		[18_000, 40_000, 98, 120],
		[18_000, 40_000, 0, 22_000],
	]);

	const exhausted = fixture({ linkedAudio: true, sourceInFrame: 0, audioSourceStartFrame: 0 });
	const noop = planFrameCanonicalEdgeTrim(exhausted, {
		activeClipId: 'video', edge: 'left', requestedBoundarySample: boundary(9, PAL),
	});
	assert.equal(noop.kind, 'noop');
	assert.deepEqual(diagnostics(noop), {
		requestedSequenceFrame: 9,
		appliedSequenceFrame: 10,
		sequenceFrameDelta: 0,
		resolvedSampleDelta: 0,
		clamped: true,
	});
	assert.deepEqual(noop.participantClipIds, ['video', 'audio']);
	assert.deepEqual(noop.transforms, []);
	assert.deepEqual(noop.previews, []);
	assertFrozenPlan(noop);
});

test('positive extents clamp a right shrink to one sequence frame', () => {
	const project = fixture();
	const plan = planFrameCanonicalEdgeTrim(project, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(10, PAL),
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(plan.requestedSequenceFrame, 10);
	assert.equal(plan.appliedSequenceFrame, 11);
	assert.equal(plan.sequenceFrameDelta, -9);
	assert.equal(plan.resolvedSampleDelta, -18_000);
	assert.equal(plan.clamped, true);
	assert.deepEqual(plan.previews.map(previewRange), [[20_000, 22_000, 100, 102]]);
});

test('a huge right extension clamps at the canonical video source bound', () => {
	const project = fixture({ sourceInFrame: 970, sourceFrameCount: 20 });
	const plan = planFrameCanonicalEdgeTrim(project, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: Number.MAX_SAFE_INTEGER,
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(plan.appliedSequenceFrame, 25);
	assert.equal(plan.sequenceFrameDelta, 5);
	assert.equal(plan.clamped, true);
	assert.deepEqual(plan.previews.map(previewRange), [[20_000, 50_000, 970, 1_000]]);
});

test('forward and reversed audio map all four source edges from original absolute ranges', () => {
	for (const row of [
		{ name: 'forward left', reversed: false, edge: 'left' as const, request: 11, sourceStart: 3_000, trimStart: 2_010, trimEnd: 20 },
		{ name: 'forward right', reversed: false, edge: 'right' as const, request: 19, sourceStart: 1_000, trimStart: 10, trimEnd: 2_020 },
		{ name: 'reversed left', reversed: true, edge: 'left' as const, request: 11, sourceStart: 1_000, trimStart: 10, trimEnd: 2_020 },
		{ name: 'reversed right', reversed: true, edge: 'right' as const, request: 19, sourceStart: 3_000, trimStart: 2_010, trimEnd: 20 },
	]) {
		const project = fixture({
			linkedAudio: true,
			audioReversed: row.reversed,
			audioSourceStartFrame: 1_000,
			audioTrimStartFrames: 10,
			audioTrimEndFrames: 20,
			audioFadeInFrames: 19_500,
			audioFadeOutFrames: 19_000,
		});
		const plan = planFrameCanonicalEdgeTrim(project, {
			activeClipId: 'audio', edge: row.edge, requestedBoundarySample: boundary(row.request, PAL),
		});
		assert.equal(plan.kind, 'transform', row.name);
		assert.equal(plan.sequenceFrameDelta, row.edge === 'left' ? 1 : -1, row.name);
		assert.deepEqual(plan.participantClipIds, ['video', 'audio'], row.name);
		const audio = plan.previews.find(({ clipId }) => clipId === 'audio');
		assert.deepEqual(audio, {
			clipId: 'audio', trackId: 'audio-track',
			timelineStartFrame: row.edge === 'left' ? 22_000 : 20_000,
			durationFrames: 18_000,
			sourceStartFrame: row.sourceStart,
			sourceDurationFrames: 18_000,
			trimStartFrames: row.trimStart,
			trimEndFrames: row.trimEnd,
			fadeInFrames: 18_000,
			fadeOutFrames: 18_000,
		}, row.name);
	}
});

test('an audio-active grouped trim applies its sample delta to the video authority own edge', () => {
	const linked = fixture({ linkedAudio: true });
	const project = derive(linked, {
		clips: linked.clips.map((clip) => clip.id === 'video' ? {
			...clip, avLinkId: null, groupId: 'mixed-group',
		} : {
			...clip,
			avLinkId: null,
			groupId: 'mixed-group',
			timelineStartFrame: 30_000,
			timelineEndFrame: 50_000,
			sourceStartFrame: 30_000,
			sourceEndFrame: 50_000,
		}),
	});
	const plan = planFrameCanonicalEdgeTrim(project, {
		activeClipId: 'audio', edge: 'left', requestedBoundarySample: 32_000,
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(plan.requestedSequenceFrame, 11);
	assert.equal(plan.appliedSequenceFrame, 11);
	assert.equal(plan.sequenceFrameDelta, 1);
	assert.equal(plan.resolvedSampleDelta, 2_000);
	assert.deepEqual(plan.previews.map(previewRange), [
		[22_000, 40_000, 102, 120],
		[32_000, 50_000, 32_000, 50_000],
	]);
});

test('selection, transitive groups, and A/V links expand in project order while same-track peers keep independent edges', () => {
	const project = relationFixture();
	const plan = planFrameCanonicalEdgeTrim(project, {
		activeClipId: 'active-video', edge: 'right', requestedBoundarySample: boundary(19, PAL),
	});
	assert.equal(plan.kind, 'transform');
	assert.deepEqual(plan.participantClipIds, [
		'transitive-audio', 'active-video', 'linked-audio', 'selected-audio',
	]);
	assert.deepEqual(plan.transforms.map(({ clipId }) => clipId), plan.participantClipIds);
	assert.equal(plan.participantClipIds.includes('same-track-video'), false);
	assert.equal(plan.participantClipIds.includes('unselected-audio'), false);
});

test('composition geometry clamps toward zero instead of inventing transition repair', () => {
	const project = compositionFixture();
	const plan = planFrameCanonicalEdgeTrim(project, {
		activeClipId: 'active-video', edge: 'left', requestedBoundarySample: boundary(4, PAL),
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(plan.requestedSequenceFrame, 4);
	assert.equal(plan.appliedSequenceFrame, 6);
	assert.equal(plan.sequenceFrameDelta, -4);
	assert.equal(plan.clamped, true);
	assert.deepEqual(plan.previews.map(previewRange), [[12_000, 40_000, 92, 120]]);
});

test('plans are deeply frozen, replanning is drift-free, and the command projection is untouched', () => {
	const project = fixture({ linkedAudio: true });
	const before = JSON.stringify(project);
	const intermediate = planFrameCanonicalEdgeTrim(project, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(18, PAL),
	});
	const first = planFrameCanonicalEdgeTrim(project, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(17, PAL),
	});
	const second = planFrameCanonicalEdgeTrim(project, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(17, PAL),
	});
	assert.equal(intermediate.kind, 'transform');
	assert.deepEqual(first, second);
	assert.equal(JSON.stringify(project), before);
	assertFrozenPlan(first);
	assert.ok(first.transforms.every(({ changes }) => Object.isFrozen(changes)));
});

test('invalid ownership, media references, canonical ranges, retiming, locks, and arithmetic refuse before planning', () => {
	const base = fixture({ linkedAudio: true });
	const cases: readonly Readonly<{ name: string; project: ReturnType<typeof fixture>; error: RegExp }>[] = [
		{ name: 'duplicate ownership', project: derive(base, {
			tracks: [...base.tracks, { ...base.tracks[0], id: 'duplicate-track' }],
		}), error: /own|duplicate/iu },
		{ name: 'track kind', project: derive(base, {
			tracks: base.tracks.map((track) => track.id === 'video-track' ? { ...track, type: 'audio' } : track),
		}), error: /video|track|kind/iu },
		{ name: 'missing source', project: derive(base, {
			clips: base.clips.map((clip) => clip.id === 'video' ? { ...clip, sourceId: 'missing' } : clip),
		}), error: /source/iu },
		{ name: 'missing sequence', project: derive(base, {
			clips: base.clips.map((clip) => clip.id === 'video' ? { ...clip, sequenceId: 'missing' } : clip),
		}), error: /sequence/iu },
		{ name: 'zero sequence extent', project: derive(base, {
			clips: base.clips.map((clip) => clip.id === 'video' ? { ...clip, sequenceFrameCount: 0 } : clip),
		}), error: /sequence|positive|range/iu },
		{ name: 'retime map', project: derive(base, {
			clips: base.clips.map((clip) => clip.id === 'video' ? { ...clip, retimeMap: {
				feature: 'video-retime', points: [],
			} } : clip),
		}), error: /retime/iu },
		{ name: 'source range', project: derive(base, {
			clips: base.clips.map((clip) => clip.id === 'video' ? { ...clip, sourceInFrame: 999, sourceFrameCount: 2 } : clip),
		}), error: /source|range/iu },
		{ name: 'unsafe sequence sum', project: derive(base, {
			clips: base.clips.map((clip) => clip.id === 'video' ? {
				...clip, sequenceStartFrame: Number.MAX_SAFE_INTEGER, sequenceFrameCount: 2,
			} : clip),
		}), error: /safe|sequence|range/iu },
	];
	for (const row of cases) {
		const before = JSON.stringify(row.project);
		assert.throws(() => planFrameCanonicalEdgeTrim(row.project, {
			activeClipId: 'video', edge: 'left', requestedBoundarySample: boundary(11, PAL),
		}), row.error, row.name);
		assert.equal(JSON.stringify(row.project), before, row.name);
	}
	assert.throws(() => planFrameCanonicalEdgeTrim(base, {
		activeClipId: 'missing', edge: 'left', requestedBoundarySample: 0,
	}), /active|clip/iu);
	assert.throws(() => planFrameCanonicalEdgeTrim(base, {
		activeClipId: 'video', edge: 'left', requestedBoundarySample: Number.MAX_SAFE_INTEGER + 1,
	}), /safe|boundary|sample/iu);
	assert.throws(() => planFrameCanonicalEdgeTrim(base, {
		activeClipId: 'video', edge: 'left', requestedBoundarySample: boundary(11, PAL),
		isTrackLocked: (trackId) => trackId === 'audio-track',
	}), /lock|audio-track/iu);
	assert.throws(() => planFrameCanonicalEdgeTrim({ ...base }, {
		activeClipId: 'video', edge: 'left', requestedBoundarySample: boundary(11, PAL),
	}), /command|projection|resolved/iu);
	const audioOnly = reproject(base, {
		clips: [base.clips[1]],
		tracks: [base.tracks[1]],
		sequences: base.sequences.map((sequence) => ({ ...sequence, trackIds: ['audio-track'] })),
	});
	assert.throws(() => planFrameCanonicalEdgeTrim(audioOnly, {
		activeClipId: 'audio', edge: 'left', requestedBoundarySample: boundary(11, PAL),
	}), /video participant|video-bearing|frame-canonical/iu);
});

test('mixed participating sequences and invalid base transition geometry refuse atomically', () => {
	const mixed = mixedSequenceFixture();
	assert.throws(() => planFrameCanonicalEdgeTrim(mixed, {
		activeClipId: 'video-a', edge: 'right', requestedBoundarySample: boundary(19, PAL),
	}), /sequence|rate/iu);
	const invalidComposition = invalidCompositionFixture();
	assert.throws(() => planFrameCanonicalEdgeTrim(invalidComposition, {
		activeClipId: 'active-video', edge: 'left', requestedBoundarySample: boundary(11, PAL),
	}), /transition|composition|overlap/iu);
});

function fixture(options: Readonly<{
	rate?: RationalRate;
	sequenceStartFrame?: number;
	sequenceFrameCount?: number;
	sourceInFrame?: number;
	sourceFrameCount?: number;
	sourceRate?: RationalRate;
	linkedAudio?: boolean;
	audioReversed?: boolean;
	audioSourceStartFrame?: number;
	audioTrimStartFrames?: number;
	audioTrimEndFrames?: number;
	audioFadeInFrames?: number;
	audioFadeOutFrames?: number;
}> = {}) {
	const rate = options.rate ?? PAL;
	const sequenceStartFrame = options.sequenceStartFrame ?? 10;
	const sequenceFrameCount = options.sequenceFrameCount ?? 10;
	const timelineStartFrame = boundary(sequenceStartFrame, rate);
	const timelineEndFrame = boundary(sequenceStartFrame + sequenceFrameCount, rate);
	const durationFrames = timelineEndFrame - timelineStartFrame;
	const videoSource = createVideoSource({
		id: 'video-source', frameCount: 2_000_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: options.sourceRate ?? { num: 48, den: 1 },
		sourceFrameCount: 1_000,
	}, SAMPLE_RATE);
	const audioSource = createAudioSource({
		id: 'audio-source', frameCount: 2_000_000, sampleRate: SAMPLE_RATE, channelCount: 1,
	});
	const avLinkId = options.linkedAudio ? 'av-link' : null;
	const video = createVideoClip({
		id: 'video', sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame, sequenceFrameCount,
		sourceInFrame: options.sourceInFrame ?? 100,
		sourceFrameCount: options.sourceFrameCount ?? 20,
		avLinkId,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate }, source: videoSource });
	const clips: MediaClipLeaf[] = [video];
	const tracks: MediaTrackLeaf[] = [createVideoTrack({ id: 'video-track', clipIds: ['video'], laneGroupId: options.linkedAudio ? 'av-lane' : null })];
	if (options.linkedAudio) {
		clips.push(createAudioClip({
			id: 'audio', sourceId: 'audio-source', timelineStartFrame,
			durationFrames, sourceStartFrame: options.audioSourceStartFrame ?? 20_000,
			sourceDurationFrames: durationFrames, avLinkId,
			reversed: options.audioReversed ?? false,
			trimStartFrames: options.audioTrimStartFrames ?? 0,
			trimEndFrames: options.audioTrimEndFrames ?? 0,
			fadeInFrames: options.audioFadeInFrames ?? 0,
			fadeOutFrames: options.audioFadeOutFrames ?? 0,
		}));
		tracks.push(createAudioTrack({ id: 'audio-track', clipIds: ['audio'], laneGroupId: 'av-lane' }, SAMPLE_RATE));
	}
	const persisted = createCurrentAudioEditorProject({
		id: 'frame-trim', now: '2026-08-11T12:00:00.000Z', sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate, trackIds: tracks.map(({ id }) => String(id)) }],
		primarySequenceId: 'main', sources: [videoSource, audioSource], clips, tracks,
	});
	return projectForCommand(
		persisted as unknown as Record<string, unknown>,
	) as unknown as CommandProject;
}

function relationFixture() {
	const project = fixture({ linkedAudio: true });
	const source = project.sources.find(({ id }) => id === 'audio-source');
	assert.ok(source);
	const audio = (id: string, groupId: string | null) => createAudioClip({
		id, sourceId: 'audio-source', timelineStartFrame: 20_000,
		durationFrames: 20_000, sourceStartFrame: 20_000, sourceDurationFrames: 20_000, groupId,
	});
	const sameTrackSource = project.sources.find(({ id }) => id === 'video-source');
	assert.ok(sameTrackSource);
	const sameTrack = createVideoClip({
		id: 'same-track-video', sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame: 30, sequenceFrameCount: 5, sourceInFrame: 200, sourceFrameCount: 10,
		groupId: 'selected-group',
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: PAL }, source: sameTrackSource });
	return reproject(project, {
		clips: [
			{ ...audio('transitive-audio', 'transitive-group') },
			{ ...project.clips[0], id: 'active-video', groupId: 'selected-group' },
			{ ...project.clips[1], id: 'linked-audio', groupId: 'transitive-group' },
			audio('selected-audio', 'selected-group'),
			audio('unselected-audio', null),
			sameTrack,
		],
		tracks: [
			{ ...project.tracks[0], clipIds: ['active-video', 'same-track-video'] },
			{ ...project.tracks[1], clipIds: ['linked-audio'] },
			createAudioTrack({ id: 'transitive-track', clipIds: ['transitive-audio'] }, SAMPLE_RATE),
			createAudioTrack({ id: 'selected-track', clipIds: ['selected-audio'] }, SAMPLE_RATE),
			createAudioTrack({ id: 'unselected-track', clipIds: ['unselected-audio'] }, SAMPLE_RATE),
		],
		selection: {
			startFrame: 0, endFrame: 0, trackIds: [],
			clipIds: ['active-video', 'selected-audio'], frequencyRange: null,
		},
	});
}

function compositionFixture() {
	const project = fixture();
	const source = project.sources.find(({ id }) => id === 'video-source');
	assert.ok(source);
	const earlier = createVideoClip({
		id: 'earlier-video', sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame: 5, sequenceFrameCount: 10, sourceInFrame: 10, sourceFrameCount: 20,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: PAL }, source });
	return reproject(project, {
		clips: [earlier, { ...project.clips[0], id: 'active-video' }],
		tracks: [{ ...project.tracks[0], clipIds: ['earlier-video', 'active-video'] }],
	});
}

function mixedSequenceFixture() {
	const project = fixture();
	const source = project.sources.find(({ id }) => id === 'video-source');
	assert.ok(source);
	const other = createVideoClip({
		id: 'video-b', sourceId: 'video-source', sequenceId: 'other',
		sequenceStartFrame: 10, sequenceFrameCount: 10, sourceInFrame: 100, sourceFrameCount: 20,
		groupId: 'group',
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'other', rate: NTSC }, source });
	return reproject(project, {
		clips: [{ ...project.clips[0], id: 'video-a', groupId: 'group' }, other],
		tracks: [
			{ ...project.tracks[0], id: 'video-track-a', clipIds: ['video-a'] },
			createVideoTrack({ id: 'video-track-b', clipIds: ['video-b'] }),
		],
		sequences: [
			{ id: 'main', rate: PAL, trackIds: ['video-track-a'] },
			{ id: 'other', rate: NTSC, trackIds: ['video-track-b'] },
		],
	});
}

function invalidCompositionFixture() {
	const project = compositionFixture();
	return derive(project, {
		clips: project.clips.map((clip) => clip.id === 'earlier-video' ? {
			...clip, timelineStartFrame: 22_000, timelineEndFrame: 26_000, durationFrames: 4_000,
			sequenceStartFrame: 11, sequenceEndFrame: 13, sequenceFrameCount: 2,
		} : clip),
	});
}

function derive(
	project: CommandProject,
	changes: Readonly<Record<string, unknown>>,
): CommandProject {
	return brandRuntimeProjectProjection({ ...project, ...changes }) as CommandProject;
}

function reproject(
	project: CommandProject,
	changes: Readonly<Record<string, unknown>>,
): CommandProject {
	return projectForCommand({ ...project, ...changes }) as unknown as CommandProject;
}

function diagnostics(plan: Readonly<{
	requestedSequenceFrame: number;
	appliedSequenceFrame: number;
	sequenceFrameDelta: number;
	resolvedSampleDelta: number;
	clamped: boolean;
}>) {
	return {
		requestedSequenceFrame: plan.requestedSequenceFrame,
		appliedSequenceFrame: plan.appliedSequenceFrame,
		sequenceFrameDelta: plan.sequenceFrameDelta,
		resolvedSampleDelta: plan.resolvedSampleDelta,
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
	participantClipIds: readonly string[];
	transforms: readonly Readonly<{ changes: Readonly<Record<string, unknown>> }>[];
	previews: readonly object[];
}>): void {
	assert.ok(Object.isFrozen(plan));
	assert.ok(Object.isFrozen(plan.participantClipIds));
	assert.ok(Object.isFrozen(plan.transforms));
	assert.ok(Object.isFrozen(plan.previews));
	assert.ok(plan.transforms.every(Object.isFrozen));
	assert.ok(plan.previews.every(Object.isFrozen));
}

function boundary(frame: number, rate: RationalRate): number {
	return videoFrameToSampleFrame(frame, rate, SAMPLE_RATE, 'point');
}
