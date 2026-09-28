/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	audioWarpSourceRange,
	type AudioWarpRuntimeClip,
	type AudioWarpRuntimeProject,
} from '../../audio-warp-runtime.ts';
import { projectUnwarpedClipSourceRange } from '../../audio-clip-source-projection.ts';
import {
	pffftSpectrogramBandEnergies,
	preparePffftSpectrogram,
} from '../../pffft-spectrogram.js';
import { pcmWindowCoversProjectedClip } from './preview.ts';
import {
	createSpectrogramSampleViews,
	type SpectrogramSampleView,
} from './spectrogram-sample-view.ts';
import type { TimelinePcmWindow, TimelineWaveformClip } from './waveform-view-model.ts';

const DEFAULT_MAXIMUM_SOURCE_FRAMES = 262_144;
// The waveform PCM requester adds two source frames at either end of a range.
const SOURCE_REQUEST_PADDING_FRAMES = 4;

export interface SpectrogramPcmTileAnalysisOptions {
	readonly fftWindowSize: number;
	readonly frequencyBands?: number;
	readonly windowType?: string;
	readonly pixelSkip: number;
	/** Start and end in the full canvas's pixel coordinate system. */
	readonly pixelStart: number;
	readonly pixelEnd: number;
}

export type SpectrogramPcmTileAnalyzer = (
	view: SpectrogramSampleView,
	width: number,
	options: SpectrogramPcmTileAnalysisOptions,
) => readonly (readonly number[])[] | null;

export interface SpectrogramPcmTileOptions {
	readonly clip: TimelineWaveformClip;
	readonly project?: AudioWarpRuntimeProject | null;
	readonly width: number;
	readonly fftWindowSize: number;
	readonly frequencyBands?: number;
	readonly windowType?: string;
	readonly pixelSkip?: number;
	readonly maximumSourceFrames?: number;
	readonly requestPcmWindow: (
		startFrame: number,
		endFrame: number,
	) => Promise<TimelinePcmWindow | null>;
	readonly analyze?: SpectrogramPcmTileAnalyzer;
	readonly signal?: AbortSignal;
}

export interface SpectrogramPcmColumns {
	readonly width: number;
	readonly pixelSkip: number;
	/** Full-width frequency columns for each channel, ready for paintSpectrogram. */
	readonly channels: readonly (readonly (readonly number[])[])[];
}

