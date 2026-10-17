/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { planImageGeometryV1, writeImageGeometryPointV1, type ImageGeometryPlanV1 } from './image-geometry-plan-v1.ts';
import { normalizeImageGeometryV1 } from './image-geometry-v1.ts';
import {
	captureLinearKernelDescriptorV1,
	captureLinearKernelPlanesV1,
	writeLinearKernelPixelV1,
	type LinearKernelDescriptorV1,
} from './linear-kernel-planes-v1.ts';
import { planPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

/** Natural output metadata; only this module's immutable plans can be rendered. */
export interface PreparedLinearGeometryV1 {
	readonly descriptor: LinearKernelDescriptorV1;
	readonly sampleCount: number;
	readonly byteLength: number;
}
type Bounds = Readonly<{ left: number; top: number; right: number; bottom: number }>;
interface State {
	readonly sourceDescriptor: LinearKernelDescriptorV1;
	readonly geometry: Readonly<ImageGeometryPlanV1>;
	readonly bounds: Bounds;
}
const PLANS = new WeakMap<PreparedLinearGeometryV1, Readonly<State>>();
const LEGACY_FIELDS = ['crop', 'rotationDegrees', 'flipHorizontal', 'flipVertical'] as const;
const GEOMETRY_FIELDS = ['schemaVersion', ...LEGACY_FIELDS, 'perspective'] as const;
const LIMIT_FIELDS = ['maximumSidePixels', 'maximumPixels', 'maximumBytes'] as const;

/** Admit source and natural output before touching a pixel or allocating a plane. */
export function prepareLinearGeometryV1(geometryValue: unknown, descriptorValue: PixelFrameDescriptorV1,
	limits: PixelFrameLimitsV1): Readonly<PreparedLinearGeometryV1> {
	const input = record(geometryValue, 'linear image geometry', GEOMETRY_FIELDS, LEGACY_FIELDS);
	const geometry = Object.hasOwn(input, 'schemaVersion') ? normalizeImageGeometryV1(input) : legacyGeometry(input);
	const sourceDescriptor = captureLinearKernelDescriptorV1(descriptorValue);
	const limitInput = record(limits, 'linear geometry limits', LIMIT_FIELDS);
	const capturedLimits = Object.freeze({ maximumSidePixels: field(limitInput, 'maximumSidePixels', 'linear geometry limits'),
		maximumPixels: field(limitInput, 'maximumPixels', 'linear geometry limits'), maximumBytes: field(limitInput, 'maximumBytes', 'linear geometry limits') });
	planPixelFrameV1(sourceDescriptor, capturedLimits);
	const mapping = planImageGeometryV1(geometry, sourceDescriptor.width, sourceDescriptor.height);
	const descriptor = captureLinearKernelDescriptorV1({ ...sourceDescriptor, width: mapping.width, height: mapping.height });
	const output = planPixelFrameV1(descriptor, capturedLimits);
	const prepared = Object.freeze({ descriptor, sampleCount: output.sampleCount, byteLength: output.byteLength });
	PLANS.set(prepared, Object.freeze({ sourceDescriptor, geometry: mapping, bounds: cropBounds(mapping) }));
	return prepared;
}

/**
 * Borrow two disjoint caller-owned Float32 planes. Filtering follows the byte
 * geometry mapper in linear light: premultiplied bilinear RGB, straight output,
 * extended crop edges and transparent rotated corners. No full-frame scratch or
 * byte conversion exists here; the caller joins this write before retiring its
 * planes and accounts for both allocations in its aggregate working budget.
 */
export async function writeLinearGeometryV1(plan: PreparedLinearGeometryV1, source: LinearWorkingPixelFrameV1,
	target: Float32Array<ArrayBuffer>, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue);
	let state: Readonly<State>, planes: ReturnType<typeof captureLinearKernelPlanesV1>;
	try {
		const admitted = PLANS.get(plan);
		if (!admitted) throw new TypeError('Linear geometry requires an authenticated prepared plan.');
		state = admitted;
		const input = record(source, 'linear geometry source frame', ['descriptor', 'pixels']);
		const descriptor = captureLinearKernelDescriptorV1(field(input, 'descriptor', 'linear geometry source frame'));
		if (descriptor.width !== state.sourceDescriptor.width || descriptor.height !== state.sourceDescriptor.height
			|| descriptor.primaries !== state.sourceDescriptor.primaries) {
			throw new RangeError('Linear geometry source descriptor does not match its prepared binding.');
		}
		planes = captureLinearKernelPlanesV1(state.sourceDescriptor, field(input, 'pixels', 'linear geometry source frame'), target, plan.descriptor);
	} catch (error) { checkRepairSignalV1(signal); throw error; }
	const check = () => { checkRepairSignalV1(signal); planes.check(); };
	check();
	const budget = new RepairTaskBudgetV1(check), point = { x: 0, y: 0 }, mapping = state.geometry;
	for (let index = 0; index < plan.sampleCount / 4; index++) {
		const x = index % mapping.width, y = Math.floor(index / mapping.width), offset = index * 4;
		if (writeImageGeometryPointV1(mapping, x + 0.5, y + 0.5, point)) {
			sample(planes.source, planes.target, offset, mapping.sourceWidth, point.x - 0.5, point.y - 0.5, state.bounds);
		} else writeLinearKernelPixelV1(planes.target, offset, 0, 0, 0, 0);
		if (budget.visit()) await budget.yield();
	}
	check();
}

