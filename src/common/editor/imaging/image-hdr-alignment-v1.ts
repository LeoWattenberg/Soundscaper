/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { IMAGE_HDR_INPUT_LIMITS_V1, IMAGE_HDR_INPUT_PROFILES_V1, type ImageHdrAlignmentV1 } from './image-hdr-merge-contract-v1.ts';
import { LinearDevelopOwnerV1 } from './image-develop-linear-owner-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface ImageHdrAlignmentGuideV1 { readonly width: number; readonly height: number; readonly pixels: Uint8Array<ArrayBuffer>; }
const NativeBytes = Uint8Array, TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!, SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
const GUIDE_MAXIMUM = 192 * 1024 * 1024, ALIGNMENT_MAXIMUM = 96 * 1024 * 1024, RESERVE = 65536;

/** This disposable luma8 guide is registration data, never reconstructed RGB.
 * Capture its complete source synchronously before the first task yield. */
export async function withImageHdrAlignmentGuideV1<Result>(value: unknown,
	consume: (guide: Readonly<ImageHdrAlignmentGuideV1>) => Result | Promise<Result>, signalValue?: AbortSignal): Promise<Result> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	if (typeof consume !== 'function') throw new TypeError('HDR guide requires a scoped consumer.');
	const input = record(value, 'HDR guide frame', ['descriptor', 'pixels']);
	const plan = admitPixelFrameV1(field(input, 'descriptor', 'HDR guide frame'), { profiles: IMAGE_HDR_INPUT_PROFILES_V1, limits: IMAGE_HDR_INPUT_LIMITS_V1 });
	const frame = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(input, 'pixels', 'HDR guide frame') }, IMAGE_HDR_INPUT_LIMITS_V1);
	const backing = Reflect.apply(BUFFER, frame.pixels, []) as ArrayBuffer, size = Reflect.apply(SIZE, backing, []) as number;
	if (size + plan.pixelCount + RESERVE > GUIDE_MAXIMUM) throw new RangeError('HDR guide physical working budget is exceeded.');
	const current = () => { checkRepairSignalV1(signal); if (Reflect.apply(SIZE, backing, []) !== size) throw new TypeError('HDR guide source detached.'); };
	const owner = new LinearDevelopOwnerV1(size + RESERVE, GUIDE_MAXIMUM);
	return owner.run(async () => {
		const pixels = owner.bytes(plan.pixelCount), word = plan.descriptor.sampleFormat === 'unorm16', maximum = word ? 65535 : 255;
		const offset = Reflect.apply(OFFSET, frame.pixels, []) as number;
		const source = word ? new Uint16Array(backing, offset, plan.sampleCount) : new NativeBytes(backing, offset, plan.sampleCount);
		for (let index = 0; index < plan.pixelCount; index++) {
			const at = index * 4;
			if (source[at + 3] !== maximum) throw new RangeError('HDR requires opaque canonical Originals.');
			const r = source[at]! / maximum, g = source[at + 1]! / maximum, b = source[at + 2]! / maximum;
			const luma = (54 * (word ? r : decoded(r)) + 183 * (word ? g : decoded(g)) + 19 * (word ? b : decoded(b))) / 256;
			pixels[index] = Math.round(255 * (luma <= .0031308 ? 12.92 * luma : 1.055 * luma ** (1 / 2.4) - .055));
		}
		current(); await task(); current();
		const result = await consume(Object.freeze({ width: plan.descriptor.width, height: plan.descriptor.height, pixels })); current(); return result;
	});
}

/** Ward median-threshold/exclusion pyramids, with candidate placement offsets.
 * A two-candidate beam retains an alternative through coarse-level ties. Each
 * level scores actual supported pixels; flat/ambiguous results never become0. */
