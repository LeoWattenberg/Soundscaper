/* SPDX-License-Identifier: AGPL-3.0-only */

import { calculateAudioSpectrum, findAudioClippingRegions } from './analysis.js';
interface AnalysisRange { readonly startFrame: number; readonly endFrame: number }

export function spectrumReport(
	scope: string,
	range: AnalysisRange,
	channels: Float32Array[],
	sampleRate: number,
	options: Record<string, unknown>,
) {
	const size = normalizeSpectrumSize(options.size);
	const spectrum = calculateAudioSpectrum(channels, sampleRate, { size, average: true });
	type SpectrumBin = (typeof spectrum.bins)[number];
	const peak = spectrum.bins.reduce<SpectrumBin | null>(
		(best, bin) => !best || bin.amplitude > best.amplitude ? bin : best,
		null,
	);
	return Object.freeze({ type: 'spectrum', scope, ...range, sampleRate: spectrum.sampleRate, size: spectrum.size, bins: spectrum.bins, peak });
}

export function clippingReport(
	scope: string,
	range: AnalysisRange,
	channels: Float32Array[],
	options: Record<string, unknown>,
) {
	const threshold = Number(options.threshold ?? 1);
	const minimumConsecutiveSamples = Number(options.minimumConsecutiveSamples ?? 3);
	const regions = findAudioClippingRegions(channels, { threshold, minimumConsecutiveSamples })
		.map((region) => Object.freeze({
			...region,
			startFrame: region.startFrame + range.startFrame,
			endFrame: region.endFrame + range.startFrame,
		}));
	return Object.freeze({
		type: 'clipping',
		scope,
		...range,
		threshold,
		minimumConsecutiveSamples,
		regions: Object.freeze(regions),
		regionCount: regions.length,
		clippedSamples: regions.reduce((sum, region) => sum + region.clippedSamples, 0),
	});
}

export function normalizeSpectrumSize(value: unknown): number {
	const requested = Math.max(32, Math.min(65_536, Math.round(Number(value) || 2_048)));
	return 2 ** Math.round(Math.log2(requested));
}
