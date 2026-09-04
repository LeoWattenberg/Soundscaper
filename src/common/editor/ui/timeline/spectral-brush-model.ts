/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	spectrogramFrequencyAtFraction,
	type SpectrogramScale,
} from './geometry.ts';

const MINIMUM_BRUSH_RADIUS_PIXELS = 4;

export interface SpectralBrushGestureGeometry {
	readonly startX: number;
	readonly startY: number;
	readonly endX: number;
	readonly endY: number;
	readonly laneWidth: number;
	readonly laneHeight: number;
	/** Lane pixels between the lane edge and the time the lane starts at. */
	readonly contentOffsetX: number;
	readonly overscanStartFrame: number;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly minimumFrequency: number;
	readonly maximumFrequency: number;
	readonly scale: SpectrogramScale;
}

export interface SpectralBrushSelectionRequest {
	readonly centerFrame: number;
	readonly centerFrequency: number;
	readonly radiusFrames: number;
	readonly radiusFrequency: number;
}

export function planSpectralBrushGesture(
	geometry: SpectralBrushGestureGeometry,
): SpectralBrushSelectionRequest {
	const laneWidth = finitePositive(geometry.laneWidth, 'spectral brush lane width');
	const laneHeight = finitePositive(geometry.laneHeight, 'spectral brush lane height');
	const pixelsPerSecond = finitePositive(geometry.pixelsPerSecond, 'spectral brush pixels per second');
	const sampleRate = safePositiveInteger(geometry.sampleRate, 'spectral brush sample rate');
	const overscanStartFrame = safeNonNegativeInteger(
		geometry.overscanStartFrame,
		'spectral brush overscan start frame',
	);
	const contentOffsetX = finiteNonNegative(geometry.contentOffsetX, 'spectral brush content offset');
	const minimumFrequency = finiteNonNegative(
		geometry.minimumFrequency,
		'spectral brush minimum frequency',
	);
	const maximumFrequency = Number(geometry.maximumFrequency);
	if (!Number.isFinite(maximumFrequency) || maximumFrequency <= minimumFrequency) {
		throw new RangeError('Spectral brush frequency bounds must be finite and ordered.');
	}
	const startX = clamp(finite(geometry.startX, 'spectral brush start x'), 0, laneWidth);
	const endX = clamp(finite(geometry.endX, 'spectral brush end x'), 0, laneWidth);
	const startY = clamp(finite(geometry.startY, 'spectral brush start y'), 0, laneHeight);
	const endY = clamp(finite(geometry.endY, 'spectral brush end y'), 0, laneHeight);
	// Lanes draw their clips contentOffsetX pixels in, so a stroke names the audio
	// under it only once that inset is taken back off.
	const centerFrame = overscanStartFrame
		+ Math.round(Math.max(0, startX - contentOffsetX) / pixelsPerSecond * sampleRate);
	if (!Number.isSafeInteger(centerFrame)) throw new RangeError('Spectral brush center frame exceeds the safe integer domain.');
	const radiusFrames = Math.max(
		1,
		Math.round(Math.max(Math.abs(endX - startX), MINIMUM_BRUSH_RADIUS_PIXELS)
			/ pixelsPerSecond * sampleRate),
	);
	const frequencyAtY = (y: number) => Math.round(spectrogramFrequencyAtFraction(
		1 - y / laneHeight,
		geometry.scale,
		minimumFrequency,
		maximumFrequency,
	));
	const centerFrequency = frequencyAtY(startY);
	const draggedFrequencyRadius = Math.abs(frequencyAtY(endY) - centerFrequency);
	const minimumFrequencyRadius = Math.max(
		Math.abs(frequencyAtY(clamp(startY - MINIMUM_BRUSH_RADIUS_PIXELS, 0, laneHeight)) - centerFrequency),
		Math.abs(frequencyAtY(clamp(startY + MINIMUM_BRUSH_RADIUS_PIXELS, 0, laneHeight)) - centerFrequency),
		1,
	);
	return Object.freeze({
		centerFrame,
		centerFrequency,
		radiusFrames,
		radiusFrequency: Math.max(draggedFrequencyRadius, minimumFrequencyRadius),
	});
}

function finite(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite.`);
	return number;
}

function finitePositive(value: unknown, name: string): number {
	const number = finite(value, name);
	if (!(number > 0)) throw new RangeError(`${name} must be positive.`);
	return number;
}

function finiteNonNegative(value: unknown, name: string): number {
	const number = finite(value, name);
	if (number < 0) throw new RangeError(`${name} must be non-negative.`);
	return number;
}

function safePositiveInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

function safeNonNegativeInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return number;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}
