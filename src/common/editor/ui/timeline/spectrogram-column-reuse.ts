/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioWarpRuntimeProject } from '../../audio-warp-runtime.ts';
import { immutableWaveformKeyJson } from '../immutable-waveform-key-json.ts';
import { createWaveformContentKey } from '../waveform-preview-cache.ts';
import type { TimelineWaveformClip, TimelineWaveformSource } from './waveform-view-model.ts';

/** The existing FFT centers can move to fixed clip-local columns only at this phase. */
export function alignedSpectrogramFramesPerPixel(clip: TimelineWaveformClip, width: number, pixelSkip = 1): number | null {
	const frameCount = clip.waveformEndFrame - clip.waveformStartFrame;
	const framesPerPixel = frameCount / width;
	if (pixelSkip !== 1 || !Number.isSafeInteger(width) || width < 1
		|| !Number.isSafeInteger(frameCount * width)
		|| !Number.isSafeInteger(framesPerPixel) || framesPerPixel < 1
		|| !Number.isSafeInteger(clip.waveformStartFrame) || clip.waveformStartFrame < 0
		|| !Number.isSafeInteger(clip.waveformEndFrame)
		|| clip.waveformStartFrame % framesPerPixel !== 0) return null;
	return framesPerPixel;
}

export function spectrogramColumnReuseKey({ clip, source, width, sampleRate, fftWindowSize, windowType, project }: Readonly<{
	clip: TimelineWaveformClip;
	source: TimelineWaveformSource | null | undefined;
	width: number;
	sampleRate: number;
	fftWindowSize: number;
	windowType: string;
	project?: (AudioWarpRuntimeProject & Readonly<{ id?: string }>) | null;
}>): string | null {
	const framesPerPixel = alignedSpectrogramFramesPerPixel(clip, width);
	if (framesPerPixel === null) return null;
	return `[${createWaveformContentKey(source, clip)},${JSON.stringify([
		'spectral-columns-v1', framesPerPixel, source?.sampleRate ?? null,
		source?.frameCount ?? null, source?.channelCount ?? null,
		fftWindowSize, windowType, sampleRate, project?.id ?? null, project?.sampleRate ?? null,
	]).slice(1, -1)},${immutableWaveformKeyJson(project?.tempoMap)}]`;
}
