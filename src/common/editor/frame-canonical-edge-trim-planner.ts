/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectClipTrimIds as collectLegacyClipTrimIds } from './commands/clip-basic-runtime.js';
import {
	deepFreeze,
	frameTrimRationalRate,
	frameTrimRecord,
	indexFrameTrimProject,
	nonEmptyString,
	nonNegativeSafeInteger,
	positiveSafeInteger,
	requireFrameTrimTrack,
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
import { isRuntimeProjectProjection } from './runtime-clip-projection.ts';
import {
	roundRational,
	sampleFrameToVideoFrame,
	videoFrameToSampleFrame,
	type RationalRate,
} from './timeline-time.ts';
import { validateVideoTrackComposition as validateLegacyVideoTrackComposition } from './video-timeline.js';

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

interface Participant {
	readonly clip: DataRecord;
	readonly clipId: string;
	readonly track: DataRecord;
	readonly trackId: string;
	readonly source: DataRecord;
	readonly timelineStart: number;
	readonly timelineEnd: number;
	readonly sourceStart: number;
	readonly sourceEnd: number;
	readonly trimStart: number;
	readonly trimEnd: number;
	readonly fadeIn: number;
	readonly fadeOut: number;
	readonly reversed: boolean;
	readonly video: VideoAuthority | null;
}

interface VideoAuthority {
	readonly sequenceId: string;
	readonly sequenceRate: RationalRate;
	readonly sequenceStart: number;
	readonly sequenceEnd: number;
	readonly sourceIn: number;
	readonly sourceEnd: number;
	readonly sourceBound: number;
}

interface Candidate {
	readonly transforms: readonly FrameCanonicalEdgeTrimTransform[];
	readonly previews: readonly FrameCanonicalEdgeTrimPreview[];
}

const collectClipTrimIds = collectLegacyClipTrimIds as unknown as (
	project: DataRecord,
	activeClipId: string,
	edge: FrameCanonicalTrimEdge,
) => string[];

const validateVideoTrackComposition = validateLegacyVideoTrackComposition as unknown as (
	track: DataRecord,
	clipById: ReadonlyMap<string, DataRecord>,
) => true;

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
	const participants = participantClipIds.map((clipId) => participant(index, clipId));
	for (const item of participants) {
		if (request.isTrackLocked?.(item.trackId)) {
			throw new RangeError(`Track ${item.trackId} is locked.`);
		}
	}
	const videos = participants.filter((item) => item.video !== null);
	if (!videos.length) throw new RangeError('A frame-canonical edge trim requires a video participant.');
	const authority = videoAuthority(activeClip, videos);
	const authorityVideo = authority.video!;
	for (const item of videos) {
		if (item.video!.sequenceId !== authorityVideo.sequenceId
				|| !sameFrameTrimRate(item.video!.sequenceRate, authorityVideo.sequenceRate)) {
			throw new RangeError('Participating video clips must use one sequence and rate.');
		}
	}
	const linkedVideoByAudioClipId = linkedVideoCompanions(participants, videos);
	const videoTrackIds = new Set(videos.map(({ trackId }) => trackId));
	for (const trackId of videoTrackIds) {
		validateVideoTrackComposition(requireFrameTrimTrack(index, trackId), index.clipById);
	}

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
	const rangeBoundedDelta = boundVideoTimelineDelta(videos, edge, requestedFrameDelta);
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
	const { delta: sequenceFrameDelta, candidate } = closestLegalDelta(rangeBoundedDelta, build);
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
		const planned = item.video
			? planVideoParticipant(index, item, edge, delta)
			: planAudioParticipant(
				item,
				edge,
				linkedVideoByAudioClipId.has(item.clipId)
					? videoEdgeSampleDelta(index, linkedVideoByAudioClipId.get(item.clipId)!, edge, delta)
					: resolvedSampleDelta,
			);
		if (!planned) return null;
		transforms.push(planned.transform);
		previews.push(planned.preview);
		if (item.video) projectedClips.set(item.clipId, { ...item.clip, ...planned.preview });
	}
	for (const trackId of videoTrackIds) {
		try {
			validateVideoTrackComposition(requireFrameTrimTrack(index, trackId), projectedClips);
		} catch (error: unknown) {
			if (error instanceof RangeError) return null;
			throw error;
		}
	}
	return { transforms, previews };
}

