/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	assertAssistanceWav2Vec2EnglishAlignmentModelBindingV1,
} from '../desktop/assistance-operation-family-execution.ts';
import {
	createAssistanceOnnxRuntimeWorkerAdapterV1,
	type AssistanceOnnxRuntimeModuleV1,
} from '../desktop/assistance-onnx-runtime-worker.ts';
import { captureAssistanceRuntimeFamilyJobGrantV1 } from
	'../desktop/assistance-runtime-family-file-grants.ts';
import { runAssistanceRuntimeFamilyWorkerJobV1 } from
	'../desktop/assistance-runtime-family-worker-entry.ts';
import {
	ASSISTANCE_WAV2VEC2_BASE_960H_VOCABULARY_V1,
	splitAssistanceWav2Vec2EnglishSegmentWordsV1,
	tokenizeAssistanceWav2Vec2EnglishWordV1,
} from '../src/common/editor/assistance/wav2vec2-english-tokenizer-v1.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const JOB_ID = '1'.repeat(40);
const AUDIO_ID = '2'.repeat(40);
const TRANSCRIPT_ID = '3'.repeat(40);
const OUTPUT_ID = '4'.repeat(40);
const PINNED_MODEL_SHA256 =
	'b73fe60ddcd3fd07f91d65d50b4f10ba99039104c4fb5db5bdafbb27610bb6eb';

function digest(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

function samples(length = 2_000): Float32Array {
	return Float32Array.from({ length }, (_unused, index) => ((index % 17) - 8) / 8);
}

function rawTranscript() {
	return Object.freeze({ language: 'en', segments: Object.freeze([
		Object.freeze({ startSeconds: 0.02, endSeconds: 0.105, text: 'A B' }),
	]) });
}

async function fixture(
	context: TestContext,
	options: Readonly<{
		modelId?: string;
		transcript?: unknown;
		samples?: Float32Array;
	}> = {},
) {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-wav2vec2-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const audioBytes = encodeWav([options.samples ?? samples()], {
		sampleRate: 16_000, bitDepth: 32, float: true, dither: false,
	});
	const transcriptBytes = Buffer.from(JSON.stringify(options.transcript ?? rawTranscript()), 'utf8');
	const modelBytes = Buffer.from('pinned-onnx-network');
	const paths = Object.freeze({
		audio: join(directory, 'audio.wav'),
		transcript: join(directory, 'transcript.json'),
		model: join(directory, 'model.onnx'),
		output: join(directory, 'alignment.json'),
	});
	await Promise.all([
		writeFile(paths.audio, audioBytes), writeFile(paths.transcript, transcriptBytes),
		writeFile(paths.model, modelBytes), writeFile(paths.output, new Uint8Array()),
	]);
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'word-alignment',
		settingsJson: JSON.stringify({ schemaVersion: 1, operation: 'word-alignment',
			inputRoles: ['audio', 'transcript'], outputRoles: ['word-alignment'] }),
		inputs: [
			{ claim: { claimVersion: 1, claimId: AUDIO_ID, jobId: JOB_ID, role: 'audio',
				mediaType: 'audio/wav', byteLength: audioBytes.byteLength,
				sha256: digest(audioBytes) }, path: paths.audio },
			{ claim: { claimVersion: 1, claimId: TRANSCRIPT_ID, jobId: JOB_ID,
				role: 'transcript', mediaType: 'application/vnd.soundscaper.transcript+json',
				byteLength: transcriptBytes.byteLength,
				sha256: digest(transcriptBytes) }, path: paths.transcript },
		],
		models: [{ modelId: options.modelId ?? 'wav2vec2-base-960h', version: '1.0.0',
			artifactRole: 'model', path: paths.model, byteLength: modelBytes.byteLength,
			sha256: digest(modelBytes) }],
		outputs: [{ reservation: { claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
			role: 'word-alignment',
			mediaType: 'application/vnd.soundscaper.word-alignment+json',
			maximumByteLength: 64 * 1024 }, path: paths.output }],
	});
	return Object.freeze({
		job: Object.freeze({
			protocolVersion: 1 as const, jobId: JOB_ID,
			familyId: 'onnxruntime-node' as const, task: 'word-alignment' as const,
			maximumRssBytes: 8 * 1024 ** 3, maximumDurationMs: 60_000, grant,
			descriptor: Object.freeze({
				familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0',
				target: 'linux-x64' as const, executionProvider: 'cpu' as const,
				entrypoint: '/runtime/onnxruntime-node/index.js',
				files: Object.freeze([{ path: '/runtime/onnxruntime-node/index.js',
					relativePath: 'index.js', byteLength: 1, sha256: '5'.repeat(64),
					executable: false }]),
			}),
		}),
		paths,
	});
}

