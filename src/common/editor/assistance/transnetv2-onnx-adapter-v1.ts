/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Deterministic CPU tensor adapter for the reviewed TransNetV2 conversion.
 *
 * Geometry and window authority are pinned to the upstream inference source at
 * https://github.com/soCzech/TransNetV2/blob/85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed/inference/transnetv2.py
 * It specifies RGB uint8 decode at 48x27, a float cast without normalization,
 * 100-frame windows stepped by 50, edge-frame replication, and authority from
 * the central [25, 75) outputs. This adapter does not claim an ONNX artifact is
 * installed or qualified.
 */

import {
	createAssistanceTransNetV2BoundariesV1,
	type AssistanceTransNetV2BoundariesV1,
} from './transnetv2-postprocess-v1.ts';

export const ASSISTANCE_TRANSNET_V2_SOURCE = Object.freeze({
	url: 'https://github.com/soCzech/TransNetV2/blob/85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed/inference/transnetv2.py',
	revision: '85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed',
});
export const ASSISTANCE_TRANSNET_V2_WIDTH = 48;
export const ASSISTANCE_TRANSNET_V2_HEIGHT = 27;
export const ASSISTANCE_TRANSNET_V2_CHANNELS = 3;
export const ASSISTANCE_TRANSNET_V2_ROW_STRIDE_BYTES = 144 as const;
export const ASSISTANCE_TRANSNET_V2_WINDOW_FRAMES = 100;
export const ASSISTANCE_TRANSNET_V2_WINDOW_STEP_FRAMES = 50;
export const ASSISTANCE_TRANSNET_V2_CONTEXT_FRAMES = 25;
export const ASSISTANCE_TRANSNET_V2_FRAME_BYTES =
	ASSISTANCE_TRANSNET_V2_WIDTH * ASSISTANCE_TRANSNET_V2_HEIGHT
	* ASSISTANCE_TRANSNET_V2_CHANNELS;
export const ASSISTANCE_TRANSNET_V2_CPU_INPUT_SHAPE = Object.freeze([
	1, ASSISTANCE_TRANSNET_V2_WINDOW_FRAMES, ASSISTANCE_TRANSNET_V2_HEIGHT,
	ASSISTANCE_TRANSNET_V2_WIDTH, ASSISTANCE_TRANSNET_V2_CHANNELS,
] as const);
export const ASSISTANCE_TRANSNET_V2_CPU_OUTPUT_SHAPE = Object.freeze([
	1, ASSISTANCE_TRANSNET_V2_WINDOW_FRAMES, 1,
] as const);

export type AssistanceTransNetV2InputElementType = 'uint8' | 'float32';
export type AssistanceTransNetV2OutputValueKind = 'logits' | 'probabilities';

export interface AssistanceTransNetV2DecodedFramesV1 {
	readonly schemaVersion: 1;
	readonly pixelFormat: 'rgb24';
	readonly width: typeof ASSISTANCE_TRANSNET_V2_WIDTH;
	readonly height: typeof ASSISTANCE_TRANSNET_V2_HEIGHT;
	readonly rowStrideBytes: typeof ASSISTANCE_TRANSNET_V2_ROW_STRIDE_BYTES;
	readonly timescale: number;
	readonly presentationTicks: readonly string[];
	readonly data: Uint8Array;
}

export interface AssistanceTransNetV2DecodedFrameSourceV1 {
	readonly schemaVersion: 1;
	readonly pixelFormat: 'rgb24';
	readonly width: typeof ASSISTANCE_TRANSNET_V2_WIDTH;
	readonly height: typeof ASSISTANCE_TRANSNET_V2_HEIGHT;
	readonly rowStrideBytes: typeof ASSISTANCE_TRANSNET_V2_ROW_STRIDE_BYTES;
	readonly timescale: number;
	readonly frameCount: number;
	readonly sourceFrames: readonly number[];
	readonly presentationTicks: readonly string[];
	readonly readFrame: (index: number) => PromiseLike<Uint8Array> | Uint8Array;
}

export interface AssistanceTransNetV2CpuInputBatchV1 {
	readonly schemaVersion: 1;
	readonly batchIndex: number;
	readonly sourceFrameStart: number;
	readonly authoritativeFrameCount: number;
	readonly elementType: AssistanceTransNetV2InputElementType;
	readonly dims: typeof ASSISTANCE_TRANSNET_V2_CPU_INPUT_SHAPE;
	readonly data: Uint8Array | Float32Array;
}

