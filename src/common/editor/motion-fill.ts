/* SPDX-License-Identifier: AGPL-3.0-only */

import { motionPropertyOfKind, type MotionColorProperty, type MotionScalarProperty, type MotionVector2Property } from './motion-property.ts';
import { freezeMotionValue, motionArray, motionId, motionRecord, uniqueMotionIds } from './motion-values.ts';

export interface MotionGradientStop { readonly id: string; readonly offset: MotionScalarProperty; readonly color: MotionColorProperty }
export type MotionFill = MotionColorProperty
	| { readonly kind: 'linear-gradient'; readonly start: MotionVector2Property; readonly end: MotionVector2Property; readonly stops: readonly MotionGradientStop[] }
	| { readonly kind: 'radial-gradient'; readonly center: MotionVector2Property; readonly radius: MotionScalarProperty; readonly stops: readonly MotionGradientStop[] };

export function normalizeMotionFill(value: unknown): MotionFill {
	const input = motionRecord(value, ['kind', 'value', 'curves', 'expression', 'start', 'end', 'center', 'radius', 'stops'], 'motion fill', ['kind']);
	if (input.kind === 'color') return motionPropertyOfKind(input, 'color');
	if (input.kind !== 'linear-gradient' && input.kind !== 'radial-gradient') throw new TypeError('Motion fill must be a color or a supported gradient.');
	const record = motionRecord(value, input.kind === 'linear-gradient' ? ['kind', 'start', 'end', 'stops'] : ['kind', 'center', 'radius', 'stops'], 'motion gradient');
	const stops = motionArray(record.stops, 64, 'gradient stops', 2).map((value) => {
		const stop = motionRecord(value, ['id', 'offset', 'color'], 'gradient stop');
		return { id: motionId(stop.id), offset: motionPropertyOfKind(stop.offset, 'scalar'), color: motionPropertyOfKind(stop.color, 'color') };
	});
	uniqueMotionIds(stops, 'gradient stops');
	if (input.kind === 'linear-gradient') return freezeMotionValue({ kind: input.kind, start: motionPropertyOfKind(record.start, 'vector2'), end: motionPropertyOfKind(record.end, 'vector2'), stops });
	return freezeMotionValue({ kind: input.kind, center: motionPropertyOfKind(record.center, 'vector2'), radius: motionPropertyOfKind(record.radius, 'scalar'), stops });
}
