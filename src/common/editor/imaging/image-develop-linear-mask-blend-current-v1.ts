/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { blendLinearMaskCoverageV1 } from './pixel-frame-linear-mask-v1.ts';
import { checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

/** Internal Current policy, deliberately independent of GPU prepared owners. */
export type LinearMaskBlendPolicyCurrentV1 = Readonly<{ kind: 'generic' | 'unchanged-components' }>
	| Readonly<{ kind: 'ca-copy'; copyRed: boolean; copyBlue: boolean }>;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** Shared native CPU authority. Generic arithmetic remains the permanent
 * writer's arithmetic; this extraction adds no generic equality/alpha0 bypass.
 * The caller owns incoming/candidate and the exact admitted policy. */
export async function blendLinearMaskCurrentV1(source: Readonly<LinearWorkingPixelFrameV1>, target: Float32Array<ArrayBuffer>,
	coverage: Uint8Array<ArrayBuffer>, policy: LinearMaskBlendPolicyCurrentV1, signal?: AbortSignal): Promise<void> {
	if (policy.kind === 'unchanged-components') return blendUnchanged(source, target, coverage, signal);
	await blendLinearMaskCoverageV1(source, target, coverage, signal);
	if (policy.kind !== 'ca-copy') return;
	const check = () => { checkRepairSignalV1(signal); }, budget = new RepairTaskBudgetV1(check);
	for (let offset = 0; offset < target.length; offset += 4) {
		target[offset + 1] = source.pixels[offset + 1]!;
		if (policy.copyRed) target[offset] = source.pixels[offset]!;
		if (policy.copyBlue) target[offset + 2] = source.pixels[offset + 2]!;
		if (budget.visit()) await budget.yield();
	}
	check();
}

/** Exact extraction of Current's existing unchanged-component finisher. */
async function blendUnchanged(source: Readonly<LinearWorkingPixelFrameV1>, target: Float32Array<ArrayBuffer>,
	coverage: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<void> {
	if (target.length !== source.pixels.length || coverage.length * 4 !== target.length) throw new RangeError('Current unchanged-component mask geometry changed.');
	const backings = [source.pixels, target, coverage].map(view => {
		const buffer = Reflect.apply(BUFFER, view, []) as ArrayBuffer;
		return { buffer, length: Number(Reflect.apply(SIZE, buffer, [])) };
	});
	const check = () => {
		checkRepairSignalV1(signal);
		if (backings.some(({ buffer, length }) => length === 0 || Reflect.apply(SIZE, buffer, []) !== length)) {
			throw new TypeError('Current unchanged-component mask storage was detached or changed.');
		}
	};
	const budget = new RepairTaskBudgetV1(check); check();
	for (let offset = 0; offset < target.length; offset += 4) {
		const amount = coverage[offset / 4]!;
		for (let channel = 0; channel < 3; channel++) {
			const before = source.pixels[offset + channel]!, after = target[offset + channel]!;
			const value = before === after || amount === 0 ? before : amount === 255 ? after : Math.fround(before + amount / 255 * (after - before));
			if (!Number.isFinite(value)) throw new RangeError('Current unchanged-component mask exceeds finite Float32 range.');
			target[offset + channel] = value;
		}
		target[offset + 3] = source.pixels[offset + 3]!;
		if (budget.visit()) await budget.yield();
	}
	check();
}
