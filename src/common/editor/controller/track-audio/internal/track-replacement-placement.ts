/* SPDX-License-Identifier: AGPL-3.0-only */

import { trackHierarchyPlacement } from '../../../track-hierarchy-placement.ts';

/** Capture a track's hierarchy position before its replacement removes it. */
export function trackReplacementPlacement(
	project: object,
	trackId: string,
	offset = 0,
): ReturnType<typeof trackHierarchyPlacement> {
	return trackHierarchyPlacement(project, trackId, offset);
}
