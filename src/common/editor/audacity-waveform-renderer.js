/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Browser adaptation of Audacity's waveform display pipeline at commit
 * 4c177d436e48c1d20f231eada44035593cb26292. Audacity keeps explicit
 * min/max/RMS values for every screen column and switches to joined sample
 * lines once there is at least half a pixel per sample. Original code is by
 * the Audacity Team and named upstream authors; the cache sources credit
 * Dmitry Vedenko. Adapted for Soundscaper on 2026-07-16. Exact source paths
 * are documented in THIRD_PARTY_LICENSES.md.
 */

import { scaleWaveformAmplitude } from './waveform-amplitude-scale.ts';
import { canBatchRoundCapStems } from './waveform-stem-batch-capability.ts';

const CONNECTING_DOTS_THRESHOLD = 0.5;

/** Audacity draws sample heads and zero-line stems from this scale upwards. */
export const AUDACITY_WAVEFORM_STEM_PIXELS_PER_SAMPLE = 4;
const STEM_THRESHOLD = AUDACITY_WAVEFORM_STEM_PIXELS_PER_SAMPLE;
const sampleHeightScratch = new WeakMap();

/** Return the Audacity display mode for a horizontal sample scale. */
export function audacityWaveformMode(pixelsPerSample) {
	const scale = Number(pixelsPerSample);
	if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('pixelsPerSample must be positive.');
	if (scale < CONNECTING_DOTS_THRESHOLD) return 'summary';
	if (scale < STEM_THRESHOLD) return 'connecting-dots';
	return 'stem';
}

/** Audacity switches to four-pixel sample heads and zero-line stems at this zoom. */
export function audacityWaveformShowsPoints(pixelsPerSample) {
	const scale = Number(pixelsPerSample);
	if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('pixelsPerSample must be positive.');
	return scale >= STEM_THRESHOLD;
}

/** Return the vertical drawing geometry for a full or positive-only waveform channel. */
export function audacityWaveformChannelGeometry(top, height, halfWave = false) {
	const channelTop = finite(top, 'top');
	const channelHeight = positiveFinite(height, 'height');
	const padding = Math.min(2, channelHeight / 2);
	if (halfWave) {
		return {
			centerY: channelTop + channelHeight - padding,
			maxAmplitude: Math.max(0, channelHeight - padding * 2),
		};
	}
	return {
		centerY: channelTop + channelHeight / 2,
		maxAmplitude: Math.max(0, channelHeight / 2 - padding),
	};
}

/**
 * Draw one channel from a waveform plan produced by
 * `prepareBoundedWaveformWindow`. Summary mode paints one complete min/max
 * span per CSS pixel. Connecting-dot mode joins adjacent samples; stem mode
 * draws each sample to the zero line and adds an Audacity-style sample head.
 */
export function drawAudacityWaveformChannel(context, rendering, options = {}) {
	if (!context || typeof context.fillRect !== 'function') throw new TypeError('A 2D canvas context is required.');
	if (!rendering || !Array.isArray(rendering.channels)) throw new TypeError('A waveform rendering plan is required.');
	const channelIndex = nonNegativeInteger(options.channel ?? 0, 'channel');
	const channel = rendering.channels[channelIndex];
	if (!channel) throw new RangeError('The waveform rendering channel does not exist.');
	const width = positiveFinite(options.width, 'width');
	const centerY = finite(options.centerY, 'centerY');
	const maxAmplitude = Math.max(0, finite(options.maxAmplitude, 'maxAmplitude'));
	const halfWave = Boolean(options.halfWave);
	const amplitudeScale = options.amplitudeScale === 'db' ? 'db' : 'linear';
	const envelopeGain = typeof options.envelopeGain === 'function' ? options.envelopeGain : () => 1;
	const sampleColor = typeof options.sampleColor === 'function' ? options.sampleColor : () => options.sampleColor || '#000';
	const rmsColor = typeof options.rmsColor === 'function' ? options.rmsColor : () => options.rmsColor || '#000';
	const centerLineColor = options.centerLineColor || null;
	const horizontalScale = width / positiveFinite(rendering.pixelWidth, 'rendering.pixelWidth');

	if (rendering.mode === 'connecting-dots' || rendering.mode === 'stem') {
		drawIndividualSamples(context, channel, {
			width,
			pixelsPerSample: rendering.pixelsPerSample * horizontalScale,
			firstSampleX: channel.firstSampleX * horizontalScale,
			centerY,
			maxAmplitude,
			halfWave,
			amplitudeScale,
			envelopeGain,
			sampleColor,
			centerLineColor,
			mode: rendering.mode,
			pixelRatioX: positiveFinite(options.pixelRatioX ?? 1, 'pixelRatioX'),
			batchSampleStems: options.batchSampleStems !== false,
		});
		return;
	}

	drawSummaryColumns(context, channel, {
		width,
		centerY,
		maxAmplitude,
		halfWave,
		amplitudeScale,
		envelopeGain,
		sampleColor,
		rmsColor,
		showRms: Boolean(options.showRms),
		drawPeaks: options.drawPeaks !== false,
		pixelRatioX: positiveFinite(options.pixelRatioX ?? 1, 'pixelRatioX'),
		columnRanges: options.columnRanges,
	});
}

