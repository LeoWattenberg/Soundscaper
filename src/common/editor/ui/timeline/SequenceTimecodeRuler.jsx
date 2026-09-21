/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback } from 'react';

import { MappedTimelineRulerCanvas } from './MappedTimelineRulerCanvas.jsx';
import { createSequenceRulerTicks } from './sequence-ruler-model.ts';

/** Viewport-bounded SMPTE ruler for sequences displayed in timecode. */
export function SequenceTimecodeRuler({ view, ...props }) {
	const buildTicks = useCallback(({ sampleRate, startFrame, endFrame, pixelsPerSample }) => (
		createSequenceRulerTicks({ view, sampleRate, startFrame, endFrame, pixelsPerSample })
	), [view]);
	return <MappedTimelineRulerCanvas
		{...props}
		buildTicks={buildTicks}
		dataAttribute="data-sequence-timecode-ruler"
	/>;
}
