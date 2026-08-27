/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reviewed CPU ONNX adapters for PANNs Cnn10 and Beat This v1.1.0. */

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import {
	ASSISTANCE_BEAT_THIS_FRAMES_PER_SECOND,
	createAssistanceBeatThisGridV1,
} from '../src/common/editor/assistance/beat-this-postprocess-v1.ts';
import {
	ASSISTANCE_BEAT_THIS_FFT_SIZE,
	ASSISTANCE_BEAT_THIS_HOP_SAMPLES,
	ASSISTANCE_BEAT_THIS_MEL_BINS,
	createAssistanceBeatThisLogMelRangeV1,
	type AssistanceBeatThisLogMelV1,
	type AssistanceBeatThisPcmSourceV1,
} from '../src/common/editor/assistance/beat-this-log-mel-v1.ts';
import {
	ASSISTANCE_PANNS_CNN10_AUDIOSET_CLASS_COUNT,
	ASSISTANCE_PANNS_CNN10_MAXIMUM_WINDOWS,
	createAssistancePannsCnn10ScoreProjectorV1,
	type AssistancePannsCnn10ClassBindingV1,
} from '../src/common/editor/assistance/panns-cnn10-postprocess-v1.ts';
import {
	reviewAssistanceAudioTagsV1,
	type AssistanceAudioTagWindowV1,
} from '../src/common/editor/assistance/m7-semantic-results.ts';
import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
	AssistanceOnnxTensorV1,
} from './assistance-onnx-runtime-worker.ts';
import type {
	AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';
import {
	openAssistanceFloat32MonoWaveFileV1,
	type AssistanceFloat32MonoWaveFileV1,
} from './assistance-float32-mono-wave-file-reader.ts';

type RuntimeLoader = (entrypoint: string) => PromiseLike<AssistanceOnnxRuntimeModuleV1>;
type WaveFileOpener = (
	path: string,
	expectedSampleRate: number,
	expectedByteLength: number,
) => Promise<AssistanceFloat32MonoWaveFileV1>;
type BeatLogMelRange = (
	source: AssistanceBeatThisPcmSourceV1,
	frameStart: number,
	frameCount: number,
	signal?: AbortSignal,
) => Promise<AssistanceBeatThisLogMelV1>;

export interface AssistanceOnnxAudioRuntimeWorkerDependenciesV1 {
	readonly openWaveFile?: WaveFileOpener;
	readonly createBeatLogMelRange?: BeatLogMelRange;
}

const AUDIO_INPUT_MEDIA_TYPE = 'audio/wav';
const AUDIO_TAG_RESULT_MEDIA_TYPE = 'application/vnd.soundscaper.audio-tags+json';
const BEAT_RESULT_MEDIA_TYPE = 'application/vnd.soundscaper.beat-grid+json';
const PANNS_INPUT_NAMES = Object.freeze(['waveform']);
const PANNS_OUTPUT_NAMES = Object.freeze(['clipwise_probabilities', 'embedding']);
const BEAT_INPUT_NAMES = Object.freeze(['log_mel_spectrogram']);
const BEAT_OUTPUT_NAMES = Object.freeze(['beat_logits', 'downbeat_logits']);
const PANNS_SAMPLE_RATE = 32_000;
const PANNS_WINDOW_SAMPLES = 32_000;
const BEAT_SAMPLE_RATE = 22_050;
const BEAT_CHUNK_FRAMES = 1_500;
const BEAT_BORDER_FRAMES = 6;
const BEAT_CHUNK_STEP = BEAT_CHUNK_FRAMES - 2 * BEAT_BORDER_FRAMES;
const BEAT_MODEL_IDS = new Set(['beat-this-small0', 'beat-this-final0']);

/**
 * Exact zero-based rows from the pinned AudioSet map at revision
 * d2f4b8c18eab44737fcc0de1248ae21eb43f6aa4:
 * https://github.com/qiuqiangkong/audioset_tagging_cnn/blob/d2f4b8c18eab44737fcc0de1248ae21eb43f6aa4/metadata/class_labels_indices.csv
 */
const PANNS_CLASS_BINDINGS = Object.freeze([
	Object.freeze({ index: 16, label: 'Laughter', signal: 'laughter' }),
	Object.freeze({ index: 18, label: 'Giggle', signal: 'laughter' }),
	Object.freeze({ index: 19, label: 'Snicker', signal: 'laughter' }),
	Object.freeze({ index: 63, label: 'Clapping', signal: 'applause' }),
	Object.freeze({ index: 66, label: 'Cheering', signal: 'cheering' }),
	Object.freeze({ index: 67, label: 'Applause', signal: 'applause' }),
] as const satisfies readonly AssistancePannsCnn10ClassBindingV1[]);

export function createAssistanceOnnxAudioRuntimeWorkerAdapterV1(
	loadRuntime: RuntimeLoader,
	dependencies: AssistanceOnnxAudioRuntimeWorkerDependenciesV1 = {},
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) => Promise<unknown> {
	if (typeof loadRuntime !== 'function') {
		throw new TypeError('The ONNX audio runtime loader is invalid.');
	}
	if (!dependencies || typeof dependencies !== 'object'
		|| dependencies.openWaveFile !== undefined && typeof dependencies.openWaveFile !== 'function'
		|| dependencies.createBeatLogMelRange !== undefined
			&& typeof dependencies.createBeatLogMelRange !== 'function') {
		throw new TypeError('The ONNX audio worker dependencies are invalid.');
	}
	const openWaveFile = dependencies.openWaveFile ?? openAssistanceFloat32MonoWaveFileV1;
	const createBeatLogMelRange = dependencies.createBeatLogMelRange
		?? createAssistanceBeatThisLogMelRangeV1;
	return async (context) => {
		if (context.grant.task === 'audio-tagging') {
			return executePanns(context, loadRuntime, openWaveFile);
		}
		if (context.grant.task === 'beat-tracking') {
			return executeBeatThis(context, loadRuntime, openWaveFile, createBeatLogMelRange);
		}
		throw new TypeError('The ONNX audio adapter received a foreign task.');
	};
}

async function executePanns(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: RuntimeLoader,
	openWaveFile: WaveFileOpener,
): Promise<unknown> {
	assertRuntimeJob(context, 'audio-tagging');
	assertSettings(context, 'audio-tagging', 'audio-tags');
	const { grant } = context;
	if (grant.inputs.length !== 1 || grant.inputs[0]!.role !== 'audio'
		|| grant.inputs[0]!.mediaType !== AUDIO_INPUT_MEDIA_TYPE
		|| grant.models.length !== 1 || grant.models[0]!.modelId !== 'panns-cnn10'
		|| grant.models[0]!.artifactRole !== 'panns-cnn10'
		|| grant.outputs.length !== 1 || grant.outputs[0]!.role !== 'audio-tags'
		|| grant.outputs[0]!.mediaType !== AUDIO_TAG_RESULT_MEDIA_TYPE) {
		throw new TypeError('PANNs Cnn10 requires one exact audio, model, and audio-tags grant.');
	}
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const wave = await openWaveFile(
		grant.inputs[0]!.path, PANNS_SAMPLE_RATE, grant.inputs[0]!.byteLength,
	);
	try {
		const windowCount = Math.ceil(wave.sampleCount / PANNS_WINDOW_SAMPLES);
		if (windowCount < 1 || windowCount > ASSISTANCE_PANNS_CNN10_MAXIMUM_WINDOWS) {
			throw new RangeError('PANNs Cnn10 audio exceeds the one-second window capacity.');
		}
		context.signal?.throwIfAborted();
		const runtime = runtimeValue(await loadRuntime(context.job.descriptor.entrypoint));
		const session = await createCpuSession(runtime, grant.models[0]!.path);
		try {
			assertExactNames(session.inputNames, PANNS_INPUT_NAMES, 'PANNs Cnn10 input');
			assertExactNames(session.outputNames, PANNS_OUTPUT_NAMES, 'PANNs Cnn10 output');
			const projector = createAssistancePannsCnn10ScoreProjectorV1(
				'probabilities', PANNS_CLASS_BINDINGS,
			);
			const windows: AssistanceAudioTagWindowV1[] = [];
			for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
				context.signal?.throwIfAborted();
				const startSample = windowIndex * PANNS_WINDOW_SAMPLES;
				const retainedSamples = Math.min(PANNS_WINDOW_SAMPLES, wave.sampleCount - startSample);
				const ranged = await wave.readSamples(startSample, retainedSamples, context.signal);
				const input = retainedSamples === PANNS_WINDOW_SAMPLES
					? ranged : zeroPad(ranged, PANNS_WINDOW_SAMPLES);
				const output = exactOutputs(await session.run({
					waveform: new runtime.Tensor('float32', input, [1, PANNS_WINDOW_SAMPLES]),
				}), PANNS_OUTPUT_NAMES, 'PANNs Cnn10');
				const probabilities = floatTensor(output.clipwise_probabilities,
					[1, ASSISTANCE_PANNS_CNN10_AUDIOSET_CLASS_COUNT],
					'PANNs Cnn10 probabilities', true);
				floatTensor(output.embedding, [1, 512], 'PANNs Cnn10 embedding', false);
				windows.push(projector.project(startSample, probabilities.data));
				context.signal?.throwIfAborted();
				context.onProgress((windowIndex + 1) / (windowCount + 1));
			}
			const result = reviewAssistanceAudioTagsV1({
				schemaVersion: 1, sampleRate: PANNS_SAMPLE_RATE,
				windowSamples: PANNS_WINDOW_SAMPLES, windows,
			});
			return await publishJson(context, result);
		} finally {
			await session.release?.();
		}
	} finally {
		await wave.close();
	}
}