/** Analyze streamed PCM a bounded tile at a time, retaining only spectral columns. */
export async function generateSpectrogramPcmTiles(
	options: SpectrogramPcmTileOptions,
): Promise<SpectrogramPcmColumns | null> {
	const { clip, project = null, signal } = options;
	const { width } = options;
	// PFFFT clamps its FFT input at 8,192 samples; tile reads need the same span.
	const fftWindowSize = Math.min(8_192, options.fftWindowSize);
	const pixelSkip = options.pixelSkip ?? 4;
	const maximumSourceFrames = options.maximumSourceFrames ?? DEFAULT_MAXIMUM_SOURCE_FRAMES;
	if (!Number.isFinite(width) || width <= 0 || !Number.isSafeInteger(fftWindowSize)
		|| fftWindowSize < 32 || fftWindowSize > 8_192
		|| (fftWindowSize & (fftWindowSize - 1)) !== 0
		|| !Number.isSafeInteger(pixelSkip) || pixelSkip < 1
		|| !Number.isSafeInteger(maximumSourceFrames)
		|| maximumSourceFrames <= SOURCE_REQUEST_PADDING_FRAMES) {
		throw new RangeError('Invalid spectrogram PCM tile geometry.');
	}
	const frameCount = clip.waveformEndFrame - clip.waveformStartFrame;
	if (!Number.isSafeInteger(frameCount) || frameCount < 0) {
		throw new RangeError('Invalid projected spectrogram clip range.');
	}
	if (frameCount === 0) return { width, pixelSkip, channels: [] };
	const analyze = options.analyze ?? analyzePffft;
	if (!options.analyze) await preparePffftSpectrogram(fftWindowSize);
	const pixelPositions: number[] = [];
	for (let pixel = 0; pixel < width; pixel += pixelSkip) pixelPositions.push(pixel);
	const localStartAt = (pixel: number): number => clip.waveformStartFrame
		+ Math.floor(pixel * frameCount / width);
	const sourceSpan = (startFrame: number, endFrame: number): number => {
		const range = clip.warpMap == null
			? projectUnwarpedClipSourceRange({
				durationFrames: clip.durationFrames,
				sourceStartFrame: clip.sourceStartFrame,
				sourceDurationFrames: clip.sourceDurationFrames ?? clip.durationFrames,
				reversed: Boolean(clip.reversed),
			}, startFrame, endFrame)
			: project
				? audioWarpSourceRange(project, {
					...clip,
					sourceDurationFrames: clip.sourceDurationFrames ?? clip.durationFrames,
				} as AudioWarpRuntimeClip, { startFrame, endFrame })
				: null;
		if (!range) throw new TypeError('A warped spectrogram tile requires a project.');
		return Math.ceil(range.endFrame) - Math.floor(range.startFrame);
	};
	const sourceLimit = maximumSourceFrames - SOURCE_REQUEST_PADDING_FRAMES;
	let columnsByChannel: Array<Array<readonly number[]>> | null = null;
	for (let first = 0; first < pixelPositions.length;) {
		signal?.throwIfAborted();
		const startFrame = localStartAt(pixelPositions[first]!);
		let last = first;
		let endFrame = Math.min(clip.waveformEndFrame, startFrame + fftWindowSize);
		if (sourceSpan(startFrame, endFrame) > sourceLimit) {
			throw new RangeError('One spectrogram FFT window exceeds the bounded PCM request limit.');
		}
		while (last + 1 < pixelPositions.length) {
			const candidateEnd = Math.min(
				clip.waveformEndFrame,
				localStartAt(pixelPositions[last + 1]!) + fftWindowSize,
			);
			if (sourceSpan(startFrame, candidateEnd) > sourceLimit) break;
			last += 1;
			endFrame = candidateEnd;
		}
		const pcm = await options.requestPcmWindow(startFrame, endFrame);
		signal?.throwIfAborted();
		const tileClip = { ...clip, waveformStartFrame: startFrame, waveformEndFrame: endFrame };
		if (!pcm || !pcmWindowCoversProjectedClip(pcm, tileClip, project)) return null;
		const views = createSpectrogramSampleViews(pcm.channels, tileClip, {
			project,
			sourceFrameOffset: pcm.startFrame,
		});
		const pixelStart = pixelPositions[first]!;
		const pixelEnd = Math.min(width, pixelPositions[last]! + pixelSkip);
		const tileChannels: Array<readonly (readonly number[])[]> = [];
		for (const view of views) {
			const offset = startFrame - clip.waveformStartFrame;
			const globalView: SpectrogramSampleView = {
				length: frameCount,
				sampleAt: (index) => view.sampleAt(index - offset),
			};
			const columns = analyze(globalView, width, {
				fftWindowSize,
				frequencyBands: options.frequencyBands,
				windowType: options.windowType,
				pixelSkip,
				pixelStart,
				pixelEnd,
			});
			if (columns === null) return null;
			tileChannels.push(columns);
		}
		const expectedColumns = last - first + 1;
		if (tileChannels.some((columns) => columns.length !== expectedColumns)) {
			throw new Error('Spectrogram PCM tile analysis returned incomplete columns.');
		}
		if (columnsByChannel === null) {
			columnsByChannel = tileChannels.map(() => []);
		} else if (columnsByChannel.length !== tileChannels.length) {
			throw new Error('Spectrogram PCM channel count changed between tiles.');
		}
		for (let channel = 0; channel < tileChannels.length; channel += 1) {
			columnsByChannel[channel]!.push(...tileChannels[channel]!);
		}
		first = last + 1;
	}
	return { width, pixelSkip, channels: columnsByChannel ?? [] };
}

function analyzePffft(
	view: SpectrogramSampleView,
	width: number,
	options: SpectrogramPcmTileAnalysisOptions,
): readonly (readonly number[])[] | null {
	const result: unknown = pffftSpectrogramBandEnergies(view, width, options);
	return result === null ? null : result as readonly (readonly number[])[];
}
