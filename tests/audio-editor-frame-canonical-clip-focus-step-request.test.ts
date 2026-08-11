/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildFrameCanonicalClipFocusStepRequest,
	resolveFrameCanonicalClipFocusIntent,
} from '../src/common/editor/frame-canonical-clip-focus-step-request.ts';
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
	brandRuntimeProjectProjection,
	type RuntimeClipProject,
} from '../src/common/editor/runtime-clip-projection.ts';
import { videoFrameToSampleFrame, type RationalRate } from '../src/common/editor/timeline-time.ts';

const NOW = '2026-08-11T22:00:00.000Z';
const NTSC = Object.freeze({ num: 30_000, den: 1_001 });

type CommandProject = Omit<RuntimeClipProject, 'clips' | 'tracks'> & Readonly<{
	clips: readonly Readonly<Record<string, unknown>>[];
	tracks: readonly Readonly<Record<string, unknown>>[];
}>;

test('callback intent treats only the finite non-zero sign as direction authority', () => {
	for (const [edge, delta, direction] of [
		['left', -0.1, 'outward'],
		['right', -0.1, 'outward'],
		['right', 0.1, 'inward'],
		['left', 0.1, 'inward'],
		['left', -9_999, 'outward'],
		['right', Number.MIN_VALUE, 'inward'],
	] as const) {
		const intent = resolveFrameCanonicalClipFocusIntent(edge, delta);
		assert.deepEqual(intent, { edge, direction });
		assert.equal(Object.isFrozen(intent), true);
	}
});

