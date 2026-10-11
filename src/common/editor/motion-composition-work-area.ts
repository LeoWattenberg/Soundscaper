/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionComposition } from './motion-composition.ts';
import { compareRationals, type Rational } from './timeline-time.ts';
import { freezeMotionValue, motionInteger, motionRational, motionRecord } from './motion-values.ts';

export interface MotionWorkArea { readonly startFrame: Rational; readonly endFrame: Rational }
export function normalizeMotionWorkArea(value: unknown, durationFrames: number): MotionWorkArea {
	const duration = motionInteger(durationFrames, 'composition duration', 1, 100_000_000);
	const record = motionRecord(value, ['startFrame', 'endFrame'], 'composition work area');
	const startFrame = motionRational(record.startFrame, 'work area start frame'), endFrame = motionRational(record.endFrame, 'work area end frame');
	if (startFrame.num < 0 || compareRationals(startFrame, endFrame) >= 0 || compareRationals(endFrame, duration) > 0) throw new RangeError('Work-area range must be nonempty and within the composition duration.');
	return freezeMotionValue({ startFrame, endFrame });
}
/** An absent work area means the whole composition; resolving it never modifies saved intent. */
export function motionCompositionWorkArea(composition: MotionComposition): MotionWorkArea {
	return composition.workArea ?? freezeMotionValue({ startFrame: { num: 0, den: 1 }, endFrame: { num: composition.durationFrames, den: 1 } });
}
