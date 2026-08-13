/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveVideoKeyframeExportFrameCount,
} from './video-keyframe-export-frame-source.ts';
import {
	AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE,
	AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE,
} from './project-v10-foundation-validation.ts';
import {
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_AUDIO_FRAME_RATE,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_TOTAL_RGBA_BYTES,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH,
} from './video-keyframe-encoder-admission.ts';

export type VideoKeyframeExportPlanFormatV7 = 'mp4' | 'webm';

export interface VideoKeyframeExportPlanV7 extends Readonly<Record<string, unknown>> {
	readonly version: 7;
	readonly strategy: 'framescaper-keyframed-rgba-v1';
	readonly format: VideoKeyframeExportPlanFormatV7;
	readonly container: VideoKeyframeExportPlanFormatV7;
	readonly extension: VideoKeyframeExportPlanFormatV7;
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly sampleRate: number;
	readonly duration: Readonly<{ readonly num: number; readonly den: number }>;
	readonly range: Readonly<{
		readonly startFrame: number; readonly endFrame: number; readonly durationFrames: number;
	}>;
	readonly outputFrameCount: number;
	readonly canvas: Readonly<{
		readonly width: number;
		readonly height: number;
		readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
		readonly pixelFormat: 'yuv420p';
		readonly backgroundColor: string;
		readonly referenceClipId: string | null;
		readonly referenceSourceId: string | null;
	}>;
	readonly codecs: Readonly<{
		readonly video: 'h264' | 'vp9';
		readonly videoEncoder: 'libx264' | 'libvpx-vp9';
		readonly audio: 'aac' | 'opus' | null;
		readonly audioEncoder: 'aac' | 'libopus' | null;
		readonly pixelFormat: 'yuv420p';
	}>;
	readonly activeClipIds: readonly string[];
	readonly activeSourceIds: readonly string[];
	readonly inputs: readonly VideoKeyframeExportPlanInputV7[];
}

export type VideoKeyframeExportPlanInputV7 =
	| Readonly<{
		readonly kind: 'video-source'; readonly inputIndex: number; readonly sourceId: string;
		readonly storageKey: string; readonly mimeType: string; readonly contentSha256: string;
	}>
	| Readonly<{
		readonly kind: 'staged-audio-mix'; readonly inputIndex: number; readonly fileName: string;
		readonly sampleRate: number; readonly startFrame: number; readonly durationFrames: number;
	}>;

export interface VideoKeyframeExportPlanV7Request {
	readonly format: VideoKeyframeExportPlanFormatV7;
	readonly sampleRate: number;
	readonly range: Readonly<{
		readonly startFrame: number; readonly endFrame: number; readonly durationFrames: number;
	}>;
	readonly canvas: Readonly<{
		readonly width: number;
		readonly height: number;
		readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
		readonly pixelFormat: 'yuv420p';
		readonly backgroundColor: string;
		readonly referenceClipId: string | null;
		readonly referenceSourceId: string | null;
	}>;
	readonly activeClipIds: readonly string[];
	readonly activeSourceIds: readonly string[];
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly includeAudio: boolean;
	readonly audioFileName?: string;
}

interface FormatDescriptor {
	readonly format: VideoKeyframeExportPlanFormatV7;
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly video: 'h264' | 'vp9';
	readonly videoEncoder: 'libx264' | 'libvpx-vp9';
	readonly audio: 'aac' | 'opus';
	readonly audioEncoder: 'aac' | 'libopus';
}

