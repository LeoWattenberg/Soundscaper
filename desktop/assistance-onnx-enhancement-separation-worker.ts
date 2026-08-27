/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated CPU ONNX custody for DeepFilterNet3 and TIGER-DnR. */

import { readFile } from 'node:fs/promises';

import {
	analyzeAssistanceDeepFilterChannelV1,
	ASSISTANCE_DEEPFILTER_BINS,
	ASSISTANCE_DEEPFILTER_ERB_BANDS,
	ASSISTANCE_DEEPFILTER_FREQUENCY_BINS,
	ASSISTANCE_DEEPFILTER_FFT_SIZE,
	ASSISTANCE_DEEPFILTER_HOP_FRAMES,
	ASSISTANCE_DEEPFILTER_ORDER,
	ASSISTANCE_DEEPFILTER_SAMPLE_RATE,
	reviewAssistanceDeepFilterAuxiliaryV1,
	synthesizeAssistanceDeepFilterChannelV1,
} from '../src/common/editor/assistance/deepfilternet3-signal-v1.ts';
import {
	ASSISTANCE_TIGER_DNR_CHUNK_FRAMES,
	ASSISTANCE_TIGER_DNR_SAMPLE_RATE,
	createTigerDnrChunkPlanV1,
	tigerDnrIstftV1,
	tigerDnrStftV1,
	type TigerDnrChunkPlanV1,
} from '../src/common/editor/assistance/tiger-dnr-signal-v1.ts';
import {
	createTigerDnrStreamingOverlapV1,
	type TigerDnrStreamingOverlapV1,
} from '../src/common/editor/assistance/tiger-dnr-streaming-overlap-v1.ts';
import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
	AssistanceOnnxTensorV1,
} from './assistance-onnx-runtime-worker.ts';
import type {
	AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';
import type {
	AssistanceRuntimeFamilyJobResultV1,
} from './assistance-runtime-family-job-contract.ts';
import {
	applyTigerDnrMaskV1,
	packTigerDnrSpectrumV1,
} from './assistance-tiger-dnr-onnx-tensors.ts';
import {
	createNodeAssistanceFloat32WaveStorageV1,
	type AssistanceFloat32WaveSealedOutputV1,
	type AssistanceFloat32WaveSinkV1,
	type AssistanceFloat32WaveSourceV1,
	type AssistanceFloat32WaveStorageV1,
} from './assistance-streaming-float32-wave.ts';

type RuntimeLoader = (entrypoint: string) => PromiseLike<AssistanceOnnxRuntimeModuleV1>;
type SupportedTask = 'speech-enhancement' | 'source-separation';

const AUDIO_MEDIA_TYPE = 'audio/wav';
const DEEPFILTER_INPUT_NAMES = Object.freeze(['feat_erb', 'feat_spec']);
const DEEPFILTER_OUTPUT_NAMES = Object.freeze(['erb_mask', 'df_coefs']);
const DEEPFILTER_ARTIFACT_ROLES = Object.freeze([
	'deepfilter', 'deepfilter-auxiliary', 'config',
]);
const TIGER_INPUT_NAMES = Object.freeze(['spectrum_ri']);
const TIGER_OUTPUT_NAMES = Object.freeze(['complex_masks']);
const TIGER_STEM_COUNT = 3;
const CONFIG_FIELDS = Object.freeze([
	'architectures', 'conv_lookahead', 'df_bins', 'df_lookahead', 'df_order',
	'erb_bands', 'fft_bins', 'fft_size', 'hop_size', 'library_name',
	'min_nb_erb_freqs', 'model_type', 'norm_tau', 'normalization_alpha', 'sample_rate',
]);
export const ASSISTANCE_DEEPFILTER_STREAM_CHUNK_FRAMES = 4
	* ASSISTANCE_DEEPFILTER_SAMPLE_RATE;
export const ASSISTANCE_DEEPFILTER_STREAM_CONTEXT_FRAMES = ASSISTANCE_DEEPFILTER_SAMPLE_RATE;
export const ASSISTANCE_TIGER_SESSION_MAXIMUM_CHANNELS = 2;
export const ASSISTANCE_TIGER_OUTPUT_WRITE_FRAMES = 16_384;

export interface AssistanceOnnxEnhancementSeparationWorkerOptionsV1 {
	readonly waveStorage?: AssistanceFloat32WaveStorageV1;
	readonly deepFilterChunkFrames?: number;
	readonly deepFilterContextFrames?: number;
}

export function createAssistanceOnnxEnhancementSeparationWorkerAdapterV1(
	loadRuntime: RuntimeLoader,
	options: AssistanceOnnxEnhancementSeparationWorkerOptionsV1 = {},
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) =>
	Promise<AssistanceRuntimeFamilyJobResultV1> {
	if (typeof loadRuntime !== 'function') {
		throw new TypeError('The ONNX enhancement and separation runtime loader is invalid.');
	}
	const workerOptions = exactWorkerOptions(options);
	return async (context) => {
		if (context.grant.task === 'speech-enhancement') {
			return executeDeepFilterNet3(context, loadRuntime, workerOptions);
		}
		if (context.grant.task === 'source-separation') {
			return executeTigerDnr(context, loadRuntime, workerOptions.waveStorage);
		}
		throw new TypeError('The ONNX enhancement and separation adapter received a foreign task.');
	};
}

function exactWorkerOptions(
	value: AssistanceOnnxEnhancementSeparationWorkerOptionsV1,
): Readonly<{
	readonly waveStorage: AssistanceFloat32WaveStorageV1;
	readonly deepFilterChunkFrames: number;
	readonly deepFilterContextFrames: number;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).some((key) => ![
			'waveStorage', 'deepFilterChunkFrames', 'deepFilterContextFrames',
		].includes(key))) {
		throw new TypeError('The enhancement and separation worker options are invalid.');
	}
	const waveStorage = value.waveStorage ?? createNodeAssistanceFloat32WaveStorageV1();
	if (!waveStorage || typeof waveStorage.openSource !== 'function'
		|| typeof waveStorage.openSink !== 'function') {
		throw new TypeError('The enhancement and separation WAV storage is invalid.');
	}
	const deepFilterChunkFrames = value.deepFilterChunkFrames
		?? ASSISTANCE_DEEPFILTER_STREAM_CHUNK_FRAMES;
	const deepFilterContextFrames = value.deepFilterContextFrames
		?? ASSISTANCE_DEEPFILTER_STREAM_CONTEXT_FRAMES;
	if (!Number.isSafeInteger(deepFilterChunkFrames)
		|| deepFilterChunkFrames < ASSISTANCE_DEEPFILTER_HOP_FRAMES
		|| deepFilterChunkFrames > 10 * ASSISTANCE_DEEPFILTER_SAMPLE_RATE
		|| deepFilterChunkFrames % ASSISTANCE_DEEPFILTER_HOP_FRAMES !== 0
		|| !Number.isSafeInteger(deepFilterContextFrames)
		|| deepFilterContextFrames < ASSISTANCE_DEEPFILTER_HOP_FRAMES
		|| deepFilterContextFrames > 2 * ASSISTANCE_DEEPFILTER_SAMPLE_RATE
		|| deepFilterContextFrames % ASSISTANCE_DEEPFILTER_HOP_FRAMES !== 0) {
		throw new RangeError('The DeepFilterNet3 streaming window geometry is invalid.');
	}
	return Object.freeze({ waveStorage, deepFilterChunkFrames, deepFilterContextFrames });
}

