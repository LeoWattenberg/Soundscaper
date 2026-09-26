/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimeCodeFormat } from '@soundscaper/design-system/TimeCode';

import {
	sequenceFrameAtSample,
} from '../../sequence-frame-navigation.ts';
import {
	formatSequenceTimecode,
	sequenceTimecodeFromFrameCount,
} from '../../sequence-timecode.ts';
import type { SequenceTimingView } from '../../sequence-timing-model.ts';

/** Project an audio sample onto the sequence's labelled frame clock. */
export function sequenceDisplaySecondsAtSample(
	sample: number,
	view: SequenceTimingView,
	sampleRate: number,
): number {
	const frame = sequenceFrameAtSample(sample, view.rate, sampleRate);
	return (frame + view.startFrameCount) * view.rate.den / view.rate.num;
}

/** Turn a standard timecode edit into the sequence service's labelled seek. */
export function sequenceTimeCodeLabelAtDisplaySeconds(
	seconds: number,
	view: SequenceTimingView,
): string {
	const labelledFrame = Math.round(seconds * view.rate.num / view.rate.den);
	return formatSequenceTimecode(
		sequenceTimecodeFromFrameCount(labelledFrame, view.rate, view.dropFrame),
		view.rate,
		view.dropFrame,
	);
}

export function sequenceTimeCodeFormat(view: SequenceTimingView): TimeCodeFormat {
	return view.dropFrame ? 'hh:mm:ss+ntsc-drop-frames' : 'hh:mm:ss+frames';
}
