/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionVector2 } from './motion-property.ts';
import { motionDepthOfFieldSamples } from './motion-temporal-settings.ts';
import { motionNumber } from './motion-values.ts';

export const MOTION_PINHOLE_LENS: readonly MotionVector2[] = Object.freeze([Object.freeze([0, 0]) as MotionVector2]);
/** Deterministic paired disk strata have zero mean; one declared sample uses the centered pinhole. Aperture is diameter. */
export function motionLensSamples(aperture: number, count: number): readonly MotionVector2[] {
	motionNumber(aperture, 'camera aperture', 0, 32768); motionDepthOfFieldSamples(count);
	if (!aperture || count === 1) return MOTION_PINHOLE_LENS;
	const pairs = Math.floor(count / 2); const samples: MotionVector2[] = count % 2 ? [[0, 0]] : [];
	for (let index = 0; index < pairs; index++) {
		const radius = aperture / 2 * Math.sqrt((index + 0.5) / pairs); const angle = index * Math.PI * (3 - Math.sqrt(5));
		const x = radius * Math.cos(angle); const y = radius * Math.sin(angle); samples.push([x, y], [-x, -y]);
	}
	return Object.freeze(samples.map((point) => Object.freeze(point)));
}
