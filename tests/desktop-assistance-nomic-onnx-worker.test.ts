/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	assertAssistanceOnnxTextEmbeddingModelBindingV1,
} from '../desktop/assistance-operation-family-execution.ts';
import {
	createAssistanceOnnxRuntimeWorkerAdapterV1,
	type AssistanceOnnxRuntimeModuleV1,
} from '../desktop/assistance-onnx-runtime-worker.ts';
import { captureAssistanceRuntimeFamilyJobGrantV1 } from '../desktop/assistance-runtime-family-file-grants.ts';
import { runAssistanceRuntimeFamilyWorkerJobV1 } from '../desktop/assistance-runtime-family-worker-entry.ts';
import { reviewAssistanceEmbeddingMatrixV1 } from '../src/common/editor/assistance/binary-formats-v1.ts';
import { createAssistanceTranscript } from '../src/common/editor/assistance/transcript.ts';
import { nomicTokenizerArtifactFixture } from './assistance-nomic-tokenizer-fixture.ts';

const JOB_ID = '1'.repeat(40);
const INPUT_ID = '2'.repeat(40);
const OUTPUT_ID = '3'.repeat(40);
const UTF8 = new TextEncoder();

type InputKind = 'transcript' | 'query';

function digest(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

async function fixture(
	context: TestContext,
	kind: InputKind,
	inputText: string,
	overrides: Readonly<{ modelId?: string; version?: string; tokenizer?: Uint8Array }> = {},
) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-nomic-onnx-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const artifacts = { ...nomicTokenizerArtifactFixture(),
		...(overrides.tokenizer ? { tokenizer: overrides.tokenizer } : {}) };
	const values = Object.freeze({
		model_quantized: UTF8.encode('onnx-network'), tokenizer: artifacts.tokenizer,
		tokenizer_config: artifacts.tokenizerConfig,
		special_tokens_map: artifacts.specialTokensMap, config: artifacts.config,
	});
	const paths = Object.fromEntries(Object.keys(values).map((role) => [role,
		join(root, `${role}${role === 'model_quantized' ? '.onnx' : '.json'}`)]));
	const inputBytes = UTF8.encode(inputText);
	const input = join(root, kind === 'transcript' ? 'transcript.json' : 'query.txt');
	const output = join(root, 'embeddings.bin');
	await Promise.all([
		writeFile(input, inputBytes), writeFile(output, new Uint8Array()),
		...Object.entries(values).map(([role, bytes]) => writeFile(paths[role]!, bytes)),
	]);
	const modelId = overrides.modelId ?? 'nomic-embed-text-v1.5';
	const version = overrides.version ?? '1.5.0';
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'text-embedding',
		settingsJson: JSON.stringify({ inputRoles: [kind === 'transcript' ? 'transcript' : 'text'],
			operation: 'text-embedding', outputRoles: ['embeddings'], schemaVersion: 1 }),
		inputs: [{ claim: { claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID,
			role: kind === 'transcript' ? 'transcript' as const : 'text' as const,
			mediaType: kind === 'transcript'
				? 'application/vnd.soundscaper.transcript+json' : 'text/plain',
			byteLength: inputBytes.byteLength, sha256: digest(inputBytes) }, path: input }],
		models: Object.entries(values).map(([artifactRole, bytes]) => ({
			modelId, version, artifactRole, path: paths[artifactRole]!,
			byteLength: bytes.byteLength, sha256: digest(bytes),
		})),
		outputs: [{ reservation: { claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
			role: 'embeddings', mediaType: 'application/vnd.soundscaper.embedding-matrix-v1',
			maximumByteLength: 8 * 1024 * 1024 }, path: output }],
	});
	return Object.freeze({
		job: Object.freeze({
			protocolVersion: 1 as const, jobId: JOB_ID,
			familyId: 'onnxruntime-node' as const, task: 'text-embedding' as const,
			maximumRssBytes: 8 * 1024 ** 3, maximumDurationMs: 60_000, grant,
			descriptor: Object.freeze({
				familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0',
				target: 'linux-x64' as const, executionProvider: 'cpu' as const,
				entrypoint: '/runtime/onnxruntime-node/index.js',
				files: Object.freeze([{ path: '/runtime/onnxruntime-node/index.js',
					relativePath: 'index.js', byteLength: 1, sha256: '4'.repeat(64), executable: false }]),
			}),
		}), output,
	});
}

