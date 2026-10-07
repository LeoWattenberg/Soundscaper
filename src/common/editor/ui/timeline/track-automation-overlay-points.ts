/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TrackAutomationOverlayPointV21, TrackAutomationOverlaySpanV21 } from './track-automation-overlay-projection.ts';

/** Authored track points keep their identity when their visible clip span changes. */
export function projectTrackAutomationPoints(spans: readonly TrackAutomationOverlaySpanV21[]): readonly TrackAutomationOverlayPointV21[] {
	const points = new Map<string, TrackAutomationOverlayPointV21>();
	for (const span of spans) for (const point of span.points) {
		if (!points.has(point.id)) points.set(point.id, point);
	}
	return [...points.values()];
}
