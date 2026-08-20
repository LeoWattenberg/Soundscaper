/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { VideoSourceTimingView } from '../src/common/editor/frame-canonical-slip-slide-domain.ts';
import { planFrameCanonicalSlipSlide } from '../src/common/editor/frame-canonical-slip-slide-planner.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
	type MediaClipLeaf,
	type MediaSourceLeaf,
	type MediaTrackLeaf,
} from '../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { isRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import {
	videoFrameToSampleFrame,
	type RationalRate,
} from '../src/common/editor/timeline-time.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';

const SAMPLE_RATE = 48_000;
const PAL = Object.freeze({ num: 24, den: 1 });
const NTSC = Object.freeze({ num: 30_000, den: 1_001 });
const VIDEO_SHA256 = 'a'.repeat(64);
const VFR_PUBLICATION = createVideoTimingAssetPublication(VIDEO_SHA256, {
	timescale: 1_000,
	presentationTicks: [0n, 100n, 250n, 350n, 500n, 600n, 680n, 820n, 920n, 1_020n],
	finalFrameDurationTicks: 100n,
});
const VERIFIED_VFR_INDEX = validateVideoTimingAssetBytes(
	VFR_PUBLICATION.reference,
	VFR_PUBLICATION.bytes,
);

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

interface ObservedSourceRange {
	readonly clipId: string;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
}

interface ObservedTransform {
	readonly clipId: string;
	readonly trackId: string;
	readonly changes: Readonly<Record<string, unknown>>;
	readonly sequencePlacement?: Readonly<{
		readonly sequenceStartFrame: number;
		readonly sequenceFrameCount: number;
	}>;
}

interface ObservedPreview {
	readonly clipId: string;
	readonly trackId: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly trimStartFrames: number;
	readonly trimEndFrames: number;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly changeKind: 'source-slip' | 'neighbor-trim' | 'placement';
}

interface ObservedPlan extends Readonly<Record<string, unknown>> {
	readonly kind: 'noop' | 'transform';
	readonly mode: 'slip' | 'slide';
	readonly sourceFrameDelta: number;
	readonly requestedSequenceStartFrame: number;
	readonly appliedSequenceStartFrame: number;
	readonly sequenceFrameDelta: number;
	readonly clamped: boolean;
	readonly participantClipIds: readonly string[];
	readonly leftClipIds: readonly string[];
	readonly centerClipIds: readonly string[];
	readonly rightClipIds: readonly string[];
	readonly sourceRanges: readonly ObservedSourceRange[];
	readonly transforms: readonly ObservedTransform[];
	readonly previews: readonly ObservedPreview[];
}

type SlipSlideRequest = Readonly<{
	mode: 'slip';
	activeClipId: string;
	requestedSourceInFrame: number;
}> | Readonly<{
	mode: 'slide';
	activeClipId: string;
	requestedStartSample: number;
}>;

const planSlipSlide = planFrameCanonicalSlipSlide as unknown as (
	project: CommandProject,
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
	request: SlipSlideRequest,
) => ObservedPlan;

test('CFR slip resolves one absolute source target without changing program geometry', () => {
	const fixture = slipFixture();
	const plan = planSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slip', activeClipId: 'video', requestedSourceInFrame: 12,
	});

	assert.equal(plan.kind, 'transform');
	assert.deepEqual(slipDiagnostics(plan), {
		mode: 'slip', authorityClipId: 'video', authoritySourceId: 'video-source',
		authoritySequenceId: 'main', requestedSourceInFrame: 12,
		appliedSourceInFrame: 12, sourceFrameDelta: 2, clamped: false,
	});
	assert.deepEqual(plan.participantClipIds, ['video']);
	assert.deepEqual(plan.leftClipIds, []);
	assert.deepEqual(plan.centerClipIds, ['video']);
	assert.deepEqual(plan.rightClipIds, []);
	assert.deepEqual(plan.sourceRanges, [
		{ clipId: 'video', sourceStartFrame: 12, sourceEndFrame: 16 },
	]);
	assert.deepEqual(plan.transforms, [{
		clipId: 'video', trackId: 'video-track', changes: { sourceStartFrame: 12 },
	}]);
	assert.deepEqual(plan.previews, [{
		clipId: 'video', trackId: 'video-track',
		timelineStartFrame: boundary(10, PAL), durationFrames: boundary(4, PAL),
		sourceStartFrame: 12, sourceDurationFrames: 4,
		trimStartFrames: 0, trimEndFrames: 0, fadeInFrames: 0, fadeOutFrames: 0,
		changeKind: 'source-slip',
	}]);
	assert.ok(plan.transforms.every((transform) => !Object.hasOwn(transform, 'sequencePlacement')));
});

