/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildFrameCanonicalSlipSlideStepRequest,
} from '../src/common/editor/frame-canonical-slip-slide-step-request.ts';
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
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';

const SAMPLE_RATE = 48_000;
const SEQUENCE_RATE = Object.freeze({ num: 30_000, den: 1_001 });
const SOURCE_RATE = Object.freeze({ num: 24, den: 1 });
const NOW = '2026-08-11T20:00:00.000Z';

test('one-frame slip steps are absolute source targets owned by the video authority', () => {
	const project = commandProject();
	const before = JSON.stringify(project);

	const earlier = buildFrameCanonicalSlipSlideStepRequest(project, {
		mode: 'slip', activeClipId: 'center-video', direction: 'earlier',
	});
	const later = buildFrameCanonicalSlipSlideStepRequest(project, {
		mode: 'slip', activeClipId: 'center-video', direction: 'later',
	});

	assert.deepEqual(earlier, {
		mode: 'slip', activeClipId: 'center-video', requestedSourceInFrame: 199,
	});
	assert.deepEqual(later, {
		mode: 'slip', activeClipId: 'center-video', requestedSourceInFrame: 201,
	});
	assert.ok(Object.isFrozen(earlier));
	assert.ok(Object.isFrozen(later));
	assert.equal(JSON.stringify(project), before);
});

test('one-frame slide steps resolve exact NTSC sequence boundaries to absolute samples', () => {
	const project = commandProject();

	assert.deepEqual(buildFrameCanonicalSlipSlideStepRequest(project, {
		mode: 'slide', activeClipId: 'center-video', direction: 'earlier',
	}), {
		mode: 'slide', activeClipId: 'center-video',
		requestedStartSample: boundary(0),
	});
	assert.deepEqual(buildFrameCanonicalSlipSlideStepRequest(project, {
		mode: 'slide', activeClipId: 'center-video', direction: 'later',
	}), {
		mode: 'slide', activeClipId: 'center-video',
		requestedStartSample: boundary(2),
	});
	assert.equal(boundary(2), 3_203);
});

test('a linked audio selection still steps the resolved video source authority', () => {
	const project = commandProject({ linkedAudio: true });
	const request = buildFrameCanonicalSlipSlideStepRequest(project, {
		mode: 'slip', activeClipId: 'center-audio', direction: 'later',
	});

	assert.deepEqual(request, {
		mode: 'slip', activeClipId: 'center-audio', requestedSourceInFrame: 201,
	});
});

test('an earlier step at sequence zero and source-in zero remains absolute for planner clamping', () => {
	const project = commandProject({ zeroAuthority: true });
	const request = buildFrameCanonicalSlipSlideStepRequest(project, {
		mode: 'slip', activeClipId: 'left-video', direction: 'earlier',
	});

	assert.deepEqual(request, {
		mode: 'slip', activeClipId: 'left-video', requestedSourceInFrame: -1,
	});
	const timingView: VideoSourceTimingView = Object.freeze({
		kind: 'cfr', rate: SOURCE_RATE, frameCount: 1_000,
	});
	const plan = planFrameCanonicalSlipSlide(
		project,
		new Map([['video-source', timingView]]),
		request,
	);
	assert.equal(plan.kind, 'noop');
	assert.equal(plan.clamped, true);
	assert.equal(plan.requestedSourceInFrame, -1);
	assert.equal(plan.appliedSourceInFrame, 0);
});

test('step construction fails closed for forged projections and invalid steps', () => {
	const project = commandProject();
	assert.throws(() => buildFrameCanonicalSlipSlideStepRequest({ ...project }, {
		mode: 'slip', activeClipId: 'center-video', direction: 'later',
	}), /branded command projection/iu);
	assert.throws(() => buildFrameCanonicalSlipSlideStepRequest(project, {
		mode: 'slip', activeClipId: '', direction: 'later',
	}), /activeClipId/iu);
	assert.throws(() => buildFrameCanonicalSlipSlideStepRequest(project, {
		mode: 'slide', activeClipId: 'center-video', direction: 'sideways' as 'later',
	}), /direction/iu);
});

function commandProject(options: Readonly<{
	linkedAudio?: boolean;
	zeroAuthority?: boolean;
}> = {}) {
	const videoSource = createVideoSourceV10({
		id: 'video-source', sampleFrameCount: 2_000_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: SOURCE_RATE, sourceFrameCount: 1_000,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: SOURCE_RATE },
	}, SAMPLE_RATE);
	const specifications = [
		{
			id: 'left-video', sequenceStartFrame: 0, sequenceFrameCount: 1,
			sourceInFrame: options.zeroAuthority ? 0 : 100,
		},
		{ id: 'center-video', sequenceStartFrame: 1, sequenceFrameCount: 1, sourceInFrame: 200 },
		{ id: 'right-video', sequenceStartFrame: 2, sequenceFrameCount: 2, sourceInFrame: 300 },
	] as const;
	const clips: Record<string, unknown>[] = specifications.map((specification) => createVideoClipV10({
		...specification,
		sourceFrameCount: specification.sequenceFrameCount * 10,
		sourceId: 'video-source', sequenceId: 'main',
		avLinkId: specification.id === 'center-video' && options.linkedAudio ? 'center-link' : null,
	}, {
		projectSampleRate: SAMPLE_RATE,
		sequence: { id: 'main', rate: SEQUENCE_RATE },
		source: videoSource,
	}));
	const sources: Record<string, unknown>[] = [videoSource];
	const tracks: Record<string, unknown>[] = [createVideoTrackV10({
		id: 'video-track', clipIds: specifications.map(({ id }) => id), locked: false,
		laneGroupId: options.linkedAudio ? 'av-lanes' : null,
	})];
	if (options.linkedAudio) {
		const audioSource = createAudioSourceV10({
			id: 'audio-source', frameCount: 200_000, sampleRate: SAMPLE_RATE, channelCount: 1,
		});
		const start = boundary(1);
		const end = boundary(2);
		clips.push(createAudioClipV10({
			id: 'center-audio', sourceId: 'audio-source', avLinkId: 'center-link',
			timelineStartFrame: start, durationFrames: end - start,
			sourceStartFrame: 10_000, sourceDurationFrames: end - start,
		}));
		sources.push(audioSource);
		tracks.push(createAudioTrackV10({
			id: 'audio-track', clipIds: ['center-audio'], locked: false,
			laneGroupId: 'av-lanes',
		}, SAMPLE_RATE));
	}
	const persisted = createAudioEditorProjectV15({
		id: 'slip-slide-step-request', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: SEQUENCE_RATE, trackIds: tracks.map(({ id }) => String(id)) }],
		primarySequenceId: 'main', sources, clips, tracks,
	});
	return projectV10ForCommand(persisted as unknown as Record<string, unknown>);
}

function boundary(frame: number): number {
	return videoFrameToSampleFrame(frame, SEQUENCE_RATE, SAMPLE_RATE, 'point');
}
