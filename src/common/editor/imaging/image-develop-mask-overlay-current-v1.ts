/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopFrameProfile, ImageDevelopFramePixels } from './image-develop-frame-core.ts';
import type { ImageDevelopMaskBindingPlanV1 } from './image-develop-mask-plan-v1.ts';
import type { ImageDevelopMaskOverlayViewV1 } from './image-develop-mask-overlay-v1.ts';
import { imageDevelopMaskTransformsCurrentV1, assertImageDevelopMaskOverlayBudgetCurrentV1 } from './image-develop-mask-plan-current-v1.ts';
import { ImageDevelopFrameOwnedPixelsV1 } from './image-develop-frame-owned-pixels-v1.ts';
import { withGeometryPixelFrameV1 } from './pixel-frame-geometry-v1.ts';
import { withLensDistortionPixelFrameV1 } from './pixel-frame-lens-distortion-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;

/** Transport the exact incoming-stage coverage through every remaining warp,
 * in authored order. RGB is zero; alpha uses each owning bilinear mapper. */
export async function withProjectedImageDevelopMaskCoverageCurrentV1<Result>(binding: Readonly<ImageDevelopMaskBindingPlanV1>, coverage: Uint8Array<ArrayBuffer>,
	consume: (view: Readonly<ImageDevelopMaskOverlayViewV1>) => Result | Promise<Result>, profile: ImageDevelopFrameProfile, signalValue?: AbortSignal): Promise<Result> {
	const signal = captureRepairSignalV1(signalValue), check = () => { checkRepairSignalV1(signal); }; check();
	const transforms = imageDevelopMaskTransformsCurrentV1(binding); assertImageDevelopMaskOverlayBudgetCurrentV1(binding);
	if (typeof consume !== 'function') throw new TypeError('Current mask projection requires a scoped consumer.');
	if (Object.getPrototypeOf(coverage) !== Uint8Array.prototype || ['buffer', 'byteOffset', 'byteLength', 'length'].some(key => Object.hasOwn(coverage, key))) {
		throw new TypeError('Current mask projection requires native coverage without geometry overrides.');
	}
	const sourceBacking = Reflect.apply(BUFFER, coverage, []) as ArrayBuffer;
	if (!(sourceBacking instanceof ArrayBuffer) || (RESIZABLE && Reflect.apply(RESIZABLE, sourceBacking, [])) || coverage.length !== binding.width * binding.height) {
		throw new RangeError('Current mask coverage does not match its admitted input.');
	}
	const sourceLength = Number(Reflect.apply(SIZE, sourceBacking, []));
	if (Reflect.apply(OFFSET, coverage, []) !== 0 || Reflect.apply(LENGTH, coverage, []) !== sourceLength || sourceLength !== binding.width * binding.height) {
		throw new TypeError('Current mask projection requires an exact dedicated coverage backing.');
	}
	const checkSource = () => { check(); if (Number(Reflect.apply(SIZE, sourceBacking, [])) !== sourceLength || sourceLength === 0) throw new TypeError('Current mask coverage backing was detached or changed.'); };
	checkSource();
	if (!transforms.length) { const result = await consume(Object.freeze({ maskId: binding.maskId, effectId: binding.effectId, width: binding.width, height: binding.height, coverage })); checkSource(); return result; }
	const owner = new ImageDevelopFrameOwnedPixelsV1();
	return owner.run(async () => {
		const initial = owner.bytes(coverage.length * 4, 'projection RGBA');
		let current: ImageDevelopFramePixels = Object.freeze({ descriptor: Object.freeze({ schemaVersion: 1, width: binding.width, height: binding.height,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }), pixels: initial });
		let backing = owner.buffer(initial); const budget = new RepairTaskBudgetV1(checkSource);
		for (let index = 0; index < coverage.length; index++) { initial[index * 4 + 3] = coverage[index]!; if (budget.visit()) await budget.yield(); }
		for (const transform of transforms) {
			checkSource();
			const next = await owner.stage(accept => transform.kind === 'geometry'
				? withGeometryPixelFrameV1({ frame: current, geometry: transform.geometry, ...(signal ? { signal } : {}) }, accept, { limits: profile.render })
				: withLensDistortionPixelFrameV1({ frame: current, amount: transform.amount, ...(signal ? { signal } : {}) }, accept, { limits: profile.render }));
			owner.retire(backing); current = next; backing = owner.buffer(next.pixels);
		}
		const projected = owner.bytes(current.descriptor.width * current.descriptor.height, 'projection coverage');
		for (let index = 0; index < projected.length; index++) { projected[index] = current.pixels[index * 4 + 3]!; if (budget.visit()) await budget.yield(); }
		checkSource(); const result = await consume(Object.freeze({ maskId: binding.maskId, effectId: binding.effectId,
			width: current.descriptor.width, height: current.descriptor.height, coverage: projected })); checkSource(); return result;
	}, () => []);
}
