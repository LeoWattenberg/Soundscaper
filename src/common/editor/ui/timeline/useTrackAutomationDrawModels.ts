/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo } from 'react';
import { trackAutomationPathData } from './track-automation-overlay-bezier.ts';
import { projectTrackAutomationPoints } from './track-automation-overlay-points.ts';
import type { TrackAutomationOverlaySpanV21 } from './track-automation-overlay-projection.ts';

export function useTrackAutomationSpanPaths(spans: readonly TrackAutomationOverlaySpanV21[]) {
	return useMemo(() => spans.map(span => trackAutomationPathData(span.samples)), [spans]);
}

export function useTrackAutomationPointModels(spans: readonly TrackAutomationOverlaySpanV21[]) {
	return useMemo(() => projectTrackAutomationPoints(spans), [spans]);
}
