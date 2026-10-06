/* SPDX-License-Identifier: AGPL-3.0-only */

import { preparePffftSpectrogram, pffftSpectrogramBandEnergies } from './pffft-spectrogram.js';
import { createSpectrogramSampleViews, type SpectrogramSampleClip } from './spectrogram-sample-view.ts';
import type { AudioWarpRuntimeProject } from './audio-warp-runtime.ts';

export interface TimelineSpectrogramWorkerTile {
	readonly channels: readonly Float32Array[];
	readonly clip: SpectrogramSampleClip;
	readonly project: AudioWarpRuntimeProject | null;
	readonly sourceFrameOffset: number;
	readonly frameCount: number;
	readonly offset: number;
	readonly width: number;
	readonly options: Readonly<{ fftWindowSize: number; frequencyBands?: number; windowType?: string; pixelSkip: number; pixelStart: number; pixelEnd: number }>;
}
export type TimelineSpectrogramTileColumns = readonly (readonly (readonly number[])[])[];

/** Run the unchanged PFFFT kernel and projected sample accessor in the worker. */
export async function executeTimelineSpectrogramWorkerRequest(value: unknown) {
	let requestId: string | null = null;
	try {
		if (!value || typeof value !== 'object' || !('requestId' in value) || typeof value.requestId !== 'string'
			|| value.requestId.length > 160 || !('type' in value) || value.type !== 'timeline-spectrogram/v1') throw new TypeError('Invalid spectrogram worker request.');
		requestId = value.requestId;
		const request = value as unknown as TimelineSpectrogramWorkerTile & { requestId: string };
		if (!Array.isArray(request.channels) || request.channels.length < 1 || request.channels.length > 8
			|| request.channels.some(channel => !(channel instanceof Float32Array) || channel.length > 262_144)
			|| !Number.isSafeInteger(request.frameCount) || request.frameCount < 1
			|| !Number.isSafeInteger(request.offset) || !Number.isFinite(request.width) || request.width <= 0 || request.width > 32_768) {
			throw new RangeError('Spectrogram worker tile exceeds its bounded geometry.');
		}
		await preparePffftSpectrogram(request.options.fftWindowSize);
		const views = createSpectrogramSampleViews(request.channels, request.clip, {
			project: request.project, sourceFrameOffset: request.sourceFrameOffset,
		});
		const result = views.map(view => pffftSpectrogramBandEnergies({
			length: request.frameCount, sampleAt: (index: number) => view.sampleAt(index - request.offset),
		}, request.width, request.options)) as TimelineSpectrogramTileColumns;
		return { type: 'result' as const, requestId, result };
	} catch (error) {
		return { type: 'error' as const, requestId, error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) } };
	}
}
