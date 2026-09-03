/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import { resolveRuntimeClipProjection } from '../runtime-clip-projection.ts';
import { sampleFrameToVideoFrame } from '../timeline-time.ts';
import { applySoundscaperProjectCommand } from '../../../soundscaper/editor-project-commands.ts';
import {
	createSoundscaperProject,
	type SoundscaperProject,
} from '../../../soundscaper/editor-project.ts';

export const M3_LONGFORM_EDITORIAL_WORKLOAD_ID = 'm3-longform-editorial';
export const M3_LONGFORM_EDITORIAL_FIXTURE_ID = 'm3-longform-editorial-2h-v2';
export const M3_LONGFORM_EDITORIAL_PROFILE = 'deterministic-two-hour-editorial-v1';

const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 7_200;
const DURATION_SAMPLES = SAMPLE_RATE * DURATION_SECONDS;
const VIDEO_RATE = Object.freeze({ num: 30, den: 1 });
const VIDEO_FRAME_COUNT = VIDEO_RATE.num * DURATION_SECONDS;
const AUDIO_TRACK_COUNT = 24;
const VIDEO_TRACK_COUNT = 2;
const EDIT_COUNT = 10_000;
const COMMANDS_PER_TRANSACTION = 250;
const AUDIO_MOVE_SLACK_SAMPLES = SAMPLE_RATE;
const VIDEO_MOVE_SLACK_FRAMES = VIDEO_RATE.num;
const VIDEO_FRAME_SAMPLES = SAMPLE_RATE / VIDEO_RATE.num;
const EDIT_SEED = 1_554_098_974;

export interface M3LongformEditorialSpecification {
	readonly generatorRevision: 2;
	readonly seed: number;
	readonly durationSeconds: number;
	readonly sampleRate: number;
	readonly videoFrameRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly audioTrackCount: number;
	readonly proxyVideoTrackCount: number;
	readonly editCount: number;
	readonly commandsPerTransaction: number;
	readonly operationCounts: M3LongformEditorialOperationCounts;
	readonly seekCheckpointsSamples: readonly number[];
	readonly scrollFrameIntervalSampleCount: number;
	readonly expectedProjectSha256: string;
	readonly expectedEditPlanSha256: string;
}

export interface M3LongformEditorialOperationCounts {
	readonly audioClipMoves: number;
	readonly proxyVideoClipMoves: number;
	readonly selectionChanges: number;
	readonly trackMixChanges: number;
}

export interface M3LongformEditorialExpectedClipPosition {
	readonly clipId: string;
	readonly kind: 'audio' | 'video';
	readonly timelineSample: number;
	readonly videoFrame: number | null;
}

export interface M3LongformEditorialEditPlan {
	readonly commands: readonly AudioEditorCommand[];
	readonly expectedClipPositions: readonly M3LongformEditorialExpectedClipPosition[];
	readonly operationCounts: M3LongformEditorialOperationCounts;
}

export interface M3LongformEditorialPositionCheck extends M3LongformEditorialExpectedClipPosition {
	readonly observedTimelineSample: number;
	readonly observedVideoFrame: number | null;
	readonly audioPositionErrorSamples: number;
	readonly videoPositionErrorFrames: number;
}

export const M3_LONGFORM_EDITORIAL_SPECIFICATION: M3LongformEditorialSpecification = Object.freeze({
	generatorRevision: 2,
	seed: EDIT_SEED,
	durationSeconds: DURATION_SECONDS,
	sampleRate: SAMPLE_RATE,
	videoFrameRate: VIDEO_RATE,
	audioTrackCount: AUDIO_TRACK_COUNT,
	proxyVideoTrackCount: VIDEO_TRACK_COUNT,
	editCount: EDIT_COUNT,
	commandsPerTransaction: COMMANDS_PER_TRANSACTION,
	operationCounts: Object.freeze({
		audioClipMoves: EDIT_COUNT / 4,
		proxyVideoClipMoves: EDIT_COUNT / 4,
		selectionChanges: EDIT_COUNT / 4,
		trackMixChanges: EDIT_COUNT / 4,
	}),
	seekCheckpointsSamples: Object.freeze([
		0,
		SAMPLE_RATE * 60,
		SAMPLE_RATE * 1_800,
		SAMPLE_RATE * 3_600,
		DURATION_SAMPLES - SAMPLE_RATE,
	]),
	scrollFrameIntervalSampleCount: 240,
	expectedProjectSha256: '1bad63b7a377295d9fe0fb14a54435cea3c603e83cfc5be3a7371218062d7dad',
	expectedEditPlanSha256: '2167cb31e4ff5454c6443c40904aadc12ae9cb2ca7cb22addee906f71a1fcadf',
});

