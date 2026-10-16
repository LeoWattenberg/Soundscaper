/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveSelectionRange } from '../../selection-range.ts';
import type { EditingAuthorityProject, EditingAuthorityTrack } from '../../commands/editing-selection-authority.ts';

interface SpectralTrack extends EditingAuthorityTrack { readonly locked?: unknown }
interface SpectralProject extends EditingAuthorityProject { readonly tracks: readonly SpectralTrack[] }

/** The box selection keeps exact clip targets alongside its display range. */
export function spectralSelectionTargetLocked(
	project: SpectralProject | null | undefined,
	focusedTrackId: string | null | undefined,
	focusedClipId: string | null | undefined,
): boolean {
	if (!project) return false;
	const scoped = project.selection?.clipIds?.length
		? { ...project, selection: { ...project.selection, startFrame: 0, endFrame: 0 } } : project;
	const range = resolveSelectionRange(scoped, { selectedClipId: focusedClipId });
	if (!range) return false;
	const trackIds = new Set(range.trackIds.length ? range.trackIds : [focusedTrackId]);
	const clipIds = new Set(range.clipIds);
	const clips = new Map(project.clips.map(clip => [clip.id, clip]));
	return project.tracks.some(track => track.type === 'audio' && Boolean(track.locked)
		&& trackIds.has(track.id) && track.clipIds?.some(clipId => {
			const clip = clips.get(clipId);
			if (!clip || (clip.kind !== undefined && clip.kind !== 'audio')) return false;
			if (clipIds.size > 0) return clipIds.has(clipId);
			return Number(clip.timelineStartFrame) < range.endFrame
				&& Number(clip.timelineStartFrame) + Number(clip.durationFrames) > range.startFrame;
		}));
}
