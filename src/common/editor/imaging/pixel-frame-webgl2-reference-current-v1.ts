/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { captureLinearKernelDescriptorV1, type LinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { LinearDevelopOwnerV1 } from './image-develop-linear-owner-v1.ts';
import { writePixelFrameWebGl2PassChannelsCurrentV1 } from './pixel-frame-webgl2-pass-current-v1.ts';
import { planPixelFrameWebGl2PipelineCurrentV1 } from './pixel-frame-webgl2-pipeline-current-v1.ts';
import { writePixelFrameWebGl2GeometryCurrentV1 } from './pixel-frame-webgl2-geometry-current-v1.ts';
import { writePixelFrameWebGl2OpticsCurrentV1 } from './pixel-frame-webgl2-optics-current-v1.ts';
import { writePixelFrameWebGl2SpatialCurrentV1 } from './pixel-frame-webgl2-spatial-current-v1.ts';
import type { PixelFrameWebGl2LutResourcesCurrentV1 } from './pixel-frame-webgl2-lut-current-v1.ts';
import { pixelFrameWebGl2ComponentEquivalentCurrentV1 } from './pixel-frame-webgl2-numeric-current-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

const NativeFloat = Float32Array, NativeBytes = Uint8Array;
const TYPED = Object.getPrototypeOf(NativeFloat.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = NativeFloat.prototype.set;

function same(a: LinearKernelDescriptorV1, b: LinearKernelDescriptorV1): boolean {
	return a.width === b.width && a.height === b.height && a.primaries === b.primaries;
}
function descriptor(value: unknown): LinearKernelDescriptorV1 {
	if (typeof value !== 'object' || value === null) throw new TypeError('Native GPU reference requires a frame.');
	return captureLinearKernelDescriptorV1(field(value as Readonly<Record<string, unknown>>, 'descriptor', 'native GPU reference frame'));
}

/** Complete private identities and the entire dimension chain precede both
 * pixel properties. A LUT capability authenticates its enrollment here, while
 * its exact Double table remains the authority during pointwise execution. */
function metadata(sourceValue: unknown, resultValue: unknown, values: unknown,
	resources: Readonly<PixelFrameWebGl2LutResourcesCurrentV1> | undefined) {
	const source = descriptor(sourceValue), result = descriptor(resultValue);
	const pipeline = planPixelFrameWebGl2PipelineCurrentV1(source, values), passes = pipeline.passes;
	for (const pass of passes) if (pass.kind === 8) {
		if (!resources) throw new TypeError('Native GPU reference LUT requires authenticated resources.');
		resources.supported(pass);
	}
	if (!same(pipeline.finalDescriptor, result)) throw new RangeError('Native GPU reference output descriptor differs from its complete stage chain.');
	// Track only a conservative same-pixel witness, not neighborhood provenance.
	// Vignette never restores eligibility lost to resampling. Coupled color
	// operations and active Defringe propagate it to every output channel.
	const ancestry: [boolean, boolean, boolean] = [true, true, true];
	for (const pass of passes) {
		if ('inputPolicy' in pass) {
			if (pass.inputPolicy === 'neighborhood' || pass.inputPolicy === 'pointwise-coupled' && ancestry.some(value => !value)) ancestry.fill(false);
			continue;
		}
		if (pass.kind === 9 && !pass.integerPermutation || pass.kind === 10 && pass.params1[3] !== 0 && pass.params1[0] !== 0) ancestry.fill(false);
		else if (pass.kind === 11 && pass.params1[3] !== 0) {
			if (pass.params1[0] !== 0) ancestry[0] = false;
			if (pass.params1[1] !== 0) ancestry[2] = false;
		} else if ((pass.kind === 3 || pass.kind === 4 || pass.kind === 5 || pass.kind === 8
			|| pass.kind === 12 && pass.params1[3] !== 0 && pass.params1[0] !== 0) && ancestry.some(value => !value)) ancestry.fill(false);
	}
	return Object.freeze({ source, result, passes, maximumBytes: pipeline.maximumFrameBytes,
		integerAncestry: passes.every(pass => pass.kind !== 9 || pass.integerPermutation),
		ancestry: Object.freeze(ancestry), hasAncestry: ancestry.some(value => value),
		exactPermutation: passes.every(pass => pass.kind === 9 && pass.integerPermutation) });
}

/** Pin borrowed allocation geometry independently from later caller shadows.
 * Full physical backings belong to the outer GPU phase ledger; this owner only
 * allocates its separately admitted maximum of two native oracle planes. */
function borrow(value: unknown, ownedDescriptor: LinearKernelDescriptorV1) {
	const input = record(value, 'native GPU reference frame', ['descriptor', 'pixels']);
	const original = field(input, 'pixels', 'native GPU reference frame');
	if (Reflect.apply(TAG, original, []) !== 'Float32Array' || Object.getPrototypeOf(original) !== NativeFloat.prototype) throw new TypeError('Native GPU reference requires an intrinsic Float32 plane.');
	for (const name of ['buffer', 'byteOffset', 'byteLength', 'length']) if (Object.hasOwn(original as object, name)) throw new TypeError('Native GPU reference plane cannot shadow native geometry.');
	const buffer = Reflect.apply(BUFFER, original, []) as ArrayBuffer;
	const offset = Number(Reflect.apply(OFFSET, original, [])), length = Number(Reflect.apply(LENGTH, original, []));
	const physical = Number(Reflect.apply(SIZE, buffer, []));
	if (Reflect.apply(RESIZABLE, buffer, []) !== false || length !== ownedDescriptor.width * ownedDescriptor.height * 16
		|| offset + length > physical) throw new RangeError('Native GPU reference requires fixed contiguous descriptor-bound samples.');
	const pixels = new NativeFloat(buffer, offset, length / 4);
	const check = () => {
		if (Reflect.apply(SIZE, buffer, []) !== physical || Reflect.apply(BUFFER, original, []) !== buffer
			|| Reflect.apply(OFFSET, original, []) !== offset || Reflect.apply(LENGTH, original, []) !== length) {
			throw new TypeError('Native GPU reference borrowed plane detached or changed.');
		}
		void new NativeBytes(buffer, 0, 0);
	};
	check(); return Object.freeze({ pixels, check });
}

/** Re-evaluate complete normative planes, never GPU intermediates or rounded
 * upload tables. Every authored effect stores Float32 before the next stage.
 * Replaced private planes retire immediately; all remaining storage is wiped
 * before returning either numerical outcome or an operation/cleanup failure. */
export async function validatePixelFrameWebGl2ReferenceCurrentV1(sourceValue: Readonly<LinearWorkingPixelFrameV1>,
	resultValue: Readonly<LinearWorkingPixelFrameV1>, values: readonly unknown[], checkValue: () => void,
	resources?: Readonly<PixelFrameWebGl2LutResourcesCurrentV1>, signalValue?: AbortSignal): Promise<boolean> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	if (typeof checkValue !== 'function') throw new TypeError('Native GPU reference requires a currentness check.');
	checkValue();
	const plan = metadata(sourceValue, resultValue, values, resources);
	const source = borrow(sourceValue, plan.source), result = borrow(resultValue, plan.result);
	const check = () => { checkRepairSignalV1(signal); checkValue(); source.check(); result.check(); };
	check();
	const validationBudget = new RepairTaskBudgetV1(check);
	for (let index = 0; index < source.pixels.length; index++) {
		const sample = source.pixels[index]!;
		if (!Number.isFinite(sample) || index % 4 === 3 && (sample < 0 || sample > 1)) throw new RangeError('Native GPU reference source requires finite RGB and unit alpha.');
		if (validationBudget.visit()) await validationBudget.yield();
	}
	const owner = new LinearDevelopOwnerV1(0, plan.maximumBytes * 2), rgb = { red: 0, green: 0, blue: 0 };
	try {
		const matched = await owner.run(async () => {
			const initial = owner.floats(plan.source.width * plan.source.height * 4), budget = new RepairTaskBudgetV1(check);
			Reflect.apply(SET, initial, [source.pixels]);
			let current: Readonly<LinearWorkingPixelFrameV1> = Object.freeze({ descriptor: plan.source, pixels: initial }), backing = initial.buffer;
			check();
			for (const pass of plan.passes) {
				check();
				if ('sourceDescriptor' in pass) {
					const next = owner.floats(pass.descriptor.width * pass.descriptor.height * 4);
					check();
					if (pass.kind === 9) await writePixelFrameWebGl2GeometryCurrentV1(pass, current, next, signal);
					else if ('inputPolicy' in pass) await writePixelFrameWebGl2SpatialCurrentV1(pass, current, next, signal);
					else await writePixelFrameWebGl2OpticsCurrentV1(pass, current, next, signal);
					check();
					owner.retire(backing); backing = next.buffer;
					current = Object.freeze({ descriptor: pass.descriptor, pixels: next });
				} else for (let offset = 0; offset < current.pixels.length; offset += 4) {
					writePixelFrameWebGl2PassChannelsCurrentV1(pass, current.pixels[offset]!, current.pixels[offset + 1]!, current.pixels[offset + 2]!, rgb, resources);
					const red = Math.fround(rgb.red), green = Math.fround(rgb.green), blue = Math.fround(rgb.blue);
					if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) throw new RangeError('Native GPU reference exceeds finite Float32 range.');
					current.pixels[offset] = red; current.pixels[offset + 1] = green; current.pixels[offset + 2] = blue;
					if (budget.visit()) await budget.yield();
				}
			}
			for (let offset = 0; offset < current.pixels.length; offset += 4) {
				if (budget.visit()) await budget.yield();
				if (!Object.is(current.pixels[offset + 3], result.pixels[offset + 3])) return false;
				const pixel = offset / 4; let x = pixel % plan.result.width, y = Math.floor(pixel / plan.result.width), original: number | undefined;
				if (plan.integerAncestry && plan.hasAncestry) {
					// Reverse the captured integer maps without a provenance plane.
					// Count stage visits too, so long chains retain bounded yields.
					for (let index = plan.passes.length - 1; index >= 0; index--) {
						if (budget.visit()) await budget.yield();
						const pass = plan.passes[index]!; if (pass.kind !== 9) continue;
						const inverse = pass.integerTransform;
						if (!inverse) throw new TypeError('Native GPU reference lost its integer geometry authority.');
						const nextX = inverse[0] * x + inverse[1] * y + inverse[2];
						y = inverse[3] * x + inverse[4] * y + inverse[5]; x = nextX;
					}
					if (Number.isSafeInteger(x) && Number.isSafeInteger(y) && x >= 0 && x < plan.source.width && y >= 0 && y < plan.source.height) original = (y * plan.source.width + x) * 4;
				}
				for (let channel = 0; channel < 3; channel++) {
					const expected = current.pixels[offset + channel]!, actual = result.pixels[offset + channel]!;
					if (plan.exactPermutation ? !Object.is(expected, actual) : !pixelFrameWebGl2ComponentEquivalentCurrentV1(expected, actual,
						original === undefined || !plan.ancestry[channel] ? undefined : source.pixels[original + channel])) return false;
				}
			}
			check(); return true;
		});
		check(); return matched;
	} finally { rgb.red = 0; rgb.green = 0; rgb.blue = 0; }
}