test('the owned English tokenizer pins all 32 IDs and preserves transcript word identity', () => {
	assert.deepEqual(ASSISTANCE_WAV2VEC2_BASE_960H_VOCABULARY_V1, [
		'<pad>', '<s>', '</s>', '<unk>', '|', 'E', 'T', 'A', 'O', 'N', 'I', 'H', 'S',
		'R', 'D', 'L', 'U', 'M', 'W', 'C', 'F', 'G', 'Y', 'P', 'B', 'V', 'K', "'",
		'X', 'J', 'Q', 'Z',
	]);
	assert.deepEqual(splitAssistanceWav2Vec2EnglishSegmentWordsV1(
		"  Caf\u00e9\u2019s\tHELLO,\nworld!  ",
	), ["Caf\u00e9\u2019s", 'HELLO,', 'world!']);
	assert.deepEqual(tokenizeAssistanceWav2Vec2EnglishWordV1("Caf\u00e9\u2019s"),
		[19, 7, 20, 5, 27, 12]);
	assert.deepEqual(tokenizeAssistanceWav2Vec2EnglishWordV1('HELLO,'), [11, 5, 15, 15, 8]);
	assert.deepEqual(tokenizeAssistanceWav2Vec2EnglishWordV1('2026'), [3]);
	assert.throws(() => splitAssistanceWav2Vec2EnglishSegmentWordsV1('   '), /word|text/iu);
});

test('wav2vec2 normalizes each segment, runs the exact CPU graph, and publishes CTC words',
	async (context) => {
		const value = await fixture(context);
		let released = 0;
		const seen: Array<Readonly<{ dims: readonly number[]; mean: number; variance: number }>> = [];
		const runtime = fakeRuntime(['input_values'], ['logits'], async (feeds) => {
			const input = feeds.input_values!;
			const values = input.data as Float32Array;
			const mean = values.reduce((total, candidate) => total + candidate, 0) / values.length;
			const variance = values.reduce(
				(total, candidate) => total + (candidate - mean) ** 2, 0,
			) / values.length;
			seen.push(Object.freeze({ dims: input.dims, mean, variance }));
			const logits = new Float32Array(4 * 32).fill(-10);
			for (const [frame, token] of [[0, 0], [1, 7], [2, 24], [3, 0]] as const) {
				logits[frame * 32 + token] = 0;
			}
			return Object.freeze({ logits: tensor(logits, [1, 4, 32]) });
		}, () => { released += 1; });
		const progress: number[] = [];
		await runAssistanceRuntimeFamilyWorkerJobV1({
			job: value.job, onProgress: (ratio) => progress.push(ratio),
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
		});

		assert.equal(seen.length, 1);
		assert.deepEqual(seen[0]!.dims, [1, 1_360]);
		assert.ok(Math.abs(seen[0]!.mean) < 1e-6);
		assert.ok(Math.abs(seen[0]!.variance - 1) < 1e-5);
		const result = JSON.parse(await readFile(value.paths.output, 'utf8')) as {
			words: Array<{ text: string; startSample: number; endSample: number;
				confidence: number | null }>;
		};
		assert.deepEqual(result.words.map(({ text, startSample, endSample }) =>
			[text, startSample, endSample]), [
			['A', 640, 960], ['B', 960, 1_280],
		]);
		assert.ok(result.words.every(({ confidence }) => confidence !== null && confidence > 0.99));
		assert.deepEqual(progress, [0, 0.5, 1]);
		assert.equal(released, 1);
	});

test('wav2vec2 chunks a long selection by exact ordered Whisper segment authority',
	async (context) => {
		const transcript = { language: 'en', segments: [
			{ startSeconds: 0.02, endSeconds: 0.105, text: 'A' },
			{ startSeconds: 0.15, endSeconds: 0.235, text: 'B' },
		] };
		const value = await fixture(context, { transcript, samples: samples(4_000) });
		const seen: number[] = [];
		const runtime = fakeRuntime(['input_values'], ['logits'], async (feeds) => {
			seen.push(feeds.input_values!.dims[1]!);
			const logits = new Float32Array(4 * 32).fill(-10);
			const token = seen.length === 1 ? 7 : 24;
			for (const [frame, tokenId] of [[0, 0], [1, token], [2, 0], [3, 0]] as const) {
				logits[frame * 32 + tokenId] = 0;
			}
			return { logits: tensor(logits, [1, 4, 32]) };
		});
		const progress: number[] = [];
		await runAssistanceRuntimeFamilyWorkerJobV1({
			job: value.job, onProgress: (ratio) => progress.push(ratio),
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
		});
		assert.deepEqual(seen, [1_360, 1_360]);
		const result = JSON.parse(await readFile(value.paths.output, 'utf8')) as {
			words: Array<{ text: string; startSample: number; endSample: number }>;
		};
		assert.deepEqual(result.words.map(({ text, startSample, endSample }) =>
			[text, startSample, endSample]), [
			['A', 640, 960], ['B', 2_720, 3_040],
		]);
		assert.deepEqual(progress, [0, 1 / 3, 2 / 3, 1]);
	});

