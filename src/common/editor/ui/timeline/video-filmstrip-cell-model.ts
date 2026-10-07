/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo } from 'react';
import { framesToSeconds } from '../../design-system-adapters/control-values.ts';

interface ThumbnailPoint { readonly timelineFrame: number; readonly sourceTimeSeconds: number; }

/** Exact-frame publications update the pixels while retaining all static cell geometry and labels. */
export function useVideoFilmstripCells(points: readonly ThumbnailPoint[], visibleStartFrame: number, visibleEndFrame: number,
	sampleRate: number, pixelsPerSecond: number) {
	return useMemo(() => points.map((point, index) => ({
		left: framesToSeconds(point.timelineFrame - visibleStartFrame, { sampleRate }) * pixelsPerSecond,
		width: Math.max(1, framesToSeconds((points[index + 1]?.timelineFrame ?? visibleEndFrame) - point.timelineFrame, { sampleRate }) * pixelsPerSecond),
		title: `${point.sourceTimeSeconds.toFixed(1)} s`,
		time: formatThumbnailTime(point.sourceTimeSeconds),
	})), [points, visibleStartFrame, visibleEndFrame, sampleRate, pixelsPerSecond]);
}

export function formatThumbnailTime(seconds: number): string {
	const value = Math.max(0, Number(seconds) || 0);
	const minutes = Math.floor(value / 60);
	const remaining = Math.floor(value % 60);
	return `${minutes}:${String(remaining).padStart(2, '0')}`;
}
