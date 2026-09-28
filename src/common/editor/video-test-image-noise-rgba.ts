/* SPDX-License-Identifier: AGPL-3.0-only */

export type VideoTestImagePattern = 'color-bars' | 'grayscale-ramp' | 'alignment-grid';
export type VideoNoiseMode = 'monochrome' | 'color';

export interface GeneratedVideoRgbaFrame {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array<ArrayBuffer>;
}

const MAXIMUM_PIXELS = 33_554_432;
const COLOR_BARS = Object.freeze([
	[255, 255, 255], [255, 255, 0], [0, 255, 255], [0, 255, 0],
	[255, 0, 255], [255, 0, 0], [0, 0, 255], [0, 0, 0],
] as const);

/** Opaque calibration images whose pixel geometry is independent of the display backend. */
export function renderVideoTestImageRgba(options: Readonly<{
	readonly pattern: VideoTestImagePattern;
	readonly width: number;
	readonly height: number;
	readonly signal?: AbortSignal;
}>): GeneratedVideoRgbaFrame {
	const { width, height } = dimensions(options.width, options.height);
	if (!['color-bars', 'grayscale-ramp', 'alignment-grid'].includes(options.pattern)) {
		throw new RangeError('Unsupported test image pattern.');
	}
	const pixels = new Uint8Array(width * height * 4);
	const gridStep = Math.max(8, Math.round(Math.min(width, height) / 8));
	const centerX = Math.floor(width / 2);
	const centerY = Math.floor(height / 2);
	for (let y = 0; y < height; y += 1) {
		throwIfAborted(options.signal);
		for (let x = 0; x < width; x += 1) {
			let red: number;
			let green: number;
			let blue: number;
			if (options.pattern === 'color-bars') {
				[red, green, blue] = COLOR_BARS[Math.min(7, Math.floor(x * 8 / width))]!;
			} else if (options.pattern === 'grayscale-ramp') {
				red = green = blue = Math.round(x * 255 / Math.max(1, width - 1));
			} else if (x === centerX || y === centerY) {
				[red, green, blue] = [255, 64, 64];
			} else if (x % gridStep === 0 || y % gridStep === 0) {
				[red, green, blue] = [224, 224, 224];
			} else {
				[red, green, blue] = [24, 24, 24];
			}
			const offset = (y * width + x) * 4;
			pixels[offset] = red;
			pixels[offset + 1] = green;
			pixels[offset + 2] = blue;
			pixels[offset + 3] = 255;
		}
	}
	return Object.freeze({ width, height, pixels });
}

/** Seeded video noise; the output ordinal is absolute so seeking and export reproduce frames. */
export function renderVideoNoiseRgba(options: Readonly<{
	readonly mode: VideoNoiseMode;
	readonly grainSize: number;
	readonly seed: number;
	readonly outputOrdinal: number;
	readonly width: number;
	readonly height: number;
	readonly signal?: AbortSignal;
}>): GeneratedVideoRgbaFrame {
	const { width, height } = dimensions(options.width, options.height);
	if (options.mode !== 'monochrome' && options.mode !== 'color') {
		throw new RangeError('Unsupported video noise mode.');
	}
	if (!Number.isSafeInteger(options.grainSize) || options.grainSize < 1 || options.grainSize > 64) {
		throw new RangeError('Video noise grain size must be between 1 and 64 pixels.');
	}
	if (!Number.isSafeInteger(options.seed) || Object.is(options.seed, -0)
		|| options.seed < 0 || options.seed > 0xffff_ffff) {
		throw new RangeError('Video noise seed must be an unsigned 32-bit integer.');
	}
	if (!Number.isSafeInteger(options.outputOrdinal) || options.outputOrdinal < 0) {
		throw new RangeError('Video noise output ordinal must be a non-negative safe integer.');
	}
	const { grainSize, seed, outputOrdinal } = options;
	const pixels = new Uint8Array(width * height * 4);
	const cellCount = Math.ceil(width / grainSize);
	const rowColors = new Uint32Array(cellCount);
	const frameHash = mix32(seed ^ mix32(outputOrdinal));
	for (let y = 0; y < height; y += 1) {
		throwIfAborted(options.signal);
		if (y % grainSize !== 0) {
			const previous = (y - 1) * width * 4;
			pixels.set(pixels.subarray(previous, previous + width * 4), y * width * 4);
			continue;
		}
		const cellY = Math.floor(y / grainSize);
		for (let cellX = 0; cellX < cellCount; cellX += 1) {
			rowColors[cellX] = mix32(frameHash ^ Math.imul(cellX + 1, 0x9e3779b1)
				^ Math.imul(cellY + 1, 0x85ebca6b));
		}
		for (let x = 0; x < width; x += 1) {
			const random = rowColors[Math.floor(x / grainSize)]!;
			const offset = (y * width + x) * 4;
			pixels[offset] = random & 255;
			pixels[offset + 1] = options.mode === 'color' ? (random >>> 8) & 255 : pixels[offset]!;
			pixels[offset + 2] = options.mode === 'color' ? (random >>> 16) & 255 : pixels[offset]!;
			pixels[offset + 3] = 255;
		}
	}
	// A changing reference grain guarantees a different picture at every adjacent
	// output frame, including a one-pixel monochrome clip and silent projects.
	const reference = outputOrdinal & 255;
	const green = options.mode === 'color' ? pixels[1]! : reference;
	const blue = options.mode === 'color' ? pixels[2]! : reference;
	for (let y = 0; y < Math.min(grainSize, height); y += 1) {
		for (let x = 0; x < Math.min(grainSize, width); x += 1) {
			const offset = (y * width + x) * 4;
			pixels[offset] = reference;
			pixels[offset + 1] = green;
			pixels[offset + 2] = blue;
		}
	}
	return Object.freeze({ width, height, pixels });
}

function dimensions(width: number, height: number): Readonly<{ width: number; height: number }> {
	if (!Number.isSafeInteger(width) || width < 1 || width > 65_536) {
		throw new RangeError('Generated video width is invalid.');
	}
	if (!Number.isSafeInteger(height) || height < 1 || height > 65_536) {
		throw new RangeError('Generated video height is invalid.');
	}
	if (width * height > MAXIMUM_PIXELS) throw new RangeError('Generated video pixel count exceeds its limit.');
	return { width, height };
}

function mix32(value: number): number {
	let mixed = value >>> 0;
	mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
	mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
	return (mixed ^ (mixed >>> 16)) >>> 0;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('Video generation aborted.', 'AbortError');
}