function planVideoParticipant(
	index: ProjectIndex,
	item: Participant,
	edge: FrameCanonicalTrimEdge,
	delta: number,
): Readonly<{
	transform: FrameCanonicalEdgeTrimTransform;
	preview: FrameCanonicalEdgeTrimPreview;
}> | null {
	const video = item.video!;
	const boundary = safeAdd(
		edge === 'left' ? video.sequenceStart : video.sequenceEnd,
		delta,
		`video clip ${item.clipId} boundary`,
	);
	const sequenceStart = edge === 'left' ? boundary : video.sequenceStart;
	const sequenceEnd = edge === 'right' ? boundary : video.sequenceEnd;
	if (sequenceStart < 0 || sequenceEnd <= sequenceStart) return null;
	const mappedSource = safeAdd(
		video.sourceIn,
		roundRational(
			BigInt(boundary - video.sequenceStart) * BigInt(video.sourceEnd - video.sourceIn),
			BigInt(video.sequenceEnd - video.sequenceStart),
			'point',
		),
		`video clip ${item.clipId} source boundary`,
	);
	const sourceStart = edge === 'left' ? mappedSource : video.sourceIn;
	const sourceEnd = edge === 'right' ? mappedSource : video.sourceEnd;
	if (sourceStart < 0 || sourceEnd <= sourceStart || sourceEnd > video.sourceBound) return null;
	const timelineStart = videoFrameToSampleFrame(
		sequenceStart,
		video.sequenceRate,
		index.sampleRate,
		'point',
	);
	const timelineEnd = videoFrameToSampleFrame(
		sequenceEnd,
		video.sequenceRate,
		index.sampleRate,
		'point',
	);
	if (timelineEnd <= timelineStart) return null;
	const changes: Record<string, unknown> = {
		...(edge === 'left' ? { timelineStartFrame: timelineStart } : {}),
		durationFrames: timelineEnd - timelineStart,
		sourceStartFrame: sourceStart,
		sourceDurationFrames: sourceEnd - sourceStart,
	};
	return {
		transform: { clipId: item.clipId, trackId: item.trackId, changes },
		preview: preview(item, timelineStart, timelineEnd, sourceStart, sourceEnd),
	};
}

function planAudioParticipant(
	item: Participant,
	edge: FrameCanonicalTrimEdge,
	resolvedSampleDelta: number,
): Readonly<{
	transform: FrameCanonicalEdgeTrimTransform;
	preview: FrameCanonicalEdgeTrimPreview;
}> | null {
	const originalBoundary = edge === 'left' ? item.timelineStart : item.timelineEnd;
	const boundary = safeAdd(originalBoundary, resolvedSampleDelta, `audio clip ${item.clipId} boundary`);
	const timelineStart = edge === 'left' ? boundary : item.timelineStart;
	const timelineEnd = edge === 'right' ? boundary : item.timelineEnd;
	if (timelineStart < 0 || timelineEnd <= timelineStart) return null;
	const progress = roundRational(
		BigInt(boundary - item.timelineStart) * BigInt(item.sourceEnd - item.sourceStart),
		BigInt(item.timelineEnd - item.timelineStart),
		'point',
	);
	const mappedSource = item.reversed
		? safeAdd(item.sourceEnd, -progress, `audio clip ${item.clipId} reversed source boundary`)
		: safeAdd(item.sourceStart, progress, `audio clip ${item.clipId} source boundary`);
	const movesLowBoundary = edge === 'left' ? !item.reversed : item.reversed;
	const sourceStart = movesLowBoundary ? mappedSource : item.sourceStart;
	const sourceEnd = movesLowBoundary ? item.sourceEnd : mappedSource;
	const sourceBound = positiveSafeInteger(item.source.frameCount, `audio source ${String(item.source.id)}.frameCount`);
	if (sourceStart < 0 || sourceEnd <= sourceStart || sourceEnd > sourceBound) return null;
	const duration = timelineEnd - timelineStart;
	const sourceDuration = sourceEnd - sourceStart;
	const removedSourceFrames = (item.sourceEnd - item.sourceStart) - sourceDuration;
	const trimStart = movesLowBoundary ? Math.max(0, item.trimStart + removedSourceFrames) : item.trimStart;
	const trimEnd = movesLowBoundary ? item.trimEnd : Math.max(0, item.trimEnd + removedSourceFrames);
	const fadeIn = Math.min(item.fadeIn, duration);
	const fadeOut = Math.min(item.fadeOut, duration);
	const changes: Record<string, unknown> = {
		...(edge === 'left' ? { timelineStartFrame: timelineStart } : {}),
		durationFrames: duration,
		sourceStartFrame: sourceStart,
		sourceDurationFrames: sourceDuration,
		trimStartFrames: trimStart,
		trimEndFrames: trimEnd,
		fadeInFrames: fadeIn,
		fadeOutFrames: fadeOut,
	};
	return {
		transform: { clipId: item.clipId, trackId: item.trackId, changes },
		preview: {
			clipId: item.clipId,
			trackId: item.trackId,
			timelineStartFrame: timelineStart,
			durationFrames: duration,
			sourceStartFrame: sourceStart,
			sourceDurationFrames: sourceDuration,
			trimStartFrames: trimStart,
			trimEndFrames: trimEnd,
			fadeInFrames: fadeIn,
			fadeOutFrames: fadeOut,
		},
	};
}

