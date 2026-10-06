/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectUnwarpedClipSourceRange } from './audio-clip-source-projection.ts';
import { readClipLoop } from './audio-clip-loop.ts';
import {
	createAudioWarpRuntimeEvaluator,
	type AudioWarpRuntimeClip,
	type AudioWarpRuntimeProject,
} from './audio-warp-runtime.ts';
import {
	clampedLocalFrame,
	fadeEnvelope,
	finiteNumber,
	nonNegativeSafeInteger,
	positiveSafeInteger,
	validateSourceChannels,
} from './design-system-adapters/validation.ts';
import type { NumericChannel } from './design-system-adapters/types.ts';
import type { WaveformClipLike } from './design-system-adapters/types.ts';

export interface SpectrogramSampleClip extends WaveformClipLike {
	readonly timelineStartFrame: number;
	readonly waveformStartFrame: number;
	readonly waveformEndFrame: number;
	readonly kind?: unknown;
	readonly anchor?: unknown;
	readonly musicalStartBeat?: unknown;
	readonly musicalExtent?: unknown;
	readonly musicalDurationBeats?: unknown;
	readonly warpMap?: unknown;
}

export interface SpectrogramSampleView {
	/** Number of clip-local frames in the projected painted span. */
	readonly length: number;
	/** Read a frame relative to the painted span, including available FFT context. */
	sampleAt(index: number): number;
}

export interface SpectrogramSampleViewOptions {
	readonly sourceFrameOffset?: number;
	readonly project?: AudioWarpRuntimeProject | null;
}

/** Expose projected clip PCM and any supplied context without building a bounded waveform preview. */
export function createSpectrogramSampleViews(
	sourceChannels: readonly NumericChannel[],
	clip: SpectrogramSampleClip,
	options: Readonly<SpectrogramSampleViewOptions>,
): readonly SpectrogramSampleView[] {
	const sourceLength = validateSourceChannels(sourceChannels);
	const durationFrames = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
	const sourceStartFrame = nonNegativeSafeInteger(clip.sourceStartFrame, 'clip.sourceStartFrame');
	const sourceDurationFrames = positiveSafeInteger(
		clip.sourceDurationFrames ?? durationFrames,
		'clip.sourceDurationFrames',
	);
	const startFrame = nonNegativeSafeInteger(clip.waveformStartFrame, 'clip.waveformStartFrame');
	const endFrame = nonNegativeSafeInteger(clip.waveformEndFrame, 'clip.waveformEndFrame');
	if (endFrame < startFrame || endFrame > durationFrames) {
		throw new RangeError('The projected spectrogram range must remain within the clip.');
	}
	const sourceFrameOffset = nonNegativeSafeInteger(options.sourceFrameOffset ?? 0, 'sourceFrameOffset');
	const frameCount = endFrame - startFrame;
	const signedGain = finiteNumber(clip.gain ?? 1, 'clip.gain') * (clip.inverted ? -1 : 1);
	const fadeInFrames = clampedLocalFrame(clip.fadeInFrames ?? 0, durationFrames, 'clip.fadeInFrames');
	const fadeOutFrames = clampedLocalFrame(clip.fadeOutFrames ?? 0, durationFrames, 'clip.fadeOutFrames');
	let sourceFrameAt: (localFrame: number) => number;
	let sourceStart: number;
	let sourceEnd: number;
	if (clip.warpMap != null) {
		if (!options.project) throw new TypeError('A warped spectrogram requires a project.');
		const evaluator = createAudioWarpRuntimeEvaluator(options.project, {
			...clip,
			sourceStartFrame,
			sourceDurationFrames,
		} as AudioWarpRuntimeClip);
		const sourceAt = (localFrame: number): number => {
			const source = evaluator.sourceAtTimelineFrame(clip.timelineStartFrame + localFrame);
			return source.num / source.den;
		};
		sourceFrameAt = (localFrame) => Math.floor(sourceAt(localFrame));
		sourceStart = sourceAt(startFrame);
		sourceEnd = sourceAt(endFrame);
	} else {
		const loop = readClipLoop(clip);
		sourceFrameAt = (localFrame) => {
			const mappedFrame = Math.min(sourceDurationFrames - 1,
				Math.floor((loop ? (localFrame + loop.offsetFrames) % loop.periodFrames : localFrame) * sourceDurationFrames / (loop?.periodFrames ?? durationFrames)));
			return sourceStartFrame + (clip.reversed
				? sourceDurationFrames - mappedFrame - 1
				: mappedFrame);
		};
		const range = projectUnwarpedClipSourceRange({
			opaqueExtensions: clip.opaqueExtensions,
			durationFrames,
			sourceStartFrame,
			sourceDurationFrames,
			reversed: Boolean(clip.reversed),
		}, startFrame, endFrame);
		sourceStart = range.startFrame;
		sourceEnd = range.endFrame;
	}
	if (frameCount && (Math.floor(sourceStart) < sourceFrameOffset
		|| Math.ceil(sourceEnd) > sourceFrameOffset + sourceLength)) {
		throw new RangeError('The projected spectrogram range exceeds the supplied PCM channels.');
	}
	return sourceChannels.map((channel): SpectrogramSampleView => ({
		length: frameCount,
		sampleAt(index: number): number {
			if (!Number.isSafeInteger(index)) return 0;
			const localFrame = startFrame + index;
			if (!Number.isSafeInteger(localFrame) || localFrame < 0 || localFrame >= durationFrames) return 0;
			const sourceFrame = sourceFrameAt(localFrame) - sourceFrameOffset;
			if (!Number.isSafeInteger(sourceFrame) || sourceFrame < 0 || sourceFrame >= sourceLength) return 0;
			const sample = Number(channel[sourceFrame]);
			const value = (Number.isFinite(sample) ? sample : 0) * signedGain * fadeEnvelope(
				localFrame,
				durationFrames,
				fadeInFrames,
				fadeOutFrames,
				clip.fadeInShape,
				clip.fadeOutShape,
			);
			return value === 0 ? 0 : value;
		},
	}));
}
