/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveSelectionRange } from '../../selection-range.ts';
import type { EditingAuthorityProject, EditingAuthorityTrack } from '../../commands/editing-selection-authority.ts';

interface GeneratorTrack extends EditingAuthorityTrack {
	readonly locked?: unknown;
}
interface GeneratorProject extends EditingAuthorityProject {
	readonly tracks: readonly GeneratorTrack[];
}

/** Replacement publishes to every selected audio lane, including unfocused ones. */
export function generatorReplacementTargetLocked(
	project: GeneratorProject | null | undefined,
	focusedTrackId: string | null | undefined,
): boolean {
	const selection = resolveSelectionRange(project);
	if (!project || !selection) return false;
	const selected = new Set(selection.trackIds);
	const focused = project.tracks.find(track => track.id === focusedTrackId);
	const target = focused?.type === 'audio' ? focused
		: project.tracks.find(track => track.type === 'audio' && selected.has(track.id));
	if (!target) return false;
	const selectedTracks = project.tracks.filter(track => track.type === 'audio' && selected.has(track.id));
	return (selectedTracks.length ? selectedTracks : [target]).some(track => Boolean(track.locked));
}
