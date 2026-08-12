/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { planFrameCanonicalRateStretch } from '../src/common/editor/frame-canonical-rate-stretch-planner.ts';
import { projectV10ForCommand } from '../src/common/editor/project-v10-command-projection.ts';
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import {
	brandRuntimeProjectProjection,
	isRuntimeProjectProjection,
} from '../src/common/editor/runtime-clip-projection.ts';
import {
	videoFrameToSampleFrame,
	type RationalRate,
} from '../src/common/editor/timeline-time.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';
import type { VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';

const SAMPLE_RATE = 48_000;
const PAL = Object.freeze({ num: 24, den: 1 });
const NTSC = Object.freeze({ num: 30_000, den: 1_001 });
const NOW = '2026-08-11T20:00:00.000Z';
const VFR_SHA = 'b'.repeat(64);
const VFR_PUBLICATION = createVideoTimingAssetPublication(VFR_SHA, {
	timescale: 1_000,
	presentationTicks: [0n, 100n, 300n, 600n, 1_000n],
	finalFrameDurationTicks: 200n,
});
const VFR_INDEX = validateVideoTimingAssetBytes(VFR_PUBLICATION.reference, VFR_PUBLICATION.bytes);

test('right and left stretch anchor the opposite edge and preserve canonical source handles', () => {
	const rightFixture = fixture();
	const right = planFrameCanonicalRateStretch(rightFixture.project, rightFixture.timingViews, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(25, PAL),
	});
	assert.equal(right.kind, 'transform');
	assert.deepEqual(diagnostics(right), {
		authorityClipId: 'video', authoritySourceId: 'video-source', authoritySequenceId: 'main',
		requestedSequenceFrame: 25, appliedSequenceFrame: 25, boundarySample: boundary(25, PAL),
		sequenceFrameDelta: 5, durationScale: { num: 3, den: 2 },
		authorityPlaybackRate: 2 / 3, clamped: false,
	});
	assert.deepEqual(right.participantClipIds, ['video']);
	assert.deepEqual(right.transforms, [{
		clipId: 'video', trackId: 'video-track',
		changes: { durationFrames: boundary(15, PAL) },
		sequencePlacement: { sequenceStartFrame: 10, sequenceFrameCount: 15 },
	}]);
	assert.deepEqual(previewRanges(right.previews), [[
		'video', boundary(10, PAL), boundary(25, PAL), 100, 110,
	]]);

	const leftFixture = fixture();
	const left = planFrameCanonicalRateStretch(leftFixture.project, leftFixture.timingViews, {
		activeClipId: 'video', edge: 'left', requestedBoundarySample: boundary(5, PAL),
	});
	assert.equal(left.kind, 'transform');
	assert.equal(left.appliedSequenceFrame, 5);
	assert.equal(left.sequenceFrameDelta, -5);
	assert.deepEqual(left.durationScale, { num: 3, den: 2 });
	assert.deepEqual(left.transforms, [{
		clipId: 'video', trackId: 'video-track',
		changes: { timelineStartFrame: boundary(5, PAL), durationFrames: boundary(15, PAL) },
		sequencePlacement: { sequenceStartFrame: 5, sequenceFrameCount: 15 },
	}]);
	assert.deepEqual(previewRanges(left.previews), [[
		'video', boundary(5, PAL), boundary(20, PAL), 100, 110,
	]]);
});

test('one scale point-rounds unequal videos once on separate lanes', () => {
	const current = fixture({
		videoGroupId: 'stretch-group',
		secondary: { sequenceStartFrame: 30, sequenceFrameCount: 5, groupId: 'stretch-group' },
	});
	const plan = planFrameCanonicalRateStretch(current.project, current.timingViews, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(25, PAL),
	});
	assert.equal(plan.kind, 'transform');
	assert.deepEqual(plan.durationScale, { num: 3, den: 2 });
	assert.deepEqual(plan.participantClipIds, ['video', 'video-b']);
	assert.deepEqual(plan.transforms.map((transform) => [
		transform.clipId, transform.sequencePlacement?.sequenceStartFrame,
		transform.sequencePlacement?.sequenceFrameCount,
	]), [['video', 10, 15], ['video-b', 30, 8]]);
	assert.deepEqual(previewRanges(plan.previews), [
		['video', boundary(10, PAL), boundary(25, PAL), 100, 110],
		['video-b', boundary(30, PAL), boundary(38, PAL), 200, 205],
	]);
});

