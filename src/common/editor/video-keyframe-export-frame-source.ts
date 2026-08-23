/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveActiveVideoLayers,
	videoTimelineDurationFrames,
} from './video-timeline.js';
import {
	createVideoKeyframeRenderStateProvider,
	type VideoKeyframeRenderStateProvider,
} from './video-keyframe-render-state-provider.ts';
import type { VideoKeyframePreviewStateRequest } from './video-keyframe-preview-state.ts';
import type { VideoRetimeFrameDescriptor } from './video-retime-frame-dispatch.ts';
import { isVideoCanvasFit, type VideoCanvasFit } from './video-canvas-fit.ts';
import {
	normalizeVideoDeliveryColor,
	videoDeliveryColorChannels,
} from './video-delivery-color.ts';
import {
	normalizeRational,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';
import {
	admitAudioEditorProjectValidationStructure,
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
} from './project-validation-budget.ts';
import { MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES } from './project-publication-admission.ts';

interface ExportProject extends Readonly<Record<string, unknown>> {
	readonly sampleRate?: unknown;
}

export interface VideoKeyframeExportCanvas {
	readonly width: number;
	readonly height: number;
	readonly frameRate: Rational;
	/** How a source of another aspect is placed; absent from a request means `contain`. */
	readonly fit: VideoCanvasFit;
	/** What the canvas is cleared to; absent from a request means opaque black. */
	readonly backgroundColor: string;
}

export interface VideoKeyframeExportFrameRequest {
	readonly project: ExportProject;
	readonly canvas: Readonly<{
		width: number;
		height: number;
		frameRate: RationalInput;
		fit?: VideoCanvasFit;
		backgroundColor?: string;
	}>;
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly provider?: VideoKeyframeRenderStateProvider;
	readonly resolvePresentationDescriptor?: VideoKeyframeExportPresentationResolver;
}

export interface VideoKeyframeExportPresentationRequest {
	readonly clip: Readonly<Record<string, unknown>>;
	readonly source: Readonly<Record<string, unknown>>;
	readonly localSequencePosition: Rational;
	/** Exact random-access output index owned by the export frame source. */
	readonly outputOrdinal?: number;
}

export type VideoKeyframeExportPresentationResolver = (
	request: VideoKeyframeExportPresentationRequest,
) => VideoRetimeFrameDescriptor;

export interface VideoKeyframeExportFrame {
	readonly index: number;
	readonly timelineSample: number;
	readonly timelinePosition: Readonly<{ num: number; den: number }>;
	readonly layers: readonly unknown[];
}

export interface VideoKeyframeExportFrameSource {
	readonly frameCount: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sampleRate: number;
	readonly canvas: VideoKeyframeExportCanvas;
	frame(index: number): VideoKeyframeExportFrame;
}

export interface VideoExactPictureExportFrameRequest {
	readonly sampleRate: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly canvas: VideoKeyframeExportFrameRequest['canvas'];
}

const VIDEO_KEYFRAME_EXPORT_FRAME_OWNERS = new WeakMap<object, VideoKeyframeExportFrameSource>();
const VIDEO_KEYFRAME_EXPORT_FRAME_SOURCES = new WeakSet<object>();

/** Refuse a forged source before any decoder, renderer, or encoder work begins. */
export function assertVideoKeyframeExportFrameSource(
	value: unknown,
): asserts value is VideoKeyframeExportFrameSource {
	if (!value || typeof value !== 'object' || !VIDEO_KEYFRAME_EXPORT_FRAME_SOURCES.has(value)) {
		throw new TypeError('An authenticated video keyframe export frame source is required.');
	}
}

/** Refuse a forged frame or a frame resolved by a different export snapshot. */
export function assertVideoKeyframeExportFrame(
	source: VideoKeyframeExportFrameSource,
	frame: unknown,
): asserts frame is VideoKeyframeExportFrame {
	if (!frame || typeof frame !== 'object'
		|| VIDEO_KEYFRAME_EXPORT_FRAME_OWNERS.get(frame) !== source) {
		throw new TypeError('An export frame owned by the requested video keyframe frame source is required.');
	}
}

/**
 * Resolve an exact, random-access export frame without retaining a frame table.
 *
 * Output frame index is authoritative. Each query maps `index / frameRate` to
 * an exact rational project sample and evaluates the same renderer-neutral
 * keyframe provider used by preview. The terminal project boundary is never a
 * rendered frame: `frameCount = ceil(duration * rate)`.
 */
export function createVideoKeyframeExportFrameSource(
	request: VideoKeyframeExportFrameRequest,
): VideoKeyframeExportFrameSource {
	const requestRecord = closedRecord(request, new Set([
		'project', 'canvas', 'startFrame', 'endFrame', 'provider',
		'resolvePresentationDescriptor',
	]), 'video keyframe export request');
	const project = plainRecord(
		dataProperty(requestRecord, 'project', 'video keyframe export request'),
		'video keyframe export project',
	) as ExportProject;
	const sampleRate = positiveSafeInteger(
		dataProperty(project, 'sampleRate', 'video keyframe export project'),
		'project.sampleRate',
	);
	const snapshot = immutableProjectSnapshot(project);
	const canvas = normalizeCanvas(
		dataProperty(requestRecord, 'canvas', 'video keyframe export request'),
	);
	const startFrame = nonNegativeSafeInteger(
		optionalDataProperty(requestRecord, 'startFrame', 0, 'video keyframe export request'),
		'startFrame',
	);
	const endFrame = nonNegativeSafeInteger(
		optionalDataProperty(
			requestRecord, 'endFrame', videoTimelineDurationFrames(snapshot),
			'video keyframe export request',
		),
		'endFrame',
	);
	if (endFrame <= startFrame) throw new RangeError('Video keyframe export range must be positive.');
	const durationFrames = endFrame - startFrame;
	const frameCount = resolveVideoKeyframeExportFrameCount(
		durationFrames, sampleRate, canvas.frameRate,
	);
	assertFramePositionDomain(startFrame, frameCount, sampleRate, canvas.frameRate);
	const provider = optionalDataProperty(
		requestRecord, 'provider', undefined, 'video keyframe export request',
	) as VideoKeyframeRenderStateProvider | undefined ?? createVideoKeyframeRenderStateProvider();
	const resolvePresentationDescriptor = optionalFunction(
		requestRecord,
		'resolvePresentationDescriptor',
		'video keyframe export request',
	) as VideoKeyframeExportPresentationResolver | undefined;
	const source: VideoKeyframeExportFrameSource = Object.freeze({
		frameCount,
		startFrame,
		endFrame,
		sampleRate,
		canvas,
		frame(indexValue: number): VideoKeyframeExportFrame {
			const index = nonNegativeSafeInteger(indexValue, 'frame index');
			if (index >= frameCount) throw new RangeError('Video keyframe export frame index is outside the range.');
			const offset = exactFrameOffset(index, sampleRate, canvas.frameRate);
			const timelinePosition = exactSum(startFrame, offset);
			const timelineSample = timelinePosition.num / timelinePosition.den;
			const layers = resolveActiveVideoLayers(snapshot, timelineSample, {
				renderCanvas: canvas,
				resolveClipRenderState: (stateRequest: VideoKeyframePreviewStateRequest) => (
					resolveVideoKeyframeExportState(
						provider,
						stateRequest,
						timelinePosition,
						index,
						resolvePresentationDescriptor,
					)
				),
			});
			const frame = Object.freeze({ index, timelineSample, timelinePosition, layers });
			VIDEO_KEYFRAME_EXPORT_FRAME_OWNERS.set(frame, source);
			return frame;
		},
	});
	VIDEO_KEYFRAME_EXPORT_FRAME_SOURCES.add(source);
	return source;
}

/** Create an exact empty-layer picture clock for product-owned visual materializers. */
export function createVideoExactPictureExportFrameSource(
	requestValue: VideoExactPictureExportFrameRequest,
): VideoKeyframeExportFrameSource {
	const request = closedRecord(requestValue, new Set([
		'sampleRate', 'startFrame', 'endFrame', 'canvas',
	]), 'exact picture export request');
	const sampleRate = positiveSafeInteger(
		dataProperty(request, 'sampleRate', 'exact picture export request'), 'sampleRate',
	);
	const startFrame = nonNegativeSafeInteger(
		dataProperty(request, 'startFrame', 'exact picture export request'), 'startFrame',
	);
	const endFrame = positiveSafeInteger(
		dataProperty(request, 'endFrame', 'exact picture export request'), 'endFrame',
	);
	if (endFrame <= startFrame) throw new RangeError('Exact picture export range must be positive.');
	const canvas = normalizeCanvas(dataProperty(request, 'canvas', 'exact picture export request'));
	const frameCount = resolveVideoKeyframeExportFrameCount(
		endFrame - startFrame, sampleRate, canvas.frameRate,
	);
	assertFramePositionDomain(startFrame, frameCount, sampleRate, canvas.frameRate);
	const source: VideoKeyframeExportFrameSource = Object.freeze({
		frameCount, startFrame, endFrame, sampleRate, canvas,
		frame(indexValue: number): VideoKeyframeExportFrame {
			const index = nonNegativeSafeInteger(indexValue, 'frame index');
			if (index >= frameCount) throw new RangeError('Exact picture export frame is outside the range.');
			const offset = exactFrameOffset(index, sampleRate, canvas.frameRate);
			const timelinePosition = exactSum(startFrame, offset);
			const frame = Object.freeze({
				index,
				timelineSample: timelinePosition.num / timelinePosition.den,
				timelinePosition,
				layers: Object.freeze([]),
			});
			VIDEO_KEYFRAME_EXPORT_FRAME_OWNERS.set(frame, source);
			return frame;
		},
	});
	VIDEO_KEYFRAME_EXPORT_FRAME_SOURCES.add(source);
	return source;
}

function resolveVideoKeyframeExportState(
	provider: VideoKeyframeRenderStateProvider,
	request: VideoKeyframePreviewStateRequest,
	timelinePosition: Readonly<{ num: number; den: number }>,
	outputOrdinal: number,
	resolvePresentationDescriptor: VideoKeyframeExportPresentationResolver | undefined,
) {
	const clip = request.clip as Readonly<Record<string, unknown>>;
	if (resolvePresentationDescriptor === undefined && !Object.hasOwn(clip, 'videoKeyframes')) {
		return null;
	}
	const timelineStartFrame = nonNegativeSafeInteger(
		dataProperty(clip, 'timelineStartFrame', 'video keyframe export clip'),
		'video keyframe export clip.timelineStartFrame',
	);
	const durationFrames = positiveSafeInteger(
		dataProperty(clip, 'durationFrames', 'video keyframe export clip'),
		'video keyframe export clip.durationFrames',
	);
	const sequenceFrameCount = positiveSafeInteger(
		dataProperty(clip, 'sequenceFrameCount', 'video keyframe export clip'),
		'video keyframe export clip.sequenceFrameCount',
	);
	const localSequencePosition = mapLocalSequencePosition(
		timelinePosition, timelineStartFrame, durationFrames, sequenceFrameCount,
	);
	const source = request.source === undefined
		? undefined
		: plainRecord(request.source, 'video keyframe export source');
	if (resolvePresentationDescriptor !== undefined && source === undefined) {
		throw new TypeError('Video keyframe export presentation resolution requires a canonical source.');
	}
	const presentationDescriptor = resolvePresentationDescriptor === undefined
		? undefined
		: plainRecord(Reflect.apply(resolvePresentationDescriptor, undefined, [Object.freeze({
			clip,
			source,
			localSequencePosition,
			outputOrdinal,
		})]), 'video keyframe export presentation descriptor') as unknown as VideoRetimeFrameDescriptor;
	if (!Object.hasOwn(clip, 'videoKeyframes')) {
		return presentationDescriptor === undefined ? null : Object.freeze({ presentationDescriptor });
	}
	const transitionWeight = request.transitionWeight ?? 1;
	const state = provider.resolve({
		clip,
		localSequencePosition,
		sourceDisplaySize: request.sourceDisplaySize,
		canvas: { width: request.canvas.width, height: request.canvas.height, fit: request.canvas.fit },
		transitionWeightStart: transitionWeight,
		transitionWeightEnd: transitionWeight,
	});
	return presentationDescriptor === undefined
		? state
		: Object.freeze({ ...state, presentationDescriptor });
}

function mapLocalSequencePosition(
	timeline: Readonly<{ num: number; den: number }>,
	startFrame: number,
	durationFrames: number,
	sequenceFrameCount: number,
) {
	const localNumerator = BigInt(timeline.num) - (BigInt(startFrame) * BigInt(timeline.den));
	const maximum = BigInt(durationFrames) * BigInt(timeline.den);
	if (localNumerator < 0n || localNumerator > maximum) {
		throw new RangeError('The video keyframe export position is outside the visible clip range.');
	}
	const numerator = localNumerator * BigInt(sequenceFrameCount);
	const denominator = BigInt(timeline.den) * BigInt(durationFrames);
	const factor = greatestCommonDivisor(numerator, denominator);
	return safeRational(
		numerator / factor,
		denominator / factor,
		'video keyframe export local sequence position',
	);
}

function normalizeCanvas(value: unknown): VideoKeyframeExportCanvas {
	const canvas = plainRecord(value, 'video keyframe export canvas');
	const allowed = new Set(['width', 'height', 'frameRate', 'fit', 'backgroundColor']);
	for (const key of Reflect.ownKeys(canvas)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError('Video keyframe export canvas has an unsupported field.');
		}
	}
	// Absent means `contain`, which is the placement every keyed frame had before
	// a delivery could ask for another one.
	const fit = Object.hasOwn(canvas, 'fit') ? dataProperty(canvas, 'fit', 'canvas') : 'contain';
	if (!isVideoCanvasFit(fit)) throw new RangeError('Video keyframe export canvas fit is unsupported.');
	// Absent means the opaque black every keyed frame cleared to before a
	// delivery could state a background of its own.
	const backgroundColor = Object.hasOwn(canvas, 'backgroundColor')
		? normalizeVideoDeliveryColor(dataProperty(canvas, 'backgroundColor', 'canvas'), 'canvas.backgroundColor')
		: '#000000';
	if (!videoDeliveryColorChannels(backgroundColor)) {
		throw new RangeError('Video keyframe export canvas backgroundColor must be a hex colour.');
	}
	return Object.freeze({
		width: positiveSafeInteger(dataProperty(canvas, 'width', 'canvas'), 'canvas.width'),
		height: positiveSafeInteger(dataProperty(canvas, 'height', 'canvas'), 'canvas.height'),
		frameRate: positiveRational(dataProperty(canvas, 'frameRate', 'canvas'), 'canvas.frameRate'),
		fit,
		backgroundColor,
	});
}