function preview(
	item: Participant,
	timelineStart: number,
	timelineEnd: number,
	sourceStart: number,
	sourceEnd: number,
): FrameCanonicalEdgeTrimPreview {
	return {
		clipId: item.clipId,
		trackId: item.trackId,
		timelineStartFrame: timelineStart,
		durationFrames: timelineEnd - timelineStart,
		sourceStartFrame: sourceStart,
		sourceDurationFrames: sourceEnd - sourceStart,
		trimStartFrames: item.trimStart,
		trimEndFrames: item.trimEnd,
		fadeInFrames: 0,
		fadeOutFrames: 0,
	};
}

function closestLegalDelta(
	requestedDelta: number,
	build: (delta: number) => Candidate | null,
): Readonly<{ delta: number; candidate: Candidate | null }> {
	if (requestedDelta === 0) return { delta: 0, candidate: null };
	const requestedCandidate = build(requestedDelta);
	if (requestedCandidate) return { delta: requestedDelta, candidate: requestedCandidate };
	const sign = Math.sign(requestedDelta);
	let legalMagnitude = 0;
	let illegalMagnitude = Math.abs(requestedDelta);
	let legalCandidate: Candidate | null = null;
	// A safe integer has at most 53 bits, so composition/source clamping takes
	// at most 53 probes and never walks a user-controlled frame span.
	while (illegalMagnitude - legalMagnitude > 1) {
		const magnitude = legalMagnitude + Math.floor((illegalMagnitude - legalMagnitude) / 2);
		const candidate = build(sign * magnitude);
		if (candidate) {
			legalMagnitude = magnitude;
			legalCandidate = candidate;
		} else illegalMagnitude = magnitude;
	}
	return { delta: legalMagnitude === 0 ? 0 : sign * legalMagnitude, candidate: legalCandidate };
}

function boundVideoTimelineDelta(
	videos: readonly Participant[],
	edge: FrameCanonicalTrimEdge,
	requestedDelta: number,
): number {
	let lower = -Number.MAX_SAFE_INTEGER;
	let upper = Number.MAX_SAFE_INTEGER;
	for (const item of videos) {
		const video = item.video!;
		if (edge === 'left') {
			lower = Math.max(lower, -video.sequenceStart);
			upper = Math.min(upper, video.sequenceEnd - video.sequenceStart - 1);
		} else {
			lower = Math.max(lower, 1 - (video.sequenceEnd - video.sequenceStart));
			upper = Math.min(upper, Number.MAX_SAFE_INTEGER - video.sequenceEnd);
		}
	}
	return Math.max(lower, Math.min(upper, requestedDelta));
}