test('VFR slip maps both shifted PTS boundaries independently', () => {
	const fixture = slipFixture({ vfr: true, sourceInFrame: 1, sourceFrameCount: 3 });
	const plan = planSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slip', activeClipId: 'video', requestedSourceInFrame: 2,
	});

	assert.equal(plan.kind, 'transform');
	assert.equal(plan.sourceFrameDelta, 1);
	assert.deepEqual(plan.sourceRanges, [
		{ clipId: 'video', sourceStartFrame: 2, sourceEndFrame: 6 },
	]);
	assert.deepEqual(plan.transforms, [{
		clipId: 'video', trackId: 'video-track',
		changes: { sourceStartFrame: 2, sourceDurationFrames: 4 },
	}]);
	assert.deepEqual(sourceRange(plan.previews[0]!), [2, 6]);
	assert.deepEqual(programRange(plan.previews[0]!), [boundary(10, PAL), boundary(14, PAL)]);
});

test('linked CFR slip shifts mismatched-rate audio by the shared source-time span', () => {
	const fixture = slipFixture({ linkedAudio: true });
	const plan = planSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slip', activeClipId: 'video', requestedSourceInFrame: 12,
	});

	assert.equal(plan.kind, 'transform');
	assert.deepEqual(plan.participantClipIds, ['video', 'audio']);
	assert.deepEqual(plan.centerClipIds, ['video', 'audio']);
	assert.deepEqual(plan.sourceRanges, [
		{ clipId: 'video', sourceStartFrame: 12, sourceEndFrame: 16 },
		{ clipId: 'audio', sourceStartFrame: 13_675, sourceEndFrame: 21_025 },
	]);
	assert.deepEqual(plan.transforms, [
		{ clipId: 'video', trackId: 'video-track', changes: { sourceStartFrame: 12 } },
		{
			clipId: 'audio', trackId: 'audio-track', changes: {
				sourceStartFrame: 13_675, trimStartFrames: 3_775, trimEndFrames: 1_325,
			},
		},
	]);
	assert.deepEqual(plan.previews.map((preview) => [
		preview.clipId, ...programRange(preview), ...sourceRange(preview),
	]), [
		['video', boundary(10, PAL), boundary(14, PAL), 12, 16],
		['audio', boundary(10, PAL), boundary(14, PAL), 13_675, 21_025],
	]);
});

