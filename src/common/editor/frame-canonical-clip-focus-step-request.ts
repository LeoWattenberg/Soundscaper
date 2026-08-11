/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	deepFreeze,
	frameTrimRecord,
	indexFrameTrimProject,
	nonEmptyString,
	safeAdd,
	type FrameCanonicalEdgeTrimRequest,
	type FrameCanonicalTrimEdge,
	type FrameTrimDataRecord,
} from './frame-canonical-edge-trim-domain.ts';
import {
	frameCanonicalTrimParticipant,
} from './frame-canonical-trim-planning.ts';
import { isRuntimeProjectProjection } from './runtime-clip-projection.ts';
import { videoFrameToSampleFrame } from './timeline-time.ts';

export type FrameCanonicalClipFocusDirection = 'outward' | 'inward';

export interface FrameCanonicalClipFocusIntent {
	readonly edge: FrameCanonicalTrimEdge;
	readonly direction: FrameCanonicalClipFocusDirection;
}

export interface FrameCanonicalClipFocusStep extends FrameCanonicalClipFocusIntent {
	readonly activeClipId: string;
}

/** Convert the existing vendor callback shape into a strict sign-only intent. */
export function resolveFrameCanonicalClipFocusIntent(
	edgeValue: unknown,
	callbackDeltaSeconds: unknown,
): Readonly<FrameCanonicalClipFocusIntent> {
	const edge = trimEdge(edgeValue);
	if (typeof callbackDeltaSeconds !== 'number'
		|| !Number.isFinite(callbackDeltaSeconds)
		|| callbackDeltaSeconds === 0) {
		throw new RangeError('The clip-focus callback delta must be a finite non-zero number.');
	}
	return Object.freeze({
		edge,
		direction: callbackDeltaSeconds < 0 ? 'outward' : 'inward',
	});
}

/** Build one absolute adjacent-frame request from a focused linked-audio authority. */
export function buildFrameCanonicalClipFocusStepRequest(
	projectValue: unknown,
	step: FrameCanonicalClipFocusStep,
): Readonly<FrameCanonicalEdgeTrimRequest> {
	if (!isRuntimeProjectProjection(projectValue)) {
		throw new TypeError('A frame-canonical clip-focus step requires the branded command projection.');
	}
	const project = frameTrimRecord(projectValue, 'project');
	const activeClipId = nonEmptyString(step?.activeClipId, 'step.activeClipId');
	const edge = trimEdge(step?.edge);
	const direction = stepDirection(step?.direction);
	const index = indexFrameTrimProject(project);
	const activeClip = index.clipById.get(activeClipId);
	if (!activeClip) throw new ReferenceError(`Unknown active clip: ${activeClipId}.`);
	if (activeClip.kind !== 'audio') {
		throw new RangeError('A frame-canonical clip-focus step requires a focused linked audio clip.');
	}
	const avLinkId = relationId(activeClip.avLinkId);
	if (!avLinkId) {
		throw new RangeError(`Focused audio clip ${activeClipId} has no exact A/V link.`);
	}
	const linked = index.clips.filter((clip) => clip.avLinkId === avLinkId);
	const linkedAudio = linked.filter((clip) => clip.kind === 'audio');
	const linkedVideo = linked.filter((clip) => clip.kind === 'video');
	if (linked.length !== 2 || linkedAudio.length !== 1 || linkedVideo.length !== 1
		|| linkedAudio[0]?.id !== activeClipId) {
		throw new RangeError(`A/V link ${avLinkId} requires exactly one focused audio and one video companion.`);
	}
	const audio = frameCanonicalTrimParticipant(index, activeClipId);
	const video = frameCanonicalTrimParticipant(
		index,
		nonEmptyString(linkedVideo[0]?.id, `A/V link ${avLinkId} video clip ID`),
	);
	assertExactTimelineLink(audio.clip, audio.track, video.clip, video.track, avLinkId);
	const authority = video.video!;
	const currentFrame = edge === 'left' ? authority.sequenceStart : authority.sequenceEnd;
	const delta = direction === 'outward'
		? edge === 'left' ? -1 : 1
		: edge === 'left' ? 1 : -1;
	const targetFrame = safeAdd(currentFrame, delta, 'clip-focus target sequence frame');
	return deepFreeze({
		activeClipId,
		edge,
		requestedBoundarySample: videoFrameToSampleFrame(
			targetFrame,
			authority.sequenceRate,
			index.sampleRate,
			'point',
		),
	});
}

function assertExactTimelineLink(
	audio: FrameTrimDataRecord,
	audioTrack: FrameTrimDataRecord,
	video: FrameTrimDataRecord,
	videoTrack: FrameTrimDataRecord,
	avLinkId: string,
): void {
	const audioLaneGroupId = relationId(audioTrack.laneGroupId);
	const videoLaneGroupId = relationId(videoTrack.laneGroupId);
	if (!audioLaneGroupId || audioLaneGroupId !== videoLaneGroupId) {
		throw new RangeError(`A/V link ${avLinkId} must use one media lane group.`);
	}
	if (audio.timelineStartFrame !== video.timelineStartFrame
		|| audio.durationFrames !== video.durationFrames) {
		throw new RangeError(`A/V link ${avLinkId} must have identical presentation endpoints.`);
	}
}

function trimEdge(value: unknown): FrameCanonicalTrimEdge {
	if (value !== 'left' && value !== 'right') {
		throw new RangeError(`Unsupported clip-focus edge: ${String(value)}.`);
	}
	return value;
}

function stepDirection(value: unknown): FrameCanonicalClipFocusDirection {
	if (value !== 'outward' && value !== 'inward') {
		throw new RangeError(`Unsupported clip-focus direction: ${String(value)}.`);
	}
	return value;
}

function relationId(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}
