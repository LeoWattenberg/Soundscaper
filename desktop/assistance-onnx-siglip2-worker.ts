/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated CPU execution of pinned SigLIP2 image and text embeddings. */

import { readFile } from 'node:fs/promises';

import {
	createAssistanceEmbeddingMatrixV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';
import {
	createAssistanceSiglip2TokenizerV1,
} from '../src/common/editor/assistance/siglip2-tokenizer-v1.ts';
import { ASSISTANCE_VISUAL_TAG_PROMPTS_V1 } from
	'../src/common/editor/assistance/visual-tag-classification-v1.ts';
import type {
	AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';
import {
	openAssistanceOnnxVisualFrameSourceV1,
} from './assistance-onnx-visual-frame-source.ts';
import {
	assistanceOnnxRuntimeValueV1,
	assertAssistanceOnnxVisualRuntimeJobV1,
	createAssistanceOnnxVisualCpuSessionV1,
	exactAssistanceOnnxOutputsV1,
	exactAssistanceOnnxVisualArtifactsV1,
	publishAssistanceOnnxVisualOutputV1,
	type AssistanceOnnxVisualRuntimeLoaderV1,
} from './assistance-onnx-visual-worker-common.ts';
import {
	exactAssistanceFloatTensorV1,
	normalizeAssistanceEmbeddingV1,
	resizeAssistanceRgbaToChwFloatV1,
} from './assistance-onnx-visual-tensors.ts';

const MODEL_ID = 'siglip2-base-patch16-224';
const MODEL_VERSION = '2.0.0';
const MODEL_ROLES = Object.freeze([
	'vision_model_int8', 'text_model_int8', 'tokenizer', 'config', 'preprocessor_config',
] as const);
const VISION_INPUTS = Object.freeze(['pixel_values']);
const VISION_OUTPUTS = Object.freeze(['last_hidden_state', 'pooler_output']);
const TEXT_INPUTS = Object.freeze(['input_ids']);
const TEXT_OUTPUTS = Object.freeze(['last_hidden_state', 'pooler_output']);
const OUTPUT_MEDIA_TYPE = 'application/vnd.soundscaper.embedding-matrix-v1';
const FRAME_PACK_MEDIA_TYPE = 'application/vnd.soundscaper.frame-pack';
const TEXT_MEDIA_TYPE = 'text/plain';
const EMBEDDING_DIMENSIONS = 768;
const IMAGE_SIZE = 224;
const PATCH_COUNT = 196;
const TEXT_SEQUENCE = 64;
const IMAGE_BATCH = 4;
const MAXIMUM_TEXT_BYTES = 64 * 1024;
const SIGLIP_NORMALIZATION = Object.freeze({ channelOrder: 'rgb' as const,
	mean: Object.freeze([0.5, 0.5, 0.5] as const),
	standardDeviation: Object.freeze([0.5, 0.5, 0.5] as const), scale: 1 / 255 });

export function createAssistanceOnnxSiglip2WorkerAdapterV1(
	loadRuntime: AssistanceOnnxVisualRuntimeLoaderV1,
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) => Promise<unknown> {
	if (typeof loadRuntime !== 'function') throw new TypeError('The SigLIP2 runtime loader is invalid.');
	return async (context) => executeSiglip2(context, loadRuntime);
}

async function executeSiglip2(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: AssistanceOnnxVisualRuntimeLoaderV1,
): Promise<unknown> {
	assertAssistanceOnnxVisualRuntimeJobV1(context, 'image-text-embedding');
	const inputRole = assertSettingsAndGrants(context);
	const models = exactAssistanceOnnxVisualArtifactsV1(
		context.grant.models, MODEL_ID, MODEL_VERSION, MODEL_ROLES,
	);
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const runtime = assistanceOnnxRuntimeValueV1(
		await loadRuntime(context.job.descriptor.entrypoint),
	);
	const vectors = inputRole === 'frame-pack'
		? await embedFramesAndTagPrototypes(context, runtime, models.vision_model_int8.path,
			models.text_model_int8.path, models.tokenizer.path)
		: await embedText(context, runtime, models.text_model_int8.path, models.tokenizer.path);
	return publishAssistanceOnnxVisualOutputV1(context, createAssistanceEmbeddingMatrixV1({
		dimensions: EMBEDDING_DIMENSIONS, vectors,
	}));
}

async function embedFramesAndTagPrototypes(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	runtime: ReturnType<typeof assistanceOnnxRuntimeValueV1>,
	visionModelPath: string,
	textModelPath: string,
	tokenizerPath: string,
): Promise<readonly Float32Array[]> {
	const frames = await embedFrames(context, runtime, visionModelPath);
	context.signal?.throwIfAborted();
	const prototypes = await embedTexts(context, runtime, textModelPath, tokenizerPath,
		ASSISTANCE_VISUAL_TAG_PROMPTS_V1.map(({ text }) => text), 0.95);
	return Object.freeze([...frames, ...prototypes]);
}

function assertSettingsAndGrants(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
): 'frame-pack' | 'text' {
	const { grant, settings } = context;
	const role = grant.inputs[0]?.role;
	if (role !== 'frame-pack' && role !== 'text') {
		throw new TypeError('SigLIP2 requires exact frame-pack or text input custody.');
	}
	if (grant.inputs.some((input) => input.role !== role
		|| input.mediaType !== (role === 'frame-pack' ? FRAME_PACK_MEDIA_TYPE : TEXT_MEDIA_TYPE))
		|| role === 'text' && (grant.inputs.length !== 1 || grant.inputs[0]!.byteLength < 1
			|| grant.inputs[0]!.byteLength > MAXIMUM_TEXT_BYTES)
		|| grant.outputs.length !== 1 || grant.outputs[0]!.role !== 'embeddings'
		|| grant.outputs[0]!.mediaType !== OUTPUT_MEDIA_TYPE) {
		throw new TypeError('SigLIP2 input/output grants do not bind one exact embedding job.');
	}
	if (settings.schemaVersion !== 1 || settings.operation !== 'image-text-embedding'
		|| JSON.stringify(settings.inputRoles) !== JSON.stringify(grant.inputs.map(() => role))
		|| JSON.stringify(settings.outputRoles) !== '["embeddings"]') {
		throw new TypeError('SigLIP2 settings do not bind one exact image/text embedding job.');
	}
	return role;
}

async function embedFrames(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	runtime: ReturnType<typeof assistanceOnnxRuntimeValueV1>,
	modelPath: string,
): Promise<readonly Float32Array[]> {
	const source = await openAssistanceOnnxVisualFrameSourceV1(context.grant.inputs, context.signal);
	const session = await createAssistanceOnnxVisualCpuSessionV1(
		runtime, modelPath, VISION_INPUTS, VISION_OUTPUTS,
	);
	const vectors: Float32Array[] = [];
	const batchCount = Math.ceil(source.frameCount / IMAGE_BATCH);
	try {
		for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
			context.signal?.throwIfAborted();
			const count = Math.min(IMAGE_BATCH, source.frameCount - batchIndex * IMAGE_BATCH);
			const data = new Float32Array(count * 3 * IMAGE_SIZE * IMAGE_SIZE);
			for (let row = 0; row < count; row += 1) {
				const frame = await source.readFrame(batchIndex * IMAGE_BATCH + row);
				data.set(resizeAssistanceRgbaToChwFloatV1(frame.rgba,
					source.rasterWidth, source.rasterHeight,
					IMAGE_SIZE, IMAGE_SIZE, SIGLIP_NORMALIZATION),
				row * 3 * IMAGE_SIZE * IMAGE_SIZE);
			}
			const outputs = exactAssistanceOnnxOutputsV1(await session.run({
				pixel_values: new runtime.Tensor('float32', data,
					[count, 3, IMAGE_SIZE, IMAGE_SIZE]),
			}), VISION_OUTPUTS);
			exactAssistanceFloatTensorV1(outputs.last_hidden_state,
				[count, PATCH_COUNT, EMBEDDING_DIMENSIONS], 'SigLIP2 vision hidden state');
			vectors.push(...embeddingRows(outputs.pooler_output, count, 'SigLIP2 vision'));
			context.onProgress((batchIndex + 1) / (batchCount + 1));
		}
		return Object.freeze(vectors);
	} finally {
		source.release();
		await session.release?.();
	}
}

async function embedText(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	runtime: ReturnType<typeof assistanceOnnxRuntimeValueV1>,
	modelPath: string,
	tokenizerPath: string,
): Promise<readonly Float32Array[]> {
	const textBytes = await readFile(context.grant.inputs[0]!.path);
	context.signal?.throwIfAborted();
	let text: string;
	try { text = new TextDecoder('utf-8', { fatal: true }).decode(textBytes); }
	catch { throw new TypeError('SigLIP2 text input is not canonical UTF-8.'); }
	return embedTexts(context, runtime, modelPath, tokenizerPath, [text], 0.5);
}

async function embedTexts(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	runtime: ReturnType<typeof assistanceOnnxRuntimeValueV1>,
	modelPath: string,
	tokenizerPath: string,
	texts: readonly string[],
	progress: number,
): Promise<readonly Float32Array[]> {
	const tokenizer = createAssistanceSiglip2TokenizerV1(await readFile(tokenizerPath));
	context.signal?.throwIfAborted();
	const inputIds = new BigInt64Array(texts.length * TEXT_SEQUENCE);
	for (const [index, text] of texts.entries()) {
		inputIds.set(tokenizer.encode(text).inputIds, index * TEXT_SEQUENCE);
	}
	const session = await createAssistanceOnnxVisualCpuSessionV1(
		runtime, modelPath, TEXT_INPUTS, TEXT_OUTPUTS,
	);
	try {
		const outputs = exactAssistanceOnnxOutputsV1(await session.run({
			input_ids: new runtime.Tensor('int64', inputIds, [texts.length, TEXT_SEQUENCE]),
		}), TEXT_OUTPUTS);
		exactAssistanceFloatTensorV1(outputs.last_hidden_state,
			[texts.length, TEXT_SEQUENCE, EMBEDDING_DIMENSIONS], 'SigLIP2 text hidden state');
		context.onProgress(progress);
		return embeddingRows(outputs.pooler_output, texts.length, 'SigLIP2 text');
	} finally {
		await session.release?.();
	}
}

function embeddingRows(
	value: Parameters<typeof exactAssistanceFloatTensorV1>[0],
	rows: number,
	label: string,
): readonly Float32Array[] {
	const data = exactAssistanceFloatTensorV1(value, [rows, EMBEDDING_DIMENSIONS], `${label} pooler`);
	return Object.freeze(Array.from({ length: rows }, (_, row) => normalizeAssistanceEmbeddingV1(
		data.subarray(row * EMBEDDING_DIMENSIONS, (row + 1) * EMBEDDING_DIMENSIONS), label,
	)));
}
