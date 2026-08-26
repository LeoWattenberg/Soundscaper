/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reviewed CPU-only ONNX Runtime adapters mounted inside the isolated worker. */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
	reviewAssistanceFramePackV1,
	type ReviewedAssistanceFramePackV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';
import {
	ASSISTANCE_TRANSNET_V2_FRAME_BYTES,
	ASSISTANCE_TRANSNET_V2_HEIGHT,
	ASSISTANCE_TRANSNET_V2_WIDTH,
	runAssistanceTransNetV2FrameSourceOnnxAdapterV1,
	type AssistanceTransNetV2CpuInputBatchV1,
} from '../src/common/editor/assistance/transnetv2-onnx-adapter-v1.ts';
import {
	AssistanceRuntimeFamilyAdapterUnavailableError,
	type AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';
import {
	createAssistanceOnnxAudioRuntimeWorkerAdapterV1,
} from './assistance-onnx-audio-runtime-worker.ts';
import {
	createAssistanceOnnxTextEmbeddingWorkerAdapterV1,
} from './assistance-onnx-text-embedding-worker.ts';

export interface AssistanceOnnxTensorV1 {
	readonly type: string;
	readonly data: Uint8Array | Float32Array | BigInt64Array;
	readonly dims: readonly number[];
}

export interface AssistanceOnnxInferenceSessionV1 {
	readonly inputNames: readonly string[];
	readonly outputNames: readonly string[];
	run(feeds: Readonly<Record<string, AssistanceOnnxTensorV1>>): PromiseLike<
		Readonly<Record<string, AssistanceOnnxTensorV1>>
	>;
	release?(): PromiseLike<void> | void;
}

export interface AssistanceOnnxRuntimeModuleV1 {
	readonly Tensor: new (
		type: 'uint8' | 'float32' | 'int64',
		data: Uint8Array | Float32Array | BigInt64Array,
		dims: readonly number[],
	) => AssistanceOnnxTensorV1;
	readonly InferenceSession: Readonly<{
		create(
			modelPath: string,
			options: Readonly<{
				executionProviders: readonly ['cpu'];
				graphOptimizationLevel: 'all';
				interOpNumThreads: 1;
				intraOpNumThreads: 4;
			}>,
		): PromiseLike<AssistanceOnnxInferenceSessionV1>;
	}>;
}

export interface AssistanceOnnxRuntimeWorkerAdapterOptionsV1 {
	readonly loadRuntime?: (entrypoint: string) => PromiseLike<AssistanceOnnxRuntimeModuleV1>;
}

const TRANSNET_INPUT_NAMES = Object.freeze(['frames']);
const TRANSNET_OUTPUT_NAMES = Object.freeze(['single_frame_logits', 'all_frame_logits']);
const TRANSNET_FRAME_PACK_MEDIA_TYPE = 'application/vnd.soundscaper.frame-pack';
const TRANSNET_RESULT_MEDIA_TYPE = 'application/vnd.soundscaper.shot-boundaries+json';

export function createAssistanceOnnxRuntimeWorkerAdapterV1(
	options: AssistanceOnnxRuntimeWorkerAdapterOptionsV1 = {},
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) => Promise<unknown> {
	if (options.loadRuntime !== undefined && typeof options.loadRuntime !== 'function') {
		throw new TypeError('The ONNX Runtime module loader is invalid.');
	}
	const loadRuntime = options.loadRuntime ?? loadOnnxRuntime;
	const executeAudio = createAssistanceOnnxAudioRuntimeWorkerAdapterV1(loadRuntime);
	const executeTextEmbedding = createAssistanceOnnxTextEmbeddingWorkerAdapterV1(loadRuntime);
	return async (context) => {
		if (context.grant.task === 'shot-detection') return executeTransNetV2(context, loadRuntime);
		if (context.grant.task === 'audio-tagging' || context.grant.task === 'beat-tracking') {
			return executeAudio(context);
		}
		if (context.grant.task === 'text-embedding') return executeTextEmbedding(context);
		throw new AssistanceRuntimeFamilyAdapterUnavailableError();
	};
}

async function executeTransNetV2(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: (entrypoint: string) => PromiseLike<AssistanceOnnxRuntimeModuleV1>,
): Promise<unknown> {
	context.signal?.throwIfAborted();
	const { grant, job, settings } = context;
	if (grant.familyId !== 'onnxruntime-node' || grant.task !== 'shot-detection'
		|| job.descriptor.familyId !== 'onnxruntime-node'
		|| job.descriptor.runtimeVersion !== '1.29.0'
		|| job.descriptor.executionProvider !== 'cpu') {
		throw new TypeError('The TransNetV2 adapter received a foreign authenticated job.');
	}
	if (settings.schemaVersion !== 1 || settings.operation !== 'shot-detection'
		|| !Array.isArray(settings.inputRoles) || settings.inputRoles.length < 1
		|| settings.inputRoles.some((role) => role !== 'frame-pack')
		|| JSON.stringify(settings.outputRoles) !== '["shot-boundaries"]') {
		throw new TypeError('The TransNetV2 adapter settings do not bind accurate shot detection.');
	}
	if (grant.inputs.length < 1 || grant.inputs.some((input) => input.role !== 'frame-pack'
		|| input.mediaType !== TRANSNET_FRAME_PACK_MEDIA_TYPE)
		|| grant.models.length !== 1 || grant.models[0]!.modelId !== 'transnetv2'
		|| grant.models[0]!.artifactRole !== 'network'
		|| grant.outputs.length !== 1 || grant.outputs[0]!.role !== 'shot-boundaries'
		|| grant.outputs[0]!.mediaType !== TRANSNET_RESULT_MEDIA_TYPE) {
		throw new TypeError('The TransNetV2 adapter requires one exact frame pack, network, and shot output.');
	}
	context.onProgress(0);
	const frames = await inspectFramePacks(grant.inputs, context.signal);
	context.signal?.throwIfAborted();
	const runtime = runtimeModule(await loadRuntime(job.descriptor.entrypoint));
	const session = sessionValue(await runtime.InferenceSession.create(grant.models[0]!.path, {
		executionProviders: ['cpu'], graphOptimizationLevel: 'all',
		interOpNumThreads: 1, intraOpNumThreads: 4,
	}));
	let completedBatches = 0;
	const batchCount = Math.ceil(frames.sourceFrames.length / 50);
	try {
		assertExactNames(session.inputNames, TRANSNET_INPUT_NAMES, 'input');
		assertExactNames(session.outputNames, TRANSNET_OUTPUT_NAMES, 'output');
		const result = await runAssistanceTransNetV2FrameSourceOnnxAdapterV1({
			schemaVersion: 1,
			frames: {
				schemaVersion: 1, pixelFormat: 'rgb24', width: 48, height: 27,
				rowStrideBytes: 144, timescale: frames.timescale,
				frameCount: frames.sourceFrames.length,
				sourceFrames: frames.sourceFrames,
				presentationTicks: frames.presentationTicks,
				readFrame: frames.readFrame,
			},
			inputElementType: 'uint8', outputValueKind: 'logits',
			threshold: 0.5, minimumBoundaryDistanceFrames: 1,
		}, {
			signal: context.signal,
			runBatch: async (batch) => {
				const output = await session.run({ frames: tensor(runtime, batch) });
				completedBatches += 1;
				context.onProgress(completedBatches / (batchCount + 1));
				return Object.freeze({
					singleFrame: output.single_frame_logits,
					allFrame: output.all_frame_logits,
				});
			},
		});
		context.signal?.throwIfAborted();
		const body = Buffer.from(JSON.stringify(result), 'utf8');
		const reservation = grant.outputs[0]!;
		if (body.byteLength < 1 || body.byteLength > reservation.maximumByteLength) {
			throw new RangeError('The TransNetV2 result exceeds its authenticated output reservation.');
		}
		await writeFile(reservation.path, body);
		context.signal?.throwIfAborted();
		context.onProgress(1);
		return Object.freeze({
			resultVersion: 1, jobId: grant.jobId, familyId: grant.familyId, task: grant.task,
			outputs: Object.freeze([Object.freeze({
				claimId: reservation.claimId, role: reservation.role,
				mediaType: reservation.mediaType, byteLength: body.byteLength,
				sha256: createHash('sha256').update(body).digest('hex'),
			})]),
		});
	} finally {
		frames.release();
		await session.release?.();
	}
}

interface TransNetFramePackIndex {
	readonly inputIndex: number;
	readonly ordinalStart: number;
	readonly frameCount: number;
	readonly sourceFrames: readonly number[];
	readonly presentationTicks: readonly string[];
}

interface TransNetFramePackSource {
	readonly timescale: number;
	readonly sourceFrames: readonly number[];
	readonly presentationTicks: readonly string[];
	readFrame(index: number): Promise<Uint8Array>;
	release(): void;
}

async function inspectFramePacks(
	inputs: AssistanceRuntimeFamilyWorkerExecutionContext['grant']['inputs'],
	signal?: AbortSignal,
): Promise<TransNetFramePackSource> {
	const indexes: TransNetFramePackIndex[] = [];
	const sourceFrames: number[] = [];
	const presentationTicks: string[] = [];
	let timescale: number | null = null;
	for (const [inputIndex, input] of inputs.entries()) {
		signal?.throwIfAborted();
		const reviewed = reviewAssistanceFramePackV1(await readFile(input.path));
		assertTransNetFramePackGeometry(reviewed);
		if (timescale !== null && reviewed.timescale !== timescale) {
			throw new RangeError('TransNetV2 frame-pack chunks disagree about their exact timescale.');
		}
		timescale ??= reviewed.timescale;
		const packSources: number[] = [];
		const packTicks: string[] = [];
		for (let index = 0; index < reviewed.frameCount; index += 1) {
			const frame = reviewed.frame(index);
			const priorSource = sourceFrames.at(-1);
			const priorTick = presentationTicks.at(-1);
			if (priorSource !== undefined && frame.sourceFrame !== priorSource + 1) {
				throw new RangeError('TransNetV2 frame-pack chunks must cover consecutive source frames.');
			}
			if (priorTick !== undefined && BigInt(frame.presentationTick) <= BigInt(priorTick)) {
				throw new RangeError('TransNetV2 frame-pack chunks must retain increasing presentation timing.');
			}
			packSources.push(frame.sourceFrame);
			packTicks.push(frame.presentationTick);
			sourceFrames.push(frame.sourceFrame);
			presentationTicks.push(frame.presentationTick);
		}
		indexes.push(Object.freeze({ inputIndex,
			ordinalStart: sourceFrames.length - reviewed.frameCount,
			frameCount: reviewed.frameCount,
			sourceFrames: Object.freeze(packSources),
			presentationTicks: Object.freeze(packTicks),
		}));
	}
	if (timescale === null || sourceFrames.length < 1) {
		throw new RangeError('TransNetV2 requires at least one reviewed source frame.');
	}
	const cache = new Map<number, ReviewedAssistanceFramePackV1>();
	const load = async (pack: TransNetFramePackIndex): Promise<ReviewedAssistanceFramePackV1> => {
		const cached = cache.get(pack.inputIndex);
		if (cached) {
			cache.delete(pack.inputIndex);
			cache.set(pack.inputIndex, cached);
			return cached;
		}
		signal?.throwIfAborted();
		const reviewed = reviewAssistanceFramePackV1(await readFile(inputs[pack.inputIndex]!.path));
		assertTransNetFramePackGeometry(reviewed);
		if (reviewed.timescale !== timescale || reviewed.frameCount !== pack.frameCount) {
			throw new Error('A TransNetV2 frame-pack changed after its reviewed metadata pass.');
		}
		while (cache.size >= 2) cache.delete(cache.keys().next().value!);
		cache.set(pack.inputIndex, reviewed);
		return reviewed;
	};
	return Object.freeze({
		timescale,
		sourceFrames: Object.freeze(sourceFrames),
		presentationTicks: Object.freeze(presentationTicks),
		async readFrame(indexValue: number) {
			if (!Number.isSafeInteger(indexValue) || indexValue < 0 || indexValue >= sourceFrames.length) {
				throw new RangeError('TransNetV2 requested a frame outside reviewed pack custody.');
			}
			const pack = indexes.find((candidate) => indexValue >= candidate.ordinalStart
				&& indexValue < candidate.ordinalStart + candidate.frameCount)!;
			const reviewed = await load(pack);
			const localIndex = indexValue - pack.ordinalStart;
			const frame = reviewed.frame(localIndex);
			if (frame.sourceFrame !== pack.sourceFrames[localIndex]
				|| frame.presentationTick !== pack.presentationTicks[localIndex]) {
				throw new Error('A TransNetV2 frame-pack changed after its reviewed timing pass.');
			}
			return rgbaToRgb(frame.rgba);
		},
		release() { cache.clear(); },
	});
}

function assertTransNetFramePackGeometry(reviewed: ReviewedAssistanceFramePackV1): void {
	if (reviewed.width !== ASSISTANCE_TRANSNET_V2_WIDTH
		|| reviewed.height !== ASSISTANCE_TRANSNET_V2_HEIGHT || reviewed.frameCount < 1) {
		throw new RangeError('The TransNetV2 frame-pack geometry must be predecoded to exact 48x27 RGBA.');
	}
}

function rgbaToRgb(rgba: Uint8Array): Uint8Array {
	const rgb = new Uint8Array(ASSISTANCE_TRANSNET_V2_FRAME_BYTES);
	for (let rgbaOffset = 0, offset = 0; rgbaOffset < rgba.byteLength;
		rgbaOffset += 4, offset += 3) {
		rgb[offset] = rgba[rgbaOffset]!;
		rgb[offset + 1] = rgba[rgbaOffset + 1]!;
		rgb[offset + 2] = rgba[rgbaOffset + 2]!;
	}
	return rgb;
}

function tensor(
	runtime: AssistanceOnnxRuntimeModuleV1,
	batch: AssistanceTransNetV2CpuInputBatchV1,
): AssistanceOnnxTensorV1 {
	if (!(batch.data instanceof Uint8Array) || batch.elementType !== 'uint8') {
		throw new TypeError('The reviewed TransNetV2 graph requires uint8 CPU input.');
	}
	return new runtime.Tensor('uint8', batch.data, batch.dims);
}

async function loadOnnxRuntime(entrypoint: string): Promise<AssistanceOnnxRuntimeModuleV1> {
	const loaded = await import(pathToFileURL(entrypoint).href) as unknown;
	if (loaded && typeof loaded === 'object' && 'default' in loaded) {
		const candidate = (loaded as Readonly<{ default: unknown }>).default;
		if (candidate && typeof candidate === 'object') return runtimeModule(candidate);
	}
	return runtimeModule(loaded);
}

function runtimeModule(value: unknown): AssistanceOnnxRuntimeModuleV1 {
	if (!value || typeof value !== 'object') throw new TypeError('The ONNX Runtime module is invalid.');
	const candidate = value as Partial<AssistanceOnnxRuntimeModuleV1>;
	if (typeof candidate.Tensor !== 'function' || !candidate.InferenceSession
		|| typeof candidate.InferenceSession.create !== 'function') {
		throw new TypeError('The ONNX Runtime module surface is invalid.');
	}
	return candidate as AssistanceOnnxRuntimeModuleV1;
}

function sessionValue(value: unknown): AssistanceOnnxInferenceSessionV1 {
	if (!value || typeof value !== 'object') throw new TypeError('The ONNX Runtime session is invalid.');
	const session = value as Partial<AssistanceOnnxInferenceSessionV1>;
	if (!Array.isArray(session.inputNames) || !Array.isArray(session.outputNames)
		|| typeof session.run !== 'function'
		|| session.release !== undefined && typeof session.release !== 'function') {
		throw new TypeError('The ONNX Runtime session surface is invalid.');
	}
	return session as AssistanceOnnxInferenceSessionV1;
}

function assertExactNames(
	value: readonly string[], expected: readonly string[], kind: string,
): void {
	if (JSON.stringify(value) !== JSON.stringify(expected)) {
		throw new TypeError(`The TransNetV2 ONNX graph ${kind} signature is invalid.`);
	}
}
