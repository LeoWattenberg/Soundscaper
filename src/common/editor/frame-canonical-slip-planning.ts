/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	nonEmptyString,
	positiveSafeInteger,
	safeInteger,
	type FrameCanonicalEdgeTrimTransform,
	type FrameTrimProjectIndex,
} from './frame-canonical-edge-trim-domain.ts';
import type {
	FrameCanonicalSlipSlidePreview,
	FrameCanonicalSlipSlideSourceRange,
	VideoSourceTimingView,
} from './frame-canonical-slip-slide-domain.ts';
import {
	audioBoundaryTime,
	compareSourceTimes,
	mapVideoBoundaryPoint,
	negateSourceTime,
	shiftSourceTime,
	sourceTimeDifference,
	sourceTimeToAudioFrame,
	videoBoundaryTime,
	videoSourceTimingView,
	type ExactSourceTime,
} from './frame-canonical-slip-slide-timing.ts';
import type { FrameCanonicalSlipTargets } from './frame-canonical-slip-slide-targets.ts';
import {
	frameCanonicalPreview,
	type FrameCanonicalTrimParticipant,
} from './frame-canonical-trim-planning.ts';

const MAXIMUM_LEGALITY_JUMPS = 64;
const ZERO_TIME: ExactSourceTime = Object.freeze({ numerator: 0n, denominator: 1n });

export interface FrameCanonicalSlipCandidate {
	readonly appliedSourceInFrame: number;
	readonly transforms: readonly FrameCanonicalEdgeTrimTransform[];
	readonly previews: readonly FrameCanonicalSlipSlidePreview[];
	readonly sourceRanges: readonly FrameCanonicalSlipSlideSourceRange[];
}

interface CollapseBlocker {
	readonly lower: ExactSourceTime | null;
	readonly upper: ExactSourceTime | null;
}

interface SlipProbe {
	readonly candidate: FrameCanonicalSlipCandidate | null;
	readonly blockers: readonly CollapseBlocker[];
}

interface SlipContext {
	readonly index: FrameTrimProjectIndex;
	readonly targets: FrameCanonicalSlipTargets;
	readonly authority: FrameCanonicalTrimParticipant;
	readonly authorityView: VideoSourceTimingView;
	readonly timingViews: ReadonlyMap<string, VideoSourceTimingView>;
}

/** Resolve a nearest legal absolute slip target without assuming VFR legality is monotone. */
export function planFrameCanonicalSlipCandidate(
	index: FrameTrimProjectIndex,
	targets: FrameCanonicalSlipTargets,
	authority: FrameCanonicalTrimParticipant,
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
	requestedSourceInFrameValue: unknown,
): FrameCanonicalSlipCandidate {
	const requestedSourceInFrame = safeInteger(
		requestedSourceInFrameValue,
		'request.requestedSourceInFrame',
	);
	const authorityView = videoSourceTimingView(timingViews, authority.source);
	const authorityIn = authority.video!.sourceIn;
	const context = { index, targets, authority, authorityView, timingViews };
	const handles = commonExactHandleRange(context);
	let target = clampAuthorityTarget(
		authorityView,
		authorityIn,
		requestedSourceInFrame,
		handles.minimum,
		handles.maximum,
	);
	const direction = Math.sign(target - authorityIn);
	let jumps = 0;
	while (true) {
		const probe = probeSlipCandidate(context, target);
		if (probe.candidate) return probe.candidate;
		if (direction === 0 || target === authorityIn || !probe.blockers.length) {
			throw new RangeError('The original slip source range is not legal.');
		}
		if (jumps >= MAXIMUM_LEGALITY_JUMPS) {
			throw new RangeError('VFR slip legality exceeds bounded planning complexity');
		}
		const next = direction > 0
			? positiveJumpTarget(authorityView, authorityIn, target, probe.blockers)
			: negativeJumpTarget(authorityView, authorityIn, target, probe.blockers);
		if (next === target || (direction > 0 ? next < authorityIn : next > authorityIn)) {
			throw new RangeError('The VFR slip legality search could not progress toward its origin.');
		}
		target = next;
		jumps += 1;
	}
}