async function executeBeatThis(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: RuntimeLoader,
	openWaveFile: WaveFileOpener,
	createBeatLogMelRange: BeatLogMelRange,
): Promise<unknown> {
	assertRuntimeJob(context, 'beat-tracking');
	assertSettings(context, 'beat-tracking', 'beat-grid');
	const { grant } = context;
	const model = grant.models[0];
	if (grant.inputs.length !== 1 || grant.inputs[0]!.role !== 'audio'
		|| grant.inputs[0]!.mediaType !== AUDIO_INPUT_MEDIA_TYPE
		|| grant.models.length !== 1 || model === undefined || !BEAT_MODEL_IDS.has(model.modelId)
		|| model.version !== '1.1.0' || model.artifactRole !== model.modelId
		|| grant.outputs.length !== 1 || grant.outputs[0]!.role !== 'beat-grid'
		|| grant.outputs[0]!.mediaType !== BEAT_RESULT_MEDIA_TYPE) {
		throw new TypeError('Beat This requires one exact v1.1.0 checkpoint, audio, and beat-grid grant.');
	}
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const wave = await openWaveFile(
		grant.inputs[0]!.path, BEAT_SAMPLE_RATE, grant.inputs[0]!.byteLength,
	);
	try {
		if (wave.sampleCount <= ASSISTANCE_BEAT_THIS_FFT_SIZE / 2) {
			throw new RangeError('Beat This PCM cannot satisfy exact reflect-padded geometry.');
		}
		const frameCount = Math.floor(wave.sampleCount / ASSISTANCE_BEAT_THIS_HOP_SAMPLES) + 1;
		const starts = beatChunkStarts(frameCount);
		context.signal?.throwIfAborted();
		const runtime = runtimeValue(await loadRuntime(context.job.descriptor.entrypoint));
		const session = await createCpuSession(runtime, model.path);
		try {
			assertExactNames(session.inputNames, BEAT_INPUT_NAMES, 'Beat This input');
			assertExactNames(session.outputNames, BEAT_OUTPUT_NAMES, 'Beat This output');
			const beatLogits = new Float32Array(frameCount);
			const downbeatLogits = new Float32Array(frameCount);
			const assigned = new Uint8Array(frameCount);
			for (let chunkIndex = 0; chunkIndex < starts.length; chunkIndex += 1) {
				context.signal?.throwIfAborted();
				const chunk = await beatChunk(wave, frameCount, starts[chunkIndex]!,
					createBeatLogMelRange, context.signal);
				const output = exactOutputs(await session.run({
					log_mel_spectrogram: new runtime.Tensor('float32', chunk.values,
						[1, chunk.frameCount, ASSISTANCE_BEAT_THIS_MEL_BINS]),
				}), BEAT_OUTPUT_NAMES, 'Beat This');
				const beats = floatTensor(output.beat_logits, [1, chunk.frameCount],
					'Beat This beat logits', false).data;
				const downbeats = floatTensor(output.downbeat_logits, [1, chunk.frameCount],
					'Beat This downbeat logits', false).data;
				stitchBeatChunk(starts[chunkIndex]!, beats, downbeats,
					beatLogits, downbeatLogits, assigned);
				context.signal?.throwIfAborted();
				context.onProgress((chunkIndex + 1) / (starts.length + 1));
			}
			if (assigned.some((value) => value !== 1)) {
				throw new Error('Beat This chunks did not retain one exact authority for every frame.');
			}
			const result = createAssistanceBeatThisGridV1({
				schemaVersion: 1, sampleRate: BEAT_SAMPLE_RATE,
				framesPerSecond: ASSISTANCE_BEAT_THIS_FRAMES_PER_SECOND,
				beatLogits, downbeatLogits,
			});
			return await publishJson(context, result);
		} finally {
			await session.release?.();
		}
	} finally {
		await wave.close();
	}
}

