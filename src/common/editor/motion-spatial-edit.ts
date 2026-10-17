/* SPDX-License-Identifier: AGPL-3.0-only */

import { editMotionKeyframes } from './motion-keyframe-edit.ts';
import { motionPropertyOfKind, type MotionVector2, type MotionVector2Property, type MotionVector3Property } from './motion-property.ts';
import { addRationals, compareRationals, multiplyRationals, divideRationals, subtractRationals, type Rational } from './timeline-time.ts';
export type MotionSpatialProperty = MotionVector2Property | MotionVector3Property;

/** A single replacement retains independent Z animation and all expression bindings. */
export function setMotionSpatialKey(property: MotionSpatialProperty, position: Rational, point: MotionVector2): MotionSpatialProperty {
	point = validatedPoint(point);
	return typed(property, editMotionKeyframes(property, { type: 'set-key', position, value: property.kind === 'vector2' ? point : [point[0], point[1], property.value[2]], channels: [0, 1] }));
}

/** Equal control times make the independently evaluated coordinate curves trace one spatial cubic. */
export function enableMotionSpatialBezier(property: MotionSpatialProperty, from: Rational): MotionSpatialProperty {
	const channels = aligned(property, from); const firstShape = channels[0]!.shape, secondShape = channels[1]!.shape;
	if (firstShape.kind === 'bezier' && secondShape.kind === 'bezier' && compareRationals(firstShape.control1.position, secondShape.control1.position) === 0 && compareRationals(firstShape.control2.position, secondShape.control2.position) === 0) return property;
	if (firstShape.kind === 'hold' || secondShape.kind === 'hold') throw new RangeError('Hold segments cannot become continuous spatial handles without changing motion.');
	if (firstShape.kind === 'bezier' && secondShape.kind === 'bezier') throw new RangeError('Spatial handles require matching existing Bezier control times.');
	const span = subtractRationals(channels[0]!.last.position, from);
	const linearFirst = addRationals(from, multiplyRationals(span, { num: 1, den: 3 })), linearSecond = addRationals(from, multiplyRationals(span, { num: 2, den: 3 }));
	const existing = firstShape.kind === 'bezier' ? firstShape : secondShape.kind === 'bezier' ? secondShape : null;
	const firstTime = existing?.control1.position ?? linearFirst, secondTime = existing?.control2.position ?? linearSecond;
	if (channels.some(({ shape }) => shape.kind === 'eased') && (compareRationals(firstTime, linearFirst) !== 0 || compareRationals(secondTime, linearSecond) !== 0)) throw new RangeError('Existing eased motion requires matching linear Bezier control times.');
	const firstFraction = divideRationals(subtractRationals(firstTime, from), span), secondFraction = divideRationals(subtractRationals(secondTime, from), span);
	let changed = property;
	for (const [channel, { first, last, shape }] of channels.entries()) {
		if (shape.kind === 'bezier') continue;
		changed = typed(property, editMotionKeyframes(changed, { type: 'interpolation', fromPosition: from, channels: [channel], shape: { kind: 'bezier',
			control1: { position: firstTime, value: shape.kind === 'eased' ? first.value : first.value + (last.value - first.value) * firstFraction.num / firstFraction.den },
			control2: { position: secondTime, value: shape.kind === 'eased' ? last.value : first.value + (last.value - first.value) * secondFraction.num / secondFraction.den },
		} }));
	}
	return changed;
}

export function setMotionSpatialHandle(property: MotionSpatialProperty, from: Rational, handle: 1 | 2, point: MotionVector2): MotionSpatialProperty {
	if (handle !== 1 && handle !== 2) throw new RangeError('Unknown spatial Bezier handle.');
	point = validatedPoint(point);
	const channels = aligned(property, from); const first = channels[0]!.shape, second = channels[1]!.shape;
	if (first.kind !== 'bezier' || second.kind !== 'bezier' || compareRationals(first.control1.position, second.control1.position) !== 0 || compareRationals(first.control2.position, second.control2.position) !== 0) throw new RangeError('Create aligned spatial Bezier handles before moving them.');
	let changed = property;
	for (const [channel, { shape }] of channels.entries()) {
		if (shape.kind !== 'bezier') throw new TypeError('Expected spatial Bezier interpolation.');
		const key = handle === 1 ? 'control1' : 'control2';
		changed = typed(property, editMotionKeyframes(changed, { type: 'interpolation', fromPosition: from, channels: [channel], shape: { ...shape, [key]: { ...shape[key], value: point[channel]! } } }));
	}
	return changed;
}
function typed(property: MotionSpatialProperty, value: unknown): MotionSpatialProperty { return property.kind === 'vector2' ? motionPropertyOfKind(value, 'vector2') : motionPropertyOfKind(value, 'vector3'); }
function aligned(property: MotionSpatialProperty, from: Rational) {
	const channels = property.curves.slice(0, 2).map((curve) => {
		const index = curve?.anchors.findIndex((anchor) => compareRationals(anchor.position, from) === 0) ?? -1;
		if (!curve || index < 0 || index >= curve.segments.length) throw new RangeError('Spatial handles require matching neighboring X and Y keyframes.');
		return { first: curve.anchors[index]!, last: curve.anchors[index + 1]!, shape: curve.segments[index]! };
	});
	if (compareRationals(channels[0]!.last.position, channels[1]!.last.position) !== 0) throw new RangeError('Spatial handles require matching neighboring X and Y keyframes.');
	return channels;
}

function validatedPoint(point: MotionVector2): MotionVector2 { return motionPropertyOfKind({ kind: 'vector2', value: point, curves: [null, null], expression: null }, 'vector2').value; }
