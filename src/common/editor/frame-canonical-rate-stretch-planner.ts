/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	deepFreeze,
	frameTrimRecord,
	indexFrameTrimProject,
	nonEmptyString,
	safeDifference,
	safeInteger,
	type FrameCanonicalTrimEdge,
	type FrameTrimDataRecord,
	type FrameTrimProjectIndex,
} from './frame-canonical-edge-trim-domain.ts';
import type {
	FrameCanonicalRateStretchPlan,
	FrameCanonicalRateStretchPreview,
	FrameCanonicalRateStretchRequest,
	FrameCanonicalRateStretchTransform,
} from './frame-canonical-rate-stretch-domain.ts';
import {
	resolveFrameCanonicalRateStretchTargets,
	type FrameCanonicalRateStretchTargets,
} from './frame-canonical-rate-stretch-targets.ts';
import {
	frameCanonicalPreview,
	validateFrameCanonicalVideoTracks,
	type FrameCanonicalTrimParticipant,
} from './frame-canonical-trim-planning.ts';
import {
	FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
	isActiveAudioEditorProjectSchema,
} from './project-schema-version.ts';
import { isRuntimeProjectProjection } from './runtime-clip-projection.ts';
import {
	roundRational,
	sampleFrameToVideoFrame,
	videoFrameToSampleFrame,
	type Rational,
} from './timeline-time.ts';
import {
	compareSourceTimes,
	sourceTimeDifference,
	videoBoundaryTime,
	videoSourceTimingView,
	type ExactSourceTime,
	type VideoSourceTimingView,
} from './video-source-timing-view.ts';

// foundation-edit-matrix: rate-stretch

interface VideoRateEvidence {
	readonly sourceDuration: ExactSourceTime;
}

interface Candidate {
	readonly transforms: readonly FrameCanonicalRateStretchTransform[];
	readonly previews: readonly FrameCanonicalRateStretchPreview[];
}

interface PlanContext {
	readonly index: FrameTrimProjectIndex;
	readonly targets: FrameCanonicalRateStretchTargets;
	readonly edge: FrameCanonicalTrimEdge;
	readonly authorityCount: number;
	readonly evidenceByClipId: ReadonlyMap<string, VideoRateEvidence>;
}

