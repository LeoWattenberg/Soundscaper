/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	nonEmptyString,
	positiveSafeInteger,
	safeAdd,
	type FrameCanonicalEdgeTrimTransform,
	type FrameTrimDataRecord,
	type FrameTrimProjectIndex,
} from './frame-canonical-edge-trim-domain.ts';
import type {
	FrameCanonicalSlipSlidePreview,
	FrameCanonicalSlipSlideRole,
	FrameCanonicalSlipSlideSourceRange,
} from './frame-canonical-slip-slide-domain.ts';
import type { FrameCanonicalSlideTargets } from './frame-canonical-slip-slide-targets.ts';
import {
	frameCanonicalPreview,
	validateFrameCanonicalVideoTracks,
	type FrameCanonicalTrimParticipant,
} from './frame-canonical-trim-planning.ts';
import { roundRational, videoFrameToSampleFrame } from './timeline-time.ts';

export interface FrameCanonicalSlideCandidate {
	readonly transforms: readonly FrameCanonicalEdgeTrimTransform[];
	readonly previews: readonly FrameCanonicalSlipSlidePreview[];
	readonly sourceRanges: readonly FrameCanonicalSlipSlideSourceRange[];
}

interface PlannedSlideParticipant {
	readonly transform: FrameCanonicalEdgeTrimTransform;
	readonly preview: FrameCanonicalSlipSlidePreview;
	readonly sourceRange: FrameCanonicalSlipSlideSourceRange;
}

/** Substitute one sequence-frame delta into every immutable slide triplet. */
export function planFrameCanonicalSlideCandidate(
	index: FrameTrimProjectIndex,
	targets: FrameCanonicalSlideTargets,
	authority: FrameCanonicalTrimParticipant,
	delta: number,
	videoTrackIds: ReadonlySet<string>,
): FrameCanonicalSlideCandidate | null {
	const planned = new Map<string, PlannedSlideParticipant>();
	const linkedVideoByAvLinkId = new Map<string, PlannedSlideParticipant>();
	for (const item of targets.participants) {
		if (!item.video) continue;
		const role = targets.roleByClipId.get(item.clipId);
		if (!role) throw new RangeError(`Slide video ${item.clipId} has no role.`);
		const result = planVideoSlide(index, item, role, delta);
		if (!result) return null;
		planned.set(item.clipId, result);
		const avLinkId = relationId(item.clip.avLinkId);
		if (avLinkId) {
			if (linkedVideoByAvLinkId.has(avLinkId)) throw new RangeError(`A/V link ${avLinkId} has multiple slide videos.`);
			linkedVideoByAvLinkId.set(avLinkId, result);
		}
	}
	const resolvedAuthorityDelta = videoFrameToSampleFrame(
		safeAdd(authority.video!.sequenceStart, delta, 'slide authority start'),
		authority.video!.sequenceRate,
		index.sampleRate,
		'point',
	) - authority.timelineStart;
	const centerByTrack = centerRanges(
		targets,
		planned,
		linkedVideoByAvLinkId,
		resolvedAuthorityDelta,
	);
	for (const item of targets.participants) {
		if (item.video) continue;
		const role = targets.roleByClipId.get(item.clipId);
		if (!role) throw new RangeError(`Slide audio ${item.clipId} has no role.`);
		const avLinkId = relationId(item.clip.avLinkId);
		const linkedVideo = avLinkId ? linkedVideoByAvLinkId.get(avLinkId) : undefined;
		if (avLinkId && !linkedVideo) throw new RangeError(`Linked slide audio ${item.clipId} has no video companion.`);
		const result = planAudioSlide(
			item,
			role,
			linkedVideo?.preview,
			centerByTrack.get(item.trackId),
			resolvedAuthorityDelta,
		);
		if (!result) return null;
		planned.set(item.clipId, result);
	}
	if (planned.size !== targets.participants.length) return null;
	assertFinalLaneTouch(targets, planned);
	const ordered = index.clips.flatMap((clip) => {
		const item = planned.get(nonEmptyString(clip.id, 'clip.id'));
		return item ? [item] : [];
	});
	const projectedClips = new Map(index.clipById);
	for (const item of ordered) {
		const original = index.clipById.get(item.transform.clipId)!;
		if (original.kind !== 'video') continue;
		projectedClips.set(item.transform.clipId, {
			...original,
			...item.preview,
			...item.transform.sequencePlacement,
		});
	}
	try {
		validateFrameCanonicalVideoTracks(index, videoTrackIds, projectedClips);
	} catch (error: unknown) {
		if (error instanceof RangeError) return null;
		throw error;
	}
	return {
		transforms: ordered.map(({ transform }) => transform),
		previews: ordered.map(({ preview }) => preview),
		sourceRanges: ordered.map(({ sourceRange }) => sourceRange),
	};
}

