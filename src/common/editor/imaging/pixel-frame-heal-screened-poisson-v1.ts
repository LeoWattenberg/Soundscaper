/* SPDX-License-Identifier: AGPL-3.0-only */

import { IMAGE_DEVELOP_REPAIR_LIMITS_V1 } from './image-develop-repair-spots-v1.ts';
import type { ImageDevelopRepairSpotPlanV1 } from './image-develop-repair-plan-v1.ts';
import { RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { blendRepairSampleV1, decodeRepairByteV1, repairCoverageV1, sampleRepairDonorV1 } from './pixel-frame-repair-sampling-v1.ts';

const NEIGHBORS = Object.freeze([[-1, 0], [1, 0], [0, -1], [0, 1]] as const);

/** Profile 1: immutable donor guidance/context, lambda 1, exactly 64 Jacobi sweeps.
 * Scratch is serial: four RGB Float64 planes, alpha Float64, membership byte.
 * Its 105 bytes per halo cell plus bounded controls is preflighted by the plan.
 * This reconstructs texture against original boundary tone; it is not an
 * offset-only clone, content-aware synthesis, or a photographic-quality claim. */
export async function applyRepairHealV1(original: Uint8Array<ArrayBuffer>, output: Uint8Array<ArrayBuffer>,
	width: number, height: number, plan: ImageDevelopRepairSpotPlanV1, budget: RepairTaskBudgetV1): Promise<void> {
	const halo = plan.halo;
	if (halo === null) return;
	await withRepairPixelFrameLifetimeV1(async owner => {
		const count = halo.width * halo.height;
		const donor = owner.floats(3 * count), rhs = owner.floats(3 * count);
		let previous = owner.floats(3 * count), next = owner.floats(3 * count);
		const alpha = owner.floats(count), membership = owner.bytes(count);
		const sample = { red: 0, green: 0, blue: 0, alpha: 0 };
		let members = 0;
		budget.check();
		for (let cell = 0; cell < count; cell++) {
			const x = halo.x + cell % halo.width, y = halo.y + Math.floor(cell / halo.width), offset = (y * width + x) * 4;
			sampleRepairDonorV1(original, width, height, x + 0.5 + plan.sourceDelta.x, y + 0.5 + plan.sourceDelta.y, sample);
			donor[3 * cell] = sample.red; donor[3 * cell + 1] = sample.green; donor[3 * cell + 2] = sample.blue; alpha[cell] = sample.alpha;
			if (original[offset + 3] !== 0 && sample.alpha > 0
				&& Math.hypot(x + 0.5 - plan.target.x, y + 0.5 - plan.target.y) <= plan.radius) {
				membership[cell] = 1; members++;
			}
			if (budget.visit()) await budget.yield();
		}
		if (members === 0) return;
		let boundaryWeight = 0, targetRed = 0, targetGreen = 0, targetBlue = 0, donorRed = 0, donorGreen = 0, donorBlue = 0;
		for (let cell = 0; cell < count; cell++) {
			if (membership[cell] === 1) {
				const x = halo.x + cell % halo.width, y = halo.y + Math.floor(cell / halo.width);
				for (const [dx, dy] of NEIGHBORS) {
					const qx = x + dx, qy = y + dy, neighbor = cellAt(qx, qy);
					if (neighbor < 0 || membership[neighbor] === 1) continue;
					const offset = (qy * width + qx) * 4, weight = original[offset + 3]! / 255 * alpha[neighbor]!;
					if (weight === 0) continue;
					boundaryWeight += weight;
					targetRed += decodeRepairByteV1(original[offset]!) * weight;
					targetGreen += decodeRepairByteV1(original[offset + 1]!) * weight;
					targetBlue += decodeRepairByteV1(original[offset + 2]!) * weight;
					donorRed += donor[3 * neighbor]! * weight; donorGreen += donor[3 * neighbor + 1]! * weight; donorBlue += donor[3 * neighbor + 2]! * weight;
				}
			}
			if (budget.visit()) await budget.yield();
		}
		if (boundaryWeight === 0) throw new RangeError('Heal requires paired original boundary context; this profile cannot reconstruct the nonempty domain.');
		const deltaRed = (targetRed - donorRed) / boundaryWeight;
		const deltaGreen = (targetGreen - donorGreen) / boundaryWeight, deltaBlue = (targetBlue - donorBlue) / boundaryWeight;
		for (let cell = 0; cell < count; cell++) {
			if (membership[cell] === 1) {
				const x = halo.x + cell % halo.width, y = halo.y + Math.floor(cell / halo.width), offset = (y * width + x) * 4;
				const red = clamp(donor[3 * cell]! + deltaRed), green = clamp(donor[3 * cell + 1]! + deltaGreen), blue = clamp(donor[3 * cell + 2]! + deltaBlue);
				previous[3 * cell] = red; previous[3 * cell + 1] = green; previous[3 * cell + 2] = blue;
				let r = red + 4 * donor[3 * cell]!, g = green + 4 * donor[3 * cell + 1]!, b = blue + 4 * donor[3 * cell + 2]!;
				for (const [dx, dy] of NEIGHBORS) {
					const qx = x + dx, qy = y + dy, neighbor = cellAt(qx, qy);
					const availableDonor = neighbor >= 0 && alpha[neighbor]! > 0;
					r -= donor[3 * (availableDonor ? neighbor : cell)]!;
					g -= donor[3 * (availableDonor ? neighbor : cell) + 1]!; b -= donor[3 * (availableDonor ? neighbor : cell) + 2]!;
					if (neighbor >= 0 && membership[neighbor] === 1) continue;
					const qo = neighbor >= 0 ? (qy * width + qx) * 4 : offset;
					const boundary = original[qo + 3]! > 0 ? qo : offset;
					r += decodeRepairByteV1(original[boundary]!);
					g += decodeRepairByteV1(original[boundary + 1]!); b += decodeRepairByteV1(original[boundary + 2]!);
				}
				rhs[3 * cell] = r; rhs[3 * cell + 1] = g; rhs[3 * cell + 2] = b;
			}
			if (budget.visit()) await budget.yield();
		}
		for (let iteration = 0; iteration < IMAGE_DEVELOP_REPAIR_LIMITS_V1.healIterations; iteration++) {
			for (let cell = 0; cell < count; cell++) {
				if (membership[cell] === 1) {
					const x = halo.x + cell % halo.width, y = halo.y + Math.floor(cell / halo.width);
					let r = rhs[3 * cell]!, g = rhs[3 * cell + 1]!, b = rhs[3 * cell + 2]!;
					for (const [dx, dy] of NEIGHBORS) {
						const neighbor = cellAt(x + dx, y + dy);
						if (neighbor < 0 || membership[neighbor] !== 1) continue;
						r += previous[3 * neighbor]!; g += previous[3 * neighbor + 1]!; b += previous[3 * neighbor + 2]!;
					}
					next[3 * cell] = r / 5; next[3 * cell + 1] = g / 5; next[3 * cell + 2] = b / 5;
				}
				if (budget.visit()) await budget.yield();
			}
			const finished = previous; previous = next; next = finished;
		}
		for (let cell = 0; cell < count; cell++) {
			if (membership[cell] === 1) {
				const x = halo.x + cell % halo.width, y = halo.y + Math.floor(cell / halo.width);
				sample.red = previous[3 * cell]!; sample.green = previous[3 * cell + 1]!; sample.blue = previous[3 * cell + 2]!; sample.alpha = alpha[cell]!;
				blendRepairSampleV1(output, (y * width + x) * 4, sample, plan.spot.opacity * repairCoverageV1(plan, x + 0.5, y + 0.5));
			}
			if (budget.visit()) await budget.yield();
		}
		budget.check();

		function cellAt(x: number, y: number): number {
			return x < halo!.x || y < halo!.y || x >= halo!.x + halo!.width || y >= halo!.y + halo!.height
				? -1 : (y - halo!.y) * halo!.width + x - halo!.x;
		}
	});
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
