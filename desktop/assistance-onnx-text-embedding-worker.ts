/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated CPU ONNX execution for pinned nomic transcript/query embeddings. */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import {
	createAssistanceEmbeddingMatrixV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';
import {
	ASSISTANCE_NOMIC_EMBEDDING_DIMENSIONS,
	createAssistanceNomicTokenizerV1,
} from '../src/common/editor/assistance/nomic-tokenizer-v1.ts';
import {
	createAssistanceNomicDocumentChunksV1,
	createAssistanceNomicQueryV1,
} from '../src/common/editor/assistance/transcript-indexing-v1.ts';
import type { AssistanceTranscript } from '../src/common/editor/assistance/transcript.ts';
import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
	AssistanceOnnxTensorV1,
} from './assistance-onnx-runtime-worker.ts';
import type {
	AssistanceRuntimeFamilyModelGrantV1,
} from './assistance-runtime-family-job-contract.ts';
import type {
	AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';

type RuntimeLoader = (entrypoint: string) => PromiseLike<AssistanceOnnxRuntimeModuleV1>;

const MODEL_ID = 'nomic-embed-text-v1.5';
const MODEL_VERSION = '1.5.0';
const MODEL_ROLES = Object.freeze([
	'model_quantized', 'tokenizer', 'tokenizer_config', 'special_tokens_map', 'config',
] as const);
const INPUT_NAMES = Object.freeze(['input_ids', 'token_type_ids', 'attention_mask']);
const OUTPUT_NAMES = Object.freeze(['last_hidden_state']);
const TRANSCRIPT_MEDIA_TYPES = new Set([
	'application/json', 'application/vnd.soundscaper.transcript+json',
]);
const TEXT_MEDIA_TYPE = 'text/plain';
const OUTPUT_MEDIA_TYPE = 'application/vnd.soundscaper.embedding-matrix-v1';
const MAXIMUM_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
const MAXIMUM_QUERY_BYTES = 64 * 1024;
const MAXIMUM_BATCH_ROWS = 8;
const MAXIMUM_SEQUENCE_TOKENS = 258;
const LAYER_NORM_EPSILON = 1e-5;
const L2_NORMALIZE_EPSILON = 1e-12;

export function createAssistanceOnnxTextEmbeddingWorkerAdapterV1(
	loadRuntime: RuntimeLoader,
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) => Promise<unknown> {
	if (typeof loadRuntime !== 'function') throw new TypeError('The nomic ONNX runtime loader is invalid.');
	return async (context) => executeNomicTextEmbedding(context, loadRuntime);
}

async function executeNomicTextEmbedding(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: RuntimeLoader,
): Promise<unknown> {
	assertRuntimeJob(context);
	const inputRole = assertSettingsAndGrants(context);
	const models = exactModelArtifacts(context.grant.models);
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const [inputBytes, tokenizerBytes, tokenizerConfigBytes, specialTokensMapBytes, configBytes]
		= await Promise.all([
			readFile(context.grant.inputs[0]!.path), readFile(models.tokenizer.path),
			readFile(models.tokenizer_config.path), readFile(models.special_tokens_map.path),
			readFile(models.config.path),
		]);
	context.signal?.throwIfAborted();
	const tokenizer = createAssistanceNomicTokenizerV1({
		tokenizer: tokenizerBytes, tokenizerConfig: tokenizerConfigBytes,
		specialTokensMap: specialTokensMapBytes, config: configBytes,
	});
	const rows = inputRole === 'transcript'
		? transcriptRows(inputBytes, tokenizer)
		: queryRows(inputBytes, tokenizer);
	context.signal?.throwIfAborted();
	const runtime = runtimeValue(await loadRuntime(context.job.descriptor.entrypoint));
	const session = await createCpuSession(runtime, models.model_quantized.path);
	const vectors: Float32Array[] = [];
	const batchCount = Math.ceil(rows.length / MAXIMUM_BATCH_ROWS);
	try {
		assertExactNames(session.inputNames, INPUT_NAMES, 'input');
		assertExactNames(session.outputNames, OUTPUT_NAMES, 'output');
		for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
			context.signal?.throwIfAborted();
			const start = batchIndex * MAXIMUM_BATCH_ROWS;
			const batchRows = rows.slice(start, start + MAXIMUM_BATCH_ROWS);
			const inputs = createInputBatch(batchRows, tokenizer.specialTokenIds);
			const output = exactOutputs(await session.run({
				input_ids: new runtime.Tensor('int64', inputs.inputIds, inputs.dims),
				token_type_ids: new runtime.Tensor('int64', inputs.tokenTypeIds, inputs.dims),
				attention_mask: new runtime.Tensor('int64', inputs.attentionMask, inputs.dims),
			}));
			context.signal?.throwIfAborted();
			vectors.push(...poolNormalize(
				output.last_hidden_state, inputs.lengths, inputs.dims[1],
			));
			context.onProgress((batchIndex + 1) / (batchCount + 1));
		}
		if (vectors.length !== rows.length) {
			throw new Error('Nomic ONNX batches lost exact row authority.');
		}
		return await publishEmbeddings(context, vectors);
	} finally {
		await session.release?.();
	}
}