function assertRuntimeJob(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	task: 'audio-tagging' | 'beat-tracking',
): void {
	if (context.grant.familyId !== 'onnxruntime-node' || context.grant.task !== task
		|| context.job.descriptor.familyId !== 'onnxruntime-node'
		|| context.job.descriptor.runtimeVersion !== '1.29.0'
		|| context.job.descriptor.executionProvider !== 'cpu') {
		throw new TypeError(`The ${task} adapter received a foreign authenticated CPU job.`);
	}
}

function assertSettings(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	operation: 'audio-tagging' | 'beat-tracking',
	outputRole: 'audio-tags' | 'beat-grid',
): void {
	const settings = context.settings;
	if (settings.schemaVersion !== 1 || settings.operation !== operation
		|| JSON.stringify(settings.inputRoles) !== '["audio"]'
		|| JSON.stringify(settings.outputRoles) !== JSON.stringify([outputRole])) {
		throw new TypeError(`The ${operation} settings do not bind one exact audio workflow.`);
	}
}

async function createCpuSession(
	runtime: AssistanceOnnxRuntimeModuleV1,
	modelPath: string,
): Promise<AssistanceOnnxInferenceSessionV1> {
	const value = await runtime.InferenceSession.create(modelPath, {
		executionProviders: ['cpu'], graphOptimizationLevel: 'all',
		interOpNumThreads: 1, intraOpNumThreads: 4,
	});
	if (!value || typeof value !== 'object' || !Array.isArray(value.inputNames)
		|| !Array.isArray(value.outputNames) || typeof value.run !== 'function'
		|| value.release !== undefined && typeof value.release !== 'function') {
		throw new TypeError('The ONNX audio inference session surface is invalid.');
	}
	return value;
}