async function executeDeepFilterNet3(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: RuntimeLoader,
	options: Readonly<{
		readonly waveStorage: AssistanceFloat32WaveStorageV1;
		readonly deepFilterChunkFrames: number;
		readonly deepFilterContextFrames: number;
	}>,
): Promise<AssistanceRuntimeFamilyJobResultV1> {
	assertRuntimeJob(context, 'speech-enhancement');
	assertSettings(context, 'speech-enhancement', ['enhanced-audio']);
	const { grant } = context;
	const input = grant.inputs[0];
	const output = grant.outputs[0];
	if (grant.inputs.length !== 1 || input?.role !== 'audio'
		|| input.mediaType !== AUDIO_MEDIA_TYPE
		|| grant.outputs.length !== 1 || output?.role !== 'enhanced-audio'
		|| output.mediaType !== AUDIO_MEDIA_TYPE) {
		throw new TypeError('DeepFilterNet3 requires one exact audio input and enhanced WAV output.');
	}
	const models = exactDeepFilterModels(grant.models);
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const [configurationBytes, auxiliaryBytes] = await Promise.all([
		readFile(models.config.path), readFile(models.auxiliary.path),
	]);
	reviewDeepFilterConfig(configurationBytes);
	reviewAssistanceDeepFilterAuxiliaryV1(auxiliaryBytes);
	const source = await options.waveStorage.openSource(
		input, ASSISTANCE_DEEPFILTER_SAMPLE_RATE, context.signal,
	);
	let sink: AssistanceFloat32WaveSinkV1 | null = null;
	let completed = false;
	try {
		sink = await options.waveStorage.openSink(output, source.geometry, context.signal);
		context.signal?.throwIfAborted();
		const runtime = runtimeValue(await loadRuntime(context.job.descriptor.entrypoint));
		const session = await createCpuSession(runtime, models.network.path, 'DeepFilterNet3');
		try {
			assertExactNames(session.inputNames, DEEPFILTER_INPUT_NAMES, 'input', 'DeepFilterNet3');
			assertExactNames(session.outputNames, DEEPFILTER_OUTPUT_NAMES, 'output', 'DeepFilterNet3');
			const chunkCount = Math.ceil(source.geometry.frameCount / options.deepFilterChunkFrames);
			const workUnits = chunkCount * source.geometry.channelCount;
			let completedUnits = 0;
			for (let coreStart = 0; coreStart < source.geometry.frameCount;
				coreStart += options.deepFilterChunkFrames) {
				context.signal?.throwIfAborted();
				const coreFrames = Math.min(options.deepFilterChunkFrames,
					source.geometry.frameCount - coreStart);
				const readStart = Math.max(0, coreStart - options.deepFilterContextFrames);
				const readEnd = Math.min(source.geometry.frameCount,
					coreStart + coreFrames + options.deepFilterContextFrames);
				const channels = await source.readFrames({ startFrame: readStart,
					frameCount: readEnd - readStart, channelStart: 0,
					channelCount: source.geometry.channelCount }, context.signal);
				const enhanced: Float32Array[] = [];
				for (const channel of channels) {
					context.signal?.throwIfAborted();
					const analysis = analyzeAssistanceDeepFilterChannelV1(channel, context.signal);
					const result = exactOutputs(await session.run({
						feat_erb: new runtime.Tensor('float32', analysis.erbFeatures,
							[1, 1, analysis.frameCount, ASSISTANCE_DEEPFILTER_ERB_BANDS]),
						feat_spec: new runtime.Tensor('float32', analysis.spectrumFeatures,
							[1, 2, analysis.frameCount, ASSISTANCE_DEEPFILTER_BINS]),
					}));
					context.signal?.throwIfAborted();
					const mask = floatTensor(result.erb_mask,
						[1, 1, analysis.frameCount, ASSISTANCE_DEEPFILTER_ERB_BANDS],
						'DeepFilterNet3 ERB mask');
					const coefficients = floatTensor(result.df_coefs,
						[1, ASSISTANCE_DEEPFILTER_ORDER, analysis.frameCount,
							ASSISTANCE_DEEPFILTER_BINS, 2], 'DeepFilterNet3 coefficients');
					const resultChannel = synthesizeAssistanceDeepFilterChannelV1(
						analysis, mask, coefficients, context.signal,
					);
					const cropStart = coreStart - readStart;
					enhanced.push(resultChannel.slice(cropStart, cropStart + coreFrames));
					completedUnits += 1;
					context.onProgress(completedUnits / (workUnits + 1));
				}
				await sink.writeFrames(enhanced, context.signal);
			}
		} finally {
			await session.release?.();
		}
		await source.close();
		const sealed = await publishSinks(context, [sink]);
		completed = true;
		return workerResult(context, sealed);
	} finally {
		await source.close().catch(() => undefined);
		if (!completed && sink) await sink.rollback().catch(() => undefined);
	}
}

