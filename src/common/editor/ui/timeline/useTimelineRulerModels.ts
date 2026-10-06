/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo } from 'react';
import { createMappedTimelineTicks, resolveTimelineRulerScale } from './timeline-grid-model.ts';

/** Exact viewport ticks are independent from selection, theme and dock height. */
export function useTimelineRulerModels(
	project: Parameters<typeof resolveTimelineRulerScale>[0],
	pixelsPerSecond: number,
	sampleRate: number,
	scrollX: number,
	viewportWidth: number,
) {
	const rulerScale = useMemo(() => resolveTimelineRulerScale(project), [project]);
	const mappedTicks = useMemo(() => createMappedTimelineTicks({ scale: rulerScale,
		pixelsPerSecond, sampleRate, scrollX, viewportWidth }),
	[rulerScale, pixelsPerSecond, sampleRate, scrollX, viewportWidth]);
	return { rulerScale, mappedTicks };
}