export async function alignImageHdrGuidesV1(referenceValue: unknown, candidateValue: unknown,
	optionsValue: Readonly<{ maximumShiftPixels?: number; signal?: AbortSignal }> = {}): Promise<Readonly<ImageHdrAlignmentV1>> {
	const ownSignal = typeof optionsValue === 'object' && optionsValue !== null ? Object.getOwnPropertyDescriptor(optionsValue, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('HDR alignment cancellation requires own data.');
	const signal = captureRepairSignalV1(ownSignal?.value); checkRepairSignalV1(signal);
	const options = record(optionsValue, 'HDR alignment options', ['maximumShiftPixels', 'signal'], []);
	if ((Object.hasOwn(options, 'signal') ? field(options, 'signal', 'HDR alignment options') : undefined) !== signal) throw new TypeError('HDR alignment cancellation changed during admission.');
	const maximumShift = Object.hasOwn(options, 'maximumShiftPixels') ? field(options, 'maximumShiftPixels', 'HDR alignment options') : 128;
	if (typeof maximumShift !== 'number' || !Number.isSafeInteger(maximumShift) || maximumShift < 0 || maximumShift > 128) throw new RangeError('HDR translation is bounded to128 integer pixels.');
	const reference = captureGuide(referenceValue), candidate = captureGuide(candidateValue);
	if (reference.width !== candidate.width || reference.height !== candidate.height) throw new RangeError('HDR guides must have matching extents.');
	const sizes = [{ width: reference.width, height: reference.height }];
	while (sizes.length < 8) {
		const previous = sizes[sizes.length - 1]!, width = Math.ceil(previous.width / 2), height = Math.ceil(previous.height / 2);
		if (Math.min(width, height) < 24 || 2 ** sizes.length > Math.max(1, maximumShift)) break;
		sizes.push({ width, height });
	}
	const physical = reference.backing === candidate.backing ? reference.size : reference.size + candidate.size;
	const working = sizes.reduce((sum, size) => sum + size.width * size.height * 2, 0);
	if (physical + working + RESERVE > ALIGNMENT_MAXIMUM) throw new RangeError('HDR registration physical working budget is exceeded.');
	const check = () => { checkRepairSignalV1(signal); reference.check(); candidate.check(); };
	const owner = new LinearDevelopOwnerV1(physical + RESERVE, ALIGNMENT_MAXIMUM);
	return owner.run(async () => {
		// Both complete guides are privately captured before any yield.
		const ref = owner.bytes(reference.width * reference.height), other = owner.bytes(candidate.width * candidate.height);
		ref.set(reference.pixels); other.set(candidate.pixels); check();
		const budget = new RepairTaskBudgetV1(check), a = [ref], b = [other];
		for (let level = 1; level < sizes.length; level++) {
			a.push(await downsample(a[level - 1]!, sizes[level - 1]!, sizes[level]!, owner, budget));
			b.push(await downsample(b[level - 1]!, sizes[level - 1]!, sizes[level]!, owner, budget));
		}
		let beam: Score[] = [];
		for (let level = sizes.length - 1; level >= 0; level--) {
			const size = sizes[level]!, bound = Math.ceil(maximumShift / 2 ** level), positions = new Map<string, { x: number; y: number }>();
			if (!beam.length) {
				const bx = Math.min(bound, size.width - 1), by = Math.min(bound, size.height - 1);
				for (let y = -by; y <= by; y++) for (let x = -bx; x <= bx; x++) positions.set(`${x},${y}`, { x, y });
			}
			else for (const previous of beam) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
				const x = previous.x * 2 + dx, y = previous.y * 2 + dy;
				if (Math.abs(x) <= bound && Math.abs(y) <= bound) positions.set(`${x},${y}`, { x, y });
			}
			const medianA = median(a[level]!), medianB = median(b[level]!), scored: Score[] = [];
			for (const position of positions.values()) {
				const result = await score(a[level]!, b[level]!, size, position.x, position.y, medianA, medianB, budget);
				if (result) scored.push(result);
			}
			scored.sort(compare);
			if (!scored.length) throw new RangeError('HDR registration lacks supported texture.');
			beam = scored.slice(0, 2);
		}
		check(); const best = beam[0]!, alternative = beam[1];
		if (best.error > .35 || alternative && alternative.error - best.error < .01) throw new RangeError('HDR registration is ambiguous or lacks confidence.');
		return Object.freeze({ x: best.x, y: best.y, error: best.error, support: best.support });
	});
}

