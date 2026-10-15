/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import type { PixelFrameDescriptorV1 } from './pixel-frame-contract-v1.ts';

export const IMAGE_HDR_INPUT_LIMITS_V1 = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 134_217_728 });
export const IMAGE_HDR_INPUT_PROFILES_V1 = Object.freeze([
	Object.freeze({ sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }),
	Object.freeze({ sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' }),
]);
export interface ImageHdrMergeInputV1 { readonly descriptor: Readonly<PixelFrameDescriptorV1>; readonly exposureMultiplier: number; }
export interface ImageHdrAlignmentV1 { readonly x: number; readonly y: number; readonly error: number; readonly support: number; }
export interface ImageHdrRectangleV1 { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export interface ImageHdrMergePlanV1 {
	readonly schemaVersion: 1;
	readonly referenceIndex: number;
	readonly alignment: 'none' | 'ward-mtb-v1';
	readonly deghost: Readonly<{ mode: 'off' | 'reference-v1'; threshold: number }>;
	readonly inputs: readonly Readonly<ImageHdrMergeInputV1>[];
	readonly width: number; readonly height: number;
	readonly maximumAlignmentWorkingBytes: number; readonly maximumTileWorkingBytes: number;
}
export interface ImageHdrAlignedMergePlanV1 extends ImageHdrMergePlanV1 {
	readonly offsets: readonly Readonly<ImageHdrAlignmentV1>[];
	readonly output: Readonly<ImageHdrRectangleV1>;
	readonly descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'float32'; primaries: 'srgb'; transfer: 'linear' }>;
}
const PLANS = new WeakSet<object>(), ALIGNED = new WeakSet<object>();

/** Metadata only: Originals and their exposure ratios are product-owned. No
 * creative Develop, RAW recovery normalization or pixel authority enters here. */
export function prepareImageHdrMergeV1(value: unknown): Readonly<ImageHdrMergePlanV1> {
	const input = record(value, 'HDR merge', ['schemaVersion', 'referenceIndex', 'alignment', 'deghost', 'inputs']);
	if (field(input, 'schemaVersion', 'HDR merge') !== 1) throw new RangeError('Unsupported HDR merge version.');
	const referenceIndex = integer(field(input, 'referenceIndex', 'HDR merge'), 0, 8, 'reference');
	const alignment = field(input, 'alignment', 'HDR merge');
	if (alignment !== 'none' && alignment !== 'ward-mtb-v1') throw new RangeError('Unsupported HDR alignment.');
	const ghost = record(field(input, 'deghost', 'HDR merge'), 'HDR deghost', ['mode', 'threshold']);
	const mode = field(ghost, 'mode', 'HDR deghost'), threshold = number(field(ghost, 'threshold', 'HDR deghost'), 0, 1, 'deghost threshold');
	if (mode !== 'off' && mode !== 'reference-v1') throw new RangeError('Unsupported HDR deghost mode.');
	const inputs = array(field(input, 'inputs', 'HDR merge'), 'HDR inputs', 2, 9).map(value => {
		const source = record(value, 'HDR input', ['descriptor', 'exposureMultiplier']);
		const descriptor = admitPixelFrameV1(field(source, 'descriptor', 'HDR input'), { profiles: IMAGE_HDR_INPUT_PROFILES_V1, limits: IMAGE_HDR_INPUT_LIMITS_V1 }).descriptor;
		const exposureMultiplier = number(field(source, 'exposureMultiplier', 'HDR input'), 1 / 65536, 65536, 'exposure multiplier');
		return Object.freeze({ descriptor, exposureMultiplier });
	});
	const first = inputs[0]!;
	if (referenceIndex >= inputs.length || inputs[referenceIndex]!.exposureMultiplier !== 1) throw new RangeError('HDR reference exposure must explicitly equal one.');
	if (inputs.some(source => source.descriptor.width !== first.descriptor.width || source.descriptor.height !== first.descriptor.height)) throw new RangeError('HDR canonical input extents must match.');
	const result: Readonly<ImageHdrMergePlanV1> = Object.freeze({ schemaVersion: 1, referenceIndex, alignment,
		deghost: Object.freeze({ mode, threshold }), inputs: Object.freeze(inputs), width: first.descriptor.width, height: first.descriptor.height,
		maximumAlignmentWorkingBytes: 96 * 1024 * 1024, maximumTileWorkingBytes: 16 * 1024 * 1024 });
	PLANS.add(result); return result;
}

/** Offsets place each candidate in reference coordinates. This admits bounded
 * recorded alignment metadata; it does not claim to have run registration.
 * Source sampling subtracts the placed offset from a reference coordinate. */
export function finalizeImageHdrMergeV1(value: Readonly<ImageHdrMergePlanV1>, offsetsValue: unknown): Readonly<ImageHdrAlignedMergePlanV1> {
	if (!PLANS.has(value)) throw new TypeError('HDR merge requires its owning prepared plan.');
	const offsets = array(offsetsValue, 'HDR offsets', value.inputs.length, value.inputs.length).map(candidate => {
		const input = record(candidate, 'HDR offset', ['x', 'y', 'error', 'support']);
		return Object.freeze({ x: integer(field(input, 'x', 'HDR offset'), -128, 128, 'horizontal offset'),
			y: integer(field(input, 'y', 'HDR offset'), -128, 128, 'vertical offset'),
			error: number(field(input, 'error', 'HDR offset'), 0, 1, 'alignment error'),
			support: integer(field(input, 'support', 'HDR offset'), 0, value.width * value.height, 'alignment support') });
	});
	const reference = offsets[value.referenceIndex]!;
	if (reference.x !== 0 || reference.y !== 0 || reference.error !== 0) throw new RangeError('HDR reference placement must remain zero.');
	if (value.alignment === 'none' && offsets.some(offset => offset.x !== 0 || offset.y !== 0)) throw new RangeError('Unaligned HDR inputs require zero offsets.');
	const x = Math.max(...offsets.map(offset => offset.x)), y = Math.max(...offsets.map(offset => offset.y));
	const right = Math.min(...offsets.map(offset => offset.x + value.width)), bottom = Math.min(...offsets.map(offset => offset.y + value.height));
	if (right <= x || bottom <= y) throw new RangeError('HDR placements have no common intersection.');
	const output = Object.freeze({ x, y, width: right - x, height: bottom - y });
	const descriptor = Object.freeze({ schemaVersion: 1 as const, width: output.width, height: output.height,
		sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const });
	const result: Readonly<ImageHdrAlignedMergePlanV1> = Object.freeze({ ...value, offsets: Object.freeze(offsets), output, descriptor });
	ALIGNED.add(result); return result;
}

/** Narrow identity check shared by the tile owner; copied plans grant no work. */
export function captureImageHdrAlignedMergeV1(value: unknown): Readonly<ImageHdrAlignedMergePlanV1> {
	if (!value || typeof value !== 'object' || !ALIGNED.has(value)) throw new TypeError('HDR tiles require an owning aligned merge plan.');
	return value as Readonly<ImageHdrAlignedMergePlanV1>;
}
function number(value: unknown, low: number, high: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) throw new RangeError(`HDR ${name} is outside its finite range.`);
	return value === 0 ? 0 : value;
}
function integer(value: unknown, low: number, high: number, name: string): number {
	const result = number(value, low, high, name); if (!Number.isSafeInteger(result)) throw new RangeError(`HDR ${name} requires an integer.`); return result;
}
