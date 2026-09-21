/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback } from 'react';

import { MappedTimelineRulerCanvas } from './MappedTimelineRulerCanvas.jsx';
import { createMusicalRulerTicks } from './musical-ruler-model.ts';

/** Viewport-bounded ruler for projects whose tempo or signature changes over time. */
export function MusicalTimelineRuler({ tempoMap, signatureMap, ...props }) {
	const buildTicks = useCallback(({ sampleRate, startFrame, endFrame, pixelsPerSample }) => (
		createMusicalRulerTicks({
			tempoMap,
			signatureMap,
			sampleRate,
			startFrame,
			endFrame,
			pixelsPerFrame: pixelsPerSample,
		})
	), [signatureMap, tempoMap]);
	return <MappedTimelineRulerCanvas
		{...props}
		buildTicks={buildTicks}
		dataAttribute="data-musical-map-ruler"
		minorLabelMinimumPixels={46}
	/>;
}
