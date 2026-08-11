/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareTransformClipsCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { planFrameCanonicalRateStretch } from '../src/common/editor/frame-canonical-rate-stretch-planner.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { projectV10ForCommand } from '../src/common/editor/project-v10-command-projection.ts';
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV16 } from '../src/common/editor/project-v16.ts';
import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';
import type { VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';

const SAMPLE_RATE = 48_000;
const RATE = Object.freeze({ num: 40_000, den: 1 });
const NOW = '2026-08-11T20:30:00.000Z';

test('a 48k/40k sample alias persists preview-equal linked geometry in one history step', () => {
	const original = createProject();
	const projection = projectV10ForCommand(original as unknown as Record<string, unknown>);
	const plan = planFrameCanonicalRateStretch(projection, timingViews(), {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: 3,
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(plan.requestedSequenceFrame, 3);
	assert.equal(plan.appliedSequenceFrame, 3);
	assert.equal(plan.boundarySample, 4, 'sequence frame 3 resolves to sample 4');
	assert.deepEqual(plan.durationScale, { num: 3, den: 2 });
	assert.deepEqual(previewState(plan.previews), [
		['video', 0, 4, 10, 12],
		['audio', 0, 4, 100, 102],
	]);
	assert.deepEqual(plan.transforms.find(({ clipId }) => clipId === 'video')?.sequencePlacement, {
		sequenceStartFrame: 0, sequenceFrameCount: 3,
	});
	for (const transform of plan.transforms) {
		for (const key of [
			'sourceStartFrame', 'sourceDurationFrames', 'trimStartFrames', 'trimEndFrames',
			'speedRatio', 'renderCacheRevision',
		]) assert.equal(Object.hasOwn(transform.changes, key), false, `${transform.clipId}.${key}`);
	}

	const prepared = prepareTransformClipsCommand(projection, plan.transforms) as AudioEditorCommand;
	assert.equal(prepared.type, 'clip/transform-many');
	const serialized = JSON.stringify(prepared);
	assert.doesNotMatch(serialized, /speedRatio|renderCacheRevision/u);
	const command = JSON.parse(serialized) as AudioEditorCommand;
	assert.deepEqual(command, prepared, 'the single transform command survives JSON exactly');

	let history = executeEditorCommand(createEditorHistory(original), command, { now: NOW });
	assert.equal(history.undoStack.length, 1);
	assert.equal(history.redoStack.length, 0);
	assert.equal(validateCurrentAudioEditorProject(history.present), true);
	assert.deepEqual(runtimeState(history.present), previewState(plan.previews));
	assert.deepEqual(persistedState(history.present), [
		['video', 0, 3, 10, 2, 9, null],
		['audio', 0, 4, 100, 2, 1, 7],
	]);
	assertNoPersistedVideoAliases(history.present);

	const edited = persistedState(history.present);
	history = undoEditorCommand(history, { now: '2026-08-11T20:31:00.000Z' });
	assert.deepEqual(persistedState(history.present), persistedState(original));
	assert.equal(history.undoStack.length, 0);
	assert.equal(history.redoStack.length, 1);
	history = redoEditorCommand(history, { now: '2026-08-11T20:32:00.000Z' });
	assert.deepEqual(persistedState(history.present), edited);
	assert.deepEqual(runtimeState(history.present), previewState(plan.previews));
});

test('tampered canonical placement refuses before rate-stretch command publication', () => {
	const original = createProject();
	const projection = projectV10ForCommand(original as unknown as Record<string, unknown>);
	const plan = planFrameCanonicalRateStretch(projection, timingViews(), {
		activeClipId: 'video', edge: 'right', requestedBoundarySample: 4,
	});
	assert.equal(plan.kind, 'transform');
	const tampered = plan.transforms.map((transform) => transform.clipId === 'video'
		? { ...transform, sequencePlacement: { sequenceStartFrame: 0, sequenceFrameCount: 4 } }
		: transform);
	assert.throws(
		() => prepareTransformClipsCommand(projection, tampered),
		/canonical|placement|sequence|alias|agree/iu,
	);
});

function createProject() {
	const videoSource = createVideoSourceV10({
		id: 'video-source', sampleFrameCount: 1_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: RATE, sourceFrameCount: 100,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: RATE },
	}, SAMPLE_RATE);
	const audioSource = createAudioSourceV10({
		id: 'audio-source', frameCount: 1_000, sampleRate: SAMPLE_RATE, channelCount: 1,
	});
	const video = createVideoClipV10({
		id: 'video', sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame: 0, sequenceFrameCount: 2,
		sourceInFrame: 10, sourceFrameCount: 2,
		avLinkId: 'link', speedRatio: 9,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: RATE }, source: videoSource });
	const audio = createAudioClipV10({
		id: 'audio', sourceId: 'audio-source', timelineStartFrame: 0, durationFrames: 2,
		sourceStartFrame: 100, sourceDurationFrames: 2, avLinkId: 'link',
		envelope: [{ frame: 1, value: 0.5 }], renderCacheRevision: 7,
	});
	return createAudioEditorProjectV16({
		id: 'rate-stretch-command', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: RATE, trackIds: ['video-track', 'audio-track'] }],
		primarySequenceId: 'main', sources: [videoSource, audioSource], clips: [video, audio],
		tracks: [
			createVideoTrackV10({
				id: 'video-track', clipIds: ['video'], laneGroupId: 'lanes', locked: false,
			}),
			createAudioTrackV10({
				id: 'audio-track', clipIds: ['audio'], laneGroupId: 'lanes', locked: false,
			}, SAMPLE_RATE),
		],
	});
}

function timingViews(): ReadonlyMap<string, VideoSourceTimingView> {
	return new Map([['video-source', Object.freeze({
		kind: 'cfr' as const, rate: RATE, frameCount: 100,
	})]]);
}

interface PreviewGeometry {
	readonly clipId: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
}

function previewState(previews: readonly PreviewGeometry[]) {
	return previews.map((preview) => [
		preview.clipId,
		preview.timelineStartFrame,
		Number(preview.timelineStartFrame) + Number(preview.durationFrames),
		preview.sourceStartFrame,
		Number(preview.sourceStartFrame) + Number(preview.sourceDurationFrames),
	]);
}

function runtimeState(project: ReturnType<typeof createProject>) {
	return resolveRuntimeProjectProjection(project).clips.map((clip) => [
		clip.id, clip.timelineStartFrame, clip.timelineEndFrame,
		clip.sourceStartFrame, clip.sourceEndFrame,
	]);
}

function persistedState(project: ReturnType<typeof createProject>) {
	return project.clips.map((clip) => [
		clip.id,
		clip.kind === 'video' ? clip.sequenceStartFrame : clip.timelineStartFrame,
		clip.kind === 'video' ? clip.sequenceFrameCount : clip.durationFrames,
		clip.kind === 'video' ? clip.sourceInFrame : clip.sourceStartFrame,
		clip.kind === 'video' ? clip.sourceFrameCount : clip.sourceDurationFrames,
		clip.speedRatio,
		clip.kind === 'audio' ? clip.renderCacheRevision : null,
	]);
}

function assertNoPersistedVideoAliases(project: ReturnType<typeof createProject>): void {
	const video = project.clips.find((clip) => clip.kind === 'video');
	assert.ok(video);
	for (const key of [
		'timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames',
	]) assert.equal(Object.hasOwn(video, key), false, key);
	assert.equal(videoFrameToSampleFrame(Number(video.sequenceFrameCount), RATE, SAMPLE_RATE), 4);
}