const PLAN_FIELDS = [
	'version', 'strategy', 'format', 'container', 'extension', 'mimeType', 'sampleRate',
	'duration', 'range', 'outputFrameCount', 'canvas', 'codecs', 'activeClipIds',
	'activeSourceIds', 'inputs',
] as const;
const REQUEST_FIELDS = [
	'format', 'sampleRate', 'range', 'canvas', 'activeClipIds', 'activeSourceIds',
	'sources', 'includeAudio', 'audioFileName',
] as const;
const RANGE_FIELDS = ['startFrame', 'endFrame', 'durationFrames'] as const;
const RATIONAL_FIELDS = ['num', 'den'] as const;
const CANVAS_FIELDS = [
	'width', 'height', 'frameRate', 'pixelFormat', 'backgroundColor',
	'referenceClipId', 'referenceSourceId',
] as const;
const CODEC_FIELDS = ['video', 'videoEncoder', 'audio', 'audioEncoder', 'pixelFormat'] as const;
const VIDEO_INPUT_FIELDS = [
	'kind', 'inputIndex', 'sourceId', 'storageKey', 'mimeType', 'contentSha256',
] as const;
const AUDIO_INPUT_FIELDS = [
	'kind', 'inputIndex', 'fileName', 'sampleRate', 'startFrame', 'durationFrames',
] as const;
const SOURCE_MAXIMUM = 4_096;
const CLIP_MAXIMUM = 100_000;
const SHA256 = /^[a-f0-9]{64}$/u;
const VIDEO_MIME = /^video\/[a-z0-9][a-z0-9.+-]{0,126}$/u;
const FORMATS: Readonly<Record<VideoKeyframeExportPlanFormatV7, FormatDescriptor>> = Object.freeze({
	mp4: Object.freeze({
		format: 'mp4', mimeType: 'video/mp4', video: 'h264', videoEncoder: 'libx264',
		audio: 'aac', audioEncoder: 'aac',
	}),
	webm: Object.freeze({
		format: 'webm', mimeType: 'video/webm', video: 'vp9', videoEncoder: 'libvpx-vp9',
		audio: 'opus', audioEncoder: 'libopus',
	}),
});

/** Create the detached, deterministic keyed-RGBA contract consumed by offline encoding. */
export function createVideoKeyframeExportPlanV7(
	requestValue: VideoKeyframeExportPlanV7Request | unknown,
): VideoKeyframeExportPlanV7 {
	const request = closedRecord(requestValue, REQUEST_FIELDS, 'video keyframe export plan request', false);
	const format = exactFormat(data(request, 'format', 'video keyframe export plan request'));
	const descriptor = FORMATS[format];
	const sampleRate = projectSampleRate(
		data(request, 'sampleRate', 'video keyframe export plan request'),
	);
	const range = captureRange(data(request, 'range', 'video keyframe export plan request'));
	const duration = reducedFraction(range.durationFrames, sampleRate);
	const activeClipIds = captureIds(
		data(request, 'activeClipIds', 'video keyframe export plan request'), 'activeClipIds', CLIP_MAXIMUM,
	);
	const activeSourceIds = captureIds(
		data(request, 'activeSourceIds', 'video keyframe export plan request'), 'activeSourceIds', SOURCE_MAXIMUM,
	);
	const canvas = captureCanvas(
		data(request, 'canvas', 'video keyframe export plan request'), activeClipIds, activeSourceIds,
	);
	const sourceById = captureSources(
		data(request, 'sources', 'video keyframe export plan request'), activeSourceIds,
	);
	const includeAudio = boolean(data(request, 'includeAudio', 'video keyframe export plan request'), 'includeAudio');
	if (!includeAudio && Object.hasOwn(request, 'audioFileName')) {
		throw new TypeError('audioFileName requires includeAudio to be true.');
	}
	const inputs: VideoKeyframeExportPlanInputV7[] = activeSourceIds.map((sourceId, inputIndex) => {
		const source = sourceById.get(sourceId);
		if (!source) throw new ReferenceError(`Active video source ${sourceId} is not canonical.`);
		return Object.freeze({ kind: 'video-source' as const, inputIndex, ...source });
	});
	if (includeAudio) {
		const fileName = audioFileName(
			optionalData(request, 'audioFileName', 'audio-mix.wav', 'video keyframe export plan request'),
		);
		inputs.push(Object.freeze({
			kind: 'staged-audio-mix', inputIndex: inputs.length, fileName, sampleRate,
			startFrame: range.startFrame, durationFrames: range.durationFrames,
		}));
	}
	const outputFrameCount = resolveVideoKeyframeExportFrameCount(
		range.durationFrames, sampleRate, canvas.frameRate,
	);
	assertEncoderDomain(canvas.width, canvas.height, outputFrameCount);
	const plan = deepFreeze({
		version: 7 as const,
		strategy: 'framescaper-keyframed-rgba-v1' as const,
		format,
		container: format,
		extension: format,
		mimeType: descriptor.mimeType,
		sampleRate,
		duration,
		range,
		outputFrameCount,
		canvas,
		codecs: {
			video: descriptor.video,
			videoEncoder: descriptor.videoEncoder,
			audio: includeAudio ? descriptor.audio : null,
			audioEncoder: includeAudio ? descriptor.audioEncoder : null,
			pixelFormat: 'yuv420p' as const,
		},
		activeClipIds,
		activeSourceIds,
		inputs,
	});
	assertVideoKeyframeExportPlanV7(plan);
	return plan;
}

