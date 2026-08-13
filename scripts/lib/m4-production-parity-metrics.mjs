/* SPDX-License-Identifier: AGPL-3.0-only */

/** Decode canonical frame-major little-endian Float32 evidence. */
export function decodeM4ParityAudio(value, specification, label) {
	const channelCount = positiveInteger(specification.channelCount, 'fixture channel count');
	const frameCount = positiveInteger(specification.frameCount, 'fixture frame count');
	const bytes = decodeCanonicalBase64(
		value,
		channelCount * frameCount * Float32Array.BYTES_PER_ELEMENT,
		`${label} audio evidence`,
	);
	const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 0;
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (const channel of channels) {
			const sample = view.getFloat32(offset, true);
			if (!Number.isFinite(sample)) throw new Error(`${label} audio evidence must be finite.`);
			channel[frame] = sample;
			offset += Float32Array.BYTES_PER_ELEMENT;
		}
	}
	return Object.freeze({ bytes, channels: Object.freeze(channels) });
}

/** Compare complete PCM and find each fixture impulse independently. */
export function compareM4ParityAudio(actual, reference, specification) {
	const channelCount = positiveInteger(specification.channelCount, 'fixture channel count');
	const frameCount = positiveInteger(specification.frameCount, 'fixture frame count');
	if (actual.length !== channelCount || reference.length !== channelCount) {
		throw new Error('Milestone 4 audio evidence channel geometry is invalid.');
	}
	let maximumAbsoluteSampleError = 0;
	let pdcErrorSamples = 0;
	const impulseFrames = exactIntegerArray(
		specification.outputImpulseFrames,
		channelCount,
		'fixture output impulse frames',
	);
	for (let channel = 0; channel < channelCount; channel += 1) {
		if (actual[channel]?.length !== frameCount || reference[channel]?.length !== frameCount) {
			throw new Error('Milestone 4 audio evidence frame geometry is invalid.');
		}
		for (let frame = 0; frame < frameCount; frame += 1) {
			maximumAbsoluteSampleError = Math.max(
				maximumAbsoluteSampleError,
				Math.abs(actual[channel][frame] - reference[channel][frame]),
			);
		}
		const expected = impulseFrames[channel];
		const observed = strongestFrame(actual[channel], expected, 64);
		pdcErrorSamples = Math.max(pdcErrorSamples, Math.abs(observed - expected));
	}
	return Object.freeze({ maximumAbsoluteSampleError, pdcErrorSamples });
}

/** Recompute calibrated RGBA SSIM and maximum normalized channel MAE. */
export function compareM4ParityVideo(actual, expected, width, height) {
	const frameWidth = positiveInteger(width, 'video width');
	const frameHeight = positiveInteger(height, 'video height');
	const expectedLength = frameWidth * frameHeight * 4;
	if (actual.byteLength !== expectedLength || expected.byteLength !== expectedLength) {
		throw new Error(`Video parity frames must contain exactly ${expectedLength} bytes.`);
	}
	const channelErrors = [0, 0, 0, 0];
	for (let offset = 0; offset < expectedLength; offset += 4) {
		for (let channel = 0; channel < 4; channel += 1) {
			channelErrors[channel] += Math.abs(actual[offset + channel] - expected[offset + channel]);
		}
	}
	const divisor = frameWidth * frameHeight * 255;
	return Object.freeze({
		ssim: structuralSimilarity(actual, expected, frameWidth, frameHeight),
		maximumChannelMae: Math.max(...channelErrors.map((error) => error / divisor)),
	});
}

/** Validate the complete four-way partition and return requested-minus-rendered. */
export function validateM4ParityRenderReport(value, path) {
	const report = exactRecord(
		value,
		['effects', 'renderedEntryCount', 'rendererStatus', 'status'],
		path,
	);
	if (report.status !== 'rendered' && report.status !== 'fallback') {
		throw new Error(`${path}.status must be rendered or fallback.`);
	}
	if (report.rendererStatus !== 'available' && report.rendererStatus !== 'failed') {
		throw new Error(`${path}.rendererStatus must be available or failed.`);
	}
	if (!Number.isSafeInteger(report.renderedEntryCount) || report.renderedEntryCount < 0) {
		throw new Error(`${path}.renderedEntryCount must be a non-negative integer.`);
	}
	const effects = exactRecord(
		report.effects,
		['fallbackRendered', 'omitted', 'rendered', 'requested'],
		`${path}.effects`,
	);
	const requested = effectIds(effects.requested, `${path}.effects.requested`);
	const rendered = effectIds(effects.rendered, `${path}.effects.rendered`);
	const fallbackRendered = effectIds(effects.fallbackRendered, `${path}.effects.fallbackRendered`);
	const omitted = effectIds(effects.omitted, `${path}.effects.omitted`);
	const requestedSet = new Set(requested);
	const outcome = [...rendered, ...fallbackRendered, ...omitted];
	if (new Set(outcome).size !== outcome.length
		|| outcome.length !== requested.length
		|| outcome.some((id) => !requestedSet.has(id))) {
		throw new Error(`${path} effect outcomes must exactly partition requested effects.`);
	}
	const expectedStatus = report.rendererStatus === 'failed' || fallbackRendered.length || omitted.length
		? 'fallback'
		: 'rendered';
	if (report.status !== expectedStatus) throw new Error(`${path}.status does not match its effect partition.`);
	const renderedSet = new Set(rendered);
	return Object.freeze({
		requested: Object.freeze(requested),
		unrendered: Object.freeze(requested.filter((id) => !renderedSet.has(id))),
	});
}

