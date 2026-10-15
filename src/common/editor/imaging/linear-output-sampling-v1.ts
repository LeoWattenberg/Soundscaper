/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { containImageGeometryPlanV1, planImageGeometryV1 } from './image-geometry-plan-v1.ts';
import { captureLinearKernelDescriptorV1, captureLinearKernelPlanesV1, linearKernelDecodedV1, type LinearKernelDescriptorV1 } from './linear-kernel-planes-v1.ts';

export interface LinearOutputSampleV1 { red: number; green: number; blue: number; alpha: number }

/** Shared coordinates with the permanent output-size delivery mapper. */
export function linearOutputMappingV1(sourceWidth: number, sourceHeight: number, width: number, height: number) {
	const natural = planImageGeometryV1({ schemaVersion: 1, crop: null, rotationDegrees: 0,
		flipHorizontal: false, flipVertical: false, perspective: null }, sourceWidth, sourceHeight);
	return containImageGeometryPlanV1(natural, width, height);
}

/** Capture all source metadata before admitting its physical sample plane. */
export function captureLinearOutputPlanesV1(sourceValue: unknown, descriptor: LinearKernelDescriptorV1,
	target: unknown, outputDescriptor: LinearKernelDescriptorV1) {
	const input = record(sourceValue, 'linear output source frame', ['descriptor', 'pixels']);
	const actual = captureLinearKernelDescriptorV1(field(input, 'descriptor', 'linear output source frame'));
	if (actual.width !== descriptor.width || actual.height !== descriptor.height || actual.primaries !== descriptor.primaries) {
		throw new RangeError('Linear output source descriptor does not match its prepared binding.');
	}
	return captureLinearKernelPlanesV1(descriptor, field(input, 'pixels', 'linear output source frame'), target, outputDescriptor);
}

/** Four taps, replicated edges, premultiplied-linear filtering and straight
 * output. The reusable scalar destination is not a frame allocation. Graphic
 * bytes are decoded before filtering; native source RGB is never encoded. */
export function sampleLinearOutputV1(source: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer>, width: number, height: number,
	x: number, y: number, encodedGraphic: boolean, output: LinearOutputSampleV1): void {
	const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
	let alpha = 0, red = 0, green = 0, blue = 0;
	for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
		const sx = Math.max(0, Math.min(width - 1, ix + dx)), sy = Math.max(0, Math.min(height - 1, iy + dy));
		const index = (sy * width + sx) * 4, weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
		const weightedAlpha = source[index + 3]! * (encodedGraphic ? 1 / 255 : 1) * weight;
		alpha += weightedAlpha;
		if (encodedGraphic) {
			red += linearKernelDecodedV1(source[index]! / 255) * weightedAlpha;
			green += linearKernelDecodedV1(source[index + 1]! / 255) * weightedAlpha;
			blue += linearKernelDecodedV1(source[index + 2]! / 255) * weightedAlpha;
		} else {
			red += source[index]! * weightedAlpha; green += source[index + 1]! * weightedAlpha; blue += source[index + 2]! * weightedAlpha;
		}
	}
	// Only alpha's floating summation drift is clamped. Extended RGB is retained.
	output.alpha = Math.max(0, Math.min(1, alpha));
	if (output.alpha === 0) { output.red = 0; output.green = 0; output.blue = 0; return; }
	output.red = red / alpha; output.green = green / alpha; output.blue = blue / alpha;
}
