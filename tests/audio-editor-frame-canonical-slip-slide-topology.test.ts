/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { VideoSourceTimingView } from '../src/common/editor/frame-canonical-slip-slide-domain.ts';
import { planFrameCanonicalSlipSlide } from '../src/common/editor/frame-canonical-slip-slide-planner.ts';
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
const SOURCE_RATE = Object.freeze({ num: 60, den: 1 });
const NOW = '2026-08-11T18:50:00.000Z';

test('a linked center gives unlinked audio neighbors one exact NTSC phase', () => {
	const fixture = slideFixture({ linkedRoles: ['center'] });
	const plan = planFrameCanonicalSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample: boundary(2, NTSC),
	});

	assert.equal(plan.kind, 'transform');
	assert.deepEqual(plan.leftClipIds, ['left-video', 'left-audio']);
	assert.deepEqual(plan.centerClipIds, ['center-video', 'center-audio']);
	assert.deepEqual(plan.rightClipIds, ['right-video', 'right-audio']);
	const previews = new Map(plan.previews.map((preview) => [preview.clipId, preview]));
	assert.deepEqual(programRange(previews.get('center-audio')!), [
		boundary(2, NTSC), boundary(3, NTSC),
	]);
	assert.deepEqual(programRange(previews.get('left-audio')!), [
		boundary(0, NTSC), boundary(2, NTSC),
	]);
	assert.deepEqual(programRange(previews.get('right-audio')!), [
		boundary(3, NTSC), boundary(4, NTSC),
	]);
	assert.equal(
		end(previews.get('left-audio')!),
		previews.get('center-audio')?.timelineStartFrame,
	);
	assert.equal(
		end(previews.get('center-audio')!),
		previews.get('right-audio')?.timelineStartFrame,
	);
});

test('a right-neighbor-only link refuses an unlinked center whose NTSC phase leaves a gap', () => {
	const fixture = slideFixture({ linkedRoles: ['right'] });
	assert.equal(boundary(2, NTSC) - boundary(1, NTSC), 1_601);
	assert.equal(boundary(3, NTSC) - boundary(2, NTSC), 1_602);

	assert.throws(() => planFrameCanonicalSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample: boundary(2, NTSC),
	}), /phase|linked|center|touch|triplet|gap/iu);
});

test('an extra nested or equal audio clip inside a reached slide triplet refuses', () => {
	for (const extra of ['nested', 'equal'] as const) {
		const fixture = slideFixture({ linkedRoles: ['center'], extra });
		assert.throws(() => planFrameCanonicalSlipSlide(fixture.project, fixture.timingViews, {
			mode: 'slide', activeClipId: 'center-video', requestedStartSample: boundary(2, NTSC),
		}), /equal|nested|overlap|transition|triplet/iu, extra);
	}
});

test('a hidden locked lane reached through its center refuses after neighbor completion', () => {
	const fixture = slideFixture({
		linkedRoles: ['center'], hiddenAudioTrack: true, lockedAudioTrack: true,
	});
	const audioTrack = (fixture.project.tracks as readonly Readonly<Record<string, unknown>>[])
		.find(({ id }) => id === 'audio-track');
	assert.equal(audioTrack?.hidden, true);
	assert.equal(audioTrack?.locked, true);
	assert.throws(() => planFrameCanonicalSlipSlide(fixture.project, fixture.timingViews, {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample: boundary(2, NTSC),
	}), /lock|audio-track/iu);
});

test('two disjoint selected and grouped clips on one lane slip atomically', () => {
	const source = createVideoSourceV10({
		id: 'video-source', sampleFrameCount: 200_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: PAL, sourceFrameCount: 100,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: PAL },
	}, SAMPLE_RATE);
	const clips = [
		videoClip(source, PAL, 'first-video', 0, 2, 10, 2, null, 'slip-group'),
		videoClip(source, PAL, 'second-video', 4, 2, 20, 2, null, 'slip-group'),
	];
	const track = createVideoTrackV10({
		id: 'video-track', clipIds: ['first-video', 'second-video'], locked: false,
	});
	const project = commandProject({
		rate: PAL, sources: [source], clips, tracks: [track],
		selectedClipIds: ['first-video', 'second-video'],
	});
	const timingViews = cfrTimingViews(PAL, 100);

	const plan = planFrameCanonicalSlipSlide(project, timingViews, {
		mode: 'slip', activeClipId: 'first-video', requestedSourceInFrame: 12,
	});

	assert.equal(plan.kind, 'transform');
	assert.deepEqual(plan.participantClipIds, ['first-video', 'second-video']);
	assert.deepEqual(plan.sourceRanges, [
		{ clipId: 'first-video', sourceStartFrame: 12, sourceEndFrame: 14 },
		{ clipId: 'second-video', sourceStartFrame: 22, sourceEndFrame: 24 },
	]);
	assert.deepEqual(plan.transforms, [
		{ clipId: 'first-video', trackId: 'video-track', changes: { sourceStartFrame: 12 } },
		{ clipId: 'second-video', trackId: 'video-track', changes: { sourceStartFrame: 22 } },
	]);
	assert.deepEqual(plan.previews.map((preview) => programRange(preview)), [
		[boundary(0, PAL), boundary(2, PAL)],
		[boundary(4, PAL), boundary(6, PAL)],
	]);
});

