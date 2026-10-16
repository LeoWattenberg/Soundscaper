/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../closed-domain-value.ts';
import { captureLinearKernelDescriptorV1, LINEAR_KERNEL_LIMITS_V1, type LinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { planImageDevelopRepairSpotsV1, type ImageDevelopRepairSpotPlanV1 } from './image-develop-repair-plan-v1.ts';
import { prepareLinearRepairsV1, writeLinearRepairsV1 } from './pixel-frame-linear-repair-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface PreparedPixelFrameWebGl2RepairCurrentV1 {
	readonly descriptor: LinearKernelDescriptorV1;
	readonly spots: readonly Readonly<ImageDevelopRepairSpotPlanV1>[];
	readonly frameBytes: number;
	readonly scratchBytes: number;
	readonly gpuHaloBytes: number;
	readonly hasActive: boolean;
	readonly supported: boolean;
}
const OWNED = new WeakMap<object, Readonly<{ value: Readonly<PreparedPixelFrameWebGl2RepairCurrentV1>; cpu: ReturnType<typeof prepareLinearRepairsV1> }>>();
const MAXIMUM = 768 * 1024 * 1024;
export function preparePixelFrameWebGl2RepairCurrentV1(value: unknown, descriptorValue: unknown): Readonly<PreparedPixelFrameWebGl2RepairCurrentV1> {
	const descriptor = captureLinearKernelDescriptorV1(descriptorValue);
	const plan = planImageDevelopRepairSpotsV1(value, descriptor.width, descriptor.height);
	const cpu = prepareLinearRepairsV1(plan.repairs, descriptor, LINEAR_KERNEL_LIMITS_V1);
	let maximumHalo = 0, hasActive = false, supported = true;
	for (const spot of plan.spots) {
		if (!spot.spot.enabled || spot.spot.opacity === 0 || !spot.rectangle.width || !spot.rectangle.height) continue;
		hasActive = true;
		if (spot.halo) maximumHalo = Math.max(maximumHalo, spot.halo.width * spot.halo.height);
		for (const number of [spot.target.x, spot.target.y, spot.sourceDelta.x, spot.sourceDelta.y, spot.radius, spot.spot.feather, spot.spot.opacity]) {
			const rounded = Math.fround(number); if (!Number.isFinite(rounded) || number !== 0 && rounded === 0) supported = false;
		}
	}
	// Eight full-halo RGBA32F banks +one R8UI membership. Reduction viewports
	// shrink inside fixed allocations: no unjoined resize-backing assumptions.
	const prepared = Object.freeze({ descriptor, spots: plan.spots, frameBytes: cpu.frameBytes,
		scratchBytes: cpu.scratchBytes, gpuHaloBytes: maximumHalo * 129, hasActive, supported });
	OWNED.set(prepared, Object.freeze({ value: prepared, cpu })); return prepared;
}
export function isPixelFrameWebGl2RepairCurrentV1(value: unknown): value is Readonly<PreparedPixelFrameWebGl2RepairCurrentV1> {
	return typeof value === 'object' && value !== null && OWNED.has(value);
}
export function readPixelFrameWebGl2RepairCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2RepairCurrentV1> {
	if (!isPixelFrameWebGl2RepairCurrentV1(value)) throw new TypeError('GPU repair requires its owning prefix identity.');
	return OWNED.get(value)!.value;
}
/** Standalone diagnostic schedule only. Main-host integration must add actual
 * LUT/mask/display/source fees and reuse its existing capture/image banks. */
export function planPixelFrameWebGl2RepairWorkingCurrentV1(value: unknown, physicalSourceBytes?: number) {
	const plan = readPixelFrameWebGl2RepairCurrentV1(value), physical = physicalSourceBytes ?? plan.frameBytes;
	if (!Number.isSafeInteger(physical) || physical < plan.frameBytes) throw new RangeError('Repair physical source backing is invalid.');
	const controlBytes = 4096;
	const gpuBytes = physical + 5 * plan.frameBytes + plan.gpuHaloBytes + controlBytes;
	// Source capture +O/A/B +readback remain live during a separately owned,
	// unchanged two-plane Float64-scratch reference. Halo banks already retired.
	const referenceBytes = physical + 7 * plan.frameBytes + plan.scratchBytes + controlBytes;
	const peakBytes = Math.max(gpuBytes, referenceBytes);
	return Object.freeze({ physicalSourceBytes: physical, gpuBytes, referenceBytes, peakBytes, eligible: peakBytes <= MAXIMUM });
}
/** Normative writer only; this never creates GPU pixels or uploads patches. */
export async function writePixelFrameWebGl2RepairReferenceCurrentV1(value: unknown, source: Readonly<LinearWorkingPixelFrameV1>,
	target: Float32Array<ArrayBuffer>, scratch: Uint8Array<ArrayBuffer>, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	const plan = readPixelFrameWebGl2RepairCurrentV1(value), cpu = OWNED.get(plan)!.cpu;
	const input = record(source, 'GPU repair reference source', ['descriptor', 'pixels']), descriptor = captureLinearKernelDescriptorV1(field(input, 'descriptor', 'GPU repair reference source'));
	if (descriptor.width !== plan.descriptor.width || descriptor.height !== plan.descriptor.height
		|| descriptor.primaries !== plan.descriptor.primaries) throw new RangeError('Repair reference source descriptor changed.');
	await writeLinearRepairsV1(cpu, field(input, 'pixels', 'GPU repair reference source'), target, scratch, signal);
}