function assertRuntimeJob(context: AssistanceRuntimeFamilyWorkerExecutionContext): void {
	if (context.grant.familyId !== 'onnxruntime-node' || context.grant.task !== 'text-embedding'
		|| context.job.descriptor.familyId !== 'onnxruntime-node'
		|| context.job.descriptor.runtimeVersion !== '1.29.0'
		|| context.job.descriptor.executionProvider !== 'cpu') {
		throw new TypeError('The nomic adapter received a foreign authenticated CPU job.');
	}
}

function assertSettingsAndGrants(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
): 'transcript' | 'text' {
	const { grant, settings } = context;
	const input = grant.inputs[0];
	if (grant.inputs.length !== 1 || input === undefined
		|| input.role !== 'transcript' && input.role !== 'text'
		|| grant.outputs.length !== 1 || grant.outputs[0]!.role !== 'embeddings'
		|| grant.outputs[0]!.mediaType !== OUTPUT_MEDIA_TYPE) {
		throw new TypeError('Nomic text embedding requires one exact text input and embedding output.');
	}
	if (settings.schemaVersion !== 1 || settings.operation !== 'text-embedding'
		|| JSON.stringify(settings.inputRoles) !== JSON.stringify([input.role])
		|| JSON.stringify(settings.outputRoles) !== '["embeddings"]') {
		throw new TypeError('The nomic settings do not bind one exact text-embedding workflow.');
	}
	if (input.role === 'transcript') {
		if (!TRANSCRIPT_MEDIA_TYPES.has(input.mediaType)
			|| input.byteLength < 2 || input.byteLength > MAXIMUM_TRANSCRIPT_BYTES) {
			throw new RangeError('The nomic transcript input type or byte bound is invalid.');
		}
	} else if (input.mediaType !== TEXT_MEDIA_TYPE
		|| input.byteLength < 1 || input.byteLength > MAXIMUM_QUERY_BYTES) {
		throw new RangeError('The nomic query input type or byte bound is invalid.');
	}
	return input.role;
}

function exactModelArtifacts(
	models: readonly AssistanceRuntimeFamilyModelGrantV1[],
): Readonly<Record<(typeof MODEL_ROLES)[number], AssistanceRuntimeFamilyModelGrantV1>> {
	if (models.length !== MODEL_ROLES.length || models.some(({ modelId, version }) =>
		modelId !== MODEL_ID || version !== MODEL_VERSION)) {
		throw new TypeError('Text embedding requires the exact nomic-embed-text-v1.5 model identity.');
	}
	const result = {} as Record<(typeof MODEL_ROLES)[number], AssistanceRuntimeFamilyModelGrantV1>;
	for (const role of MODEL_ROLES) {
		const matches = models.filter(({ artifactRole }) => artifactRole === role);
		if (matches.length !== 1) {
			throw new TypeError(`The nomic ${role} artifact grant is missing or ambiguous.`);
		}
		result[role] = matches[0]!;
	}
	return Object.freeze(result);
}

