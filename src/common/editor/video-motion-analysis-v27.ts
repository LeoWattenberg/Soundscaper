/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic built-in motion analysis and authenticated transient bodies. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	normalizeVideoMotionAnalysisReferenceV1,
	normalizeVideoProcessorStackV1,
	requireFreshVideoMotionAnalysisV1,
	type VideoMotionAnalysisReferenceV1,
	type VideoProcessorStackV1,
	type VideoTrackingProcessorV1,
} from './video-motion-model-v27.ts';
import {
	detectShiTomasiFeaturesV1,
	estimateSimilarityRansacV1,
	trackPyramidalLucasKanadeV1,
	type GrayVideoFrameV1,
	type VideoPointMatchV1,
	type VideoSimilarityTransformV1,
} from './video-motion-processing-v27.ts';

export interface VideoMotionAnalysisTransformV1 {
	readonly frameNumber: number;
	/** Deterministic camera motion from frameNumber - 1 into frameNumber. */
	readonly transform: VideoSimilarityTransformV1;
}

export interface VideoMotionAnalysisBodyV1 {
	readonly schemaVersion: 1;
	readonly analysisId: string;
	readonly sourceId: string;
	readonly processorStackId: string;
	readonly inputSha256: string;
	readonly settingsSha256: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly transforms: readonly VideoMotionAnalysisTransformV1[];
}

export interface VideoMotionAnalysisResultV1 {
	readonly reference: VideoMotionAnalysisReferenceV1;
	readonly body: VideoMotionAnalysisBodyV1;
	readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface VideoMotionAnalysisProgressV1 {
	readonly phase: 'tracking';
	readonly completed: number;
	readonly total: number;
}

export interface VideoMotionAnalysisRequestV1 {
	readonly analysisId: string;
	readonly inputSha256: string;
	readonly processorStack: unknown;
	readonly frames: readonly Readonly<{
		readonly frameNumber: number;
		readonly frame: GrayVideoFrameV1;
	}>[];
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: VideoMotionAnalysisProgressV1) => void;
}

const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAXIMUM_ANALYSIS_FRAMES = 1_000_000;

export async function analyzeVideoMotionV1(
	request: Readonly<VideoMotionAnalysisRequestV1>,
): Promise<VideoMotionAnalysisResultV1> {
	throwIfAborted(request?.signal);
	const analysisId = stableId(request?.analysisId, 'motion analysis ID');
	const inputSha256 = digest(request?.inputSha256, 'motion analysis input digest');
	const stack = normalizeVideoProcessorStackV1(request?.processorStack);
	const tracking = trackingProcessor(stack);
	const frames = analysisFrames(request?.frames);
	const settingsSha256 = videoMotionSettingsSha256V1(stack);
	const transforms: VideoMotionAnalysisTransformV1[] = [];
	const total = frames.length - 1;
	for (let index = 1; index < frames.length; index += 1) {
		throwIfAborted(request.signal);
		const previous = frames[index - 1]!;
		const current = frames[index]!;
		transforms.push(Object.freeze({
			frameNumber: current.frameNumber,
			transform: analyzePair(previous.frame, current.frame, tracking),
		}));
		request.onProgress?.(Object.freeze({ phase: 'tracking', completed: index, total }));
		// Let cancellation and UI progress run between expensive frame pairs.
		await Promise.resolve();
	}
	throwIfAborted(request.signal);
	const body = normalizeBody({
		schemaVersion: 1,
		analysisId,
		sourceId: stack.sourceId,
		processorStackId: stack.id,
		inputSha256,
		settingsSha256,
		startFrame: frames[0]!.frameNumber,
		endFrame: frames[frames.length - 1]!.frameNumber + 1,
		transforms,
	});
	const bytes = encodedBody(body);
	const bodySha256 = bytesToHex(sha256(bytes));
	const reference = normalizeVideoMotionAnalysisReferenceV1({
		schemaVersion: 1,
		id: analysisId,
		sourceId: stack.sourceId,
		processorStackId: stack.id,
		inputSha256,
		settingsSha256,
		storageKey: `motion-sha256:${bodySha256}`,
		sha256: bodySha256,
		byteLength: bytes.byteLength,
		startFrame: body.startFrame,
		endFrame: body.endFrame,
	});
	return Object.freeze({ reference, body, bytes });
}