export interface AssistanceTransNetV2OnnxOutputTensorV1 {
	readonly type: 'float32';
	readonly dims: typeof ASSISTANCE_TRANSNET_V2_CPU_OUTPUT_SHAPE;
	readonly data: Float32Array;
}

export interface AssistanceTransNetV2OnnxBatchOutputV1 {
	readonly singleFrame: AssistanceTransNetV2OnnxOutputTensorV1;
	readonly allFrame: AssistanceTransNetV2OnnxOutputTensorV1;
}

export interface AssistanceTransNetV2OnnxAdapterOptionsV1 {
	readonly runBatch: (batch: AssistanceTransNetV2CpuInputBatchV1) => Promise<unknown>;
	readonly signal?: AbortSignal;
}

interface AssistanceTransNetV2OnnxAdapterRequestV1 {
	readonly schemaVersion: 1;
	readonly frames: AssistanceTransNetV2DecodedFramesV1;
	readonly inputElementType: AssistanceTransNetV2InputElementType;
	readonly outputValueKind: AssistanceTransNetV2OutputValueKind;
	readonly threshold: number;
	readonly minimumBoundaryDistanceFrames: number;
}

interface AssistanceTransNetV2OnnxFrameSourceRequestV1
	extends Omit<AssistanceTransNetV2OnnxAdapterRequestV1, 'frames'> {
	readonly frames: AssistanceTransNetV2DecodedFrameSourceV1;
}

const MAXIMUM_SOURCE_FRAMES = 10_000_000;
const MAXIMUM_TIMESCALE = 0x7fff_ffff;
const MAXIMUM_TICK = 0x7fff_ffff_ffff_ffffn;
const TICK = /^(?:0|[1-9]\d*)$/u;
const DECODED_FIELDS = Object.freeze([
	'schemaVersion', 'pixelFormat', 'width', 'height', 'rowStrideBytes',
	'timescale', 'presentationTicks', 'data',
] as const);
const FRAME_SOURCE_FIELDS = Object.freeze([
	'schemaVersion', 'pixelFormat', 'width', 'height', 'rowStrideBytes',
	'timescale', 'frameCount', 'presentationTicks', 'readFrame',
	'sourceFrames',
] as const);
const REQUEST_FIELDS = Object.freeze([
	'schemaVersion', 'frames', 'inputElementType', 'outputValueKind', 'threshold',
	'minimumBoundaryDistanceFrames',
] as const);

export function validateAssistanceTransNetV2DecodedFramesV1(
	value: unknown,
): AssistanceTransNetV2DecodedFramesV1 {
	const row = exactRecord(value, DECODED_FIELDS, 'TransNetV2 decoded RGB frames');
	if (row.schemaVersion !== 1 || row.pixelFormat !== 'rgb24'
		|| row.width !== ASSISTANCE_TRANSNET_V2_WIDTH
		|| row.height !== ASSISTANCE_TRANSNET_V2_HEIGHT
		|| row.rowStrideBytes !== ASSISTANCE_TRANSNET_V2_ROW_STRIDE_BYTES) {
		throw new TypeError('TransNetV2 decoded RGB geometry, format, or stride is invalid.');
	}
	const timescale = integer(row.timescale, 1, MAXIMUM_TIMESCALE, 'TransNetV2 timescale');
	const presentationTicks = timing(row.presentationTicks);
	if (!(row.data instanceof Uint8Array) || !(row.data.buffer instanceof ArrayBuffer)
		|| row.data.byteLength !== presentationTicks.length * ASSISTANCE_TRANSNET_V2_FRAME_BYTES) {
		throw new RangeError('TransNetV2 decoded RGB data length or storage is invalid.');
	}
	return Object.freeze({
		schemaVersion: 1, pixelFormat: 'rgb24',
		width: ASSISTANCE_TRANSNET_V2_WIDTH, height: ASSISTANCE_TRANSNET_V2_HEIGHT,
		rowStrideBytes: ASSISTANCE_TRANSNET_V2_ROW_STRIDE_BYTES,
		timescale, presentationTicks, data: row.data,
	});
}