function drawSummaryColumns(context, channel, options) {
	const sourceColumnCount = Math.min(
		channel.minimum.length,
		channel.maximum.length,
	);
	const columnCount = Math.ceil(options.width);
	if (!sourceColumnCount) return;
	const rmsValues = options.showRms ? channel.rms : null;
	let fillColor;
	for (const range of options.columnRanges || [{ start: 0, end: columnCount }]) {
		for (let x = Math.max(0, range.start); x < Math.min(columnCount, range.end); x += 1) {
			const sourceStart = Math.min(
				sourceColumnCount - 1,
				Math.floor(x * sourceColumnCount / columnCount),
			);
			const sourceEnd = Math.min(
				sourceColumnCount,
				Math.max(sourceStart + 1, Math.ceil((x + 1) * sourceColumnCount / columnCount)),
			);
			let minimum = Number.POSITIVE_INFINITY;
			let maximum = Number.NEGATIVE_INFINITY;
			let rmsSquareSum = 0;
			for (let sourceColumn = sourceStart; sourceColumn < sourceEnd; sourceColumn += 1) {
				minimum = Math.min(minimum, finiteSample(channel.minimum[sourceColumn]));
				maximum = Math.max(maximum, finiteSample(channel.maximum[sourceColumn]));
				if (rmsValues) {
					const sourceRms = finiteSample(rmsValues[sourceColumn]);
					rmsSquareSum += sourceRms * sourceRms;
				}
			}
			const gain = finiteGain(options.envelopeGain(x, columnCount));
			minimum = scaleWaveformAmplitude(minimum * gain, options.amplitudeScale);
			maximum = scaleWaveformAmplitude(maximum * gain, options.amplitudeScale);
			if (minimum > maximum) [minimum, maximum] = [maximum, minimum];
			if (options.halfWave) {
				minimum = Math.max(0, minimum);
				maximum = Math.max(0, maximum);
			}
			if (options.drawPeaks) fillColor = fillAmplitudeSpan(context, x, minimum, maximum,
				options.centerY, options.maxAmplitude, options.sampleColor(x), options.pixelRatioX, fillColor);

			if (!rmsValues) continue;
			const rms = scaleWaveformAmplitude(Math.sqrt(rmsSquareSum / (sourceEnd - sourceStart)) * gain, options.amplitudeScale);
			const rmsMinimum = options.halfWave ? minimum : Math.max(minimum, -rms);
			const rmsMaximum = Math.min(maximum, rms);
			if (rmsMinimum <= rmsMaximum) {
				fillColor = fillAmplitudeSpan(context, x, rmsMinimum, rmsMaximum,
					options.centerY, options.maxAmplitude, options.rmsColor(x), options.pixelRatioX, fillColor);
			}
		}
		}
}