test('wav2vec2 rejects substitutions, foreign graphs, and bad logits',
	async (context) => {
		const substituted = await fixture(context, { modelId: 'substitute-aligner' });
		let loaded = false;
		await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
			job: substituted.job,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => {
				loaded = true;
				return fakeRuntime([], [], async () => ({}));
			} }),
		}), /wav2vec2|model|exact/iu);
		assert.equal(loaded, false);

		const foreign = await fixture(context);
		await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
			job: foreign.job,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () =>
				fakeRuntime(['attention_mask'], ['scores'], async () => ({})) }),
		}), /graph|input|output|signature/iu);

		const french = await fixture(context, { transcript: { ...rawTranscript(), language: 'fr' } });
		let alignmentLoaded = false;
		await runAssistanceRuntimeFamilyWorkerJobV1({
			job: french.job,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => {
				alignmentLoaded = true;
				return fakeRuntime([], [], async () => ({}));
			} }),
		});
		assert.equal(alignmentLoaded, false);
		assert.deepEqual(JSON.parse(await readFile(french.paths.output, 'utf8')), {
			sampleRate: 16_000, schemaVersion: 1, words: [],
		});

		const malformed = await fixture(context);
		await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
			job: malformed.job,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () =>
				fakeRuntime(['input_values'], ['logits'], async () => ({
					logits: tensor(Float32Array.of(Number.NaN, ...new Float32Array(4 * 32 - 1)),
						[1, 4, 32]),
			})) }),
		}), /finite|logit|tensor/iu);

		const overlong = await fixture(context, {
			samples: samples(61 * 16_000 + 1),
			transcript: { language: 'en', segments: [
				{ startSeconds: 0, endSeconds: 61, text: 'too long' },
			] },
		});
		loaded = false;
		await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
			job: overlong.job,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => {
				loaded = true;
				return fakeRuntime([], [], async () => ({}));
			} }),
		}), /60 seconds|segment|bound/iu);
		assert.equal(loaded, false);
	});

test('wav2vec2 cancellation is observed immediately after native inference', async (context) => {
	const value = await fixture(context);
	const controller = new AbortController();
	let calls = 0;
	const runtime = fakeRuntime(['input_values'], ['logits'], async () => {
		calls += 1;
		controller.abort(new DOMException('cancelled', 'AbortError'));
		return { logits: tensor(new Float32Array(4 * 32), [1, 4, 32]) };
	});
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: value.job, signal: controller.signal,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
	}), { name: 'AbortError' });
	assert.equal(calls, 1);
	assert.equal((await readFile(value.paths.output)).byteLength, 0);
});

test('main closes wav2vec2 substitution against the existing revision artifact pin', () => {
	assert.doesNotThrow(() => assertAssistanceWav2Vec2EnglishAlignmentModelBindingV1({
		modelId: 'wav2vec2-base-960h', version: '1.0.0',
		artifactSha256s: [PINNED_MODEL_SHA256],
	}));
	assert.throws(() => assertAssistanceWav2Vec2EnglishAlignmentModelBindingV1({
		modelId: 'other-aligner', version: '1.0.0', artifactSha256s: [PINNED_MODEL_SHA256],
	}), /wav2vec2|exact|identity/iu);
	assert.throws(() => assertAssistanceWav2Vec2EnglishAlignmentModelBindingV1({
		modelId: 'wav2vec2-base-960h', version: '1.0.0', artifactSha256s: ['a'.repeat(64)],
	}), /digest|revision|identity/iu);
});

function tensor(data: Float32Array, dims: readonly number[]): TensorValue {
	return Object.freeze({ type: 'float32', data, dims: Object.freeze([...dims]) });
}

function fakeRuntime(
	inputNames: readonly string[],
	outputNames: readonly string[],
	run: (feeds: Readonly<Record<string, TensorValue>>) =>
		Promise<Readonly<Record<string, TensorValue>>>,
	release: () => void = () => undefined,
): AssistanceOnnxRuntimeModuleV1 {
	class Tensor implements TensorValue {
		constructor(
			readonly type: 'uint8' | 'float32' | 'int64',
			readonly data: Uint8Array | Float32Array | BigInt64Array,
			readonly dims: readonly number[],
		) {}
	}
	return Object.freeze({
		Tensor,
		InferenceSession: Object.freeze({ create: async (_path: string, options: {
			executionProviders: readonly string[];
		}) => {
			assert.deepEqual(options.executionProviders, ['cpu']);
			return Object.freeze({ inputNames, outputNames, run, release });
		} }),
	});
}

interface TensorValue {
	readonly type: string;
	readonly data: Uint8Array | Float32Array | BigInt64Array;
	readonly dims: readonly number[];
}
