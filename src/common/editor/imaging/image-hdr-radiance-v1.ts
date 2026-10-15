/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1 } from './pixel-frame-contract-v1.ts';
import { captureImageHdrAlignedMergeV1, IMAGE_HDR_INPUT_LIMITS_V1, IMAGE_HDR_INPUT_PROFILES_V1,
	type ImageHdrAlignedMergePlanV1, type ImageHdrRectangleV1 } from './image-hdr-merge-contract-v1.ts';
import { LinearDevelopOwnerV1 } from './image-develop-linear-owner-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface ImageHdrRadianceTilePlanV1 {
	readonly descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'float32'; primaries: 'srgb'; transfer: 'linear' }>;
	readonly windows: readonly Readonly<{ x: number; y: number; descriptor: Readonly<PixelFrameDescriptorV1> }>[];
	readonly maximumWorkingBytes: number;
}
export interface ImageHdrRadianceDiagnosticsV1 {
	readonly motionPixels: number; readonly inconsistentPixels: number; readonly referenceClippedPixels: number;
	readonly unresolvedPixels: number; readonly fallbackChannels: number;
}
export interface ImageHdrRadianceTileV1 {
	readonly frame: Readonly<{ descriptor: ImageHdrRadianceTilePlanV1['descriptor']; pixels: Float32Array<ArrayBuffer> }>;
	readonly diagnostics: Readonly<ImageHdrRadianceDiagnosticsV1>;
}
interface Tile { readonly plan: Readonly<ImageHdrAlignedMergePlanV1>; readonly core: Readonly<ImageHdrRectangleV1>; readonly halo: Readonly<ImageHdrRectangleV1>; }
const TILES = new WeakMap<object, Tile>(), MAXIMUM = 16 * 1024 * 1024, RESERVE = 16384, HALO = 2;
const NativeBytes = Uint8Array, TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** Admit one <=256² output tile and the exact translated windows needed for
 * its two-pixel Chebyshev motion dilation. No whole input plane is accepted. */
export function prepareImageHdrRadianceTileV1(value: unknown, rectangleValue: unknown): Readonly<ImageHdrRadianceTilePlanV1> {
	const plan = captureImageHdrAlignedMergeV1(value), rectangle = record(rectangleValue, 'HDR tile', ['x', 'y', 'width', 'height']);
	const x = integer(field(rectangle, 'x', 'HDR tile'), 0, plan.output.width - 1), y = integer(field(rectangle, 'y', 'HDR tile'), 0, plan.output.height - 1);
	const width = integer(field(rectangle, 'width', 'HDR tile'), 1, 256), height = integer(field(rectangle, 'height', 'HDR tile'), 1, 256);
	if (x + width > plan.output.width || y + height > plan.output.height) throw new RangeError('HDR tile exceeds its aligned output.');
	const core = Object.freeze({ x: plan.output.x + x, y: plan.output.y + y, width, height });
	const left = Math.max(0, core.x - HALO), top = Math.max(0, core.y - HALO);
	const halo = Object.freeze({ x: left, y: top, width: Math.min(plan.width, core.x + width + HALO) - left, height: Math.min(plan.height, core.y + height + HALO) - top });
	const windows = plan.inputs.map((input, index) => {
		const offset = plan.offsets[index]!, x = Math.max(0, halo.x - offset.x), y = Math.max(0, halo.y - offset.y);
		return Object.freeze({ x, y, descriptor: Object.freeze({ ...input.descriptor,
			width: Math.min(plan.width, halo.x + halo.width - offset.x) - x, height: Math.min(plan.height, halo.y + halo.height - offset.y) - y }) });
	});
	const descriptor = Object.freeze({ ...plan.descriptor, width, height });
	const result = Object.freeze({ descriptor, windows: Object.freeze(windows), maximumWorkingBytes: MAXIMUM });
	TILES.set(result, { plan, core, halo }); return result;
}

/** Captured-profile endpoint weights, not a sensor saturation/noise model.
 * The all-endpoint result is a deterministic lower-bound estimate, explicitly
 * marked unresolved. This scalar seam shares the tile's exact arithmetic. */
export function imageHdrRadianceChannelV1(samplesValue: unknown, exposuresValue: unknown): Readonly<{ value: number; unresolved: boolean }> {
	const samples = array(samplesValue, 'HDR channel samples', 2, 9).map(value => finite(value, 0, 1));
	const exposures = array(exposuresValue, 'HDR channel exposures', samples.length, samples.length).map(value => finite(value, 1 / 65536, 65536));
	const result = new Float64Array(2); channel(samples, exposures, result);
	return Object.freeze({ value: result[0]!, unresolved: result[1] === 1 });
}

