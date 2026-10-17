/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { prepareDefringeEffectV1 } from '../video-defringe-v1.ts';
import { writeImageDefringeKernelPixelV1, type ImageDefringeKernelPixelV1 } from './image-defringe-kernel-v1.ts';
import { captureLinearKernelDescriptorV1, captureLinearKernelPlanesV1, linearKernelEncodedV1, linearKernelDecodedV1, writeLinearKernelPixelV1, type LinearKernelDescriptorV1 } from './linear-kernel-planes-v1.ts';
import { planPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface PreparedLinearDefringeV1 {
	readonly descriptor: LinearKernelDescriptorV1;
	readonly sampleCount: number; readonly byteLength: number;
	readonly scratchBytes: 0; readonly neutral: boolean;
}
const PLANS = new WeakMap<PreparedLinearDefringeV1, Readonly<{ descriptor: LinearKernelDescriptorV1; effect: ReturnType<typeof prepareDefringeEffectV1> }>>();

export function prepareLinearDefringeV1(effectValue: unknown, descriptorValue: PixelFrameDescriptorV1,
	limits: PixelFrameLimitsV1): Readonly<PreparedLinearDefringeV1> {
	const descriptor = captureLinearKernelDescriptorV1(descriptorValue), output = planPixelFrameV1(descriptor, limits);
	const effect = prepareDefringeEffectV1(effectValue);
	const plan = Object.freeze({ descriptor, sampleCount: output.sampleCount, byteLength: output.byteLength, scratchBytes: 0 as const, neutral: !effect.enabled || effect.neutral });
	PLANS.set(plan, Object.freeze({ descriptor, effect })); return plan;
}

/** Dedicated immutable input and caller-owned output, scratch0. Encoded
 * neighborhood classification stays continuous; only changed components
 * decode and round once into Float32, without gamut clipping. */
export async function writeLinearDefringeV1(plan: PreparedLinearDefringeV1, sourceValue: unknown,
	target: Float32Array<ArrayBuffer>, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue);
	let state: NonNullable<ReturnType<typeof PLANS.get>>, planes: ReturnType<typeof captureLinearKernelPlanesV1>;
	try {
		const admitted = PLANS.get(plan);
		if (!admitted) throw new TypeError('Linear Defringe requires its original prepared plan.');
		state = admitted;
		if (typeof sourceValue !== 'object' || sourceValue === null) throw new TypeError('Linear Defringe requires a source frame.');
		const descriptor = captureLinearKernelDescriptorV1(field(sourceValue as Readonly<Record<string, unknown>>, 'descriptor', 'linear Defringe source'));
		if (descriptor.width !== state.descriptor.width || descriptor.height !== state.descriptor.height || descriptor.primaries !== state.descriptor.primaries) {
			throw new RangeError('Linear Defringe source differs from its prepared descriptor.');
		}
		const source = record(sourceValue, 'linear Defringe source', ['descriptor', 'pixels']);
		planes = captureLinearKernelPlanesV1(state.descriptor, field(source, 'pixels', 'linear Defringe source'), target);
	} catch (error) { checkRepairSignalV1(signal); throw error; }
	const check = () => { checkRepairSignalV1(signal); planes.check(); }; check();
	if (plan.neutral) { Float32Array.prototype.set.call(planes.target, planes.source); check(); return; }
	const { width, height } = state.descriptor, budget = new RepairTaskBudgetV1(check);
	const output: ImageDefringeKernelPixelV1 = { red: 0, green: 0, blue: 0, redChanged: false, greenChanged: false, blueChanged: false };
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const index = (y * width + x) * 4;
		let red = planes.source[index]!, green = planes.source[index + 1]!, blue = planes.source[index + 2]!;
		if (planes.source[index + 3] !== 0) {
			writeImageDefringeKernelPixelV1(state.effect, planes.source, width, height, x, y, linearKernelEncodedV1, output);
			if (output.redChanged) red = linearKernelDecodedV1(output.red);
			if (output.greenChanged) green = linearKernelDecodedV1(output.green);
			if (output.blueChanged) blue = linearKernelDecodedV1(output.blue);
		}
		writeLinearKernelPixelV1(planes.target, index, red, green, blue, planes.source[index + 3]!);
		if (budget.visit()) await budget.yield();
	}
	check();
}
