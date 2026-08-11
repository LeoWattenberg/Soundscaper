/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	deepFreeze,
	frameTrimRecord,
	indexFrameTrimProject,
	nonEmptyString,
	safeAdd,
	safeDifference,
	safeInteger,
	sameFrameTrimRate,
	type FrameCanonicalEdgeTrimTransform,
	type FrameCanonicalTrimEdge,
	type FrameTrimDataRecord,
	type FrameTrimProjectIndex,
} from './frame-canonical-edge-trim-domain.ts';
import {
	boundFrameCanonicalVideoTimelineDelta,
	closestLegalFrameDelta,
	frameCanonicalLinkedVideoCompanions,
	frameCanonicalPreview,
	frameCanonicalTrimParticipant,
	frameCanonicalVideoAuthority,
	planFrameCanonicalParticipantEdge,
	validateFrameCanonicalVideoTracks,
	type FrameCanonicalPlannedEdge,
	type FrameCanonicalTrimParticipant,
} from './frame-canonical-trim-planning.ts';
import {
	type FrameCanonicalRollRippleTrimMode,
	type FrameCanonicalRollRippleTrimPlan,
	type FrameCanonicalRollRippleTrimPreview,
	type FrameCanonicalRollRippleTrimRequest,
} from './frame-canonical-roll-ripple-trim-domain.ts';
import {
	resolveFrameCanonicalRollRippleTrimTargets,
	type FrameCanonicalRollRippleTrimTargets,
} from './frame-canonical-roll-ripple-trim-targets.ts';
import { isTrackLockProjectSchema } from './project-schema-version.ts';
import { isRuntimeProjectProjection } from './runtime-clip-projection.ts';
import { sampleFrameToVideoFrame, videoFrameToSampleFrame } from './timeline-time.ts';

export type {
	FrameCanonicalRollRippleTrimMode,
	FrameCanonicalRollRippleTrimNoop,
	FrameCanonicalRollRippleTrimPlan,
	FrameCanonicalRollRippleTrimPreview,
	FrameCanonicalRollRippleTrimRequest,
	FrameCanonicalRollRippleTrimTransform,
	FrameCanonicalRollRippleTrimTransformPlan,
} from './frame-canonical-roll-ripple-trim-domain.ts';

type ProjectIndex = FrameTrimProjectIndex;
type Participant = FrameCanonicalTrimParticipant;

type Targets = FrameCanonicalRollRippleTrimTargets;

interface Candidate {
	readonly transforms: readonly FrameCanonicalEdgeTrimTransform[];
	readonly previews: readonly FrameCanonicalRollRippleTrimPreview[];
}

