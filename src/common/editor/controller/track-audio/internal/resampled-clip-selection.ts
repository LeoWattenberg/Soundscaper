/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { ControllerSelection } from '../track-domain-types.ts';

/** Restore live selection pruned by transient clip removal, after all re-add/relink commands. */
export function resampledClipSelectionCommands(
	selection: ControllerSelection | null | undefined,
	replacedClipIds: readonly string[],
): AudioEditorCommand[] {
	if (!selection) return [];
	const selected = new Set(selection.clipIds);
	if (!replacedClipIds.some(id => selected.has(id))) return [];
	return [{ ...selection, type: 'selection/set',
		frequencyRange: selection.frequencyRange ? {
			minimumFrequency: selection.frequencyRange.minimumFrequency,
			maximumFrequency: selection.frequencyRange.maximumFrequency,
		} : null }];
}