export function createAssistanceTransNetV2CpuInputBatchV1(
	framesValue: unknown,
	batchIndexValue: unknown,
	elementTypeValue: unknown,
): AssistanceTransNetV2CpuInputBatchV1 {
	const frames = validateAssistanceTransNetV2DecodedFramesV1(framesValue);
	const batchCount = assistanceTransNetV2BatchCount(frames.presentationTicks.length);
	const batchIndex = integer(batchIndexValue, 0, batchCount - 1, 'TransNetV2 batch index');
	const elementType = inputElementType(elementTypeValue);
	return createBatch(frames, batchIndex, elementType);
}

export async function runAssistanceTransNetV2OnnxAdapterV1(
	value: unknown,
	options: AssistanceTransNetV2OnnxAdapterOptionsV1,
): Promise<AssistanceTransNetV2BoundariesV1> {
	if (!options || typeof options.runBatch !== 'function') {
		throw new TypeError('The TransNetV2 ONNX batch runner is invalid.');
	}
	const request = validateRequest(value);
	return runFrameSource({ ...request, frames: sourceFromDecoded(request.frames) }, options);
}

/** Run the same reviewed window authority over bounded, lazily supplied RGB frames. */
export async function runAssistanceTransNetV2FrameSourceOnnxAdapterV1(
	value: unknown,
	options: AssistanceTransNetV2OnnxAdapterOptionsV1,
): Promise<AssistanceTransNetV2BoundariesV1> {
	if (!options || typeof options.runBatch !== 'function') {
		throw new TypeError('The TransNetV2 ONNX batch runner is invalid.');
	}
	return runFrameSource(validateFrameSourceRequest(value), options);
}

async function runFrameSource(
	request: AssistanceTransNetV2OnnxFrameSourceRequestV1,
	options: AssistanceTransNetV2OnnxAdapterOptionsV1,
): Promise<AssistanceTransNetV2BoundariesV1> {
	options.signal?.throwIfAborted();
	const frameCount = request.frames.presentationTicks.length;
	const batchCount = assistanceTransNetV2BatchCount(frameCount);
	const single = new Float32Array(frameCount);
	const all = new Float32Array(frameCount);
	const authority = new Uint8Array(frameCount);
	for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
		options.signal?.throwIfAborted();
		const batch = await createFrameSourceBatch(
			request.frames, batchIndex, request.inputElementType, options.signal,
		);
		const candidate = await options.runBatch(batch);
		options.signal?.throwIfAborted();
		const output = validateOutput(candidate, request.outputValueKind);
		for (let offset = 0; offset < batch.authoritativeFrameCount; offset += 1) {
			const sourceFrame = batch.sourceFrameStart + offset;
			if (authority[sourceFrame] !== 0) {
				throw new Error('TransNetV2 overlapping batches repeated source-frame authority.');
			}
			authority[sourceFrame] = 1;
			const tensorFrame = ASSISTANCE_TRANSNET_V2_CONTEXT_FRAMES + offset;
			single[sourceFrame] = probability(
				output.singleFrame.data[tensorFrame]!, request.outputValueKind, 'single-frame',
			);
			all[sourceFrame] = probability(
				output.allFrame.data[tensorFrame]!, request.outputValueKind, 'all-frame',
			);
		}
	}
	options.signal?.throwIfAborted();
	if (authority.some((count) => count !== 1)) {
		throw new Error('TransNetV2 batches did not cover every source frame exactly once.');
	}
	return createAssistanceTransNetV2BoundariesV1({
		timescale: request.frames.timescale,
		sourceFrames: request.frames.sourceFrames,
		presentationTicks: request.frames.presentationTicks,
		singleFrameProbabilities: single,
		allFrameProbabilities: all,
		threshold: request.threshold,
		minimumBoundaryDistanceFrames: request.minimumBoundaryDistanceFrames,
	});
}