async function executeTigerDnr(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: RuntimeLoader,
	waveStorage: AssistanceFloat32WaveStorageV1,
): Promise<AssistanceRuntimeFamilyJobResultV1> {
	assertRuntimeJob(context, 'source-separation');
	assertSettings(context, 'source-separation', [
		'separated-audio', 'separated-audio', 'separated-audio',
	]);
	const { grant } = context;
	const input = grant.inputs[0];
	if (grant.inputs.length !== 1 || input?.role !== 'audio'
		|| input.mediaType !== AUDIO_MEDIA_TYPE
		|| grant.models.length !== 1 || grant.models[0]?.modelId !== 'tiger-dnr'
		|| grant.models[0].version !== '1.0.0' || grant.models[0].artifactRole !== 'network'
		|| grant.outputs.length !== 3 || grant.outputs.some((output) =>
			output.role !== 'separated-audio' || output.mediaType !== AUDIO_MEDIA_TYPE)) {
		throw new TypeError('TIGER-DnR requires one exact network, audio input, and ordered D/M/E WAV grants.');
	}
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const source = await waveStorage.openSource(input,
		ASSISTANCE_TIGER_DNR_SAMPLE_RATE, context.signal);
	const plan = createTigerDnrChunkPlanV1({ schemaVersion: 1,
		sourceFrameCount: source.geometry.frameCount });
	const sinks: AssistanceFloat32WaveSinkV1[] = [];
	let completed = false;
	try {
		for (const output of grant.outputs) {
			sinks.push(await waveStorage.openSink(output, source.geometry, context.signal));
		}
		context.signal?.throwIfAborted();
		const runtime = runtimeValue(await loadRuntime(context.job.descriptor.entrypoint));
		const session = await createCpuSession(runtime, grant.models[0].path, 'TIGER-DnR');
		try {
			assertExactNames(session.inputNames, TIGER_INPUT_NAMES, 'input', 'TIGER-DnR');
			assertExactNames(session.outputNames, TIGER_OUTPUT_NAMES, 'output', 'TIGER-DnR');
			const overlap = createTigerDnrStreamingOverlapV1(plan, source.geometry.channelCount);
			const batchCount = Math.ceil(source.geometry.channelCount
				/ ASSISTANCE_TIGER_SESSION_MAXIMUM_CHANNELS);
			const workUnits = plan.chunks.length * batchCount;
			let completedUnits = 0;
			for (const chunk of plan.chunks) {
				overlap.beginChunk(chunk.chunkIndex);
				for (let channelStart = 0; channelStart < source.geometry.channelCount;
					channelStart += ASSISTANCE_TIGER_SESSION_MAXIMUM_CHANNELS) {
					context.signal?.throwIfAborted();
					const channelCount = Math.min(ASSISTANCE_TIGER_SESSION_MAXIMUM_CHANNELS,
						source.geometry.channelCount - channelStart);
					const channels = await readTigerChunkChannels(
						source, plan, chunk.chunkIndex, channelStart, channelCount, context.signal,
					);
					const spectrum = tigerDnrStftV1({ schemaVersion: 1,
						sampleRate: ASSISTANCE_TIGER_DNR_SAMPLE_RATE, channels });
					const result = exactTigerOutputs(await session.run({
						spectrum_ri: new runtime.Tensor('float32', packTigerDnrSpectrumV1(spectrum),
							[spectrum.channelCount, 2, spectrum.frequencyBinCount,
								spectrum.timeFrameCount]),
					}));
					context.signal?.throwIfAborted();
					const masks = finiteFloatTensor(result.complex_masks,
						[spectrum.channelCount, TIGER_STEM_COUNT, 2,
							spectrum.frequencyBinCount, spectrum.timeFrameCount],
						'TIGER-DnR complex masks');
					const stems = Array.from({ length: TIGER_STEM_COUNT }, (_, stem) =>
						tigerDnrIstftV1({ schemaVersion: 1,
							spectrum: applyTigerDnrMaskV1(spectrum, masks, stem),
							sourceFrameCount: ASSISTANCE_TIGER_DNR_CHUNK_FRAMES }));
					overlap.addChannelBatch(channelStart, stems, context.signal);
					completedUnits += 1;
					context.onProgress(completedUnits / (workUnits + 1));
				}
				await drainTigerOverlap(overlap, plan, overlap.finishChunk(), sinks, context.signal);
			}
			overlap.finish();
		} finally {
			await session.release?.();
		}
		await source.close();
		const sealed = await publishSinks(context, sinks);
		completed = true;
		return workerResult(context, sealed);
	} finally {
		await source.close().catch(() => undefined);
		if (!completed) await Promise.all(sinks.map((sink) => sink.rollback().catch(() => undefined)));
	}
}

