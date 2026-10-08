/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { normalizeImageGeometryV1 } from './image-geometry-v1.ts';
import { containImageGeometryPlanV1, planImageGeometryV1, writeImageGeometryPointV1, type ImageGeometryPlanV1 } from './image-geometry-plan-v1.ts';

export interface GeometryPixelFrameV1 {
	readonly descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'unorm8' }>;
	readonly pixels: Uint8Array<ArrayBuffer>;
}
const ABORT_CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const CHUNK_BYTES = 256 * 1024;

/**
 * Borrow one fixed source and own one admitted output. Encoded-sRGB bilinear
 * samples are alpha-premultiplied while filtering, then returned as straight
 * alpha; hidden zero-alpha RGB is canonical zero. Rectangular crop borders
 * extend their edge samples; outside the rotated aperture is transparent.
 * The callback borrows output only until settlement, then every owned byte is
 * wiped. No intermediate frame, metadata inventory or per-pixel object exists.
 */
export async function withGeometryPixelFrameV1<Result>(value: unknown,
	consume: (frame: GeometryPixelFrameV1) => Result | Promise<Result>,
	optionsValue: Readonly<{ limits: PixelFrameLimitsV1; delivery?: Readonly<{ width: number; height: number }> }>): Promise<Result> {
	const input = record(value, 'geometry frame request', ['frame', 'geometry', 'signal'], ['frame', 'geometry']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'geometry frame request') : undefined;
	if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Geometry requires a native cancellation signal.');
	const check = () => { if (signal !== undefined) Reflect.apply(ABORT_CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Geometry requires a scoped pixel consumer.');
	const options = record(optionsValue, 'geometry frame options', ['limits', 'delivery'], ['limits']), limits = field(options, 'limits', 'geometry frame options');
	const geometry = normalizeImageGeometryV1(field(input, 'geometry', 'geometry frame request')); check();
	const raw = record(field(input, 'frame', 'geometry frame request'), 'geometry source frame', ['descriptor', 'pixels']);
	const admitted = admitPixelFrameV1(field(raw, 'descriptor', 'geometry source frame'), { limits }); check();
	const source = readPixelFrameV1({ descriptor: admitted.descriptor, pixels: field(raw, 'pixels', 'geometry source frame') }, limits);
	if (source.descriptor.sampleFormat !== 'unorm8') throw new RangeError('Geometry requires UNORM8 encoded sRGB.');
	const naturalPlan = planImageGeometryV1(geometry, source.descriptor.width, source.descriptor.height);
	const delivery = Object.hasOwn(options, 'delivery') ? record(field(options, 'delivery', 'geometry frame options'), 'geometry delivery', ['width', 'height']) : null;
	const plan = delivery ? containImageGeometryPlanV1(naturalPlan, field(delivery, 'width', 'geometry delivery') as number,
		field(delivery, 'height', 'geometry delivery') as number) : naturalPlan;
	const outputPlan = admitPixelFrameV1({ ...source.descriptor, width: plan.width, height: plan.height }, { limits }); check();
	const borrowed = new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, admitted.byteLength), sourceBuffer = borrowed.buffer;
	const checkSource = () => { check(); if (Number(Reflect.apply(BUFFER_SIZE, sourceBuffer, [])) === 0) throw new RangeError('Geometry source buffer was detached.'); };
	checkSource();
	const pixels = new Uint8Array(outputPlan.byteLength), buffer = pixels.buffer, point = { x: 0, y: 0 };
	const bounds = cropBounds(plan);
	try {
		for (let start = 0; start < outputPlan.byteLength; start += CHUNK_BYTES) {
			checkSource(); const end = Math.min(outputPlan.byteLength, start + CHUNK_BYTES);
			for (let offset = start; offset < end; offset += 4) {
				const index = offset / 4, x = index % plan.width, y = Math.floor(index / plan.width);
				if (writeImageGeometryPointV1(plan, x + 0.5, y + 0.5, point)) sample(borrowed, pixels, offset, plan.sourceWidth, point.x - 0.5, point.y - 0.5, bounds);
			}
			if (end < outputPlan.byteLength) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); checkSource(); }
		}
		checkSource();
		const descriptor = Object.freeze({ ...outputPlan.descriptor, sampleFormat: 'unorm8' as const });
		const result = await consume(Object.freeze({ descriptor, pixels })); check(); return result;
	} finally { if (Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0) new Uint8Array(buffer).fill(0); }
}

type Bounds = Readonly<{ left: number; top: number; right: number; bottom: number }>;
function cropBounds(plan: ImageGeometryPlanV1): Bounds {
	return { left: Math.floor(plan.crop.x * plan.sourceWidth), top: Math.floor(plan.crop.y * plan.sourceHeight),
		right: Math.min(plan.sourceWidth - 1, Math.ceil((plan.crop.x + plan.crop.width) * plan.sourceWidth) - 1),
		bottom: Math.min(plan.sourceHeight - 1, Math.ceil((plan.crop.y + plan.crop.height) * plan.sourceHeight) - 1) };
}

function sample(source: Uint8Array, target: Uint8Array, offset: number, width: number, x: number, y: number, bounds: Bounds): void {
	const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
	let alpha = 0, red = 0, green = 0, blue = 0;
	for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
		const sx = Math.max(bounds.left, Math.min(bounds.right, ix + dx)), sy = Math.max(bounds.top, Math.min(bounds.bottom, iy + dy));
		const index = (sy * width + sx) * 4, weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
		const weightedAlpha = source[index + 3]! * weight; alpha += weightedAlpha;
		red += source[index]! * weightedAlpha; green += source[index + 1]! * weightedAlpha; blue += source[index + 2]! * weightedAlpha;
	}
	target[offset + 3] = Math.round(alpha);
	if (target[offset + 3] === 0) return;
	target[offset] = Math.round(red / alpha); target[offset + 1] = Math.round(green / alpha); target[offset + 2] = Math.round(blue / alpha);
}
