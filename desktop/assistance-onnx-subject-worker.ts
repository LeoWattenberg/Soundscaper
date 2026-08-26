/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated composite YuNet face and D-FINE object detection on CPU. */

import { readFile } from 'node:fs/promises';

import {
	reviewAssistanceSubjectResultV1,
	type AssistanceSubjectDetectionV1,
} from '../src/common/editor/assistance/visual-semantic-results-v1.ts';
import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
} from './assistance-onnx-runtime-worker.ts';
import type {
	AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';
import {
	assistanceOnnxVisualAuthorityJsonV1,
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
	assistanceBoxIouV1,
	assistanceNormalizedBoxV1,
	assistanceSigmoidV1,
	exactAssistanceFloatTensorV1,
	resizeAssistanceRgbaToChwFloatV1,
} from './assistance-onnx-visual-tensors.ts';

const YUNET_ROLES = Object.freeze(['face_detection_yunet_2026may'] as const);
const DFINE_ROLES = Object.freeze(['model', 'config', 'preprocessor_config'] as const);
const YUNET_INPUTS = Object.freeze(['input']);
const YUNET_OUTPUTS = Object.freeze([
	'cls_8', 'cls_16', 'cls_32', 'obj_8', 'obj_16', 'obj_32',
	'bbox_8', 'bbox_16', 'bbox_32', 'kps_8', 'kps_16', 'kps_32',
]);
const DFINE_INPUTS = Object.freeze(['pixel_values']);
const DFINE_OUTPUTS = Object.freeze(['logits', 'pred_boxes']);
const OUTPUT_MEDIA_TYPES = new Set([
	'application/json', 'application/vnd.soundscaper.subject-tracks+json',
]);
const SIZE = 640;
const QUERIES = 300;
const CLASSES = 80;
const FACE_THRESHOLD = 0.75;
const OBJECT_THRESHOLD = 0.5;
const YUNET_NORMALIZATION = Object.freeze({ channelOrder: 'bgr' as const,
	mean: Object.freeze([0, 0, 0] as const),
	standardDeviation: Object.freeze([1, 1, 1] as const), scale: 1 });
const DFINE_NORMALIZATION = Object.freeze({ channelOrder: 'rgb' as const,
	mean: Object.freeze([0, 0, 0] as const),
	standardDeviation: Object.freeze([1, 1, 1] as const), scale: 1 / 255 });

export function createAssistanceOnnxSubjectWorkerAdapterV1(
	loadRuntime: AssistanceOnnxVisualRuntimeLoaderV1,
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) => Promise<unknown> {
	if (typeof loadRuntime !== 'function') throw new TypeError('The subject runtime loader is invalid.');
	return async (context) => executeSubjects(context, loadRuntime);
}

async function executeSubjects(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: AssistanceOnnxVisualRuntimeLoaderV1,
): Promise<unknown> {
	assertAssistanceOnnxVisualRuntimeJobV1(context, 'subject-detection');
	assertSettingsAndGrants(context);
	const yunet = exactAssistanceOnnxVisualArtifactsV1(context.grant.models.filter(
		({ modelId }) => modelId === 'yunet-face-detection-2026may'),
	'yunet-face-detection-2026may', '2026.5.0', YUNET_ROLES);
	const dfine = exactAssistanceOnnxVisualArtifactsV1(context.grant.models.filter(
		({ modelId }) => modelId === 'dfine-nano-coco'),
	'dfine-nano-coco', '1.0.0', DFINE_ROLES);
	if (context.grant.models.length !== YUNET_ROLES.length + DFINE_ROLES.length) {
		throw new TypeError('Subject detection contains a foreign model artifact.');
	}
	const labels = await readDfineConfiguration(dfine.config.path, dfine.preprocessor_config.path);
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const source = await openAssistanceOnnxVisualFrameSourceV1(context.grant.inputs, context.signal);
	const runtime = assistanceOnnxRuntimeValueV1(
		await loadRuntime(context.job.descriptor.entrypoint),
	);
	const [faceSession, objectSession] = await Promise.all([
		createAssistanceOnnxVisualCpuSessionV1(runtime,
			yunet.face_detection_yunet_2026may.path, YUNET_INPUTS, YUNET_OUTPUTS),
		createAssistanceOnnxVisualCpuSessionV1(runtime,
			dfine.model.path, DFINE_INPUTS, DFINE_OUTPUTS),
	]);
	const frames: unknown[] = [];
	try {
		for (let index = 0; index < source.frameCount; index += 1) {
			context.signal?.throwIfAborted();
			const frame = await source.readFrame(index);
			const [faces, objects] = await Promise.all([
				detectFaces(runtime, faceSession, frame.rgba,
					source.rasterWidth, source.rasterHeight),
				detectObjects(runtime, objectSession, frame.rgba,
					source.rasterWidth, source.rasterHeight, labels),
			]);
			const subjects = [...faces, ...objects].sort(compareSubjects).slice(0, 1_024);
			frames.push(Object.freeze({ sourceFrame: frame.sourceFrame,
				presentationTick: frame.presentationTick, subjects: Object.freeze(subjects) }));
			context.onProgress((index + 1) / (source.frameCount + 1));
		}
		const authority = assistanceOnnxVisualAuthorityJsonV1(source);
		const reviewed = reviewAssistanceSubjectResultV1({ schemaVersion: 1,
			width: source.width, height: source.height, timescale: source.timescale, frames }, authority);
		return await publishAssistanceOnnxVisualOutputV1(
			context, Buffer.from(JSON.stringify(reviewed), 'utf8'),
		);
	} finally {
		source.release();
		await Promise.all([faceSession.release?.(), objectSession.release?.()]);
	}
}

async function detectFaces(
	runtime: AssistanceOnnxRuntimeModuleV1,
	session: AssistanceOnnxInferenceSessionV1,
	rgba: Uint8Array,
	width: number,
	height: number,
): Promise<readonly AssistanceSubjectDetectionV1[]> {
	const input = resizeAssistanceRgbaToChwFloatV1(rgba, width, height,
		SIZE, SIZE, YUNET_NORMALIZATION);
	const outputs = exactAssistanceOnnxOutputsV1(await session.run({
		input: new runtime.Tensor('float32', input, [1, 3, SIZE, SIZE]),
	}), YUNET_OUTPUTS);
	const candidates: AssistanceSubjectDetectionV1[] = [];
	for (const stride of [8, 16, 32] as const) {
		const rows = (SIZE / stride) ** 2;
		const cls = exactAssistanceFloatTensorV1(outputs[`cls_${String(stride)}`],
			[1, rows, 1], `YuNet cls ${String(stride)}`);
		const objectness = exactAssistanceFloatTensorV1(outputs[`obj_${String(stride)}`],
			[1, rows, 1], `YuNet objectness ${String(stride)}`);
		const boxes = exactAssistanceFloatTensorV1(outputs[`bbox_${String(stride)}`],
			[1, rows, 4], `YuNet boxes ${String(stride)}`);
		exactAssistanceFloatTensorV1(outputs[`kps_${String(stride)}`],
			[1, rows, 10], `YuNet keypoints ${String(stride)}`);
		const columns = SIZE / stride;
		for (let index = 0; index < rows; index += 1) {
			const score = Math.sqrt(clampUnit(cls[index]!) * clampUnit(objectness[index]!));
			if (score < FACE_THRESHOLD) continue;
			const centerX = index % columns + boxes[index * 4]!;
			const centerY = Math.floor(index / columns) + boxes[index * 4 + 1]!;
			const boxWidth = Math.exp(boxes[index * 4 + 2]!) * stride / SIZE;
			const boxHeight = Math.exp(boxes[index * 4 + 3]!) * stride / SIZE;
			const box = assistanceNormalizedBoxV1(centerX * stride / SIZE - boxWidth / 2,
				centerY * stride / SIZE - boxHeight / 2,
				centerX * stride / SIZE + boxWidth / 2,
				centerY * stride / SIZE + boxHeight / 2);
			if (box) candidates.push(Object.freeze({ kind: 'face', classId: null, label: 'face',
				confidence: Math.fround(score), box }));
		}
	}
	return nonMaximumSuppression(candidates, 0.3, 256);
}

async function detectObjects(
	runtime: AssistanceOnnxRuntimeModuleV1,
	session: AssistanceOnnxInferenceSessionV1,
	rgba: Uint8Array,
	width: number,
	height: number,
	labels: readonly string[],
): Promise<readonly AssistanceSubjectDetectionV1[]> {
	const input = resizeAssistanceRgbaToChwFloatV1(rgba, width, height,
		SIZE, SIZE, DFINE_NORMALIZATION);
	const outputs = exactAssistanceOnnxOutputsV1(await session.run({
		pixel_values: new runtime.Tensor('float32', input, [1, 3, SIZE, SIZE]),
	}), DFINE_OUTPUTS);
	const logits = exactAssistanceFloatTensorV1(outputs.logits, [1, QUERIES, CLASSES],
		'D-FINE logits');
	const boxes = exactAssistanceFloatTensorV1(outputs.pred_boxes, [1, QUERIES, 4],
		'D-FINE boxes');
	const ranked: Array<Readonly<{ query: number; classId: number; score: number }>> = [];
	for (let query = 0; query < QUERIES; query += 1) {
		for (let classId = 0; classId < CLASSES; classId += 1) {
			const score = assistanceSigmoidV1(logits[query * CLASSES + classId]!, 'D-FINE');
			if (score >= OBJECT_THRESHOLD) ranked.push(Object.freeze({ query, classId, score }));
		}
	}
	ranked.sort((left, right) => right.score - left.score || left.query - right.query
		|| left.classId - right.classId);
	const result: AssistanceSubjectDetectionV1[] = [];
	for (const { query, classId, score } of ranked.slice(0, 100)) {
		const offset = query * 4;
		const centerX = boxes[offset]!;
		const centerY = boxes[offset + 1]!;
		const boxWidth = boxes[offset + 2]!;
		const boxHeight = boxes[offset + 3]!;
		const box = assistanceNormalizedBoxV1(centerX - boxWidth / 2, centerY - boxHeight / 2,
			centerX + boxWidth / 2, centerY + boxHeight / 2);
		if (box) result.push(Object.freeze({ kind: classId === 0 ? 'person' : 'object',
			classId, label: labels[classId]!, confidence: score, box }));
	}
	return Object.freeze(result);
}

function nonMaximumSuppression(
	values: readonly AssistanceSubjectDetectionV1[],
	threshold: number,
	maximum: number,
): readonly AssistanceSubjectDetectionV1[] {
	const sorted = [...values].sort(compareSubjects);
	const result: AssistanceSubjectDetectionV1[] = [];
	for (const candidate of sorted) {
		if (result.every((prior) => assistanceBoxIouV1(prior.box, candidate.box) <= threshold)) {
			result.push(candidate);
			if (result.length >= maximum) break;
		}
	}
	return Object.freeze(result);
}

async function readDfineConfiguration(configPath: string, preprocessorPath: string): Promise<readonly string[]> {
	const [config, preprocessor] = await Promise.all([
		readJson(configPath, 'D-FINE config'), readJson(preprocessorPath, 'D-FINE preprocessor'),
	]);
	if (config.model_type !== 'd_fine' || config.num_queries !== QUERIES) {
		throw new TypeError('The D-FINE model configuration is unsupported.');
	}
	const rawLabels = record(config.id2label, 'D-FINE class map');
	const labels = Array.from({ length: CLASSES }, (_, index) => rawLabels[String(index)]);
	if (labels.some((label) => typeof label !== 'string' || label.length < 1 || label.length > 80)
		|| labels[0] !== 'person') {
		throw new TypeError('The D-FINE class map is invalid.');
	}
	const size = record(preprocessor.size, 'D-FINE preprocessor size');
	if (preprocessor.do_resize !== true || preprocessor.do_rescale !== true
		|| preprocessor.do_normalize !== false || preprocessor.do_pad !== false
		|| preprocessor.rescale_factor !== 1 / 255 || size.width !== SIZE || size.height !== SIZE) {
		throw new TypeError('The D-FINE preprocessing configuration is unsupported.');
	}
	return Object.freeze(labels as string[]);
}

function assertSettingsAndGrants(context: AssistanceRuntimeFamilyWorkerExecutionContext): void {
	const { grant, settings } = context;
	if (grant.inputs.length < 1 || grant.inputs.some(({ role, mediaType }) =>
		role !== 'frame-pack' || mediaType !== 'application/vnd.soundscaper.frame-pack')
		|| grant.outputs.length !== 1 || grant.outputs[0]!.role !== 'subject-tracks'
		|| !OUTPUT_MEDIA_TYPES.has(grant.outputs[0]!.mediaType)
		|| settings.schemaVersion !== 1 || settings.operation !== 'subject-detection'
		|| JSON.stringify(settings.inputRoles) !== JSON.stringify(grant.inputs.map(() => 'frame-pack'))
		|| JSON.stringify(settings.outputRoles) !== '["subject-tracks"]') {
		throw new TypeError('Subject grants/settings do not bind exact composite detection.');
	}
}

function compareSubjects(left: AssistanceSubjectDetectionV1, right: AssistanceSubjectDetectionV1): number {
	return right.confidence - left.confidence || left.kind.localeCompare(right.kind)
		|| (left.classId ?? -1) - (right.classId ?? -1) || left.box.x - right.box.x
		|| left.box.y - right.box.y;
}

function clampUnit(value: number): number {
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError('A YuNet probability is outside its exact unit interval.');
	}
	return value;
}

async function readJson(path: string, label: string): Promise<Record<string, unknown>> {
	let value: unknown;
	try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path))); }
	catch { throw new TypeError(`The ${label} is not canonical UTF-8 JSON.`); }
	return record(value, label);
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value as Record<string, unknown>;
}
