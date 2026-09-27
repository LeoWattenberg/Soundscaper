/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../commands/protocol.ts';
import type {
	TimelineIndexSource,
	TimelineIndexTrack,
	TimelineProjectIndex,
} from '../../design-system-adapters/types.ts';
import { createClipTrimPreview } from './interaction-helpers.js';

export interface CrossfadeRollClip {
	readonly id: string;
	readonly kind: 'audio';
	readonly sourceId: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames?: number;
	readonly reversed?: boolean;
	readonly trimStartFrames?: number;
	readonly trimEndFrames?: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly fadeInShape?: number;
	readonly fadeOutShape?: number;
	readonly groupId?: string | null;
	readonly avLinkId?: string | null;
	readonly warpMap?: unknown;
	readonly anchor?: 'sample' | 'musical';
}

export interface CrossfadeRollSource extends TimelineIndexSource {
	readonly frameCount: number;
}

export interface CrossfadeRollTrack extends TimelineIndexTrack {
	readonly id: string;
}

export type CrossfadeRollProjectIndex = TimelineProjectIndex<
	CrossfadeRollClip,
	CrossfadeRollSource,
	CrossfadeRollTrack
>;

export interface CrossfadeRollPreview {
	readonly clipId: string;
	readonly trackId?: string;
	readonly waveformPreviewKind: 'trim';
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly trimStartFrames: number;
	readonly trimEndFrames: number;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly fadeInShape?: number;
	readonly fadeOutShape?: number;
}

type ClipTrimCommand = Extract<AudioEditorCommand, { readonly type: 'clip/trim' }>;
type BatchCommand = Extract<AudioEditorCommand, { readonly type: 'batch' }>;

export interface CrossfadeRollPlan {
	readonly appliedDeltaFrames: number;
	readonly command: BatchCommand;
	readonly previews: readonly [CrossfadeRollPreview, CrossfadeRollPreview];
}

export interface CrossfadeRollRequest {
	readonly projectIndex: CrossfadeRollProjectIndex;
	readonly outgoing: CrossfadeRollClip;
	readonly incoming: CrossfadeRollClip;
	readonly requestedDeltaFrames: number;
}

interface ClipTrimPreviewSession {
	readonly clipId: string;
	readonly clipIds: readonly string[];
	readonly original: CrossfadeRollClip;
	readonly originals: Readonly<Record<string, CrossfadeRollClip>>;
}

interface LegacyClipTrimPreview extends CrossfadeRollPreview {
	readonly previews: readonly CrossfadeRollPreview[];
}

type ClipTrimPreviewFactory = (
	projectIndex: CrossfadeRollProjectIndex,
	session: ClipTrimPreviewSession,
	requestedDelta: number,
	edge: 'left' | 'right',
) => LegacyClipTrimPreview | null;

const createTrimPreview = createClipTrimPreview as unknown as ClipTrimPreviewFactory;

/**
 * Plan an Audacity-style crossfade roll without changing the overlap length.
 * The outgoing right edge and incoming left edge always use one shared delta.
 */
