/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionComposition } from './motion-composition.ts';
import { motionCompositionWorkArea } from './motion-composition-work-area.ts';
import { roundRational } from './timeline-time.ts';

/** Output samples n satisfying start <= n < end; an exact preview area may contain none. */
export function motionWorkAreaOutputFrames(composition: MotionComposition): Readonly<{ firstFrame: number; endFrame: number }> {
	const { startFrame, endFrame } = motionCompositionWorkArea(composition);
	return Object.freeze({ firstFrame: roundRational(startFrame.num, startFrame.den, 'directional', 'next'), endFrame: roundRational(endFrame.num, endFrame.den, 'directional', 'next') });
}