/** Create the deterministic current-schema media graph before editorial commands. */
export function createM3LongformEditorialBaseProject(): SoundscaperProject {
	const sources: Record<string, unknown>[] = [];
	const clips: Record<string, unknown>[] = [];
	const tracks: Record<string, unknown>[] = [];
	for (let index = 0; index < AUDIO_TRACK_COUNT; index += 1) {
		const sourceId = audioSourceId(index);
		const clipId = audioClipId(index);
		sources.push({
			id: sourceId,
			storageKey: sourceId,
			name: `Long-form audio ${String(index + 1).padStart(2, '0')}`,
			kind: 'audio',
			frameCount: DURATION_SAMPLES,
			channelCount: 1,
			sampleRate: SAMPLE_RATE,
			originalSampleRate: SAMPLE_RATE,
		});
		clips.push({
			id: clipId,
			sourceId,
			title: `Editorial audio ${String(index + 1).padStart(2, '0')}`,
			kind: 'audio',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: index === 0
				? DURATION_SAMPLES
				: DURATION_SAMPLES - AUDIO_MOVE_SLACK_SAMPLES,
			durationFrames: index === 0
				? DURATION_SAMPLES
				: DURATION_SAMPLES - AUDIO_MOVE_SLACK_SAMPLES,
		});
		tracks.push({
			id: audioTrackId(index),
			name: `Audio ${String(index + 1).padStart(2, '0')}`,
			type: 'audio',
			clipIds: [clipId],
		});
	}
	for (let index = 0; index < VIDEO_TRACK_COUNT; index += 1) {
		const sourceId = videoSourceId(index);
		const clipId = videoClipId(index);
		sources.push({
			id: sourceId,
			storageKey: sourceId,
			name: `Proxy video ${String(index + 1)}`,
			kind: 'video',
			sampleFrameCount: DURATION_SAMPLES,
			frameRate: VIDEO_RATE,
			sourceFrameCount: VIDEO_FRAME_COUNT,
			sampleRate: SAMPLE_RATE,
			width: 640,
			height: 360,
			mimeType: 'video/webm',
			videoCodec: 'vp9',
		});
		clips.push({
			id: clipId,
			sourceId,
			title: `Editorial proxy ${String(index + 1)}`,
			kind: 'video',
			sequenceId: 'main-sequence',
			sequenceStartFrame: 0,
			sequenceFrameCount: VIDEO_FRAME_COUNT - VIDEO_MOVE_SLACK_FRAMES,
			sourceInFrame: 0,
			sourceFrameCount: VIDEO_FRAME_COUNT - VIDEO_MOVE_SLACK_FRAMES,
		});
		tracks.push({
			id: videoTrackId(index),
			name: `Proxy video ${String(index + 1)}`,
			type: 'video',
			clipIds: [clipId],
		});
	}
	return createSoundscaperProject({
		id: M3_LONGFORM_EDITORIAL_FIXTURE_ID,
		title: 'Milestone 3 two-hour editorial workload',
		createdAt: '1970-01-01T00:00:00.000Z',
		updatedAt: '1970-01-01T00:00:00.000Z',
		sampleRate: SAMPLE_RATE,
		sources,
		clips,
		tracks,
	});
}

/** Produce 10,000 seeded serializable commands and their independent final-position oracle. */
export function createM3LongformEditorialEditPlan(): M3LongformEditorialEditPlan {
	const random = xorshift32(EDIT_SEED);
	const commands: AudioEditorCommand[] = [];
	const expected = initialExpectedPositions();
	const operationCounts = {
		audioClipMoves: 0,
		proxyVideoClipMoves: 0,
		selectionChanges: 0,
		trackMixChanges: 0,
	};
	for (let editIndex = 0; editIndex < EDIT_COUNT; editIndex += 1) {
		const operation = editIndex % 4;
		if (operation === 0) {
			const trackIndex = 1 + random() % (AUDIO_TRACK_COUNT - 1);
			const timelineSample = random() % (AUDIO_MOVE_SLACK_SAMPLES + 1);
			commands.push(Object.freeze({
				type: 'clip/move',
				clipId: audioClipId(trackIndex),
				trackId: audioTrackId(trackIndex),
				timelineStartFrame: timelineSample,
			}));
			expected.set(audioClipId(trackIndex), {
				clipId: audioClipId(trackIndex), kind: 'audio', timelineSample, videoFrame: null,
			});
			operationCounts.audioClipMoves += 1;
		} else if (operation === 1) {
			const trackIndex = random() % VIDEO_TRACK_COUNT;
			const videoFrame = random() % (VIDEO_MOVE_SLACK_FRAMES + 1);
			const timelineSample = videoFrame * VIDEO_FRAME_SAMPLES;
			commands.push(Object.freeze({
				type: 'clip/move',
				clipId: videoClipId(trackIndex),
				trackId: videoTrackId(trackIndex),
				timelineStartFrame: timelineSample,
			}));
			expected.set(videoClipId(trackIndex), {
				clipId: videoClipId(trackIndex), kind: 'video', timelineSample, videoFrame,
			});
			operationCounts.proxyVideoClipMoves += 1;
		} else if (operation === 2) {
			const trackIndex = random() % AUDIO_TRACK_COUNT;
			commands.push(Object.freeze({
				type: 'track/update',
				trackId: audioTrackId(trackIndex),
				changes: Object.freeze({
					gain: 0.5 + (random() % 501) / 1_000,
					pan: (random() % 2_001 - 1_000) / 1_000,
					mute: (random() & 1) === 1,
				}),
			}));
			operationCounts.trackMixChanges += 1;
		} else {
			const trackIndex = random() % AUDIO_TRACK_COUNT;
			const startFrame = random() % (DURATION_SAMPLES - SAMPLE_RATE);
			commands.push(Object.freeze({
				type: 'selection/set',
				startFrame,
				endFrame: startFrame + SAMPLE_RATE,
				trackIds: Object.freeze([audioTrackId(trackIndex)]),
				clipIds: Object.freeze([audioClipId(trackIndex)]),
			}));
			operationCounts.selectionChanges += 1;
		}
	}
	return Object.freeze({
		commands: Object.freeze(commands),
		expectedClipPositions: Object.freeze([...expected.values()].map((entry) => Object.freeze(entry))),
		operationCounts: Object.freeze(operationCounts),
	});
}