function runtimeValue(value: unknown): AssistanceOnnxRuntimeModuleV1 {
	if (!value || typeof value !== 'object') throw new TypeError('The ONNX audio runtime is invalid.');
	const candidate = value as Partial<AssistanceOnnxRuntimeModuleV1>;
	if (typeof candidate.Tensor !== 'function' || !candidate.InferenceSession
		|| typeof candidate.InferenceSession.create !== 'function') {
		throw new TypeError('The ONNX audio runtime surface is invalid.');
	}
	return candidate as AssistanceOnnxRuntimeModuleV1;
}

function assertExactNames(actual: readonly string[], expected: readonly string[], label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new TypeError(`The ${label} graph signature is invalid.`);
	}
}

function exactOutputs(
	value: Readonly<Record<string, AssistanceOnnxTensorV1>>,
	expected: readonly string[],
	label: string,
): Readonly<Record<string, AssistanceOnnxTensorV1>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
		throw new TypeError(`The ${label} result tensor inventory is invalid.`);
	}
	return value;
}

function floatTensor(
	value: AssistanceOnnxTensorV1 | undefined,
	dims: readonly number[],
	label: string,
	probabilities: boolean,
): Readonly<{ data: Float32Array }> {
	if (!value || value.type !== 'float32' || !(value.data instanceof Float32Array)
		|| JSON.stringify(value.dims) !== JSON.stringify(dims)
		|| value.data.length !== dims.reduce((total, dimension) => total * dimension, 1)) {
		throw new RangeError(`The ${label} tensor geometry or element type is invalid.`);
	}
	for (const candidate of value.data) {
		if (!Number.isFinite(candidate) || probabilities && (candidate < 0 || candidate > 1)) {
			throw new RangeError(`Every ${label} value must be a finite${probabilities ? ' probability' : ''}.`);
		}
	}
	return Object.freeze({ data: value.data });
}