/** Plan one constant-rate video-bearing stretch from immutable source/program ranges. */
export function planFrameCanonicalRateStretch(
	projectValue: unknown,
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
	request: FrameCanonicalRateStretchRequest,
): FrameCanonicalRateStretchPlan {
	if (!isRuntimeProjectProjection(projectValue)) {
		throw new TypeError('A frame-canonical rate stretch requires the branded command projection.');
	}
	const project = frameTrimRecord(projectValue, 'project');
	if (!isActiveAudioEditorProjectSchema(project.schemaVersion)
		&& project.schemaVersion !== FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION) {
		throw new RangeError('A frame-canonical rate stretch requires a selected exact product command projection.');
	}
	const activeClipId = nonEmptyString(request?.activeClipId, 'request.activeClipId');
	const edge = stretchEdge(request?.edge);
	const requestedBoundarySample = safeInteger(
		request?.requestedBoundarySample,
		'request.requestedBoundarySample',
	);
	if (request.isTrackLocked != null && typeof request.isTrackLocked !== 'function') {
		throw new TypeError('request.isTrackLocked must be a function.');
	}
	const index = indexFrameTrimProject(project);
	const active = index.clipById.get(activeClipId);
	if (!active) throw new ReferenceError(`Unknown active clip: ${activeClipId}.`);
	const targets = resolveFrameCanonicalRateStretchTargets(
		project, index, activeClipId, request.isTrackLocked,
	);
	validateFrameCanonicalVideoTracks(index, targets.videoTrackIds);
	const evidenceByClipId = rateEvidence(targets.videos, timingViews);
	for (const item of targets.videos) {
		const evidence = evidenceByClipId.get(item.clipId)!;
		if (!supportedPlaybackRate(item, item.video!.sequenceEnd - item.video!.sequenceStart, evidence)) {
			throw new RangeError(`Video clip ${item.clipId} has an unsupported base playback rate.`);
		}
	}

	const authorityVideo = targets.authority.video!;
	const authorityCount = authorityVideo.sequenceEnd - authorityVideo.sequenceStart;
	const requestedSequenceFrame = sampleFrameToVideoFrame(
		requestedBoundarySample,
		authorityVideo.sequenceRate,
		index.sampleRate,
		'point',
	);
	const rawRequestedCount = edge === 'right'
		? BigInt(requestedSequenceFrame) - BigInt(authorityVideo.sequenceStart)
		: BigInt(authorityVideo.sequenceEnd) - BigInt(requestedSequenceFrame);
	const context: PlanContext = {
		index, targets, edge, authorityCount, evidenceByClipId,
	};
	const bounds = commonAuthorityCountBounds(context);
	if (bounds.minimum > authorityCount || bounds.maximum < authorityCount) {
		throw new RangeError('The immutable rate-stretch geometry is outside its common bounds.');
	}
	const boundedRequestedCount = clampBigInt(rawRequestedCount, bounds.minimum, bounds.maximum);
	const build = (count: number): Candidate | null => {
		try {
			return buildCandidate(context, count);
		} catch (error: unknown) {
			if (error instanceof RangeError) return null;
			throw error;
		}
	};
	const closest = closestLegalCount(authorityCount, boundedRequestedCount, build);
	const appliedCount = closest.count;
	const appliedSequenceFrame = edge === 'right'
		? authorityVideo.sequenceStart + appliedCount
		: authorityVideo.sequenceEnd - appliedCount;
	if (!Number.isSafeInteger(appliedSequenceFrame)) {
		throw new RangeError('The applied rate-stretch edge exceeds the safe integer range.');
	}
	const originalSequenceFrame = edge === 'right'
		? authorityVideo.sequenceEnd
		: authorityVideo.sequenceStart;
	const boundarySample = videoFrameToSampleFrame(
		appliedSequenceFrame,
		authorityVideo.sequenceRate,
		index.sampleRate,
		'point',
	);
	const durationScale = reducedScale(appliedCount, authorityCount);
	const authorityEvidence = evidenceByClipId.get(targets.authority.clipId)!;
	const diagnostics = {
		activeClipId,
		edge,
		authorityClipId: targets.authority.clipId,
		authoritySourceId: nonEmptyString(targets.authority.source.id, 'authority source.id'),
		authoritySequenceId: authorityVideo.sequenceId,
		sequenceRate: { ...authorityVideo.sequenceRate },
		requestedBoundarySample,
		requestedSequenceFrame,
		appliedSequenceFrame,
		boundarySample,
		sequenceFrameDelta: safeDifference(
			appliedSequenceFrame, originalSequenceFrame, 'rate-stretch sequence-frame delta',
		),
		durationScale,
		authorityPlaybackRate: playbackRateNumber(
			targets.authority, appliedCount, authorityEvidence,
		),
		clamped: appliedSequenceFrame !== requestedSequenceFrame,
		participantClipIds: targets.participants.map(({ clipId }) => clipId),
	};
	if (appliedCount === authorityCount) {
		return deepFreeze({ ...diagnostics, kind: 'noop' as const, transforms: [], previews: [] });
	}
	const candidate = closest.candidate ?? build(appliedCount);
	if (!candidate) throw new RangeError('The applied rate stretch has no valid candidate.');
	return deepFreeze({
		...diagnostics,
		kind: 'transform' as const,
		transforms: [...candidate.transforms],
		previews: [...candidate.previews],
	});
}

function rateEvidence(
	videos: readonly FrameCanonicalTrimParticipant[],
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
): ReadonlyMap<string, VideoRateEvidence> {
	const result = new Map<string, VideoRateEvidence>();
	for (const item of videos) {
		const view = videoSourceTimingView(timingViews, item.source);
		const sourceDuration = sourceTimeDifference(
			videoBoundaryTime(view, item.video!.sourceEnd),
			videoBoundaryTime(view, item.video!.sourceIn),
		);
		if (compareSourceTimes(sourceDuration, { numerator: 0n, denominator: 1n }) <= 0) {
			throw new RangeError(`Video clip ${item.clipId} has no positive source time.`);
		}
		result.set(item.clipId, { sourceDuration });
	}
	return result;
}

