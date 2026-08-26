/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { captureAssistanceRuntimeFamilyJobGrantV1 } from '../desktop/assistance-runtime-family-file-grants.ts';
import {
	createAssistanceOnnxRuntimeWorkerAdapterV1,
	type AssistanceOnnxRuntimeModuleV1,
} from '../desktop/assistance-onnx-runtime-worker.ts';
import {
	AssistanceRuntimeFamilyAdapterUnavailableError,
	runAssistanceRuntimeFamilyWorkerJobV1,
} from '../desktop/assistance-runtime-family-worker-entry.ts';
import {
	createAssistanceFramePackV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';

const JOB_ID = '1'.repeat(40);
const INPUT_ID = '2'.repeat(40);
const OUTPUT_ID = '3'.repeat(40);

function digest(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

function framePack(frameCount = 51, width = 48, sourceStart = 0): Uint8Array {
	return concatenate(createAssistanceFramePackV1({
		width, height: 27, timescale: 1_000,
		frames: Array.from({ length: frameCount }, (_, offset) => {
			const sourceFrame = sourceStart + offset;
			const rgba = new Uint8Array(width * 27 * 4);
			for (let offset = 0; offset < rgba.length; offset += 4) {
				rgba[offset] = sourceFrame;
				rgba[offset + 1] = 2;
				rgba[offset + 2] = 3;
				rgba[offset + 3] = 255;
			}
			return { sourceFrame, presentationTick: String(sourceFrame * 40), rgba };
		}),
	}));
}

async function fixture(context: TestContext, inputValue: Uint8Array | readonly Uint8Array[] = framePack()) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-transnet-ort-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const inputBytes = inputValue instanceof Uint8Array ? [inputValue] : inputValue;
	const inputs = inputBytes.map((_, index) => join(root, `frames-${String(index)}.pack`));
	const model = join(root, 'transnetv2.onnx');
	const output = join(root, 'shots.json');
	const modelBytes = Buffer.from('onnx-network');
	await Promise.all([
		...inputBytes.map((bytes, index) => writeFile(inputs[index]!, bytes)),
		writeFile(model, modelBytes),
		writeFile(output, new Uint8Array()),
	]);
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'shot-detection',
		settingsJson: JSON.stringify({ inputRoles: inputBytes.map(() => 'frame-pack'),
			operation: 'shot-detection',
			outputRoles: ['shot-boundaries'], schemaVersion: 1 }),
		inputs: inputBytes.map((bytes, index) => ({ claim: { claimVersion: 1,
			claimId: index === 0 ? INPUT_ID : String(index + 1).padStart(40, '0'), jobId: JOB_ID,
			role: 'frame-pack' as const, mediaType: 'application/vnd.soundscaper.frame-pack',
			byteLength: bytes.byteLength, sha256: digest(bytes) }, path: inputs[index]! })),
		models: [{ modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network',
			path: model, byteLength: modelBytes.byteLength, sha256: digest(modelBytes) }],
		outputs: [{ reservation: { claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
			role: 'shot-boundaries',
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
			maximumByteLength: 64 * 1024 }, path: output }],
	});
	return {
		job: Object.freeze({
			protocolVersion: 1 as const, jobId: JOB_ID,
			familyId: 'onnxruntime-node' as const, task: 'shot-detection' as const,
			maximumRssBytes: 8 * 1024 ** 3, maximumDurationMs: 60_000, grant,
			descriptor: Object.freeze({
				familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0',
				target: 'linux-x64' as const, executionProvider: 'cpu' as const,
				entrypoint: '/runtime/onnxruntime-node/index.js',
				files: Object.freeze([{ path: '/runtime/onnxruntime-node/index.js',
					relativePath: 'index.js', byteLength: 1, sha256: '4'.repeat(64),
					executable: false }]),
			}),
		}),
		paths: { output },
	};
}

