/* SPDX-License-Identifier: AGPL-3.0-only */

import { motionScalar, motionVector, motionPropertyOfKind, type MotionColorProperty, type MotionScalarProperty, type MotionVector2Property } from './motion-property.ts';
import { freezeMotionValue, motionArray, motionBoolean, motionEnum, motionId, motionRecord, uniqueMotionIds } from './motion-values.ts';

export interface MotionShapeTransform {
	readonly anchor: MotionVector2Property; readonly position: MotionVector2Property;
	readonly scale: MotionVector2Property; readonly rotation: MotionScalarProperty;
}
interface MotionShapeOperatorBase { readonly id: string; readonly enabled: boolean }
/** Ordered operators act on the current shape list, before layer masks/effects/transforms. */
export type MotionShapeOperator = MotionShapeOperatorBase & (
	| { readonly kind: 'trim-paths'; readonly start: MotionScalarProperty; readonly end: MotionScalarProperty; readonly offset: MotionScalarProperty; readonly mode: 'individual' | 'simultaneous' }
	| { readonly kind: 'repeater'; readonly copies: MotionScalarProperty; readonly offset: MotionScalarProperty; readonly transform: MotionShapeTransform; readonly startOpacity: MotionScalarProperty; readonly endOpacity: MotionScalarProperty }
	| { readonly kind: 'boolean'; readonly mode: 'union' | 'subtract' | 'intersect' | 'xor' }
);
export interface MotionTextSelector {
	/** Units refer to shaped clusters/words/lines, never UTF-16 code units or separately shaped letters. */
	readonly unit: 'cluster' | 'word' | 'line';
	/** Range, offset and amount use fractions, where one covers the complete shaped unit list. */
	readonly start: MotionScalarProperty; readonly end: MotionScalarProperty; readonly offset: MotionScalarProperty; readonly amount: MotionScalarProperty;
	readonly shape: 'square' | 'ramp-up' | 'ramp-down' | 'triangle' | 'round' | 'smooth';
}
export interface MotionTextAnimator {
	readonly id: string; readonly enabled: boolean; readonly selector: MotionTextSelector;
	/** Local pixel anchor/offset, multiplicative scale, degrees, unit opacity and pixel tracking. */
	readonly anchor: MotionVector2Property; readonly position: MotionVector2Property; readonly scale: MotionVector2Property;
	readonly rotation: MotionScalarProperty; readonly opacity: MotionScalarProperty; readonly color: MotionColorProperty | null; readonly tracking: MotionScalarProperty;
}
const SHAPE_FIELDS = {
	'trim-paths': ['start', 'end', 'offset', 'mode'], repeater: ['copies', 'offset', 'transform', 'startOpacity', 'endOpacity'], boolean: ['mode'],
} as const;
export function normalizeMotionShapeOperators(value: unknown): readonly MotionShapeOperator[] {
	const operators = motionArray(value, 256, 'shape operators').map(normalizeMotionShapeOperator); uniqueMotionIds(operators, 'shape operators'); return freezeMotionValue(operators);
}
export function normalizeMotionShapeOperator(value: unknown): MotionShapeOperator {
	const baseFields = ['id', 'enabled', 'kind'];
	const input = motionRecord(value, [...baseFields, ...new Set(Object.values(SHAPE_FIELDS).flat())], 'shape operator', ['kind']);
	const kind = motionEnum(input.kind, ['trim-paths', 'repeater', 'boolean'], 'shape operator kind');
	const record = motionRecord(value, [...baseFields, ...SHAPE_FIELDS[kind]], 'shape operator');
	const base = { id: motionId(record.id), enabled: motionBoolean(record.enabled, 'shape operator enabled') };
	if (kind === 'boolean') return freezeMotionValue({ ...base, kind, mode: motionEnum(record.mode, ['union', 'subtract', 'intersect', 'xor'], 'shape boolean mode') });
	if (kind === 'trim-paths') return freezeMotionValue({ ...base, kind, start: motionPropertyOfKind(record.start, 'scalar'), end: motionPropertyOfKind(record.end, 'scalar'),
		offset: motionPropertyOfKind(record.offset, 'scalar'), mode: motionEnum(record.mode, ['individual', 'simultaneous'], 'trim paths mode') });
	const transform = motionRecord(record.transform, ['anchor', 'position', 'scale', 'rotation'], 'shape repeater transform');
	return freezeMotionValue({ ...base, kind, copies: motionPropertyOfKind(record.copies, 'scalar'), offset: motionPropertyOfKind(record.offset, 'scalar'),
		transform: { anchor: motionPropertyOfKind(transform.anchor, 'vector2'), position: motionPropertyOfKind(transform.position, 'vector2'), scale: motionPropertyOfKind(transform.scale, 'vector2'), rotation: motionPropertyOfKind(transform.rotation, 'scalar') },
		startOpacity: motionPropertyOfKind(record.startOpacity, 'scalar'), endOpacity: motionPropertyOfKind(record.endOpacity, 'scalar') });
}
export function normalizeMotionTextAnimators(value: unknown): readonly MotionTextAnimator[] {
	const animators = motionArray(value, 256, 'text animators').map(normalizeMotionTextAnimator); uniqueMotionIds(animators, 'text animators'); return freezeMotionValue(animators);
}
export function normalizeMotionTextAnimator(value: unknown): MotionTextAnimator {
	const record = motionRecord(value, ['id', 'enabled', 'selector', 'anchor', 'position', 'scale', 'rotation', 'opacity', 'color', 'tracking'], 'text animator');
	const selector = motionRecord(record.selector, ['unit', 'start', 'end', 'offset', 'amount', 'shape'], 'text animator selector');
	return freezeMotionValue({ id: motionId(record.id), enabled: motionBoolean(record.enabled, 'text animator enabled'),
		selector: { unit: motionEnum(selector.unit, ['cluster', 'word', 'line'], 'text selector unit'),
			start: motionPropertyOfKind(selector.start, 'scalar'), end: motionPropertyOfKind(selector.end, 'scalar'), offset: motionPropertyOfKind(selector.offset, 'scalar'), amount: motionPropertyOfKind(selector.amount, 'scalar'),
			shape: motionEnum(selector.shape, ['square', 'ramp-up', 'ramp-down', 'triangle', 'round', 'smooth'], 'text selector shape') },
		anchor: motionPropertyOfKind(record.anchor, 'vector2'), position: motionPropertyOfKind(record.position, 'vector2'), scale: motionPropertyOfKind(record.scale, 'vector2'),
		rotation: motionPropertyOfKind(record.rotation, 'scalar'), opacity: motionPropertyOfKind(record.opacity, 'scalar'), color: record.color === null ? null : motionPropertyOfKind(record.color, 'color'), tracking: motionPropertyOfKind(record.tracking, 'scalar') });
}
export function createMotionShapeOperator<Kind extends MotionShapeOperator['kind']>(options: Readonly<{ id: string; kind: Kind }>): Extract<MotionShapeOperator, { kind: Kind }> {
	const base = { id: options.id, kind: options.kind, enabled: true };
	const fields = options.kind === 'trim-paths' ? { start: motionScalar(0), end: motionScalar(1), offset: motionScalar(0), mode: 'individual' }
		: options.kind === 'boolean' ? { mode: 'union' } : { copies: motionScalar(3), offset: motionScalar(0),
			transform: { anchor: motionVector([0, 0]), position: motionVector([100, 0]), scale: motionVector([1, 1]), rotation: motionScalar(0) }, startOpacity: motionScalar(1), endOpacity: motionScalar(1) };
	return normalizeMotionShapeOperator({ ...base, ...fields }) as Extract<MotionShapeOperator, { kind: Kind }>;
}
export function createMotionTextAnimator(id: string): MotionTextAnimator {
	return normalizeMotionTextAnimator({ id, enabled: true, selector: { unit: 'cluster', start: motionScalar(0), end: motionScalar(1), offset: motionScalar(0), amount: motionScalar(1), shape: 'square' },
		anchor: motionVector([0, 0]), position: motionVector([0, 0]), scale: motionVector([1, 1]), rotation: motionScalar(0), opacity: motionScalar(1), color: null, tracking: motionScalar(0) });
}