function assertFinalLaneTouch(
	targets: FrameCanonicalSlideTargets,
	planned: ReadonlyMap<string, PlannedSlideParticipant>,
): void {
	const tracks = new Set(targets.participants.map(({ trackId }) => trackId));
	for (const trackId of tracks) {
		const rolePreview = (role: FrameCanonicalSlipSlideRole): FrameCanonicalSlipSlidePreview => {
			const item = targets.participants.find((candidate) => candidate.trackId === trackId
				&& targets.roleByClipId.get(candidate.clipId) === role);
			const preview = item ? planned.get(item.clipId)?.preview : undefined;
			if (!preview) throw new Error(`Planned slide lane ${trackId} has no ${role} preview.`);
			return preview;
		};
		const left = rolePreview('left');
		const center = rolePreview('center');
		const right = rolePreview('right');
		const leftEnd = safeAdd(left.timelineStartFrame, left.durationFrames, `planned slide lane ${trackId} left end`);
		const centerEnd = safeAdd(center.timelineStartFrame, center.durationFrames, `planned slide lane ${trackId} center end`);
		if (leftEnd !== center.timelineStartFrame || centerEnd !== right.timelineStartFrame) {
			throw new Error(`Planned slide lane ${trackId} does not retain exact touching endpoints.`);
		}
	}
}

function planVideoSlide(
	index: FrameTrimProjectIndex,
	item: FrameCanonicalTrimParticipant,
	role: FrameCanonicalSlipSlideRole,
	delta: number,
): PlannedSlideParticipant | null {
	const video = item.video!;
	const sequenceStart = role === 'left'
		? video.sequenceStart
		: safeAdd(video.sequenceStart, delta, `slide video ${item.clipId} start`);
	const sequenceEnd = role === 'right'
		? video.sequenceEnd
		: safeAdd(video.sequenceEnd, delta, `slide video ${item.clipId} end`);
	if (sequenceStart < 0 || sequenceEnd <= sequenceStart) return null;
	let sourceStart = video.sourceIn;
	let sourceEnd = video.sourceEnd;
	if (role === 'left') sourceEnd = mapVideoSourceBoundary(item, sequenceEnd);
	else if (role === 'right') sourceStart = mapVideoSourceBoundary(item, sequenceStart);
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
	const preview = {
		...frameCanonicalPreview(item, timelineStart, timelineEnd, sourceStart, sourceEnd),
		changeKind: role === 'center' ? 'placement' as const : 'neighbor-trim' as const,
	};
	return {
		transform: {
			clipId: item.clipId,
			trackId: item.trackId,
			changes: omitUnchanged(item.clip, {
				timelineStartFrame: timelineStart,
				durationFrames: timelineEnd - timelineStart,
				sourceStartFrame: sourceStart,
				sourceDurationFrames: sourceEnd - sourceStart,
			}),
			sequencePlacement: {
				sequenceStartFrame: sequenceStart,
				sequenceFrameCount: sequenceEnd - sequenceStart,
			},
			...(role === 'center' ? {} : { sequenceTrimRange: {
				startFrame: sequenceStart - video.sequenceStart,
				endFrame: sequenceEnd - video.sequenceStart,
			} }),
		},
		preview,
		sourceRange: { clipId: item.clipId, sourceStartFrame: sourceStart, sourceEndFrame: sourceEnd },
	};
}

