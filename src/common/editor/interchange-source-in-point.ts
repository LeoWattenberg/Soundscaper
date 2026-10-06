/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameAtSample } from './sequence-frame-navigation.ts';
import type { SequenceRationalRate } from './sequence-timecode.ts';
import { roundRational } from './timeline-time.ts';
import { videoBoundaryTime, videoSourceTimingView } from './video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from './video-source-timing-views.ts';

/** Source ordinals and legacy audio samples must cross different time grids. */
export function interchangeSourceInPoint(
	clip: Readonly<Record<string, unknown>>,
	source: Readonly<Record<string, unknown>> | undefined,
	sequenceRate: SequenceRationalRate,
	sampleRate: number,
): number {
	const stated = Number(clip.sourceStartFrame ?? 0);
	if (!Number.isSafeInteger(stated) || stated < 0) {
		throw new RangeError('clip.sourceStartFrame must be a non-negative safe integer.');
	}
	if (clip.kind !== 'video' || !Object.hasOwn(clip, 'sourceInFrame')) {
		return sequenceFrameAtSample(stated, sequenceRate, sampleRate);
	}
	if (!source) throw new ReferenceError(`Video source ${String(clip.sourceId)} is missing.`);
	if (source.timingDecision != null) {
		const view = videoSourceTimingView(resolveVideoSourceTimingViews({ sources: [source] }), source);
		const time = videoBoundaryTime(view, stated);
		return roundRational(
			time.numerator * BigInt(sequenceRate.num),
			time.denominator * BigInt(sequenceRate.den),
			'point',
		);
	}
	const rate = source.frameRate as Readonly<Record<string, unknown>> | undefined;
	const num = Number(rate?.num);
	const den = Number(rate?.den);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) {
		throw new TypeError(`Video source ${String(source.id)} has no exact source frame rate.`);
	}
	return roundRational(
		BigInt(stated) * BigInt(sequenceRate.num) * BigInt(den),
		BigInt(sequenceRate.den) * BigInt(num),
		'point',
	);
}
