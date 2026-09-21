/* SPDX-License-Identifier: AGPL-3.0-only */

import { canJoinClips as canJoinLegacyClips } from './clip-link-runtime.js';
import { normalizeFrameRange } from '../project.js';

export interface EditingAuthorityClip {
	readonly id: string;
	readonly timelineStartFrame?: number;
	readonly durationFrames?: number;
	readonly kind?: unknown;
	readonly pitchCents?: unknown;
	readonly groupId?: string | null;
	readonly avLinkId?: string | null;
}

export interface EditingAuthorityTrack {
	readonly id: string;
	readonly type?: unknown;
	readonly clipIds?: readonly string[];
}

export interface EditingAuthoritySelection {
	readonly startFrame?: unknown;
	readonly endFrame?: unknown;
	readonly clipIds?: readonly unknown[];
	readonly trackIds?: readonly unknown[];
}

export interface EditingAuthorityProject {
	readonly clips: readonly EditingAuthorityClip[];
	readonly tracks: readonly EditingAuthorityTrack[];
	readonly selection?: EditingAuthoritySelection | null;
}

export type EditingTargetSource = 'explicit' | 'persisted' | 'focus' | 'none';

export interface EditingSelectionAuthority {
	readonly project: EditingAuthorityProject | null;
	readonly selection: EditingAuthoritySelection | null;
	readonly range: Readonly<{ readonly startFrame: number; readonly endFrame: number }> | null;
	readonly seedClipIds: readonly string[];
	readonly clipIds: readonly string[];
	readonly clips: readonly EditingAuthorityClip[];
	readonly clipTrackIds: readonly string[];
	readonly trackIds: readonly string[];
	readonly tracks: readonly EditingAuthorityTrack[];
	readonly clipSource: EditingTargetSource;
	readonly trackSource: EditingTargetSource;
	readonly editSelectionActive: boolean;
}

export interface EditingSelectionAuthorityInput {
	readonly project?: EditingAuthorityProject | null;
	readonly selection?: EditingAuthoritySelection | null;
	readonly focusedClipId?: unknown;
	readonly focusedTrackId?: unknown;
	readonly explicitClipIds?: readonly unknown[] | null;
	readonly explicitTrackIds?: readonly unknown[] | null;
}

export interface EditingActionAvailability extends EditingSelectionAuthority {
	readonly split: boolean;
	readonly join: boolean;
	readonly group: boolean;
	readonly ungroup: boolean;
}

type LegacyJoinPreflight = (
	project: EditingAuthorityProject,
	clipIds: readonly string[],
) => boolean;

const canJoinClips = canJoinLegacyClips as LegacyJoinPreflight;

/**
 * Resolve selection identity once for controllers, menu/toolbar enablement and
 * Audacity shortcut predicates. A positive range is the editing target. With
 * no range, each identity dimension takes the first non-empty set of valid
 * explicit, persisted, then focused targets.
 */
export function resolveEditingSelectionAuthority(
	input: EditingSelectionAuthorityInput,
): EditingSelectionAuthority {
	const project = input.project ?? null;
	const selection = input.selection ?? project?.selection ?? null;
	if (!project) return emptyAuthority(selection);
	const range = positiveRange(selection);
	const availableClips = new Map(project.clips.map((clip) => [clip.id, clip]));
	const availableTracks = new Map(project.tracks.map((track) => [track.id, track]));
	const persistedClipIds = validUniqueIds(selection?.clipIds, availableClips);
	const persistedTrackIds = validUniqueIds(selection?.trackIds, availableTracks);
	const explicitClipIds = validUniqueIds(input.explicitClipIds, availableClips);
	const explicitTrackIds = validUniqueIds(input.explicitTrackIds, availableTracks);
	const focusedClipIds = validUniqueIds([input.focusedClipId], availableClips);
	const focusedTrackIds = validUniqueIds([input.focusedTrackId], availableTracks);

	const [seedClipIds, clipSource] = range
		? [EMPTY_IDS, 'none'] as const
		: firstTargets(explicitClipIds, persistedClipIds, focusedClipIds);
	const [trackIds, trackSource] = range
		? firstTargets(EMPTY_IDS, persistedTrackIds, focusedTrackIds)
		: firstTargets(explicitTrackIds, persistedTrackIds, focusedTrackIds);
	const clipIds = range ? EMPTY_IDS : collectRelatedClipIds(project, seedClipIds);
	const clips = clipIds.map((clipId) => availableClips.get(clipId) as EditingAuthorityClip);
	const tracks = trackIds.map((trackId) => availableTracks.get(trackId) as EditingAuthorityTrack);
	const clipTrackIds = uniqueStrings(clips.flatMap((clip) => (
		project.tracks.find((track) => track.clipIds?.includes(clip.id))?.id ?? []
	)));
	return Object.freeze({
		project,
		selection,
		range,
		seedClipIds: freezeIds(seedClipIds),
		clipIds: freezeIds(clipIds),
		clips: Object.freeze(clips),
		clipTrackIds: freezeIds(clipTrackIds),
		trackIds: freezeIds(trackIds),
		tracks: Object.freeze(tracks),
		clipSource,
		trackSource,
		editSelectionActive: range !== null || clipIds.length > 0,
	});
}

