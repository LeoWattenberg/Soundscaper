/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeMotionProperty, type MotionProperty } from '../../motion-property.ts';
import type { MotionPropertyValue } from '../../motion-property-evaluation.ts';
import type { CompiledInterpolationCurve } from '../../interpolation-curve.ts';

export type MotionNumericProperty = Exclude<MotionProperty, { kind: 'path' }>;
export function motionPropertyChannel(property: MotionNumericProperty, channel: number): Readonly<{ value: number; curve: CompiledInterpolationCurve | null }> {
	return property.kind === 'scalar' ? { value: property.value, curve: property.curve } : { value: property.value[channel]!, curve: property.curves[channel]! };
}
export function motionPropertyChannelValue(property: MotionNumericProperty, channel: number, value: number): MotionPropertyValue {
	return normalizeMotionProperty({ ...property, value: property.kind === 'scalar' ? value : property.value.map((entry, index) => index === channel ? value : entry) }).value;
}
export function motionPropertyLabel(path: string, copy: Readonly<Record<string, string>>): string {
	const operator = path.match(/^(operators|document\.animators)\.(\d+)\.(.+)$/u);
	if (operator) {
		const label = copy[`motionscaperOperatorField_${operator[3]!.replaceAll('.', '_')}`];
		if (label) return `${operator[1] === 'operators' ? copy.motionscaperShapeOperators : copy.motionscaperAnimator} ${Number(operator[2]) + 1}: ${label}`;
	}
	const key = path.split('.').at(-1)!;
	const label = copy[`motionscaperProperty_${key}`] ?? key;
	const index = path.match(/\.(\d+)\./u)?.[1];
	if (index && key === 'path') {
		const owner = path.startsWith('masks.') ? copy.motionscaperMaskPath : path.startsWith('shapes.') ? copy.motionscaperShapePath : null;
		if (owner) return `${owner} ${Number(index) + 1}: ${label}`;
	}
	return index ? `${label} ${Number(index) + 1}` : label;
}