/** Admit an independently parsed plan; process identity is deliberately unnecessary. */
export function assertVideoKeyframeExportPlanV7(
	value: unknown,
): asserts value is VideoKeyframeExportPlanV7 {
	const plan = closedRecord(value, PLAN_FIELDS, 'video keyframe export plan V7', true);
	if (data(plan, 'version', 'video keyframe export plan V7') !== 7
		|| data(plan, 'strategy', 'video keyframe export plan V7') !== 'framescaper-keyframed-rgba-v1') {
		throw new TypeError('Video keyframe export plan V7 has a non-canonical authority marker.');
	}
	const format = exactFormat(data(plan, 'format', 'video keyframe export plan V7'));
	const descriptor = FORMATS[format];
	if (data(plan, 'container', 'video keyframe export plan V7') !== format
		|| data(plan, 'extension', 'video keyframe export plan V7') !== format
		|| data(plan, 'mimeType', 'video keyframe export plan V7') !== descriptor.mimeType) {
		throw new TypeError('Video keyframe export plan V7 format metadata is not canonical.');
	}
	const sampleRate = projectSampleRate(data(plan, 'sampleRate', 'video keyframe export plan V7'));
	const range = captureRange(data(plan, 'range', 'video keyframe export plan V7'));
	const duration = captureRational(data(plan, 'duration', 'video keyframe export plan V7'), 'duration');
	const expectedDuration = reducedFraction(range.durationFrames, sampleRate);
	if (duration.num !== expectedDuration.num || duration.den !== expectedDuration.den) {
		throw new RangeError('Video keyframe export plan V7 duration is not its exact sample fraction.');
	}
	const activeClipIds = captureIds(
		data(plan, 'activeClipIds', 'video keyframe export plan V7'), 'activeClipIds', CLIP_MAXIMUM,
	);
	const activeSourceIds = captureIds(
		data(plan, 'activeSourceIds', 'video keyframe export plan V7'), 'activeSourceIds', SOURCE_MAXIMUM,
	);
	const canvas = captureCanvas(
		data(plan, 'canvas', 'video keyframe export plan V7'), activeClipIds, activeSourceIds,
	);
	const outputFrameCount = positiveInteger(
		data(plan, 'outputFrameCount', 'video keyframe export plan V7'), 'outputFrameCount',
	);
	if (outputFrameCount !== resolveVideoKeyframeExportFrameCount(
		range.durationFrames, sampleRate, canvas.frameRate,
	)) throw new RangeError('Video keyframe export plan V7 frame count is not exact.');
	assertEncoderDomain(canvas.width, canvas.height, outputFrameCount);
	const inputs = denseArray(data(plan, 'inputs', 'video keyframe export plan V7'), 'inputs', SOURCE_MAXIMUM + 1);
	const hasAudio = captureInputs(inputs, activeSourceIds, sampleRate, range);
	validateCodecs(data(plan, 'codecs', 'video keyframe export plan V7'), descriptor, hasAudio);
}

export function isVideoKeyframeExportPlanV7(value: unknown): value is VideoKeyframeExportPlanV7 {
	try { assertVideoKeyframeExportPlanV7(value); return true; } catch { return false; }
}