function validateRequest(value: unknown): AssistanceTransNetV2OnnxAdapterRequestV1 {
	const row = exactRecord(value, REQUEST_FIELDS, 'TransNetV2 ONNX adapter request');
	if (row.schemaVersion !== 1) throw new TypeError('The TransNetV2 adapter version is unsupported.');
	const frames = validateAssistanceTransNetV2DecodedFramesV1(row.frames);
	return Object.freeze({
		schemaVersion: 1,
		frames,
		inputElementType: inputElementType(row.inputElementType),
		outputValueKind: outputValueKind(row.outputValueKind),
		threshold: unit(row.threshold, 'TransNetV2 threshold'),
		minimumBoundaryDistanceFrames: integer(row.minimumBoundaryDistanceFrames, 1,
			frames.presentationTicks.length, 'TransNetV2 minimum boundary distance'),
	});
}

function validateFrameSourceRequest(value: unknown): AssistanceTransNetV2OnnxFrameSourceRequestV1 {
	const row = exactRecord(value, REQUEST_FIELDS, 'TransNetV2 ONNX frame-source request');
	if (row.schemaVersion !== 1) throw new TypeError('The TransNetV2 adapter version is unsupported.');
	const frames = validateFrameSource(row.frames);
	return Object.freeze({
		schemaVersion: 1,
		frames,
		inputElementType: inputElementType(row.inputElementType),
		outputValueKind: outputValueKind(row.outputValueKind),
		threshold: unit(row.threshold, 'TransNetV2 threshold'),
		minimumBoundaryDistanceFrames: integer(row.minimumBoundaryDistanceFrames, 1,
			frames.frameCount, 'TransNetV2 minimum boundary distance'),
	});
}

function validateFrameSource(value: unknown): AssistanceTransNetV2DecodedFrameSourceV1 {
	const row = exactRecord(value, FRAME_SOURCE_FIELDS, 'TransNetV2 decoded RGB frame source');
	if (row.schemaVersion !== 1 || row.pixelFormat !== 'rgb24'
		|| row.width !== ASSISTANCE_TRANSNET_V2_WIDTH
		|| row.height !== ASSISTANCE_TRANSNET_V2_HEIGHT
		|| row.rowStrideBytes !== ASSISTANCE_TRANSNET_V2_ROW_STRIDE_BYTES
		|| typeof row.readFrame !== 'function') {
		throw new TypeError('TransNetV2 decoded RGB frame-source geometry or reader is invalid.');
	}
	const timescale = integer(row.timescale, 1, MAXIMUM_TIMESCALE, 'TransNetV2 timescale');
	const presentationTicks = timing(row.presentationTicks);
	const frameCount = integer(row.frameCount, 1, MAXIMUM_SOURCE_FRAMES,
		'TransNetV2 source frame count');
	if (presentationTicks.length !== frameCount) {
		throw new RangeError('TransNetV2 frame-source timing disagrees with its frame count.');
	}
	const sourceFrames = sourceOrdinals(row.sourceFrames, frameCount);
	return Object.freeze({
		schemaVersion: 1, pixelFormat: 'rgb24',
		width: ASSISTANCE_TRANSNET_V2_WIDTH, height: ASSISTANCE_TRANSNET_V2_HEIGHT,
		rowStrideBytes: ASSISTANCE_TRANSNET_V2_ROW_STRIDE_BYTES,
		timescale, frameCount, sourceFrames, presentationTicks,
		readFrame: row.readFrame as AssistanceTransNetV2DecodedFrameSourceV1['readFrame'],
	});
}

function sourceFromDecoded(
	frames: AssistanceTransNetV2DecodedFramesV1,
): AssistanceTransNetV2DecodedFrameSourceV1 {
	return Object.freeze({
		schemaVersion: 1, pixelFormat: 'rgb24', width: ASSISTANCE_TRANSNET_V2_WIDTH,
		height: ASSISTANCE_TRANSNET_V2_HEIGHT,
		rowStrideBytes: ASSISTANCE_TRANSNET_V2_ROW_STRIDE_BYTES,
		timescale: frames.timescale, frameCount: frames.presentationTicks.length,
		sourceFrames: Object.freeze(frames.presentationTicks.map((_, index) => index)),
		presentationTicks: frames.presentationTicks,
		readFrame(index: number) {
			const offset = index * ASSISTANCE_TRANSNET_V2_FRAME_BYTES;
			return frames.data.subarray(offset, offset + ASSISTANCE_TRANSNET_V2_FRAME_BYTES);
		},
	});
}