function transcriptRows(
	bytes: Uint8Array,
	tokenizer: ReturnType<typeof createAssistanceNomicTokenizerV1>,
): readonly (readonly number[])[] {
	const parsed = parseJson(bytes, 'transcript');
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new TypeError('The nomic transcript JSON root is invalid.');
	}
	return Object.freeze(createAssistanceNomicDocumentChunksV1(
		parsed as AssistanceTranscript, tokenizer,
	).map(({ inputIds }) => inputIds));
}

function queryRows(
	bytes: Uint8Array,
	tokenizer: ReturnType<typeof createAssistanceNomicTokenizerV1>,
): readonly (readonly number[])[] {
	const text = decodeUtf8(bytes, 'query');
	return Object.freeze([createAssistanceNomicQueryV1(text, tokenizer).inputIds]);
}

function createInputBatch(
	rows: readonly (readonly number[])[],
	specials: Readonly<{ pad: number; classification: number; separator: number }>,
): Readonly<{
	readonly inputIds: BigInt64Array;
	readonly tokenTypeIds: BigInt64Array;
	readonly attentionMask: BigInt64Array;
	readonly dims: readonly [number, number];
	readonly lengths: readonly number[];
}> {
	if (rows.length < 1 || rows.length > MAXIMUM_BATCH_ROWS) {
		throw new RangeError('The nomic ONNX batch row count is invalid.');
	}
	const lengths = rows.map((row) => row.length + 2);
	const sequence = Math.max(...lengths);
	if (sequence < 3 || sequence > MAXIMUM_SEQUENCE_TOKENS) {
		throw new RangeError('A nomic ONNX sequence exceeds its exact token bound.');
	}
	const inputIds = new BigInt64Array(rows.length * sequence).fill(BigInt(specials.pad));
	const tokenTypeIds = new BigInt64Array(rows.length * sequence);
	const attentionMask = new BigInt64Array(rows.length * sequence);
	for (const [rowIndex, row] of rows.entries()) {
		const ids = [specials.classification, ...row, specials.separator];
		for (const [column, candidate] of ids.entries()) {
			if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate > 30_527) {
				throw new RangeError('A nomic tokenizer emitted an invalid vocabulary id.');
			}
			const offset = rowIndex * sequence + column;
			inputIds[offset] = BigInt(candidate);
			attentionMask[offset] = 1n;
		}
	}
	return Object.freeze({ inputIds, tokenTypeIds, attentionMask,
		dims: Object.freeze([rows.length, sequence] as const), lengths: Object.freeze(lengths) });
}

function poolNormalize(
	value: AssistanceOnnxTensorV1 | undefined,
	lengths: readonly number[],
	expectedSequence: number,
): readonly Float32Array[] {
	const sequence = value?.dims[1];
	if (!value || value.type !== 'float32' || !(value.data instanceof Float32Array)
		|| value.dims.length !== 3 || value.dims[0] !== lengths.length
		|| sequence !== expectedSequence || !Number.isSafeInteger(sequence) || Number(sequence) < 1
		|| value.dims[2] !== ASSISTANCE_NOMIC_EMBEDDING_DIMENSIONS
		|| value.data.length !== lengths.length * Number(sequence)
			* ASSISTANCE_NOMIC_EMBEDDING_DIMENSIONS) {
		throw new RangeError('The nomic last_hidden_state tensor geometry or element type is invalid.');
	}
	for (const candidate of value.data) {
		if (!Number.isFinite(candidate)) {
			throw new RangeError('Every nomic hidden-state tensor value must be finite.');
		}
	}
	const vectors: Float32Array[] = [];
	for (let row = 0; row < lengths.length; row += 1) {
		const length = lengths[row]!;
		if (length < 1 || length > Number(sequence)) {
			throw new RangeError('The nomic attention-mask authority is invalid.');
		}
		const pooled = new Float64Array(ASSISTANCE_NOMIC_EMBEDDING_DIMENSIONS);
		for (let token = 0; token < length; token += 1) {
			const offset = (row * Number(sequence) + token) * ASSISTANCE_NOMIC_EMBEDDING_DIMENSIONS;
			for (let dimension = 0; dimension < pooled.length; dimension += 1) {
				pooled[dimension] = (pooled[dimension] ?? 0) + value.data[offset + dimension]! / length;
			}
		}
		vectors.push(layerNormalizeAndL2(pooled));
	}
	return Object.freeze(vectors);
}

