/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	MAXIMUM_WAVEFORM_VERTICAL_ZOOM,
	spectrogramScaleValue,
	type SpectrogramScale,
} from './geometry.ts';

interface FrequencyRange {
	readonly minimumFrequency: number;
	readonly maximumFrequency: number;
}

export function verticalRulerWheelZoom(current: number, delta: number): number {
	return Math.max(0, Math.min(MAXIMUM_WAVEFORM_VERTICAL_ZOOM, current - Math.sign(delta)));
}

/** Zoom and pan in the chosen scale, keeping the pointed frequency stationary during zoom. */
export function frequencyRulerWheelRange(
	range: FrequencyRange, scale: SpectrogramScale, nyquist: number, pointerFraction: number, delta: number, zoom: boolean,
): FrequencyRange {
	const maximum = spectrogramScaleValue(nyquist, scale);
	const low = spectrogramScaleValue(range.minimumFrequency, scale);
	const high = spectrogramScaleValue(range.maximumFrequency, scale);
	const width = high - low;
	const fraction = 1 - Math.max(0, Math.min(1, pointerFraction));
	const nextWidth = zoom ? Math.min(maximum, Math.max(maximum / 65_536, width * 2 ** (Math.max(-480, Math.min(480, delta)) / 240))) : width;
	const anchor = low + width * fraction;
	const requestedLow = zoom ? anchor - nextWidth * fraction : low + delta / 1_200 * width;
	const nextLow = Math.max(0, Math.min(maximum - nextWidth, requestedLow));
	return {
		minimumFrequency: inverseScale(nextLow, scale, nyquist),
		maximumFrequency: inverseScale(nextLow + nextWidth, scale, nyquist),
	};
}

function inverseScale(value: number, scale: SpectrogramScale, nyquist: number): number {
	if (scale === 'linear') return value;
	if (value <= 0) return 0;
	if (value >= spectrogramScaleValue(nyquist, scale)) return nyquist;
	let low = 0;
	let high = nyquist;
	for (let iteration = 0; iteration < 40; iteration += 1) {
		const midpoint = (low + high) / 2;
		if (spectrogramScaleValue(midpoint, scale) < value) low = midpoint;
		else high = midpoint;
	}
	return (low + high) / 2;
}
