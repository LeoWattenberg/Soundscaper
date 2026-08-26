/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';

import { captureAssistanceRuntimeFamilyJobGrantV1 } from
	'../desktop/assistance-runtime-family-file-grants.ts';
import type { AssistanceRuntimeFamilyTask } from
	'../desktop/assistance-runtime-family-job-contract.ts';
import {
	createAssistanceOnnxRuntimeWorkerAdapterV1,
	type AssistanceOnnxInferenceSessionV1,
	type AssistanceOnnxRuntimeModuleV1,
	type AssistanceOnnxTensorV1,
} from '../desktop/assistance-onnx-runtime-worker.ts';
import { runAssistanceRuntimeFamilyWorkerJobV1 } from
	'../desktop/assistance-runtime-family-worker-entry.ts';
import {
	createAssistanceFramePackV1,
	reviewAssistanceEmbeddingMatrixV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';
import {
	reviewAssistanceOcrResultV1,
	reviewAssistanceSaliencyResultV1,
	reviewAssistanceSubjectResultV1,
} from '../src/common/editor/assistance/visual-semantic-results-v1.ts';

const JOB_ID = '1'.repeat(40);
const INPUT_ID = '2'.repeat(40);
const OUTPUT_ID = '3'.repeat(40);

interface ArtifactFixture {
	readonly modelId: string;
	readonly version: string;
	readonly role: string;
	readonly body?: string;
}

interface WorkerFixtureOptions {
	readonly task: AssistanceRuntimeFamilyTask;
	readonly operation: string;
	readonly inputRole: 'frame-pack' | 'text';
	readonly inputMediaType: string;
	readonly inputBody: Uint8Array;
	readonly outputRole: 'embeddings' | 'recognized-text' | 'subject-tracks' | 'saliency-map';
	readonly outputMediaType: string;
	readonly artifacts: readonly ArtifactFixture[];
}

test('SigLIP2 embeds VFR-ordered frame packs with exact CPU graph tensors', async (context) => {
	const value = await fixture(context, {
		task: 'image-text-embedding', operation: 'image-text-embedding', inputRole: 'frame-pack',
		inputMediaType: 'application/vnd.soundscaper.frame-pack', inputBody: framePack(2),
		outputRole: 'embeddings',
		outputMediaType: 'application/vnd.soundscaper.embedding-matrix-v1',
		artifacts: siglipArtifacts(),
	});
	let seenInput: AssistanceOnnxTensorV1 | undefined;
	const runtime = fakeRuntime((path) => {
		assert.equal(basename(path), 'vision_model_int8.onnx');
		return session(['pixel_values'], ['last_hidden_state', 'pooler_output'], async (feeds) => {
			seenInput = feeds.pixel_values;
			const hidden = new Float32Array(2 * 196 * 768);
			const pooled = new Float32Array(2 * 768);
			pooled[0] = 1;
			pooled[769] = 1;
			return { last_hidden_state: tensor('float32', hidden, [2, 196, 768]),
				pooler_output: tensor('float32', pooled, [2, 768]) };
		});
	});
	await run(value, runtime);
	assert.deepEqual(seenInput?.dims, [2, 3, 224, 224]);
	assert.deepEqual(Array.from((seenInput?.data as Float32Array).subarray(0, 3)), [1, 1, 1]);
	const matrix = reviewAssistanceEmbeddingMatrixV1(await readFile(value.output));
	assert.equal(matrix.rowCount, 2);
	assert.equal(matrix.dimensions, 768);
	assert.equal(matrix.vector(0)[0], 1);
	assert.equal(matrix.vector(1)[1], 1);
});

test('SigLIP2 executes its pinned byte-fallback BPE and text-only graph signature', async (context) => {
	const tokenizer = JSON.stringify(tokenizerFixture());
	const value = await fixture(context, {
		task: 'image-text-embedding', operation: 'image-text-embedding', inputRole: 'text',
		inputMediaType: 'text/plain', inputBody: Buffer.from('ab cd'), outputRole: 'embeddings',
		outputMediaType: 'application/vnd.soundscaper.embedding-matrix-v1',
		artifacts: siglipArtifacts(tokenizer),
	});
	let ids: readonly bigint[] = [];
	const runtime = fakeRuntime((path) => {
		assert.equal(basename(path), 'text_model_int8.onnx');
		return session(['input_ids'], ['last_hidden_state', 'pooler_output'], async (feeds) => {
			assert.deepEqual(Object.keys(feeds), ['input_ids']);
			ids = Array.from(feeds.input_ids!.data as BigInt64Array).slice(0, 6);
			const pooled = new Float32Array(768);
			pooled[2] = 2;
			return { last_hidden_state: tensor('float32', new Float32Array(64 * 768), [1, 64, 768]),
				pooler_output: tensor('float32', pooled, [1, 768]) };
		});
	});
	await run(value, runtime);
	assert.deepEqual(ids, [7n, 12n, 1n, 0n, 0n, 0n]);
	assert.equal(reviewAssistanceEmbeddingMatrixV1(await readFile(value.output)).vector(0)[2], 1);
});

test('U2-Net-P retains sampled source/tick authority and emits bounded saliency', async (context) => {
	const value = await fixture(context, {
		task: 'saliency-detection', operation: 'saliency-detection', inputRole: 'frame-pack',
		inputMediaType: 'application/vnd.soundscaper.frame-pack', inputBody: framePack(1),
		outputRole: 'saliency-map',
		outputMediaType: 'application/vnd.soundscaper.saliency-map+json',
		artifacts: [{ modelId: 'u2netp-saliency', version: '1.0.0', role: 'u2netp' }],
	});
	const names = ['1959', '1960', '1961', '1962', '1963', '1964', '1965'];
	const runtime = fakeRuntime(() => session(['input.1'], names, async (feeds) => {
		assert.deepEqual(feeds['input.1']?.dims, [1, 3, 320, 320]);
		const result: Record<string, AssistanceOnnxTensorV1> = {};
		for (const name of names) result[name] = tensor('float32', new Float32Array(320 * 320),
			[1, 1, 320, 320]);
		const primary = result['1959']!.data as Float32Array;
		for (let y = 140; y < 180; y += 1) {
			for (let x = 220; x < 260; x += 1) primary[y * 320 + x] = 1;
		}
		return result;
	}));
	await run(value, runtime);
	const result = reviewAssistanceSaliencyResultV1(
		JSON.parse(await readFile(value.output, 'utf8')) as unknown, authority(2, 1, 1),
	);
	assert.deepEqual(result.frames[0].sourceFrame, 7);
	assert.deepEqual(result.frames[0].presentationTick, '100');
	assert.ok(result.frames[0].saliency.x > 0.7 && result.frames[0].saliency.x < 0.8);
	assert.ok(result.frames[0].saliency.y > 0.45 && result.frames[0].saliency.y < 0.55);
});

test('visual workers reject graph substitution before publishing reserved output', async (context) => {
	const value = await fixture(context, {
		task: 'saliency-detection', operation: 'saliency-detection', inputRole: 'frame-pack',
		inputMediaType: 'application/vnd.soundscaper.frame-pack', inputBody: framePack(1),
		outputRole: 'saliency-map', outputMediaType: 'application/json',
		artifacts: [{ modelId: 'u2netp-saliency', version: '1.0.0', role: 'u2netp' }],
	});
	await assert.rejects(run(value, fakeRuntime(() => session(
		['pixels'], ['saliency'], async () => ({}),
	))), /graph|signature|input|output/iu);
	assert.equal((await readFile(value.output)).byteLength, 0);
});

test('composite YuNet and D-FINE publish non-biometric face/person detections', async (context) => {
	const labels = Object.fromEntries(Array.from({ length: 80 }, (_, index) =>
		[String(index), index === 0 ? 'person' : `class-${String(index)}`]));
	const value = await fixture(context, {
		task: 'subject-detection', operation: 'subject-detection', inputRole: 'frame-pack',
		inputMediaType: 'application/vnd.soundscaper.frame-pack', inputBody: framePack(1),
		outputRole: 'subject-tracks',
		outputMediaType: 'application/json',
		artifacts: [
			{ modelId: 'yunet-face-detection-2026may', version: '2026.5.0',
				role: 'face_detection_yunet_2026may' },
			{ modelId: 'dfine-nano-coco', version: '1.0.0', role: 'model' },
			{ modelId: 'dfine-nano-coco', version: '1.0.0', role: 'config',
				body: JSON.stringify({ model_type: 'd_fine', num_queries: 300, id2label: labels }) },
			{ modelId: 'dfine-nano-coco', version: '1.0.0', role: 'preprocessor_config',
				body: JSON.stringify({ do_resize: true, do_rescale: true, do_normalize: false,
					do_pad: false, rescale_factor: 1 / 255, size: { width: 640, height: 640 } }) },
		],
	});
	const runtime = fakeRuntime((path) => basename(path).startsWith('face_detection')
		? yunetSession() : dfineSession());
	await run(value, runtime);
	const result = reviewAssistanceSubjectResultV1(
		JSON.parse(await readFile(value.output, 'utf8')) as unknown, authority(2, 1, 1),
	);
	assert.deepEqual(result.frames[0]!.subjects.map((subject) =>
		[subject.kind, subject.classId, subject.label]), [
		['face', null, 'face'], ['person', 0, 'person'],
	]);
});

test('PP-OCRv4 executes detection, orientation, and CTC recognition with one model grant',
	async (context) => {
		const dictionary = ['A', ...Array.from({ length: 6_622 }, (_, index) => `x${String(index)}`)]
			.join('\n') + '\n';
		const value = await fixture(context, {
			task: 'optical-character-recognition', operation: 'optical-character-recognition',
			inputRole: 'frame-pack', inputMediaType: 'application/vnd.soundscaper.frame-pack',
			inputBody: framePack(1, 64, 32), outputRole: 'recognized-text',
			outputMediaType: 'application/vnd.soundscaper.recognized-text+json',
			artifacts: [
				{ modelId: 'ppocr-v4-mobile', version: '4.0.0', role: 'text_detection' },
				{ modelId: 'ppocr-v4-mobile', version: '4.0.0', role: 'text_recognition' },
				{ modelId: 'ppocr-v4-mobile', version: '4.0.0', role: 'text_orientation' },
				{ modelId: 'ppocr-v4-mobile', version: '4.0.0', role: 'character_dictionary',
					body: dictionary },
			],
		});
		const runtime = fakeRuntime((path) => ocrSession(basename(path)));
		await run(value, runtime);
			const result = reviewAssistanceOcrResultV1(
				JSON.parse(await readFile(value.output, 'utf8')) as unknown, authority(64, 32, 1),
			);
		assert.equal(result.frames[0].sourceFrame, 7);
		assert.equal(result.frames[0].presentationTick, '100');
		assert.equal(result.frames[0].regions.length, 1);
		assert.equal(result.frames[0].regions[0].text, 'A');
		assert.ok(result.frames[0].regions[0].confidence > 0.8);
	});

async function fixture(context: TestContext, options: WorkerFixtureOptions) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-visual-onnx-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, options.inputRole === 'text' ? 'query.txt' : 'frames.pack');
	const output = join(root, 'result.bin');
	await Promise.all([writeFile(input, options.inputBody), writeFile(output, new Uint8Array())]);
	const models = [];
	for (const [index, artifact] of options.artifacts.entries()) {
		const path = join(root, `${artifact.role}${artifact.role.includes('model') ? '.onnx' : '.bin'}`);
		const body = Buffer.from(artifact.body ?? `model-${String(index)}`);
		await writeFile(path, body);
		models.push({ modelId: artifact.modelId, version: artifact.version,
			artifactRole: artifact.role, path, byteLength: body.byteLength, sha256: digest(body) });
	}
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({ jobId: JOB_ID,
		familyId: 'onnxruntime-node', task: options.task,
		settingsJson: JSON.stringify({ schemaVersion: 1, operation: options.operation,
			inputRoles: [options.inputRole], outputRoles: [options.outputRole] }),
		inputs: [{ claim: { claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID,
			role: options.inputRole, mediaType: options.inputMediaType,
			byteLength: options.inputBody.byteLength, sha256: digest(options.inputBody) }, path: input }],
		models,
		outputs: [{ reservation: { claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
			role: options.outputRole, mediaType: options.outputMediaType,
			maximumByteLength: 4 * 1024 * 1024 }, path: output }],
	});
	return { output, job: Object.freeze({ protocolVersion: 1 as const, jobId: JOB_ID,
		familyId: 'onnxruntime-node' as const, task: options.task,
		maximumRssBytes: 8 * 1024 ** 3, maximumDurationMs: 60_000, grant,
		descriptor: Object.freeze({ familyId: 'onnxruntime-node' as const,
			runtimeVersion: '1.29.0', target: 'linux-x64' as const,
			executionProvider: 'cpu' as const, entrypoint: '/runtime/onnxruntime-node/index.js',
			files: Object.freeze([{ path: '/runtime/onnxruntime-node/index.js', relativePath: 'index.js',
				byteLength: 1, sha256: '4'.repeat(64), executable: false }]) }) }) };
}

