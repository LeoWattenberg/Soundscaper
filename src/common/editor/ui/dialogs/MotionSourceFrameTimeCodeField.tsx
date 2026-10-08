/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useState } from 'react';
import type { TimeCodeFormat } from '@soundscaper/design-system/TimeCode';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import { normalizeSourceFrameRate } from '../../sequence-timecode.ts';
import { videoBoundaryTime, videoSourceTimingView } from '../../video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../../video-source-timing-views.ts';

interface MotionSourceFrameTimeCodeFieldProps {
	readonly label: string;
	readonly source: unknown;
	readonly value: number;
	readonly minimum: number;
	readonly maximum: number;
	readonly disabled: boolean;
	readonly onChange: (value: number) => void;
}

/** Analysis ranges store source ordinals, independently of the sequence clock. */
export default function MotionSourceFrameTimeCodeField(props: MotionSourceFrameTimeCodeFieldProps) {
	const clock = useMemo(() => motionSourceFrameClock(props.source), [props.source]);
	const [format, setFormat] = useState<TimeCodeFormat>('hh:mm:ss+frames');
	const ordinalClock = format === 'film-frames' || format === 'hh:mm:ss+frames';
	return <AudioEditorTimeCodeInput label={props.label} format={format}
		unit={ordinalClock ? 'frames' : 'seconds'} rate={clock.rate} frameRate={clock.rate}
		value={ordinalClock ? props.value : clock.secondsAt(props.value)}
		minimum={ordinalClock ? props.minimum : clock.secondsAt(props.minimum)}
		maximum={ordinalClock ? props.maximum : clock.secondsAt(props.maximum)}
		disabled={props.disabled} onFormatChange={setFormat}
		onChange={(value) => props.onChange(ordinalClock ? value : clock.frameAt(value))} />;
}

export function motionSourceFrameClock(sourceValue: unknown) {
	if (!sourceValue || typeof sourceValue !== 'object' || Array.isArray(sourceValue)) {
		throw new TypeError('Motion-analysis fields require their native video source.');
	}
	const source = sourceValue as Readonly<Record<string, unknown>>;
	const rate = normalizeSourceFrameRate(source.frameRate);
	const frameCount = Number(source.sourceFrameCount);
	const timing = videoSourceTimingView(resolveVideoSourceTimingViews({ sources: [source] }), source);
	const secondsAt = (ordinal: number): number => {
		const boundary = videoBoundaryTime(timing, ordinal);
		return Number(boundary.numerator) / Number(boundary.denominator);
	};
	return Object.freeze({
		rate: rate.num / rate.den, secondsAt,
		frameAt(seconds: number): number {
			if (!Number.isFinite(seconds)) throw new RangeError('A source time must be finite.');
			if (seconds <= 0) return 0;
			if (seconds >= secondsAt(frameCount)) return frameCount;
			let lower = 0;
			let upper = frameCount;
			while (lower + 1 < upper) {
				const middle = lower + Math.floor((upper - lower) / 2);
				if (secondsAt(middle) <= seconds) lower = middle;
				else upper = middle;
			}
			return seconds - secondsAt(lower) < secondsAt(upper) - seconds ? lower : upper;
		},
	});
}