async function readTigerChunkChannels(
	source: AssistanceFloat32WaveSourceV1,
	plan: TigerDnrChunkPlanV1,
	chunkIndex: number,
	channelStart: number,
	channelCount: number,
	signal?: AbortSignal,
): Promise<readonly Float32Array[]> {
	const chunk = plan.chunks[chunkIndex];
	if (!chunk) throw new RangeError('The TIGER-DnR source chunk index is invalid.');
	const sourceStart = Math.max(0, chunk.paddedStartFrame - plan.cropStartFrame);
	const localStart = Math.max(0, plan.cropStartFrame - chunk.paddedStartFrame);
	const copyFrames = Math.min(plan.sourceFrameCount - sourceStart,
		ASSISTANCE_TIGER_DNR_CHUNK_FRAMES - localStart,
		chunk.availableFrameCount - localStart);
	const output = Array.from({ length: channelCount }, () =>
		new Float32Array(ASSISTANCE_TIGER_DNR_CHUNK_FRAMES));
	if (copyFrames > 0) {
		const input = await source.readFrames({ startFrame: sourceStart, frameCount: copyFrames,
			channelStart, channelCount }, signal);
		for (let channel = 0; channel < channelCount; channel += 1) {
			output[channel]!.set(input[channel]!, localStart);
		}
	}
	return Object.freeze(output);
}

