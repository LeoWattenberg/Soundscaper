/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectClipTrimIds as collectLegacyClipTrimIds } from './commands/clip-basic-runtime.js';
import {
	deepFreeze,
	frameTrimRecord,
	indexFrameTrimProject,
	nonEmptyString,
	safeAdd,
	safeDifference,
	safeInteger,
	sameFrameTrimRate,
	type FrameCanonicalEdgeTrimPlan,
	type FrameCanonicalEdgeTrimPreview,
	type FrameCanonicalEdgeTrimRequest,
	type FrameCanonicalEdgeTrimTransform,
	type FrameCanonicalTrimEdge,
	type FrameTrimDataRecord,
	type FrameTrimProjectIndex,
} from './frame-canonical-edge-trim-domain.ts';
import {
	boundFrameCanonicalVideoTimelineDelta,
	closestLegalFrameDelta,
	frameCanonicalLinkedVideoCompanions,
	frameCanonicalTrimParticipant,
	frameCanonicalVideoAuthority,
	planFrameCanonicalParticipantEdge,
	validateFrameCanonicalVideoTracks,
	type FrameCanonicalTrimParticipant,
} from './frame-canonical-trim-planning.ts';
import { isRuntimeProjectProjection } from './runtime-clip-projection.ts';
import {
	sampleFrameToVideoFrame,
	videoFrameToSampleFrame,
} from './timeline-time.ts';

export type {
	FrameCanonicalEdgeTrimNoop,
	FrameCanonicalEdgeTrimPlan,
	FrameCanonicalEdgeTrimPreview,
	FrameCanonicalEdgeTrimRequest,
	FrameCanonicalEdgeTrimTransform,
	FrameCanonicalEdgeTrimTransformPlan,
	FrameCanonicalTrackLockPredicate,
	FrameCanonicalTrimEdge,
} from './frame-canonical-edge-trim-domain.ts';

type DataRecord = FrameTrimDataRecord;
type ProjectIndex = FrameTrimProjectIndex;
type Participant = FrameCanonicalTrimParticipant;

interface Candidate {
	readonly transforms: readonly FrameCanonicalEdgeTrimTransform[];
	readonly previews: readonly FrameCanonicalEdgeTrimPreview[];
}

const collectClipTrimIds = collectLegacyClipTrimIds as unknown as (
	project: DataRecord,
	activeClipId: string,
	edge: FrameCanonicalTrimEdge,
) => string[];