/** Private code snapshots precede the first yield. Reconstruction uses Double
 * weighted arithmetic with one final Float32 store; no byte/word output stage.
 * Motion chooses complete reference RGB once, never three source decisions. */
export async function withImageHdrRadianceTileV1<Result>(value: Readonly<ImageHdrRadianceTilePlanV1>, windowsValue: unknown,
	consume: (view: Readonly<ImageHdrRadianceTileV1>) => Result | Promise<Result>, signalValue?: AbortSignal): Promise<Result> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	const tile = TILES.get(value); if (!tile) throw new TypeError('HDR radiance requires its owning prepared tile.');
	if (typeof consume !== 'function') throw new TypeError('HDR radiance requires a scoped consumer.');
	const frames = array(windowsValue, 'HDR tile windows', tile.plan.inputs.length, tile.plan.inputs.length).map((candidate, index) => {
		const input = record(candidate, 'HDR window frame', ['descriptor', 'pixels']);
		const plan = admitPixelFrameV1(field(input, 'descriptor', 'HDR window frame'), { profiles: IMAGE_HDR_INPUT_PROFILES_V1, limits: IMAGE_HDR_INPUT_LIMITS_V1 });
		if (JSON.stringify(plan.descriptor) !== JSON.stringify(value.windows[index]!.descriptor)) throw new RangeError('HDR window extent/profile differs from its bounded plan.');
		return { input, plan };
	});
	const sources = frames.map(({ input, plan }) => {
		const frame = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(input, 'pixels', 'HDR window frame') }, IMAGE_HDR_INPUT_LIMITS_V1);
		const buffer = Reflect.apply(BUFFER, frame.pixels, []) as ArrayBuffer, size = Reflect.apply(SIZE, buffer, []) as number;
		return { frame, buffer, size, offset: Reflect.apply(OFFSET, frame.pixels, []) as number, byteLength: plan.byteLength };
	});
	const borrowed = new Map(sources.map(source => [source.buffer, source.size]));
	const physical = [...borrowed.values()].reduce((sum, size) => sum + size, 0), copies = sources.reduce((sum, source) => sum + source.byteLength, 0);
	const outputBytes = value.descriptor.width * value.descriptor.height * 16, maskBytes = tile.halo.width * tile.halo.height;
	if (physical + copies + outputBytes + maskBytes + RESERVE > MAXIMUM) throw new RangeError('HDR tile physical working budget is exceeded.');
	const check = () => { checkRepairSignalV1(signal); for (const [buffer, size] of borrowed) if (Reflect.apply(SIZE, buffer, []) !== size) throw new TypeError('HDR window backing detached.'); };
	const owner = new LinearDevelopOwnerV1(physical + RESERVE, MAXIMUM);
	return owner.run(async () => {
		const inputs = sources.map(source => {
			const bytes = owner.bytes(source.byteLength); bytes.set(new NativeBytes(source.buffer, source.offset, source.byteLength));
			const word = source.frame.descriptor.sampleFormat === 'unorm16', pixels = word ? new Uint16Array(bytes.buffer) : bytes, maximum = word ? 65535 : 255;
			for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== maximum) throw new RangeError('HDR windows require opaque canonical Originals.');
			return { pixels, word, maximum };
		});
		const pixels = owner.floats(value.descriptor.width * value.descriptor.height * 4), motion = owner.bytes(maskBytes);
		const samples = new Float64Array(owner.bytes(inputs.length * 8).buffer), result = new Float64Array(owner.bytes(16).buffer);
		const exposures = tile.plan.inputs.map(input => input.exposureMultiplier), budget = new RepairTaskBudgetV1(check);
		const sample = (input: number, rx: number, ry: number, c: number): number | undefined => {
			const offset = tile.plan.offsets[input]!, window = value.windows[input]!, x = rx - offset.x - window.x, y = ry - offset.y - window.y;
			if (x < 0 || y < 0 || x >= window.descriptor.width || y >= window.descriptor.height) return undefined;
			const source = inputs[input]!, n = source.pixels[(y * window.descriptor.width + x) * 4 + c]! / source.maximum;
			return source.word ? n : decoded(n);
		};
		const quantum = (input: number, z: number): number => {
			if (inputs[input]!.word) return 1 / 65535 / exposures[input]!;
			const encoded = z <= .0031308 ? z * 12.92 : 1.055 * z ** (1 / 2.4) - .055;
			return (decoded(Math.min(1, encoded + 1 / 255)) - decoded(Math.max(0, encoded - 1 / 255))) / 2 / exposures[input]!;
		};
		check();
		if (tile.plan.deghost.mode === 'reference-v1') for (let y = 0; y < tile.halo.height; y++) for (let x = 0; x < tile.halo.width; x++) {
			const rx = tile.halo.x + x, ry = tile.halo.y + y, reference = tile.plan.referenceIndex;
			let inconsistent = false;
			for (let input = 0; input < inputs.length && !inconsistent; input++) if (input !== reference) for (let c = 0; c < 3; c++) {
				const a = sample(reference, rx, ry, c), b = sample(input, rx, ry, c);
				if (a === undefined || b === undefined || a <= 0 || a >= 1 || b <= 0 || b >= 1) continue;
				const ra = a / exposures[reference]!, rb = b / exposures[input]!;
				const tolerance = tile.plan.deghost.threshold * Math.max(ra, rb, 1 / 65535) + 2 * (quantum(reference, a) + quantum(input, b));
				if (Math.abs(ra - rb) > tolerance) { inconsistent = true; break; }
			}
			motion[y * tile.halo.width + x] = inconsistent ? 1 : 0; if (budget.visit()) await budget.yield();
		}
		let motionPixels = 0, inconsistentPixels = 0, referenceClippedPixels = 0, unresolvedPixels = 0, fallbackChannels = 0;
		for (let y = 0; y < value.descriptor.height; y++) for (let x = 0; x < value.descriptor.width; x++) {
			const rx = tile.core.x + x, ry = tile.core.y + y, hx = rx - tile.halo.x, hy = ry - tile.halo.y;
			let moving = false;
			for (let dy = -HALO; dy <= HALO && !moving; dy++) for (let dx = -HALO; dx <= HALO; dx++) {
				const mx = hx + dx, my = hy + dy;
				if (mx >= 0 && my >= 0 && mx < tile.halo.width && my < tile.halo.height && motion[my * tile.halo.width + mx]) { moving = true; break; }
			}
			if (motion[hy * tile.halo.width + hx]) inconsistentPixels++;
			if (moving) motionPixels++;
			let clipped = false, comparable = false, unresolved = false;
			const at = (y * value.descriptor.width + x) * 4;
			for (let c = 0; c < 3; c++) {
				const reference = sample(tile.plan.referenceIndex, rx, ry, c)!;
				if (reference <= 0 || reference >= 1) clipped = true; else comparable = true;
				if (moving) { pixels[at + c] = Math.fround(reference / exposures[tile.plan.referenceIndex]!); if (reference <= 0 || reference >= 1) unresolved = true; }
				else {
					for (let input = 0; input < inputs.length; input++) samples[input] = sample(input, rx, ry, c)!;
					channel(samples, exposures, result); pixels[at + c] = Math.fround(result[0]!);
					if (result[1]) { fallbackChannels++; unresolved = true; }
				}
				if (!Number.isFinite(pixels[at + c])) throw new RangeError('HDR reconstruction exceeds finite Float32.');
			}
			pixels[at + 3] = 1; if (clipped) referenceClippedPixels++;
			if (unresolved || tile.plan.deghost.mode === 'reference-v1' && !comparable) unresolvedPixels++;
			if (budget.visit()) await budget.yield();
		}
		check();
		const diagnostics = Object.freeze({ motionPixels, inconsistentPixels, referenceClippedPixels, unresolvedPixels, fallbackChannels });
		const answer = await consume(Object.freeze({ frame: Object.freeze({ descriptor: value.descriptor, pixels }), diagnostics })); check(); return answer;
	});
}

function channel(samples: readonly number[] | Float64Array<ArrayBuffer>, exposures: readonly number[], result: Float64Array<ArrayBuffer>): void {
	let sum = 0, weights = 0, fallback = 0;
	for (let index = 0; index < samples.length; index++) {
		const z = samples[index]!, radiance = z / exposures[index]!, weight = Math.min(z, 1 - z);
		if (weight > 0) { sum += weight * radiance; weights += weight; }
		fallback = Math.max(fallback, radiance);
	}
	result[0] = weights > 0 ? sum / weights : fallback; result[1] = weights > 0 ? 0 : 1;
}
function finite(value: unknown, low: number, high: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) throw new RangeError('HDR scalar is outside its finite captured-profile range.'); return value;
}
function integer(value: unknown, low: number, high: number): number { const n = finite(value, low, high); if (!Number.isSafeInteger(n)) throw new RangeError('HDR tile requires integer bounds.'); return n; }
function decoded(value: number): number { return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }
