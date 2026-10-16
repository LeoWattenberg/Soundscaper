/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareCurvesEffectV1 } from '../video-curves-v1.ts';
import type { CurveChannelV1, PreparedCurvesEffectV1, VideoCurvePointsV1 } from '../video-curve-types-v1.ts';

export interface LinearCurveChannelMetadataCurrentV1 {
	readonly points: VideoCurvePointsV1;
	readonly identity: boolean;
}
export interface LinearCurveMetadataCurrentV1 {
	readonly effect: PreparedCurvesEffectV1;
	readonly channels: Readonly<Record<CurveChannelV1, Readonly<LinearCurveChannelMetadataCurrentV1>>>;
}
const REGIONS = ['Shadows', 'Darks', 'Lights', 'Highlights'] as const;

/** One detached native knot definition. Parametric gains retain their authored
 * Q16 rounding; tiny region centers may coincide with endpoints and remain
 * present for the established native sampler's zero-width-segment policy. */
export function prepareLinearCurveMetadataCurrentV1(value: unknown): Readonly<LinearCurveMetadataCurrentV1> {
	const effect = prepareCurvesEffectV1(value);
	const channel = (name: CurveChannelV1): Readonly<LinearCurveChannelMetadataCurrentV1> => {
		let points: VideoCurvePointsV1;
		if (effect.type === 'point-curves-v1') points = effect.params[name];
		else {
			const p = effect.params, edges = [0, p.shadowSplit!, p.midtoneSplit!, p.highlightSplit!, 1];
			points = Object.freeze([{ x: 0, y: 0 }, ...REGIONS.map((region, index) => {
				const x = edges[index]! + (edges[index + 1]! - edges[index]!) / 2;
				const gain = Math.round(p[`${name}${region}`]! / 100 * 65536) / 65536;
				return Object.freeze({ x, y: x + gain * Math.min(x, 1 - x) });
			}), { x: 1, y: 1 }].map(point => Object.freeze(point)));
		}
		return Object.freeze({ points, identity: points.every(point => point.x === point.y) });
	};
	return Object.freeze({ effect, channels: Object.freeze({ master: channel('master'), red: channel('red'), green: channel('green'), blue: channel('blue') }) });
}
