/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic CPU image tensor preparation and bounded visual postprocessing. */

import type { AssistanceOnnxTensorV1 } from './assistance-onnx-runtime-worker.ts';

export interface AssistanceVisualCropV1 {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

export interface AssistanceVisualTensorNormalizationV1 {
	readonly channelOrder: 'rgb' | 'bgr';
	readonly mean: readonly [number, number, number];
	readonly standardDeviation: readonly [number, number, number];
	readonly scale: number;
}

export function resizeAssistanceRgbaToChwFloatV1(
	rgba: Uint8Array,
	sourceWidth: number,
	sourceHeight: number,
	targetWidth: number,
	targetHeight: number,
	normalization: AssistanceVisualTensorNormalizationV1,
	crop: AssistanceVisualCropV1 = Object.freeze({ left: 0, top: 0, right: 1, bottom: 1 }),
): Float32Array {
	geometry(sourceWidth, sourceHeight, targetWidth, targetHeight, rgba);
	const region = normalizedCrop(crop);
	const result = new Float32Array(3 * targetWidth * targetHeight);
	const cropWidth = region.right - region.left;
	const cropHeight = region.bottom - region.top;
	for (let y = 0; y < targetHeight; y += 1) {
		const sourceY = (region.top + (y + 0.5) / targetHeight * cropHeight) * sourceHeight - 0.5;
		for (let x = 0; x < targetWidth; x += 1) {
			const sourceX = (region.left + (x + 0.5) / targetWidth * cropWidth) * sourceWidth - 0.5;
			const rgb = bilinear(rgba, sourceWidth, sourceHeight, sourceX, sourceY);
			const channels = normalization.channelOrder === 'rgb' ? rgb : [rgb[2], rgb[1], rgb[0]];
			const offset = y * targetWidth + x;
			for (let channel = 0; channel < 3; channel += 1) {
				const scaled = channels[channel]! * normalization.scale;
				result[channel * targetWidth * targetHeight + offset] = Math.fround(
					(scaled - normalization.mean[channel]!)
					/ normalization.standardDeviation[channel]!,
				);
			}
		}
	}
	return result;
}

export function exactAssistanceFloatTensorV1(
	value: AssistanceOnnxTensorV1 | undefined,
	dims: readonly number[],
	label: string,
): Float32Array {
	if (!value || value.type !== 'float32' || !(value.data instanceof Float32Array)
		|| JSON.stringify(value.dims) !== JSON.stringify(dims)
		|| value.data.length !== dims.reduce((product, item) => product * item, 1)) {
		throw new RangeError(`The ${label} tensor geometry or element type is invalid.`);
	}
	for (const candidate of value.data) {
		if (!Number.isFinite(candidate)) throw new RangeError(`The ${label} tensor is non-finite.`);
	}
	return value.data;
}

export function normalizeAssistanceEmbeddingV1(
	value: ArrayLike<number>,
	label: string,
): Float32Array {
	let normSquared = 0;
	for (let index = 0; index < value.length; index += 1) {
		const candidate = value[index];
		if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
			throw new RangeError(`The ${label} embedding is non-finite.`);
		}
		normSquared += candidate * candidate;
	}
	const norm = Math.sqrt(normSquared);
	if (!Number.isFinite(norm) || norm < 1e-12) {
		throw new RangeError(`The ${label} embedding cannot be normalized.`);
	}
	const result = new Float32Array(value.length);
	for (let index = 0; index < value.length; index += 1) {
		result[index] = Math.fround(value[index]! / norm);
	}
	return result;
}

export function assistanceSigmoidV1(value: number, label: string): number {
	if (!Number.isFinite(value)) throw new RangeError(`The ${label} logit is non-finite.`);
	return Math.fround(value >= 0 ? 1 / (1 + Math.exp(-value))
		: Math.exp(value) / (1 + Math.exp(value)));
}

export function assistanceNormalizedBoxV1(
	leftValue: number,
	topValue: number,
	rightValue: number,
	bottomValue: number,
): Readonly<{ x: number; y: number; width: number; height: number }> | null {
	if (![leftValue, topValue, rightValue, bottomValue].every(Number.isFinite)) {
		throw new RangeError('A visual detection box is non-finite.');
	}
	const left = Math.min(1, Math.max(0, leftValue));
	const top = Math.min(1, Math.max(0, topValue));
	const right = Math.min(1, Math.max(0, rightValue));
	const bottom = Math.min(1, Math.max(0, bottomValue));
	if (right - left < 1e-6 || bottom - top < 1e-6) return null;
	return Object.freeze({ x: Math.fround(left), y: Math.fround(top),
		width: Math.fround(right - left), height: Math.fround(bottom - top) });
}

export function assistanceBoxIouV1(
	left: Readonly<{ x: number; y: number; width: number; height: number }>,
	right: Readonly<{ x: number; y: number; width: number; height: number }>,
): number {
	const intersectionWidth = Math.max(0,
		Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
	const intersectionHeight = Math.max(0,
		Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
	const intersection = intersectionWidth * intersectionHeight;
	const union = left.width * left.height + right.width * right.height - intersection;
	return union <= 0 ? 0 : intersection / union;
}

function normalizedCrop(value: AssistanceVisualCropV1): AssistanceVisualCropV1 {
	if (![value?.left, value?.top, value?.right, value?.bottom].every((candidate) =>
		typeof candidate === 'number' && Number.isFinite(candidate)
		&& candidate >= 0 && candidate <= 1)
		|| value.right <= value.left || value.bottom <= value.top) {
		throw new RangeError('A visual tensor crop is outside normalized frame geometry.');
	}
	return value;
}

function geometry(
	sourceWidth: number,
	sourceHeight: number,
	targetWidth: number,
	targetHeight: number,
	rgba: Uint8Array,
): void {
	if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every((candidate) =>
		Number.isSafeInteger(candidate) && candidate > 0 && candidate <= 4_096)
		|| !(rgba instanceof Uint8Array)
		|| rgba.byteLength !== sourceWidth * sourceHeight * 4) {
		throw new RangeError('Visual tensor preparation received invalid RGBA geometry.');
	}
}

function bilinear(
	rgba: Uint8Array,
	width: number,
	height: number,
	xValue: number,
	yValue: number,
): readonly [number, number, number] {
	const x = Math.max(0, Math.min(width - 1, xValue));
	const y = Math.max(0, Math.min(height - 1, yValue));
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const x1 = Math.min(width - 1, x0 + 1);
	const y1 = Math.min(height - 1, y0 + 1);
	const xWeight = x - x0;
	const yWeight = y - y0;
	return Object.freeze([0, 1, 2].map((channel) => {
		const top = rgba[(y0 * width + x0) * 4 + channel]! * (1 - xWeight)
			+ rgba[(y0 * width + x1) * 4 + channel]! * xWeight;
		const bottom = rgba[(y1 * width + x0) * 4 + channel]! * (1 - xWeight)
			+ rgba[(y1 * width + x1) * 4 + channel]! * xWeight;
		return top * (1 - yWeight) + bottom * yWeight;
	}) as [number, number, number]);
}
