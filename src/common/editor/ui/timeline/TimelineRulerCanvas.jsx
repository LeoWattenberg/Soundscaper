/* SPDX-License-Identifier: AGPL-3.0-only */

import { TimelineRuler } from '@soundscaper/design-system/TimelineRuler';

import { framesToSeconds } from '../../design-system-adapters.js';
import { MusicalTimelineRuler } from './MusicalTimelineRuler.jsx';
import { SequenceTimecodeRuler } from './SequenceTimecodeRuler.jsx';

const TIMELINE_RULER_HEIGHT_WITH_ANNOTATIONS = 33;

/**
 * The ruler canvas for the resolved timeline scale: a sequence timecode
 * ruler, a tempo-map ruler, or the plain time or beats ruler.
 */
export function TimelineRulerCanvas({
	contentScrollX,
	controller,
	displayedLoop,
	durationSeconds,
	loopPreview,
	markerLaneVisible,
	pixelsPerSecond,
	project,
	rulerScale,
	run,
	sampleRate,
	timeSelection,
	timelineWidth,
	viewportWidth,
}) {
	const shared = {
		height: markerLaneVisible ? TIMELINE_RULER_HEIGHT_WITH_ANNOTATIONS : undefined,
		pixelsPerSecond,
		scrollX: contentScrollX,
		width: timelineWidth,
		viewportWidth,
		timeSelection,
		sampleRate,
		loopRegionEnabled: loopPreview ? true : Boolean(project.loop?.enabled),
		loopRegionStart: framesToSeconds(displayedLoop.startFrame || 0, { sampleRate }),
		loopRegionEnd: framesToSeconds(displayedLoop.endFrame || 0, { sampleRate }),
		onLoopRegionEnabledToggle: () => run(() => controller.actions.transport.toggleLoop()),
	};
	if (rulerScale.kind === 'timecode') {
		return <SequenceTimecodeRuler {...shared} view={rulerScale.view} />;
	}
	if (rulerScale.kind === 'musical-map') {
		return <MusicalTimelineRuler {...shared} tempoMap={rulerScale.tempoMap} signatureMap={rulerScale.signatureMap} />;
	}
	return <TimelineRuler
		{...shared}
		totalDuration={durationSeconds}
		timeFormat={rulerScale.kind === 'beats-measures' ? 'beats-measures' : 'minutes-seconds'}
		bpm={rulerScale.kind === 'beats-measures' ? rulerScale.bpm : 120}
		beatsPerMeasure={rulerScale.kind === 'beats-measures' ? rulerScale.beatsPerMeasure : 4}
	/>;
}
