/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveSelectionRange } from './selection-range.ts';
import type { ControllerProject } from './controller/track-audio/track-domain-types.ts';

type AdjustSelection = (
	startFrame: number,
	endFrame: number,
	details: Readonly<{ trackIds: readonly string[] }>,
	options: Readonly<{ snap: false }>,
) => unknown;

/** Changing track scope preserves the effective time span and independent playhead. */
export function applyAudacityTrackScope(
	project: ControllerProject,
	trackIds: readonly string[],
	adjustSelection: AdjustSelection,
): unknown {
	const range = resolveSelectionRange(project) ?? project.selection;
	return adjustSelection(range?.startFrame ?? 0, range?.endFrame ?? 0, { trackIds }, { snap: false });
}