/** Replay the complete plan through ordinary command batches with deterministic commit times. */
export function applyM3LongformEditorialEditPlan(
	project: SoundscaperProject,
	plan: M3LongformEditorialEditPlan,
): SoundscaperProject {
	let next = project;
	for (let offset = 0; offset < plan.commands.length; offset += COMMANDS_PER_TRANSACTION) {
		next = applySoundscaperProjectCommand(next, {
			type: 'batch',
			commands: plan.commands.slice(offset, offset + COMMANDS_PER_TRANSACTION),
		}, { now: new Date(offset) });
	}
	return next;
}

/** Compare the final persisted/runtime coordinates with the plan's independent oracle. */
export function resolveM3LongformEditorialPositionChecks(
	project: SoundscaperProject,
	plan: M3LongformEditorialEditPlan,
): readonly M3LongformEditorialPositionCheck[] {
	const clipById = new Map(project.clips.map((clip) => [String(clip.id), clip]));
	return Object.freeze(plan.expectedClipPositions.map((expected) => {
		const clip = clipById.get(expected.clipId);
		if (!clip) throw new ReferenceError(`Long-form position oracle references missing clip ${expected.clipId}.`);
		const projection = resolveRuntimeClipProjection(project, clip);
		const observedVideoFrame = expected.kind === 'video'
			? sampleFrameToVideoFrame(projection.timelineStartFrame, VIDEO_RATE, SAMPLE_RATE, 'point')
			: null;
		return Object.freeze({
			...expected,
			observedTimelineSample: projection.timelineStartFrame,
			observedVideoFrame,
			audioPositionErrorSamples: Math.abs(projection.timelineStartFrame - expected.timelineSample),
			videoPositionErrorFrames: expected.videoFrame === null || observedVideoFrame === null
				? 0
				: Math.abs(observedVideoFrame - expected.videoFrame),
		});
	}));
}

export function createM3LongformEditorialWorkload(): Readonly<{
	readonly specification: M3LongformEditorialSpecification;
	readonly editPlan: M3LongformEditorialEditPlan;
	readonly project: SoundscaperProject;
	readonly positionChecks: readonly M3LongformEditorialPositionCheck[];
}> {
	const editPlan = createM3LongformEditorialEditPlan();
	const project = applyM3LongformEditorialEditPlan(createM3LongformEditorialBaseProject(), editPlan);
	return Object.freeze({
		specification: M3_LONGFORM_EDITORIAL_SPECIFICATION,
		editPlan,
		project,
		positionChecks: resolveM3LongformEditorialPositionChecks(project, editPlan),
	});
}

function initialExpectedPositions(): Map<string, M3LongformEditorialExpectedClipPosition> {
	const result = new Map<string, M3LongformEditorialExpectedClipPosition>();
	for (let index = 0; index < AUDIO_TRACK_COUNT; index += 1) {
		result.set(audioClipId(index), {
			clipId: audioClipId(index), kind: 'audio', timelineSample: 0, videoFrame: null,
		});
	}
	for (let index = 0; index < VIDEO_TRACK_COUNT; index += 1) {
		result.set(videoClipId(index), {
			clipId: videoClipId(index), kind: 'video', timelineSample: 0, videoFrame: 0,
		});
	}
	return result;
}

function xorshift32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return state >>> 0;
	};
}

function audioSourceId(index: number): string { return `m3-longform-audio-source-${String(index).padStart(2, '0')}`; }
function audioClipId(index: number): string { return `m3-longform-audio-clip-${String(index).padStart(2, '0')}`; }
function audioTrackId(index: number): string { return `m3-longform-audio-track-${String(index).padStart(2, '0')}`; }
function videoSourceId(index: number): string { return `m3-longform-video-source-${String(index).padStart(2, '0')}`; }
function videoClipId(index: number): string { return `m3-longform-video-clip-${String(index).padStart(2, '0')}`; }
function videoTrackId(index: number): string { return `m3-longform-video-track-${String(index).padStart(2, '0')}`; }