export function planCrossfadeRoll({
	projectIndex,
	outgoing,
	incoming,
	requestedDeltaFrames,
}: CrossfadeRollRequest): Readonly<CrossfadeRollPlan> | null {
	if (!Number.isSafeInteger(requestedDeltaFrames) || requestedDeltaFrames === 0
		|| !isProperCrossfade(outgoing, incoming)
		|| !rollEligible(outgoing) || !rollEligible(incoming)) return null;
	const indexedOutgoing = projectIndex.clipById.get(outgoing.id);
	const indexedIncoming = projectIndex.clipById.get(incoming.id);
	if (!sameRollAuthority(indexedOutgoing, outgoing)
		|| !sameRollAuthority(indexedIncoming, incoming)) return null;
	const outgoingTrack = projectIndex.trackByClipId.get(outgoing.id);
	const incomingTrack = projectIndex.trackByClipId.get(incoming.id);
	if (!outgoingTrack || outgoingTrack.id !== incomingTrack?.id) return null;

	const outgoingEnd = outgoing.timelineStartFrame + outgoing.durationFrames;
	const incomingEnd = incoming.timelineStartFrame + incoming.durationFrames;
	const trackClips = projectIndex.clipsByTrackId.get(outgoingTrack.id) ?? [];
	let geometryMinimum = outgoing.timelineStartFrame - incoming.timelineStartFrame + 1;
	let geometryMaximum = incomingEnd - outgoingEnd - 1;
	for (const clip of trackClips) {
		if (clip.id === outgoing.id || clip.id === incoming.id || !validClip(clip)) continue;
		const clipEnd = clip.timelineStartFrame + clip.durationFrames;
		const overlapsOutgoing = rangesOverlap(
			clip.timelineStartFrame, clipEnd, outgoing.timelineStartFrame, outgoingEnd,
		);
		const overlapsIncoming = rangesOverlap(
			clip.timelineStartFrame, clipEnd, incoming.timelineStartFrame, incomingEnd,
		);
		if (overlapsOutgoing && overlapsIncoming) return null;
		if (overlapsOutgoing) {
			geometryMinimum = Math.max(geometryMinimum, clipEnd - incoming.timelineStartFrame);
		}
		if (overlapsIncoming) {
			geometryMaximum = Math.min(geometryMaximum, clip.timelineStartFrame - outgoingEnd);
		}
	}
	if (geometryMinimum > geometryMaximum) return null;
	const geometryDelta = Math.max(
		geometryMinimum,
		Math.min(geometryMaximum, requestedDeltaFrames),
	);
	if (geometryDelta === 0) return null;

	const outgoingSession = trimSession(outgoing);
	const incomingSession = trimSession(incoming);
	const outgoingCandidate = createTrimPreview(
		projectIndex, outgoingSession, geometryDelta, 'right',
	);
	const incomingCandidate = createTrimPreview(
		projectIndex, incomingSession, geometryDelta, 'left',
	);
	if (!outgoingCandidate || !incomingCandidate) return null;
	const outgoingDelta = outgoingCandidate.durationFrames - outgoing.durationFrames;
	const incomingDelta = incomingCandidate.timelineStartFrame - incoming.timelineStartFrame;
	if (!Number.isSafeInteger(outgoingDelta) || !Number.isSafeInteger(incomingDelta)) return null;
	const appliedDeltaFrames = geometryDelta > 0
		? Math.min(geometryDelta, outgoingDelta, incomingDelta)
		: Math.max(geometryDelta, outgoingDelta, incomingDelta);
	if (appliedDeltaFrames === 0) return null;

	const outgoingResult = createTrimPreview(
		projectIndex, outgoingSession, appliedDeltaFrames, 'right',
	);
	const incomingResult = createTrimPreview(
		projectIndex, incomingSession, appliedDeltaFrames, 'left',
	);
	if (!outgoingResult || !incomingResult) return null;
	const outgoingPreview = freezePreview(outgoingResult);
	const incomingPreview = freezePreview(incomingResult);
	if (!hasAppliedDelta(outgoingPreview, incomingPreview, outgoing, incoming, appliedDeltaFrames)) {
		return null;
	}
	if (trackClips.some(clip => clip.id !== outgoing.id && clip.id !== incoming.id
		&& validClip(clip)
		&& rangesOverlap(
			clip.timelineStartFrame,
			clip.timelineStartFrame + clip.durationFrames,
			outgoingPreview.timelineStartFrame,
			outgoingPreview.timelineStartFrame + outgoingPreview.durationFrames,
		)
		&& rangesOverlap(
			clip.timelineStartFrame,
			clip.timelineStartFrame + clip.durationFrames,
			incomingPreview.timelineStartFrame,
			incomingPreview.timelineStartFrame + incomingPreview.durationFrames,
		))) return null;

	const previews: readonly [CrossfadeRollPreview, CrossfadeRollPreview] = Object.freeze([
		outgoingPreview,
		incomingPreview,
	]);
	const commands: readonly [ClipTrimCommand, ClipTrimCommand] = Object.freeze([
		trimCommand(outgoing, outgoingPreview),
		trimCommand(incoming, incomingPreview),
	]);
	const command: BatchCommand = Object.freeze({ type: 'batch', commands });
	return Object.freeze({ appliedDeltaFrames, command, previews });
}

function isProperCrossfade(outgoing: CrossfadeRollClip, incoming: CrossfadeRollClip): boolean {
	if (outgoing.id === incoming.id || !validClip(outgoing) || !validClip(incoming)) return false;
	const outgoingEnd = outgoing.timelineStartFrame + outgoing.durationFrames;
	const incomingEnd = incoming.timelineStartFrame + incoming.durationFrames;
	return outgoing.timelineStartFrame < incoming.timelineStartFrame
		&& incoming.timelineStartFrame < outgoingEnd
		&& outgoingEnd < incomingEnd;
}

function validClip(clip: CrossfadeRollClip): boolean {
	return clip.kind === 'audio'
		&& Number.isSafeInteger(clip.timelineStartFrame)
		&& clip.timelineStartFrame >= 0
		&& Number.isSafeInteger(clip.durationFrames)
		&& clip.durationFrames > 0
		&& Number.isSafeInteger(clip.timelineStartFrame + clip.durationFrames)
		&& Number.isSafeInteger(clip.sourceStartFrame)
		&& clip.sourceStartFrame >= 0
		&& (clip.sourceDurationFrames === undefined
			|| (Number.isSafeInteger(clip.sourceDurationFrames)
				&& clip.sourceDurationFrames > 0
				&& Number.isSafeInteger(clip.sourceStartFrame + clip.sourceDurationFrames)));
}

function rangesOverlap(
	leftStart: number,
	leftEnd: number,
	rightStart: number,
	rightEnd: number,
): boolean {
	return leftStart < rightEnd && leftEnd > rightStart;
}

