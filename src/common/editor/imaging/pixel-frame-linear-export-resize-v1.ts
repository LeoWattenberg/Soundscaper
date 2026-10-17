/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { planImageExportSizeV1 } from './image-export-size-v1.ts';
import { writeImageGeometryPointV1 } from './image-geometry-plan-v1.ts';
import { captureLinearKernelDescriptorV1, writeLinearKernelPixelV1, type LinearKernelDescriptorV1 } from './linear-kernel-planes-v1.ts';
import { captureLinearOutputPlanesV1, linearOutputMappingV1, sampleLinearOutputV1 } from './linear-output-sampling-v1.ts';
import { planPixelFrameV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface PreparedLinearExportResizeV1 {
	readonly descriptor: LinearKernelDescriptorV1;
	readonly sampleCount: number;
	readonly byteLength: number;
}
interface State {
	readonly source: LinearKernelDescriptorV1;
	readonly quality: 'nearest' | 'bilinear';
	readonly mapping: ReturnType<typeof linearOutputMappingV1>;
}
const PLANS = new WeakMap<PreparedLinearExportResizeV1, Readonly<State>>();

/** Size and profile admission only. No source pixels or output allocation. */
export function prepareLinearExportResizeV1(sizing: unknown, quality: unknown, descriptorValue: unknown,
	limits: PixelFrameLimitsV1): Readonly<PreparedLinearExportResizeV1> {
	if (quality !== 'nearest' && quality !== 'bilinear') throw new RangeError('Unsupported linear export resize quality.');
	const source = captureLinearKernelDescriptorV1(descriptorValue);
	const rawLimits = record(limits, 'linear export resize limits', ['maximumSidePixels', 'maximumPixels', 'maximumBytes']);
	const capturedLimits = Object.freeze({ maximumSidePixels: field(rawLimits, 'maximumSidePixels', 'linear export resize limits'),
		maximumPixels: field(rawLimits, 'maximumPixels', 'linear export resize limits'), maximumBytes: field(rawLimits, 'maximumBytes', 'linear export resize limits') });
	const sizingPlan = planImageExportSizeV1(source, sizing, capturedLimits);
	const descriptor = captureLinearKernelDescriptorV1(sizingPlan.target), output = planPixelFrameV1(descriptor, capturedLimits);
	const prepared = Object.freeze({ descriptor, sampleCount: output.sampleCount, byteLength: output.byteLength });
	PLANS.set(prepared, Object.freeze({ source, quality, mapping: linearOutputMappingV1(source.width, source.height, descriptor.width, descriptor.height) }));
	return prepared;
}

/** Write the caller's separate, dedicated Float32 plane. Unchanged dimensions
 * are an exact copy, including transparent hidden RGB. Nearest keeps the
 * established top-left sample choice; bilinear uses centered-contain geometry
 * in premultiplied linear light. No image is quantized or clipped. */
export async function writeLinearExportResizeV1(plan: PreparedLinearExportResizeV1, sourceFrame: Readonly<LinearWorkingPixelFrameV1>,
	target: Float32Array<ArrayBuffer>, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue);
	let state: Readonly<State>, planes: ReturnType<typeof captureLinearOutputPlanesV1>;
	try {
		const admitted = PLANS.get(plan);
		if (!admitted) throw new TypeError('Linear export resize requires an authenticated owning plan.');
		state = admitted; planes = captureLinearOutputPlanesV1(sourceFrame, state.source, target, plan.descriptor);
	} catch (error) { checkRepairSignalV1(signal); throw error; }
	const check = () => { checkRepairSignalV1(signal); planes.check(); };
	const budget = new RepairTaskBudgetV1(check), point = { x: 0, y: 0 }, sample = { red: 0, green: 0, blue: 0, alpha: 0 };
	const output = plan.descriptor, source = state.source, sameSize = output.width === source.width && output.height === source.height;
	check();
	for (let pixel = 0; pixel < plan.sampleCount / 4; pixel++) {
		const offset = pixel * 4, x = pixel % output.width, y = Math.floor(pixel / output.width);
		if (sameSize || state.quality === 'nearest') {
			const input = sameSize ? offset : (Math.floor(y * source.height / output.height) * source.width + Math.floor(x * source.width / output.width)) * 4;
			writeLinearKernelPixelV1(planes.target, offset, planes.source[input]!, planes.source[input + 1]!, planes.source[input + 2]!, planes.source[input + 3]!);
		} else if (writeImageGeometryPointV1(state.mapping, x + .5, y + .5, point)) {
			sampleLinearOutputV1(planes.source, source.width, source.height, point.x - .5, point.y - .5, false, sample);
			const alpha = Math.fround(sample.alpha);
			if (alpha === 0) writeLinearKernelPixelV1(planes.target, offset, 0, 0, 0, 0);
			else writeLinearKernelPixelV1(planes.target, offset, sample.red, sample.green, sample.blue, alpha);
		} else writeLinearKernelPixelV1(planes.target, offset, 0, 0, 0, 0);
		if (budget.visit()) await budget.yield();
	}
	check();
}