/** Operation gates derived from the exact targets controller execution uses. */
export function resolveEditingActionAvailability(
	input: EditingSelectionAuthorityInput,
): EditingActionAvailability {
	const authority = resolveEditingSelectionAuthority(input);
	const mediaTracks = authority.project?.tracks.filter(isMediaTrack) ?? [];
	const selectedMediaTracks = authority.tracks.filter(isMediaTrack);
	const splitTracks = authority.range && selectedMediaTracks.length === 0
		? mediaTracks
		: selectedMediaTracks;
	const split = authority.clipIds.length > 0
		|| splitTracks.some((track) => track.clipIds.length > 0);
	return Object.freeze({
		...authority,
		split,
		join: Boolean(authority.project && canJoinClips(authority.project, authority.clipIds)),
		group: authority.clipIds.length > 1,
		ungroup: authority.clips.some((clip) => typeof clip.groupId === 'string' && clip.groupId.length > 0),
	});
}

/** Expand clip identities through edit groups and linked A/V pairs. */
export function collectRelatedClipIds(
	project: EditingAuthorityProject,
	clipIds: string | readonly string[],
): string[] {
	const available = new Map(project.clips.map((clip) => [clip.id, clip]));
	const ids = new Set((Array.isArray(clipIds) ? clipIds : [clipIds])
		.filter((clipId): clipId is string => typeof clipId === 'string' && available.has(clipId)));
	let changed = true;
	while (changed) {
		changed = false;
		const groupIds = new Set([...ids].flatMap((clipId) => {
			const groupId = available.get(clipId)?.groupId;
			return typeof groupId === 'string' && groupId ? [groupId] : [];
		}));
		const avLinkIds = new Set([...ids].flatMap((clipId) => {
			const avLinkId = available.get(clipId)?.avLinkId;
			return typeof avLinkId === 'string' && avLinkId ? [avLinkId] : [];
		}));
		for (const clip of project.clips) {
			if (
				(typeof clip.groupId === 'string' && groupIds.has(clip.groupId))
				|| (typeof clip.avLinkId === 'string' && avLinkIds.has(clip.avLinkId))
			) {
				if (!ids.has(clip.id)) changed = true;
				ids.add(clip.id);
			}
		}
	}
	return project.clips.flatMap((clip) => ids.has(clip.id) ? [clip.id] : []);
}

interface EditingSelectionOptions {
	readonly selection?: EditingAuthoritySelection | null;
	readonly clipIds?: readonly unknown[] | null;
	readonly selectedClipId?: unknown;
}

