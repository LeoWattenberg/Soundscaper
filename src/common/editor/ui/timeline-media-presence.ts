/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What the timeline holds, asked without loading the delivery surfaces.
 *
 * The File menu and the export dialog both need this question answered, and the
 * menu is part of the startup graph while the dialog is not. Keeping the two
 * predicates in a leaf module lets the menu ask without dragging the dialog's
 * preset and request-format modules in behind it.
 */

interface TimelineMediaClip {
	readonly id?: unknown;
	readonly kind?: unknown;
	readonly [field: string]: unknown;
}

interface TimelineMediaTrack {
	readonly type?: unknown;
	readonly clipIds?: readonly unknown[];
	readonly [field: string]: unknown;
}

interface TimelineMediaProject {
	readonly clips?: readonly (TimelineMediaClip | null | undefined)[];
	readonly tracks?: readonly (TimelineMediaTrack | null | undefined)[];
}

const VISUAL_CLIP_KINDS: readonly unknown[] = Object.freeze(['video', 'still', 'generator', 'image']);

/**
 * Whether the timeline holds audio an export would render.
 *
 * The audio render only walks audio tracks, so clips parked on a video track
 * contribute nothing to a mixdown. Untyped clips count as audio: documents
 * written before clips carried a `kind` field name none.
 */
export function projectHasTimelineAudio(project: TimelineMediaProject | null | undefined): boolean {
	return holdsClipKind(project, (kind) => kind === undefined || kind === 'audio', 'audio');
}

/** Whether the timeline holds picture a visual export would compose. */
export function projectHasTimelineVideo(project: TimelineMediaProject | null | undefined): boolean {
	return holdsClipKind(project, (kind) => VISUAL_CLIP_KINDS.includes(kind), 'video');
}

function holdsClipKind(
	project: TimelineMediaProject | null | undefined,
	matches: (kind: unknown) => boolean,
	trackType: string,
): boolean {
	if (!project?.tracks?.length || !project?.clips?.length) return false;
	const clipIds = new Set(project.clips.filter((clip) => matches(clip?.kind)).map((clip) => clip?.id));
	return project.tracks.some((track) => (
		track?.type === trackType
		&& track.clipIds?.some((clipId) => clipIds.has(clipId))
	));
}