async function run(value: Awaited<ReturnType<typeof fixture>>, runtime: AssistanceOnnxRuntimeModuleV1) {
	return runAssistanceRuntimeFamilyWorkerJobV1({ job: value.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }) });
}

function framePack(count: number, width = 2, height = 1): Uint8Array {
	return Buffer.concat(createAssistanceFramePackV1({ width, height, timescale: 1_000,
		frames: Array.from({ length: count }, (_, index) => ({ sourceFrame: 7 + index * 2,
			presentationTick: String(100 + index * 150),
			rgba: rgba(width, height, index === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]) })) }));
}

function authority(width: number, height: number, count: number) {
	return { width, height, timescale: 1_000,
		frames: Array.from({ length: count }, (_, index) => ({ sourceFrame: 7 + index * 2,
			presentationTick: String(100 + index * 150) })) };
}

function rgba(width: number, height: number, pixel: readonly number[]): Uint8Array {
	const result = new Uint8Array(width * height * 4);
	for (let offset = 0; offset < result.length; offset += 4) result.set(pixel, offset);
	return result;
}

function siglipArtifacts(tokenizer = JSON.stringify(tokenizerFixture())): readonly ArtifactFixture[] {
	return [
		{ modelId: 'siglip2-base-patch16-224', version: '2.0.0', role: 'vision_model_int8' },
		{ modelId: 'siglip2-base-patch16-224', version: '2.0.0', role: 'text_model_int8' },
		{ modelId: 'siglip2-base-patch16-224', version: '2.0.0', role: 'tokenizer', body: tokenizer },
		{ modelId: 'siglip2-base-patch16-224', version: '2.0.0', role: 'config' },
		{ modelId: 'siglip2-base-patch16-224', version: '2.0.0', role: 'preprocessor_config' },
	];
}