function captureInputs(
	inputs: readonly unknown[],
	activeSourceIds: readonly string[],
	sampleRate: number,
	range: Readonly<{ startFrame: number; durationFrames: number }>,
): boolean {
	if (inputs.length !== activeSourceIds.length && inputs.length !== activeSourceIds.length + 1) {
		throw new RangeError('Video keyframe export plan V7 inputs do not match active sources.');
	}
	for (const [index, sourceId] of activeSourceIds.entries()) {
		const input = closedRecord(inputs[index], VIDEO_INPUT_FIELDS, `inputs[${String(index)}]`, true);
		if (data(input, 'kind', 'video source input') !== 'video-source'
			|| data(input, 'inputIndex', 'video source input') !== index
			|| id(data(input, 'sourceId', 'video source input'), 'input.sourceId') !== sourceId) {
			throw new TypeError('Video keyframe export plan V7 source input order is not canonical.');
		}
		boundedString(data(input, 'storageKey', 'video source input'), 'input.storageKey');
		videoMime(data(input, 'mimeType', 'video source input'));
		digest(data(input, 'contentSha256', 'video source input'));
	}
	if (inputs.length === activeSourceIds.length) return false;
	const index = activeSourceIds.length;
	const audio = closedRecord(inputs[index], AUDIO_INPUT_FIELDS, `inputs[${String(index)}]`, true);
	if (data(audio, 'kind', 'audio input') !== 'staged-audio-mix'
		|| data(audio, 'inputIndex', 'audio input') !== index
		|| positiveInteger(data(audio, 'sampleRate', 'audio input'), 'audio input sampleRate') !== sampleRate
		|| nonNegativeInteger(data(audio, 'startFrame', 'audio input'), 'audio input startFrame') !== range.startFrame
		|| positiveInteger(data(audio, 'durationFrames', 'audio input'), 'audio input durationFrames') !== range.durationFrames) {
		throw new TypeError('Video keyframe export plan V7 audio input is not range-exact.');
	}
	audioFileName(data(audio, 'fileName', 'audio input'));
	return true;
}

function validateCodecs(value: unknown, descriptor: FormatDescriptor, hasAudio: boolean): void {
	const codecs = closedRecord(value, CODEC_FIELDS, 'video keyframe export plan V7 codecs', true);
	if (data(codecs, 'video', 'codecs') !== descriptor.video
		|| data(codecs, 'videoEncoder', 'codecs') !== descriptor.videoEncoder
		|| data(codecs, 'pixelFormat', 'codecs') !== 'yuv420p'
		|| data(codecs, 'audio', 'codecs') !== (hasAudio ? descriptor.audio : null)
		|| data(codecs, 'audioEncoder', 'codecs') !== (hasAudio ? descriptor.audioEncoder : null)) {
		throw new TypeError('Video keyframe export plan V7 codec metadata is not canonical.');
	}
}

function captureCanvas(
	value: unknown,
	activeClipIds: readonly string[],
	activeSourceIds: readonly string[],
) {
	const canvas = closedRecord(value, CANVAS_FIELDS, 'video keyframe export plan canvas', true);
	const referenceClipId = nullableId(data(canvas, 'referenceClipId', 'canvas'), 'canvas.referenceClipId');
	const referenceSourceId = nullableId(data(canvas, 'referenceSourceId', 'canvas'), 'canvas.referenceSourceId');
	if ((referenceClipId === null) !== (referenceSourceId === null)
		|| (referenceClipId !== null && !activeClipIds.includes(referenceClipId))
		|| (referenceSourceId !== null && !activeSourceIds.includes(referenceSourceId))) {
		throw new RangeError('Video keyframe export plan canvas reference is outside its active range.');
	}
	const width = positiveInteger(data(canvas, 'width', 'canvas'), 'canvas.width');
	const height = positiveInteger(data(canvas, 'height', 'canvas'), 'canvas.height');
	if (width % 2 !== 0 || height % 2 !== 0) throw new RangeError('Video keyframe export canvas must be even.');
	if (width > VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH
		|| height > VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT) {
		throw new RangeError('Video keyframe export canvas exceeds the encoder geometry ceiling.');
	}
	if (data(canvas, 'pixelFormat', 'canvas') !== 'yuv420p') {
		throw new TypeError('Video keyframe export plan canvas pixel format must be yuv420p.');
	}
	const frameRate = captureRational(data(canvas, 'frameRate', 'canvas'), 'canvas.frameRate');
	if (BigInt(frameRate.num) < BigInt(frameRate.den)
		|| BigInt(frameRate.num)
			> BigInt(VIDEO_KEYFRAME_ENCODER_MAXIMUM_AUDIO_FRAME_RATE) * BigInt(frameRate.den)) {
		throw new RangeError('Video keyframe export frame rate exceeds the encoder ceiling of 1 through 30 frames per second.');
	}
	return Object.freeze({
		width,
		height,
		frameRate,
		pixelFormat: 'yuv420p' as const,
		backgroundColor: canonicalColor(data(canvas, 'backgroundColor', 'canvas')),
		referenceClipId,
		referenceSourceId,
	});
}