function drawIndividualSamples(context, channel, options) {
	const samples = channel.samples;
	if (!samples?.length) return;
	const pixelsPerSample = positiveFinite(options.pixelsPerSample, 'pixelsPerSample');
	const firstSampleX = finite(options.firstSampleX, 'firstSampleX');
	const heightAt = (index) => {
		const x = firstSampleX + index * pixelsPerSample;
		const gain = finiteGain(options.envelopeGain(x, options.width));
		let value = scaleWaveformAmplitude(finiteSample(samples[index]) * gain, options.amplitudeScale);
		if (options.halfWave) value = Math.max(0, value);
		return options.centerY - value * options.maxAmplitude;
	};

	context.lineWidth = 1;
	context.lineJoin = 'round';
	context.lineCap = 'round';
	if (options.mode === 'connecting-dots') {
		drawCenterLine(context, options);
		let previousX = firstSampleX;
		let previousY = heightAt(0);
		for (let index = 1; index < samples.length; index += 1) {
			const x = firstSampleX + index * pixelsPerSample;
			const y = heightAt(index);
			context.strokeStyle = options.sampleColor((previousX + x) / 2);
			context.beginPath();
			context.moveTo(previousX, previousY);
			context.lineTo(x, y);
			context.stroke();
			previousX = x;
			previousY = y;
		}
		return;
	}

	let heights = sampleHeightScratch.get(channel);
	if (!heights || heights.length !== samples.length) {
		heights = new Float64Array(samples.length);
		sampleHeightScratch.set(channel, heights);
	}
	// Native compound paths vary by raster backend, even at unit scale.
	// Batch only after an exact private-surface capability proof.
	const transform = typeof context.getTransform === 'function' ? context.getTransform() : null;
	const batchStems = options.batchSampleStems && options.pixelRatioX === 1
		&& (!transform || (transform.a === 1 && transform.b === 0 && transform.c === 0 && transform.d === 1))
		&& pixelsPerSample > 3 && canBatchRoundCapStems(context);
	let strokeColor;
	for (let index = 0; index < samples.length; index += 1) {
		const x = firstSampleX + index * pixelsPerSample;
		const y = heights[index] = heightAt(index);
		const color = options.sampleColor(x);
		if (!batchStems || color !== strokeColor) {
			if (batchStems && index > 0) context.stroke();
			context.strokeStyle = color;
			strokeColor = color;
			context.beginPath();
		}
		context.moveTo(x, options.centerY);
		context.lineTo(x, y);
		if (!batchStems) context.stroke();
	}
	if (batchStems) context.stroke();
	drawCenterLine(context, options);
	let fillColor;
	for (let index = 0; index < samples.length; index += 1) {
		const x = firstSampleX + index * pixelsPerSample;
		const color = options.sampleColor(x);
		if (color !== fillColor) { context.fillStyle = color; fillColor = color; }
		context.beginPath();
		context.arc(x, heights[index], 2, 0, Math.PI * 2);
		context.fill();
	}
}

function drawCenterLine(context, options) {
	if (!options.centerLineColor) return;
	context.strokeStyle = options.centerLineColor;
	context.beginPath();
	context.moveTo(0, options.centerY);
	context.lineTo(options.width, options.centerY);
	context.stroke();
}

function fillAmplitudeSpan(context, x, minimum, maximum, centerY, maxAmplitude, color, pixelRatioX, previousColor) {
	const top = Math.round(centerY - maximum * maxAmplitude);
	const bottom = Math.round(centerY - minimum * maxAmplitude);
	if (color !== previousColor) context.fillStyle = color;
	// Adjacent subpixel rectangles are anti-aliased separately, leaving partly
	// transparent joins that look like a gradient as fractional clip widths vary.
	// Share physical-pixel boundaries for both the peak and RMS passes.
	const left = Math.round(x * pixelRatioX) / pixelRatioX;
	const right = Math.round((x + 1) * pixelRatioX) / pixelRatioX;
	context.fillRect(left, Math.min(top, bottom), right - left, Math.max(1, Math.abs(bottom - top)));
	return color;
}

function finiteSample(value) {
	const sample = Number(value);
	return Number.isFinite(sample) ? sample : 0;
}

function finiteGain(value) {
	const gain = Number(value);
	return Number.isFinite(gain) ? Math.max(0, gain) : 1;
}

function positiveFinite(value, name) {
	const number = finite(value, name);
	if (number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

function finite(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite.`);
	return number;
}

function nonNegativeInteger(value, name) {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer.`);
	return value;
}
