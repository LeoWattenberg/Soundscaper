/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated CPU ONNX custody for the dereverb-room BS-RoFormer model. */

import {
	ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES,
	ASSISTANCE_DEREVERB_ROOM_SAMPLE_RATE,
	createDereverbRoomChunkPlanV1,
	dereverbRoomIstftV1,
	dereverbRoomStftV1,
	type DereverbRoomChunkPlanV1,
	type DereverbRoomChunkV1,
} from '../src/common/editor/assistance/dereverb-room-signal-v1.ts';
import {
	createDereverbRoomStreamingOverlapV1,
	type DereverbRoomStreamingOverlapV1,
} from '../src/common/editor/assistance/dereverb-room-streaming-overlap-v1.ts';
import {
	applyDereverbRoomMaskV1,
	packDereverbRoomSpectrumV1,
} from './assistance-dereverb-room-onnx-tensors.ts';
import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
	AssistanceOnnxTensorV1,
} from './assistance-onnx-runtime-worker.ts';
import type {
	AssistanceRuntimeFamilyJobResultV1,
} from './assistance-runtime-family-job-contract.ts';
import type {
	AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';
import {
	createNodeAssistanceFloat32WaveStorageV1,
	type AssistanceFloat32WaveSealedOutputV1,
	type AssistanceFloat32WaveSinkV1,
	type AssistanceFloat32WaveSourceV1,
	type AssistanceFloat32WaveStorageV1,
} from './assistance-streaming-float32-wave.ts';

type RuntimeLoader = (entrypoint: string) => PromiseLike<AssistanceOnnxRuntimeModuleV1>;

const AUDIO_MEDIA_TYPE = 'audio/wav';
const DEREVERB_INPUT_NAMES = Object.freeze(['input']);
const DEREVERB_OUTPUT_NAMES = Object.freeze(['output']);
const SPECTRUM_FRAMES = ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES / 512 + 1;
const FREQUENCY_BINS = 1_025;
export const ASSISTANCE_DEREVERB_OUTPUT_WRITE_FRAMES = 16_384;
export const ASSISTANCE_DEREVERB_MAXIMUM_CHANNELS = 32;

export interface AssistanceOnnxDereverbWorkerOptionsV1 {
	readonly waveStorage?: AssistanceFloat32WaveStorageV1;
}

export function createAssistanceOnnxDereverbWorkerAdapterV1(
	loadRuntime: RuntimeLoader,
	options: AssistanceOnnxDereverbWorkerOptionsV1 = {},
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) =>
	Promise<AssistanceRuntimeFamilyJobResultV1> {
	if (typeof loadRuntime !== 'function') {
		throw new TypeError('The ONNX dereverberation runtime loader is invalid.');
	}
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| Object.keys(options).some((key) => key !== 'waveStorage')) {
		throw new TypeError('The dereverberation worker options are invalid.');
	}
	const waveStorage = options.waveStorage ?? createNodeAssistanceFloat32WaveStorageV1();
	if (!waveStorage || typeof waveStorage.openSource !== 'function'
		|| typeof waveStorage.openSink !== 'function') {
		throw new TypeError('The dereverberation WAV storage is invalid.');
	}
	return async (context) => executeDereverbRoom(context, loadRuntime, waveStorage);
}