test('NTSC slide substitutes one frame delta into the complete touching triplet', () => {
	const fixture = slideFixture();
	const requestedStartSample = boundary(2, NTSC);
	const plan = planSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample,
	});

	assert.equal(plan.kind, 'transform');
	assert.deepEqual(slideDiagnostics(plan), {
		mode: 'slide', authorityClipId: 'center-video', authoritySourceId: 'video-source',
		authoritySequenceId: 'main', requestedStartSample,
		requestedSequenceStartFrame: 2, appliedSequenceStartFrame: 2,
		appliedStartSample: boundary(2, NTSC), appliedEndSample: boundary(3, NTSC),
		sequenceFrameDelta: 1, clamped: false,
	});
	assert.deepEqual(plan.leftClipIds, ['left-video']);
	assert.deepEqual(plan.centerClipIds, ['center-video']);
	assert.deepEqual(plan.rightClipIds, ['right-video']);
	assert.deepEqual(plan.participantClipIds, ['left-video', 'center-video', 'right-video']);
	assert.deepEqual(plan.sourceRanges, [
		{ clipId: 'left-video', sourceStartFrame: 100, sourceEndFrame: 120 },
		{ clipId: 'center-video', sourceStartFrame: 200, sourceEndFrame: 210 },
		{ clipId: 'right-video', sourceStartFrame: 310, sourceEndFrame: 320 },
	]);
	assert.deepEqual(plan.transforms, [
		{
			clipId: 'left-video', trackId: 'video-track',
			changes: { durationFrames: boundary(2, NTSC), sourceDurationFrames: 20 },
			sequencePlacement: { sequenceStartFrame: 0, sequenceFrameCount: 2 },
			sequenceTrimRange: { startFrame: 0, endFrame: 2 },
		},
		{
			clipId: 'center-video', trackId: 'video-track',
			changes: {
				timelineStartFrame: boundary(2, NTSC),
				durationFrames: boundary(3, NTSC) - boundary(2, NTSC),
			},
			sequencePlacement: { sequenceStartFrame: 2, sequenceFrameCount: 1 },
		},
		{
			clipId: 'right-video', trackId: 'video-track',
			changes: {
				timelineStartFrame: boundary(3, NTSC),
				durationFrames: boundary(4, NTSC) - boundary(3, NTSC),
				sourceStartFrame: 310, sourceDurationFrames: 10,
			},
			sequencePlacement: { sequenceStartFrame: 3, sequenceFrameCount: 1 },
			sequenceTrimRange: { startFrame: 1, endFrame: 2 },
		},
	]);
	assert.deepEqual(plan.previews.map((preview) => [
		preview.clipId, ...programRange(preview), ...sourceRange(preview), preview.changeKind,
	]), [
		['left-video', boundary(0, NTSC), boundary(2, NTSC), 100, 120, 'neighbor-trim'],
		['center-video', boundary(2, NTSC), boundary(3, NTSC), 200, 210, 'placement'],
		['right-video', boundary(3, NTSC), boundary(4, NTSC), 310, 320, 'neighbor-trim'],
	]);
	assert.ok(plan.transforms.every(({ sequencePlacement }) => sequencePlacement != null));
});

test('linked NTSC slide audio follows each companion endpoint instead of one global sample delta', () => {
	const fixture = slideFixture({ linkedAudio: true });
	const plan = planSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample: boundary(2, NTSC),
	});

	assert.equal(plan.kind, 'transform');
	assert.equal(boundary(2, NTSC) - boundary(1, NTSC), 1_601);
	assert.equal(boundary(3, NTSC) - boundary(2, NTSC), 1_602);
	assert.deepEqual(plan.leftClipIds, ['left-video', 'left-audio']);
	assert.deepEqual(plan.centerClipIds, ['center-video', 'center-audio']);
	assert.deepEqual(plan.rightClipIds, ['right-video', 'right-audio']);
	const previewById = new Map(plan.previews.map((preview) => [preview.clipId, preview]));
	for (const role of ['left', 'center', 'right']) {
		const video = previewById.get(`${role}-video`);
		const audio = previewById.get(`${role}-audio`);
		assert.ok(video);
		assert.ok(audio);
		assert.deepEqual(programRange(audio), programRange(video), `${role} A/V endpoints`);
	}
	assert.deepEqual(programRange(previewById.get('center-audio')!), [
		boundary(2, NTSC), boundary(3, NTSC),
	]);
	assert.deepEqual(sourceRange(previewById.get('center-audio')!), [20_000, 21_601]);
	assert.deepEqual(sourceRange(previewById.get('left-audio')!), [10_000, 13_203]);
	assert.deepEqual(sourceRange(previewById.get('right-audio')!), [31_602, 33_203]);
	assert.ok(plan.transforms.filter(({ clipId }) => clipId.endsWith('-video'))
		.every(({ sequencePlacement }) => sequencePlacement != null));
});

test('one common slide clamp controls the triplet and its immutable start is a no-op', () => {
	const fixture = slideFixture();
	const clamped = planSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample: boundary(6, NTSC),
	});
	assert.equal(clamped.kind, 'transform');
	assert.equal(clamped.requestedSequenceStartFrame, 6);
	assert.equal(clamped.appliedSequenceStartFrame, 2);
	assert.equal(clamped.sequenceFrameDelta, 1);
	assert.equal(clamped.clamped, true);
	assert.deepEqual(clamped.previews.map((preview) => programRange(preview)), [
		[boundary(0, NTSC), boundary(2, NTSC)],
		[boundary(2, NTSC), boundary(3, NTSC)],
		[boundary(3, NTSC), boundary(4, NTSC)],
	]);

	const noop = planSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample: boundary(1, NTSC),
	});
	assert.equal(noop.kind, 'noop');
	assert.equal(noop.sequenceFrameDelta, 0);
	assert.equal(noop.clamped, false);
	assert.deepEqual(noop.transforms, []);
	assert.deepEqual(noop.previews, []);
});