function createBatch(
	frames: AssistanceTransNetV2DecodedFramesV1,
	batchIndex: number,
	elementType: AssistanceTransNetV2InputElementType,
): AssistanceTransNetV2CpuInputBatchV1 {
	const tensorElements = ASSISTANCE_TRANSNET_V2_WINDOW_FRAMES * ASSISTANCE_TRANSNET_V2_FRAME_BYTES;
	const data = elementType === 'uint8'
		? new Uint8Array(tensorElements) : new Float32Array(tensorElements);
	const sourceFrameStart = batchIndex * ASSISTANCE_TRANSNET_V2_WINDOW_STEP_FRAMES;
	for (let tensorFrame = 0; tensorFrame < ASSISTANCE_TRANSNET_V2_WINDOW_FRAMES; tensorFrame += 1) {
		const unclamped = sourceFrameStart + tensorFrame - ASSISTANCE_TRANSNET_V2_CONTEXT_FRAMES;
		const sourceFrame = Math.max(0, Math.min(frames.presentationTicks.length - 1, unclamped));
		const sourceOffset = sourceFrame * ASSISTANCE_TRANSNET_V2_FRAME_BYTES;
		data.set(frames.data.subarray(sourceOffset, sourceOffset + ASSISTANCE_TRANSNET_V2_FRAME_BYTES),
			tensorFrame * ASSISTANCE_TRANSNET_V2_FRAME_BYTES);
	}
	return Object.freeze({
		schemaVersion: 1, batchIndex, sourceFrameStart,
		authoritativeFrameCount: Math.min(
			ASSISTANCE_TRANSNET_V2_WINDOW_STEP_FRAMES,
			frames.presentationTicks.length - sourceFrameStart,
		),
		elementType, dims: ASSISTANCE_TRANSNET_V2_CPU_INPUT_SHAPE, data,
	});
}

async function createFrameSourceBatch(
	frames: AssistanceTransNetV2DecodedFrameSourceV1,
	batchIndex: number,
	elementType: AssistanceTransNetV2InputElementType,
	signal?: AbortSignal,
): Promise<AssistanceTransNetV2CpuInputBatchV1> {
	const tensorElements = ASSISTANCE_TRANSNET_V2_WINDOW_FRAMES * ASSISTANCE_TRANSNET_V2_FRAME_BYTES;
	const data = elementType === 'uint8'
		? new Uint8Array(tensorElements) : new Float32Array(tensorElements);
	const sourceFrameStart = batchIndex * ASSISTANCE_TRANSNET_V2_WINDOW_STEP_FRAMES;
	for (let tensorFrame = 0; tensorFrame < ASSISTANCE_TRANSNET_V2_WINDOW_FRAMES; tensorFrame += 1) {
		signal?.throwIfAborted();
		const unclamped = sourceFrameStart + tensorFrame - ASSISTANCE_TRANSNET_V2_CONTEXT_FRAMES;
		const sourceFrame = Math.max(0, Math.min(frames.frameCount - 1, unclamped));
		const value = await frames.readFrame(sourceFrame);
		if (!(value instanceof Uint8Array) || !(value.buffer instanceof ArrayBuffer)
			|| value.byteLength !== ASSISTANCE_TRANSNET_V2_FRAME_BYTES) {
			throw new RangeError('TransNetV2 frame-source RGB data has invalid exact geometry.');
		}
		data.set(value, tensorFrame * ASSISTANCE_TRANSNET_V2_FRAME_BYTES);
	}
	return Object.freeze({
		schemaVersion: 1, batchIndex, sourceFrameStart,
		authoritativeFrameCount: Math.min(
			ASSISTANCE_TRANSNET_V2_WINDOW_STEP_FRAMES,
			frames.frameCount - sourceFrameStart,
		),
		elementType, dims: ASSISTANCE_TRANSNET_V2_CPU_INPUT_SHAPE, data,
	});
}

function validateOutput(
	value: unknown,
	valueKind: AssistanceTransNetV2OutputValueKind,
): AssistanceTransNetV2OnnxBatchOutputV1 {
	const row = exactRecord(value, ['singleFrame', 'allFrame'] as const,
		'TransNetV2 ONNX batch output');
	return Object.freeze({
		singleFrame: outputTensor(row.singleFrame, valueKind, 'single-frame'),
		allFrame: outputTensor(row.allFrame, valueKind, 'all-frame'),
	});
}

