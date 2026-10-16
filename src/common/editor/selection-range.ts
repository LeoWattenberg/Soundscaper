/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEditingSelection, resolveEditingSelectionAuthority, type EditingAuthorityClip } from './commands/editing-selection-authority.ts';
import { clipContentRange } from './clip-content-range.ts';
import type { RuntimePersistedClip } from './runtime-clip-projection.ts';

// The document is the editor's untyped runtime projection; callers narrow it as
// their owning services migrate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuntimeValue = any;

export interface SelectionRange {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds: readonly string[];
	readonly clipIds: readonly string[];
}

/**
 * The frame range "the selection" names, however it was made.
 *
 * Selecting a clip collapses the drawn time range onto frame zero and records
 * the clip instead, so a command that reads `project.selection` alone sees no
 * selection at all and either refuses or acts on nothing. Upstream's own
 * commands ask the time selection first and fall back to the selected clips —
 * `doGlobalSplitIntoNewTrack` and its neighbours in
 * `src/trackedit/internal/trackeditactionscontroller.cpp` all share that shape
 * — and this resolves the same question once for every caller that needs a
 * single range rather than a set of edits.
 *
 * Disjoint clips answer with the span they bracket: a loop region, a zoom, a
 * playhead move and a measurement each need one contiguous range, and the span
 * is the only one of those that contains every selected clip.
 */
export function resolveSelectionRange(
	project: RuntimeValue,
	options: Readonly<{ selectedClipId?: string | null }> = {},
): SelectionRange | null {
	if (!project?.tracks || !project?.clips) return null;
	let editing;
	try {
		const selectedClipId = options.selectedClipId ?? null;
		const authority = resolveEditingSelectionAuthority({ project, focusedClipId: selectedClipId });
		const selected = new Set(authority.clipIds);
		const geometryProject = authority.range || !selected.size ? project : {
			...project,
			clips: project.clips.map((clip: EditingAuthorityClip & RuntimePersistedClip) => {
				if (!selected.has(clip.id)) return clip;
				const range = clipContentRange(project, clip);
				return range ? { ...clip, timelineStartFrame: range.startFrame, durationFrames: range.endFrame - range.startFrame } : clip;
			}),
		};
		editing = resolveEditingSelection(geometryProject, { selectedClipId });
	} catch (error) {
		// Imported clips can be selected before their timeline geometry resolves.
		if (error instanceof RangeError) return null;
		throw error;
	}
	if (!editing || editing.endFrame <= editing.startFrame) return null;
	return Object.freeze({
		startFrame: editing.startFrame,
		endFrame: editing.endFrame,
		trackIds: editing.trackIds,
		clipIds: editing.clipIds,
	});
}
