/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareCurvesEffectV1 } from '../video-curves-v1.ts';
import type { CurveChannelV1, PreparedCurvesEffectV1, VideoCurvePointsV1 } from '../video-curve-types-v1.ts';
import type { LinearColorChannelsV1 } from './pixel-frame-linear-chroma-v1.ts';

export type PreparedLinearCurvesV1 = PreparedCurvesEffectV1;
interface Curve { readonly points: VideoCurvePointsV1; readonly identity: boolean; }
type State = Readonly<Record<CurveChannelV1, Curve>>;
const PREPARED = new WeakMap<object, State>();
const CHANNELS = ['master', 'red', 'green', 'blue'] as const;
const REGIONS = ['Shadows', 'Darks', 'Lights', 'Highlights'] as const;

/** Reuse closed authored metadata, not the byte transfer table. Parametric
 * controls retain their existing Q16 gain; there is no sampled 256-entry LUT. */
export function prepareLinearCurvesV1(value: unknown): PreparedLinearCurvesV1 {
	const effect = prepareCurvesEffectV1(value), curves = {} as Record<CurveChannelV1, Curve>;
	for (const channel of CHANNELS) {
		let points: VideoCurvePointsV1;
		if (effect.type === 'point-curves-v1') points = effect.params[channel];
		else {
			const p = effect.params, edges = [0, p.shadowSplit!, p.midtoneSplit!, p.highlightSplit!, 1];
			points = Object.freeze([{ x: 0, y: 0 }, ...REGIONS.map((region, index) => {
				const x = edges[index]! + (edges[index + 1]! - edges[index]!) / 2;
				const gain = Math.round(p[`${channel}${region}`]! / 100 * 65536) / 65536;
				return Object.freeze({ x, y: x + gain * Math.min(x, 1 - x) });
			}), { x: 1, y: 1 }]);
		}
		curves[channel] = Object.freeze({ points, identity: points.every(point => point.x === point.y) });
	}
	PREPARED.set(effect, Object.freeze(curves)); return effect;
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