function commonAuthorityCountBounds(context: PlanContext): Readonly<{ minimum: number; maximum: number }> {
	let minimum = 1;
	let maximum = Number.MAX_SAFE_INTEGER;
	const denominator = context.authorityCount;
	for (const item of context.targets.participants) {
		if (item.video) {
			const video = item.video;
			const originalCount = video.sequenceEnd - video.sequenceStart;
			const placementMaximum = context.edge === 'left'
				? video.sequenceEnd
				: maximumVideoSequenceFrame(video.sequenceRate, context.index.sampleRate) - video.sequenceStart;
			maximum = Math.min(maximum, maximumAuthorityForRoundedExtent(
				originalCount, denominator, placementMaximum,
			));
			const evidence = context.evidenceByClipId.get(item.clipId)!;
			const rateCounts = supportedProgramCountRange(item, evidence);
			minimum = Math.max(minimum, minimumAuthorityForRoundedExtent(
				originalCount, denominator, rateCounts.minimum,
			));
			maximum = Math.min(maximum, maximumAuthorityForRoundedExtent(
				originalCount, denominator, rateCounts.maximum,
			));
			continue;
		}
		if (context.targets.linkedVideoByAudioClipId.has(item.clipId)) continue;
		const originalDuration = item.timelineEnd - item.timelineStart;
		const placementMaximum = context.edge === 'left'
			? item.timelineEnd
			: Number.MAX_SAFE_INTEGER - item.timelineStart;
		maximum = Math.min(maximum, maximumAuthorityForRoundedExtent(
			originalDuration, denominator, placementMaximum,
		));
	}
	return { minimum, maximum };
}

function buildCandidate(context: PlanContext, count: number): Candidate | null {
	const videoPlans = new Map<string, Readonly<{
		transform: FrameCanonicalRateStretchTransform;
		preview: FrameCanonicalRateStretchPreview;
	}>>();
	const projectedClips = new Map(context.index.clipById);
	for (const item of context.targets.videos) {
		const plan = planVideo(context, item, count);
		if (!plan) return null;
		videoPlans.set(item.clipId, plan);
		projectedClips.set(item.clipId, { ...item.clip, ...plan.preview });
	}
	try {
		validateFrameCanonicalVideoTracks(context.index, context.targets.videoTrackIds, projectedClips);
	} catch (error: unknown) {
		if (error instanceof RangeError) return null;
		throw error;
	}
	const transforms: FrameCanonicalRateStretchTransform[] = [];
	const previews: FrameCanonicalRateStretchPreview[] = [];
	for (const item of context.targets.participants) {
		const videoPlan = videoPlans.get(item.clipId);
		const plan = videoPlan ?? planAudio(context, item, count, videoPlans);
		if (!plan) return null;
		transforms.push(plan.transform);
		previews.push(plan.preview);
	}
	return { transforms, previews };
}

function planVideo(
	context: PlanContext,
	item: FrameCanonicalTrimParticipant,
	count: number,
): Readonly<{
	transform: FrameCanonicalRateStretchTransform;
	preview: FrameCanonicalRateStretchPreview;
}> | null {
	const video = item.video!;
	const originalCount = video.sequenceEnd - video.sequenceStart;
	const nextCount = scaledExtent(originalCount, count, context.authorityCount);
	if (nextCount < 1 || !supportedPlaybackRate(
		item, nextCount, context.evidenceByClipId.get(item.clipId)!,
	)) return null;
	const sequenceStart = context.edge === 'left' ? video.sequenceEnd - nextCount : video.sequenceStart;
	const sequenceEnd = context.edge === 'right' ? video.sequenceStart + nextCount : video.sequenceEnd;
	if (sequenceStart < 0 || sequenceEnd <= sequenceStart || !Number.isSafeInteger(sequenceEnd)) return null;
	const timelineStart = videoFrameToSampleFrame(
		sequenceStart, video.sequenceRate, context.index.sampleRate, 'point',
	);
	const timelineEnd = videoFrameToSampleFrame(
		sequenceEnd, video.sequenceRate, context.index.sampleRate, 'point',
	);
	if (timelineEnd <= timelineStart) return null;
	const changes = omitUnchanged(item.clip, {
		...(context.edge === 'left' ? { timelineStartFrame: timelineStart } : {}),
		durationFrames: timelineEnd - timelineStart,
	});
	return {
		transform: {
			clipId: item.clipId,
			trackId: item.trackId,
			changes,
			sequencePlacement: { sequenceStartFrame: sequenceStart, sequenceFrameCount: nextCount },
		},
		preview: {
			...frameCanonicalPreview(item, timelineStart, timelineEnd),
			changeKind: 'rate-stretch',
		},
	};
}

