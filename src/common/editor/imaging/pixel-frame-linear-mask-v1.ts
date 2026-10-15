/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateVideoMaskMatteGraphWorkV1, type VideoMaskMatteRangeSamplerV1 } from '../video-mask-matte-graph-work-v1.ts';
import { videoMaskMatteUsesCurrentFrameV1 } from '../video-mask-luminance-range-v1.ts';
import { VIDEO_MASK_MATTE_WORKING_LIMIT_V1, videoMaskMatteWorkingBytesV1 } from '../video-mask-matte-v24.ts';
import { prepareVideoMaskMatteBrushInputsV1 } from './image-develop-brush-mask-v1.ts';
import type { ImageDevelopMaskBindingPlanV1 } from './image-develop-mask-plan-v1.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { assertMaskRasterSourceScopeV1, maskRasterSourceScopeWorkingBytesV1, scopedBrushMaskResourceV1,
	withMaskRasterSourceScopeWorkV1 } from './mask-raster-source-scope-v1.ts';
import type { BrushMaskResourceV1 } from './brush-mask-resource-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';

/** Root's captured Float32 stage stays immutable until this graph joins. Only
 * coverage is quantized; range decisions never pass through display pixels. */
export function withLinearMaskCoverageV1<Result>(binding: Readonly<ImageDevelopMaskBindingPlanV1>, frame: Readonly<LinearWorkingPixelFrameV1>,
	consume: (coverage: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, signalValue?: AbortSignal, scope?: unknown): Promise<Result> {
	const signal = captureRepairSignalV1(signalValue), check = () => { checkRepairSignalV1(signal); }; check();
	const prepared = prepareVideoMaskMatteBrushInputsV1(binding.graph, binding.width, binding.height);
	if (frame.descriptor.width !== binding.width || frame.descriptor.height !== binding.height) throw new RangeError('Native mask requires the exact adjustment input extent.');
	if (typeof consume !== 'function') throw new TypeError('Native mask requires a scoped consumer.');
	const run = () => {
		const inputs = new Map<string, Readonly<BrushMaskResourceV1>>();
		if (scope !== undefined) {
			assertMaskRasterSourceScopeV1(scope, prepared.references);
			if (videoMaskMatteWorkingBytesV1(prepared.graph, binding.width, binding.height) + maskRasterSourceScopeWorkingBytesV1(scope) > VIDEO_MASK_MATTE_WORKING_LIMIT_V1) {
				throw new RangeError('Native brush coverage exceeds its 64 MiB working budget.');
			}
			for (const key of prepared.retainedStorageKeys) inputs.set(key, scopedBrushMaskResourceV1(scope, key));
		} else if (prepared.references.length) throw new RangeError('Native brush masks require authenticated source authority.');
		return withRepairPixelFrameLifetimeV1(async owner => {
			const ranges = videoMaskMatteUsesCurrentFrameV1(prepared.graph) ? linearRanges(frame.pixels) : undefined;
			const work = evaluateVideoMaskMatteGraphWorkV1(prepared.graph, binding.width, binding.height, new Map(), length => owner.bytes(length), ranges, inputs);
			try {
				let next = work.next();
				while (!next.done) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check(); next = work.next(); }
				check(); const result = await consume(next.value); check(); return result;
			} finally { work.return(new Uint8Array()); }
		});
	};
	return scope === undefined ? run() : withMaskRasterSourceScopeWorkV1(scope, run);
}

function linearRanges(pixels: Float32Array<ArrayBuffer>): Readonly<VideoMaskMatteRangeSamplerV1> {
	const ramp = (distance: number, falloff: number) => falloff === 0 ? 0 : Math.round(255 * Math.max(0, Math.min(1, 1 - distance / falloff)));
	const decode = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
	return {
		luminance(node, index) {
			const offset = index * 4; if (pixels[offset + 3] === 0) return 0;
			const value = pixels[offset]! * .2126 + pixels[offset + 1]! * .7152 + pixels[offset + 2]! * .0722;
			return value >= node.lower && value <= node.upper ? 255 : ramp(value < node.lower ? node.lower - value : value - node.upper, node.falloff);
		},
		color(node) {
			const red = decode(node.color.r), green = decode(node.color.g), blue = decode(node.color.b);
			return index => {
				const offset = index * 4; if (pixels[offset + 3] === 0) return 0;
				const distance = Math.hypot(pixels[offset]! - red, pixels[offset + 1]! - green, pixels[offset + 2]! - blue) / Math.sqrt(3);
				return distance <= node.radius ? 255 : ramp(distance - node.radius, node.falloff);
			};
		},
	};
}

export async function blendLinearMaskCoverageV1(source: Readonly<LinearWorkingPixelFrameV1>, target: Float32Array<ArrayBuffer>, coverage: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<void> {
	const check = () => { checkRepairSignalV1(signal); }, budget = new RepairTaskBudgetV1(check); check();
	if (target.length !== source.pixels.length || coverage.length * 4 !== target.length) throw new RangeError('Native local adjustment geometry changed.');
	for (let offset = 0; offset < target.length; offset += 4) {
		const amount = coverage[offset / 4]!;
		for (let channel = 0; channel < 3; channel++) {
			const before = source.pixels[offset + channel]!;
			const value = Math.fround(amount === 0 ? before : amount === 255 ? target[offset + channel]!
				: before + amount / 255 * (target[offset + channel]! - before));
			if (!Number.isFinite(value)) throw new RangeError('Native mask blending exceeds finite Float32 range.'); target[offset + channel] = value;
		}
		target[offset + 3] = source.pixels[offset + 3]!;
		if (budget.visit()) await budget.yield();
	}
	check();
}