function planAudioSlide(
	item: FrameCanonicalTrimParticipant,
	role: FrameCanonicalSlipSlideRole,
	linkedPreview: FrameCanonicalSlipSlidePreview | undefined,
	unlinkedCenterRange: Readonly<{ start: number; end: number }> | undefined,
	resolvedAuthorityDelta: number,
): PlannedSlideParticipant | null {
	let timelineStart: number;
	let timelineEnd: number;
	if (linkedPreview) {
		timelineStart = linkedPreview.timelineStartFrame;
		timelineEnd = safeAdd(
			timelineStart,
			linkedPreview.durationFrames,
			`linked slide audio ${item.clipId} range`,
		);
	} else if (role === 'center') {
		timelineStart = safeAdd(item.timelineStart, resolvedAuthorityDelta, `slide audio ${item.clipId} start`);
		timelineEnd = safeAdd(item.timelineEnd, resolvedAuthorityDelta, `slide audio ${item.clipId} end`);
	} else {
		if (!unlinkedCenterRange) throw new RangeError(`Slide audio lane ${item.trackId} has no center range.`);
		timelineStart = role === 'left' ? item.timelineStart : unlinkedCenterRange.end;
		timelineEnd = role === 'left' ? unlinkedCenterRange.start : item.timelineEnd;
	}
	if (timelineStart < 0 || timelineEnd <= timelineStart) return null;
	let sourceStart = item.sourceStart;
	let sourceEnd = item.sourceEnd;
	if (role === 'left') ({ sourceStart, sourceEnd } = mapAudioSourceBoundary(item, 'right', timelineEnd));
	else if (role === 'right') ({ sourceStart, sourceEnd } = mapAudioSourceBoundary(item, 'left', timelineStart));
	const sourceBound = positiveSafeInteger(item.source.frameCount, `audio source ${String(item.source.id)}.frameCount`);
	if (sourceStart < 0 || sourceEnd <= sourceStart || sourceEnd > sourceBound) return null;
	const duration = timelineEnd - timelineStart;
	const removedSource = item.sourceEnd - item.sourceStart - (sourceEnd - sourceStart);
	const movesLow = role === 'left' ? item.reversed : !item.reversed;
	const trimStart = role === 'center' || !movesLow ? item.trimStart : Math.max(0, item.trimStart + removedSource);
	const trimEnd = role === 'center' || movesLow ? item.trimEnd : Math.max(0, item.trimEnd + removedSource);
	const fadeIn = Math.min(item.fadeIn, duration);
	const fadeOut = Math.min(item.fadeOut, duration);
	const preview = {
		clipId: item.clipId,
		trackId: item.trackId,
		timelineStartFrame: timelineStart,
		durationFrames: duration,
		sourceStartFrame: sourceStart,
		sourceDurationFrames: sourceEnd - sourceStart,
		trimStartFrames: trimStart,
		trimEndFrames: trimEnd,
		fadeInFrames: fadeIn,
		fadeOutFrames: fadeOut,
		changeKind: role === 'center' ? 'placement' as const : 'neighbor-trim' as const,
	};
	return {
		transform: {
			clipId: item.clipId,
			trackId: item.trackId,
			changes: omitUnchanged(item.clip, preview),
		},
		preview,
		sourceRange: { clipId: item.clipId, sourceStartFrame: sourceStart, sourceEndFrame: sourceEnd },
	};
}

function mapVideoSourceBoundary(item: FrameCanonicalTrimParticipant, boundary: number): number {
	const video = item.video!;
	return safeAdd(video.sourceIn, roundRational(
		BigInt(boundary - video.sequenceStart) * BigInt(video.sourceEnd - video.sourceIn),
		BigInt(video.sequenceEnd - video.sequenceStart),
		'point',
	), `slide video ${item.clipId} source boundary`);
}

function mapAudioSourceBoundary(
	item: FrameCanonicalTrimParticipant,
	edge: 'left' | 'right',
	boundary: number,
): Readonly<{ sourceStart: number; sourceEnd: number }> {
	const progress = roundRational(
		BigInt(boundary - item.timelineStart) * BigInt(item.sourceEnd - item.sourceStart),
		BigInt(item.timelineEnd - item.timelineStart),
		'point',
	);
	const mapped = item.reversed
		? safeAdd(item.sourceEnd, -progress, `reversed slide audio ${item.clipId} source boundary`)
		: safeAdd(item.sourceStart, progress, `slide audio ${item.clipId} source boundary`);
	const movesLow = edge === 'left' ? !item.reversed : item.reversed;
	return {
		sourceStart: movesLow ? mapped : item.sourceStart,
		sourceEnd: movesLow ? item.sourceEnd : mapped,
	};
}

function centerRanges(
	targets: FrameCanonicalSlideTargets,
	planned: ReadonlyMap<string, PlannedSlideParticipant>,
	linkedVideoByAvLinkId: ReadonlyMap<string, PlannedSlideParticipant>,
	delta: number,
): ReadonlyMap<string, Readonly<{ start: number; end: number }>> {
	const result = new Map<string, Readonly<{ start: number; end: number }>>();
	for (const item of targets.center) {
		let start: number;
		let end: number;
		if (item.video) {
			const projected = planned.get(item.clipId)?.preview;
			if (!projected) throw new RangeError(`Slide video center ${item.clipId} has no preview.`);
			start = projected.timelineStartFrame;
			end = start + projected.durationFrames;
		} else {
			const avLinkId = relationId(item.clip.avLinkId);
			const linked = avLinkId ? linkedVideoByAvLinkId.get(avLinkId)?.preview : undefined;
			start = linked?.timelineStartFrame
				?? safeAdd(item.timelineStart, delta, `slide center ${item.clipId} start`);
			end = linked
				? start + linked.durationFrames
				: safeAdd(item.timelineEnd, delta, `slide center ${item.clipId} end`);
		}
		if (result.has(item.trackId)) throw new RangeError(`Slide lane ${item.trackId} has multiple centers.`);
		result.set(item.trackId, { start, end });
	}
	return result;
}

function omitUnchanged(
	clip: FrameTrimDataRecord,
	changes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const ignored = new Set(['clipId', 'trackId', 'changeKind']);
	return Object.fromEntries(Object.entries(changes).filter(([field, value]) => (
		!ignored.has(field) && clip[field] !== value
	)));
}

function relationId(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}
