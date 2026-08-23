/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	applySimilarityTransformV1,
	createGrayVideoFrameV1,
	resolveStabilizationTransformV1,
	type GrayVideoFrameV1,
	type VideoSimilarityTransformV1,
} from './video-motion-processing-v27.ts';

export interface VideoTemporalNeighborV1 {
	readonly frame: GrayVideoFrameV1;
	/** Maps the neighbor's pixel coordinates into the current frame. */
	readonly transformToCurrent: VideoSimilarityTransformV1;
}

export interface VideoMotionWebGl2AcceleratorV1 {
	readonly kind: 'webgl2';
	temporalDenoise(request: Readonly<{
		current: GrayVideoFrameV1;
		neighbors: readonly VideoTemporalNeighborV1[];
		strength: number;
		signal?: AbortSignal;
	}>): Promise<GrayVideoFrameV1>;
}

const PARITY_TOLERANCE = 1e-6;

export async function processTemporalDenoiseV1(request: Readonly<{
	readonly current: GrayVideoFrameV1;
	readonly neighbors: readonly VideoTemporalNeighborV1[];
	readonly strength: number;
	readonly accelerator?: VideoMotionWebGl2AcceleratorV1;
	readonly signal?: AbortSignal;
	readonly onAcceleratorFallback?: (reason: string) => void;
}>): Promise<GrayVideoFrameV1> {
	throwIfAborted(request?.signal);
	const current = frameValue(request?.current, 'temporal denoise current frame');
	if (!Array.isArray(request?.neighbors) || request.neighbors.length > 16) {
		throw new RangeError('Temporal denoise neighbors exceed their bound.');
	}
	const neighbors = request.neighbors.map((neighbor, index) => neighborValue(
		neighbor, current, `temporal denoise neighbor ${String(index)}`,
	));
	const strength = bounded(request?.strength, 0, 1, 'temporal denoise strength');
	const cpu = temporalDenoiseCpu(current, neighbors, strength, request.signal);
	if (!request.accelerator) return cpu;
	if (request.accelerator.kind !== 'webgl2') throw new TypeError('The motion accelerator must be WebGL2.');
	try {
		const accelerated = frameValue(await request.accelerator.temporalDenoise({
			current, neighbors, strength, ...(request.signal ? { signal: request.signal } : {}),
		}), 'accelerated temporal denoise frame');
		throwIfAborted(request.signal);
		if (!framesMatch(cpu, accelerated, PARITY_TOLERANCE)) {
			request.onAcceleratorFallback?.('WebGL2 temporal denoise failed CPU parity; deterministic CPU fallback was used.');
		}
	} catch (error) {
		throwIfAborted(request.signal);
		request.onAcceleratorFallback?.(`WebGL2 temporal denoise was unavailable; deterministic CPU fallback was used: ${errorMessage(error)}`);
	}
	return cpu;
}

export function processSpatialDenoiseV1(
	frameValueInput: GrayVideoFrameV1,
	options: Readonly<{ readonly radius: number; readonly strength: number; readonly signal?: AbortSignal }>,
): GrayVideoFrameV1 {
	const frame = frameValue(frameValueInput, 'spatial denoise frame');
	const radius = boundedInteger(options?.radius, 1, 16, 'spatial denoise radius');
	const strength = bounded(options?.strength, 0, 1, 'spatial denoise strength');
	const samples: number[] = [];
	for (let y = 0; y < frame.height; y += 1) {
		throwIfAborted(options.signal);
		for (let x = 0; x < frame.width; x += 1) {
			let total = 0;
			let count = 0;
			for (let oy = -radius; oy <= radius; oy += 1) {
				for (let ox = -radius; ox <= radius; ox += 1) {
					total += pixelClamped(frame, x + ox, y + oy);
					count += 1;
				}
			}
			const original = pixel(frame, x, y);
			samples.push(original + (total / count - original) * strength);
		}
	}
	return createGrayVideoFrameV1({ width: frame.width, height: frame.height, samples });
}

