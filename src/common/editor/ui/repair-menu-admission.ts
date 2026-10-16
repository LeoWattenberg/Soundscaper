/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDACITY_EFFECT_DEFINITIONS } from '../audacity-effects/manifest.js';
import { resolveEditingSelectionAuthority, type EditingAuthorityProject } from '../commands/editing-selection-authority.ts';

/** Match the processor's per-target limit, including independent clip and source selections. */
export function repairSelectionAvailable(
	project: EditingAuthorityProject | null | undefined,
	selectedClipId: string | null,
	sourceSelectionFrames?: number | null,
): boolean {
	const limit = AUDACITY_EFFECT_DEFINITIONS['audacity-repair'].maximumInputFrames;
	const supported = (frames: number | undefined): boolean => typeof frames === 'number' && Number.isSafeInteger(frames) && frames > 0 && frames <= limit;
	if (sourceSelectionFrames != null) return supported(sourceSelectionFrames);
	if (!project) return false;
	const selection = project.selection;
	// Spectral clip selections retain their exact clips despite the display range.
	const scoped = selection && 'frequencyRange' in selection && selection.frequencyRange && selection.clipIds?.length
		? { ...project, selection: { ...selection, startFrame: 0, endFrame: 0 } } : project;
	const authority = resolveEditingSelectionAuthority({ project: scoped, focusedClipId: selectedClipId });
	if (authority.range) return supported(authority.range.endFrame - authority.range.startFrame);
	const audioClipIds = new Set(project.tracks.filter(track => track.type === 'audio').flatMap(track => track.clipIds ?? []));
	const clips = authority.clips.filter(clip => clip.kind === 'audio' && audioClipIds.has(clip.id));
	return clips.length > 0 && clips.every(clip => supported(clip.durationFrames));
}
