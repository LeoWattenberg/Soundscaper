/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated CPU ONNX execution for English wav2vec2 CTC word alignment. */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import {
	alignAssistanceCtcWordsV1,
	type AssistanceCtcWordV1,
} from '../src/common/editor/assistance/ctc-forced-alignment-v1.ts';
import { reviewAssistanceFloat32MonoWaveV1 } from
	'../src/common/editor/assistance/float32-mono-wave-v1.ts';
import {
	ASSISTANCE_ALIGNMENT_SAMPLE_RATE,
	reviewAssistanceWordAlignmentV1,
	type AssistanceAlignedWordV1,
} from '../src/common/editor/assistance/m7-semantic-results.ts';
import {
	ASSISTANCE_WAV2VEC2_BASE_960H_BLANK_TOKEN_ID,
	ASSISTANCE_WAV2VEC2_BASE_960H_FRAME_STRIDE_SAMPLES,
	ASSISTANCE_WAV2VEC2_BASE_960H_VOCABULARY_V1,
	splitAssistanceWav2Vec2EnglishSegmentWordsV1,
	tokenizeAssistanceWav2Vec2EnglishWordV1,
} from '../src/common/editor/assistance/wav2vec2-english-tokenizer-v1.ts';
import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
	AssistanceOnnxTensorV1,
} from './assistance-onnx-runtime-worker.ts';
import type { AssistanceRuntimeFamilyWorkerExecutionContext } from
	'./assistance-runtime-family-worker-entry.ts';

type RuntimeLoader = (entrypoint: string) => PromiseLike<AssistanceOnnxRuntimeModuleV1>;

const MODEL_ID = 'wav2vec2-base-960h';
const INPUT_NAMES = Object.freeze(['input_values']);
const OUTPUT_NAMES = Object.freeze(['logits']);
const AUDIO_MEDIA_TYPE = 'audio/wav';
const TRANSCRIPT_MEDIA_TYPES = new Set([
	'application/json', 'application/vnd.soundscaper.transcript+json',
]);
const OUTPUT_MEDIA_TYPE = 'application/vnd.soundscaper.word-alignment+json';
const MAXIMUM_AUDIO_BYTES = 512 * 1024 ** 2;
const MAXIMUM_TRANSCRIPT_BYTES = 16 * 1024 ** 2;
const MAXIMUM_SEGMENTS = 10_000;
const MAXIMUM_WORDS = 100_000;
const MINIMUM_SEGMENT_SAMPLES = 400;
const MAXIMUM_SEGMENT_SAMPLES = 60 * ASSISTANCE_ALIGNMENT_SAMPLE_RATE;
const NORMALIZATION_EPSILON = 1e-7;

interface AlignmentSegment {
	readonly startSample: number;
	readonly endSample: number;
	readonly words: readonly AssistanceCtcWordV1[];
}

export function createAssistanceOnnxWordAlignmentWorkerAdapterV1(
	loadRuntime: RuntimeLoader,
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) => Promise<unknown> {
	if (typeof loadRuntime !== 'function') {
		throw new TypeError('The wav2vec2 ONNX runtime loader is invalid.');
	}
	return async (context) => executeWav2Vec2Alignment(context, loadRuntime);
}