/** Plan one video-bearing roll or lane-ripple trim from immutable command authority. */
export function planFrameCanonicalRollRippleTrim(
	projectValue: unknown,
	request: FrameCanonicalRollRippleTrimRequest,
): FrameCanonicalRollRippleTrimPlan {
	if (!isRuntimeProjectProjection(projectValue)) {
		throw new TypeError('A frame-canonical roll/ripple trim requires the branded command projection.');
	}
	const project = frameTrimRecord(projectValue, 'project');
	const activeClipId = nonEmptyString(request?.activeClipId, 'request.activeClipId');
	const mode = trimMode(request?.mode);
	const edge = trimEdge(request?.edge);
	const requestedBoundarySample = safeInteger(
		request?.requestedBoundarySample,
		'request.requestedBoundarySample',
	);
	if (request.isTrackLocked != null && typeof request.isTrackLocked !== 'function') {
		throw new TypeError('request.isTrackLocked must be a function.');
	}
	const index = indexFrameTrimProject(project);
	const active = frameCanonicalTrimParticipant(index, activeClipId);
	const targets = resolveFrameCanonicalRollRippleTrimTargets(project, index, active, mode, edge);
	const affected = [...targets.edge, ...targets.neighbors, ...targets.shifted];
	assertUnlocked(project, affected, request.isTrackLocked);
	const edgeVideos = targets.edge.filter(({ video }) => video !== null);
	if (!edgeVideos.length) throw new RangeError('A frame-canonical roll/ripple trim requires a video edge participant.');
	const authority = frameCanonicalVideoAuthority(active.clip, edgeVideos);
	const authorityVideo = authority.video!;
	assertCommonVideoAuthority(affected, authority);
	assertCanonicalEditPoint(targets, authority, edge);
	assertLinkCompanions(targets);
	const affectedVideoTrackIds = new Set(
		affected.filter(({ video }) => video !== null).map(({ trackId }) => trackId),
	);
	validateFrameCanonicalVideoTracks(index, affectedVideoTrackIds);

	const requestedSequenceFrame = sampleFrameToVideoFrame(
		requestedBoundarySample,
		authorityVideo.sequenceRate,
		index.sampleRate,
		'point',
	);
	const authoritySequenceBoundary = edge === 'left'
		? authorityVideo.sequenceStart
		: authorityVideo.sequenceEnd;
	const requestedFrameDelta = saturatedSafeDifference(
		requestedSequenceFrame,
		authoritySequenceBoundary,
	);
	const boundedDelta = boundOperationDelta(targets, edge, requestedFrameDelta);
	const build = (delta: number): Candidate | null => {
		try {
			return buildCandidate(index, targets, authority, mode, edge, delta, affectedVideoTrackIds);
		} catch (error: unknown) {
			if (error instanceof RangeError) return null;
			throw error;
		}
	};
	const { delta: sequenceFrameDelta, candidate } = closestLegalFrameDelta(boundedDelta, build);
	const appliedSequenceFrame = safeAdd(
		authoritySequenceBoundary,
		sequenceFrameDelta,
		'applied roll/ripple sequence boundary',
	);
	const resolvedSourceCutSample = videoFrameToSampleFrame(
		appliedSequenceFrame,
		authorityVideo.sequenceRate,
		index.sampleRate,
		'point',
	);
	const programFrameDelta = mode === 'roll' ? 0 : edge === 'right'
		? sequenceFrameDelta
		: -sequenceFrameDelta;
	const programEditSample = operationProgramEditSample(
		index, authority, mode, edge, sequenceFrameDelta, resolvedSourceCutSample,
	);
	const resolvedProgramSampleDelta = mode === 'roll' ? 0 : edge === 'right'
		? safeDifference(resolvedSourceCutSample, authority.timelineEnd, 'right ripple program sample delta')
		: safeDifference(authority.timelineStart, resolvedSourceCutSample, 'left ripple program sample delta');
	const diagnostics = {
		mode,
		activeClipId,
		edge,
		sequenceId: authorityVideo.sequenceId,
		sequenceRate: { ...authorityVideo.sequenceRate },
		requestedBoundarySample,
		requestedSequenceFrame,
		appliedSequenceFrame,
		sequenceFrameDelta,
		programFrameDelta,
		resolvedProgramSampleDelta,
		resolvedSourceCutSample,
		programEditSample,
		clamped: sequenceFrameDelta !== requestedFrameDelta,
		edgeClipIds: targets.edge.map(({ clipId }) => clipId),
		neighborClipIds: targets.neighbors.map(({ clipId }) => clipId),
		shiftedClipIds: targets.shifted.map(({ clipId }) => clipId),
	};
	if (sequenceFrameDelta === 0) {
		return deepFreeze({ ...diagnostics, kind: 'noop' as const, transforms: [], previews: [] });
	}
	if (!candidate) throw new RangeError('The applied roll/ripple delta has no valid candidate.');
	return deepFreeze({
		...diagnostics,
		kind: 'transform' as const,
		transforms: [...candidate.transforms],
		previews: [...candidate.previews],
	});
}

function buildCandidate(
	index: ProjectIndex,
	targets: Targets,
	authority: Participant,
	mode: FrameCanonicalRollRippleTrimMode,
	edge: FrameCanonicalTrimEdge,
	delta: number,
	videoTrackIds: ReadonlySet<string>,
): Candidate | null {
	const authorityVideo = authority.video!;
	const authorityBase = edge === 'left' ? authorityVideo.sequenceStart : authorityVideo.sequenceEnd;
	const sourceCutSample = videoFrameToSampleFrame(
		safeAdd(authorityBase, delta, 'candidate source-cut frame'),
		authorityVideo.sequenceRate,
		index.sampleRate,
		'point',
	);
	const resolvedEdgeDelta = safeDifference(
		sourceCutSample,
		edge === 'left' ? authority.timelineStart : authority.timelineEnd,
		'candidate edge sample delta',
	);
	const plannedById = new Map<string, FrameCanonicalPlannedEdge>();
	if (mode === 'ripple' && edge === 'left') {
		planLeftRippleBlock(
			index,
			targets.edge,
			delta,
			resolvedEdgeDelta,
			safeDifference(authority.timelineStart, sourceCutSample, 'left ripple candidate program delta'),
			plannedById,
		);
	} else planTrimBlock(index, targets.edge, edge, delta, resolvedEdgeDelta, plannedById);
	if (mode === 'roll') {
		planTrimBlock(index, targets.neighbors, oppositeEdge(edge), delta, resolvedEdgeDelta, plannedById);
	} else {
		const programDelta = edge === 'right'
			? resolvedEdgeDelta
			: safeDifference(authority.timelineStart, sourceCutSample, 'left ripple candidate program delta');
		planSuffix(index, targets.shifted, edge === 'right' ? delta : -delta, programDelta, plannedById);
	}
	if (plannedById.size !== targets.edge.length + targets.neighbors.length + targets.shifted.length) return null;
	const ordered = index.clips
		.map((clip) => plannedById.get(nonEmptyString(clip.id, 'clip.id')))
		.filter((planned): planned is FrameCanonicalPlannedEdge => planned !== undefined);
	const projectedClips = new Map(index.clipById);
	for (const planned of ordered) {
		const original = index.clipById.get(planned.transform.clipId)!;
		if (original.kind === 'video') projectedClips.set(planned.transform.clipId, { ...original, ...planned.preview });
	}
	try {
		validateFrameCanonicalVideoTracks(index, videoTrackIds, projectedClips);
	} catch (error: unknown) {
		if (error instanceof RangeError) return null;
		throw error;
	}
	return {
		transforms: ordered.map(({ transform }) => omitUnchangedTransform(index, transform)),
		previews: ordered.map(({ preview }) => ({
			...preview,
			changeKind: targets.shifted.some(({ clipId }) => clipId === preview.clipId)
				? 'placement-only' as const
				: 'source-trim' as const,
		})),
	};
}