function transcript(text: string): string {
	return JSON.stringify(createAssistanceTranscript({
		sourceId: 'source-a', sampleRate: 48_000, modelId: 'whisper-large-v3-turbo',
		segments: [{ startFrame: 0, endFrame: 48_000, text }],
	}));
}

test('nomic transcript embedding tokenizes the document prefix and publishes normalized Float32 rows',
	async (context) => {
		const value = await fixture(context, 'transcript', transcript('Hello world'));
		const seen: Array<Readonly<Record<string, unknown>>> = [];
		const runtime = fakeRuntime(async (feeds) => {
			seen.push(snapshotFeeds(feeds));
			return hiddenState(feeds.input_ids!.dims[0]!, feeds.input_ids!.dims[1]!);
		});
		await runAssistanceRuntimeFamilyWorkerJobV1({
			job: value.job,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
		});

		assert.deepEqual(seen, [{
			inputIds: [101n, 3945n, 1035n, 6254n, 1024n, 7592n, 2088n, 102n],
			attentionMask: new Array<bigint>(8).fill(1n),
			tokenTypeIds: new Array<bigint>(8).fill(0n), dims: [1, 8],
		}]);
		const reviewed = reviewAssistanceEmbeddingMatrixV1(await readFile(value.output));
		assert.equal(reviewed.rowCount, 1);
		assert.equal(reviewed.dimensions, 768);
		const row = reviewed.vector(0);
		assert.ok(Math.abs(row[0]! - Math.SQRT1_2) < 1e-6);
		assert.ok(Math.abs(row[1]! + Math.SQRT1_2) < 1e-6);
		assert.ok(row.subarray(2).every((candidate) => candidate === 0));
	});

test('nomic query embedding uses the separate query prefix without fallback', async (context) => {
	const value = await fixture(context, 'query', ' find red bicycle ');
	let ids: readonly bigint[] = [];
	const runtime = fakeRuntime(async (feeds) => {
		ids = Array.from(feeds.input_ids!.data as BigInt64Array);
		return hiddenState(feeds.input_ids!.dims[0]!, feeds.input_ids!.dims[1]!);
	});
	await runAssistanceRuntimeFamilyWorkerJobV1({
		job: value.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
	});
	assert.deepEqual(ids, [101n, 3945n, 1035n, 23032n, 1024n, 2424n, 2417n, 10165n, 102n]);
});

test('nomic adapter rejects model, tokenizer, graph, and tensor substitutions', async (context) => {
	const substitute = await fixture(context, 'query', 'find red bicycle', { modelId: 'other-embedder' });
	let loaded = false;
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: substitute.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => {
			loaded = true;
			return fakeRuntime(async () => ({}));
		} }),
	}), /nomic|model|exact/iu);
	assert.equal(loaded, false);

	const badTokenizer = await fixture(context, 'query', 'find red bicycle', {
		tokenizer: UTF8.encode('{"altered":true}'),
	});
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: badTokenizer.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({
			loadRuntime: async () => fakeRuntime(async () => ({})),
		}),
	}), /tokenizer|WordPiece|normalizer|fields/iu);

	const wrongGraph = await fixture(context, 'query', 'find red bicycle');
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: wrongGraph.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({
			loadRuntime: async () => fakeRuntime(async () => ({}), ['tokens'], ['embedding']),
		}),
	}), /graph|signature|input|output/iu);

	const nan = await fixture(context, 'query', 'find red bicycle');
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: nan.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({
			loadRuntime: async () => fakeRuntime(async (feeds) => {
				const output = hiddenState(feeds.input_ids!.dims[0]!, feeds.input_ids!.dims[1]!);
				(output.last_hidden_state!.data as Float32Array)[0] = Number.NaN;
				return output;
			}),
		}),
	}), /finite|hidden|tensor/iu);

	const wrongShape = await fixture(context, 'query', 'find red bicycle');
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: wrongShape.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({
			loadRuntime: async () => fakeRuntime(async (feeds) => ({
				last_hidden_state: Object.freeze({ type: 'float32',
					data: new Float32Array(feeds.input_ids!.dims[0]! * feeds.input_ids!.dims[1]! * 384),
					dims: Object.freeze([feeds.input_ids!.dims[0]!, feeds.input_ids!.dims[1]!, 384]),
				}),
			})),
		}),
	}), /768|geometry|hidden|tensor/iu);
});