function legacyGeometry(input: Readonly<Record<string, unknown>>) {
	if (Object.hasOwn(input, 'perspective')) throw new TypeError('Legacy linear image geometry contains an unsupported field.');
	return normalizeImageGeometryV1({ schemaVersion: 1,
		crop: field(input, 'crop', 'linear image geometry'), rotationDegrees: field(input, 'rotationDegrees', 'linear image geometry'),
		flipHorizontal: field(input, 'flipHorizontal', 'linear image geometry'), flipVertical: field(input, 'flipVertical', 'linear image geometry'),
		perspective: null });
}

function cropBounds(plan: ImageGeometryPlanV1): Bounds {
	return Object.freeze({ left: Math.floor(plan.crop.x * plan.sourceWidth), top: Math.floor(plan.crop.y * plan.sourceHeight),
		right: Math.min(plan.sourceWidth - 1, Math.ceil((plan.crop.x + plan.crop.width) * plan.sourceWidth) - 1),
		bottom: Math.min(plan.sourceHeight - 1, Math.ceil((plan.crop.y + plan.crop.height) * plan.sourceHeight) - 1) });
}

function sample(source: Float32Array<ArrayBuffer>, target: Float32Array<ArrayBuffer>, offset: number,
	width: number, x: number, y: number, bounds: Bounds): void {
	const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
	let alpha = 0, red = 0, green = 0, blue = 0;
	for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
		const sx = Math.max(bounds.left, Math.min(bounds.right, ix + dx)), sy = Math.max(bounds.top, Math.min(bounds.bottom, iy + dy));
		const index = (sy * width + sx) * 4, weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
		const weightedAlpha = source[index + 3]! * weight;
		alpha += weightedAlpha;
		red += source[index]! * weightedAlpha; green += source[index + 1]! * weightedAlpha; blue += source[index + 2]! * weightedAlpha;
	}
	// The mathematical weighted alpha is in [0,1]; remove only double summation drift.
	const outputAlpha = Math.fround(Math.max(0, Math.min(1, alpha)));
	if (outputAlpha === 0) { writeLinearKernelPixelV1(target, offset, 0, 0, 0, 0); return; }
	writeLinearKernelPixelV1(target, offset, red / alpha, green / alpha, blue / alpha, outputAlpha);
}