async function executeDereverbRoom(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: RuntimeLoader,
	waveStorage: AssistanceFloat32WaveStorageV1,
): Promise<AssistanceRuntimeFamilyJobResultV1> {
	assertRuntimeJob(context);
	assertSettings(context);
	const { grant } = context;
	const input = grant.inputs[0];
	const output = grant.outputs[0];
	if (grant.inputs.length !== 1 || input?.role !== 'audio'
		|| input.mediaType !== AUDIO_MEDIA_TYPE
		|| grant.outputs.length !== 1 || output?.role !== 'enhanced-audio'
		|| output.mediaType !== AUDIO_MEDIA_TYPE) {
		throw new TypeError('dereverb-room requires one exact audio input and enhanced WAV output.');
	}
	assertDereverbModelGrant(grant.models);
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const source = await waveStorage.openSource(input,
		ASSISTANCE_DEREVERB_ROOM_SAMPLE_RATE, context.signal);
	if (source.geometry.channelCount > ASSISTANCE_DEREVERB_MAXIMUM_CHANNELS) {
		await source.close().catch(() => undefined);
		throw new RangeError('dereverb-room admits at most 32 channels for one selection.');
	}
	const plan = createDereverbRoomChunkPlanV1({ schemaVersion: 1,
		sourceFrameCount: source.geometry.frameCount });
	let sink: AssistanceFloat32WaveSinkV1 | null = null;
	let completed = false;
	try {
		sink = await waveStorage.openSink(output, source.geometry, context.signal);
		context.signal?.throwIfAborted();
		const runtime = runtimeValue(await loadRuntime(context.job.descriptor.entrypoint));
		const session = await createCpuSession(runtime, grant.models[0]!.path);
		try {
			assertExactNames(session.inputNames, DEREVERB_INPUT_NAMES, 'input');
			assertExactNames(session.outputNames, DEREVERB_OUTPUT_NAMES, 'output');
			const overlaps = Array.from({ length: source.geometry.channelCount },
				() => createDereverbRoomStreamingOverlapV1(plan));
			const workUnits = plan.chunks.length * source.geometry.channelCount;
			let completedUnits = 0;
			for (const chunk of plan.chunks) {
				for (let channel = 0; channel < source.geometry.channelCount; channel += 1) {
					context.signal?.throwIfAborted();
					const frames = await readDereverbChunkChannel(
						source, plan, chunk, channel, context.signal,
					);
					const spectrum = dereverbRoomStftV1({ schemaVersion: 1,
						sampleRate: ASSISTANCE_DEREVERB_ROOM_SAMPLE_RATE, channel: frames });
					const result = exactOutputs(await session.run({
						input: new runtime.Tensor('float32', packDereverbRoomSpectrumV1(spectrum),
							[1, SPECTRUM_FRAMES, FREQUENCY_BINS * 2]),
					}));
					context.signal?.throwIfAborted();
					const mask = finiteFloatTensor(result.output,
						[1, 1, FREQUENCY_BINS, SPECTRUM_FRAMES, 2], 'dereverb-room complex mask');
					const restored = dereverbRoomIstftV1({ schemaVersion: 1,
						spectrum: applyDereverbRoomMaskV1(spectrum, mask),
						sourceFrameCount: ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES });
					overlaps[channel]!.addChunk(chunk.chunkIndex, restored, context.signal);
					completedUnits += 1;
					context.onProgress(completedUnits / (workUnits + 1));
				}
				await drainDereverbOverlaps(overlaps, plan, sink, context.signal);
			}
			for (const overlap of overlaps) overlap.finish();
		} finally {
			await session.release?.();
		}
		await source.close();
		const sealed = await publishSink(context, sink);
		completed = true;
		return workerResult(context, sealed);
	} finally {
		await source.close().catch(() => undefined);
		if (!completed && sink) await sink.rollback().catch(() => undefined);
	}
}

/**
 * Materialize one padded chunk for one channel with bounded reads: the border
 * region reflects the source without materializing the whole plane, and the
 * tail is reflect- or zero-padded per the plan, exactly matching
 * `extractDereverbRoomChunkV1` over the full plane.
 */