export function decodeM4ParityRgba(value, expectedLength, label) {
	return decodeCanonicalBase64(value, expectedLength, label);
}

function structuralSimilarity(actual, expected, width, height) {
	const windowSize = 8;
	const c1 = 0.01 ** 2;
	const c2 = 0.03 ** 2;
	let score = 0;
	let windowCount = 0;
	for (let top = 0; top < height; top += windowSize) {
		for (let left = 0; left < width; left += windowSize) {
			const right = Math.min(width, left + windowSize);
			const bottom = Math.min(height, top + windowSize);
			const sampleCount = (right - left) * (bottom - top);
			let actualMean = 0;
			let expectedMean = 0;
			for (let y = top; y < bottom; y += 1) {
				for (let x = left; x < right; x += 1) {
					const offset = (y * width + x) * 4;
					actualMean += luminance(actual, offset);
					expectedMean += luminance(expected, offset);
				}
			}
			actualMean /= sampleCount;
			expectedMean /= sampleCount;
			let actualVariance = 0;
			let expectedVariance = 0;
			let covariance = 0;
			for (let y = top; y < bottom; y += 1) {
				for (let x = left; x < right; x += 1) {
					const offset = (y * width + x) * 4;
					const actualDelta = luminance(actual, offset) - actualMean;
					const expectedDelta = luminance(expected, offset) - expectedMean;
					actualVariance += actualDelta ** 2;
					expectedVariance += expectedDelta ** 2;
					covariance += actualDelta * expectedDelta;
				}
			}
			const divisor = Math.max(1, sampleCount - 1);
			actualVariance /= divisor;
			expectedVariance /= divisor;
			covariance /= divisor;
			score += ((2 * actualMean * expectedMean + c1) * (2 * covariance + c2)) / (
				(actualMean ** 2 + expectedMean ** 2 + c1)
				* (actualVariance + expectedVariance + c2)
			);
			windowCount += 1;
		}
	}
	return score / windowCount;
}

function luminance(bytes, offset) {
	return (
		bytes[offset] * 0.2126
		+ bytes[offset + 1] * 0.7152
		+ bytes[offset + 2] * 0.0722
	) / 255;
}

function strongestFrame(channel, center, radius) {
	let strongest = center;
	let magnitude = -1;
	for (let frame = Math.max(0, center - radius); frame <= Math.min(channel.length - 1, center + radius); frame += 1) {
		const candidate = Math.abs(channel[frame]);
		if (candidate > magnitude) {
			strongest = frame;
			magnitude = candidate;
		}
	}
	return strongest;
}

function decodeCanonicalBase64(value, expectedLength, label) {
	if (typeof value !== 'string' || value.length < 1 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
		throw new Error(`${label} must be canonical base64.`);
	}
	const bytes = Buffer.from(value, 'base64');
	if (bytes.toString('base64') !== value || bytes.byteLength !== expectedLength) {
		throw new Error(`${label} must contain exactly ${expectedLength} bytes.`);
	}
	return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function effectIds(value, path) {
	if (!Array.isArray(value) || value.length > 4_096) throw new Error(`${path} must be a bounded array.`);
	const ids = value.map((id) => {
		if (typeof id !== 'string' || id.length < 1 || id.length > 160) {
			throw new Error(`${path} contains an invalid effect instance ID.`);
		}
		return id;
	});
	if (new Set(ids).size !== ids.length) throw new Error(`${path} contains duplicate effect instance IDs.`);
	return ids;
}

function exactRecord(value, fields, path) {
	if (!isRecord(value)) throw new Error(`${path} must be a plain record.`);
	const actual = Object.keys(value).sort();
	const expected = [...fields].sort();
	if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
		throw new Error(`${path} must contain the exact fields.`);
	}
	return value;
}

function exactIntegerArray(value, length, path) {
	if (!Array.isArray(value) || value.length !== length
		|| value.some((entry) => !Number.isSafeInteger(entry) || entry < 0)) {
		throw new Error(`${path} must contain exactly ${length} non-negative integers.`);
	}
	return value;
}

function positiveInteger(value, path) {
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${path} must be a positive integer.`);
	return value;
}

function isRecord(value) {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
