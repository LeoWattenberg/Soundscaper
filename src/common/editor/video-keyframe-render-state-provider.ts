/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import { AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR } from './timeline-coordinate-limits.ts';
import {
	normalizeRational,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';
import {
	compileVideoKeyframedClipState,
	evaluateVideoKeyframedClipState,
	type VideoKeyframedClipState,
} from './video-keyframe-state.ts';
import {
	resolveVideoRenderDescription,
	type VideoRenderCanvas,
	type VideoRenderDescription,
	type VideoRenderDisplaySize,
} from './video-render-description.ts';

export interface VideoKeyframeRenderStateRequest {
	/** One video occurrence from the provider's immutable project snapshot. */
	readonly clip: unknown;
	/** Exact sequence-frame position local to the visible clip. */
	readonly localSequencePosition: RationalInput;
	readonly sourceDisplaySize: VideoRenderDisplaySize;
	readonly canvas: VideoRenderCanvas;
	/** An independent timeline/transition weight multiplied by authored opacity. */
	readonly transitionWeightStart?: number;
	/** Defaults to transitionWeightStart for a static frame or interval. */
	readonly transitionWeightEnd?: number;
}

export interface VideoKeyframeRenderTransitionWeights {
	readonly start: number;
	readonly end: number;
}

export interface VideoKeyframeRenderState extends VideoKeyframedClipState {
	readonly transitionWeights: VideoKeyframeRenderTransitionWeights;
	readonly renderDescription: VideoRenderDescription;
}

export interface VideoKeyframeRenderStateProvider {
	resolve(request: VideoKeyframeRenderStateRequest): VideoKeyframeRenderState;
}

type CompiledClipState = ReturnType<typeof compileVideoKeyframedClipState>;

interface CompiledClipEntry {
	readonly compiled: CompiledClipState;
}

interface QuerySnapshot {
	readonly clip: object;
	readonly position: Rational;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly canvasWidth: number;
	readonly canvasHeight: number;
	readonly transitionStart: number;
	readonly transitionEnd: number;
}

interface CurrentFrameCache extends QuerySnapshot {
	readonly state: VideoKeyframeRenderState;
}

const REQUEST_FIELDS = Object.freeze([
	'clip', 'localSequencePosition', 'sourceDisplaySize', 'canvas',
	'transitionWeightStart', 'transitionWeightEnd',
]);
const REQUIRED_REQUEST_FIELDS = Object.freeze([
	'clip', 'localSequencePosition', 'sourceDisplaySize', 'canvas',
]);

/**
 * Create one renderer-neutral authority for an immutable project snapshot.
 *
 * Clip object identity is the snapshot/version boundary: each queried clip is
 * compiled lazily once in a WeakMap. Callers create a new provider when they
 * replace the project snapshot. No sampled curve or frame table is retained;
 * only the most recently resolved frame may be reused.
 */
export function createVideoKeyframeRenderStateProvider(): VideoKeyframeRenderStateProvider {
	const compiledByClip = new WeakMap<object, CompiledClipEntry>();
	let currentFrame: CurrentFrameCache | null = null;

	function resolve(requestValue: VideoKeyframeRenderStateRequest): VideoKeyframeRenderState {
		const query = normalizeQuery(requestValue);
		if (currentFrame && sameQuery(currentFrame, query)) return currentFrame.state;
		currentFrame = null;

		let entry = compiledByClip.get(query.clip);
		if (!entry) {
			entry = Object.freeze({ compiled: compileClip(query.clip) });
			compiledByClip.set(query.clip, entry);
		}
		const evaluated = evaluateVideoKeyframedClipState(entry.compiled, query.position);
		const transitionWeights = Object.freeze({
			start: query.transitionStart,
			end: query.transitionEnd,
		});
		const state = Object.freeze({
			composition: evaluated.composition,
			videoEffects: evaluated.videoEffects,
			transitionWeights,
			renderDescription: resolveVideoRenderDescription({
				composition: evaluated.composition,
				sourceDisplaySize: {
					width: query.sourceWidth,
					height: query.sourceHeight,
				},
				canvas: {
					width: query.canvasWidth,
					height: query.canvasHeight,
				},
				opacityStart: query.transitionStart,
				opacityEnd: query.transitionEnd,
			}),
		});
		currentFrame = Object.freeze({ ...query, state });
		return state;
	}

	return Object.freeze({ resolve });
}

function compileClip(clip: object): CompiledClipState {
	const name = 'video keyframe render clip';
	if (clipDataProperty(clip, 'kind', name) !== 'video') {
		throw new RangeError(`${name}.kind must be video.`);
	}
	const sequenceFrameCount = positiveSafeInteger(
		clipDataProperty(clip, 'sequenceFrameCount', name),
		`${name}.sequenceFrameCount`,
	);
	return compileVideoKeyframedClipState({
		videoKeyframes: clipDataProperty(clip, 'videoKeyframes', name),
		sequenceFrameCount: { num: sequenceFrameCount, den: 1 },
		composition: clipDataProperty(clip, 'videoComposition', name),
		videoEffects: clipDataProperty(clip, 'videoEffects', name),
	});
}

function normalizeQuery(value: VideoKeyframeRenderStateRequest): QuerySnapshot {
	const request = readClosedDomainRecord(
		value,
		'video keyframe render-state request',
		REQUEST_FIELDS,
		REQUIRED_REQUEST_FIELDS,
	);
	const source = dimensions(
		field(request, 'sourceDisplaySize', 'video keyframe render-state request'),
		'video keyframe source display size',
	);
	const canvas = dimensions(
		field(request, 'canvas', 'video keyframe render-state request'),
		'video keyframe render canvas',
	);
	const transitionStart = unitInterval(
		optionalField(request, 'transitionWeightStart') ?? 1,
		'transitionWeightStart',
	);
	const transitionEnd = unitInterval(
		optionalField(request, 'transitionWeightEnd') ?? transitionStart,
		'transitionWeightEnd',
	);
	return Object.freeze({
		clip: clipObject(field(request, 'clip', 'video keyframe render-state request')),
		position: exactPosition(field(request, 'localSequencePosition', 'video keyframe render-state request')),
		sourceWidth: source.width,
		sourceHeight: source.height,
		canvasWidth: canvas.width,
		canvasHeight: canvas.height,
		transitionStart,
		transitionEnd,
	});
}

function dimensions(value: unknown, name: string): Readonly<{ width: number; height: number }> {
	const record = readClosedDomainRecord(value, name, ['width', 'height']);
	return Object.freeze({
		width: positiveSafeInteger(field(record, 'width', name), `${name}.width`),
		height: positiveSafeInteger(field(record, 'height', name), `${name}.height`),
	});
}

function exactPosition(value: unknown): Rational {
	if (typeof value === 'number') {
		if (Object.is(value, -0)) throw new RangeError('localSequencePosition must not be negative zero.');
		return normalizeRational(value, {
			maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR,
		});
	}
	const record = readClosedDomainRecord(value, 'localSequencePosition', ['num', 'den']);
	const num = field(record, 'num', 'localSequencePosition');
	const den = field(record, 'den', 'localSequencePosition');
	if (Object.is(num, -0) || Object.is(den, -0)) {
		throw new RangeError('localSequencePosition must not contain negative zero.');
	}
	return normalizeRational({ num: numberValue(num, 'localSequencePosition.num'), den: numberValue(den, 'localSequencePosition.den') }, {
		maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR,
	});
}

function clipObject(value: unknown): object {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A video keyframe render clip must be an object.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('A video keyframe render clip must be a plain object.');
	}
	return value;
}

function clipDataProperty(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable own data property.`);
	}
	return descriptor.value;
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

function optionalField(record: ClosedDomainRecord, key: string): unknown {
	return Object.hasOwn(record, key)
		? readClosedDomainField(record, key, 'video keyframe render-state request')
		: undefined;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return value;
}

function numberValue(value: unknown, name: string): number {
	if (typeof value !== 'number') throw new TypeError(`${name} must be a number.`);
	return value;
}

function unitInterval(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`${name} must be a finite number from 0 through 1.`);
	}
	if (Object.is(value, -0)) throw new RangeError(`${name} must not be negative zero.`);
	return value;
}

function sameQuery(left: QuerySnapshot, right: QuerySnapshot): boolean {
	return left.clip === right.clip
		&& left.position.num === right.position.num
		&& left.position.den === right.position.den
		&& left.sourceWidth === right.sourceWidth
		&& left.sourceHeight === right.sourceHeight
		&& left.canvasWidth === right.canvasWidth
		&& left.canvasHeight === right.canvasHeight
		&& left.transitionStart === right.transitionStart
		&& left.transitionEnd === right.transitionEnd;
}