/** Share the exact terminal-exclusive CFR frame domain with planning and encoding. */
export function resolveVideoKeyframeExportFrameCount(
	durationFramesValue: number,
	sampleRateValue: number,
	frameRateValue: RationalInput,
): number {
	const durationFrames = positiveSafeInteger(durationFramesValue, 'durationFrames');
	const sampleRate = positiveSafeInteger(sampleRateValue, 'sampleRate');
	const frameRate = positiveRational(frameRateValue, 'frameRate');
	return safeCeilProduct(durationFrames, frameRate.num, sampleRate, frameRate.den);
}

function safeCeilProduct(left: number, right: number, ...divisors: number[]): number {
	const numerator = BigInt(left) * BigInt(right);
	const divisor = divisors.reduce((product, value) => product * BigInt(value), 1n);
	const result = (numerator + divisor - 1n) / divisor;
	if (result < 1n || result > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('Video keyframe export frame count exceeds the safe integer domain.');
	}
	return Number(result);
}

function exactFrameOffset(
	index: number,
	sampleRate: number,
	frameRate: Rational,
): Readonly<{ num: number; den: number }> {
	const numerator = BigInt(index) * BigInt(sampleRate) * BigInt(frameRate.den);
	const divisor = BigInt(frameRate.num);
	const factor = greatestCommonDivisor(numerator, divisor);
	return safeRational(numerator / factor, divisor / factor, 'video keyframe export position');
}