test('plans are deeply frozen and planning mutates neither branded current input nor timing evidence', () => {
	const fixture = slipFixture({ vfr: true, sourceInFrame: 1, sourceFrameCount: 3 });
	const projectBefore = JSON.stringify(fixture.project);
	const timingBefore = timingSnapshot(fixture.timingViews);
	const request = { mode: 'slip' as const, activeClipId: 'video', requestedSourceInFrame: 2 };
	const first = planSlipSlide(fixture.project, fixture.timingViews, request);
	const second = planSlipSlide(fixture.project, fixture.timingViews, request);

	assert.deepEqual(first, second);
	assert.equal(JSON.stringify(fixture.project), projectBefore);
	assert.deepEqual(timingSnapshot(fixture.timingViews), timingBefore);
	assertFrozenPlan(first);
	assert.ok(Object.isFrozen(fixture.timingViews));
	assert.ok(Object.isFrozen(VERIFIED_VFR_INDEX));
	assert.ok(Object.isFrozen(VERIFIED_VFR_INDEX.presentationTicks));
});

test('a persisted lock on one reached A/V lane refuses slip', () => {
	const fixture = slipFixture({ linkedAudio: true, lockedAudio: true });
	assert.equal(fixture.project.schemaVersion, 17);
	assert.equal(fixture.project.tracks.find(({ id }) => id === 'audio-track')?.locked, true);
	assert.throws(() => planSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slip', activeClipId: 'video', requestedSourceInFrame: 12,
	}), /lock|audio-track/iu);
});

function slipFixture(options: Readonly<{
	vfr?: boolean;
	linkedAudio?: boolean;
	lockedAudio?: boolean;
	sourceInFrame?: number;
	sourceFrameCount?: number;
}> = {}): Fixture {
	const sourceFrameCount = options.vfr ? VERIFIED_VFR_INDEX.frameCount : 32;
	const videoSource = createVideoSource({
		id: 'video-source', sampleFrameCount: boundary(sourceFrameCount, PAL), sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: PAL, sourceFrameCount,
		...(options.vfr ? {
			contentSha256: VIDEO_SHA256, timingAsset: VFR_PUBLICATION.reference,
			timingDecision: { mode: 'exact', rate: PAL, backend: 'fixture' },
		} : { timingDecision: { mode: 'conform-cfr-at-ingest', rate: PAL } }),
	}, SAMPLE_RATE);
	const avLinkId = options.linkedAudio ? 'center-link' : null;
	const video = createVideoClip({
		id: 'video', sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame: 10, sequenceFrameCount: 4,
		sourceInFrame: options.sourceInFrame ?? 10,
		sourceFrameCount: options.sourceFrameCount ?? 4,
		avLinkId,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: PAL }, source: videoSource });
	const clips: MediaClipLeaf[] = [video];
	const sources: MediaSourceLeaf[] = [videoSource];
	const tracks: MediaTrackLeaf[] = [createVideoTrack({
		id: 'video-track', clipIds: ['video'], locked: false,
		...(options.linkedAudio ? { laneGroupId: 'linked-lanes' } : {}),
	})];
	if (options.linkedAudio) {
		const audioSource = createAudioSource({
			id: 'audio-source', frameCount: 200_000, sampleRate: 44_100, channelCount: 1,
		});
		clips.push(createAudioClip({
			id: 'audio', sourceId: 'audio-source', avLinkId,
			timelineStartFrame: boundary(10, PAL), durationFrames: boundary(4, PAL),
			sourceStartFrame: 10_000, sourceDurationFrames: 7_350,
			trimStartFrames: 100, trimEndFrames: 5_000,
			fadeInFrames: 150, fadeOutFrames: 250,
		}));
		sources.push(audioSource);
		tracks.push(createAudioTrack({
			id: 'audio-track', clipIds: ['audio'], locked: options.lockedAudio ?? false,
			laneGroupId: 'linked-lanes',
		}, SAMPLE_RATE));
	}
	return {
		project: commandProject({ rate: PAL, sources, clips, tracks }),
		timingViews: timingViews([['video-source', options.vfr
			? Object.freeze({
				kind: 'vfr', reference: VFR_PUBLICATION.reference, index: VERIFIED_VFR_INDEX,
			})
			: cfrTiming(PAL, sourceFrameCount)] as const]),
	};
}

