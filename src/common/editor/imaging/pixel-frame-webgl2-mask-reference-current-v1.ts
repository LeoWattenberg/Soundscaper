/* SPDX-License-Identifier: AGPL-3.0-only */

import { readPixelFrameWebGl2MaskCheckpointPlanCurrentV1 } from './pixel-frame-webgl2-mask-plan-current-v1.ts';
import { verifyPixelFrameWebGl2MaskCheckpointCurrentV1, verifyPixelFrameWebGl2MaskOverlayCurrentV1,
	type PixelFrameWebGl2MaskReceiptsCurrentV1 } from './pixel-frame-webgl2-mask-checkpoint-current-v1.ts';
import { blendLinearMaskCurrentV1 } from './image-develop-linear-mask-blend-current-v1.ts';
import { withLinearMaskCoverageV1 } from './pixel-frame-linear-mask-v1.ts';
import { withProjectedImageDevelopMaskCoverageCurrentV1 } from './image-develop-mask-overlay-current-v1.ts';
import { assertMaskRasterSourceScopeV1, type MaskRasterSourceScopeV1 } from './mask-raster-source-scope-v1.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import type { LinearDevelopOwnerV1 } from './image-develop-linear-owner-v1.ts';
import type { PreparedPixelFrameWebGl2PassCurrentV1 } from './pixel-frame-webgl2-pass-current-v1.ts';
import { writePixelFrameWebGl2PassChannelsCurrentV1 } from './pixel-frame-webgl2-pass-current-v1.ts';
import { writePixelFrameWebGl2GeometryCurrentV1 } from './pixel-frame-webgl2-geometry-current-v1.ts';
import { writePixelFrameWebGl2OpticsCurrentV1 } from './pixel-frame-webgl2-optics-current-v1.ts';
import { writePixelFrameWebGl2SpatialCurrentV1 } from './pixel-frame-webgl2-spatial-current-v1.ts';
import type { PixelFrameWebGl2LutResourcesCurrentV1 } from './pixel-frame-webgl2-lut-current-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { readImageDevelopGpuMaskPhasePlanCurrentV1 } from './image-develop-gpu-mask-phase-plan-current-v1.ts';
import { readPixelFrameWebGl2RepairCurrentV1 } from './pixel-frame-webgl2-repair-current-v1.ts';
import { replayPixelFrameWebGl2RepairPrefixCurrentV1 } from './pixel-frame-webgl2-repair-reference-current-v1.ts';

/** Runs inside the existing reference owner's owner.run(),
 * using its initial private A. It creates neither a new owner nor a third
 * Float32 plane. It does not authenticate resources or authorize GPU support. */