/** Relation expansion and warped/musical edge authority belong to the controller trim path. */
function rollEligible(clip: CrossfadeRollClip): boolean {
	return clip.groupId == null
		&& clip.avLinkId == null
		&& clip.warpMap == null
		&& clip.anchor !== 'musical';
}

function sameRollAuthority(
	indexed: CrossfadeRollClip | undefined,
	original: CrossfadeRollClip,
): boolean {
	if (!indexed) return false;
	return indexed.id === original.id
		&& indexed.kind === original.kind
		&& indexed.sourceId === original.sourceId
		&& indexed.timelineStartFrame === original.timelineStartFrame
		&& indexed.durationFrames === original.durationFrames
		&& indexed.sourceStartFrame === original.sourceStartFrame
		&& indexed.sourceDurationFrames === original.sourceDurationFrames
		&& indexed.reversed === original.reversed
		&& indexed.trimStartFrames === original.trimStartFrames
		&& indexed.trimEndFrames === original.trimEndFrames
		&& indexed.fadeInFrames === original.fadeInFrames
		&& indexed.fadeOutFrames === original.fadeOutFrames
		&& indexed.groupId === original.groupId
		&& indexed.avLinkId === original.avLinkId
		&& indexed.warpMap === original.warpMap
		&& indexed.anchor === original.anchor;
}

function trimSession(clip: CrossfadeRollClip): Readonly<ClipTrimPreviewSession> {
	return Object.freeze({
		clipId: clip.id,
		clipIds: Object.freeze([clip.id]),
		original: clip,
		originals: Object.freeze({ [clip.id]: clip }),
	});
}

function freezePreview(preview: LegacyClipTrimPreview): Readonly<CrossfadeRollPreview> {
	return Object.freeze({
		clipId: preview.clipId,
		...(preview.trackId === undefined ? {} : { trackId: preview.trackId }),
		waveformPreviewKind: 'trim',
		timelineStartFrame: preview.timelineStartFrame,
		sourceStartFrame: preview.sourceStartFrame,
		sourceDurationFrames: preview.sourceDurationFrames,
		durationFrames: preview.durationFrames,
		trimStartFrames: preview.trimStartFrames,
		trimEndFrames: preview.trimEndFrames,
		fadeInFrames: preview.fadeInFrames,
		fadeOutFrames: preview.fadeOutFrames,
		...(preview.fadeInShape === undefined ? {} : { fadeInShape: preview.fadeInShape }),
		...(preview.fadeOutShape === undefined ? {} : { fadeOutShape: preview.fadeOutShape }),
	});
}

function hasAppliedDelta(
	outgoingPreview: CrossfadeRollPreview,
	incomingPreview: CrossfadeRollPreview,
	outgoing: CrossfadeRollClip,
	incoming: CrossfadeRollClip,
	appliedDeltaFrames: number,
): boolean {
	const originalOverlap = outgoing.timelineStartFrame + outgoing.durationFrames
		- incoming.timelineStartFrame;
	const previewOverlap = outgoingPreview.timelineStartFrame + outgoingPreview.durationFrames
		- incomingPreview.timelineStartFrame;
	return outgoingPreview.clipId === outgoing.id
		&& incomingPreview.clipId === incoming.id
		&& outgoingPreview.durationFrames - outgoing.durationFrames === appliedDeltaFrames
		&& incomingPreview.timelineStartFrame - incoming.timelineStartFrame === appliedDeltaFrames
		&& incoming.durationFrames - incomingPreview.durationFrames === appliedDeltaFrames
		&& previewOverlap === originalOverlap;
}

function trimCommand(
	original: CrossfadeRollClip,
	preview: CrossfadeRollPreview,
): Readonly<ClipTrimCommand> {
	const changes: Omit<ClipTrimCommand, 'type' | 'clipId'> = {
		...(preview.timelineStartFrame === original.timelineStartFrame
			? {} : { timelineStartFrame: preview.timelineStartFrame }),
		...(preview.sourceStartFrame === original.sourceStartFrame
			? {} : { sourceStartFrame: preview.sourceStartFrame }),
		...(preview.sourceDurationFrames === (original.sourceDurationFrames ?? original.durationFrames)
			? {} : { sourceDurationFrames: preview.sourceDurationFrames }),
		...(preview.durationFrames === original.durationFrames
			? {} : { durationFrames: preview.durationFrames }),
		...(preview.trimStartFrames === (original.trimStartFrames ?? 0)
			? {} : { trimStartFrames: preview.trimStartFrames }),
		...(preview.trimEndFrames === (original.trimEndFrames ?? 0)
			? {} : { trimEndFrames: preview.trimEndFrames }),
		...(preview.fadeInFrames === (original.fadeInFrames ?? 0)
			? {} : { fadeInFrames: preview.fadeInFrames }),
		...(preview.fadeOutFrames === (original.fadeOutFrames ?? 0)
			? {} : { fadeOutFrames: preview.fadeOutFrames }),
	};
	return Object.freeze({ type: 'clip/trim', clipId: original.id, ...changes });
}