function slideFixture(options: Readonly<{
	linkedAudio?: boolean;
}> = {}): Fixture {
	const videoSource = createVideoSource({
		id: 'video-source', sampleFrameCount: 800_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: { num: 60, den: 1 }, sourceFrameCount: 400,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 60, den: 1 } },
	}, SAMPLE_RATE);
	const specifications = [
		{ role: 'left', sequenceStartFrame: 0, sequenceFrameCount: 1, sourceInFrame: 100, sourceFrameCount: 10 },
		{ role: 'center', sequenceStartFrame: 1, sequenceFrameCount: 1, sourceInFrame: 200, sourceFrameCount: 10 },
		{ role: 'right', sequenceStartFrame: 2, sequenceFrameCount: 2, sourceInFrame: 300, sourceFrameCount: 20 },
	] as const;
	const clips: Record<string, unknown>[] = [];
	for (const specification of specifications) clips.push(createVideoClip({
		id: `${specification.role}-video`, sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame: specification.sequenceStartFrame,
		sequenceFrameCount: specification.sequenceFrameCount,
		sourceInFrame: specification.sourceInFrame,
		sourceFrameCount: specification.sourceFrameCount,
		avLinkId: options.linkedAudio ? `${specification.role}-link` : null,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: NTSC }, source: videoSource }));
	const sources: MediaSourceLeaf[] = [videoSource];
	const tracks: MediaTrackLeaf[] = [createVideoTrack({
		id: 'video-track', clipIds: specifications.map(({ role }) => `${role}-video`),
		locked: false, ...(options.linkedAudio ? { laneGroupId: 'linked-lanes' } : {}),
	})];
	if (options.linkedAudio) {
		const audioSource = createAudioSource({
			id: 'audio-source', frameCount: 200_000, sampleRate: SAMPLE_RATE, channelCount: 1,
		});
		const audioStarts = [10_000, 20_000, 30_000] as const;
		for (const [index, specification] of specifications.entries()) {
			const start = boundary(specification.sequenceStartFrame, NTSC);
			const end = boundary(
				specification.sequenceStartFrame + specification.sequenceFrameCount,
				NTSC,
			);
			clips.splice(index * 2 + 1, 0, createAudioClip({
				id: `${specification.role}-audio`, sourceId: 'audio-source',
				avLinkId: `${specification.role}-link`, timelineStartFrame: start,
				durationFrames: end - start, sourceStartFrame: audioStarts[index],
				sourceDurationFrames: end - start,
				trimStartFrames: 5_000, trimEndFrames: 5_000,
				fadeInFrames: 100, fadeOutFrames: 100,
			}));
		}
		sources.push(audioSource);
		tracks.push(createAudioTrack({
			id: 'audio-track', clipIds: specifications.map(({ role }) => `${role}-audio`),
			locked: false, laneGroupId: 'linked-lanes',
		}, SAMPLE_RATE));
	}
	return {
		project: commandProject({ rate: NTSC, sources, clips, tracks }),
		timingViews: timingViews([['video-source', cfrTiming({ num: 60, den: 1 }, 400)]]),
	};
}