test('linked NTSC audio uses its companion endpoints and neutral audio metadata scales once', () => {
	const current = fixture({
		rate: NTSC, sourceRate: NTSC, sequenceStartFrame: 7, sequenceFrameCount: 4,
		sourceFrameCount: 4, linkedAudio: true,
	});
	const originalAudioDuration = boundary(11, NTSC) - boundary(7, NTSC);
	const plan = planFrameCanonicalRateStretch(current.project, current.timingViews, {
		activeClipId: 'audio', edge: 'right', requestedBoundarySample: boundary(13, NTSC),
	});
	assert.equal(plan.kind, 'transform');
	assert.deepEqual(plan.durationScale, { num: 3, den: 2 });
	assert.deepEqual(plan.participantClipIds, ['video', 'audio']);
	const audioTransform = plan.transforms.find(({ clipId }) => clipId === 'audio');
	assert.deepEqual(audioTransform, {
		clipId: 'audio', trackId: 'audio-track', changes: {
			durationFrames: boundary(13, NTSC) - boundary(7, NTSC),
			envelope: [
				{ frame: 0, value: 1 },
				{ frame: 1_500, value: 0.5 },
				{ frame: boundary(13, NTSC) - boundary(7, NTSC), value: 0.25 },
			],
		},
	});
	assert.ok(!Object.hasOwn(audioTransform?.changes ?? {}, 'speedRatio'));
	assert.ok(!Object.hasOwn(audioTransform?.changes ?? {}, 'renderCacheRevision'));
	assert.deepEqual(previewRanges(plan.previews), [
		['video', boundary(7, NTSC), boundary(13, NTSC), 100, 104],
		['audio', boundary(7, NTSC), boundary(13, NTSC), 10_000, 16_000],
	]);
	assert.ok(originalAudioDuration > 0);
});

test('VFR source PTS owns the derived rate while source frames stay fixed', () => {
	const current = fixture({
		rate: { num: 10, den: 1 }, sourceRate: { num: 10, den: 1 },
		sequenceStartFrame: 2, sequenceFrameCount: 9,
		sourceInFrame: 1, sourceFrameCount: 3, vfr: true,
	});
	const plan = planFrameCanonicalRateStretch(current.project, current.timingViews, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(20, { num: 10, den: 1 }),
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(plan.authorityPlaybackRate, 0.5);
	assert.deepEqual(plan.durationScale, { num: 2, den: 1 });
	assert.deepEqual(previewRanges(plan.previews), [[
		'video', boundary(2, { num: 10, den: 1 }), boundary(20, { num: 10, den: 1 }), 1, 4,
	]]);
});

test('effective-rate, positive-extent, and composition bounds clamp toward identity', () => {
	const slow = fixture();
	const extended = planFrameCanonicalRateStretch(slow.project, slow.timingViews, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: Number.MAX_SAFE_INTEGER,
	});
	assert.equal(extended.kind, 'transform');
	assert.equal(extended.appliedSequenceFrame, 170);
	assert.equal(extended.authorityPlaybackRate, 1 / 16);
	assert.equal(extended.clamped, true);

	const fast = fixture();
	const shortened = planFrameCanonicalRateStretch(fast.project, fast.timingViews, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(10, PAL),
	});
	assert.equal(shortened.kind, 'transform');
	assert.equal(shortened.appliedSequenceFrame, 11);
	assert.equal(shortened.authorityPlaybackRate, 10);
	assert.equal(shortened.clamped, true);

	const composed = fixture({
		sequenceStartFrame: 0,
		secondary: { sequenceStartFrame: 12, sequenceFrameCount: 10, sameTrack: true },
	});
	const compositionClamp = planFrameCanonicalRateStretch(composed.project, composed.timingViews, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(30, PAL),
	});
	assert.equal(compositionClamp.kind, 'transform');
	assert.equal(compositionClamp.appliedSequenceFrame, 21);
	assert.equal(compositionClamp.clamped, true);
});

