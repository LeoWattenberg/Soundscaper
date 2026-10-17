/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionLayer } from '../../motion-composition.ts';
import { VIDEO_EFFECT_TYPES, videoEffectDefinition } from '../../video-effects.js';
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
export function motionPropertyLabel(path: string, copy: Readonly<Record<string, string>>, layer?: MotionLayer): string {
	const effect = path.match(/^effects\.(\d+)\.parameters\.(\d+)\.value$/u);
	if (effect && layer) {
		const owner = layer.effects[Number(effect[1])]; const parameter = owner?.parameters[Number(effect[2])];
		if (owner && parameter) {
			const definition = VIDEO_EFFECT_TYPES.includes(owner.type) ? videoEffectDefinition(owner.type) : null;
			const name = definition ? copy[definition.labelKey] : copy.motionscaperCornerPin;
			const descriptor = definition?.params[parameter.id]; const label = descriptor ? copy[descriptor.labelKey] : copy[`motionscaperCorner_${parameter.id}`] ?? parameter.id;
			return `${name} ${Number(effect[1]) + 1}: ${label}`;
		}
	}
	const mask = path.match(/^masks\.(\d+)\.(opacity|feather|expansion)$/u);
	if (mask) return `${copy.motionscaperMask} ${Number(mask[1]) + 1}: ${copy[`motionscaperProperty_${mask[2]}`] ?? mask[2]}`;
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
