/* SPDX-License-Identifier: AGPL-3.0-only */

import { editMotionKeyframes } from '../../motion-keyframe-edit.ts';
import { compareRationals, subtractRationals, type Rational } from '../../timeline-time.ts';
import { motionPropertyChannel, motionPropertyChannelValue, type MotionNumericProperty } from './motion-property-ui.ts';

export function moveMotionGraphKey(property: MotionNumericProperty, channel: number, from: Rational, to: Rational, value: number): MotionNumericProperty {
	const moved = compareRationals(from, to) === 0 ? property : editMotionKeyframes(property, { type: 'move-keys', positions: [from], deltaFrames: subtractRationals(to, from), channels: [channel] });
	const result = editMotionKeyframes(moved, { type: 'set-key', position: to, value: motionPropertyChannelValue(property, channel, value), channels: [channel] });
	if (result.kind === 'path') throw new TypeError('A numeric graph requires a numeric property.');
	return result;
}

/** In speed mode the ordinate is the endpoint tangent in value/second, not the control point's value. */
export function moveMotionGraphHandle(property: MotionNumericProperty, channel: number, segment: number, handle: 1 | 2, position: Rational, ordinate: number, mode: 'value' | 'speed', frameRate: Rational): MotionNumericProperty {
	const curve = motionPropertyChannel(property, channel).curve; const shape = curve?.segments[segment];
	if (!curve || shape?.kind !== 'bezier') throw new ReferenceError('Select a Bezier segment before moving its handles.');
	const first = curve.anchors[segment]!, last = curve.anchors[segment + 1]!;
	if (compareRationals(position, first.position) <= 0 || compareRationals(position, last.position) >= 0) throw new RangeError('Keep the handle inside the segment span to avoid a vertical tangent.');
	const endpoint = handle === 1 ? first : last; const distance = subtractRationals(position, endpoint.position);
	const value = mode === 'value' ? ordinate : endpoint.value + ordinate * (distance.num / distance.den) / (frameRate.num / frameRate.den);
	const result = editMotionKeyframes(property, { type: 'interpolation', fromPosition: first.position, channels: [channel], shape: { ...shape, [handle === 1 ? 'control1' : 'control2']: { position, value } } });
	if (result.kind === 'path') throw new TypeError('A numeric graph requires a numeric property.');
	return result;
}