function planAudio(
	context: PlanContext,
	item: FrameCanonicalTrimParticipant,
	count: number,
	videoPlans: ReadonlyMap<string, Readonly<{ preview: FrameCanonicalRateStretchPreview }>>,
): Readonly<{
	transform: FrameCanonicalRateStretchTransform;
	preview: FrameCanonicalRateStretchPreview;
}> | null {
	const linkedVideo = context.targets.linkedVideoByAudioClipId.get(item.clipId);
	const linkedPreview = linkedVideo ? videoPlans.get(linkedVideo.clipId)?.preview : undefined;
	let timelineStart: number;
	let timelineEnd: number;
	if (linkedPreview) {
		timelineStart = linkedPreview.timelineStartFrame;
		timelineEnd = timelineStart + linkedPreview.durationFrames;
	} else {
		const nextDuration = scaledExtent(
			item.timelineEnd - item.timelineStart, count, context.authorityCount,
		);
		timelineStart = context.edge === 'left' ? item.timelineEnd - nextDuration : item.timelineStart;
		timelineEnd = context.edge === 'right' ? item.timelineStart + nextDuration : item.timelineEnd;
	}
	if (timelineStart < 0 || timelineEnd <= timelineStart || !Number.isSafeInteger(timelineEnd)) return null;
	const duration = timelineEnd - timelineStart;
	const fadeIn = Math.min(item.fadeIn, duration);
	const fadeOut = Math.min(item.fadeOut, duration);
	const envelope = scaleEnvelope(
		item.clip.envelope as readonly unknown[],
		duration,
		item.timelineEnd - item.timelineStart,
	);
	const changes = omitUnchanged(item.clip, {
		...(context.edge === 'left' ? { timelineStartFrame: timelineStart } : {}),
		durationFrames: duration,
		fadeInFrames: fadeIn,
		fadeOutFrames: fadeOut,
		envelope,
	});
	return {
		transform: { clipId: item.clipId, trackId: item.trackId, changes },
		preview: {
			...frameCanonicalPreview(item, timelineStart, timelineEnd),
			fadeInFrames: fadeIn,
			fadeOutFrames: fadeOut,
			changeKind: 'rate-stretch',
		},
	};
}

function closestLegalCount(
	identity: number,
	requested: number,
	build: (count: number) => Candidate | null,
): Readonly<{ count: number; candidate: Candidate | null }> {
	if (requested === identity) return { count: identity, candidate: null };
	const requestedCandidate = build(requested);
	if (requestedCandidate) return { count: requested, candidate: requestedCandidate };
	if (requested > identity) {
		let legal = identity;
		let illegal = requested;
		let candidate: Candidate | null = null;
		while (illegal - legal > 1) {
			const middle = legal + Math.floor((illegal - legal) / 2);
			const probe = build(middle);
			if (probe) {
				legal = middle;
				candidate = probe;
			} else illegal = middle;
		}
		return { count: legal, candidate };
	}
	let illegal = requested;
	let legal = identity;
	let candidate: Candidate | null = null;
	while (legal - illegal > 1) {
		const middle = illegal + Math.floor((legal - illegal) / 2);
		const probe = build(middle);
		if (probe) {
			legal = middle;
			candidate = probe;
		} else illegal = middle;
	}
	return { count: legal, candidate };
}

function supportedProgramCountRange(
	item: FrameCanonicalTrimParticipant,
	evidence: VideoRateEvidence,
): Readonly<{ minimum: number; maximum: number }> {
	const rate = item.video!.sequenceRate;
	const numerator = evidence.sourceDuration.numerator * BigInt(rate.num);
	const denominator = evidence.sourceDuration.denominator * BigInt(rate.den);
	const minimum = ceilRatio(numerator, 16n * denominator);
	const maximum = 16n * numerator / denominator;
	return {
		minimum: safePositiveBigInt(minimum, `video clip ${item.clipId} minimum program count`),
		maximum: saturatedPositiveBigInt(maximum, `video clip ${item.clipId} maximum program count`),
	};
}

function supportedPlaybackRate(
	item: FrameCanonicalTrimParticipant,
	programCount: number,
	evidence: VideoRateEvidence,
): boolean {
	const rate = item.video!.sequenceRate;
	const numerator = evidence.sourceDuration.numerator * BigInt(rate.num);
	const denominator = evidence.sourceDuration.denominator * BigInt(programCount) * BigInt(rate.den);
	return numerator * 16n >= denominator && numerator <= denominator * 16n;
}