test('targeting fails closed for locks, unlinked audio authority, non-neutral audio, and two videos on one lane', () => {
	const locked = fixture({ lockedVideo: true });
	assert.throws(() => planFrameCanonicalRateStretch(locked.project, locked.timingViews, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(21, PAL),
	}), /lock|video-track/iu);

	const unlinked = fixture({ videoGroupId: 'group', unlinkedAudioGroupId: 'group' });
	assert.throws(() => planFrameCanonicalRateStretch(unlinked.project, unlinked.timingViews, {
		activeClipId: 'audio', edge: 'right', requestedBoundarySample: boundary(21, PAL),
	}), /active|unlinked|video authority|A\/V/iu);

	const nonNeutral = fixture({ videoGroupId: 'group', unlinkedAudioGroupId: 'group', audioSpeedRatio: 2 });
	assert.throws(() => planFrameCanonicalRateStretch(nonNeutral.project, nonNeutral.timingViews, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(21, PAL),
	}), /neutral|speed|audio/iu);

	const multiVideo = fixture({
		videoGroupId: 'group',
		secondary: { sequenceStartFrame: 12, sequenceFrameCount: 10, sameTrack: true, groupId: 'group' },
	});
	assert.throws(() => planFrameCanonicalRateStretch(multiVideo.project, multiVideo.timingViews, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(26, PAL),
	}), /one|multiple|same.*lane|video-track/iu);

	const ordinary = fixture();
	const ordinaryClips = ordinary.project.clips as readonly Readonly<Record<string, unknown>>[];
	const retimed = brandRuntimeProjectProjection({
		...ordinary.project,
		clips: ordinaryClips.map((clip) => clip.id === 'video'
			? { ...clip, retimeMap: { feature: 'video-retime', points: [] } }
			: clip),
	});
	assert.throws(() => planFrameCanonicalRateStretch(retimed, ordinary.timingViews, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(21, PAL),
	}), /retime/iu);
});

test('no-op and transform plans are deeply frozen without mutating inputs', () => {
	const current = fixture({ linkedAudio: true });
	const before = JSON.stringify(current.project);
	const noop = planFrameCanonicalRateStretch(current.project, current.timingViews, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(20, PAL),
	});
	assert.equal(noop.kind, 'noop');
	assert.deepEqual(noop.transforms, []);
	assert.deepEqual(noop.previews, []);
	assert.equal(JSON.stringify(current.project), before);
	assertFrozen(noop);

	const changed = planFrameCanonicalRateStretch(current.project, current.timingViews, {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: boundary(25, PAL),
	});
	assert.equal(changed.kind, 'transform');
	assert.equal(JSON.stringify(current.project), before);
	assertFrozen(changed);
});

interface SecondaryOptions {
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	readonly sameTrack?: boolean;
	readonly groupId?: string;
}

interface FixtureOptions {
	readonly rate?: RationalRate;
	readonly sourceRate?: RationalRate;
	readonly sequenceStartFrame?: number;
	readonly sequenceFrameCount?: number;
	readonly sourceInFrame?: number;
	readonly sourceFrameCount?: number;
	readonly videoGroupId?: string;
	readonly linkedAudio?: boolean;
	readonly unlinkedAudioGroupId?: string;
	readonly audioSpeedRatio?: number;
	readonly lockedVideo?: boolean;
	readonly secondary?: SecondaryOptions;
	readonly vfr?: boolean;
}