export async function replayPixelFrameWebGl2MaskReferenceCurrentV1(planValue: unknown,
	initial: Readonly<LinearWorkingPixelFrameV1>, owner: LinearDevelopOwnerV1,
	receipts: Readonly<PixelFrameWebGl2MaskReceiptsCurrentV1>, checkValue: () => void, resources?: Readonly<PixelFrameWebGl2LutResourcesCurrentV1>,
	maskScope?: Readonly<MaskRasterSourceScopeV1>, signalValue?: AbortSignal, repairPhaseValue?: unknown): Promise<Readonly<LinearWorkingPixelFrameV1>> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	const plan = readPixelFrameWebGl2MaskCheckpointPlanCurrentV1(planValue);
	if (typeof checkValue !== 'function') throw new TypeError('Mask reference requires its captured currentness check.');
	if (initial.descriptor !== plan.sourceDescriptor || initial.pixels.length !== plan.sourceDescriptor.width * plan.sourceDescriptor.height * 4) throw new RangeError('Mask reference lost its captured initial native frame.');
	const repairPhase = repairPhaseValue === undefined ? undefined : readImageDevelopGpuMaskPhasePlanCurrentV1(repairPhaseValue);
	if (plan.metadata.repairs && (!repairPhase || repairPhase.checkpointPlan !== planValue || repairPhase.repairPrefix === undefined)) throw new RangeError('Repair replay requires the complete private original-space phase.');
	const repairPrefix = repairPhase && readPixelFrameWebGl2RepairCurrentV1(repairPhase.repairPrefix);
	if (maskScope !== undefined) assertMaskRasterSourceScopeV1(maskScope, plan.metadata.masks.references);
	else if (plan.metadata.masks.references.length) throw new TypeError('Mask reference requires the complete authenticated brush scope.');
	const check = () => { checkRepairSignalV1(signal); checkValue(); }, budget = new RepairTaskBudgetV1(check);
	let current = initial, backing = initial.pixels.buffer;
	const rgb = { red: 0, green: 0, blue: 0 };
	async function pointwise(pass: PreparedPixelFrameWebGl2PassCurrentV1, target: Float32Array<ArrayBuffer>): Promise<void> {
		for (let offset = 0; offset < current.pixels.length; offset += 4) {
			writePixelFrameWebGl2PassChannelsCurrentV1(pass, current.pixels[offset]!, current.pixels[offset + 1]!, current.pixels[offset + 2]!, rgb, resources);
			const red = Math.fround(rgb.red), green = Math.fround(rgb.green), blue = Math.fround(rgb.blue);
			if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) throw new RangeError('Native GPU mask reference exceeds finite Float32 range.');
			target[offset] = red; target[offset + 1] = green; target[offset + 2] = blue; target[offset + 3] = current.pixels[offset + 3]!;
			if (budget.visit()) await budget.yield();
		}
	}
	try {
		if (repairPrefix) { current = await replayPixelFrameWebGl2RepairPrefixCurrentV1(repairPrefix, current, owner, check, signal); backing = current.pixels.buffer; }
		for (const slot of plan.slots) {
			check(); if (current.descriptor !== slot.incoming) throw new TypeError('Mask reference lost its exact authored incoming descriptor.');
			const pass = slot.pass, checkpoint = slot.checkpoint; let next: Float32Array<ArrayBuffer> | undefined;
			if (slot.candidateRequired) {
				if (!pass) throw new TypeError('Active mask reference slot has no genuine prepared pass.');
				if ('sourceDescriptor' in pass) {
					next = owner.floats(slot.output.width * slot.output.height * 4);
					if (pass.kind === 9) await writePixelFrameWebGl2GeometryCurrentV1(pass, current, next, signal);
					else if ('inputPolicy' in pass) await writePixelFrameWebGl2SpatialCurrentV1(pass, current, next, signal);
					else await writePixelFrameWebGl2OpticsCurrentV1(pass, current, next, signal);
				} else if (checkpoint?.mode === 'blend') {
					// Incoming A stays immutable through candidate AND coverage.
					next = owner.floats(current.pixels.length); await pointwise(pass, next);
				} else await pointwise(pass, current.pixels);
				check();
			}
			if (checkpoint && checkpoint.mode !== 'declared-only') {
				if ((checkpoint.mode === 'blend') !== (next !== undefined)) throw new TypeError('Mask checkpoint candidate activity differs from its private slot.');
				await withLinearMaskCoverageV1(checkpoint.binding, current, async coverage => {
					await verifyPixelFrameWebGl2MaskCheckpointCurrentV1(receipts, checkpoint, coverage); check();
					if (next) { await blendLinearMaskCurrentV1(current, next, coverage, checkpoint.blend, signal); check(); }
					if (checkpoint.selected) await withProjectedImageDevelopMaskCoverageCurrentV1(checkpoint.binding, coverage, async projected => {
						check(); await verifyPixelFrameWebGl2MaskOverlayCurrentV1(receipts, checkpoint, projected.coverage); check();
					}, plan.metadata.profile, signal);
				}, signal, maskScope); check();
			}
			if (next) {
				owner.retire(backing); backing = next.buffer;
				current = Object.freeze({ descriptor: slot.output, pixels: next });
			} else if (slot.output !== current.descriptor) throw new RangeError('Inactive/pointwise mask slot cannot change native extent.');
		}
		check(); if (current.descriptor !== plan.finalDescriptor) throw new TypeError('Mask reference did not reach its complete final descriptor.');
		return current;
	} finally { rgb.red = 0; rgb.green = 0; rgb.blue = 0; }
}
