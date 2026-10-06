/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SequenceRationalRate } from './sequence-timecode.ts';
import { roundRational } from './timeline-time.ts';
import { videoBoundaryTime, videoSourceTimingView, type ExactSourceTime } from './video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from './video-source-timing-views.ts';

/** Source ordinals and legacy audio samples must cross different time grids. */
export function interchangeSourceInPoint(
	clip: Readonly<Record<string, unknown>>,
	source: Readonly<Record<string, unknown>> | undefined,
	sequenceRate: SequenceRationalRate,
	sampleRate: number,
): number {
	const time = sourceInTime(clip, source, sampleRate);
	return roundRational(time.numerator * BigInt(sequenceRate.num), time.denominator * BigInt(sequenceRate.den), 'point');
}

/** Seconds-based interchange must read the same authored source boundary. */
export function interchangeSourceInSeconds(
	clip: Readonly<Record<string, unknown>>,
	source: Readonly<Record<string, unknown>> | undefined,
	sampleRate: number,
): number {
	const time = sourceInTime(clip, source, sampleRate);
	return Number(time.numerator) / Number(time.denominator);
}

function sourceInTime(
	clip: Readonly<Record<string, unknown>>,
	source: Readonly<Record<string, unknown>> | undefined,
	sampleRate: number,
): ExactSourceTime {
	const stated = Number(clip.sourceStartFrame ?? 0);
	if (!Number.isSafeInteger(stated) || stated < 0) {
		throw new RangeError('clip.sourceStartFrame must be a non-negative safe integer.');
	}
	if (clip.kind !== 'video' || !Object.hasOwn(clip, 'sourceInFrame')) {
		return { numerator: BigInt(stated), denominator: BigInt(sampleRate) };
	}
	if (!source) throw new ReferenceError(`Video source ${String(clip.sourceId)} is missing.`);
	if (source.timingDecision != null) {
		const view = videoSourceTimingView(resolveVideoSourceTimingViews({ sources: [source] }), source);
		return videoBoundaryTime(view, stated);
	}
	const rate = source.frameRate as Readonly<Record<string, unknown>> | undefined;
	const num = Number(rate?.num);
	const den = Number(rate?.den);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) {
		throw new TypeError(`Video source ${String(source.id)} has no exact source frame rate.`);
	}
	return { numerator: BigInt(stated) * BigInt(den), denominator: BigInt(num) };
}
