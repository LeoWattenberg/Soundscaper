/* SPDX-License-Identifier: AGPL-3.0-only */
import { compareRationals, type Rational } from './timeline-time.ts';
import { freezeMotionValue, motionInteger, motionRational, motionRecord } from './motion-values.ts';

/** Shutter endpoints are offsets on the containing composition's frame grid. */
export interface MotionTemporalSettings {
	readonly shutterOpenFrames: Rational; readonly shutterCloseFrames: Rational; readonly samples: number;
}
export function normalizeMotionTemporalSettings(value: unknown): MotionTemporalSettings {
	const record = motionRecord(value, ['shutterOpenFrames', 'shutterCloseFrames', 'samples'], 'temporal quality');
	const shutterOpenFrames = motionRational(record.shutterOpenFrames, 'shutter open frame');
	const shutterCloseFrames = motionRational(record.shutterCloseFrames, 'shutter close frame');
	if (compareRationals(shutterOpenFrames, -1) < 0 || compareRationals(shutterCloseFrames, 1) > 0 || compareRationals(shutterOpenFrames, shutterCloseFrames) > 0) throw new RangeError('Shutter endpoints must be ordered within minus one through one frame.');
	return freezeMotionValue({ shutterOpenFrames, shutterCloseFrames, samples: motionInteger(record.samples, 'temporal samples', 1, 64) });
}
export function motionDepthOfFieldSamples(value: unknown): number { return motionInteger(value, 'depth-of-field samples', 1, 64); }