function assertFramePositionDomain(
	startFrame: number,
	frameCount: number,
	sampleRate: number,
	frameRate: Rational,
): void {
	const commonDenominator = BigInt(frameRate.num);
	const maximumUnreducedNumerator = (BigInt(startFrame) * commonDenominator)
		+ (BigInt(frameCount - 1) * BigInt(sampleRate) * BigInt(frameRate.den));
	if (maximumUnreducedNumerator > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('Video keyframe export timeline positions exceed the safe rational domain.');
	}
}

function positiveRational(value: unknown, name: string): Rational {
	let candidate = value;
	if (typeof value === 'object' && value !== null) {
		const record = closedRecord(value, new Set(['num', 'den']), name);
		candidate = {
			num: dataProperty(record, 'num', name),
			den: dataProperty(record, 'den', name),
		};
	}
	let result: Rational;
	try {
		result = normalizeRational(candidate as RationalInput);
	} catch (cause) {
		throw new RangeError(`${name} must be a canonical positive rational.`, { cause });
	}
	if (result.num <= 0) throw new RangeError(`${name} must be positive.`);
	if (typeof candidate === 'object' && candidate !== null) {
		const record = candidate as Readonly<Record<string, unknown>>;
		if (record.num !== result.num || record.den !== result.den) {
			throw new RangeError(`${name} must be a canonical reduced rational.`);
		}
	}
	return result;
}