function beatChunkStarts(frameCount: number): readonly number[] {
	const starts: number[] = [];
	for (let start = -BEAT_BORDER_FRAMES; start < frameCount - BEAT_BORDER_FRAMES;
		start += BEAT_CHUNK_STEP) starts.push(start);
	if (frameCount > BEAT_CHUNK_STEP) {
		starts[starts.length - 1] = frameCount - (BEAT_CHUNK_FRAMES - BEAT_BORDER_FRAMES);
	}
	if (starts.length < 1 || new Set(starts).size !== starts.length) {
		throw new RangeError('Beat This preprocessing produced an invalid chunk authority.');
	}
	return Object.freeze(starts);
}

async function beatChunk(
	source: AssistanceBeatThisPcmSourceV1,
	frameCount: number,
	start: number,
	createBeatLogMelRange: BeatLogMelRange,
	signal?: AbortSignal,
): Promise<Readonly<{ frameCount: number; values: Float32Array }>> {
	const sourceStart = Math.max(start, 0);
	const sourceEnd = Math.min(start + BEAT_CHUNK_FRAMES, frameCount);
	const left = Math.max(0, -start);
	const right = Math.max(0, Math.min(BEAT_BORDER_FRAMES,
		start + BEAT_CHUNK_FRAMES - frameCount));
	const chunkFrames = left + sourceEnd - sourceStart + right;
	if (chunkFrames <= 2 * BEAT_BORDER_FRAMES || chunkFrames > BEAT_CHUNK_FRAMES) {
		throw new RangeError('Beat This produced invalid padded chunk geometry.');
	}
	const chunk = new Float32Array(chunkFrames * ASSISTANCE_BEAT_THIS_MEL_BINS);
	const spectrogram = await createBeatLogMelRange(
		source, sourceStart, sourceEnd - sourceStart, signal,
	);
	if (spectrogram.frameCount !== sourceEnd - sourceStart
		|| spectrogram.melBins !== ASSISTANCE_BEAT_THIS_MEL_BINS
		|| spectrogram.values.length !== (sourceEnd - sourceStart) * ASSISTANCE_BEAT_THIS_MEL_BINS) {
		throw new RangeError('Beat This ranged preprocessing returned invalid chunk geometry.');
	}
	chunk.set(spectrogram.values, left * ASSISTANCE_BEAT_THIS_MEL_BINS);
	return Object.freeze({ frameCount: chunkFrames, values: chunk });
}

function zeroPad(samples: Float32Array, sampleCount: number): Float32Array {
	if (samples.length >= sampleCount) return samples;
	const result = new Float32Array(sampleCount);
	result.set(samples);
	return result;
}

function stitchBeatChunk(
	start: number,
	beats: Float32Array,
	downbeats: Float32Array,
	beatTarget: Float32Array,
	downbeatTarget: Float32Array,
	assigned: Uint8Array,
): void {
	for (let local = BEAT_BORDER_FRAMES; local < beats.length - BEAT_BORDER_FRAMES; local += 1) {
		const global = start + local;
		if (global < 0 || global >= assigned.length || assigned[global] === 1) continue;
		beatTarget[global] = beats[local]!;
		downbeatTarget[global] = downbeats[local]!;
		assigned[global] = 1;
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
		throw new RangeError('The ONNX audio result exceeds its authenticated output reservation.');
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
