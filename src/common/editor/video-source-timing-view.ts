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

export interface ExactSourcePosition {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

export interface BoundVideoSourceTimingView {
	readonly sourceId: string;
	readonly frameCount: number;
	readonly kind: 'cfr' | 'vfr';
}

export type BoundVideoSourceTimingAuthority = Readonly<
	{ readonly kind: 'cfr'; readonly frameCount: number; readonly rate: RationalRate }
	| { readonly kind: 'vfr'; readonly reference: Readonly<VideoTimingAssetReference> }
>;

type BoundVideoSourceTimingState = Readonly<{
	readonly info: BoundVideoSourceTimingView;
	readonly authority: BoundVideoSourceTimingAuthority;
} & (
	| {
		readonly kind: 'cfr';
		readonly frameDuration: InternalExact;
	}
	| {
		readonly kind: 'vfr';
		readonly timescale: bigint;
		readonly presentationTicks: readonly bigint[];
		readonly endTicks: bigint;
	}
)>;

interface InternalExact {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

const MAXIMUM_EXACT_BITS = 4_096;
const BOUND_VIDEO_SOURCE_TIMING_VIEWS = new WeakMap<object, BoundVideoSourceTimingState>();
const BOUND_VIDEO_SOURCE_TIMING_CACHE = new WeakMap<
	object,
	WeakMap<object, BoundVideoSourceTimingView>
>();

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

export function bindVideoSourceTimingView(
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
	sourceValue: unknown,
): BoundVideoSourceTimingView {
	if (!(timingViews instanceof Map)) throw new TypeError('Video timing views must be a ReadonlyMap.');
	if (!sourceValue || typeof sourceValue !== 'object' || Array.isArray(sourceValue)) {
		throw new TypeError('A canonical video source is required to bind source timing.');
	}
	const sourceObject = sourceValue as object;
	const cached = BOUND_VIDEO_SOURCE_TIMING_CACHE.get(timingViews)?.get(sourceObject);
	if (cached) return cached;
	const source = snapshotVideoSource(sourceValue);
	const sourceId = nonEmptyString(source.id, 'video source.id');
	const rawView = timingViews.get(sourceId);
	if (!rawView || typeof rawView !== 'object') {
		throw new ReferenceError(`Video source ${sourceId} has no verified timing view.`);
	}
	const capturedView = snapshotVideoTimingView(rawView, sourceId);
	const view = videoSourceTimingView(new Map([[sourceId, capturedView]]), source);
	let state: BoundVideoSourceTimingState;
	if (view.kind === 'cfr') {
		const rate = frameTrimRationalRate(view.rate, `timing view ${sourceId}.rate`);
		const info = Object.freeze({
			sourceId,
			frameCount: positiveSafeInteger(view.frameCount, `timing view ${sourceId}.frameCount`),
			kind: 'cfr' as const,
		});
		state = Object.freeze({
			info,
			authority: Object.freeze({ kind: 'cfr' as const, frameCount: info.frameCount, rate }),
			kind: 'cfr' as const,
			frameDuration: normalizeExact(BigInt(rate.den), BigInt(rate.num)),
		});
	} else {
		const info = Object.freeze({
			sourceId,
			frameCount: positiveSafeInteger(view.index.frameCount, `timing view ${sourceId}.frameCount`),
			kind: 'vfr' as const,
		});
		state = Object.freeze({
			info,
			authority: Object.freeze({ kind: 'vfr' as const, reference: view.reference }),
			kind: 'vfr' as const,
			timescale: BigInt(view.index.timescale),
			presentationTicks: view.index.presentationTicks,
			endTicks: view.index.endTicks,
		});
	}
	BOUND_VIDEO_SOURCE_TIMING_VIEWS.set(state.info, state);
	let sourceCache = BOUND_VIDEO_SOURCE_TIMING_CACHE.get(timingViews);
	if (!sourceCache) {
		sourceCache = new WeakMap<object, BoundVideoSourceTimingView>();
		BOUND_VIDEO_SOURCE_TIMING_CACHE.set(timingViews, sourceCache);
	}
	sourceCache.set(sourceObject, state.info);
	return state.info;
}

export function boundVideoSourceTimingViewInfo(value: unknown): BoundVideoSourceTimingView {
	return boundVideoSourceTimingState(value).info;
}

/** Inspect the exact persisted authority captured by an authenticated timing token. */
export function boundVideoSourceTimingAuthority(value: unknown): BoundVideoSourceTimingAuthority {
	return boundVideoSourceTimingState(value).authority;
}

export function videoSourceFrameTime(
	viewValue: BoundVideoSourceTimingView,
	positionValue: ExactSourcePosition,
): ExactSourceTime {
	const state = boundVideoSourceTimingState(viewValue);
	const position = sourceFramePosition(positionValue, state.info.frameCount);
	if (state.kind === 'cfr') return publicExact(multiplyExact(position.value, state.frameDuration));

	const startTicks = position.frameIndex === state.info.frameCount
		? state.endTicks
		: nonNullable(state.presentationTicks[position.frameIndex]);
	if (position.remainder === 0n) {
		return publicExact(normalizeExact(startTicks, state.timescale));
	}
	const endTicks = position.frameIndex + 1 === state.info.frameCount
		? state.endTicks
		: nonNullable(state.presentationTicks[position.frameIndex + 1]);
	const offset = multiplyExact(
		normalizeExact(position.remainder, position.value.denominator),
		normalizeExact(endTicks - startTicks, 1n),
	);
	const interpolatedTicks = addExact(normalizeExact(startTicks, 1n), offset);
	return publicExact(multiplyExact(interpolatedTicks, normalizeExact(1n, state.timescale)));
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

function boundVideoSourceTimingState(value: unknown): BoundVideoSourceTimingState {
	if (!value || typeof value !== 'object') {
		throw new TypeError('An authenticated bound video source timing token is required.');
	}
	const state = BOUND_VIDEO_SOURCE_TIMING_VIEWS.get(value);
	if (!state) {
		throw new TypeError('The video source timing token was not produced by bindVideoSourceTimingView.');
	}
	return state;
}

function snapshotVideoSource(value: unknown): FrameTrimDataRecord {
	const raw = snapshotData(value, [
		'id', 'kind', 'contentSha256', 'frameRate', 'sourceFrameCount', 'timingAsset', 'timingDecision',
	], 'video source');
	if (raw.kind !== 'video') throw new TypeError('Bound source timing requires a video source kind data property.');
	const decision = snapshotData(raw.timingDecision, ['mode', 'rate'], 'video source.timingDecision');
	return Object.freeze({
		...raw,
		frameRate: snapshotData(raw.frameRate, ['num', 'den'], 'video source.frameRate'),
		timingAsset: raw.timingAsset == null ? raw.timingAsset
			: snapshotTimingReference(raw.timingAsset, 'video source.timingAsset'),
		timingDecision: Object.freeze({
			...decision,
			rate: snapshotData(decision.rate, ['num', 'den'], 'video source.timingDecision.rate'),
		}),
	});
}

function snapshotVideoTimingView(value: unknown, sourceId: string): VideoSourceTimingView {
	const raw = value as Record<string, unknown>;
	const kind = dataProperty(raw, 'kind', `timing view ${sourceId}`);
	if (kind === 'cfr') return Object.freeze({
		kind,
		rate: frameTrimRationalRate(snapshotData(dataProperty(raw, 'rate', `timing view ${sourceId}`), ['num', 'den'], `timing view ${sourceId}.rate`), `timing view ${sourceId}.rate`),
		frameCount: dataProperty(raw, 'frameCount', `timing view ${sourceId}`) as number,
	});
	if (kind !== 'vfr') throw new RangeError(`Video timing view ${sourceId} has an unsupported kind.`);
	return Object.freeze({
		kind,
		reference: snapshotTimingReference(dataProperty(raw, 'reference', `timing view ${sourceId}`), `timing view ${sourceId}.reference`),
		index: dataProperty(raw, 'index', `timing view ${sourceId}`) as VideoTimingIndex,
	});
}

function snapshotTimingReference(value: unknown, name: string): Readonly<VideoTimingAssetReference> {
	return normalizeVideoTimingAssetReference(snapshotData(value, [
		'encoding', 'storageKey', 'sha256', 'sourceSha256', 'byteLength',
		'frameCount', 'timescale', 'finalFrameDurationTicks',
	], name));
}

function snapshotData(value: unknown, keys: readonly string[], name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const result: Record<string, unknown> = {};
	for (const key of keys) result[key] = dataProperty(value as Record<string, unknown>, key, name);
	return Object.freeze(result);
}

function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property, not an accessor.`);
	}
	return descriptor.value;
}

function sourceFramePosition(
	value: unknown,
	frameCount: number,
): Readonly<{
	readonly value: InternalExact;
	readonly frameIndex: number;
	readonly remainder: bigint;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('An exact source-frame position record is required.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== 2 || !keys.includes('numerator') || !keys.includes('denominator')) {
		throw new TypeError('An exact source-frame position requires only numerator and denominator.');
	}
	const numeratorDescriptor = Object.getOwnPropertyDescriptor(value, 'numerator');
	const denominatorDescriptor = Object.getOwnPropertyDescriptor(value, 'denominator');
	if (!numeratorDescriptor?.enumerable || !Object.hasOwn(numeratorDescriptor, 'value')
		|| !denominatorDescriptor?.enumerable || !Object.hasOwn(denominatorDescriptor, 'value')) {
		throw new TypeError('Exact source-frame position fields must be enumerable data properties, not accessors.');
	}
	const numerator = numeratorDescriptor.value;
	const denominator = denominatorDescriptor.value;
	if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint') {
		throw new TypeError('Exact source-frame position numerator and denominator must be BigInt.');
	}
	assertExactBigInt(numerator);
	assertExactBigInt(denominator);
	if (denominator <= 0n) {
		throw new RangeError('Exact source-frame position denominator must be positive.');
	}
	if (numerator < 0n) throw new RangeError('Exact source-frame position is outside the source bound.');
	if (greatestCommonDivisor(numerator, denominator) !== 1n) {
		throw new RangeError('Exact source-frame position must be canonically reduced.');
	}
	const frameIndexBigInt = numerator / denominator;
	const remainder = numerator % denominator;
	const frameCountBigInt = BigInt(frameCount);
	if (frameIndexBigInt > frameCountBigInt
		|| (frameIndexBigInt === frameCountBigInt && remainder !== 0n)) {
		throw new RangeError('Exact source-frame position is outside the bound timing view.');
	}
	return Object.freeze({
		value: Object.freeze({ numerator, denominator }),
		frameIndex: Number(frameIndexBigInt),
		remainder,
	});
}

function multiplyExact(left: InternalExact, right: InternalExact): InternalExact {
	const leftCancellation = greatestCommonDivisor(absoluteBigInt(left.numerator), right.denominator);
	const rightCancellation = greatestCommonDivisor(absoluteBigInt(right.numerator), left.denominator);
	return normalizeExact(
		checkedMultiply(left.numerator / leftCancellation, right.numerator / rightCancellation),
		checkedMultiply(left.denominator / rightCancellation, right.denominator / leftCancellation),
	);
}

function addExact(left: InternalExact, right: InternalExact): InternalExact {
	const commonDenominator = greatestCommonDivisor(left.denominator, right.denominator);
	const leftScale = right.denominator / commonDenominator;
	const rightScale = left.denominator / commonDenominator;
	return normalizeExact(
		checkedAdd(
			checkedMultiply(left.numerator, leftScale),
			checkedMultiply(right.numerator, rightScale),
		),
		checkedMultiply(left.denominator, leftScale),
	);
}

function normalizeExact(numerator: bigint, denominator: bigint): InternalExact {
	if (denominator === 0n) throw new RangeError('An exact source-time denominator cannot be zero.');
	if (denominator < 0n) {
		numerator = -numerator;
		denominator = -denominator;
	}
	assertExactBigInt(numerator);
	assertExactBigInt(denominator);
	const divisor = greatestCommonDivisor(absoluteBigInt(numerator), denominator);
	const result = Object.freeze({
		numerator: numerator / divisor,
		denominator: denominator / divisor,
	});
	assertExactBigInt(result.numerator);
	assertExactBigInt(result.denominator);
	return result;
}

function checkedMultiply(left: bigint, right: bigint): bigint {
	if (left === 0n || right === 0n) return 0n;
	if (bitLength(left) + bitLength(right) - 1 > MAXIMUM_EXACT_BITS) {
		throw exactComplexityError();
	}
	const result = left * right;
	assertExactBigInt(result);
	return result;
}

function checkedAdd(left: bigint, right: bigint): bigint {
	const result = left + right;
	assertExactBigInt(result);
	return result;
}

function assertExactBigInt(value: bigint): void {
	if (bitLength(value) > MAXIMUM_EXACT_BITS) throw exactComplexityError();
}

function exactComplexityError(): RangeError {
	return new RangeError(`Exact source-time complexity exceeds ${String(MAXIMUM_EXACT_BITS)} bits.`);
}

function bitLength(value: bigint): number {
	return absoluteBigInt(value).toString(2).length;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	while (right !== 0n) {
		const remainder = left % right;
		left = right;
		right = remainder;
	}
	return left || 1n;
}

function absoluteBigInt(value: bigint): bigint {
	return value < 0n ? -value : value;
}

function publicExact(value: InternalExact): ExactSourceTime {
	return Object.freeze({ numerator: value.numerator, denominator: value.denominator });
}

function nonNullable<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new RangeError('Expected a bounded video source timing value.');
	return value;
}