function temporalDenoiseCpu(
	current: GrayVideoFrameV1,
	neighbors: readonly VideoTemporalNeighborV1[],
	strength: number,
	signal?: AbortSignal,
): GrayVideoFrameV1 {
	const samples: number[] = [];
	for (let y = 0; y < current.height; y += 1) {
		throwIfAborted(signal);
		for (let x = 0; x < current.width; x += 1) {
			let total = pixel(current, x, y);
			let count = 1;
			for (const neighbor of neighbors) {
				const coordinate = applySimilarityTransformV1(
					{ x, y }, resolveStabilizationTransformV1(neighbor.transformToCurrent, 1),
				);
				if (!inside(neighbor.frame, coordinate.x, coordinate.y)) continue;
				total += sampleBilinear(neighbor.frame, coordinate.x, coordinate.y);
				count += 1;
			}
			const original = pixel(current, x, y);
			samples.push(original + (total / count - original) * strength);
		}
	}
	return createGrayVideoFrameV1({ width: current.width, height: current.height, samples });
}

function neighborValue(
	value: VideoTemporalNeighborV1,
	current: GrayVideoFrameV1,
	name: string,
): VideoTemporalNeighborV1 {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be an object.`);
	const frame = frameValue(value.frame, `${name} frame`);
	if (frame.width !== current.width || frame.height !== current.height) {
		throw new RangeError(`${name} dimensions do not match the current frame.`);
	}
	// Resolving the exact inverse validates every similarity scalar.
	resolveStabilizationTransformV1(value.transformToCurrent, 1);
	return Object.freeze({ frame, transformToCurrent: Object.freeze({ ...value.transformToCurrent }) });
}

function frameValue(value: unknown, name: string): GrayVideoFrameV1 {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be a gray frame.`);
	const frame = value as Partial<GrayVideoFrameV1>;
	return createGrayVideoFrameV1({ width: frame.width, height: frame.height, samples: frame.samples });
}

function pixel(frame: GrayVideoFrameV1, x: number, y: number): number {
	return frame.samples[y * frame.width + x]!;
}

function pixelClamped(frame: GrayVideoFrameV1, x: number, y: number): number {
	return pixel(frame, Math.max(0, Math.min(frame.width - 1, x)), Math.max(0, Math.min(frame.height - 1, y)));
}

function sampleBilinear(frame: GrayVideoFrameV1, x: number, y: number): number {
	const x0 = Math.max(0, Math.min(frame.width - 1, Math.floor(x)));
	const y0 = Math.max(0, Math.min(frame.height - 1, Math.floor(y)));
	const x1 = Math.min(frame.width - 1, x0 + 1);
	const y1 = Math.min(frame.height - 1, y0 + 1);
	const mixX = Math.max(0, Math.min(1, x - x0));
	const mixY = Math.max(0, Math.min(1, y - y0));
	const top = pixel(frame, x0, y0) + (pixel(frame, x1, y0) - pixel(frame, x0, y0)) * mixX;
	const bottom = pixel(frame, x0, y1) + (pixel(frame, x1, y1) - pixel(frame, x0, y1)) * mixX;
	return top + (bottom - top) * mixY;
}

function inside(frame: GrayVideoFrameV1, x: number, y: number): boolean {
	return x >= 0 && y >= 0 && x <= frame.width - 1 && y <= frame.height - 1;
}

function framesMatch(left: GrayVideoFrameV1, right: GrayVideoFrameV1, tolerance: number): boolean {
	return left.width === right.width && left.height === right.height
		&& left.samples.every((sample, index) => Math.abs(sample - right.samples[index]!) <= tolerance);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${name} is outside its integer bound.`);
	}
	return Number(value);
}

function bounded(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} is outside its finite bound.`);
	}
	return Object.is(value, -0) ? 0 : value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The motion operation was aborted.', 'AbortError');
}

function errorMessage(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}