async function executeWav2Vec2Alignment(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: RuntimeLoader,
): Promise<unknown> {
	assertRuntimeJob(context);
	assertSettings(context);
	const { grant } = context;
	const [audio, transcript] = grant.inputs;
	const model = grant.models[0];
	const output = grant.outputs[0];
	if (grant.inputs.length !== 2 || audio?.role !== 'audio'
		|| audio.mediaType !== AUDIO_MEDIA_TYPE || audio.byteLength > MAXIMUM_AUDIO_BYTES
		|| transcript?.role !== 'transcript' || !TRANSCRIPT_MEDIA_TYPES.has(transcript.mediaType)
		|| transcript.byteLength < 2 || transcript.byteLength > MAXIMUM_TRANSCRIPT_BYTES
		|| grant.models.length !== 1 || model?.modelId !== MODEL_ID
		|| model.artifactRole !== 'model' || grant.outputs.length !== 1
		|| output?.role !== 'word-alignment' || output.mediaType !== OUTPUT_MEDIA_TYPE) {
		throw new TypeError('wav2vec2 alignment requires exact audio, English transcript, model, and output grants.');
	}
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const [audioBytes, transcriptBytes] = await Promise.all([
		readFile(audio.path), readFile(transcript.path),
	]);
	context.signal?.throwIfAborted();
	const wave = reviewAssistanceFloat32MonoWaveV1(audioBytes, ASSISTANCE_ALIGNMENT_SAMPLE_RATE);
	const segments = parseWhisperEnglishTranscript(transcriptBytes, wave.samples.length);
	if (segments.length === 0) {
		return publishJson(context, reviewAssistanceWordAlignmentV1({
			schemaVersion: 1, sampleRate: ASSISTANCE_ALIGNMENT_SAMPLE_RATE, words: [],
		}));
	}
	const runtime = runtimeValue(await loadRuntime(context.job.descriptor.entrypoint));
	context.signal?.throwIfAborted();
	const session = await createCpuSession(runtime, model.path);
	try {
		assertExactNames(session.inputNames, INPUT_NAMES, 'input');
		assertExactNames(session.outputNames, OUTPUT_NAMES, 'output');
		const words: AssistanceAlignedWordV1[] = [];
		for (const [segmentOffset, segment] of segments.entries()) {
			context.signal?.throwIfAborted();
			const input = normalizeInputValues(
				wave.samples.subarray(segment.startSample, segment.endSample), context.signal,
			);
			const frameCount = featureFrameCount(input.length);
			const outputs = exactOutputs(await session.run({
				input_values: new runtime.Tensor('float32', input, [1, input.length]),
			}));
			context.signal?.throwIfAborted();
			const emissions = logitsToLogProbabilities(outputs.logits, frameCount, context.signal);
			const aligned = alignAssistanceCtcWordsV1({
				schemaVersion: 1, sampleRate: ASSISTANCE_ALIGNMENT_SAMPLE_RATE,
				frameStrideSamples: ASSISTANCE_WAV2VEC2_BASE_960H_FRAME_STRIDE_SAMPLES,
				blankTokenId: ASSISTANCE_WAV2VEC2_BASE_960H_BLANK_TOKEN_ID,
				vocabularySize: ASSISTANCE_WAV2VEC2_BASE_960H_VOCABULARY_V1.length,
				frameCount, emissionLogProbabilities: emissions, words: segment.words,
			});
			for (const word of aligned.words) words.push(Object.freeze({
				...word,
				startSample: safeAdd(segment.startSample, word.startSample, 'aligned word start'),
				endSample: safeAdd(segment.startSample, word.endSample, 'aligned word end'),
			}));
			context.signal?.throwIfAborted();
			context.onProgress((segmentOffset + 1) / (segments.length + 1));
		}
		return publishJson(context, reviewAssistanceWordAlignmentV1({
			schemaVersion: 1, sampleRate: ASSISTANCE_ALIGNMENT_SAMPLE_RATE, words,
		}));
	} finally {
		await session.release?.();
	}
}

function parseWhisperEnglishTranscript(
	bytes: Uint8Array,
	sampleCount: number,
): readonly AlignmentSegment[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
	} catch (error) {
		throw new TypeError('The English Whisper transcript is malformed UTF-8 JSON.', { cause: error });
	}
	const root = exactRecord(parsed, ['language', 'segments'], 'English Whisper transcript');
	if (!Array.isArray(root.segments) || root.segments.length > MAXIMUM_SEGMENTS) {
		throw new RangeError('The English Whisper transcript segment inventory exceeds its bound.');
	}
	if (root.language !== 'en') {
		if (root.language !== null && (typeof root.language !== 'string'
			|| !/^[A-Za-z][A-Za-z-]{1,31}$/u.test(root.language))) {
			throw new TypeError('The detected Whisper transcript language is invalid.');
		}
		return Object.freeze([]);
	}
	let previousEnd = 0;
	let totalWords = 0;
	return Object.freeze(root.segments.map((candidate, segmentIndex): AlignmentSegment => {
		const row = exactRecord(candidate, ['startSeconds', 'endSeconds', 'text'],
			`English Whisper segment ${String(segmentIndex)}`);
		const startSample = secondsToSample(row.startSeconds, 'segment start');
		const endSample = secondsToSample(row.endSeconds, 'segment end');
		const length = endSample - startSample;
		if (startSample < previousEnd || endSample > sampleCount
			|| length < MINIMUM_SEGMENT_SAMPLES || length > MAXIMUM_SEGMENT_SAMPLES) {
			throw new RangeError('English Whisper segments must be ordered, in range, and at most 60 seconds.');
		}
		const texts = splitAssistanceWav2Vec2EnglishSegmentWordsV1(row.text);
		totalWords += texts.length;
		if (totalWords > MAXIMUM_WORDS) {
			throw new RangeError('The English Whisper transcript word inventory exceeds its bound.');
		}
		previousEnd = endSample;
		return Object.freeze({ startSample, endSample,
			words: Object.freeze(texts.map((text, wordIndex) => Object.freeze({
				segmentIndex, wordIndex, text,
				tokenIds: tokenizeAssistanceWav2Vec2EnglishWordV1(text),
			}))),
		});
	}));
}