/** Plan one video-bearing edge trim without mutating the command projection. */
export function planFrameCanonicalEdgeTrim(
	projectValue: unknown,
	request: FrameCanonicalEdgeTrimRequest,
): FrameCanonicalEdgeTrimPlan {
	if (!isRuntimeProjectProjection(projectValue)) {
		throw new TypeError('A frame-canonical trim requires the branded command projection.');
	}
	const project = frameTrimRecord(projectValue, 'project');
	const activeClipId = nonEmptyString(request?.activeClipId, 'request.activeClipId');
	const edge = trimEdge(request?.edge);
	const requestedBoundarySample = safeInteger(
		request?.requestedBoundarySample,
		'request.requestedBoundarySample',
	);
	if (request.isTrackLocked != null && typeof request.isTrackLocked !== 'function') {
		throw new TypeError('request.isTrackLocked must be a function.');
	}
	const index = indexFrameTrimProject(project);
	const activeClip = index.clipById.get(activeClipId);
	if (!activeClip) throw new ReferenceError(`Unknown active clip: ${activeClipId}.`);
	if (!index.trackByClipId.has(activeClipId)) {
		throw new RangeError(`Active clip ${activeClipId} has no timeline track ownership.`);
	}
	const participantClipIds = collectClipTrimIds(project, activeClipId, edge);
	if (!participantClipIds.length) throw new RangeError(`Active clip ${activeClipId} cannot be trimmed.`);
	const participants = participantClipIds.map((clipId) => frameCanonicalTrimParticipant(index, clipId));
	for (const item of participants) {
		if (request.isTrackLocked?.(item.trackId)) {
			throw new RangeError(`Track ${item.trackId} is locked.`);
		}
	}
	const videos = participants.filter((item) => item.video !== null);
	if (!videos.length) throw new RangeError('A frame-canonical edge trim requires a video participant.');
	const authority = frameCanonicalVideoAuthority(activeClip, videos);
	const authorityVideo = authority.video!;
	for (const item of videos) {
		if (item.video!.sequenceId !== authorityVideo.sequenceId
				|| !sameFrameTrimRate(item.video!.sequenceRate, authorityVideo.sequenceRate)) {
			throw new RangeError('Participating video clips must use one sequence and rate.');
		}
	}
	const linkedVideoByAudioClipId = frameCanonicalLinkedVideoCompanions(participants, videos);
	const videoTrackIds = new Set(videos.map(({ trackId }) => trackId));
	validateFrameCanonicalVideoTracks(index, videoTrackIds);

	const active = participants.find(({ clipId }) => clipId === activeClipId)!;
	const activeBoundary = edge === 'left' ? active.timelineStart : active.timelineEnd;
	const requestedSampleDelta = safeDifference(
		requestedBoundarySample,
		activeBoundary,
		'requested sample delta',
	);
	const authorityBoundary = edge === 'left' ? authority.timelineStart : authority.timelineEnd;
	const requestedAuthorityBoundary = safeAdd(
		authorityBoundary,
		requestedSampleDelta,
		'requested authority boundary',
	);
	const requestedSequenceFrame = sampleFrameToVideoFrame(
		requestedAuthorityBoundary,
		authorityVideo.sequenceRate,
		index.sampleRate,
		'point',
	);
	const authoritySequenceBoundary = edge === 'left'
		? authorityVideo.sequenceStart
		: authorityVideo.sequenceEnd;
	const requestedFrameDelta = safeDifference(
		requestedSequenceFrame,
		authoritySequenceBoundary,
		'requested sequence-frame delta',
	);
	const rangeBoundedDelta = boundFrameCanonicalVideoTimelineDelta(videos, edge, requestedFrameDelta);
	const build = (delta: number): Candidate | null => {
		try {
			return buildCandidate(
				index, participants, authority, edge, delta,
				videoTrackIds, linkedVideoByAudioClipId,
			);
		} catch (error: unknown) {
			// The original ranges were admitted above. A candidate-only overflow is
			// therefore another finite handle bound and clamps toward zero.
			if (error instanceof RangeError) return null;
			throw error;
		}
	};
	const { delta: sequenceFrameDelta, candidate } = closestLegalFrameDelta(rangeBoundedDelta, build);
	const appliedSequenceFrame = safeAdd(
		authoritySequenceBoundary,
		sequenceFrameDelta,
		'applied sequence boundary',
	);
	const boundarySample = videoFrameToSampleFrame(
		appliedSequenceFrame,
		authorityVideo.sequenceRate,
		index.sampleRate,
		'point',
	);
	const resolvedSampleDelta = safeDifference(
		boundarySample,
		authorityBoundary,
		'resolved sample delta',
	);
	const diagnostics = {
		activeClipId,
		edge,
		sequenceId: authorityVideo.sequenceId,
		requestedBoundarySample,
		requestedSequenceFrame,
		appliedSequenceFrame,
		sequenceFrameDelta,
		resolvedSampleDelta,
		boundarySample,
		clamped: sequenceFrameDelta !== requestedFrameDelta,
		participantClipIds: [...participantClipIds],
	};
	if (sequenceFrameDelta === 0) {
		return deepFreeze({ ...diagnostics, kind: 'noop' as const, transforms: [], previews: [] });
	}
	if (!candidate) throw new RangeError('The applied trim delta has no valid candidate.');
	return deepFreeze({
		...diagnostics,
		kind: 'transform' as const,
		transforms: [...candidate.transforms],
		previews: [...candidate.previews],
	});
}

function buildCandidate(
	index: ProjectIndex,
	participants: readonly Participant[],
	authority: Participant,
	edge: FrameCanonicalTrimEdge,
	delta: number,
	videoTrackIds: ReadonlySet<string>,
	linkedVideoByAudioClipId: ReadonlyMap<string, Participant>,
): Candidate | null {
	const authorityVideo = authority.video!;
	const authorityBase = edge === 'left' ? authorityVideo.sequenceStart : authorityVideo.sequenceEnd;
	const appliedAuthorityFrame = safeAdd(authorityBase, delta, 'candidate authority boundary');
	const boundarySample = videoFrameToSampleFrame(
		appliedAuthorityFrame,
		authorityVideo.sequenceRate,
		index.sampleRate,
		'point',
	);
	const authoritySample = edge === 'left' ? authority.timelineStart : authority.timelineEnd;
	const resolvedSampleDelta = safeDifference(boundarySample, authoritySample, 'candidate sample delta');
	const transforms: FrameCanonicalEdgeTrimTransform[] = [];
	const previews: FrameCanonicalEdgeTrimPreview[] = [];
	const projectedClips = new Map(index.clipById);
	for (const item of participants) {
		const planned = planFrameCanonicalParticipantEdge(
			index,
			item,
			edge,
			delta,
			resolvedSampleDelta,
			linkedVideoByAudioClipId.get(item.clipId),
		);
		if (!planned) return null;
		transforms.push(planned.transform);
		previews.push(planned.preview);
		if (item.video) projectedClips.set(item.clipId, { ...item.clip, ...planned.preview });
	}
	try {
		validateFrameCanonicalVideoTracks(index, videoTrackIds, projectedClips);
	} catch (error: unknown) {
		if (error instanceof RangeError) return null;
		throw error;
	}
	return { transforms, previews };
}

function trimEdge(value: unknown): FrameCanonicalTrimEdge {
	if (value !== 'left' && value !== 'right') throw new RangeError(`Unsupported trim edge: ${String(value)}.`);
	return value;
}
