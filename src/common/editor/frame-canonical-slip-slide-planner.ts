/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	deepFreeze,
	frameTrimRecord,
	indexFrameTrimProject,
	nonEmptyString,
	safeAdd,
	safeInteger,
	sameFrameTrimRate,
	type FrameCanonicalTrackLockPredicate,
	type FrameTrimDataRecord,
	type FrameTrimProjectIndex,
} from './frame-canonical-edge-trim-domain.ts';
import {
	type FrameCanonicalSlidePlan,
	type FrameCanonicalSlideRequest,
	type FrameCanonicalSlipPlan,
	type FrameCanonicalSlipRequest,
	type FrameCanonicalSlipSlidePlan,
	type FrameCanonicalSlipSlideRequest,
	type VideoSourceTimingView,
} from './frame-canonical-slip-slide-domain.ts';
import { planFrameCanonicalSlideCandidate } from './frame-canonical-slide-planning.ts';
import { planFrameCanonicalSlipCandidate } from './frame-canonical-slip-planning.ts';
import {
	resolveFrameCanonicalSlideTargets,
	resolveFrameCanonicalSlipTargets,
} from './frame-canonical-slip-slide-targets.ts';
import {
	closestLegalFrameDelta,
	frameCanonicalTrimParticipant,
	frameCanonicalVideoAuthority,
	validateFrameCanonicalVideoTracks,
	type FrameCanonicalTrimParticipant,
} from './frame-canonical-trim-planning.ts';
import { isTrackLockProjectSchema } from './project-schema-version.ts';
import { isRuntimeProjectProjection } from './runtime-clip-projection.ts';
import { sampleFrameToVideoFrame, videoFrameToSampleFrame } from './timeline-time.ts';

export type {
	FrameCanonicalSlideDiagnostics,
	FrameCanonicalSlidePlan,
	FrameCanonicalSlideRequest,
	FrameCanonicalSlipDiagnostics,
	FrameCanonicalSlipPlan,
	FrameCanonicalSlipRequest,
	FrameCanonicalSlipSlideMode,
	FrameCanonicalSlipSlideNoop,
	FrameCanonicalSlipSlidePlan,
	FrameCanonicalSlipSlidePreview,
	FrameCanonicalSlipSlideRequest,
	FrameCanonicalSlipSlideSourceRange,
	FrameCanonicalSlipSlideTransform,
	FrameCanonicalSlipSlideTransformPlan,
	VideoSourceTimingView,
} from './frame-canonical-slip-slide-domain.ts';

/** Plan one video-bearing slip or slide from immutable command and verified timing authority. */
export function planFrameCanonicalSlipSlide(
	projectValue: unknown,
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
	request: FrameCanonicalSlipSlideRequest,
): FrameCanonicalSlipSlidePlan {
	if (!isRuntimeProjectProjection(projectValue)) {
		throw new TypeError('A frame-canonical slip/slide requires the branded command projection.');
	}
	if (!(timingViews instanceof Map)) throw new TypeError('Video timing views must be a ReadonlyMap.');
	const project = frameTrimRecord(projectValue, 'project');
	const mode = slipSlideMode(request?.mode);
	const activeClipId = nonEmptyString(request?.activeClipId, 'request.activeClipId');
	if (request.isTrackLocked != null && typeof request.isTrackLocked !== 'function') {
		throw new TypeError('request.isTrackLocked must be a function.');
	}
	const index = indexFrameTrimProject(project);
	const active = frameCanonicalTrimParticipant(index, activeClipId);
	return mode === 'slip'
		? planSlip(project, index, timingViews, active, request as FrameCanonicalSlipRequest)
		: planSlide(project, index, active, request as FrameCanonicalSlideRequest);
}

