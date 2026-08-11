/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	frameTrimRationalRate,
	nonEmptyString,
	positiveSafeInteger,
	safeInteger,
	sameFrameTrimRate,
	type FrameTrimDataRecord,
} from './frame-canonical-edge-trim-domain.ts';
import { roundRational, type RationalRate } from './timeline-time.ts';
import {
	isVideoTimingIndexVerifiedForReference,
	normalizeVideoTimingAssetReference,
	type VideoTimingAssetReference,
	type VideoTimingIndex,
} from './video-timing-asset.ts';

export type VideoSourceTimingView = Readonly<{
	readonly kind: 'cfr';
	readonly rate: RationalRate;
	readonly frameCount: number;
}> | Readonly<{
	readonly kind: 'vfr';
	readonly reference: Readonly<VideoTimingAssetReference>;
	readonly index: VideoTimingIndex;
}>;

export interface ExactSourceTime {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

export interface VideoBoundaryPointMapping {
	readonly boundary: number;
	/** Inclusive lower point-cell edge; null means negative infinity. */
	readonly cellLower: ExactSourceTime | null;
	/** Exclusive upper point-cell edge; null means positive infinity. */
	readonly cellUpper: ExactSourceTime | null;
}

export function videoSourceTimingView(
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
	source: FrameTrimDataRecord,
): VideoSourceTimingView {
	if (!(timingViews instanceof Map)) throw new TypeError('Video timing views must be a ReadonlyMap.');
	const sourceId = nonEmptyString(source.id, 'video source.id');
	const view = timingViews.get(sourceId);
	if (!view || typeof view !== 'object') {
		throw new ReferenceError(`Video source ${sourceId} has no verified timing view.`);
	}
	const sourceFrameCount = positiveSafeInteger(
		source.sourceFrameCount,
		`video source ${sourceId}.sourceFrameCount`,
	);
	const timingDecision = source.timingDecision;
	if (!timingDecision || typeof timingDecision !== 'object' || Array.isArray(timingDecision)) {
		throw new TypeError(`Video source ${sourceId} has no persisted timing decision.`);
	}
	const timingMode = (timingDecision as FrameTrimDataRecord).mode;
	const sourceRate = frameTrimRationalRate(source.frameRate, `video source ${sourceId}.frameRate`);
	const decisionRate = frameTrimRationalRate(
		(timingDecision as FrameTrimDataRecord).rate,
		`video source ${sourceId}.timingDecision.rate`,
	);
	if (!sameFrameTrimRate(sourceRate, decisionRate)) {
		throw new RangeError(`Video timing decision ${sourceId} disagrees with the source rate.`);
	}
	if (view.kind === 'cfr') {
		if (timingMode !== 'conform-cfr-at-ingest') {
			throw new RangeError(`CFR timing view ${sourceId} disagrees with the persisted timing decision.`);
		}
		const rate = frameTrimRationalRate(view.rate, `timing view ${sourceId}.rate`);
		if (!sameFrameTrimRate(rate, sourceRate) || !sameFrameTrimRate(rate, decisionRate)) {
			throw new RangeError(`CFR timing view ${sourceId} disagrees with the source rate.`);
		}
		if (positiveSafeInteger(view.frameCount, `timing view ${sourceId}.frameCount`) !== sourceFrameCount) {
			throw new RangeError(`CFR timing view ${sourceId} disagrees with the source frame count.`);
		}
		return view;
	}
	if (view.kind !== 'vfr') throw new RangeError(`Video timing view ${sourceId} has an unsupported kind.`);
	if (timingMode !== 'exact' || source.timingAsset == null) {
		throw new RangeError(`VFR timing view ${sourceId} disagrees with the persisted timing decision.`);
	}
	if (!isVideoTimingIndexVerifiedForReference(view.index, view.reference)) {
		throw new TypeError(`VFR timing view ${sourceId} was not produced by verified timing-asset bytes.`);
	}
	validateVfrIndex(view.index, sourceId);
	if (view.index.frameCount !== sourceFrameCount) {
		throw new RangeError(`VFR timing view ${sourceId} disagrees with the source frame count.`);
	}
	const persistedReference = normalizeVideoTimingAssetReference(source.timingAsset);
	const suppliedReference = normalizeVideoTimingAssetReference(view.reference);
	for (const field of [
		'encoding', 'storageKey', 'sha256', 'sourceSha256', 'byteLength',
		'frameCount', 'timescale', 'finalFrameDurationTicks',
	] as const) {
		if (persistedReference[field] !== suppliedReference[field]) {
			throw new RangeError(`VFR timing view ${sourceId} disagrees with its persisted timing-asset identity.`);
		}
	}
	if (source.contentSha256 !== suppliedReference.sourceSha256
		|| view.index.encoding !== suppliedReference.encoding
		|| suppliedReference.frameCount !== view.index.frameCount
		|| suppliedReference.timescale !== view.index.timescale
		|| suppliedReference.finalFrameDurationTicks !== view.index.finalFrameDurationTicks.toString()) {
		throw new RangeError(`VFR timing view ${sourceId} disagrees with the persisted timing-asset summary.`);
	}
	return view;
}

export function videoBoundaryTime(
	view: VideoSourceTimingView,
	frameValue: number,
): ExactSourceTime {
	const frame = safeInteger(frameValue, 'video source boundary');
	const frameCount = timingFrameCount(view);
	if (frame < 0 || frame > frameCount) throw new RangeError('Video source boundary exceeds its timing view.');
	if (view.kind === 'cfr') {
		return fraction(BigInt(frame) * BigInt(view.rate.den), BigInt(view.rate.num));
	}
	return fraction(
		frame === view.index.frameCount
			? view.index.endTicks
			: view.index.presentationTicks[frame]!,
		BigInt(view.index.timescale),
	);
}

export function shiftSourceTime(base: ExactSourceTime, delta: ExactSourceTime): ExactSourceTime {
	return fraction(
		base.numerator * delta.denominator + delta.numerator * base.denominator,
		base.denominator * delta.denominator,
	);
}

export function sourceTimeDifference(
	left: ExactSourceTime,
	right: ExactSourceTime,
): ExactSourceTime {
	return fraction(
		left.numerator * right.denominator - right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

export function sourceTimeToVideoBoundary(
	view: VideoSourceTimingView,
	time: ExactSourceTime,
): number {
	if (view.kind === 'cfr') {
		return roundRational(
			time.numerator * BigInt(view.rate.num),
			time.denominator * BigInt(view.rate.den),
			'point',
		);
	}
	const boundaries = view.index.presentationTicks;
	const targetNumerator = time.numerator * BigInt(view.index.timescale);
	const targetDenominator = time.denominator;
	if (targetNumerator <= 0n) return 0;
	if (targetNumerator >= view.index.endTicks * targetDenominator) return view.index.frameCount;
	let lower = 0;
	let upper = view.index.frameCount;
	while (lower + 1 < upper) {
		const middle = lower + Math.floor((upper - lower) / 2);
		if (boundaries[middle]! * targetDenominator <= targetNumerator) lower = middle;
		else upper = middle;
	}
	const lowerTicks = boundaries[lower]!;
	const upperTicks = upper === view.index.frameCount ? view.index.endTicks : boundaries[upper]!;
	const below = targetNumerator - lowerTicks * targetDenominator;
	const above = upperTicks * targetDenominator - targetNumerator;
	return below < above ? lower : upper;
}

export function mapVideoBoundaryPoint(
	view: VideoSourceTimingView,
	time: ExactSourceTime,
): VideoBoundaryPointMapping {
	const boundary = sourceTimeToVideoBoundary(view, time);
	return {
		boundary,
		cellLower: boundary === 0 ? null : videoBoundaryMidpoint(view, boundary - 1, boundary),
		cellUpper: boundary === timingFrameCount(view)
			? null
			: videoBoundaryMidpoint(view, boundary, boundary + 1),
	};
}

export function compareSourceTimes(left: ExactSourceTime, right: ExactSourceTime): -1 | 0 | 1 {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function negateSourceTime(value: ExactSourceTime): ExactSourceTime {
	return fraction(-value.numerator, value.denominator);
}

export function sourceTimeToAudioFrame(time: ExactSourceTime, sampleRateValue: unknown): number {
	const sampleRate = positiveSafeInteger(sampleRateValue, 'audio source.sampleRate');
	return roundRational(time.numerator * BigInt(sampleRate), time.denominator, 'point');
}

export function audioBoundaryTime(frameValue: number, sampleRateValue: unknown): ExactSourceTime {
	const frame = safeInteger(frameValue, 'audio source boundary');
	const sampleRate = positiveSafeInteger(sampleRateValue, 'audio source.sampleRate');
	return fraction(BigInt(frame), BigInt(sampleRate));
}

function timingFrameCount(view: VideoSourceTimingView): number {
	return view.kind === 'cfr'
		? positiveSafeInteger(view.frameCount, 'CFR timing frameCount')
		: positiveSafeInteger(view.index.frameCount, 'VFR timing frameCount');
}

function videoBoundaryMidpoint(
	view: VideoSourceTimingView,
	leftFrame: number,
	rightFrame: number,
): ExactSourceTime {
	const left = videoBoundaryTime(view, leftFrame);
	const right = videoBoundaryTime(view, rightFrame);
	return fraction(
		left.numerator * right.denominator + right.numerator * left.denominator,
		2n * left.denominator * right.denominator,
	);
}

function validateVfrIndex(indexValue: unknown, sourceId: string): void {
	if (!indexValue || typeof indexValue !== 'object' || Array.isArray(indexValue)) {
		throw new TypeError(`VFR timing view ${sourceId} requires an index.`);
	}
	const index = indexValue as Readonly<Record<string, unknown>>;
	const timescale = positiveSafeInteger(index.timescale, `timing view ${sourceId}.timescale`);
	const frameCount = positiveSafeInteger(index.frameCount, `timing view ${sourceId}.frameCount`);
	if (!Array.isArray(index.presentationTicks) || index.presentationTicks.length !== frameCount) {
		throw new RangeError(`VFR timing view ${sourceId} PTS must match its frame count.`);
	}
	let prior: bigint | null = null;
	for (const tick of index.presentationTicks) {
		if (typeof tick !== 'bigint' || tick < 0n || (prior !== null && tick <= prior)) {
			throw new RangeError(`VFR timing view ${sourceId} PTS must be monotonic non-negative ticks.`);
		}
		prior = tick;
	}
	if (index.presentationTicks[0] !== 0n || typeof index.finalFrameDurationTicks !== 'bigint'
		|| index.finalFrameDurationTicks <= 0n || typeof index.endTicks !== 'bigint'
		|| index.endTicks !== prior! + index.finalFrameDurationTicks || timescale < 1) {
		throw new RangeError(`VFR timing view ${sourceId} has invalid endpoints.`);
	}
}

function fraction(numerator: bigint, denominator: bigint): ExactSourceTime {
	if (denominator <= 0n) throw new RangeError('An exact source-time denominator must be positive.');
	return { numerator, denominator };
}