export function videoMotionSettingsSha256V1(stackValue: unknown): string {
	const stack = normalizeVideoProcessorStackV1(stackValue);
	return bytesToHex(sha256(UTF8.encode(JSON.stringify(stack))));
}

/** Authenticate body bytes and reject stale source or settings authority. */
export function requireVideoMotionAnalysisBodyV1(
	referenceValue: unknown,
	bytesValue: Uint8Array,
	expected: Readonly<{ readonly inputSha256: string; readonly processorStack: unknown }>,
): VideoMotionAnalysisBodyV1 {
	const stack = normalizeVideoProcessorStackV1(expected?.processorStack);
	const settingsSha256 = videoMotionSettingsSha256V1(stack);
	const reference = requireFreshVideoMotionAnalysisV1(referenceValue, {
		sourceId: stack.sourceId,
		processorStackId: stack.id,
		inputSha256: expected?.inputSha256,
		settingsSha256,
	});
	const bytes = wholeBytes(bytesValue);
	if (bytes.byteLength !== reference.byteLength
		|| bytesToHex(sha256(bytes)) !== reference.sha256) {
		throw new RangeError('The motion analysis body digest or byte length changed.');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(UTF8_DECODER.decode(bytes)) as unknown;
	} catch (error) {
		throw new TypeError('The motion analysis body is not canonical UTF-8 JSON.', { cause: error });
	}
	const body = normalizeBody(parsed);
	if (JSON.stringify(body) !== UTF8_DECODER.decode(bytes)) {
		throw new TypeError('The motion analysis body is not canonical JSON.');
	}
	if (body.analysisId !== reference.id || body.sourceId !== reference.sourceId
		|| body.processorStackId !== reference.processorStackId
		|| body.inputSha256 !== reference.inputSha256
		|| body.settingsSha256 !== reference.settingsSha256
		|| body.startFrame !== reference.startFrame || body.endFrame !== reference.endFrame) {
		throw new RangeError('The motion analysis body does not match its persisted reference.');
	}
	return body;
}

function analyzePair(
	previous: GrayVideoFrameV1,
	current: GrayVideoFrameV1,
	tracking: VideoTrackingProcessorV1,
): VideoSimilarityTransformV1 {
	const features = detectShiTomasiFeaturesV1(previous, tracking);
	const tracks = trackPyramidalLucasKanadeV1(previous, current, features, {
		windowRadius: tracking.windowRadius,
		pyramidLevels: tracking.pyramidLevels,
		maximumIterations: 24,
		epsilon: 1e-4,
	});
	const matches: VideoPointMatchV1[] = tracks.flatMap((track) => (
		track.status === 'tracked' && Number.isFinite(track.error)
			? [Object.freeze({
				source: track.source,
				target: track.target,
				confidence: Math.max(Number.EPSILON, Math.min(1, 1 / (1 + track.error))),
			})]
			: []
	));
	if (matches.length < 2) return identityTransform();
	try {
		return estimateSimilarityRansacV1(matches, {
			inlierThreshold: Math.max(0.5, tracking.minimumDistance / 2),
			minimumInliers: Math.min(4, matches.length),
		});
	} catch {
		return identityTransform();
	}
}

function trackingProcessor(stack: VideoProcessorStackV1): VideoTrackingProcessorV1 {
	const processors = stack.processors.filter((processor): processor is VideoTrackingProcessorV1 => (
		processor.kind === 'tracking' && processor.enabled
	));
	if (processors.length !== 1) {
		throw new RangeError('Built-in motion analysis requires exactly one enabled tracking processor.');
	}
	return processors[0]!;
}

function analysisFrames(value: unknown): readonly Readonly<{
	readonly frameNumber: number;
	readonly frame: GrayVideoFrameV1;
}>[] {
	if (!Array.isArray(value) || value.length < 2 || value.length > MAXIMUM_ANALYSIS_FRAMES) {
		throw new RangeError('Motion analysis requires a bounded sequence of at least two frames.');
	}
	let width = 0;
	let height = 0;
	return Object.freeze(value.map((item, index) => {
		if (!item || typeof item !== 'object') throw new TypeError('A motion analysis frame must be an object.');
		const candidate = item as Readonly<{ frameNumber?: unknown; frame?: unknown }>;
		const frameNumber = nonNegativeInteger(candidate.frameNumber, 'motion analysis frame number');
		const frame = candidate.frame;
		if (!frame || typeof frame !== 'object') throw new TypeError('A motion analysis gray frame is required.');
		const checked = frame as GrayVideoFrameV1;
		if (index === 0) { width = checked.width; height = checked.height; }
		if (checked.width !== width || checked.height !== height) {
			throw new RangeError('Motion analysis frame dimensions must remain constant.');
		}
		if (index > 0 && frameNumber !== Number((value[index - 1] as { frameNumber?: unknown }).frameNumber) + 1) {
			throw new RangeError('Motion analysis frame numbers must be contiguous.');
		}
		return Object.freeze({ frameNumber, frame: checked });
	}));
}

