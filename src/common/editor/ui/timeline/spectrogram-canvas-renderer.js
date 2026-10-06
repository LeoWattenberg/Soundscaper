/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	DEFAULT_SPECTROGRAM_FREQUENCY_BANDS,
	paintSpectrogram,
	pffftSpectrogramBandEnergies,
	pffftSpectrogramRevision,
} from '../../pffft-spectrogram.js';
import { createTimelineSpectrogramCache } from '../../controller/source/timeline-spectrogram-cache.ts';
import { audioEditorStereoChannelGeometry } from './stereo-channel-height-runtime.ts';
import { paintSpectrogramImageData } from './spectrogram-image-data.ts';

const cache = createTimelineSpectrogramCache({
	releaseImage(image) { image.width = 0; image.height = 0; },
});

export function releaseSpectrogramCanvas(canvas) {
	cache.release(canvas);
}

export function drawAudacityClipSpectrogram(context, channels, options) {
	const owner = context.canvas;
	const channelCount = Math.min(2, options.columns?.channels?.length || channels?.length || 0);
	if (!channelCount || (!options.columns?.channels?.length && !channels[0]?.length)) {
		cache.release(owner);
		context.fillStyle = options.backgroundColor;
		context.fillRect(0, 0, options.width, options.height);
		delete owner.dataset.spectrogramRenderer;
		return;
	}
	const spectrogramOptions = {
		frequencyBands: DEFAULT_SPECTROGRAM_FREQUENCY_BANDS,
		fftWindowSize: options.fftWindowSize,
		pixelSkip: options.columns?.pixelSkip ?? 1,
		scale: options.scale,
		minFreq: options.minFreq,
		maxFreq: options.maxFreq,
		windowType: options.windowType,
		gainDb: options.gainDb,
		rangeDb: options.rangeDb,
		sampleRate: options.sampleRate,
	};
	const columns = options.columns?.channels ?? (options.deferAnalysis ? null : cache.analysis(owner, [
		...channels.slice(0, channelCount), options.width,
		options.fftWindowSize, options.windowType, pffftSpectrogramRevision(),
	], () => {
		const analyzed = channels.slice(0, channelCount).map((channel) => (
			pffftSpectrogramBandEnergies(channel, options.width, spectrogramOptions)
		));
		return analyzed.every(Boolean) ? analyzed : null;
	}));
	const geometry = channelCount > 1
		? audioEditorStereoChannelGeometry(options.height, options.channelHeightRatio)
		: [{ top: 0, height: options.height }];
	const paint = (target, bulk = false) => {
		target.fillStyle = options.backgroundColor;
		target.fillRect(0, 0, options.width, options.height);
		if (columns) {
			for (let channel = 0; channel < channelCount; channel += 1) {
				const { top, height } = geometry[channel];
				if (!bulk || !paintSpectrogramImageData(target, columns[channel], 0, top,
					options.width, height, spectrogramOptions)) {
					paintSpectrogram(target, columns[channel], 0, top, options.width, height, spectrogramOptions);
				}
			}
		}
		if (channelCount > 1) {
			target.strokeStyle = options.dividerColor;
			target.lineWidth = 1;
			target.beginPath();
			target.moveTo(0, geometry[1].top);
			target.lineTo(options.width, geometry[1].top);
			target.stroke();
		}
	};
	const transform = context.getTransform?.();
	const backingWidth = Math.ceil(options.width * (transform?.a || 1));
	const backingHeight = Math.ceil(options.height * (transform?.d || 1));
	const image = columns && typeof context.drawImage === 'function' ? cache.image(owner, [
		...columns.slice(0, channelCount),
		options.width, options.height, options.channelHeightRatio,
		options.backgroundColor, options.dividerColor,
		...Object.values(spectrogramOptions),
	], backingWidth, backingHeight, () => {
		const surface = owner.ownerDocument?.createElement('canvas');
		const target = surface?.getContext?.('2d', { alpha: false });
		if (!target) return null;
		surface.width = backingWidth;
		surface.height = backingHeight;
		target.setTransform(backingWidth / options.width, 0, 0, backingHeight / options.height, 0, 0);
		try { paint(target, true); }
		catch (error) { surface.width = 0; surface.height = 0; throw error; }
		return surface;
	}) : null;
	if (image) context.drawImage(image, 0, 0, options.width, options.height);
	else paint(context);
	owner.dataset.spectrogramRenderer = columns ? 'pffft-wasm' : options.deferAnalysis ? 'loading-worker' : 'loading-pffft';
}