function planSlip(
	project: FrameTrimDataRecord,
	index: FrameTrimProjectIndex,
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
	active: FrameCanonicalTrimParticipant,
	request: FrameCanonicalSlipRequest,
): FrameCanonicalSlipPlan {
	const targets = resolveFrameCanonicalSlipTargets(project, index, active.clipId);
	preflightParticipants(project, targets.participants, request.isTrackLocked);
	const videos = targets.participants.filter(({ video }) => video !== null);
	const authority = frameCanonicalVideoAuthority(active.clip, videos);
	const requestedSourceInFrame = safeInteger(request.requestedSourceInFrame, 'request.requestedSourceInFrame');
	const candidate = planFrameCanonicalSlipCandidate(
		index,
		targets,
		authority,
		timingViews,
		requestedSourceInFrame,
	);
	const appliedSourceInFrame = candidate.appliedSourceInFrame;
	const sourceFrameDelta = appliedSourceInFrame - authority.video!.sourceIn;
	const diagnostics = {
		mode: 'slip' as const,
		activeClipId: active.clipId,
		authorityClipId: authority.clipId,
		authoritySourceId: nonEmptyString(authority.source.id, 'authority source.id'),
		authoritySequenceId: authority.video!.sequenceId,
		requestedSourceInFrame,
		appliedSourceInFrame,
		sourceFrameDelta,
		clamped: appliedSourceInFrame !== requestedSourceInFrame,
		participantClipIds: targets.participants.map(({ clipId }) => clipId),
		leftClipIds: [] as string[],
		centerClipIds: targets.participants.map(({ clipId }) => clipId),
		rightClipIds: [] as string[],
		sourceRanges: [...candidate.sourceRanges],
	};
	if (sourceFrameDelta === 0) {
		return deepFreeze({ ...diagnostics, kind: 'noop' as const, transforms: [], previews: [] });
	}
	return deepFreeze({
		...diagnostics,
		kind: 'transform' as const,
		transforms: [...candidate.transforms],
		previews: [...candidate.previews],
	});
}

function planSlide(
	project: FrameTrimDataRecord,
	index: FrameTrimProjectIndex,
	active: FrameCanonicalTrimParticipant,
	request: FrameCanonicalSlideRequest,
): FrameCanonicalSlidePlan {
	const requestedStartSample = safeInteger(request.requestedStartSample, 'request.requestedStartSample');
	const targets = resolveFrameCanonicalSlideTargets(project, index, active.clipId);
	preflightParticipants(project, targets.participants, request.isTrackLocked);
	assertSlideAudioPhaseTopology(targets.participants, targets.roleByClipId);
	const centerVideos = targets.center.filter(({ video }) => video !== null);
	const authority = frameCanonicalVideoAuthority(active.clip, centerVideos);
	assertCommonSlideVideoAuthority(targets.participants, authority);
	const videoTrackIds = new Set(targets.participants.filter(({ video }) => video !== null).map(({ trackId }) => trackId));
	validateFrameCanonicalVideoTracks(index, videoTrackIds);
	const authorityVideo = authority.video!;
	const requestedSequenceStartFrame = sampleFrameToVideoFrame(
		requestedStartSample,
		authorityVideo.sequenceRate,
		index.sampleRate,
		'point',
	);
	const requestedDelta = saturatedSafeDifference(
		requestedSequenceStartFrame,
		authorityVideo.sequenceStart,
	);
	const build = (delta: number) => {
		try {
			return planFrameCanonicalSlideCandidate(index, targets, authority, delta, videoTrackIds);
		} catch (error: unknown) {
			if (error instanceof RangeError) return null;
			throw error;
		}
	};
	const resolved = closestLegalFrameDelta(requestedDelta, build);
	const appliedSequenceStartFrame = safeAdd(
		authorityVideo.sequenceStart,
		resolved.delta,
		'applied slide sequence start',
	);
	const appliedStartSample = videoFrameToSampleFrame(
		appliedSequenceStartFrame,
		authorityVideo.sequenceRate,
		index.sampleRate,
		'point',
	);
	const appliedEndSample = videoFrameToSampleFrame(
		safeAdd(authorityVideo.sequenceEnd, resolved.delta, 'applied slide sequence end'),
		authorityVideo.sequenceRate,
		index.sampleRate,
		'point',
	);
	const sourceRanges = resolved.candidate?.sourceRanges ?? targets.participants.map((item) => ({
		clipId: item.clipId,
		sourceStartFrame: item.sourceStart,
		sourceEndFrame: item.sourceEnd,
	}));
	const diagnostics = {
		mode: 'slide' as const,
		activeClipId: active.clipId,
		authorityClipId: authority.clipId,
		authoritySourceId: nonEmptyString(authority.source.id, 'authority source.id'),
		authoritySequenceId: authorityVideo.sequenceId,
		requestedStartSample,
		requestedSequenceStartFrame,
		appliedSequenceStartFrame,
		appliedStartSample,
		appliedEndSample,
		sequenceFrameDelta: resolved.delta,
		clamped: appliedSequenceStartFrame !== requestedSequenceStartFrame,
		participantClipIds: targets.participants.map(({ clipId }) => clipId),
		leftClipIds: targets.left.map(({ clipId }) => clipId),
		centerClipIds: targets.center.map(({ clipId }) => clipId),
		rightClipIds: targets.right.map(({ clipId }) => clipId),
		sourceRanges: [...sourceRanges],
	};
	if (resolved.delta === 0) {
		return deepFreeze({ ...diagnostics, kind: 'noop' as const, transforms: [], previews: [] });
	}
	if (!resolved.candidate) throw new RangeError('The applied slide delta has no valid candidate.');
	return deepFreeze({
		...diagnostics,
		kind: 'transform' as const,
		transforms: [...resolved.candidate.transforms],
		previews: [...resolved.candidate.previews],
	});
}