function commandProject(input: Readonly<{
	rate: RationalRate;
	sources: readonly Record<string, unknown>[];
	clips: readonly Record<string, unknown>[];
	tracks: readonly Record<string, unknown>[];
}>): CommandProject {
	const project = createCurrentAudioEditorProject({
		id: 'slip-slide', now: '2026-08-11T18:00:00.000Z', sampleRate: SAMPLE_RATE,
		sequences: [{
			id: 'main', rate: input.rate,
			trackIds: input.tracks.map(({ id }) => String(id)),
		}],
		primarySequenceId: 'main', sources: input.sources, clips: input.clips, tracks: input.tracks,
	});
	const projection = projectForCommand(
		project as unknown as Record<string, unknown>,
	) as unknown as CommandProject;
	assert.equal(projection.schemaVersion, 17);
	assert.equal(isRuntimeProjectProjection(projection), true);
	assert.ok(projection.tracks.every(({ locked }) => typeof locked === 'boolean'));
	return projection;
}

interface Fixture {
	readonly project: CommandProject;
	readonly timingViews: ReadonlyMap<string, VideoSourceTimingView>;
}

function cfrTiming(rate: RationalRate, frameCount: number): VideoSourceTimingView {
	return Object.freeze({ kind: 'cfr', rate: Object.freeze({ ...rate }), frameCount });
}

function timingViews(
	entries: readonly (readonly [string, VideoSourceTimingView])[],
): ReadonlyMap<string, VideoSourceTimingView> {
	return Object.freeze(new Map(entries));
}

function slipDiagnostics(plan: Readonly<Record<string, unknown>>) {
	return pick(plan, [
		'mode', 'authorityClipId', 'authoritySourceId', 'authoritySequenceId',
		'requestedSourceInFrame', 'appliedSourceInFrame', 'sourceFrameDelta', 'clamped',
	]);
}

function slideDiagnostics(plan: Readonly<Record<string, unknown>>) {
	return pick(plan, [
		'mode', 'authorityClipId', 'authoritySourceId', 'authoritySequenceId',
		'requestedStartSample', 'requestedSequenceStartFrame', 'appliedSequenceStartFrame',
		'appliedStartSample', 'appliedEndSample', 'sequenceFrameDelta', 'clamped',
	]);
}

function pick(value: Readonly<Record<string, unknown>>, keys: readonly string[]) {
	return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function programRange(preview: Readonly<{
	timelineStartFrame: number;
	durationFrames: number;
}>): readonly number[] {
	return [preview.timelineStartFrame, preview.timelineStartFrame + preview.durationFrames];
}

function sourceRange(preview: Readonly<{
	sourceStartFrame: number;
	sourceDurationFrames: number;
}>): readonly number[] {
	return [preview.sourceStartFrame, preview.sourceStartFrame + preview.sourceDurationFrames];
}

function timingSnapshot(views: ReadonlyMap<string, VideoSourceTimingView>): unknown {
	return [...views].map(([sourceId, view]) => view.kind === 'cfr'
		? [sourceId, view.kind, view.rate.num, view.rate.den, view.frameCount]
		: [
			sourceId, view.kind, view.reference.sha256,
			view.index.timescale, view.index.frameCount,
			view.index.presentationTicks.map(String), String(view.index.finalFrameDurationTicks),
			String(view.index.endTicks),
		]);
}

function assertFrozenPlan(plan: Readonly<{
	participantClipIds: readonly string[];
	leftClipIds: readonly string[];
	centerClipIds: readonly string[];
	rightClipIds: readonly string[];
	sourceRanges: readonly object[];
	transforms: readonly Readonly<{
		changes: Readonly<Record<string, unknown>>;
		sequencePlacement?: object;
	}>[];
	previews: readonly object[];
}>): void {
	assert.ok(Object.isFrozen(plan));
	for (const values of [
		plan.participantClipIds, plan.leftClipIds, plan.centerClipIds, plan.rightClipIds,
		plan.sourceRanges, plan.transforms, plan.previews,
	]) assert.ok(Object.isFrozen(values));
	assert.ok(plan.sourceRanges.every(Object.isFrozen));
	assert.ok(plan.transforms.every((transform) => Object.isFrozen(transform)
		&& Object.isFrozen(transform.changes)
		&& (transform.sequencePlacement == null || Object.isFrozen(transform.sequencePlacement))));
	assert.ok(plan.previews.every(Object.isFrozen));
}

function boundary(frame: number, rate: RationalRate): number {
	return videoFrameToSampleFrame(frame, rate, SAMPLE_RATE, 'point');
}