function tokenizerFixture() {
	return { version: '1.0', truncation: null,
		padding: { strategy: { Fixed: 64 }, direction: 'Right', pad_id: 0, pad_token: '<pad>' },
		normalizer: { type: 'Replace', pattern: { String: ' ' }, content: '▁' },
		pre_tokenizer: { type: 'Split', pattern: { String: ' ' }, behavior: 'MergedWithPrevious',
			invert: false },
		post_processor: { type: 'TemplateProcessing', single: [
			{ Sequence: { id: 'A' } }, { SpecialToken: { id: '<eos>' } },
		] },
		model: { type: 'BPE', dropout: null, unk_token: '<unk>', continuing_subword_prefix: null,
			end_of_word_suffix: null, fuse_unk: true, byte_fallback: true, ignore_merges: false,
			vocab: { '<pad>': 0, '<eos>': 1, '<bos>': 2, '<unk>': 3, '<mask>': 4,
				a: 5, b: 6, ab: 7, '▁': 8, c: 9, d: 10, '▁c': 11, '▁cd': 12 },
			merges: [['a', 'b'], ['▁', 'c'], ['▁c', 'd']] } };
}

function yunetSession(): AssistanceOnnxInferenceSessionV1 {
	const outputs = ['cls_8', 'cls_16', 'cls_32', 'obj_8', 'obj_16', 'obj_32',
		'bbox_8', 'bbox_16', 'bbox_32', 'kps_8', 'kps_16', 'kps_32'];
	return session(['input'], outputs, async () => {
		const result: Record<string, AssistanceOnnxTensorV1> = {};
		for (const stride of [8, 16, 32]) {
			const rows = (640 / stride) ** 2;
			const cls = new Float32Array(rows);
			const objectness = new Float32Array(rows);
			if (stride === 8) { cls[40 * 80 + 40] = 1; objectness[40 * 80 + 40] = 1; }
			result[`cls_${String(stride)}`] = tensor('float32', cls, [1, rows, 1]);
			result[`obj_${String(stride)}`] = tensor('float32', objectness, [1, rows, 1]);
			result[`bbox_${String(stride)}`] = tensor('float32', new Float32Array(rows * 4),
				[1, rows, 4]);
			result[`kps_${String(stride)}`] = tensor('float32', new Float32Array(rows * 10),
				[1, rows, 10]);
		}
		return result;
	});
}

