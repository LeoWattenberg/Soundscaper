/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CurveChannelV1, PreparedCurvesEffectV1 } from '../video-curve-types-v1.ts';
import type { LinearColorChannelsV1 } from './pixel-frame-linear-chroma-v1.ts';
import { prepareLinearCurveMetadataCurrentV1, type LinearCurveChannelMetadataCurrentV1 } from './linear-curve-metadata-current-v1.ts';

export type PreparedLinearCurvesV1 = PreparedCurvesEffectV1;
type Curve = Readonly<LinearCurveChannelMetadataCurrentV1>;
type State = Readonly<Record<CurveChannelV1, Curve>>;
const PREPARED = new WeakMap<object, State>();

/** Reuse closed authored metadata, not the byte transfer table. Parametric
 * controls retain their existing Q16 gain; there is no sampled 256-entry LUT. */
export function prepareLinearCurvesV1(value: unknown): PreparedLinearCurvesV1 {
	const metadata = prepareLinearCurveMetadataCurrentV1(value);
	PREPARED.set(metadata.effect, metadata.channels); return metadata.effect;
}

function sample(curve: Curve, value: number): number {
	if (curve.identity) return value;
	const points = curve.points;
	let right = 1;
	while (right < points.length - 1 && value > points[right]!.x) right++;
	// A derived region center can round onto an endpoint at the extreme
	// subnormal split limit. Omit that zero-width segment, never divide by zero.
	while (right < points.length - 1 && points[right]!.x === points[right - 1]!.x) right++;
	while (right > 1 && points[right]!.x === points[right - 1]!.x) right--;
	const a = points[right - 1]!, b = points[right]!, slope = (b.y - a.y) / (b.x - a.x);
	// A slope-one identity segment preserves tiny samples without cancellation.
	return slope === 1 && a.x === a.y ? value : a.y + (value - a.x) * slope;
}

/** Endpoint segments extrapolate signed/HDR encoded coordinates. Master is
 * evaluated before each channel without a byte round between those operations. */
export function writeLinearCurvesEncodedV1(effect: PreparedLinearCurvesV1, red: number, green: number, blue: number, target: LinearColorChannelsV1): void {
	const curves = PREPARED.get(effect);
	if (!curves) throw new TypeError('Curves require their owning linear preparation.');
	target.red = sample(curves.red, sample(curves.master, red));
	target.green = sample(curves.green, sample(curves.master, green));
	target.blue = sample(curves.blue, sample(curves.master, blue));
}
