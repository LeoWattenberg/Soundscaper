/* SPDX-License-Identifier: AGPL-3.0-only */

import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import { normalizeSourceFrameRate } from '../../sequence-timecode.ts';
import { mediaSecondsToSourceFrame } from '../../source-monitor-model.ts';
import { videoBoundaryTime, videoSourceTimingView } from '../../video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../../video-source-timing-views.ts';

interface ClipSourceInTimeCodeFieldProps {
	readonly label: string;
	readonly value: number;
	readonly source: unknown;
	readonly sampleRate: number;
	readonly disabled: boolean;
	readonly onCommit: (value: number) => unknown;
}

/** Native video source positions are ordinals; audio positions are samples. */
export default function ClipSourceInTimeCodeField({
	label, value, source, sampleRate, disabled, onCommit,
}: ClipSourceInTimeCodeFieldProps) {
	const video = isNativeVideoSource(source) ? source : null;
	const rate = video ? normalizeSourceFrameRate(video.frameRate) : null;
	const seconds = video ? sourceBoundarySeconds(video, value) : value / sampleRate;
	return <label className="audio-editor-field" data-clip-field="sourceInFrame"><span>{label}</span>
		<AudioEditorTimeCodeInput label={label} value={video ? seconds : value}
			unit={video ? 'seconds' : 'samples'} rate={sampleRate} sampleRate={sampleRate}
			frameRate={rate ? rate.num / rate.den : undefined} format="hh:mm:ss+milliseconds"
			disabled={disabled} onCommit={(position) => onCommit(video && rate
				? mediaSecondsToSourceFrame(position, rate, Number(video.sourceFrameCount), video)
				: position)} />
	</label>;
}

function sourceBoundarySeconds(source: Readonly<Record<string, unknown>>, ordinal: number): number {
	const timing = videoSourceTimingView(resolveVideoSourceTimingViews({ sources: [source] }), source);
	const boundary = videoBoundaryTime(timing, ordinal);
	return Number(boundary.numerator) / Number(boundary.denominator);
}

function isNativeVideoSource(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& (value as Readonly<Record<string, unknown>>).kind === 'video'
		&& Number.isSafeInteger((value as Readonly<Record<string, unknown>>).sourceFrameCount)
		&& Number((value as Readonly<Record<string, unknown>>).sourceFrameCount) > 0;
}