test('callback intent refuses malformed edges and non-finite or zero callback values', () => {
	for (const delta of [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
		assert.throws(
			() => resolveFrameCanonicalClipFocusIntent('left', delta),
			/finite|non-zero|callback/iu,
		);
	}
	assert.throws(
		() => resolveFrameCanonicalClipFocusIntent('middle', -0.1),
		/edge|left|right/iu,
	);
});

test('a linked-audio callback resolves all four adjacent NTSC video boundaries exactly once', () => {
	const project = commandProject({ sampleRate: 48_000, rate: NTSC });
	const before = JSON.stringify(project);
	for (const [edge, direction, targetFrame] of [
		['left', 'outward', 9],
		['left', 'inward', 11],
		['right', 'outward', 21],
		['right', 'inward', 19],
	] as const) {
		const request = buildFrameCanonicalClipFocusStepRequest(project, {
			activeClipId: 'linked-audio', edge, direction,
		});
		assert.deepEqual(request, {
			activeClipId: 'linked-audio',
			edge,
			requestedBoundarySample: boundary(targetFrame, NTSC, 48_000),
		});
		assert.equal(Object.isFrozen(request), true);
	}
	assert.equal(JSON.stringify(project), before);
});

test('integer and non-divisible sample rates use absolute point-rounded frame targets', () => {
	for (const [rate, sampleRate] of [
		[Object.freeze({ num: 24, den: 1 }), 48_000],
		[NTSC, 44_117],
	] as const) {
		const project = commandProject({ sampleRate, rate });
		const request = buildFrameCanonicalClipFocusStepRequest(project, {
			activeClipId: 'linked-audio', edge: 'right', direction: 'outward',
		});
		assert.equal(request.requestedBoundarySample, boundary(21, rate, sampleRate));
	}
	assert.equal(boundary(21, NTSC, 44_117), 30_913);
});

test('step construction refuses non-audio, unlinked, dangling, and ambiguous authorities', () => {
	const project = commandProject({ sampleRate: 48_000, rate: NTSC });
	assert.throws(() => buildFrameCanonicalClipFocusStepRequest(project, {
		activeClipId: 'linked-video', edge: 'left', direction: 'outward',
	}), /focused|active.*audio|linked audio/iu);

	const unlinked = deriveProjection(project, {
		clips: project.clips.map((clip) => clip.id === 'linked-audio'
			? Object.freeze({ ...clip, avLinkId: null })
			: clip),
	});
	assert.throws(() => buildFrameCanonicalClipFocusStepRequest(unlinked, {
		activeClipId: 'linked-audio', edge: 'left', direction: 'outward',
	}), /A\/V link|linked/iu);

	const dangling = deriveProjection(project, {
		clips: project.clips.filter((clip) => clip.id !== 'linked-video'),
		tracks: project.tracks.map((track) => track.id === 'video-track'
			? Object.freeze({ ...track, clipIds: Object.freeze([]) })
			: track),
	});
	assert.throws(() => buildFrameCanonicalClipFocusStepRequest(dangling, {
		activeClipId: 'linked-audio', edge: 'right', direction: 'outward',
	}), /companion|A\/V link|video/iu);

	const active = project.clips.find((clip) => clip.id === 'linked-audio');
	assert.ok(active);
	const ambiguous = deriveProjection(project, {
		clips: Object.freeze([
			...project.clips,
			Object.freeze({ ...active, id: 'second-linked-audio' }),
		]),
	});
	assert.throws(() => buildFrameCanonicalClipFocusStepRequest(ambiguous, {
		activeClipId: 'linked-audio', edge: 'right', direction: 'inward',
	}), /exactly one|ambiguous|A\/V link/iu);
});

test('step construction fails closed for forged projections and malformed step values', () => {
	const project = commandProject({ sampleRate: 48_000, rate: NTSC });
	assert.throws(() => buildFrameCanonicalClipFocusStepRequest({ ...project }, {
		activeClipId: 'linked-audio', edge: 'left', direction: 'outward',
	}), /branded command projection/iu);
	assert.throws(() => buildFrameCanonicalClipFocusStepRequest(project, {
		activeClipId: '', edge: 'left', direction: 'outward',
	}), /activeClipId/iu);
	assert.throws(() => buildFrameCanonicalClipFocusStepRequest(project, {
		activeClipId: 'linked-audio', edge: 'middle' as 'left', direction: 'outward',
	}), /edge|left|right/iu);
	assert.throws(() => buildFrameCanonicalClipFocusStepRequest(project, {
		activeClipId: 'linked-audio', edge: 'left', direction: 'sideways' as 'outward',
	}), /direction|outward|inward/iu);
});

function commandProject(options: Readonly<{
	sampleRate: number;
	rate: RationalRate;
}>) {
	const { sampleRate, rate } = options;
	const videoSource = createVideoSourceV10({
		id: 'video-source', sampleFrameCount: sampleRate * 20, sampleRate,
		width: 16, height: 16, frameRate: rate, sourceFrameCount: 1_000,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate },
	}, sampleRate);
	const audioSource = createAudioSourceV10({
		id: 'audio-source', frameCount: sampleRate * 20, sampleRate, channelCount: 1,
	});
	const sequence = Object.freeze({ id: 'main', rate });
	const video = createVideoClipV10({
		id: 'linked-video', sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame: 10, sequenceFrameCount: 10,
		sourceInFrame: 100, sourceFrameCount: 10, avLinkId: 'exact-link',
	}, { projectSampleRate: sampleRate, sequence, source: videoSource });
	const start = boundary(10, rate, sampleRate);
	const end = boundary(20, rate, sampleRate);
	const audio = createAudioClipV10({
		id: 'linked-audio', sourceId: 'audio-source', avLinkId: 'exact-link',
		timelineStartFrame: start, durationFrames: end - start,
		sourceStartFrame: sampleRate, sourceDurationFrames: end - start,
	});
	const tracks = [
		createVideoTrackV10({
			id: 'video-track', clipIds: ['linked-video'], laneGroupId: 'av-lanes', locked: false,
		}),
		createAudioTrackV10({
			id: 'audio-track', clipIds: ['linked-audio'], laneGroupId: 'av-lanes', locked: false,
		}, sampleRate),
	];
	const persisted = createAudioEditorProjectV15({
		id: 'clip-focus-step', now: NOW, sampleRate,
		sequences: [{ id: 'main', rate, trackIds: ['video-track', 'audio-track'] }],
		primarySequenceId: 'main', sources: [videoSource, audioSource],
		clips: [video, audio], tracks,
	});
	return projectV10ForCommand(
		persisted as unknown as Record<string, unknown>,
	) as CommandProject;
}

function deriveProjection(
	project: CommandProject,
	changes: Readonly<{
		clips?: readonly Readonly<Record<string, unknown>>[];
		tracks?: readonly Readonly<Record<string, unknown>>[];
	}>,
) {
	return brandRuntimeProjectProjection({
		...project,
		...changes,
	} as RuntimeClipProject) as CommandProject;
}

function boundary(frame: number, rate: RationalRate, sampleRate: number): number {
	return videoFrameToSampleFrame(frame, rate, sampleRate, 'point');
}