test('the authenticated TransNetV2 worker runs exact CPU tensors and publishes canonical VFR shots', async (context) => {
	const value = await fixture(context);
	const seen: Array<Readonly<{ type: string; dims: readonly number[]; firstPixel: readonly number[] }>> = [];
	let released = 0;
	const runtime = fakeRuntime(async (feeds) => {
		const tensor = feeds.frames!;
		seen.push({ type: tensor.type, dims: tensor.dims,
			firstPixel: Array.from(tensor.data.subarray(0, 3)) });
		const single = new Float32Array(100).fill(-20);
		const all = new Float32Array(100).fill(-20);
		if (seen.length === 1) single[35] = 4;
		if (seen.length === 2) all[25] = 3;
		return { single_frame_logits: { type: 'float32', dims: [1, 100, 1], data: single },
			all_frame_logits: { type: 'float32', dims: [1, 100, 1], data: all } };
	}, () => { released += 1; });
	const progress: number[] = [];
	const result = await runAssistanceRuntimeFamilyWorkerJobV1({
		job: value.job, onProgress: (ratio) => progress.push(ratio),
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({
			loadRuntime: async (entrypoint) => {
				assert.equal(entrypoint, '/runtime/onnxruntime-node/index.js');
				return runtime;
			},
		}),
	});

	assert.equal(released, 1);
	assert.deepEqual(seen, [
		{ type: 'uint8', dims: [1, 100, 27, 48, 3], firstPixel: [0, 2, 3] },
		{ type: 'uint8', dims: [1, 100, 27, 48, 3], firstPixel: [25, 2, 3] },
	]);
	assert.equal(progress[0], 0);
	assert.equal(progress.at(-1), 1);
	assert.ok(progress.every((ratio, index) => index === 0 || ratio >= progress[index - 1]!));
	const body = JSON.parse(await readFile(value.paths.output, 'utf8')) as Record<string, unknown>;
	assert.deepEqual(body, {
		schemaVersion: 1, detector: 'transnetv2', timescale: 1_000, sourceFrameCount: 51,
		boundaries: [
			{ sourceFrame: 10, presentationTick: '400', score: Math.fround(1 / (1 + Math.exp(-4))) },
			{ sourceFrame: 50, presentationTick: '2000', score: Math.fround(1 / (1 + Math.exp(-3))) },
		],
	});
	assert.equal(result.outputs[0]!.sha256, digest(await readFile(value.paths.output)));
});

test('the TransNetV2 worker spans bounded packs and retains absolute source ordinals', async (context) => {
	const value = await fixture(context, [
		framePack(30, 48, 20), framePack(21, 48, 50),
	]);
	let batch = 0;
	const runtime = fakeRuntime(async () => {
		batch += 1;
		const single = new Float32Array(100).fill(-20);
		const all = new Float32Array(100).fill(-20);
		if (batch === 1) single[35] = 4;
		if (batch === 2) all[25] = 3;
		return {
			single_frame_logits: { type: 'float32', dims: [1, 100, 1], data: single },
			all_frame_logits: { type: 'float32', dims: [1, 100, 1], data: all },
		};
	});
	await runAssistanceRuntimeFamilyWorkerJobV1({
		job: value.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
	});
	const body = JSON.parse(await readFile(value.paths.output, 'utf8')) as Record<string, unknown>;
	assert.deepEqual(body, {
		schemaVersion: 1, detector: 'transnetv2', timescale: 1_000, sourceFrameCount: 71,
		boundaries: [
			{ sourceFrame: 30, presentationTick: '1200', score: Math.fround(1 / (1 + Math.exp(-4))) },
			{ sourceFrame: 70, presentationTick: '2800', score: Math.fround(1 / (1 + Math.exp(-3))) },
		],
	});
});

test('the TransNetV2 worker rejects unscaled frames and foreign graph signatures', async (context) => {
	const unscaled = await fixture(context, framePack(1, 47));
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: unscaled.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({
			loadRuntime: async () => fakeRuntime(async () => ({})),
		}),
	}), /48|geometry|frame-pack/iu);

	const valid = await fixture(context, framePack(1));
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: valid.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({
			loadRuntime: async () => fakeRuntime(async () => ({}), undefined,
				['pixels'], ['scores']),
		}),
	}), /graph|input|output/iu);
});

