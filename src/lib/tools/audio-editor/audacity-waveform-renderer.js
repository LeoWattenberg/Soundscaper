/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Browser adaptation of Audacity's waveform display pipeline at commit
 * 908ad0a526e5bfdab68de780e893cebe172d27eb. Audacity keeps explicit
 * min/max/RMS values for every screen column and switches to joined sample
 * lines once there is at least half a pixel per sample. Original code is by
 * the Audacity Team and named upstream authors; the cache sources credit
 * Dmitry Vedenko. Adapted for Soundscaper on 2026-07-16. Exact source paths
 * are documented in THIRD_PARTY_LICENSES.md.
 */

const CONNECTING_DOTS_THRESHOLD = 0.5;
const STEM_THRESHOLD = 4;

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
	const envelopeGain = typeof options.envelopeGain === 'function' ? options.envelopeGain : () => 1;
	const sampleColor = typeof options.sampleColor === 'function' ? options.sampleColor : () => options.sampleColor || '#000';
	const rmsColor = typeof options.rmsColor === 'function' ? options.rmsColor : () => options.rmsColor || '#000';
	const centerLineColor = options.centerLineColor || null;

	if (rendering.mode === 'connecting-dots' || rendering.mode === 'stem') {
		drawIndividualSamples(context, channel, {
			width,
			pixelsPerSample: rendering.pixelsPerSample,
			centerY,
			maxAmplitude,
			halfWave,
			envelopeGain,
			sampleColor,
			centerLineColor,
			mode: rendering.mode,
		});
		return;
	}

	drawSummaryColumns(context, channel, {
		width,
		centerY,
		maxAmplitude,
		halfWave,
		envelopeGain,
		sampleColor,
		rmsColor,
		showRms: Boolean(options.showRms),
	});
}

function drawSummaryColumns(context, channel, options) {
	const columnCount = Math.min(
		Math.ceil(options.width),
		channel.minimum.length,
		channel.maximum.length,
	);
	for (let x = 0; x < columnCount; x += 1) {
		const gain = finiteGain(options.envelopeGain(x, columnCount));
		let minimum = finiteSample(channel.minimum[x]) * gain;
		let maximum = finiteSample(channel.maximum[x]) * gain;
		if (minimum > maximum) [minimum, maximum] = [maximum, minimum];
		if (options.halfWave) {
			minimum = Math.max(0, minimum);
			maximum = Math.max(0, maximum);
		}
		fillAmplitudeSpan(context, x, minimum, maximum, options.centerY, options.maxAmplitude, options.sampleColor(x));

		if (!options.showRms || !channel.rms) continue;
		const rms = Math.max(0, finiteSample(channel.rms[x]) * gain);
		const rmsMinimum = options.halfWave ? minimum : Math.max(minimum, -rms);
		const rmsMaximum = Math.min(maximum, rms);
		if (rmsMinimum <= rmsMaximum) {
			fillAmplitudeSpan(context, x, rmsMinimum, rmsMaximum, options.centerY, options.maxAmplitude, options.rmsColor(x));
		}
	}
}

function drawIndividualSamples(context, channel, options) {
	const samples = channel.samples;
	if (!samples?.length) return;
	const pixelsPerSample = positiveFinite(options.pixelsPerSample, 'pixelsPerSample');
	const firstSampleX = finite(channel.firstSampleX, 'firstSampleX');
	const points = new Array(samples.length);
	for (let index = 0; index < samples.length; index += 1) {
		const x = firstSampleX + index * pixelsPerSample;
		const gain = finiteGain(options.envelopeGain(x, options.width));
		let value = finiteSample(samples[index]) * gain;
		if (options.halfWave) value = Math.max(0, value);
		points[index] = {
			x,
			y: options.centerY - value * options.maxAmplitude,
		};
	}

	context.lineWidth = 1;
	context.lineJoin = 'round';
	context.lineCap = 'round';
	if (options.mode === 'connecting-dots') {
		drawCenterLine(context, options);
		for (let index = 1; index < points.length; index += 1) {
			const previous = points[index - 1];
			const point = points[index];
			context.strokeStyle = options.sampleColor((previous.x + point.x) / 2);
			context.beginPath();
			context.moveTo(previous.x, previous.y);
			context.lineTo(point.x, point.y);
			context.stroke();
		}
		return;
	}

	for (const point of points) {
		const color = options.sampleColor(point.x);
		context.strokeStyle = color;
		context.beginPath();
		context.moveTo(point.x, options.centerY);
		context.lineTo(point.x, point.y);
		context.stroke();
	}
	drawCenterLine(context, options);
	for (const point of points) {
		const color = options.sampleColor(point.x);
		context.fillStyle = color;
		context.beginPath();
		context.arc(point.x, point.y, 2, 0, Math.PI * 2);
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

function fillAmplitudeSpan(context, x, minimum, maximum, centerY, maxAmplitude, color) {
	const top = Math.round(centerY - maximum * maxAmplitude);
	const bottom = Math.round(centerY - minimum * maxAmplitude);
	context.fillStyle = color;
	context.fillRect(x, Math.min(top, bottom), 1, Math.max(1, Math.abs(bottom - top)));
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