function dfineSession(): AssistanceOnnxInferenceSessionV1 {
	return session(['pixel_values'], ['logits', 'pred_boxes'], async () => {
		const logits = new Float32Array(300 * 80).fill(-20);
		logits[0] = 4;
		const boxes = new Float32Array(300 * 4);
		boxes.set([0.5, 0.5, 0.4, 0.8]);
		return { logits: tensor('float32', logits, [1, 300, 80]),
			pred_boxes: tensor('float32', boxes, [1, 300, 4]) };
	});
}

function ocrSession(name: string): AssistanceOnnxInferenceSessionV1 {
	if (name.startsWith('text_detection')) return session(['x'], ['sigmoid_0.tmp_0'], async () => {
		const map = new Float32Array(64 * 32);
		for (let y = 10; y < 20; y += 1) for (let x = 10; x < 30; x += 1) map[y * 64 + x] = 0.9;
		return { 'sigmoid_0.tmp_0': tensor('float32', map, [1, 1, 32, 64]) };
	});
	if (name.startsWith('text_orientation')) {
		return session(['x'], ['save_infer_model/scale_0.tmp_1'], async () => ({
			'save_infer_model/scale_0.tmp_1': tensor('float32', Float32Array.of(0.95, 0.05), [1, 2]),
		}));
	}
	return session(['x'], ['softmax_11.tmp_0'], async () => {
		const scores = new Float32Array(2 * 6_625);
		scores[1] = 0.9;
		scores[6_625] = 0.9;
		return { 'softmax_11.tmp_0': tensor('float32', scores, [1, 2, 6_625]) };
	});
}

function fakeRuntime(
	create: (path: string) => AssistanceOnnxInferenceSessionV1,
): AssistanceOnnxRuntimeModuleV1 {
	class Tensor implements AssistanceOnnxTensorV1 {
		constructor(readonly type: 'uint8' | 'float32' | 'int64',
			readonly data: Uint8Array | Float32Array | BigInt64Array,
			readonly dims: readonly number[]) {}
	}
	return { Tensor, InferenceSession: { create: async (path, options) => {
		assert.deepEqual(options.executionProviders, ['cpu']);
		return create(path);
	} } };
}

function session(
	inputNames: readonly string[],
	outputNames: readonly string[],
	run: AssistanceOnnxInferenceSessionV1['run'],
): AssistanceOnnxInferenceSessionV1 {
	return { inputNames, outputNames, run };
}

function tensor(
	type: 'uint8' | 'float32' | 'int64',
	data: Uint8Array | Float32Array | BigInt64Array,
	dims: readonly number[],
): AssistanceOnnxTensorV1 {
	return { type, data, dims };
}

function digest(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}
