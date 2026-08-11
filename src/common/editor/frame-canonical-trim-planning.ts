/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	frameTrimRationalRate,
	nonEmptyString,
	nonNegativeSafeInteger,
	positiveSafeInteger,
	requireFrameTrimTrack,
	safeAdd,
	safeDifference,
	type FrameCanonicalEdgeTrimPreview,
	type FrameCanonicalEdgeTrimTransform,
	type FrameCanonicalTrimEdge,
	type FrameTrimDataRecord,
	type FrameTrimProjectIndex,
} from './frame-canonical-edge-trim-domain.ts';
import {
	roundRational,
	videoFrameToSampleFrame,
	type RationalRate,
} from './timeline-time.ts';
import { validateVideoTrackComposition as validateLegacyVideoTrackComposition } from './video-timeline.js';

export interface FrameCanonicalTrimParticipant {
	readonly clip: FrameTrimDataRecord;
	readonly clipId: string;
	readonly track: FrameTrimDataRecord;
	readonly trackId: string;
	readonly source: FrameTrimDataRecord;
	readonly timelineStart: number;
	readonly timelineEnd: number;
	readonly sourceStart: number;
	readonly sourceEnd: number;
	readonly trimStart: number;
	readonly trimEnd: number;
	readonly fadeIn: number;
	readonly fadeOut: number;
	readonly reversed: boolean;
	readonly video: FrameCanonicalVideoAuthority | null;
}

export interface FrameCanonicalVideoAuthority {
	readonly sequenceId: string;
	readonly sequenceRate: RationalRate;
	readonly sequenceStart: number;
	readonly sequenceEnd: number;
	readonly sourceIn: number;
	readonly sourceEnd: number;
	readonly sourceBound: number;
}

export interface FrameCanonicalPlannedEdge {
	readonly transform: FrameCanonicalEdgeTrimTransform;
	readonly preview: FrameCanonicalEdgeTrimPreview;
}

const validateVideoTrackComposition = validateLegacyVideoTrackComposition as unknown as (
	track: FrameTrimDataRecord,
	clipById: ReadonlyMap<string, FrameTrimDataRecord>,
) => true;