export function resolveEditingSelection(
	project: EditingAuthorityProject | null | undefined,
	options: EditingSelectionOptions = {},
) {
	if (!project) return null;
	const authority = resolveEditingSelectionAuthority({
		project,
		selection: options.selection,
		explicitClipIds: options.clipIds,
		focusedClipId: options.selectedClipId,
	});
	if (authority.range) {
		const { startFrame, endFrame } = authority.range;
		return Object.freeze({
			kind: 'range' as const,
			startFrame,
			endFrame,
			ranges: Object.freeze([Object.freeze({
				startFrame,
				endFrame,
				durationFrames: endFrame - startFrame,
			})]),
			trackIds: authority.trackIds,
			clipIds: EMPTY_IDS,
		});
	}
	if (!authority.clipIds.length) return null;
	const trackIds = authority.clipIds.map((clipId) => {
		const track = project.tracks.find((candidate) => candidate.clipIds?.includes(clipId));
		if (!track) throw new RangeError(`Clip ${clipId} is not assigned to a track.`);
		return track.id;
	});
	const ranges = mergeEditingRanges(authority.clips.map((clip) => {
		if (!Number.isSafeInteger(clip.timelineStartFrame) || !Number.isSafeInteger(clip.durationFrames)) {
			throw new RangeError(`Clip ${clip.id} must have resolved timeline geometry.`);
		}
		const startFrame = Number(clip.timelineStartFrame);
		return { startFrame, endFrame: startFrame + Number(clip.durationFrames) };
	}));
	return Object.freeze({
		kind: 'clips' as const,
		startFrame: ranges[0]!.startFrame,
		endFrame: ranges.at(-1)!.endFrame,
		ranges: Object.freeze(ranges.map(Object.freeze)),
		trackIds: freezeIds(uniqueStrings(trackIds)),
		clipIds: authority.clipIds,
	});
}

interface EditingRangeInput {
	readonly startFrame: number;
	readonly endFrame: number;
}


interface EditingRange {
	startFrame: number;
	endFrame: number;
	durationFrames: number;
}

export function mergeEditingRanges(ranges: readonly EditingRangeInput[]): EditingRange[] {
	const sorted = ranges
		.map((range) => normalizeFrameRange(range.startFrame, range.endFrame, 'editing selection'))
		.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
	const merged: EditingRange[] = [];
	for (const range of sorted) {
		const previous = merged.at(-1);
		if (previous && range.startFrame <= previous.endFrame) {
			previous.endFrame = Math.max(previous.endFrame, range.endFrame);
			previous.durationFrames = previous.endFrame - previous.startFrame;
		} else merged.push({ ...range });
	}
	return merged;
}

const EMPTY_IDS = Object.freeze([]) as readonly string[];

function emptyAuthority(selection: EditingAuthoritySelection | null): EditingSelectionAuthority {
	return Object.freeze({
		project: null,
		selection,
		range: null,
		seedClipIds: EMPTY_IDS,
		clipIds: EMPTY_IDS,
		clips: Object.freeze([]),
		clipTrackIds: EMPTY_IDS,
		trackIds: EMPTY_IDS,
		tracks: Object.freeze([]),
		clipSource: 'none',
		trackSource: 'none',
		editSelectionActive: false,
	});
}

function positiveRange(selection: EditingAuthoritySelection | null): Readonly<{
	readonly startFrame: number;
	readonly endFrame: number;
}> | null {
	if (
		!Number.isSafeInteger(selection?.startFrame)
		|| !Number.isSafeInteger(selection?.endFrame)
		|| Number(selection?.endFrame) <= Number(selection?.startFrame)
	) return null;
	return Object.freeze({
		startFrame: Number(selection?.startFrame),
		endFrame: Number(selection?.endFrame),
	});
}

function firstTargets(
	explicit: readonly string[],
	persisted: readonly string[],
	focused: readonly string[],
): readonly [readonly string[], EditingTargetSource] {
	if (explicit.length) return [explicit, 'explicit'];
	if (persisted.length) return [persisted, 'persisted'];
	if (focused.length) return [focused, 'focus'];
	return [EMPTY_IDS, 'none'];
}

function validUniqueIds<RecordValue>(
	values: readonly unknown[] | null | undefined,
	available: ReadonlyMap<string, RecordValue>,
): string[] {
	if (!Array.isArray(values)) return [];
	return uniqueStrings(values.flatMap((value) => (
		typeof value === 'string' && available.has(value) ? [value] : []
	)));
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function freezeIds(values: readonly string[]): readonly string[] {
	return Object.freeze([...values]);
}

function isMediaTrack(track: EditingAuthorityTrack): track is EditingAuthorityTrack & {
	readonly type: 'audio' | 'video';
	readonly clipIds: readonly string[];
} {
	return (track.type === 'audio' || track.type === 'video') && Array.isArray(track.clipIds);
}
