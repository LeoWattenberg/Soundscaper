/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectClipTransformIds as collectLegacyClipTransformIds } from './commands/clip-basic-runtime.js';
import {
	nonEmptyString,
	sameFrameTrimRate,
	type FrameCanonicalTrackLockPredicate,
	type FrameTrimDataRecord,
	type FrameTrimProjectIndex,
} from './frame-canonical-edge-trim-domain.ts';
import {
	frameCanonicalLinkedVideoCompanions,
	frameCanonicalTrimParticipant,
	type FrameCanonicalTrimParticipant,
} from './frame-canonical-trim-planning.ts';

export interface FrameCanonicalRateStretchTargets {
	readonly participants: readonly FrameCanonicalTrimParticipant[];
	readonly videos: readonly FrameCanonicalTrimParticipant[];
	readonly authority: FrameCanonicalTrimParticipant;
	readonly linkedVideoByAudioClipId: ReadonlyMap<string, FrameCanonicalTrimParticipant>;
	readonly videoTrackIds: ReadonlySet<string>;
}

const collectClipTransformIds = collectLegacyClipTransformIds as unknown as (
	project: FrameTrimDataRecord,
	activeClipId: string,
) => string[];

export function resolveFrameCanonicalRateStretchTargets(
	project: FrameTrimDataRecord,
	index: FrameTrimProjectIndex,
	activeClipId: string,
	isTrackLocked?: FrameCanonicalTrackLockPredicate,
): FrameCanonicalRateStretchTargets {
	const ids = collectClipTransformIds(project, activeClipId);
	if (!ids.length) throw new RangeError(`Active clip ${activeClipId} cannot seed a rate stretch.`);
	const selected = new Set(ids);
	const participants = index.clips
		.filter((clip) => selected.has(nonEmptyString(clip.id, 'clip.id')))
		.map((clip) => {
			const clipId = nonEmptyString(clip.id, 'clip.id');
			if (clip.kind === 'video' && clip.retimeMap != null) {
				throw new RangeError(`Video clip ${clipId} has a retime map.`);
			}
			return frameCanonicalTrimParticipant(index, clipId);
		});
	for (const item of participants) {
		assertTrackUnlocked(item.track, item.trackId, isTrackLocked);
		if (!item.video) assertNeutralAudio(item);
	}
	const videos = participants.filter((item) => item.video !== null);
	if (!videos.length) throw new RangeError('A frame-canonical rate stretch requires a video participant.');
	const videoTrackIds = new Set<string>();
	for (const video of videos) {
		if (videoTrackIds.has(video.trackId)) {
			throw new RangeError(`Rate stretch supports one participating video on lane ${video.trackId}.`);
		}
		videoTrackIds.add(video.trackId);
	}
	const linkedVideoByAudioClipId = frameCanonicalLinkedVideoCompanions(participants, videos);
	assertLinkedPresentation(participants, linkedVideoByAudioClipId);
	const active = participants.find(({ clipId }) => clipId === activeClipId);
	if (!active) throw new RangeError(`Active clip ${activeClipId} is outside the rate-stretch closure.`);
	const authority = active.video ? active : linkedVideoByAudioClipId.get(active.clipId);
	if (!authority) {
		throw new RangeError('Active unlinked audio cannot own a video-bearing rate-stretch request.');
	}
	const authorityVideo = authority.video!;
	for (const item of videos) {
		if (item.video!.sequenceId !== authorityVideo.sequenceId
			|| !sameFrameTrimRate(item.video!.sequenceRate, authorityVideo.sequenceRate)) {
			throw new RangeError('Participating video clips must use one sequence and rate.');
		}
	}
	return { participants, videos, authority, linkedVideoByAudioClipId, videoTrackIds };
}

function assertTrackUnlocked(
	track: FrameTrimDataRecord,
	trackId: string,
	isTrackLocked?: FrameCanonicalTrackLockPredicate,
): void {
	const descriptor = Object.getOwnPropertyDescriptor(track, 'locked');
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
		|| typeof descriptor.value !== 'boolean') {
		throw new TypeError(`Track ${trackId}.locked must be an own enumerable boolean data property.`);
	}
	if (descriptor.value || isTrackLocked?.(trackId)) throw new RangeError(`Track ${trackId} is locked.`);
}

function assertNeutralAudio(item: FrameCanonicalTrimParticipant): void {
	const clip = item.clip;
	if (clip.pitchCents !== 0 || clip.speedRatio !== 1 || clip.stretchToTempo !== false
		|| clip.warpMap != null) {
		throw new RangeError(`Audio clip ${item.clipId} must use neutral varispeed state.`);
	}
	if (!Array.isArray(clip.envelope)) throw new TypeError(`Audio clip ${item.clipId}.envelope must be an array.`);
	let priorFrame = -1;
	for (const [index, value] of clip.envelope.entries()) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new TypeError(`Audio clip ${item.clipId}.envelope[${String(index)}] must be an object.`);
		}
		const point = value as FrameTrimDataRecord;
		if (!Number.isSafeInteger(point.frame) || Number(point.frame) < 0
			|| Number(point.frame) > item.timelineEnd - item.timelineStart
			|| Number(point.frame) <= priorFrame) {
			throw new RangeError(`Audio clip ${item.clipId}.envelope frames must be ordered inside its extent.`);
		}
		priorFrame = Number(point.frame);
	}
}

function assertLinkedPresentation(
	participants: readonly FrameCanonicalTrimParticipant[],
	linkedVideoByAudioClipId: ReadonlyMap<string, FrameCanonicalTrimParticipant>,
): void {
	for (const audio of participants) {
		if (audio.video) continue;
		const linked = linkedVideoByAudioClipId.get(audio.clipId);
		if (!linked) continue;
		const audioLaneGroup = relationId(audio.track.laneGroupId);
		const videoLaneGroup = relationId(linked.track.laneGroupId);
		if (!audioLaneGroup || audioLaneGroup !== videoLaneGroup) {
			throw new RangeError(`A/V link ${String(audio.clip.avLinkId)} must use one media lane group.`);
		}
		if (audio.timelineStart !== linked.timelineStart || audio.timelineEnd !== linked.timelineEnd) {
			throw new RangeError(`A/V link ${String(audio.clip.avLinkId)} must have identical presentation endpoints.`);
		}
	}
}

function relationId(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}