function probeSlipCandidate(context: SlipContext, target: number): SlipProbe {
	const authorityInTime = videoBoundaryTime(context.authorityView, context.authority.video!.sourceIn);
	const targetTime = videoBoundaryTime(context.authorityView, target);
	const tau = sourceTimeDifference(targetTime, authorityInTime);
	const blockers: CollapseBlocker[] = [];
	const planned = new Map<string, Readonly<{
		transform: FrameCanonicalEdgeTrimTransform;
		preview: FrameCanonicalSlipSlidePreview;
		sourceRange: FrameCanonicalSlipSlideSourceRange;
	}>>();
	for (const item of context.targets.participants) {
		const result = item.video
			? planVideoSlip(item, context.timingViews, tau, blockers)
			: planAudioSlip(item, tau);
		if (result) planned.set(item.clipId, result);
	}
	if (blockers.length) return { candidate: null, blockers };
	if (planned.size !== context.targets.participants.length) {
		throw new RangeError('A slip candidate failed to plan every participant.');
	}
	const ordered = context.index.clips.flatMap((clip) => {
		const item = planned.get(nonEmptyString(clip.id, 'clip.id'));
		return item ? [item] : [];
	});
	return {
		blockers: [],
		candidate: {
			appliedSourceInFrame: target,
			transforms: ordered.map(({ transform }) => transform),
			previews: ordered.map(({ preview }) => preview),
			sourceRanges: ordered.map(({ sourceRange }) => sourceRange),
		},
	};
}

function planVideoSlip(
	item: FrameCanonicalTrimParticipant,
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
	tau: ExactSourceTime,
	blockers: CollapseBlocker[],
) {
	const video = item.video!;
	const view = videoSourceTimingView(timingViews, item.source);
	const originalInTime = videoBoundaryTime(view, video.sourceIn);
	const originalOutTime = videoBoundaryTime(view, video.sourceEnd);
	const mappedIn = mapVideoBoundaryPoint(view, shiftSourceTime(originalInTime, tau));
	const mappedOut = mapVideoBoundaryPoint(view, shiftSourceTime(originalOutTime, tau));
	if (mappedIn.boundary === mappedOut.boundary) {
		blockers.push({
			lower: mappedIn.cellLower
				? sourceTimeDifference(mappedIn.cellLower, originalInTime)
				: null,
			upper: mappedOut.cellUpper
				? sourceTimeDifference(mappedOut.cellUpper, originalOutTime)
				: null,
		});
		return null;
	}
	if (mappedOut.boundary < mappedIn.boundary) {
		throw new RangeError(`Video slip ${item.clipId} reversed its source range.`);
	}
	const changes = omitUnchanged(item, {
		sourceStartFrame: mappedIn.boundary,
		sourceDurationFrames: mappedOut.boundary - mappedIn.boundary,
	});
	return plannedSlip(
		item,
		mappedIn.boundary,
		mappedOut.boundary,
		item.trimStart,
		item.trimEnd,
		changes,
	);
}

function planAudioSlip(item: FrameCanonicalTrimParticipant, tau: ExactSourceTime) {
	const sourceBound = positiveSafeInteger(item.source.frameCount, `audio source ${String(item.source.id)}.frameCount`);
	const sourceStart = sourceTimeToAudioFrame(
		shiftSourceTime(audioBoundaryTime(item.sourceStart, item.source.sampleRate), tau),
		item.source.sampleRate,
	);
	const sourceEnd = sourceTimeToAudioFrame(
		shiftSourceTime(audioBoundaryTime(item.sourceEnd, item.source.sampleRate), tau),
		item.source.sampleRate,
	);
	if (sourceStart < 0 || sourceEnd <= sourceStart || sourceEnd > sourceBound) {
		throw new RangeError(`Audio slip ${item.clipId} exceeds its source range.`);
	}
	const trimStart = Math.max(0, item.trimStart + sourceStart - item.sourceStart);
	const trimEnd = Math.max(0, item.trimEnd - (sourceEnd - item.sourceEnd));
	return plannedSlip(item, sourceStart, sourceEnd, trimStart, trimEnd, omitUnchanged(item, {
		sourceStartFrame: sourceStart,
		sourceDurationFrames: sourceEnd - sourceStart,
		trimStartFrames: trimStart,
		trimEndFrames: trimEnd,
	}));
}

function plannedSlip(
	item: FrameCanonicalTrimParticipant,
	sourceStart: number,
	sourceEnd: number,
	trimStart: number,
	trimEnd: number,
	changes: Readonly<Record<string, unknown>>,
) {
	const preview = frameCanonicalPreview(item, item.timelineStart, item.timelineEnd, sourceStart, sourceEnd);
	return {
		transform: { clipId: item.clipId, trackId: item.trackId, changes },
		preview: { ...preview, trimStartFrames: trimStart, trimEndFrames: trimEnd, changeKind: 'source-slip' as const },
		sourceRange: { clipId: item.clipId, sourceStartFrame: sourceStart, sourceEndFrame: sourceEnd },
	};
}