async function drainTigerOverlap(
	overlap: TigerDnrStreamingOverlapV1,
	plan: TigerDnrChunkPlanV1,
	safePaddedEnd: number,
	sinks: readonly AssistanceFloat32WaveSinkV1[],
	signal?: AbortSignal,
): Promise<void> {
	const sourceEnd = plan.cropStartFrame + plan.sourceFrameCount;
	while (overlap.paddedPosition < safePaddedEnd) {
		signal?.throwIfAborted();
		const position = overlap.paddedPosition;
		if (position < plan.cropStartFrame) {
			overlap.drain(Math.min(safePaddedEnd, plan.cropStartFrame) - position, false, signal);
			continue;
		}
		if (position >= sourceEnd) {
			overlap.drain(safePaddedEnd - position, false, signal);
			continue;
		}
		const frames = Math.min(ASSISTANCE_TIGER_OUTPUT_WRITE_FRAMES,
			safePaddedEnd - position, sourceEnd - position);
		const stems = overlap.drain(frames, true, signal);
		if (!stems || stems.length !== sinks.length) {
			throw new TypeError('The streaming TIGER stem inventory is invalid.');
		}
		for (let stem = 0; stem < sinks.length; stem += 1) {
			await sinks[stem]!.writeFrames(stems[stem]!, signal);
		}
	}
}