function assertEncoderDomain(width: number, height: number, frameCount: number): void {
	if (frameCount > VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT) {
		throw new RangeError('Video keyframe export frame count exceeds the encoder ceiling.');
	}
	const total = BigInt(width) * BigInt(height) * 4n * BigInt(frameCount);
	if (total > BigInt(VIDEO_KEYFRAME_ENCODER_MAXIMUM_TOTAL_RGBA_BYTES)) {
		throw new RangeError('Video keyframe export logical RGBA work exceeds the encoder ceiling.');
	}
}

function captureRange(value: unknown) {
	const range = closedRecord(value, RANGE_FIELDS, 'video keyframe export plan range', true);
	const startFrame = nonNegativeInteger(data(range, 'startFrame', 'range'), 'range.startFrame');
	const endFrame = positiveInteger(data(range, 'endFrame', 'range'), 'range.endFrame');
	const durationFrames = positiveInteger(data(range, 'durationFrames', 'range'), 'range.durationFrames');
	if (endFrame - startFrame !== durationFrames) throw new RangeError('Video keyframe export range is inconsistent.');
	return Object.freeze({ startFrame, endFrame, durationFrames });
}

function captureSources(value: unknown, activeSourceIds: readonly string[]) {
	const values = denseArray(value, 'sources', SOURCE_MAXIMUM);
	const active = new Set(activeSourceIds);
	const result = new Map<string, Readonly<{
		sourceId: string; storageKey: string; mimeType: string; contentSha256: string;
	}>>();
	for (const [index, item] of values.entries()) {
		const source = record(item, `sources[${String(index)}]`);
		const sourceId = id(data(source, 'id', 'source'), 'source.id');
		if (!active.has(sourceId)) continue;
		if (result.has(sourceId)) throw new RangeError(`Duplicate canonical video source ${sourceId}.`);
		if (data(source, 'kind', 'source') !== 'video') throw new TypeError(`Source ${sourceId} must be video.`);
		result.set(sourceId, Object.freeze({
			sourceId,
			storageKey: boundedString(data(source, 'storageKey', 'source'), 'source.storageKey'),
			mimeType: videoMime(data(source, 'mimeType', 'source')),
			contentSha256: digest(data(source, 'contentSha256', 'source')),
		}));
	}
	if (result.size !== activeSourceIds.length) {
		throw new ReferenceError('Every active video source requires one canonical source descriptor.');
	}
	return result;
}

function captureIds(value: unknown, name: string, maximum: number): readonly string[] {
	const values = denseArray(value, name, maximum);
	if (values.length < 1) throw new RangeError(`${name} must not be empty.`);
	const result = values.map((value, index) => id(value, `${name}[${String(index)}]`));
	if (new Set(result).size !== result.length) throw new RangeError(`${name} must contain unique IDs.`);
	return Object.freeze(result);
}