function layerNormalizeAndL2(value: Float64Array): Float32Array {
	let mean = 0;
	for (const candidate of value) mean += candidate / value.length;
	let variance = 0;
	for (const candidate of value) variance += (candidate - mean) ** 2 / value.length;
	if (!Number.isFinite(mean) || !Number.isFinite(variance)) {
		throw new RangeError('The nomic pooled embedding is non-finite.');
	}
	const scale = 1 / Math.sqrt(variance + LAYER_NORM_EPSILON);
	const normalized = new Float64Array(value.length);
	let normSquared = 0;
	for (let index = 0; index < value.length; index += 1) {
		const candidate = (value[index]! - mean) * scale;
		normalized[index] = candidate;
		normSquared += candidate * candidate;
	}
	const norm = Math.sqrt(normSquared);
	if (!Number.isFinite(norm) || norm < L2_NORMALIZE_EPSILON) {
		throw new RangeError('The nomic pooled embedding cannot be L2-normalized.');
	}
	const result = new Float32Array(value.length);
	for (let index = 0; index < result.length; index += 1) {
		result[index] = Math.fround(normalized[index]! / norm);
	}
	return result;
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
		throw new TypeError('The nomic ONNX inference session surface is invalid.');
	}
	return session;
}

function runtimeValue(value: unknown): AssistanceOnnxRuntimeModuleV1 {
	if (!value || typeof value !== 'object') throw new TypeError('The nomic ONNX runtime is invalid.');
	const candidate = value as Partial<AssistanceOnnxRuntimeModuleV1>;
	if (typeof candidate.Tensor !== 'function' || !candidate.InferenceSession
		|| typeof candidate.InferenceSession.create !== 'function') {
		throw new TypeError('The nomic ONNX runtime surface is invalid.');
	}
	return candidate as AssistanceOnnxRuntimeModuleV1;
}

function assertExactNames(actual: readonly string[], expected: readonly string[], kind: string): void {
	if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
		throw new TypeError(`The nomic ONNX graph ${kind} signature is invalid.`);
	}
}

function exactOutputs(
	value: Readonly<Record<string, AssistanceOnnxTensorV1>>,
): Readonly<Record<string, AssistanceOnnxTensorV1>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...OUTPUT_NAMES].sort())) {
		throw new TypeError('The nomic ONNX result tensor inventory is invalid.');
	}
	return value;
}

async function publishEmbeddings(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	vectors: readonly Float32Array[],
): Promise<unknown> {
	context.signal?.throwIfAborted();
	const body = createAssistanceEmbeddingMatrixV1({
		dimensions: ASSISTANCE_NOMIC_EMBEDDING_DIMENSIONS, vectors,
	});
	const output = context.grant.outputs[0]!;
	if (body.byteLength < 1 || body.byteLength > output.maximumByteLength) {
		throw new RangeError('The nomic embedding matrix exceeds its authenticated reservation.');
	}
	await writeFile(output.path, body);
	context.signal?.throwIfAborted();
	context.onProgress(1);
	return Object.freeze({
		resultVersion: 1, jobId: context.grant.jobId,
		familyId: context.grant.familyId, task: context.grant.task,
		outputs: Object.freeze([Object.freeze({
			claimId: output.claimId, role: output.role, mediaType: output.mediaType,
			byteLength: body.byteLength,
			sha256: createHash('sha256').update(body).digest('hex'),
		})]),
	});
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	const text = decodeUtf8(bytes, label);
	try { return JSON.parse(text) as unknown; }
	catch { throw new TypeError(`The nomic ${label} is not valid JSON.`); }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
	try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
	catch { throw new TypeError(`The nomic ${label} is not valid UTF-8.`); }
}