async function publishSinks(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	sinks: readonly AssistanceFloat32WaveSinkV1[],
): Promise<readonly AssistanceFloat32WaveSealedOutputV1[]> {
	if (sinks.length !== context.grant.outputs.length) {
		throw new TypeError('The enhanced WAV inventory does not satisfy its exact reservations.');
	}
	try {
		const sealed: AssistanceFloat32WaveSealedOutputV1[] = [];
		for (const sink of sinks) sealed.push(await sink.seal(context.signal));
		context.signal?.throwIfAborted();
		for (const sink of sinks) await sink.publish(context.signal);
		context.signal?.throwIfAborted();
		for (const sink of sinks) await sink.commit();
		context.onProgress(1);
		return Object.freeze(sealed);
	} catch (error) {
		await Promise.all(sinks.map((sink) => sink.rollback().catch(() => undefined)));
		throw error;
	}
}

function workerResult(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	sealed: readonly AssistanceFloat32WaveSealedOutputV1[],
): AssistanceRuntimeFamilyJobResultV1 {
	return Object.freeze({
		resultVersion: 1, jobId: context.grant.jobId,
		familyId: context.grant.familyId, task: context.grant.task,
		outputs: Object.freeze(sealed.map((body, index) => {
			const reservation = context.grant.outputs[index]!;
			return Object.freeze({ claimId: reservation.claimId, role: reservation.role,
				mediaType: reservation.mediaType, byteLength: body.byteLength,
				sha256: body.sha256 });
		})),
	});
}

function exactDeepFilterModels(models: AssistanceRuntimeFamilyWorkerExecutionContext['grant']['models']):
	Readonly<{ network: (typeof models)[number]; auxiliary: (typeof models)[number];
		config: (typeof models)[number] }> {
	if (models.length !== DEEPFILTER_ARTIFACT_ROLES.length
		|| models.some((model) => model.modelId !== 'deepfilternet3'
			|| model.version !== '3.0.0')
		|| new Set(models.map(({ artifactRole }) => artifactRole)).size !== models.length
		|| DEEPFILTER_ARTIFACT_ROLES.some((role) =>
			!models.some((model) => model.artifactRole === role))) {
		throw new TypeError('DeepFilterNet3 requires its exact model, auxiliary, and config artifacts.');
	}
	return Object.freeze({
		network: models.find(({ artifactRole }) => artifactRole === 'deepfilter')!,
		auxiliary: models.find(({ artifactRole }) => artifactRole === 'deepfilter-auxiliary')!,
		config: models.find(({ artifactRole }) => artifactRole === 'config')!,
	});
}

function reviewDeepFilterConfig(value: Uint8Array): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)) as unknown;
	} catch (error) {
		throw new TypeError('The DeepFilterNet3 configuration is malformed UTF-8 JSON.', { cause: error });
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
		|| Object.keys(parsed).length !== CONFIG_FIELDS.length
		|| Object.keys(parsed).some((key) => !CONFIG_FIELDS.includes(key))) {
		throw new TypeError('The DeepFilterNet3 configuration fields are invalid.');
	}
	const config = parsed as Record<string, unknown>;
	const expected = Object.freeze({ architectures: ['DeepFilterNet3'], conv_lookahead: 2,
		df_bins: ASSISTANCE_DEEPFILTER_BINS, df_lookahead: 2,
		df_order: ASSISTANCE_DEEPFILTER_ORDER, erb_bands: ASSISTANCE_DEEPFILTER_ERB_BANDS,
		fft_bins: ASSISTANCE_DEEPFILTER_FREQUENCY_BINS,
		fft_size: ASSISTANCE_DEEPFILTER_FFT_SIZE, hop_size: ASSISTANCE_DEEPFILTER_HOP_FRAMES,
		library_name: 'onnxruntime', min_nb_erb_freqs: 2, model_type: 'deepfilternet3',
		norm_tau: 1, normalization_alpha: 0.99,
		sample_rate: ASSISTANCE_DEEPFILTER_SAMPLE_RATE });
	if (CONFIG_FIELDS.some((field) => JSON.stringify(config[field])
		!== JSON.stringify((expected as Record<string, unknown>)[field]))) {
		throw new TypeError('The DeepFilterNet3 configuration does not match the pinned DSP contract.');
	}
}