async function readDereverbChunkChannel(
	source: AssistanceFloat32WaveSourceV1,
	plan: DereverbRoomChunkPlanV1,
	chunk: DereverbRoomChunkV1,
	channel: number,
	signal?: AbortSignal,
): Promise<Float32Array> {
	const sourceFrames = plan.sourceFrameCount;
	const output = new Float32Array(ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES);
	let frame = 0;
	while (frame < chunk.availableFrameCount) {
		signal?.throwIfAborted();
		const sourceIndex = chunk.paddedStartFrame + frame - plan.borderFrames;
		if (sourceIndex < 0) {
			// Left border: padded index -s reflects source frame s (no edge repeat).
			const spanFrames = Math.min(-sourceIndex, chunk.availableFrameCount - frame);
			const reflected = await source.readFrames({
				startFrame: -sourceIndex - spanFrames + 1, frameCount: spanFrames,
				channelStart: channel, channelCount: 1,
			}, signal);
			for (let index = 0; index < spanFrames; index += 1) {
				output[frame + index] = reflected[0]![spanFrames - 1 - index]!;
			}
			frame += spanFrames;
			continue;
		}
		if (sourceIndex >= sourceFrames) {
			const spanFrames = chunk.availableFrameCount - frame;
			const firstReflected = 2 * sourceFrames - 2 - sourceIndex;
			const reflected = await source.readFrames({
				startFrame: firstReflected - spanFrames + 1, frameCount: spanFrames,
				channelStart: channel, channelCount: 1,
			}, signal);
			for (let index = 0; index < spanFrames; index += 1) {
				output[frame + index] = reflected[0]![spanFrames - 1 - index]!;
			}
			frame += spanFrames;
			continue;
		}
		const spanFrames = Math.min(sourceFrames - sourceIndex,
			chunk.availableFrameCount - frame);
		const middle = await source.readFrames({
			startFrame: sourceIndex, frameCount: spanFrames,
			channelStart: channel, channelCount: 1,
		}, signal);
		output.set(middle[0]!, frame);
		frame += spanFrames;
	}
	if (chunk.tailPadMode === 'reflect') {
		for (let tail = chunk.availableFrameCount;
			tail < ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES; tail += 1) {
			output[tail] = output[2 * chunk.availableFrameCount - 2 - tail]!;
		}
	}
	return output;
}

async function drainDereverbOverlaps(
	overlaps: readonly DereverbRoomStreamingOverlapV1[],
	plan: DereverbRoomChunkPlanV1,
	sink: AssistanceFloat32WaveSinkV1,
	signal?: AbortSignal,
): Promise<void> {
	const safePaddedEnd = overlaps[0]!.safePaddedEnd;
	const sourceEnd = plan.borderFrames + plan.sourceFrameCount;
	while (overlaps[0]!.paddedPosition < safePaddedEnd) {
		signal?.throwIfAborted();
		const position = overlaps[0]!.paddedPosition;
		if (position < plan.borderFrames) {
			const skipped = Math.min(safePaddedEnd, plan.borderFrames) - position;
			for (const overlap of overlaps) overlap.drain(skipped, false, signal);
			continue;
		}
		if (position >= sourceEnd) {
			for (const overlap of overlaps) overlap.drain(safePaddedEnd - position, false, signal);
			continue;
		}
		const frames = Math.min(ASSISTANCE_DEREVERB_OUTPUT_WRITE_FRAMES,
			safePaddedEnd - position, sourceEnd - position);
		const channels: Float32Array[] = [];
		for (const overlap of overlaps) {
			if (overlap.paddedPosition !== position || overlap.safePaddedEnd !== safePaddedEnd) {
				throw new TypeError('The dereverb-room channel overlaps diverged.');
			}
			channels.push(overlap.drain(frames, true, signal)!);
		}
		await sink.writeFrames(channels, signal);
	}
}

async function publishSink(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	sink: AssistanceFloat32WaveSinkV1,
): Promise<AssistanceFloat32WaveSealedOutputV1> {
	if (context.grant.outputs.length !== 1) {
		throw new TypeError('The dereverberated WAV inventory does not satisfy its exact reservation.');
	}
	try {
		const sealed = await sink.seal(context.signal);
		context.signal?.throwIfAborted();
		await sink.publish(context.signal);
		context.signal?.throwIfAborted();
		await sink.commit();
		context.onProgress(1);
		return sealed;
	} catch (error) {
		await sink.rollback().catch(() => undefined);
		throw error;
	}
}