function normalizeInputValues(value: Float32Array, signal?: AbortSignal): Float32Array {
	let mean = 0;
	for (let index = 0; index < value.length; index += 1) {
		if ((index & 16_383) === 0) signal?.throwIfAborted();
		mean += value[index]! / value.length;
	}
	let variance = 0;
	for (let index = 0; index < value.length; index += 1) {
		if ((index & 16_383) === 0) signal?.throwIfAborted();
		variance += (value[index]! - mean) ** 2 / value.length;
	}
	if (!Number.isFinite(mean) || !Number.isFinite(variance)) {
		throw new RangeError('wav2vec2 input normalization became non-finite.');
	}
	const scale = 1 / Math.sqrt(variance + NORMALIZATION_EPSILON);
	const result = new Float32Array(value.length);
	for (let index = 0; index < value.length; index += 1) {
		if ((index & 16_383) === 0) signal?.throwIfAborted();
		result[index] = Math.fround((value[index]! - mean) * scale);
	}
	return result;
}

function featureFrameCount(sampleCount: number): number {
	let result = sampleCount;
	for (const [kernel, stride] of [[10, 5], [3, 2], [3, 2], [3, 2], [3, 2], [2, 2], [2, 2]]) {
		result = Math.floor((result - kernel!) / stride!) + 1;
	}
	if (!Number.isSafeInteger(result) || result < 1 || result > 100_000) {
		throw new RangeError('The wav2vec2 feature frame count is outside its exact bound.');
	}
	return result;
}

function logitsToLogProbabilities(
	value: AssistanceOnnxTensorV1 | undefined,
	frameCount: number,
	signal?: AbortSignal,
): Float32Array {
	const vocabularySize = ASSISTANCE_WAV2VEC2_BASE_960H_VOCABULARY_V1.length;
	if (!value || value.type !== 'float32' || !(value.data instanceof Float32Array)
		|| JSON.stringify(value.dims) !== JSON.stringify([1, frameCount, vocabularySize])
		|| value.data.length !== frameCount * vocabularySize) {
		throw new RangeError('The wav2vec2 logits tensor geometry or element type is invalid.');
	}
	const result = new Float32Array(value.data.length);
	for (let frame = 0; frame < frameCount; frame += 1) {
		if ((frame & 1_023) === 0) signal?.throwIfAborted();
		const offset = frame * vocabularySize;
		let maximum = Number.NEGATIVE_INFINITY;
		for (let token = 0; token < vocabularySize; token += 1) {
			const candidate = value.data[offset + token]!;
			if (!Number.isFinite(candidate)) {
				throw new RangeError('Every wav2vec2 logit must be finite.');
			}
			maximum = Math.max(maximum, candidate);
		}
		let exponentialSum = 0;
		for (let token = 0; token < vocabularySize; token += 1) {
			exponentialSum += Math.exp(value.data[offset + token]! - maximum);
		}
		const normalizer = maximum + Math.log(exponentialSum);
		for (let token = 0; token < vocabularySize; token += 1) {
			result[offset + token] = Math.fround(value.data[offset + token]! - normalizer);
		}
	}
	return result;
}

