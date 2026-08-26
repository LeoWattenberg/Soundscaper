/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated CPU ONNX custody for DeepFilterNet3 and TIGER-DnR. */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

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
	extractTigerDnrChunkV1,
	mergeTigerDnrStemV1,
	tigerDnrIstftV1,
	tigerDnrStftV1,
	type TigerDnrSpectrumV1,
} from '../src/common/editor/assistance/tiger-dnr-signal-v1.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
	AssistanceOnnxTensorV1,
} from './assistance-onnx-runtime-worker.ts';
import type {
	AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';

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
const MAXIMUM_WAVE_BYTES = 512 * 1024 ** 2;

export function createAssistanceOnnxEnhancementSeparationWorkerAdapterV1(
	loadRuntime: RuntimeLoader,
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) => Promise<unknown> {
	if (typeof loadRuntime !== 'function') {
		throw new TypeError('The ONNX enhancement and separation runtime loader is invalid.');
	}
	return async (context) => {
		if (context.grant.task === 'speech-enhancement') {
			return executeDeepFilterNet3(context, loadRuntime);
		}
		if (context.grant.task === 'source-separation') {
			return executeTigerDnr(context, loadRuntime);
		}
		throw new TypeError('The ONNX enhancement and separation adapter received a foreign task.');
	};
}

async function executeDeepFilterNet3(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: RuntimeLoader,
): Promise<unknown> {
	assertRuntimeJob(context, 'speech-enhancement');
	assertSettings(context, 'speech-enhancement', ['enhanced-audio']);
	const { grant } = context;
	const input = grant.inputs[0];
	const output = grant.outputs[0];
	if (grant.inputs.length !== 1 || input?.role !== 'audio'
		|| input.mediaType !== AUDIO_MEDIA_TYPE || input.byteLength > MAXIMUM_WAVE_BYTES
		|| grant.outputs.length !== 1 || output?.role !== 'enhanced-audio'
		|| output.mediaType !== AUDIO_MEDIA_TYPE) {
		throw new TypeError('DeepFilterNet3 requires one exact audio input and enhanced WAV output.');
	}
	const models = exactDeepFilterModels(grant.models);
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const [waveBytes, configurationBytes, auxiliaryBytes] = await Promise.all([
		readFile(input.path), readFile(models.config.path), readFile(models.auxiliary.path),
	]);
	reviewDeepFilterConfig(configurationBytes);
	reviewAssistanceDeepFilterAuxiliaryV1(auxiliaryBytes);
	const wave = reviewCanonicalFloat32Wave(waveBytes, ASSISTANCE_DEEPFILTER_SAMPLE_RATE);
	context.signal?.throwIfAborted();
	const runtime = runtimeValue(await loadRuntime(context.job.descriptor.entrypoint));
	const session = await createCpuSession(runtime, models.network.path, 'DeepFilterNet3');
	try {
		assertExactNames(session.inputNames, DEEPFILTER_INPUT_NAMES, 'input', 'DeepFilterNet3');
		assertExactNames(session.outputNames, DEEPFILTER_OUTPUT_NAMES, 'output', 'DeepFilterNet3');
		const enhanced: Float32Array[] = [];
		for (let channel = 0; channel < wave.channels.length; channel += 1) {
			context.signal?.throwIfAborted();
			const analysis = analyzeAssistanceDeepFilterChannelV1(
				wave.channels[channel]!, context.signal,
			);
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
			enhanced.push(synthesizeAssistanceDeepFilterChannelV1(
				analysis, mask, coefficients, context.signal,
			));
			context.signal?.throwIfAborted();
			context.onProgress((channel + 1) / (wave.channels.length + 1));
		}
		const body = encodeWav(enhanced, {
			sampleRate: ASSISTANCE_DEEPFILTER_SAMPLE_RATE,
			bitDepth: 32, float: true, dither: false,
		});
		return publishWaves(context, [body]);
	} finally {
		await session.release?.();
	}
}

async function executeTigerDnr(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: RuntimeLoader,
): Promise<unknown> {
	assertRuntimeJob(context, 'source-separation');
	assertSettings(context, 'source-separation', [
		'separated-audio', 'separated-audio', 'separated-audio',
	]);
	const { grant } = context;
	const input = grant.inputs[0];
	if (grant.inputs.length !== 1 || input?.role !== 'audio'
		|| input.mediaType !== AUDIO_MEDIA_TYPE || input.byteLength > MAXIMUM_WAVE_BYTES
		|| grant.models.length !== 1 || grant.models[0]?.modelId !== 'tiger-dnr'
		|| grant.models[0].version !== '1.0.0' || grant.models[0].artifactRole !== 'network'
		|| grant.outputs.length !== 3 || grant.outputs.some((output) =>
			output.role !== 'separated-audio' || output.mediaType !== AUDIO_MEDIA_TYPE)) {
		throw new TypeError('TIGER-DnR requires one exact network, audio input, and ordered D/M/E WAV grants.');
	}
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const wave = reviewCanonicalFloat32Wave(await readFile(input.path),
		ASSISTANCE_TIGER_DNR_SAMPLE_RATE);
	const plan = createTigerDnrChunkPlanV1({ schemaVersion: 1,
		sourceFrameCount: wave.channels[0]!.length });
	context.signal?.throwIfAborted();
	const runtime = runtimeValue(await loadRuntime(context.job.descriptor.entrypoint));
	const session = await createCpuSession(runtime, grant.models[0].path, 'TIGER-DnR');
	const chunks = Array.from({ length: TIGER_STEM_COUNT }, () => [] as Array<Readonly<{
		readonly chunkIndex: number; readonly channels: readonly Float32Array[];
	}>>);
	try {
		assertExactNames(session.inputNames, TIGER_INPUT_NAMES, 'input', 'TIGER-DnR');
		assertExactNames(session.outputNames, TIGER_OUTPUT_NAMES, 'output', 'TIGER-DnR');
		for (const chunk of plan.chunks) {
			context.signal?.throwIfAborted();
			const channels = extractTigerDnrChunkV1({ schemaVersion: 1, plan,
				chunkIndex: chunk.chunkIndex, channels: wave.channels });
			const spectrum = tigerDnrStftV1({ schemaVersion: 1,
				sampleRate: ASSISTANCE_TIGER_DNR_SAMPLE_RATE, channels });
			const result = exactTigerOutputs(await session.run({
				spectrum_ri: new runtime.Tensor('float32', packTigerSpectrum(spectrum),
					[spectrum.channelCount, 2, spectrum.frequencyBinCount,
						spectrum.timeFrameCount]),
			}));
			context.signal?.throwIfAborted();
			const masks = finiteFloatTensor(result.complex_masks,
				[spectrum.channelCount, TIGER_STEM_COUNT, 2,
					spectrum.frequencyBinCount, spectrum.timeFrameCount],
				'TIGER-DnR complex masks');
			for (let stem = 0; stem < TIGER_STEM_COUNT; stem += 1) {
				context.signal?.throwIfAborted();
				chunks[stem]!.push(Object.freeze({ chunkIndex: chunk.chunkIndex,
					channels: tigerDnrIstftV1({ schemaVersion: 1,
						spectrum: applyTigerMask(spectrum, masks, stem),
						sourceFrameCount: ASSISTANCE_TIGER_DNR_CHUNK_FRAMES }),
				}));
			}
			context.onProgress((chunk.chunkIndex + 1) / (plan.chunks.length + 1));
		}
		const bodies = chunks.map((stemChunks) => encodeWav(mergeTigerDnrStemV1({
			schemaVersion: 1, plan, channelCount: wave.channels.length, chunks: stemChunks,
		}), { sampleRate: ASSISTANCE_TIGER_DNR_SAMPLE_RATE,
			bitDepth: 32, float: true, dither: false }));
		return publishWaves(context, bodies);
	} finally {
		await session.release?.();
	}
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

function reviewCanonicalFloat32Wave(
	value: Uint8Array,
	expectedSampleRate: number,
): Readonly<{ channels: readonly Float32Array[] }> {
	if (!(value instanceof Uint8Array) || value.byteLength < 48
		|| value.byteLength > MAXIMUM_WAVE_BYTES) {
		throw new RangeError('Enhancement audio is outside its exact WAV capacity.');
	}
	const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
	if (ascii(value, 0) !== 'RIFF' || ascii(value, 8) !== 'WAVE'
		|| view.getUint32(4, true) !== value.byteLength - 8
		|| ascii(value, 12) !== 'fmt ' || view.getUint32(16, true) !== 16
		|| view.getUint16(20, true) !== 3 || ascii(value, 36) !== 'data'
		|| view.getUint32(40, true) !== value.byteLength - 44) {
		throw new TypeError('Enhancement audio requires one canonical RIFF Float32 WAV.');
	}
	const channelCount = view.getUint16(22, true);
	const blockAlign = channelCount * 4;
	if (channelCount < 1 || channelCount > 64 || view.getUint32(24, true) !== expectedSampleRate
		|| view.getUint32(28, true) !== expectedSampleRate * blockAlign
		|| view.getUint16(32, true) !== blockAlign || view.getUint16(34, true) !== 32
		|| (value.byteLength - 44) % blockAlign !== 0) {
		throw new RangeError('Enhancement audio changed its exact sample-rate or channel geometry.');
	}
	const frameCount = (value.byteLength - 44) / blockAlign;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1) {
		throw new RangeError('Enhancement audio has no complete sample frames.');
	}
	const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			const sample = view.getFloat32(44 + (frame * channelCount + channel) * 4, true);
			if (!Number.isFinite(sample)) throw new RangeError('Enhancement audio samples must be finite.');
			channels[channel]![frame] = sample;
		}
	}
	return Object.freeze({ channels: Object.freeze(channels) });
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

