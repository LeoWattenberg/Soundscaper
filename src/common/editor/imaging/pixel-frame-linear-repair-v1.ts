/* SPDX-License-Identifier: AGPL-3.0-only */

import { planPixelFrameV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { planImageDevelopRepairSpotsV1, type ImageDevelopRepairPlanV1 } from './image-develop-repair-plan-v1.ts';
import { captureLinearKernelDescriptorV1, captureLinearKernelPlanesV1, captureLinearKernelScratchV1,
	type LinearKernelDescriptorV1 } from './linear-kernel-planes-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { repairCoverageV1 } from './pixel-frame-repair-sampling-v1.ts';
import { writeLinearRepairHealV1 } from './pixel-frame-linear-heal-v1.ts';
import { blendLinearRepairSampleV1, sampleLinearRepairDonorV1 } from './pixel-frame-linear-repair-sampling-v1.ts';

export interface PreparedLinearRepairsV1 {
	readonly descriptor: LinearKernelDescriptorV1;
	readonly scratchBytes: number;
	readonly frameBytes: number;
}
const PREPARED = new WeakMap<object, Readonly<ImageDevelopRepairPlanV1>>();
const SET = Float32Array.prototype.set;

/** Scalar admission only. Existing spot geometry, serial Clone/Heal work and
 * halo ceilings remain exact; the outer owner charges the actual Float32
 * original/output planes plus this reported serial scratch allocation. */
export function prepareLinearRepairsV1(value: unknown, descriptorValue: unknown,
	limits: PixelFrameLimitsV1): Readonly<PreparedLinearRepairsV1> {
	const descriptor = captureLinearKernelDescriptorV1(descriptorValue);
	const frame = planPixelFrameV1(descriptor, limits);
	const repairs = planImageDevelopRepairSpotsV1(value, descriptor.width, descriptor.height);
	const prepared = Object.freeze({ descriptor, scratchBytes: repairs.maximumScratchBytes, frameBytes: frame.byteLength });
	PREPARED.set(prepared, repairs); return prepared;
}

/** Caller-owned source, output and exact scratch. Start with a complete native
 * copy, then blend only destination RGB in authored order. Every donor and
 * Heal boundary always reads the unchanged original source. The enclosing
 * owner joins cancellation and physically retires all supplied planes. */
export async function writeLinearRepairsV1(prepared: PreparedLinearRepairsV1, sourceValue: unknown, targetValue: unknown,
	scratchValue: unknown, signalValue?: AbortSignal): Promise<void> {
	const plan = PREPARED.get(prepared);
	if (!plan) throw new TypeError('Linear repairs require an owning prepared plan.');
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	const planes = captureLinearKernelPlanesV1(prepared.descriptor, sourceValue, targetValue);
	const scratch = captureLinearKernelScratchV1(scratchValue, prepared.scratchBytes, [planes.source.buffer, planes.target.buffer]);
	const check = () => { checkRepairSignalV1(signal); planes.check(); scratch.check(); };
	const budget = new RepairTaskBudgetV1(check), sample = { red: 0, green: 0, blue: 0, alpha: 0 };
	check(); Reflect.apply(SET, planes.target, [planes.source]);
	for (const spot of plan.spots) {
		check();
		if (!spot.spot.enabled || spot.spot.opacity === 0 || !spot.rectangle.width || !spot.rectangle.height) continue;
		if (spot.spot.mode === 'heal') {
			await writeLinearRepairHealV1(planes.source, planes.target, plan.width, plan.height, spot, scratch.bytes, budget); continue;
		}
		const rectangle = spot.rectangle;
		for (let y = rectangle.y; y < rectangle.y + rectangle.height; y++) for (let x = rectangle.x; x < rectangle.x + rectangle.width; x++) {
			const amount = spot.spot.opacity * repairCoverageV1(spot, x + 0.5, y + 0.5), offset = (y * plan.width + x) * 4;
			if (amount > 0 && planes.source[offset + 3] !== 0) {
				sampleLinearRepairDonorV1(planes.source, plan.width, plan.height, x + 0.5 + spot.sourceDelta.x, y + 0.5 + spot.sourceDelta.y, sample);
				blendLinearRepairSampleV1(planes.target, offset, sample, amount);
			}
			if (budget.visit()) await budget.yield();
		}
	}
	check();
}