test('subject detection is admitted but fails closed at the reviewed ONNX adapter seam', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-subject-ort-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, 'frames.pack');
	const faceModel = join(root, 'yunet.onnx');
	const objectModel = join(root, 'dfine.onnx');
	const output = join(root, 'subjects.json');
	const inputBytes = framePack(1);
	const faceBytes = Buffer.from('yunet-network');
	const objectBytes = Buffer.from('dfine-network');
	await Promise.all([
		writeFile(input, inputBytes), writeFile(faceModel, faceBytes),
		writeFile(objectModel, objectBytes), writeFile(output, new Uint8Array()),
	]);
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'subject-detection',
		settingsJson: JSON.stringify({ inputRoles: ['frame-pack'], operation: 'subject-detection',
			outputRoles: ['subject-tracks'], schemaVersion: 1 }),
		inputs: [{ claim: { claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID,
			role: 'frame-pack', mediaType: 'application/vnd.soundscaper.frame-pack',
			byteLength: inputBytes.byteLength, sha256: digest(inputBytes) }, path: input }],
		models: [
			{ modelId: 'yunet-face-detection-2026may', version: '2026.5.0',
				artifactRole: 'face_detection_yunet_2026may', path: faceModel,
				byteLength: faceBytes.byteLength, sha256: digest(faceBytes) },
			{ modelId: 'dfine-nano-coco', version: '1.0.0', artifactRole: 'model',
				path: objectModel, byteLength: objectBytes.byteLength, sha256: digest(objectBytes) },
		],
		outputs: [{ reservation: { claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
			role: 'subject-tracks', mediaType: 'application/vnd.soundscaper.subject-tracks+json',
			maximumByteLength: 64 * 1024 }, path: output }],
	});
	let runtimeLoaded = false;
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: Object.freeze({
			protocolVersion: 1 as const, jobId: JOB_ID,
			familyId: 'onnxruntime-node' as const, task: 'subject-detection' as const,
			maximumRssBytes: 8 * 1024 ** 3, maximumDurationMs: 60_000, grant,
			descriptor: Object.freeze({
				familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0',
				target: 'linux-x64' as const, executionProvider: 'cpu' as const,
				entrypoint: '/runtime/onnxruntime-node/index.js',
				files: Object.freeze([{ path: '/runtime/onnxruntime-node/index.js',
					relativePath: 'index.js', byteLength: 1, sha256: '4'.repeat(64),
					executable: false }]),
			}),
		}),
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({
			loadRuntime: async () => {
				runtimeLoaded = true;
				return fakeRuntime(async () => ({}));
			},
		}),
	}), (error: unknown) => {
		assert.ok(error instanceof AssistanceRuntimeFamilyAdapterUnavailableError);
		assert.equal(error.code, 'ADAPTER_UNAVAILABLE');
		assert.match(error.message, /No reviewed model adapter/iu);
		return true;
	});
	assert.equal(runtimeLoaded, false);
});

function fakeRuntime(
	run: (feeds: Readonly<Record<string, TensorValue>>) => Promise<Readonly<Record<string, TensorValue>>>,
	release: (() => void) | undefined = undefined,
	inputNames: readonly string[] = ['frames'],
	outputNames: readonly string[] = ['single_frame_logits', 'all_frame_logits'],
): AssistanceOnnxRuntimeModuleV1 {
	class Tensor implements TensorValue {
		constructor(
			readonly type: 'uint8' | 'float32',
			readonly data: Uint8Array | Float32Array,
			readonly dims: readonly number[],
		) {}
	}
	return {
		Tensor,
		InferenceSession: {
			create: async (_path, options) => {
				assert.deepEqual(options.executionProviders, ['cpu']);
				return { inputNames, outputNames, run,
					release: async () => { release?.(); } };
			},
		},
	};
}

interface TensorValue {
	readonly type: 'uint8' | 'float32';
	readonly data: Uint8Array | Float32Array;
	readonly dims: readonly number[];
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	assert.ok(result.byteLength > 0);
	return result;
}