function assertRuntimeJob(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	task: SupportedTask,
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
	operation: SupportedTask,
	outputRoles: readonly string[],
): void {
	const settings = context.settings;
	if (settings.schemaVersion !== 1 || settings.operation !== operation
		|| JSON.stringify(settings.inputRoles) !== '["audio"]'
		|| JSON.stringify(settings.outputRoles) !== JSON.stringify(outputRoles)) {
		throw new TypeError(`The ${operation} settings do not bind one exact audio workflow.`);
	}
}

async function createCpuSession(
	runtime: AssistanceOnnxRuntimeModuleV1,
	modelPath: string,
	label: string,
): Promise<AssistanceOnnxInferenceSessionV1> {
	const session = await runtime.InferenceSession.create(modelPath, {
		executionProviders: ['cpu'], graphOptimizationLevel: 'all',
		interOpNumThreads: 1, intraOpNumThreads: 4,
	});
	if (!session || typeof session !== 'object' || !Array.isArray(session.inputNames)
		|| !Array.isArray(session.outputNames) || typeof session.run !== 'function'
		|| session.release !== undefined && typeof session.release !== 'function') {
		throw new TypeError(`The ${label} ONNX inference session surface is invalid.`);
	}
	return session;
}

function runtimeValue(value: unknown): AssistanceOnnxRuntimeModuleV1 {
	if (!value || typeof value !== 'object') throw new TypeError('The enhancement ONNX runtime is invalid.');
	const candidate = value as Partial<AssistanceOnnxRuntimeModuleV1>;
	if (typeof candidate.Tensor !== 'function' || !candidate.InferenceSession
		|| typeof candidate.InferenceSession.create !== 'function') {
		throw new TypeError('The enhancement ONNX runtime surface is invalid.');
	}
	return candidate as AssistanceOnnxRuntimeModuleV1;
}

function exactOutputs(
	value: Readonly<Record<string, AssistanceOnnxTensorV1>>,
): Readonly<Record<string, AssistanceOnnxTensorV1>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value)) !== JSON.stringify(DEEPFILTER_OUTPUT_NAMES)) {
		throw new TypeError('The DeepFilterNet3 result tensor inventory is invalid.');
	}
	return value;
}

function exactTigerOutputs(
	value: Readonly<Record<string, AssistanceOnnxTensorV1>>,
): Readonly<Record<string, AssistanceOnnxTensorV1>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value)) !== JSON.stringify(TIGER_OUTPUT_NAMES)) {
		throw new TypeError('The TIGER-DnR result tensor inventory is invalid.');
	}
	return value;
}

function floatTensor(
	value: AssistanceOnnxTensorV1 | undefined,
	dims: readonly number[],
	label: string,
): Float32Array {
	if (!value || value.type !== 'float32' || !(value.data instanceof Float32Array)
		|| JSON.stringify(value.dims) !== JSON.stringify(dims)
		|| value.data.length !== dims.reduce((total, dimension) => total * dimension, 1)) {
		throw new RangeError(`${label} tensor geometry or element type is invalid.`);
	}
	return value.data;
}

function finiteFloatTensor(
	value: AssistanceOnnxTensorV1 | undefined,
	dims: readonly number[],
	label: string,
): Float32Array {
	const data = floatTensor(value, dims, label);
	for (const element of data) {
		if (!Number.isFinite(element)) throw new RangeError(`${label} must contain only finite values.`);
	}
	return data;
}

function assertExactNames(
	actual: readonly string[],
	expected: readonly string[],
	kind: string,
	label: string,
): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new TypeError(`The ${label} ONNX graph ${kind} signature is invalid.`);
	}
}
