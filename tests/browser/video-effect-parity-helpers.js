export const VIDEO_EFFECT_PARITY_WIDTH = 128;
export const VIDEO_EFFECT_PARITY_HEIGHT = 72;
export const VIDEO_EFFECT_PARITY_MINIMUM_SSIM = 0.98;
export const VIDEO_EFFECT_PARITY_MAXIMUM_CHANNEL_MAE = 6 / 255;

const COLOR_CHART = Object.freeze([
	[255, 255, 255],
	[255, 235, 59],
	[0, 188, 212],
	[76, 175, 80],
	[233, 30, 99],
	[244, 67, 54],
	[63, 81, 181],
	[18, 18, 18],
]);

export function createVideoEffectParityFixture(name, width = VIDEO_EFFECT_PARITY_WIDTH, height = VIDEO_EFFECT_PARITY_HEIGHT) {
	const bytes = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const offset = (y * width + x) * 4;
			const pixel = fixturePixel(name, x, y, width, height);
			bytes[offset] = pixel[0];
			bytes[offset + 1] = pixel[1];
			bytes[offset + 2] = pixel[2];
			bytes[offset + 3] = pixel[3];
		}
	}
	return { name, width, height, bytes };
}

export function compareVideoEffectFrames(actual, expected, width, height) {
	if (!(actual instanceof Uint8Array) || !(expected instanceof Uint8Array)) {
		throw new TypeError('Video effect parity frames must be Uint8Array values.');
	}
	const expectedLength = width * height * 4;
	if (actual.length !== expectedLength || expected.length !== expectedLength) {
		throw new RangeError(`Video effect parity frames must contain ${expectedLength} bytes.`);
	}

	const channelAbsoluteError = [0, 0, 0, 0];
	for (let offset = 0; offset < expectedLength; offset += 4) {
		for (let channel = 0; channel < 4; channel += 1) {
			channelAbsoluteError[channel] += Math.abs(actual[offset + channel] - expected[offset + channel]);
		}
	}
	const pixelCount = width * height;
	return {
		ssim: structuralSimilarity(actual, expected, width, height),
		channelMae: Object.fromEntries(['red', 'green', 'blue', 'alpha'].map((channel, index) => (
			[channel, channelAbsoluteError[index] / (pixelCount * 255)]
		))),
	};
}

function fixturePixel(name, x, y, width, height) {
	if (name === 'gradient') {
		return [
			Math.round(255 * x / Math.max(1, width - 1)),
			Math.round(255 * y / Math.max(1, height - 1)),
			Math.round(255 * (x + y) / Math.max(1, width + height - 2)),
			255,
		];
	}
	if (name === 'color-chart') {
		const column = Math.min(COLOR_CHART.length - 1, Math.floor(x * COLOR_CHART.length / width));
		const row = Math.min(3, Math.floor(y * 4 / height));
		const base = COLOR_CHART[(column + row * 2) % COLOR_CHART.length];
		const level = [1, 0.72, 0.46, 0.2][row];
		return [
			Math.round(base[0] * level),
			Math.round(base[1] * level),
			Math.round(base[2] * level),
			255,
		];
	}
	if (name === 'edge') {
		const vertical = x < width / 2 ? 24 : 232;
		const horizontal = y < height / 2 ? 32 : 216;
		return [
			vertical,
			horizontal,
			(x + y) % 16 < 8 ? 12 : 244,
			255,
		];
	}
	if (name === 'transparency') {
		const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
		return [
			checker ? 245 : 32,
			Math.round(255 * x / Math.max(1, width - 1)),
			Math.round(255 * (height - 1 - y) / Math.max(1, height - 1)),
			Math.round(24 + 207 * ((x * 5 + y * 3) % width) / Math.max(1, width - 1)),
		];
	}
	throw new RangeError(`Unknown video effect parity fixture: ${name}.`);
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
					actualVariance += actualDelta * actualDelta;
					expectedVariance += expectedDelta * expectedDelta;
					covariance += actualDelta * expectedDelta;
				}
			}
			const divisor = Math.max(1, sampleCount - 1);
			actualVariance /= divisor;
			expectedVariance /= divisor;
			covariance /= divisor;
			score += (
				(2 * actualMean * expectedMean + c1) * (2 * covariance + c2)
			) / (
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
