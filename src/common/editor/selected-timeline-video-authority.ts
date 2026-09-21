/* SPDX-License-Identifier: AGPL-3.0-only */

export interface SelectedTimelineVideoAuthorityOptions<Clip, Track> {
	readonly selectedClipIds: readonly string[];
	readonly focusedClipId: unknown;
	readonly clipForId: (clipId: string) => Clip | null | undefined;
	readonly isVideoClip: (clip: Clip) => boolean;
	readonly admitTargetClip?: (clip: Clip) => boolean;
	readonly owningTracksForClipId: (clipId: string) => readonly Track[] | null;
}

export interface SelectedTimelineVideoAuthority<Clip, Track> {
	readonly clipId: string;
	readonly clip: Clip;
	readonly track: Track;
}

/**
 * Resolve the one selected timeline video shared by menu and dialog surfaces.
 *
 * A persisted multi-clip selection owns targeting unless the focused clip is
 * its sole video member. That exception keeps a linked audio/video selection
 * editable from the focused video without admitting an ambiguous video pair.
 * Callers retain ownership of record admission and property access so their
 * hostile-input and traversal-budget policies remain at the feature boundary.
 */
export function resolveSelectedTimelineVideoAuthority<Clip, Track>(
	options: SelectedTimelineVideoAuthorityOptions<Clip, Track>,
): Readonly<SelectedTimelineVideoAuthority<Clip, Track>> | null {
	const focusedClipId = typeof options.focusedClipId === 'string'
		? options.focusedClipId
		: null;
	let targetClipIds = options.selectedClipIds.length > 0
		? options.selectedClipIds
		: focusedClipId === null ? [] : [focusedClipId];
	if (focusedClipId !== null && options.selectedClipIds.includes(focusedClipId)) {
		const focusedClip = options.clipForId(focusedClipId);
		const selectedVideoCount = options.selectedClipIds.filter((clipId) => {
			const clip = options.clipForId(clipId);
			return clip != null && options.isVideoClip(clip);
		}).length;
		if (focusedClip != null && options.isVideoClip(focusedClip) && selectedVideoCount === 1) {
			targetClipIds = [focusedClipId];
		}
	}
	if (targetClipIds.length !== 1) return null;
	const clipId = targetClipIds[0]!;
	const clip = options.clipForId(clipId);
	if (clip == null || !options.isVideoClip(clip)
		|| options.admitTargetClip?.(clip) === false) return null;
	const owners = options.owningTracksForClipId(clipId);
	if (owners === null || owners.length !== 1) return null;
	return Object.freeze({ clipId, clip, track: owners[0]! });
}