test('nomic transcript embedding observes cancellation between bounded ONNX batches', async (context) => {
	const value = await fixture(context, 'transcript', transcript(
		new Array<string>(3_000).fill('hello').join(' '),
	));
	const controller = new AbortController();
	let calls = 0;
	const runtime = fakeRuntime(async (feeds) => {
		calls += 1;
		controller.abort(new DOMException('cancelled', 'AbortError'));
		return hiddenState(feeds.input_ids!.dims[0]!, feeds.input_ids!.dims[1]!);
	});
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: value.job, signal: controller.signal,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
	}), { name: 'AbortError' });
	assert.equal(calls, 1);
});

test('main rejects a substituted nomic model before catalog lookup', () => {
	assert.doesNotThrow(() => assertAssistanceOnnxTextEmbeddingModelBindingV1({
		modelId: 'nomic-embed-text-v1.5', version: '1.5.0', artifactSha256s: ['a'.repeat(64)],
	}));
	assert.throws(() => assertAssistanceOnnxTextEmbeddingModelBindingV1({
		modelId: 'nomic-embed-text-v1.5', version: '1.4.0', artifactSha256s: ['a'.repeat(64)],
	}), /nomic|1\.5|identity/iu);
	assert.throws(() => assertAssistanceOnnxTextEmbeddingModelBindingV1({
		modelId: 'other', version: '1.5.0', artifactSha256s: ['a'.repeat(64)],
	}), /nomic|exact|identity/iu);
});

function fakeRuntime(
	run: (feeds: Readonly<Record<string, TensorValue>>) => Promise<Readonly<Record<string, TensorValue>>>,
	inputNames: readonly string[] = ['input_ids', 'attention_mask', 'token_type_ids'],
	outputNames: readonly string[] = ['last_hidden_state'],
): AssistanceOnnxRuntimeModuleV1 {
	class Tensor implements TensorValue {
		constructor(
			readonly type: 'uint8' | 'float32' | 'int64',
			readonly data: Uint8Array | Float32Array | BigInt64Array,
			readonly dims: readonly number[],
		) {}
	}
	return Object.freeze({ Tensor, InferenceSession: Object.freeze({
		create: async (_path: string, options: Readonly<Record<string, unknown>>) => {
			assert.deepEqual(options.executionProviders, ['cpu']);
			return Object.freeze({ inputNames, outputNames, run });
		},
	}) });
}

function hiddenState(batch: number, sequence: number): Readonly<Record<string, TensorValue>> {
	const data = new Float32Array(batch * sequence * 768);
	for (let row = 0; row < batch; row += 1) {
		for (let token = 0; token < sequence; token += 1) {
			const offset = (row * sequence + token) * 768;
			data[offset] = 1;
			data[offset + 1] = -1;
		}
	}
	return Object.freeze({ last_hidden_state: Object.freeze({
		type: 'float32', data, dims: Object.freeze([batch, sequence, 768]),
	}) });
}

function snapshotFeeds(feeds: Readonly<Record<string, TensorValue>>) {
	return Object.freeze({
		inputIds: Array.from(feeds.input_ids!.data as BigInt64Array),
		attentionMask: Array.from(feeds.attention_mask!.data as BigInt64Array),
		tokenTypeIds: Array.from(feeds.token_type_ids!.data as BigInt64Array),
		dims: [...feeds.input_ids!.dims],
	});
}

interface TensorValue {
	readonly type: string;
	readonly data: Uint8Array | Float32Array | BigInt64Array;
	readonly dims: readonly number[];
}