function fixture(options: FixtureOptions = {}) {
	const rate = options.rate ?? PAL;
	const sourceRate = options.sourceRate ?? PAL;
	const sequenceStartFrame = options.sequenceStartFrame ?? 10;
	const sequenceFrameCount = options.sequenceFrameCount ?? 10;
	const sourceInFrame = options.sourceInFrame ?? 100;
	const sourceFrameCount = options.sourceFrameCount ?? 10;
	const videoSource = createVideoSourceV10({
		id: 'video-source', sampleFrameCount: 2_000_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: sourceRate,
		sourceFrameCount: options.vfr ? VFR_INDEX.frameCount : 1_000,
		...(options.vfr ? {
			contentSha256: VFR_SHA, timingAsset: VFR_PUBLICATION.reference,
			timingDecision: { mode: 'exact', rate: sourceRate, backend: 'fixture' },
		} : { timingDecision: { mode: 'conform-cfr-at-ingest', rate: sourceRate } }),
	}, SAMPLE_RATE);
	const linkedAudio = options.linkedAudio === true;
	const hasAudio = linkedAudio || options.unlinkedAudioGroupId != null;
	const video = createVideoClipV10({
		id: 'video', sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame, sequenceFrameCount, sourceInFrame, sourceFrameCount,
		groupId: options.videoGroupId ?? null,
		avLinkId: linkedAudio ? 'av-link' : null,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate }, source: videoSource });
	const clips: Record<string, unknown>[] = [video];
	const sources: Record<string, unknown>[] = [videoSource];
	const videoTrackIds = ['video'];
	const videoTrack = createVideoTrackV10({
		id: 'video-track', clipIds: videoTrackIds, locked: options.lockedVideo ?? false,
		...(linkedAudio ? { laneGroupId: 'linked-lanes' } : {}),
	});
	const tracks: Record<string, unknown>[] = [videoTrack];
	if (options.secondary) {
		const secondary = createVideoClipV10({
			id: 'video-b', sourceId: 'video-source', sequenceId: 'main',
			sequenceStartFrame: options.secondary.sequenceStartFrame,
			sequenceFrameCount: options.secondary.sequenceFrameCount,
			sourceInFrame: 200, sourceFrameCount: options.secondary.sequenceFrameCount,
			groupId: options.secondary.groupId ?? null,
		}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate }, source: videoSource });
		clips.push(secondary);
		if (options.secondary.sameTrack) {
			videoTrackIds.push('video-b');
			tracks[0] = createVideoTrackV10({
				id: 'video-track', clipIds: videoTrackIds, locked: options.lockedVideo ?? false,
				...(linkedAudio ? { laneGroupId: 'linked-lanes' } : {}),
			});
		}
		else tracks.push(createVideoTrackV10({ id: 'video-track-b', clipIds: ['video-b'], locked: false }));
	}
	if (hasAudio) {
		const start = boundary(sequenceStartFrame, rate);
		const end = boundary(sequenceStartFrame + sequenceFrameCount, rate);
		const audioSource = createAudioSourceV10({
			id: 'audio-source', frameCount: 200_000, sampleRate: 44_100, channelCount: 1,
		});
		clips.push(createAudioClipV10({
			id: 'audio', sourceId: 'audio-source', timelineStartFrame: start,
			durationFrames: end - start, sourceStartFrame: 10_000, sourceDurationFrames: 6_000,
			avLinkId: linkedAudio ? 'av-link' : null,
			groupId: options.unlinkedAudioGroupId ?? null,
			pitchCents: 0, speedRatio: options.audioSpeedRatio ?? 1, stretchToTempo: false,
			reversed: true, fadeInFrames: 150, fadeOutFrames: Math.min(6_000, end - start),
			envelope: [
				{ frame: 0, value: 1 },
				{ frame: 1_000, value: 0.5 },
				{ frame: end - start, value: 0.25 },
			],
		}));
		sources.push(audioSource);
		tracks.push(createAudioTrackV10({
			id: 'audio-track', clipIds: ['audio'], locked: false,
			...(linkedAudio ? { laneGroupId: 'linked-lanes' } : {}),
		}, SAMPLE_RATE));
	}
	const persisted = createCurrentAudioEditorProject({
		id: 'rate-stretch', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate, trackIds: tracks.map(({ id }) => String(id)) }],
		primarySequenceId: 'main', clips, tracks, sources,
	});
	const project = projectV10ForCommand(persisted as unknown as Record<string, unknown>);
	assert.equal(isRuntimeProjectProjection(project), true);
	const view: VideoSourceTimingView = options.vfr
		? Object.freeze({ kind: 'vfr', reference: VFR_PUBLICATION.reference, index: VFR_INDEX })
		: Object.freeze({ kind: 'cfr', rate: Object.freeze({ ...sourceRate }), frameCount: 1_000 });
	return { project, timingViews: Object.freeze(new Map([['video-source', view]])) };
}

function diagnostics(plan: Readonly<Record<string, unknown>>) {
	return Object.fromEntries([
		'authorityClipId', 'authoritySourceId', 'authoritySequenceId',
		'requestedSequenceFrame', 'appliedSequenceFrame', 'boundarySample',
		'sequenceFrameDelta', 'durationScale', 'authorityPlaybackRate', 'clamped',
	].map((key) => [key, plan[key]]));
}

function previewRanges(previews: readonly Readonly<{
	clipId: string;
	timelineStartFrame: number;
	durationFrames: number;
	sourceStartFrame: number;
	sourceDurationFrames: number;
}>[]) {
	return previews.map((preview) => [
		preview.clipId,
		preview.timelineStartFrame,
		preview.timelineStartFrame + preview.durationFrames,
		preview.sourceStartFrame,
		preview.sourceStartFrame + preview.sourceDurationFrames,
	]);
}

function assertFrozen(plan: Readonly<{
	participantClipIds: readonly string[];
	transforms: readonly Readonly<{ changes: object; sequencePlacement?: object }>[];
	previews: readonly object[];
	durationScale: object;
}>): void {
	assert.ok(Object.isFrozen(plan));
	assert.ok(Object.isFrozen(plan.participantClipIds));
	assert.ok(Object.isFrozen(plan.durationScale));
	assert.ok(Object.isFrozen(plan.transforms));
	assert.ok(Object.isFrozen(plan.previews));
	assert.ok(plan.transforms.every((transform) => Object.isFrozen(transform)
		&& Object.isFrozen(transform.changes)
		&& (transform.sequencePlacement == null || Object.isFrozen(transform.sequencePlacement))));
	assert.ok(plan.previews.every(Object.isFrozen));
}

function boundary(frame: number, rate: RationalRate): number {
	return videoFrameToSampleFrame(frame, rate, SAMPLE_RATE, 'point');
}
