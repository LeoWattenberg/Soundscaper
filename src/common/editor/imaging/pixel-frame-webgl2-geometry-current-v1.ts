/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import type { PixelFrameDescriptorV1 } from './pixel-frame-contract-v1.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { normalizeImageGeometryV1, type ImageGeometryV1 } from './image-geometry-v1.ts';
import { planImageGeometryV1, type ImageGeometryPlanV1 } from './image-geometry-plan-v1.ts';
import { captureLinearKernelDescriptorV1, LINEAR_KERNEL_LIMITS_V1, type LinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
import { prepareLinearGeometryV1, writeLinearGeometryV1, type PreparedLinearGeometryV1 } from './pixel-frame-linear-geometry-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';

type IntegerTransform = readonly [number, number, number, number, number, number];
export interface PreparedPixelFrameWebGl2GeometryCurrentV1 {
	readonly type: 'develop-geometry-v1';
	readonly kind: 9;
	readonly sourceDescriptor: LinearKernelDescriptorV1;
	readonly descriptor: LinearKernelDescriptorV1;
	readonly mapping: Readonly<ImageGeometryPlanV1>;
	readonly bounds: readonly [number, number, number, number];
	readonly supported: boolean;
	readonly integerPermutation: boolean;
	readonly integerTransform: IntegerTransform | null;
}
interface State {
	readonly pass: Readonly<PreparedPixelFrameWebGl2GeometryCurrentV1>;
	readonly cpu: Readonly<PreparedLinearGeometryV1>;
}
const PREPARED = new WeakMap<object, Readonly<State>>();
const LEGACY_FIELDS = ['crop', 'rotationDegrees', 'flipHorizontal', 'flipVertical'] as const;

/** Only scalar geometry is captured here. The existing native preparer remains
 * the authority for source/output profiles and the CPU reference identity.
 * Rounded GL coefficients do not replace the captured Double mapping. */
export function preparePixelFrameWebGl2GeometryCurrentV1(geometryValue: unknown,
	descriptorValue: PixelFrameDescriptorV1): Readonly<PreparedPixelFrameWebGl2GeometryCurrentV1> {
	const input = record(geometryValue, 'native GPU geometry', ['schemaVersion', ...LEGACY_FIELDS, 'perspective'], LEGACY_FIELDS);
	if (!Object.hasOwn(input, 'schemaVersion') && Object.hasOwn(input, 'perspective')) throw new TypeError('Legacy native GPU geometry contains an unsupported field.');
	const geometry = normalizeImageGeometryV1({
		schemaVersion: Object.hasOwn(input, 'schemaVersion') ? field(input, 'schemaVersion', 'native GPU geometry') : 1,
		crop: field(input, 'crop', 'native GPU geometry'), rotationDegrees: field(input, 'rotationDegrees', 'native GPU geometry'),
		flipHorizontal: field(input, 'flipHorizontal', 'native GPU geometry'), flipVertical: field(input, 'flipVertical', 'native GPU geometry'),
		perspective: Object.hasOwn(input, 'schemaVersion') ? field(input, 'perspective', 'native GPU geometry') : null,
	});
	const sourceDescriptor = captureLinearKernelDescriptorV1(descriptorValue);
	const cpu = prepareLinearGeometryV1(geometry, sourceDescriptor, LINEAR_KERNEL_LIMITS_V1);
	const mapping = planImageGeometryV1(geometry, sourceDescriptor.width, sourceDescriptor.height);
	const bounds = Object.freeze([
		Math.floor(mapping.crop.x * mapping.sourceWidth), Math.floor(mapping.crop.y * mapping.sourceHeight),
		Math.min(mapping.sourceWidth - 1, Math.ceil((mapping.crop.x + mapping.crop.width) * mapping.sourceWidth) - 1),
		Math.min(mapping.sourceHeight - 1, Math.ceil((mapping.crop.y + mapping.crop.height) * mapping.sourceHeight) - 1),
	] as const);
	const integerTransform = integerMapping(geometry, mapping);
	const supported = integerTransform !== null || [...mapping.outputToAperture, ...mapping.apertureToSource].every(value => {
		const rounded = Math.fround(value); return Number.isFinite(rounded) && (value === 0 || rounded !== 0);
	});
	const pass = Object.freeze({ type: 'develop-geometry-v1' as const, kind: 9 as const, sourceDescriptor,
		descriptor: cpu.descriptor, mapping, bounds, supported, integerPermutation: integerTransform !== null, integerTransform });
	PREPARED.set(pass, Object.freeze({ pass, cpu })); return pass;
}

/** Private identity checks never inspect caller properties, including proxies. */
export function isPixelFrameWebGl2GeometryCurrentV1(value: unknown): value is Readonly<PreparedPixelFrameWebGl2GeometryCurrentV1> {
	return typeof value === 'object' && value !== null && PREPARED.has(value);
}
export function readPixelFrameWebGl2GeometryCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2GeometryCurrentV1> {
	if (!isPixelFrameWebGl2GeometryCurrentV1(value)) throw new TypeError('Native GPU geometry requires an owning prepared identity.');
	return PREPARED.get(value)!.pass;
}

/** The normative whole-plane reference uses the unchanged CPU writer. Its
 * caller owns both dedicated, disjoint planes and joins their physical cleanup. */
export async function writePixelFrameWebGl2GeometryCurrentV1(value: unknown, source: LinearWorkingPixelFrameV1,
	target: Float32Array<ArrayBuffer>, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	const pass = readPixelFrameWebGl2GeometryCurrentV1(value);
	await writeLinearGeometryV1(PREPARED.get(pass)!.cpu, source, target, signal);
}

/** Exact output-index to source-index inverse for a rectangular lattice
 * permutation. Derive integers directly, avoiding reciprocal1/W matrix drift.
 * This flag never permits omission of the real geometry filtering stage. */
function integerMapping(geometry: Readonly<ImageGeometryV1>, mapping: Readonly<ImageGeometryPlanV1>): IntegerTransform | null {
	if (geometry.perspective !== null || !Number.isInteger(geometry.rotationDegrees / 90)) return null;
	const x = mapping.crop.x * mapping.sourceWidth, y = mapping.crop.y * mapping.sourceHeight;
	const width = mapping.crop.width * mapping.sourceWidth, height = mapping.crop.height * mapping.sourceHeight;
	if (![x, y, width, height].every(Number.isInteger)) return null;
	const turn = ((geometry.rotationDegrees % 360) + 360) % 360;
	const inverse: IntegerTransform = turn === 90 ? [0, 1, x, -1, 0, y + height - 1]
		: turn === 180 ? [-1, 0, x + width - 1, 0, -1, y + height - 1]
			: turn === 270 ? [0, -1, x + width - 1, 1, 0, y] : [1, 0, x, 0, 1, y];
	const fx = geometry.flipHorizontal ? -1 : 1, fy = geometry.flipVertical ? -1 : 1;
	const ox = geometry.flipHorizontal ? mapping.width - 1 : 0, oy = geometry.flipVertical ? mapping.height - 1 : 0;
	const canonical = (value: number) => value === 0 ? 0 : value;
	return Object.freeze([
		canonical(inverse[0] * fx), canonical(inverse[1] * fy), canonical(inverse[2] + inverse[0] * ox + inverse[1] * oy),
		canonical(inverse[3] * fx), canonical(inverse[4] * fy), canonical(inverse[5] + inverse[3] * ox + inverse[4] * oy),
	] as const);
}