function playbackRateNumber(
	item: FrameCanonicalTrimParticipant,
	programCount: number,
	evidence: VideoRateEvidence,
): number {
	const rate = item.video!.sequenceRate;
	const numerator = evidence.sourceDuration.numerator * BigInt(rate.num);
	const denominator = evidence.sourceDuration.denominator * BigInt(programCount) * BigInt(rate.den);
	const result = Number(numerator) / Number(denominator);
	if (!Number.isFinite(result) || result <= 0) throw new RangeError('The derived playback rate is not finite.');
	return result;
}

function maximumVideoSequenceFrame(
	rate: Readonly<{ num: number; den: number }>,
	sampleRate: number,
): number {
	const numerator = (2n * BigInt(Number.MAX_SAFE_INTEGER) + 1n) * BigInt(rate.num) - 1n;
	const denominator = 2n * BigInt(rate.den) * BigInt(sampleRate);
	const result = numerator / denominator;
	return result > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(result);
}

function minimumAuthorityForRoundedExtent(
	originalExtent: number,
	authorityExtent: number,
	minimumExtent: number,
): number {
	const numerator = (2n * BigInt(minimumExtent) - 1n) * BigInt(authorityExtent);
	return safePositiveBigInt(
		ceilRatio(numerator, 2n * BigInt(originalExtent)),
		'minimum authority extent',
	);
}

function maximumAuthorityForRoundedExtent(
	originalExtent: number,
	authorityExtent: number,
	maximumExtent: number,
): number {
	if (maximumExtent < 1) return 0;
	const numerator = (2n * BigInt(maximumExtent) + 1n) * BigInt(authorityExtent) - 1n;
	const result = numerator / (2n * BigInt(originalExtent));
	return Number(result > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : result);
}

function scaledExtent(original: number, count: number, authorityCount: number): number {
	return roundRational(BigInt(original) * BigInt(count), BigInt(authorityCount), 'point');
}

function scaleEnvelope(
	values: readonly unknown[],
	duration: number,
	originalDuration: number,
): FrameTrimDataRecord[] {
	const result: FrameTrimDataRecord[] = [];
	for (const value of values) {
		const point = frameTrimRecord(value, 'audio envelope point');
		const frame = Math.min(duration, scaledExtent(Number(point.frame), duration, originalDuration));
		if (result.at(-1)?.frame === frame) continue;
		result.push({ ...cloneRecord(point), frame });
	}
	return result;
}

function cloneRecord(value: FrameTrimDataRecord): FrameTrimDataRecord {
	return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
}

function cloneValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(cloneValue);
	if (!value || typeof value !== 'object') return value;
	return cloneRecord(value as FrameTrimDataRecord);
}

function omitUnchanged(
	clip: FrameTrimDataRecord,
	changes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return Object.fromEntries(Object.entries(changes).filter(([field, value]) => (
		field === 'envelope' || clip[field] !== value
	)));
}

function reducedScale(numerator: number, denominator: number): Rational {
	const divisor = greatestCommonDivisor(BigInt(numerator), BigInt(denominator));
	return { num: Number(BigInt(numerator) / divisor), den: Number(BigInt(denominator) / divisor) };
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	let a = left;
	let b = right;
	while (b !== 0n) [a, b] = [b, a % b];
	return a;
}

function ceilRatio(numerator: bigint, denominator: bigint): bigint {
	return (numerator + denominator - 1n) / denominator;
}

function safePositiveBigInt(value: bigint, name: string): number {
	if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`${name} exceeds the positive safe integer range.`);
	}
	return Number(value);
}

function saturatedPositiveBigInt(value: bigint, name: string): number {
	if (value < 1n) throw new RangeError(`${name} must be positive.`);
	return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

function clampBigInt(value: bigint, minimum: number, maximum: number): number {
	if (value <= BigInt(minimum)) return minimum;
	if (value >= BigInt(maximum)) return maximum;
	return Number(value);
}

function stretchEdge(value: unknown): FrameCanonicalTrimEdge {
	if (value !== 'left' && value !== 'right') {
		throw new RangeError(`Unsupported rate-stretch edge: ${String(value)}.`);
	}
	return value;
}