function preflightParticipants(
	project: FrameTrimDataRecord,
	participants: readonly FrameCanonicalTrimParticipant[],
	predicate: FrameCanonicalTrackLockPredicate | undefined,
): void {
	if (!participants.some(({ video }) => video !== null)) {
		throw new RangeError('A frame-canonical slip/slide requires a video participant.');
	}
	for (const item of participants) {
		if (!item.video && item.clip.warpMap != null) throw new RangeError(`Audio clip ${item.clipId} has a warp map.`);
	}
	for (const trackId of new Set(participants.map(({ trackId }) => trackId))) {
		const track = participants.find((item) => item.trackId === trackId)!.track;
		if (isTrackLockProjectSchema(project) && typeof track.locked !== 'boolean') {
			throw new TypeError(`Track ${trackId}.locked must be boolean in a V15 project.`);
		}
		if ((isTrackLockProjectSchema(project) && track.locked === true) || predicate?.(trackId)) {
			throw new RangeError(`Track ${trackId} is locked.`);
		}
	}
}

function assertCommonSlideVideoAuthority(
	participants: readonly FrameCanonicalTrimParticipant[],
	authority: FrameCanonicalTrimParticipant,
): void {
	const video = authority.video!;
	for (const item of participants) {
		if (!item.video) continue;
		if (item.video.sequenceId !== video.sequenceId
			|| !sameFrameTrimRate(item.video.sequenceRate, video.sequenceRate)) {
			throw new RangeError('Slide video participants must use one sequence and rate.');
		}
	}
}

function assertSlideAudioPhaseTopology(
	participants: readonly FrameCanonicalTrimParticipant[],
	roleByClipId: ReadonlyMap<string, 'left' | 'center' | 'right'>,
): void {
	const audioByTrack = new Map<string, FrameCanonicalTrimParticipant[]>();
	for (const item of participants) {
		if (item.video) continue;
		const lane = audioByTrack.get(item.trackId) ?? [];
		lane.push(item);
		audioByTrack.set(item.trackId, lane);
	}
	for (const [trackId, lane] of audioByTrack) {
		const center = lane.find(({ clipId }) => roleByClipId.get(clipId) === 'center');
		if (!center) throw new RangeError(`Slide audio lane ${trackId} has no center.`);
		if (relationId(center.clip.avLinkId)) continue;
		const linkedNeighbor = lane.some((item) => roleByClipId.get(item.clipId) !== 'center'
			&& relationId(item.clip.avLinkId) !== null);
		if (linkedNeighbor) {
			throw new RangeError(
				`Slide audio lane ${trackId} cannot mix an unlinked center with a linked neighbor phase.`,
			);
		}
	}
}

function slipSlideMode(value: unknown): 'slip' | 'slide' {
	if (value !== 'slip' && value !== 'slide') throw new RangeError(`Unsupported slip/slide mode: ${String(value)}.`);
	return value;
}

function saturatedSafeDifference(left: number, right: number): number {
	const difference = BigInt(left) - BigInt(right);
	const maximum = BigInt(Number.MAX_SAFE_INTEGER);
	if (difference > maximum) return Number.MAX_SAFE_INTEGER;
	if (difference < -maximum) return -Number.MAX_SAFE_INTEGER;
	return Number(difference);
}

function relationId(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}