function commonExactHandleRange(context: SlipContext): Readonly<{
	minimum: ExactSourceTime;
	maximum: ExactSourceTime;
}> {
	let minimum = negateSourceTime(videoBoundaryTime(context.authorityView, context.authority.video!.sourceIn));
	let maximum = sourceTimeDifference(
		videoBoundaryTime(context.authorityView, context.authority.video!.sourceBound),
		videoBoundaryTime(context.authorityView, context.authority.video!.sourceEnd),
	);
	for (const item of context.targets.participants) {
		let start: ExactSourceTime;
		let end: ExactSourceTime;
		let sourceEnd: ExactSourceTime;
		if (item.video) {
			const view = videoSourceTimingView(context.timingViews, item.source);
			start = videoBoundaryTime(view, item.video.sourceIn);
			end = videoBoundaryTime(view, item.video.sourceEnd);
			sourceEnd = videoBoundaryTime(view, item.video.sourceBound);
		} else {
			start = audioBoundaryTime(item.sourceStart, item.source.sampleRate);
			end = audioBoundaryTime(item.sourceEnd, item.source.sampleRate);
			sourceEnd = audioBoundaryTime(
				positiveSafeInteger(item.source.frameCount, `audio source ${String(item.source.id)}.frameCount`),
				item.source.sampleRate,
			);
		}
		minimum = laterTime(minimum, negateSourceTime(start));
		maximum = earlierTime(maximum, sourceTimeDifference(sourceEnd, end));
	}
	if (compareSourceTimes(minimum, ZERO_TIME) > 0 || compareSourceTimes(maximum, ZERO_TIME) < 0) {
		throw new RangeError('The immutable slip source ranges exceed their source handles.');
	}
	return { minimum, maximum };
}

function clampAuthorityTarget(
	view: VideoSourceTimingView,
	origin: number,
	requested: number,
	minimumTau: ExactSourceTime,
	maximumTau: ExactSourceTime,
): number {
	const frameCount = view.kind === 'cfr' ? view.frameCount : view.index.frameCount;
	let bounded = Math.max(0, Math.min(frameCount, requested));
	if (bounded > origin) {
		bounded = greatestBoundary(view, origin, origin, bounded, (tau) => compareSourceTimes(tau, maximumTau) <= 0);
	} else if (bounded < origin) {
		bounded = leastBoundary(view, origin, bounded, origin, (tau) => compareSourceTimes(tau, minimumTau) >= 0);
	}
	return bounded;
}

function positiveJumpTarget(
	view: VideoSourceTimingView,
	origin: number,
	current: number,
	blockers: readonly CollapseBlocker[],
): number {
	let threshold: ExactSourceTime | null = null;
	for (const blocker of blockers) {
		if (!blocker.lower) return origin;
		threshold = threshold ? earlierTime(threshold, blocker.lower) : blocker.lower;
	}
	return greatestBoundary(
		view,
		origin,
		origin,
		current - 1,
		(tau) => compareSourceTimes(tau, threshold!) < 0,
	);
}

function negativeJumpTarget(
	view: VideoSourceTimingView,
	origin: number,
	current: number,
	blockers: readonly CollapseBlocker[],
): number {
	let threshold: ExactSourceTime | null = null;
	for (const blocker of blockers) {
		if (!blocker.upper) return origin;
		threshold = threshold ? laterTime(threshold, blocker.upper) : blocker.upper;
	}
	return leastBoundary(
		view,
		origin,
		current + 1,
		origin,
		(tau) => compareSourceTimes(tau, threshold!) >= 0,
	);
}

function greatestBoundary(
	view: VideoSourceTimingView,
	origin: number,
	minimum: number,
	maximum: number,
	predicate: (tau: ExactSourceTime) => boolean,
): number {
	let low = minimum;
	let high = maximum;
	let answer = low;
	while (low <= high) {
		const middle = low + Math.floor((high - low) / 2);
		if (predicate(authorityTau(view, origin, middle))) {
			answer = middle;
			low = middle + 1;
		} else high = middle - 1;
	}
	return answer;
}

function leastBoundary(
	view: VideoSourceTimingView,
	origin: number,
	minimum: number,
	maximum: number,
	predicate: (tau: ExactSourceTime) => boolean,
): number {
	let low = minimum;
	let high = maximum;
	let answer = high;
	while (low <= high) {
		const middle = low + Math.floor((high - low) / 2);
		if (predicate(authorityTau(view, origin, middle))) {
			answer = middle;
			high = middle - 1;
		} else low = middle + 1;
	}
	return answer;
}

function authorityTau(view: VideoSourceTimingView, origin: number, boundary: number): ExactSourceTime {
	return sourceTimeDifference(videoBoundaryTime(view, boundary), videoBoundaryTime(view, origin));
}

function omitUnchanged(
	item: FrameCanonicalTrimParticipant,
	changes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return Object.fromEntries(Object.entries(changes).filter(([field, value]) => item.clip[field] !== value));
}

function earlierTime(left: ExactSourceTime, right: ExactSourceTime): ExactSourceTime {
	return compareSourceTimes(left, right) <= 0 ? left : right;
}

function laterTime(left: ExactSourceTime, right: ExactSourceTime): ExactSourceTime {
	return compareSourceTimes(left, right) >= 0 ? left : right;
}