function captureRational(value: unknown, name: string) {
	const rational = closedRecord(value, RATIONAL_FIELDS, name, true);
	const num = positiveInteger(data(rational, 'num', name), `${name}.num`);
	const den = positiveInteger(data(rational, 'den', name), `${name}.den`);
	if (gcd(BigInt(num), BigInt(den)) !== 1n) throw new RangeError(`${name} must be reduced.`);
	return Object.freeze({ num, den });
}

function reducedFraction(numerator: number, denominator: number) {
	const factor = gcd(BigInt(numerator), BigInt(denominator));
	return Object.freeze({ num: Number(BigInt(numerator) / factor), den: Number(BigInt(denominator) / factor) });
}

function gcd(left: bigint, right: bigint): bigint {
	let a = left;
	let b = right;
	while (b !== 0n) [a, b] = [b, a % b];
	return a;
}

function exactFormat(value: unknown): VideoKeyframeExportPlanFormatV7 {
	if (value !== 'mp4' && value !== 'webm') throw new RangeError('Video keyframe export format must be mp4 or webm.');
	return value;
}

function videoMime(value: unknown): string {
	const result = boundedString(value, 'video MIME type', 128);
	if (!VIDEO_MIME.test(result)) throw new TypeError('Video MIME type must be canonical.');
	return result;
}

function canonicalColor(value: unknown): string {
	if (value !== '#000000') {
		throw new TypeError('Video keyframe export backgroundColor must match the opaque-black compositor.');
	}
	return '#000000';
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError('Video source contentSha256 must be a lowercase SHA-256 digest.');
	}
	return value;
}

function audioFileName(value: unknown): string {
	const result = boundedString(value, 'audioFileName', 255);
	if (!result.toLowerCase().endsWith('.wav') || result.includes('/') || result.includes('\\')) {
		throw new TypeError('audioFileName must be a local WAV file name.');
	}
	return result;
}

function nullableId(value: unknown, name: string): string | null {
	return value === null ? null : id(value, name);
}

function id(value: unknown, name: string): string {
	return boundedString(value, name, 1_024);
}

function boundedString(value: unknown, name: string, maximum = 1_024): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`${name} must be a bounded non-empty string.`);
	}
	return value;
}

function boolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean.`);
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	const result = nonNegativeInteger(value, name);
	if (result === 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function projectSampleRate(value: unknown): number {
	const result = positiveInteger(value, 'sampleRate');
	if (result < AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE
		|| result > AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE) {
		throw new RangeError(
			`Video keyframe export sample rate must be ${String(AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE)} through ${String(AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE)}.`,
		);
	}
	return result;
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	return value as Readonly<Record<string, unknown>>;
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	name: string,
	exactOrder: boolean,
): Readonly<Record<string, unknown>> {
	const result = record(value, name);
	const keys = Reflect.ownKeys(result);
	if (exactOrder) {
		if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index])) {
			throw new TypeError(`${name} is not in canonical field order.`);
		}
	} else {
		for (const key of keys) {
			if (typeof key !== 'string' || !fields.includes(key)) throw new TypeError(`${name} has an unsupported field.`);
		}
		for (const field of fields) {
			if (field !== 'audioFileName' && !Object.hasOwn(result, field)) {
				throw new TypeError(`${name}.${field} is required.`);
			}
		}
	}
	for (const key of keys) {
		if (typeof key !== 'string') throw new TypeError(`${name} has a non-string field.`);
		const descriptor = Object.getOwnPropertyDescriptor(result, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
	}
	return result;
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
		throw new RangeError(`${name} must be a bounded ordinary array.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== value.length + 1 || keys.at(-1) !== 'length') {
		throw new TypeError(`${name} must be a canonical dense array.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		if (keys[index] !== String(index)) throw new TypeError(`${name} must be a canonical dense array.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain own data entries.`);
		}
		result.push(descriptor.value);
	}
	return result;
}

function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function optionalData(value: object, key: string, fallback: unknown, name: string): unknown {
	return Object.hasOwn(value, key) ? data(value, key, name) : fallback;
}

function deepFreeze<Value>(value: Value): Value {
	if (!value || typeof value !== 'object') return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}