function exactSum(
	integer: number,
	rational: Readonly<{ num: number; den: number }>,
): Readonly<{ num: number; den: number }> {
	return safeRational(
		(BigInt(integer) * BigInt(rational.den)) + BigInt(rational.num),
		BigInt(rational.den),
		'video keyframe export timeline position',
	);
}

function safeRational(numerator: bigint, denominator: bigint, name: string) {
	if (numerator < 0n || denominator < 1n
		|| numerator > BigInt(Number.MAX_SAFE_INTEGER)
		|| denominator > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`${name} exceeds the safe rational domain.`);
	}
	return Object.freeze({ num: Number(numerator), den: Number(denominator) });
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	let a = left < 0n ? -left : left;
	let b = right < 0n ? -right : right;
	while (b !== 0n) [a, b] = [b, a % b];
	return a === 0n ? 1n : a;
}

function plainRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function closedRecord(
	value: unknown,
	allowed: ReadonlySet<string>,
	name: string,
): Readonly<Record<string, unknown>> {
	const record = plainRecord(value, name);
	for (const key of Reflect.ownKeys(record)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError(`${name} has an unsupported field.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an enumerable own data property.`);
		}
	}
	return record;
}

function dataProperty(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable own data property.`);
	}
	return descriptor.value;
}

function optionalDataProperty(
	value: object,
	key: string,
	fallback: unknown,
	name: string,
): unknown {
	if (!Object.hasOwn(value, key)) return fallback;
	return dataProperty(value, key, name);
}

function optionalFunction(
	value: object,
	key: string,
	name: string,
): ((...args: unknown[]) => unknown) | undefined {
	if (!Object.hasOwn(value, key)) return undefined;
	const candidate = dataProperty(value, key, name);
	if (typeof candidate !== 'function') throw new TypeError(`${name}.${key} must be a function.`);
	return candidate as (...args: unknown[]) => unknown;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = nonNegativeSafeInteger(value, name);
	if (result === 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function immutableProjectSnapshot(project: ExportProject): ExportProject {
	admitAudioEditorProjectValidationStructure(
		project,
		AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
	);
	assertSnapshotPayloadBound(project);
	let snapshot: unknown;
	try {
		snapshot = structuredClone(project);
	} catch (cause) {
		throw new TypeError('Video keyframe export project must be structured-clone data.', { cause });
	}
	return freezeProjectSnapshot(snapshot) as ExportProject;
}

function assertSnapshotPayloadBound(value: object): void {
	const stack: unknown[] = [value];
	const seen = new WeakSet<object>();
	let textCodeUnits = 0;
	while (stack.length > 0) {
		const current = stack.pop();
		if (typeof current === 'string') {
			textCodeUnits += current.length;
			if (textCodeUnits > MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES) {
				throw new RangeError('Video keyframe export project text exceeds its snapshot byte bound.');
			}
			continue;
		}
		if (!current || typeof current !== 'object' || seen.has(current)) continue;
		if (current instanceof Uint8Array || current instanceof ArrayBuffer) {
			throw new TypeError('Video keyframe export projects cannot embed binary data.');
		}
		seen.add(current);
		for (const key of Reflect.ownKeys(current)) {
			stack.push(Object.getOwnPropertyDescriptor(current, key)?.value);
		}
	}
}

function freezeProjectSnapshot(value: unknown): unknown {
	if (!value || typeof value !== 'object') return value;
	if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
		throw new TypeError('Video keyframe export projects cannot embed binary data.');
	}
	const stack: object[] = [value];
	const seen = new WeakSet<object>();
	const order: object[] = [];
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (seen.has(current)) continue;
		seen.add(current);
		order.push(current);
		for (const key of Reflect.ownKeys(current)) {
			const nested = Object.getOwnPropertyDescriptor(current, key)?.value;
			if (nested && typeof nested === 'object') stack.push(nested as object);
		}
	}
	for (let index = order.length - 1; index >= 0; index -= 1) Object.freeze(order[index]);
	return value;
}