function normalizeBody(value: unknown): VideoMotionAnalysisBodyV1 {
	const input = exactRecord(value, [
		'schemaVersion', 'analysisId', 'sourceId', 'processorStackId', 'inputSha256',
		'settingsSha256', 'startFrame', 'endFrame', 'transforms',
	], 'motion analysis body');
	if (input.schemaVersion !== 1) throw new RangeError('The motion analysis body schema is unsupported.');
	const startFrame = nonNegativeInteger(input.startFrame, 'motion analysis body start frame');
	const endFrame = nonNegativeInteger(input.endFrame, 'motion analysis body end frame');
	if (endFrame <= startFrame) throw new RangeError('The motion analysis body range must be positive.');
	if (!Array.isArray(input.transforms) || input.transforms.length !== endFrame - startFrame - 1) {
		throw new RangeError('The motion analysis body requires one transform per adjacent frame pair.');
	}
	const transforms = input.transforms.map((value, index) => normalizeTransform(
		value, startFrame + index + 1,
	));
	return Object.freeze({
		schemaVersion: 1 as const,
		analysisId: stableId(input.analysisId, 'motion analysis body ID'),
		sourceId: stableId(input.sourceId, 'motion analysis body source ID'),
		processorStackId: stableId(input.processorStackId, 'motion analysis body stack ID'),
		inputSha256: digest(input.inputSha256, 'motion analysis body input digest'),
		settingsSha256: digest(input.settingsSha256, 'motion analysis body settings digest'),
		startFrame,
		endFrame,
		transforms: Object.freeze(transforms),
	});
}

function normalizeTransform(value: unknown, expectedFrame: number): VideoMotionAnalysisTransformV1 {
	const input = exactRecord(value, ['frameNumber', 'transform'], 'motion analysis transform');
	if (input.frameNumber !== expectedFrame) throw new RangeError('Motion analysis transforms must be contiguous.');
	const transform = exactRecord(input.transform, [
		'scale', 'rotationRadians', 'translateX', 'translateY', 'inlierCount', 'meanError',
	], 'motion analysis similarity transform');
	return Object.freeze({
		frameNumber: expectedFrame,
		transform: Object.freeze({
			scale: finitePositive(transform.scale, 'motion scale'),
			rotationRadians: finite(transform.rotationRadians, 'motion rotation'),
			translateX: finite(transform.translateX, 'motion translateX'),
			translateY: finite(transform.translateY, 'motion translateY'),
			inlierCount: nonNegativeInteger(transform.inlierCount, 'motion inlier count'),
			meanError: finiteNonNegative(transform.meanError, 'motion mean error'),
		}),
	});
}

function encodedBody(body: VideoMotionAnalysisBodyV1): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(UTF8.encode(JSON.stringify(body)));
}

function identityTransform(): VideoSimilarityTransformV1 {
	return Object.freeze({
		scale: 1, rotationRadians: 0, translateX: 0, translateY: 0,
		inlierCount: 0, meanError: 0,
	});
}

function wholeBytes(value: unknown): Uint8Array<ArrayBuffer> {
	if (!(value instanceof Uint8Array) || value.byteOffset !== 0
		|| value.byteLength !== value.buffer.byteLength) {
		throw new TypeError('The motion analysis body requires one whole Uint8Array.');
	}
	return Uint8Array.from(value);
}

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${name} must be a plain record.`);
	const record = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} contains unsupported fields.`);
	}
	return record;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be lowercase SHA-256.`);
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function finite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
		throw new RangeError(`${name} must be finite.`);
	}
	return value;
}

function finitePositive(value: unknown, name: string): number {
	const result = finite(value, name);
	if (result <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function finiteNonNegative(value: unknown, name: string): number {
	const result = finite(value, name);
	if (result < 0) throw new RangeError(`${name} must be non-negative.`);
	return result;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The motion analysis was aborted.', 'AbortError');
}