function slideFixture(options: Readonly<{
	linkedRoles: readonly ('left' | 'center' | 'right')[];
	extra?: 'nested' | 'equal';
	hiddenAudioTrack?: boolean;
	lockedAudioTrack?: boolean;
}>) {
	const videoSource = createVideoSourceV10({
		id: 'video-source', sampleFrameCount: 800_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: SOURCE_RATE, sourceFrameCount: 400,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: SOURCE_RATE },
	}, SAMPLE_RATE);
	const audioSource = createAudioSourceV10({
		id: 'audio-source', frameCount: 200_000, sampleRate: SAMPLE_RATE, channelCount: 1,
	});
	const specifications = [
		{ role: 'left', start: 0, count: 1, source: 100, sourceCount: 10 },
		{ role: 'center', start: 1, count: 1, source: 200, sourceCount: 10 },
		{ role: 'right', start: 2, count: 2, source: 300, sourceCount: 20 },
	] as const;
	const clips: Record<string, unknown>[] = [];
	for (const [index, specification] of specifications.entries()) {
		const linked = options.linkedRoles.includes(specification.role);
		const avLinkId = linked ? `${specification.role}-link` : null;
		clips.push(videoClip(
			videoSource, NTSC, `${specification.role}-video`,
			specification.start, specification.count,
			specification.source, specification.sourceCount,
			avLinkId, null,
		));
		const timelineStart = boundary(specification.start, NTSC);
		const timelineEnd = boundary(specification.start + specification.count, NTSC);
		clips.push(createAudioClipV10({
			id: `${specification.role}-audio`, sourceId: 'audio-source', avLinkId,
			timelineStartFrame: timelineStart, durationFrames: timelineEnd - timelineStart,
			sourceStartFrame: 10_000 + index * 10_000,
			sourceDurationFrames: timelineEnd - timelineStart,
			trimStartFrames: 5_000, trimEndFrames: 5_000,
			fadeInFrames: 100, fadeOutFrames: 100,
		}));
	}
	if (options.extra) {
		const start = options.extra === 'equal' ? boundary(1, NTSC) : boundary(1, NTSC) + 100;
		const duration = options.extra === 'equal'
			? boundary(2, NTSC) - boundary(1, NTSC)
			: 200;
		clips.push(createAudioClipV10({
			id: 'extra-audio', sourceId: 'audio-source',
			timelineStartFrame: start, durationFrames: duration,
			sourceStartFrame: 60_000, sourceDurationFrames: duration,
		}));
	}
	const videoTrack = createVideoTrackV10({
		id: 'video-track',
		clipIds: specifications.map(({ role }) => `${role}-video`),
		locked: false, laneGroupId: 'linked-lanes',
	});
	const audioTrack = createAudioTrackV10({
		id: 'audio-track',
		clipIds: [
			'left-audio', 'center-audio', 'right-audio',
			...(options.extra ? ['extra-audio'] : []),
		],
		locked: options.lockedAudioTrack ?? false,
		hidden: options.hiddenAudioTrack ?? false,
		laneGroupId: 'linked-lanes',
	}, SAMPLE_RATE);
	return {
		project: commandProject({
			rate: NTSC, sources: [videoSource, audioSource], clips,
			tracks: [videoTrack, audioTrack],
		}),
		timingViews: cfrTimingViews(SOURCE_RATE, 400),
	};
}

function videoClip(
	source: Record<string, unknown>,
	rate: RationalRate,
	id: string,
	sequenceStartFrame: number,
	sequenceFrameCount: number,
	sourceInFrame: number,
	sourceFrameCount: number,
	avLinkId: string | null,
	groupId: string | null,
) {
	return createVideoClipV10({
		id, sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame, sequenceFrameCount, sourceInFrame, sourceFrameCount,
		avLinkId, groupId,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate }, source });
}

function commandProject(input: Readonly<{
	rate: RationalRate;
	sources: readonly Record<string, unknown>[];
	clips: readonly Record<string, unknown>[];
	tracks: readonly Record<string, unknown>[];
	selectedClipIds?: readonly string[];
}>) {
	const persisted = createAudioEditorProjectV15({
		id: 'slip-slide-topology', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [{
			id: 'main', rate: input.rate,
			trackIds: input.tracks.map(({ id }) => String(id)),
		}],
		primarySequenceId: 'main', sources: input.sources, clips: input.clips, tracks: input.tracks,
		selection: input.selectedClipIds == null ? undefined : {
			startFrame: 0, endFrame: 0, trackIds: [],
			clipIds: input.selectedClipIds, frequencyRange: null,
		},
	});
	return projectV10ForCommand(persisted as unknown as Record<string, unknown>);
}

function cfrTimingViews(
	rate: RationalRate,
	frameCount: number,
): ReadonlyMap<string, VideoSourceTimingView> {
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'cfr', rate: Object.freeze({ ...rate }), frameCount,
	});
	return Object.freeze(new Map([['video-source', view]]));
}

function programRange(preview: Readonly<{
	timelineStartFrame: number;
	durationFrames: number;
}>): readonly number[] {
	return [preview.timelineStartFrame, end(preview)];
}

function end(preview: Readonly<{
	timelineStartFrame: number;
	durationFrames: number;
}>): number {
	return preview.timelineStartFrame + preview.durationFrames;
}

function boundary(frame: number, rate: RationalRate): number {
	return videoFrameToSampleFrame(frame, rate, SAMPLE_RATE, 'point');
}