export function frameCanonicalTrimParticipant(
	index: FrameTrimProjectIndex,
	clipId: string,
): FrameCanonicalTrimParticipant {
	const clip = index.clipById.get(clipId);
	if (!clip) throw new ReferenceError(`Missing participant clip ${clipId}.`);
	const track = index.trackByClipId.get(clipId);
	if (!track) throw new RangeError(`Clip ${clipId} has no timeline track ownership.`);
	const trackId = nonEmptyString(track.id, `track for clip ${clipId}.id`);
	if (clip.kind !== track.type) throw new RangeError(`Clip ${clipId} kind does not match track ${trackId}.`);
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

export function frameCanonicalVideoAuthority(
	activeClip: FrameTrimDataRecord,
	videos: readonly FrameCanonicalTrimParticipant[],
): FrameCanonicalTrimParticipant {
	if (activeClip.kind === 'video') {
		const active = videos.find(({ clipId }) => clipId === activeClip.id);
		if (active) return active;
	}
	const avLinkId = relationId(activeClip.avLinkId);
	if (avLinkId) {
		const linked = videos.filter(({ clip }) => clip.avLinkId === avLinkId);
		if (linked.length > 1) throw new RangeError(`A/V link ${avLinkId} has multiple video companions.`);
		if (linked.length === 1) return linked[0]!;
	}
	const first = videos[0];
	if (!first) throw new RangeError('A frame-canonical trim requires a video participant.');
	return first;
}

export function frameCanonicalLinkedVideoCompanions(
	participants: readonly FrameCanonicalTrimParticipant[],
	videos: readonly FrameCanonicalTrimParticipant[],
): ReadonlyMap<string, FrameCanonicalTrimParticipant> {
	const membersByLinkId = new Map<string, { audio: number; video: number }>();
	for (const item of participants) {
		const avLinkId = relationId(item.clip.avLinkId);
		if (!avLinkId) continue;
		const members = membersByLinkId.get(avLinkId) ?? { audio: 0, video: 0 };
		if (item.video) members.video += 1;
		else members.audio += 1;
		membersByLinkId.set(avLinkId, members);
	}
	for (const [avLinkId, members] of membersByLinkId) {
		if (members.audio !== 1 || members.video !== 1) {
			throw new RangeError(`A/V link ${avLinkId} requires exactly one audio and one video participant.`);
		}
	}
	const result = new Map<string, FrameCanonicalTrimParticipant>();
	for (const audio of participants) {
		const avLinkId = relationId(audio.clip.avLinkId);
		if (audio.video || !avLinkId) continue;
		const linked = videos.filter(({ clip }) => clip.avLinkId === avLinkId);
		if (linked.length !== 1) {
			throw new RangeError(`A/V link ${avLinkId} must have one participating video companion.`);
		}
		result.set(audio.clipId, linked[0]!);
	}
	return result;
}

export function planFrameCanonicalParticipantEdge(
	index: FrameTrimProjectIndex,
	item: FrameCanonicalTrimParticipant,
	edge: FrameCanonicalTrimEdge,
	delta: number,
	resolvedSampleDelta: number,
	linkedVideo?: FrameCanonicalTrimParticipant,
): FrameCanonicalPlannedEdge | null {
	return item.video
		? planVideoParticipant(index, item, edge, delta)
		: planAudioParticipant(
			item,
			edge,
			linkedVideo
				? frameCanonicalVideoEdgeSampleDelta(index, linkedVideo, edge, delta)
				: resolvedSampleDelta,
		);
}

export function frameCanonicalVideoEdgeSampleDelta(
	index: FrameTrimProjectIndex,
	item: FrameCanonicalTrimParticipant,
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

export function frameCanonicalPreview(
	item: FrameCanonicalTrimParticipant,
	timelineStart: number,
	timelineEnd: number,
	sourceStart: number = item.sourceStart,
	sourceEnd: number = item.sourceEnd,
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
		fadeInFrames: item.video ? 0 : item.fadeIn,
		fadeOutFrames: item.video ? 0 : item.fadeOut,
	};
}

export function validateFrameCanonicalVideoTracks(
	index: FrameTrimProjectIndex,
	trackIds: ReadonlySet<string>,
	clipById: ReadonlyMap<string, FrameTrimDataRecord> = index.clipById,
): void {
	for (const trackId of trackIds) {
		validateVideoTrackComposition(requireFrameTrimTrack(index, trackId), clipById);
	}
}

export function closestLegalFrameDelta<Candidate>(
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

export function boundFrameCanonicalVideoTimelineDelta(
	videos: readonly FrameCanonicalTrimParticipant[],
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

function videoParticipant(
	index: FrameTrimProjectIndex,
	clip: FrameTrimDataRecord,
	clipId: string,
	track: FrameTrimDataRecord,
	trackId: string,
	source: FrameTrimDataRecord,
	timelineStart: number,
	timelineEnd: number,
	sourceStart: number,
	sourceEnd: number,
	trimStart: number,
	trimEnd: number,
): FrameCanonicalTrimParticipant {
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
		video: {
			sequenceId, sequenceRate, sequenceStart, sequenceEnd,
			sourceIn, sourceEnd: canonicalSourceEnd, sourceBound,
		},
	};
}

function planVideoParticipant(
	index: FrameTrimProjectIndex,
	item: FrameCanonicalTrimParticipant,
	edge: FrameCanonicalTrimEdge,
	delta: number,
): FrameCanonicalPlannedEdge | null {
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
	const timelineStart = videoFrameToSampleFrame(sequenceStart, video.sequenceRate, index.sampleRate, 'point');
	const timelineEnd = videoFrameToSampleFrame(sequenceEnd, video.sequenceRate, index.sampleRate, 'point');
	if (timelineEnd <= timelineStart) return null;
	const changes: Record<string, unknown> = {
		...(edge === 'left' ? { timelineStartFrame: timelineStart } : {}),
		durationFrames: timelineEnd - timelineStart,
		sourceStartFrame: sourceStart,
		sourceDurationFrames: sourceEnd - sourceStart,
	};
	return {
		transform: { clipId: item.clipId, trackId: item.trackId, changes },
		preview: frameCanonicalPreview(item, timelineStart, timelineEnd, sourceStart, sourceEnd),
	};
}

function planAudioParticipant(
	item: FrameCanonicalTrimParticipant,
	edge: FrameCanonicalTrimEdge,
	resolvedSampleDelta: number,
): FrameCanonicalPlannedEdge | null {
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
	return {
		transform: {
			clipId: item.clipId,
			trackId: item.trackId,
			changes: {
				...(edge === 'left' ? { timelineStartFrame: timelineStart } : {}),
				durationFrames: duration,
				sourceStartFrame: sourceStart,
				sourceDurationFrames: sourceDuration,
				trimStartFrames: trimStart,
				trimEndFrames: trimEnd,
				fadeInFrames: fadeIn,
				fadeOutFrames: fadeOut,
			},
		},
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

function relationId(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}