function participant(index: ProjectIndex, clipId: string): Participant {
	const clip = index.clipById.get(clipId);
	if (!clip) throw new ReferenceError(`Missing participant clip ${clipId}.`);
	const track = index.trackByClipId.get(clipId);
	if (!track) throw new RangeError(`Clip ${clipId} has no timeline track ownership.`);
	const trackId = nonEmptyString(track.id, `track for clip ${clipId}.id`);
	if (clip.kind !== track.type) {
		throw new RangeError(`Clip ${clipId} kind does not match track ${trackId}.`);
	}
	const sourceId = nonEmptyString(clip.sourceId, `clip ${clipId}.sourceId`);
	const source = index.sourceById.get(sourceId);
	if (!source) throw new ReferenceError(`Clip ${clipId} references missing source ${sourceId}.`);
	if (source.kind !== clip.kind) throw new RangeError(`Clip ${clipId} and source ${sourceId} have different media kinds.`);
	const timelineStart = nonNegativeSafeInteger(clip.timelineStartFrame, `clip ${clipId}.timelineStartFrame`);
	const timelineDuration = positiveSafeInteger(clip.durationFrames, `clip ${clipId}.durationFrames`);
	const timelineEnd = safeAdd(timelineStart, timelineDuration, `clip ${clipId} timeline range`);
	const sourceStart = nonNegativeSafeInteger(clip.sourceStartFrame, `clip ${clipId}.sourceStartFrame`);
	const sourceDuration = positiveSafeInteger(clip.sourceDurationFrames, `clip ${clipId}.sourceDurationFrames`);
	const sourceEnd = safeAdd(sourceStart, sourceDuration, `clip ${clipId} source range`);
	const trimStart = nonNegativeSafeInteger(clip.trimStartFrames, `clip ${clipId}.trimStartFrames`);
	const trimEnd = nonNegativeSafeInteger(clip.trimEndFrames, `clip ${clipId}.trimEndFrames`);
	if (clip.kind === 'video') {
		return videoParticipant(
			index, clip, clipId, track, trackId, source,
			timelineStart, timelineEnd, sourceStart, sourceEnd, trimStart, trimEnd,
		);
	}
	if (clip.kind !== 'audio') throw new RangeError(`Clip ${clipId} is not audio or video.`);
	const sourceBound = positiveSafeInteger(source.frameCount, `audio source ${sourceId}.frameCount`);
	if (sourceEnd > sourceBound) throw new RangeError(`Audio clip ${clipId} exceeds its source range.`);
	const fadeIn = nonNegativeSafeInteger(clip.fadeInFrames, `clip ${clipId}.fadeInFrames`);
	const fadeOut = nonNegativeSafeInteger(clip.fadeOutFrames, `clip ${clipId}.fadeOutFrames`);
	if (fadeIn > timelineDuration || fadeOut > timelineDuration) {
		throw new RangeError(`Audio clip ${clipId} fades exceed its timeline range.`);
	}
	if (typeof clip.reversed !== 'boolean') throw new TypeError(`Audio clip ${clipId}.reversed must be boolean.`);
	return {
		clip, clipId, track, trackId, source, timelineStart, timelineEnd,
		sourceStart, sourceEnd, trimStart, trimEnd, fadeIn, fadeOut,
		reversed: clip.reversed, video: null,
	};
}