function assertRuntimeJob(context: AssistanceRuntimeFamilyWorkerExecutionContext): void {
	if (context.grant.familyId !== 'onnxruntime-node' || context.grant.task !== 'word-alignment'
		|| context.job.descriptor.familyId !== 'onnxruntime-node'
		|| context.job.descriptor.runtimeVersion !== '1.29.0'
		|| context.job.descriptor.executionProvider !== 'cpu') {
		throw new TypeError('The wav2vec2 adapter received a foreign authenticated CPU job.');
	}
}

function assertSettings(context: AssistanceRuntimeFamilyWorkerExecutionContext): void {
	const settings = context.settings;
	if (settings.schemaVersion !== 1 || settings.operation !== 'word-alignment'
		|| JSON.stringify(settings.inputRoles) !== '["audio","transcript"]'
		|| JSON.stringify(settings.outputRoles) !== '["word-alignment"]') {
		throw new TypeError('The wav2vec2 settings do not bind one exact word-alignment workflow.');
	}
}

async function createCpuSession(
	runtime: AssistanceOnnxRuntimeModuleV1,
	modelPath: string,
): Promise<AssistanceOnnxInferenceSessionV1> {
	const session = await runtime.InferenceSession.create(modelPath, {
		executionProviders: ['cpu'], graphOptimizationLevel: 'all',
		interOpNumThreads: 1, intraOpNumThreads: 4,
	});
	if (!session || typeof session !== 'object' || !Array.isArray(session.inputNames)
		|| !Array.isArray(session.outputNames) || typeof session.run !== 'function'
		|| session.release !== undefined && typeof session.release !== 'function') {
		throw new TypeError('The wav2vec2 ONNX inference session surface is invalid.');
	}
	return session;
}

function runtimeValue(value: unknown): AssistanceOnnxRuntimeModuleV1 {
	if (!value || typeof value !== 'object') throw new TypeError('The wav2vec2 ONNX runtime is invalid.');
	const candidate = value as Partial<AssistanceOnnxRuntimeModuleV1>;
	if (typeof candidate.Tensor !== 'function' || !candidate.InferenceSession
		|| typeof candidate.InferenceSession.create !== 'function') {
		throw new TypeError('The wav2vec2 ONNX runtime surface is invalid.');
	}
	return candidate as AssistanceOnnxRuntimeModuleV1;
}

function exactOutputs(
	value: Readonly<Record<string, AssistanceOnnxTensorV1>>,
): Readonly<Record<string, AssistanceOnnxTensorV1>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value)) !== JSON.stringify(OUTPUT_NAMES)) {
		throw new TypeError('The wav2vec2 result tensor inventory is invalid.');
	}
	return value;
}

function assertExactNames(actual: readonly string[], expected: readonly string[], kind: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new TypeError(`The wav2vec2 ONNX graph ${kind} signature is invalid.`);
	}
}

async function publishJson(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	result: unknown,
): Promise<unknown> {
	context.signal?.throwIfAborted();
	const body = Buffer.from(JSON.stringify(result), 'utf8');
	const reservation = context.grant.outputs[0]!;
	if (body.byteLength < 1 || body.byteLength > reservation.maximumByteLength) {
		throw new RangeError('The wav2vec2 result exceeds its authenticated output reservation.');
	}
	await writeFile(reservation.path, body);
	context.signal?.throwIfAborted();
	context.onProgress(1);
	return Object.freeze({
		resultVersion: 1, jobId: context.grant.jobId,
		familyId: context.grant.familyId, task: context.grant.task,
		outputs: Object.freeze([Object.freeze({
			claimId: reservation.claimId, role: reservation.role,
			mediaType: reservation.mediaType, byteLength: body.byteLength,
			sha256: createHash('sha256').update(body).digest('hex'),
		})]),
	});
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
	if (Object.keys(row).length !== fields.length
		|| Object.keys(row).some((key) => !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return row as Record<Field, unknown>;
}

function secondsToSample(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new RangeError(`The English Whisper ${label} is invalid.`);
	}
	const sample = Math.round(value * ASSISTANCE_ALIGNMENT_SAMPLE_RATE);
	if (!Number.isSafeInteger(sample)) {
		throw new RangeError(`The English Whisper ${label} exceeds exact sample timing.`);
	}
	return sample;
}

function safeAdd(left: number, right: number, label: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`The ${label} overflowed.`);
	return result;
}