function outputTensor(
	value: unknown,
	valueKind: AssistanceTransNetV2OutputValueKind,
	label: string,
): AssistanceTransNetV2OnnxOutputTensorV1 {
	const row = exactRecord(value, ['type', 'dims', 'data'] as const,
		`TransNetV2 ${label} output tensor`);
	if (row.type !== 'float32' || !exactDimensions(row.dims, ASSISTANCE_TRANSNET_V2_CPU_OUTPUT_SHAPE)
		|| !(row.data instanceof Float32Array)
		|| !(row.data.buffer instanceof ArrayBuffer)
		|| row.data.length !== ASSISTANCE_TRANSNET_V2_WINDOW_FRAMES) {
		throw new TypeError(`The TransNetV2 ${label} output tensor type, shape, or length is invalid.`);
	}
	for (const candidate of row.data) probability(candidate, valueKind, label);
	return Object.freeze({
		type: 'float32', dims: ASSISTANCE_TRANSNET_V2_CPU_OUTPUT_SHAPE, data: row.data,
	});
}

function probability(
	value: number,
	valueKind: AssistanceTransNetV2OutputValueKind,
	label: string,
): number {
	if (!Number.isFinite(value)) {
		throw new RangeError(`Every TransNetV2 ${label} ${valueKind === 'logits' ? 'logit' : 'probability'} must be finite.`);
	}
	if (valueKind === 'probabilities') {
		if (value < 0 || value > 1) {
			throw new RangeError(`Every TransNetV2 ${label} probability must be finite and within [0, 1].`);
		}
		return Math.fround(value);
	}
	const sigmoid = value >= 0
		? 1 / (1 + Math.exp(-value))
		: Math.exp(value) / (1 + Math.exp(value));
	return Math.fround(sigmoid);
}

function assistanceTransNetV2BatchCount(frameCount: number): number {
	return Math.ceil(frameCount / ASSISTANCE_TRANSNET_V2_WINDOW_STEP_FRAMES);
}

function timing(value: unknown): readonly string[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAXIMUM_SOURCE_FRAMES) {
		throw new RangeError('The TransNetV2 presentation timing exceeds its frame bound.');
	}
	let prior = -1n;
	return Object.freeze(value.map((candidate, index) => {
		if (typeof candidate !== 'string' || !TICK.test(candidate)) {
			throw new RangeError(`TransNetV2 presentation tick ${String(index)} is invalid.`);
		}
		const tick = BigInt(candidate);
		if (tick > MAXIMUM_TICK || tick <= prior) {
			throw new RangeError('TransNetV2 presentation ticks must be strictly increasing.');
		}
		prior = tick;
		return candidate;
	}));
}

function sourceOrdinals(value: unknown, frameCount: number): readonly number[] {
	if (!Array.isArray(value) || value.length !== frameCount) {
		throw new RangeError('The TransNetV2 source-frame authority disagrees with its frame count.');
	}
	let prior = -1;
	return Object.freeze(value.map((candidate, index) => {
		const sourceFrame = integer(candidate, 0, MAXIMUM_SOURCE_FRAMES - 1,
			`TransNetV2 source frame ${String(index)}`);
		if (index > 0 && sourceFrame !== prior + 1) {
			throw new RangeError('TransNetV2 source frames must be consecutive and strictly increasing.');
		}
		prior = sourceFrame;
		return sourceFrame;
	}));
}

function inputElementType(value: unknown): AssistanceTransNetV2InputElementType {
	if (value !== 'uint8' && value !== 'float32') {
		throw new TypeError('The TransNetV2 CPU input element type is invalid.');
	}
	return value;
}

function outputValueKind(value: unknown): AssistanceTransNetV2OutputValueKind {
	if (value !== 'logits' && value !== 'probabilities') {
		throw new TypeError('The TransNetV2 ONNX output value kind is invalid.');
	}
	return value;
}

function exactDimensions(value: unknown, expected: readonly number[]): boolean {
	return Array.isArray(value) && value.length === expected.length
		&& value.every((candidate, index) => candidate === expected[index]);
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Object.keys(row);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return row as Record<Field, unknown>;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function unit(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`The ${label} must be finite and within [0, 1].`);
	}
	return value;
}