function workerResult(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	sealed: AssistanceFloat32WaveSealedOutputV1,
): AssistanceRuntimeFamilyJobResultV1 {
	const reservation = context.grant.outputs[0]!;
	return Object.freeze({
		resultVersion: 1, jobId: context.grant.jobId,
		familyId: context.grant.familyId, task: context.grant.task,
		outputs: Object.freeze([Object.freeze({
			claimId: reservation.claimId, role: reservation.role,
			mediaType: reservation.mediaType, byteLength: sealed.byteLength,
			sha256: sealed.sha256,
		})]),
	});
}

/** Close dereverb-room model substitution inside the worker itself. */
export function assertDereverbModelGrant(
	models: AssistanceRuntimeFamilyWorkerExecutionContext['grant']['models'],
): void {
	if (models.length !== 1 || models[0]?.modelId !== 'dereverb-room'
		|| models[0].version !== '1.0.0' || models[0].artifactRole !== 'network') {
		throw new TypeError('dereverb-room requires its exact 1.0.0 network artifact.');
	}
}

function assertRuntimeJob(context: AssistanceRuntimeFamilyWorkerExecutionContext): void {
	if (context.grant.familyId !== 'onnxruntime-node' || context.grant.task !== 'dereverberation'
		|| context.job.descriptor.familyId !== 'onnxruntime-node'
		|| context.job.descriptor.runtimeVersion !== '1.29.0'
		|| context.job.descriptor.executionProvider !== 'cpu') {
		throw new TypeError('The dereverberation adapter received a foreign authenticated CPU job.');
	}
}

function assertSettings(context: AssistanceRuntimeFamilyWorkerExecutionContext): void {
	const settings = context.settings;
	if (settings.schemaVersion !== 1 || settings.operation !== 'dereverberation'
		|| JSON.stringify(settings.inputRoles) !== '["audio"]'
		|| JSON.stringify(settings.outputRoles) !== '["enhanced-audio"]') {
		throw new TypeError('The dereverberation settings do not bind one exact audio workflow.');
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
		throw new TypeError('The dereverb-room ONNX inference session surface is invalid.');
	}
	return session;
}

function runtimeValue(value: unknown): AssistanceOnnxRuntimeModuleV1 {
	if (!value || typeof value !== 'object') {
		throw new TypeError('The dereverberation ONNX runtime is invalid.');
	}
	const candidate = value as Partial<AssistanceOnnxRuntimeModuleV1>;
	if (typeof candidate.Tensor !== 'function' || !candidate.InferenceSession
		|| typeof candidate.InferenceSession.create !== 'function') {
		throw new TypeError('The dereverberation ONNX runtime surface is invalid.');
	}
	return candidate as AssistanceOnnxRuntimeModuleV1;
}

function exactOutputs(
	value: Readonly<Record<string, AssistanceOnnxTensorV1>>,
): Readonly<Record<string, AssistanceOnnxTensorV1>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value)) !== JSON.stringify(DEREVERB_OUTPUT_NAMES)) {
		throw new TypeError('The dereverb-room result tensor inventory is invalid.');
	}
	return value;
}

function finiteFloatTensor(
	value: AssistanceOnnxTensorV1 | undefined,
	dims: readonly number[],
	label: string,
): Float32Array {
	if (!value || value.type !== 'float32' || !(value.data instanceof Float32Array)
		|| JSON.stringify(value.dims) !== JSON.stringify(dims)
		|| value.data.length !== dims.reduce((total, dimension) => total * dimension, 1)) {
		throw new RangeError(`${label} tensor geometry or element type is invalid.`);
	}
	for (const element of value.data) {
		if (!Number.isFinite(element)) {
			throw new RangeError(`${label} must contain only finite values.`);
		}
	}
	return value.data;
}

function assertExactNames(
	actual: readonly string[],
	expected: readonly string[],
	kind: string,
): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new TypeError(`The dereverb-room ONNX graph ${kind} signature is invalid.`);
	}
}