function packTigerSpectrum(spectrum: TigerDnrSpectrumV1): Float32Array {
	const { channelCount, frequencyBinCount, timeFrameCount } = spectrum;
	const output = new Float32Array(channelCount * 2 * frequencyBinCount * timeFrameCount);
	for (let channel = 0; channel < channelCount; channel += 1) {
		const source = spectrum.channels[channel]!;
		for (let component = 0; component < 2; component += 1) {
			const plane = component === 0 ? source.real : source.imaginary;
			for (let frequency = 0; frequency < frequencyBinCount; frequency += 1) {
				for (let time = 0; time < timeFrameCount; time += 1) {
					output[((channel * 2 + component) * frequencyBinCount + frequency)
						* timeFrameCount + time] = plane[time * frequencyBinCount + frequency]!;
				}
			}
		}
	}
	return output;
}

function applyTigerMask(
	spectrum: TigerDnrSpectrumV1,
	masks: Float32Array,
	stem: number,
): TigerDnrSpectrumV1 {
	const { frequencyBinCount, timeFrameCount } = spectrum;
	const channels = spectrum.channels.map((source, channel) => {
		const real = new Float32Array(frequencyBinCount * timeFrameCount);
		const imaginary = new Float32Array(real.length);
		for (let frequency = 0; frequency < frequencyBinCount; frequency += 1) {
			for (let time = 0; time < timeFrameCount; time += 1) {
				const spectrumOffset = time * frequencyBinCount + frequency;
				const maskOffset = (((channel * TIGER_STEM_COUNT + stem) * 2)
					* frequencyBinCount + frequency) * timeFrameCount + time;
				const sourceReal = source.real[spectrumOffset]!;
				const sourceImaginary = source.imaginary[spectrumOffset]!;
				const maskReal = masks[maskOffset]!;
				const maskImaginary = masks[maskOffset + frequencyBinCount * timeFrameCount]!;
				real[spectrumOffset] = sourceReal * maskReal - sourceImaginary * maskImaginary;
				imaginary[spectrumOffset] = sourceReal * maskImaginary + sourceImaginary * maskReal;
			}
		}
		return Object.freeze({ real, imaginary });
	});
	return Object.freeze({ ...spectrum, channels: Object.freeze(channels) });
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

async function publishWaves(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	bodies: readonly Uint8Array[],
): Promise<unknown> {
	context.signal?.throwIfAborted();
	if (bodies.length !== context.grant.outputs.length) {
		throw new TypeError('The enhanced WAV inventory does not satisfy its exact reservations.');
	}
	await Promise.all(bodies.map(async (body, index) => {
		const reservation = context.grant.outputs[index]!;
		if (body.byteLength < 45 || body.byteLength > reservation.maximumByteLength) {
			throw new RangeError('An enhanced WAV exceeds its authenticated output reservation.');
		}
		await writeFile(reservation.path, body);
	}));
	context.signal?.throwIfAborted();
	context.onProgress(1);
	return Object.freeze({
		resultVersion: 1, jobId: context.grant.jobId,
		familyId: context.grant.familyId, task: context.grant.task,
		outputs: Object.freeze(bodies.map((body, index) => {
			const reservation = context.grant.outputs[index]!;
			return Object.freeze({ claimId: reservation.claimId, role: reservation.role,
				mediaType: reservation.mediaType, byteLength: body.byteLength,
				sha256: createHash('sha256').update(body).digest('hex') });
		})),
	});
}

function ascii(value: Uint8Array, offset: number): string {
	return String.fromCharCode(...value.subarray(offset, offset + 4));
}