function omitUnchangedTransform(
	index: ProjectIndex,
	transform: FrameCanonicalEdgeTrimTransform,
): FrameCanonicalEdgeTrimTransform {
	const clip = index.clipById.get(transform.clipId);
	if (!clip) throw new ReferenceError(`Missing planned clip ${transform.clipId}.`);
	const changes = Object.fromEntries(
		Object.entries(transform.changes).filter(([field, value]) => clip[field] !== value),
	);
	return { ...transform, changes };
}

function planTrimBlock(
	index: ProjectIndex,
	participants: readonly Participant[],
	edge: FrameCanonicalTrimEdge,
	delta: number,
	resolvedSampleDelta: number,
	result: Map<string, FrameCanonicalPlannedEdge>,
): void {
	const videos = participants.filter(({ video }) => video !== null);
	const linked = frameCanonicalLinkedVideoCompanions(participants, videos);
	for (const item of participants) {
		const planned = planFrameCanonicalParticipantEdge(
			index, item, edge, delta, resolvedSampleDelta, linked.get(item.clipId),
		);
		if (!planned) return;
		result.set(item.clipId, planned);
	}
}

function planLeftRippleBlock(
	index: ProjectIndex,
	participants: readonly Participant[],
	delta: number,
	resolvedSourceEdgeDelta: number,
	resolvedProgramSampleDelta: number,
	result: Map<string, FrameCanonicalPlannedEdge>,
): void {
	const videos = participants.filter(({ video }) => video !== null);
	const linked = frameCanonicalLinkedVideoCompanions(participants, videos);
	const sourcePlanById = new Map<string, FrameCanonicalPlannedEdge>();
	for (const item of participants) {
		const planned = planFrameCanonicalParticipantEdge(
			index, item, 'left', delta, resolvedSourceEdgeDelta, linked.get(item.clipId),
		);
		if (!planned) return;
		sourcePlanById.set(item.clipId, planned);
	}
	const finalVideoById = new Map<string, FrameCanonicalPlannedEdge>();
	for (const item of videos) {
		const sourcePlan = sourcePlanById.get(item.clipId)!;
		const finalEndFrame = safeAdd(item.video!.sequenceEnd, -delta, `left ripple clip ${item.clipId} end frame`);
		if (finalEndFrame <= item.video!.sequenceStart) return;
		const finalEnd = videoFrameToSampleFrame(
			finalEndFrame, item.video!.sequenceRate, index.sampleRate, 'point',
		);
		const changes: Record<string, unknown> = {
			...sourcePlan.transform.changes,
			durationFrames: finalEnd - item.timelineStart,
		};
		delete changes.timelineStartFrame;
		const planned = {
			transform: {
				...sourcePlan.transform,
				changes,
				sequencePlacement: {
					sequenceStartFrame: item.video!.sequenceStart,
					sequenceFrameCount: finalEndFrame - item.video!.sequenceStart,
				},
			},
			preview: {
				...sourcePlan.preview,
				timelineStartFrame: item.timelineStart,
				durationFrames: finalEnd - item.timelineStart,
			},
		};
		finalVideoById.set(item.clipId, planned);
		result.set(item.clipId, planned);
	}
	for (const item of participants) {
		if (item.video) continue;
		const sourcePlan = sourcePlanById.get(item.clipId)!;
		const companion = linked.get(item.clipId);
		const linkedPlan = companion ? finalVideoById.get(companion.clipId) : undefined;
		if (companion && !linkedPlan) throw new RangeError(`Linked left-ripple audio ${item.clipId} has no video plan.`);
		const timelineEnd = linkedPlan
			? safeAdd(
				linkedPlan.preview.timelineStartFrame,
				linkedPlan.preview.durationFrames,
				`left ripple linked audio ${item.clipId} end`,
			)
			: safeAdd(item.timelineEnd, resolvedProgramSampleDelta, `left ripple audio ${item.clipId} end`);
		if (timelineEnd <= item.timelineStart) return;
		const durationFrames = timelineEnd - item.timelineStart;
		const fadeInFrames = Math.min(item.fadeIn, durationFrames);
		const fadeOutFrames = Math.min(item.fadeOut, durationFrames);
		const changes: Record<string, unknown> = {
			...sourcePlan.transform.changes,
			durationFrames,
			fadeInFrames,
			fadeOutFrames,
		};
		delete changes.timelineStartFrame;
		result.set(item.clipId, {
			transform: { ...sourcePlan.transform, changes },
			preview: {
				...sourcePlan.preview,
				timelineStartFrame: item.timelineStart,
				durationFrames,
				fadeInFrames,
				fadeOutFrames,
			},
		});
	}
}

function planSuffix(
	index: ProjectIndex,
	participants: readonly Participant[],
	programFrameDelta: number,
	resolvedProgramSampleDelta: number,
	result: Map<string, FrameCanonicalPlannedEdge>,
): void {
	const videos = participants.filter(({ video }) => video !== null);
	const shiftedVideoByAvLinkId = new Map<string, FrameCanonicalPlannedEdge>();
	for (const item of videos) {
		const video = item.video!;
		const start = safeAdd(video.sequenceStart, programFrameDelta, `suffix clip ${item.clipId} sequence start`);
		const end = safeAdd(video.sequenceEnd, programFrameDelta, `suffix clip ${item.clipId} sequence end`);
		if (start < 0 || end <= start) return;
		const timelineStart = videoFrameToSampleFrame(start, video.sequenceRate, index.sampleRate, 'point');
		const timelineEnd = videoFrameToSampleFrame(end, video.sequenceRate, index.sampleRate, 'point');
		const preview = frameCanonicalPreview(item, timelineStart, timelineEnd);
		const changes: Record<string, unknown> = { timelineStartFrame: timelineStart };
		if (preview.durationFrames !== item.timelineEnd - item.timelineStart) changes.durationFrames = preview.durationFrames;
		const planned = {
			transform: {
				clipId: item.clipId,
				trackId: item.trackId,
				changes,
				sequencePlacement: {
					sequenceStartFrame: start,
					sequenceFrameCount: end - start,
				},
			},
			preview,
		};
		result.set(item.clipId, planned);
		const avLinkId = relationId(item.clip.avLinkId);
		if (avLinkId) {
			if (shiftedVideoByAvLinkId.has(avLinkId)) throw new RangeError(`A/V link ${avLinkId} has multiple suffix videos.`);
			shiftedVideoByAvLinkId.set(avLinkId, planned);
		}
	}
	for (const item of participants) {
		if (item.video) continue;
		const avLinkId = relationId(item.clip.avLinkId);
		const linkedVideo = avLinkId
			? shiftedVideoByAvLinkId.get(avLinkId)
			: undefined;
		if (avLinkId && !linkedVideo) throw new RangeError(`Linked suffix audio ${item.clipId} has no shifted video.`);
		const timelineStart = linkedVideo?.preview.timelineStartFrame
			?? safeAdd(item.timelineStart, resolvedProgramSampleDelta, `suffix clip ${item.clipId} start`);
		const timelineEnd = linkedVideo
			? safeAdd(timelineStart, linkedVideo.preview.durationFrames, `suffix clip ${item.clipId} linked end`)
			: safeAdd(item.timelineEnd, resolvedProgramSampleDelta, `suffix clip ${item.clipId} end`);
		if (timelineStart < 0 || timelineEnd <= timelineStart) return;
		if (item.fadeIn > timelineEnd - timelineStart || item.fadeOut > timelineEnd - timelineStart) return;
		const preview = frameCanonicalPreview(item, timelineStart, timelineEnd);
		const changes: Record<string, unknown> = { timelineStartFrame: timelineStart };
		if (preview.durationFrames !== item.timelineEnd - item.timelineStart) changes.durationFrames = preview.durationFrames;
		result.set(item.clipId, { transform: { clipId: item.clipId, trackId: item.trackId, changes }, preview });
	}
}

function boundOperationDelta(
	targets: Targets,
	edge: FrameCanonicalTrimEdge,
	requestedDelta: number,
): number {
	let bounded = boundFrameCanonicalVideoTimelineDelta(
		targets.edge.filter(({ video }) => video !== null), edge, requestedDelta,
	);
	if (targets.neighbors.length) {
		bounded = boundFrameCanonicalVideoTimelineDelta(
			targets.neighbors.filter(({ video }) => video !== null), oppositeEdge(edge), bounded,
		);
	}
	return bounded;
}

function assertCanonicalEditPoint(
	targets: Targets,
	authority: Participant,
	edge: FrameCanonicalTrimEdge,
): void {
	const authorityBoundary = edge === 'left' ? authority.video!.sequenceStart : authority.video!.sequenceEnd;
	for (const item of targets.edge) {
		if (!item.video) continue;
		const boundary = edge === 'left' ? item.video.sequenceStart : item.video.sequenceEnd;
		if (boundary !== authorityBoundary) throw new RangeError('Video edge participants must share one sequence-frame boundary.');
	}
	for (const item of targets.neighbors) {
		if (!item.video) continue;
		const boundary = edge === 'left' ? item.video.sequenceEnd : item.video.sequenceStart;
		if (boundary !== authorityBoundary) throw new RangeError('Roll neighbors must touch the same sequence-frame boundary.');
	}
}

function assertCommonVideoAuthority(participants: readonly Participant[], authority: Participant): void {
	const video = authority.video!;
	for (const item of participants) {
		if (!item.video) continue;
		if (item.video.sequenceId !== video.sequenceId
			|| !sameFrameTrimRate(item.video.sequenceRate, video.sequenceRate)) {
			throw new RangeError('Roll/ripple video participants must use one sequence and rate.');
		}
	}
}

function assertLinkCompanions(targets: Targets): void {
	for (const participants of [targets.edge, targets.neighbors, targets.shifted]) {
		frameCanonicalLinkedVideoCompanions(
			participants,
			participants.filter(({ video }) => video !== null),
		);
	}
}

function assertUnlocked(
	project: FrameTrimDataRecord,
	participants: readonly Participant[],
	predicate: FrameCanonicalRollRippleTrimRequest['isTrackLocked'],
): void {
	for (const trackId of new Set(participants.map((item) => item.trackId))) {
		const track = participants.find((item) => item.trackId === trackId)!.track;
		if (isTrackLockProjectSchema(project.schemaVersion) && typeof track.locked !== 'boolean') {
			throw new TypeError(`Track ${trackId}.locked must be boolean in a V15 project.`);
		}
		if ((isTrackLockProjectSchema(project.schemaVersion) && track.locked === true) || predicate?.(trackId)) {
			throw new RangeError(`Track ${trackId} is locked.`);
		}
	}
}

function operationProgramEditSample(
	index: ProjectIndex,
	authority: Participant,
	mode: FrameCanonicalRollRippleTrimMode,
	edge: FrameCanonicalTrimEdge,
	delta: number,
	sourceCutSample: number,
): number {
	if (mode === 'roll' || edge === 'right') return sourceCutSample;
	return videoFrameToSampleFrame(
		safeAdd(authority.video!.sequenceEnd, -delta, 'left ripple program edit frame'),
		authority.video!.sequenceRate,
		index.sampleRate,
		'point',
	);
}

function relationId(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}

function oppositeEdge(edge: FrameCanonicalTrimEdge): FrameCanonicalTrimEdge {
	return edge === 'left' ? 'right' : 'left';
}

function saturatedSafeDifference(left: number, right: number): number {
	const difference = BigInt(left) - BigInt(right);
	const maximum = BigInt(Number.MAX_SAFE_INTEGER);
	if (difference > maximum) return Number.MAX_SAFE_INTEGER;
	if (difference < -maximum) return -Number.MAX_SAFE_INTEGER;
	return Number(difference);
}

function trimMode(value: unknown): FrameCanonicalRollRippleTrimMode {
	if (value !== 'roll' && value !== 'ripple') throw new RangeError(`Unsupported trim mode: ${String(value)}.`);
	return value;
}

function trimEdge(value: unknown): FrameCanonicalTrimEdge {
	if (value !== 'left' && value !== 'right') throw new RangeError(`Unsupported trim edge: ${String(value)}.`);
	return value;
}