type Size = Readonly<{ width: number; height: number }>;
type Score = ImageHdrAlignmentV1;
async function downsample(source: Uint8Array<ArrayBuffer>, before: Size, size: Size, owner: LinearDevelopOwnerV1, budget: RepairTaskBudgetV1) {
	const target = owner.bytes(size.width * size.height);
	for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
		let sum = 0, count = 0;
		for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
			const sx = x * 2 + dx, sy = y * 2 + dy; if (sx < before.width && sy < before.height) { sum += source[sy * before.width + sx]!; count++; }
		}
		target[y * size.width + x] = Math.round(sum / count); if (budget.visit()) await budget.yield();
	}
	return target;
}
function median(pixels: Uint8Array<ArrayBuffer>): number {
	const histogram = new Uint32Array(256); for (const value of pixels) histogram[value] = histogram[value]! + 1;
	let sum = 0, result = 255;
	for (let index = 0; index < 256; index++) { sum += histogram[index]!; if (sum >= pixels.length / 2) { result = index; break; } }
	histogram.fill(0); return result;
}
async function score(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>, size: Size, dx: number, dy: number, ma: number, mb: number, budget: RepairTaskBudgetV1): Promise<Score | undefined> {
	const left = Math.max(0, dx), top = Math.max(0, dy), right = Math.min(size.width, size.width + dx), bottom = Math.min(size.height, size.height + dy);
	const full = size.width * size.height;
	// A small matching border must not outvote an unrelated image. Both the
	// geometric overlap and exclusion support use the complete guide extent.
	if ((right - left) * (bottom - top) < full * .5) return undefined;
	let support = 0, mismatch = 0;
	for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
		const av = a[y * size.width + x]!, bv = b[(y - dy) * size.width + x - dx]!;
		if (Math.abs(av - ma) > 4 && Math.abs(bv - mb) > 4) { support++; if ((av > ma) !== (bv > mb)) mismatch++; }
		if (budget.visit()) await budget.yield();
	}
	if (support < Math.max(32, full * .05)) return undefined;
	return { x: dx, y: dy, error: mismatch / support, support };
}
function compare(a: Score, b: Score): number { return a.error - b.error || Math.abs(a.x) + Math.abs(a.y) - Math.abs(b.x) - Math.abs(b.y) || a.y - b.y || a.x - b.x; }

function captureGuide(value: unknown) {
	const input = record(value, 'HDR alignment guide', ['width', 'height', 'pixels']);
	const width = field(input, 'width', 'HDR alignment guide'), height = field(input, 'height', 'HDR alignment guide');
	if (typeof width !== 'number' || typeof height !== 'number' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
		|| width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16_777_216) throw new RangeError('HDR guide extent is outside its bounds.');
	const pixels = field(input, 'pixels', 'HDR alignment guide');
	if (!(pixels instanceof NativeBytes) || Object.getPrototypeOf(pixels) !== NativeBytes.prototype) throw new TypeError('HDR guide requires native byte data.');
	if (['buffer', 'byteOffset', 'byteLength', 'length'].some(name => Object.hasOwn(pixels, name))) throw new TypeError('HDR guide cannot shadow intrinsic geometry.');
	const backing = Reflect.apply(BUFFER, pixels, []) as ArrayBuffer, size = Reflect.apply(SIZE, backing, []) as number;
	if (!(backing instanceof ArrayBuffer) || RESIZABLE && Reflect.apply(RESIZABLE, backing, []) || Reflect.apply(LENGTH, pixels, []) !== width * height) throw new TypeError('HDR guide requires fixed exact byte geometry.');
	const captured = new NativeBytes(backing, Reflect.apply(OFFSET, pixels, []) as number, width * height);
	return { width, height, backing, size, pixels: captured, check() { if (Reflect.apply(SIZE, backing, []) !== size) throw new TypeError('HDR guide backing detached.'); } };
}
function decoded(value: number): number { return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }
function task(): Promise<void> { return new Promise(resolve => { setTimeout(resolve, 0); }); }