function videoParticipant(
	index: ProjectIndex,
	clip: DataRecord,
	clipId: string,
	track: DataRecord,
	trackId: string,
	source: DataRecord,
	timelineStart: number,
	timelineEnd: number,
	sourceStart: number,
	sourceEnd: number,
	trimStart: number,
	trimEnd: number,
): Participant {
	if (clip.retimeMap != null) throw new RangeError(`Video clip ${clipId} has a retime map.`);
	const sequenceId = nonEmptyString(clip.sequenceId, `video clip ${clipId}.sequenceId`);
	const owningSequenceId = index.sequenceIdByTrackId.get(trackId);
	if (!owningSequenceId) throw new ReferenceError(`Video track ${trackId} has no sequence.`);
	if (owningSequenceId !== sequenceId) throw new RangeError(`Video clip ${clipId} belongs to a different sequence.`);
	const sequence = index.sequenceById.get(sequenceId);
	if (!sequence) throw new ReferenceError(`Video clip ${clipId} references missing sequence ${sequenceId}.`);
	const sequenceRate = frameTrimRationalRate(sequence.rate, `sequence ${sequenceId}.rate`);
	const sequenceStart = nonNegativeSafeInteger(clip.sequenceStartFrame, `video clip ${clipId}.sequenceStartFrame`);
	const sequenceCount = positiveSafeInteger(clip.sequenceFrameCount, `video clip ${clipId}.sequenceFrameCount`);
	const sequenceEnd = safeAdd(sequenceStart, sequenceCount, `video clip ${clipId} sequence range`);
	const sourceIn = nonNegativeSafeInteger(clip.sourceInFrame, `video clip ${clipId}.sourceInFrame`);
	const sourceCount = positiveSafeInteger(clip.sourceFrameCount, `video clip ${clipId}.sourceFrameCount`);
	const canonicalSourceEnd = safeAdd(sourceIn, sourceCount, `video clip ${clipId} canonical source range`);
	const sourceBound = positiveSafeInteger(source.sourceFrameCount, `video source ${String(source.id)}.sourceFrameCount`);
	if (canonicalSourceEnd > sourceBound) throw new RangeError(`Video clip ${clipId} exceeds its source range.`);
	const resolvedStart = videoFrameToSampleFrame(sequenceStart, sequenceRate, index.sampleRate, 'point');
	const resolvedEnd = videoFrameToSampleFrame(sequenceEnd, sequenceRate, index.sampleRate, 'point');
	if (timelineStart !== resolvedStart || timelineEnd !== resolvedEnd
		|| sourceStart !== sourceIn || sourceEnd !== canonicalSourceEnd) {
		throw new RangeError(`Video clip ${clipId} command projection disagrees with its canonical range.`);
	}
	return {
		clip, clipId, track, trackId, source, timelineStart, timelineEnd,
		sourceStart, sourceEnd, trimStart, trimEnd, fadeIn: 0, fadeOut: 0,
		reversed: false,
		video: { sequenceId, sequenceRate, sequenceStart, sequenceEnd, sourceIn, sourceEnd, sourceBound },
	};
}

function videoAuthority(activeClip: DataRecord, videos: readonly Participant[]): Participant {
	if (activeClip.kind === 'video') {
		return videos.find(({ clipId }) => clipId === activeClip.id)!;
	}
	const avLinkId = typeof activeClip.avLinkId === 'string' && activeClip.avLinkId ? activeClip.avLinkId : null;
	if (avLinkId) {
		const linked = videos.filter(({ clip }) => clip.avLinkId === avLinkId);
		if (linked.length > 1) throw new RangeError(`A/V link ${avLinkId} has multiple video companions.`);
		if (linked.length === 1) return linked[0]!;
	}
	return videos[0]!;
}

function linkedVideoCompanions(
	participants: readonly Participant[],
	videos: readonly Participant[],
): ReadonlyMap<string, Participant> {
	const result = new Map<string, Participant>();
	for (const audio of participants) {
		if (audio.video || typeof audio.clip.avLinkId !== 'string' || !audio.clip.avLinkId) continue;
		const linked = videos.filter(({ clip }) => clip.avLinkId === audio.clip.avLinkId);
		if (linked.length !== 1) {
			throw new RangeError(`A/V link ${audio.clip.avLinkId} must have one participating video companion.`);
		}
		result.set(audio.clipId, linked[0]!);
	}
	return result;
}

function videoEdgeSampleDelta(
	index: ProjectIndex,
	item: Participant,
	edge: FrameCanonicalTrimEdge,
	delta: number,
): number {
	const video = item.video!;
	const baseFrame = edge === 'left' ? video.sequenceStart : video.sequenceEnd;
	const appliedSample = videoFrameToSampleFrame(
		safeAdd(baseFrame, delta, `video clip ${item.clipId} linked boundary`),
		video.sequenceRate,
		index.sampleRate,
		'point',
	);
	return safeDifference(
		appliedSample,
		edge === 'left' ? item.timelineStart : item.timelineEnd,
		`video clip ${item.clipId} linked sample delta`,
	);
}

function trimEdge(value: unknown): FrameCanonicalTrimEdge {
	if (value !== 'left' && value !== 'right') throw new RangeError(`Unsupported trim edge: ${String(value)}.`);
	return value;
}
