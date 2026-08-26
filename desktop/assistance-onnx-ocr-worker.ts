/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated PP-OCRv4 mobile detector/orientation/recognizer CPU pipeline. */

import { readFile } from 'node:fs/promises';

import {
	reviewAssistanceOcrResultV1,
	type AssistanceOcrRegionV1,
} from '../src/common/editor/assistance/visual-semantic-results-v1.ts';
import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
	AssistanceOnnxTensorV1,
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
	assistanceNormalizedBoxV1,
	exactAssistanceFloatTensorV1,
	resizeAssistanceRgbaToChwFloatV1,
	type AssistanceVisualCropV1,
} from './assistance-onnx-visual-tensors.ts';

const MODEL_ROLES = Object.freeze([
	'text_detection', 'text_recognition', 'text_orientation', 'character_dictionary',
] as const);
const DETECTION_INPUTS = Object.freeze(['x']);
const DETECTION_OUTPUTS = Object.freeze(['sigmoid_0.tmp_0']);
const ORIENTATION_INPUTS = Object.freeze(['x']);
const ORIENTATION_OUTPUTS = Object.freeze(['save_infer_model/scale_0.tmp_1']);
const RECOGNITION_INPUTS = Object.freeze(['x']);
const RECOGNITION_OUTPUTS = Object.freeze(['softmax_11.tmp_0']);
const OUTPUT_MEDIA_TYPES = new Set([
	'application/json', 'application/vnd.soundscaper.recognized-text+json',
]);
const DETECTOR_LIMIT = 960;
const RECOGNITION_HEIGHT = 48;
const RECOGNITION_WIDTH = 320;
const ORIENTATION_WIDTH = 192;
const CHARACTER_CLASSES = 6_625;
const MAXIMUM_REGIONS = 128;
const DETECTION_NORMALIZATION = Object.freeze({ channelOrder: 'bgr' as const,
	mean: Object.freeze([0.485, 0.456, 0.406] as const),
	standardDeviation: Object.freeze([0.229, 0.224, 0.225] as const), scale: 1 / 255 });
const TEXT_NORMALIZATION = Object.freeze({ channelOrder: 'bgr' as const,
	mean: Object.freeze([0.5, 0.5, 0.5] as const),
	standardDeviation: Object.freeze([0.5, 0.5, 0.5] as const), scale: 1 / 255 });

export function createAssistanceOnnxOcrWorkerAdapterV1(
	loadRuntime: AssistanceOnnxVisualRuntimeLoaderV1,
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) => Promise<unknown> {
	if (typeof loadRuntime !== 'function') throw new TypeError('The PP-OCR runtime loader is invalid.');
	return async (context) => executeOcr(context, loadRuntime);
}

async function executeOcr(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: AssistanceOnnxVisualRuntimeLoaderV1,
): Promise<unknown> {
	assertAssistanceOnnxVisualRuntimeJobV1(context, 'optical-character-recognition');
	assertSettingsAndGrants(context);
	const models = exactAssistanceOnnxVisualArtifactsV1(context.grant.models,
		'ppocr-v4-mobile', '4.0.0', MODEL_ROLES);
	const dictionary = await readDictionary(models.character_dictionary.path);
	context.signal?.throwIfAborted();
	context.onProgress(0);
	const source = await openAssistanceOnnxVisualFrameSourceV1(context.grant.inputs, context.signal);
	const runtime = assistanceOnnxRuntimeValueV1(
		await loadRuntime(context.job.descriptor.entrypoint),
	);
	const [detector, orientation, recognizer] = await Promise.all([
		createAssistanceOnnxVisualCpuSessionV1(runtime,
			models.text_detection.path, DETECTION_INPUTS, DETECTION_OUTPUTS),
		createAssistanceOnnxVisualCpuSessionV1(runtime,
			models.text_orientation.path, ORIENTATION_INPUTS, ORIENTATION_OUTPUTS),
		createAssistanceOnnxVisualCpuSessionV1(runtime,
			models.text_recognition.path, RECOGNITION_INPUTS, RECOGNITION_OUTPUTS),
	]);
	const frames: unknown[] = [];
	try {
		for (let index = 0; index < source.frameCount; index += 1) {
			context.signal?.throwIfAborted();
			const frame = await source.readFrame(index);
			const boxes = await detectText(runtime, detector, frame.rgba,
				source.rasterWidth, source.rasterHeight);
			const regions: AssistanceOcrRegionV1[] = [];
			for (const candidate of boxes) {
				context.signal?.throwIfAborted();
				const recognized = await recognizeText(runtime, orientation, recognizer,
					frame.rgba, source.rasterWidth, source.rasterHeight, candidate.box, dictionary);
				if (recognized) regions.push(Object.freeze({ ...recognized, box: candidate.box,
					confidence: Math.fround(Math.sqrt(candidate.confidence * recognized.confidence)) }));
			}
			frames.push(Object.freeze({ sourceFrame: frame.sourceFrame,
				presentationTick: frame.presentationTick, regions: Object.freeze(regions) }));
			context.onProgress((index + 1) / (source.frameCount + 1));
		}
		const authority = assistanceOnnxVisualAuthorityJsonV1(source);
		const reviewed = reviewAssistanceOcrResultV1({ schemaVersion: 1,
			width: source.width, height: source.height, timescale: source.timescale, frames }, authority);
		return await publishAssistanceOnnxVisualOutputV1(
			context, Buffer.from(JSON.stringify(reviewed), 'utf8'),
		);
	} finally {
		source.release();
		await Promise.all([detector.release?.(), orientation.release?.(), recognizer.release?.()]);
	}
}

async function detectText(
	runtime: AssistanceOnnxRuntimeModuleV1,
	session: AssistanceOnnxInferenceSessionV1,
	rgba: Uint8Array,
	width: number,
	height: number,
): Promise<readonly Readonly<{ box: AssistanceOcrRegionV1['box']; confidence: number }>[]> {
	const scale = Math.min(1, DETECTOR_LIMIT / Math.max(width, height));
	const detectorWidth = multiple32(Math.max(32, Math.round(width * scale)));
	const detectorHeight = multiple32(Math.max(32, Math.round(height * scale)));
	const input = resizeAssistanceRgbaToChwFloatV1(rgba, width, height,
		detectorWidth, detectorHeight, DETECTION_NORMALIZATION);
	const outputs = exactAssistanceOnnxOutputsV1(await session.run({
		x: new runtime.Tensor('float32', input, [1, 3, detectorHeight, detectorWidth]),
	}), DETECTION_OUTPUTS);
	const probabilities = exactAssistanceFloatTensorV1(outputs[DETECTION_OUTPUTS[0]],
		[1, 1, detectorHeight, detectorWidth], 'PP-OCR detection probability');
	return connectedTextRegions(probabilities, detectorWidth, detectorHeight);
}

function connectedTextRegions(
	probabilities: Float32Array,
	width: number,
	height: number,
): readonly Readonly<{ box: AssistanceOcrRegionV1['box']; confidence: number }>[] {
	const visited = new Uint8Array(probabilities.length);
	const queue = new Int32Array(probabilities.length);
	const result: Array<Readonly<{ box: AssistanceOcrRegionV1['box']; confidence: number }>> = [];
	for (let start = 0; start < probabilities.length; start += 1) {
		const probability = probabilities[start]!;
		if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
			throw new RangeError('PP-OCR detection probabilities are invalid.');
		}
		if (visited[start] || probability < 0.3) continue;
		let read = 0;
		let write = 1;
		queue[0] = start;
		visited[start] = 1;
		let left = width;
		let right = 0;
		let top = height;
		let bottom = 0;
		let total = 0;
		while (read < write) {
			const index = queue[read++]!;
			const x = index % width;
			const y = Math.floor(index / width);
			left = Math.min(left, x);
			right = Math.max(right, x + 1);
			top = Math.min(top, y);
			bottom = Math.max(bottom, y + 1);
			total += probabilities[index]!;
			for (const neighbor of neighbors(index, x, y, width, height)) {
				if (!visited[neighbor] && probabilities[neighbor]! >= 0.3) {
					visited[neighbor] = 1;
					queue[write++] = neighbor;
				}
			}
		}
		const confidence = total / write;
		if (write < 4 || confidence < 0.5) continue;
		const paddingX = Math.max(2, (right - left) * 0.1);
		const paddingY = Math.max(2, (bottom - top) * 0.1);
		const box = assistanceNormalizedBoxV1((left - paddingX) / width,
			(top - paddingY) / height, (right + paddingX) / width, (bottom + paddingY) / height);
		if (box) result.push(Object.freeze({ box, confidence: Math.fround(confidence) }));
	}
	result.sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x
		|| right.confidence - left.confidence);
	return Object.freeze(result.slice(0, MAXIMUM_REGIONS));
}

async function recognizeText(
	runtime: AssistanceOnnxRuntimeModuleV1,
	orientation: AssistanceOnnxInferenceSessionV1,
	recognizer: AssistanceOnnxInferenceSessionV1,
	rgba: Uint8Array,
	width: number,
	height: number,
	box: AssistanceOcrRegionV1['box'],
	dictionary: readonly string[],
): Promise<Readonly<{ text: string; confidence: number }> | null> {
	const crop: AssistanceVisualCropV1 = Object.freeze({ left: box.x, top: box.y,
		right: box.x + box.width, bottom: box.y + box.height });
	const orientationInput = resizeAssistanceRgbaToChwFloatV1(rgba, width, height,
		ORIENTATION_WIDTH, RECOGNITION_HEIGHT, TEXT_NORMALIZATION, crop);
	const orientationOutputs = exactAssistanceOnnxOutputsV1(await orientation.run({
		x: new runtime.Tensor('float32', orientationInput,
			[1, 3, RECOGNITION_HEIGHT, ORIENTATION_WIDTH]),
	}), ORIENTATION_OUTPUTS);
	const orientationScores = exactAssistanceFloatTensorV1(orientationOutputs[ORIENTATION_OUTPUTS[0]],
		[1, 2], 'PP-OCR orientation');
	if (orientationScores.some((score) => score < 0 || score > 1)) {
		throw new RangeError('PP-OCR orientation probabilities are invalid.');
	}
	const aspect = box.width * width / (box.height * height);
	const contentWidth = Math.max(1, Math.min(RECOGNITION_WIDTH,
		Math.ceil(RECOGNITION_HEIGHT * aspect)));
	const content = resizeAssistanceRgbaToChwFloatV1(rgba, width, height,
		contentWidth, RECOGNITION_HEIGHT, TEXT_NORMALIZATION, crop);
	const input = paddedRecognitionTensor(content, contentWidth,
		orientationScores[1]! > orientationScores[0]! && orientationScores[1]! >= 0.9);
	const outputs = exactAssistanceOnnxOutputsV1(await recognizer.run({
		x: new runtime.Tensor('float32', input,
			[1, 3, RECOGNITION_HEIGHT, RECOGNITION_WIDTH]),
	}), RECOGNITION_OUTPUTS);
	return decodeRecognition(outputs[RECOGNITION_OUTPUTS[0]], dictionary);
}

function paddedRecognitionTensor(
	content: Float32Array,
	contentWidth: number,
	rotate: boolean,
): Float32Array {
	const result = new Float32Array(3 * RECOGNITION_HEIGHT * RECOGNITION_WIDTH);
	for (let channel = 0; channel < 3; channel += 1) {
		for (let y = 0; y < RECOGNITION_HEIGHT; y += 1) {
			for (let x = 0; x < contentWidth; x += 1) {
				const sourceX = rotate ? contentWidth - x - 1 : x;
				const sourceY = rotate ? RECOGNITION_HEIGHT - y - 1 : y;
				result[channel * RECOGNITION_HEIGHT * RECOGNITION_WIDTH
					+ y * RECOGNITION_WIDTH + x] = content[
					channel * RECOGNITION_HEIGHT * contentWidth + sourceY * contentWidth + sourceX]!;
			}
		}
	}
	return result;
}

function decodeRecognition(
	value: AssistanceOnnxTensorV1 | undefined,
	dictionary: readonly string[],
): Readonly<{ text: string; confidence: number }> | null {
	const steps = value?.dims[1];
	if (!value || value.type !== 'float32' || !(value.data instanceof Float32Array)
		|| value.dims.length !== 3 || value.dims[0] !== 1 || value.dims[2] !== CHARACTER_CLASSES
		|| !Number.isSafeInteger(steps) || Number(steps) < 1 || Number(steps) > 320
		|| value.data.length !== Number(steps) * CHARACTER_CLASSES) {
		throw new RangeError('The PP-OCR recognition tensor geometry is invalid.');
	}
	let prior = -1;
	let text = '';
	let confidenceTotal = 0;
	let confidenceCount = 0;
	for (let step = 0; step < Number(steps); step += 1) {
		let bestClass = 0;
		let bestScore = -1;
		for (let classId = 0; classId < CHARACTER_CLASSES; classId += 1) {
			const score = value.data[step * CHARACTER_CLASSES + classId]!;
			if (!Number.isFinite(score) || score < 0 || score > 1) {
				throw new RangeError('PP-OCR recognition probabilities are invalid.');
			}
			if (score > bestScore) { bestClass = classId; bestScore = score; }
		}
		if (bestClass !== 0 && bestClass !== prior) {
			const character = bestClass === CHARACTER_CLASSES - 1 ? ' ' : dictionary[bestClass - 1];
			if (character === undefined) throw new RangeError('PP-OCR emitted an unknown character ID.');
			text += character;
			confidenceTotal += bestScore;
			confidenceCount += 1;
		}
		prior = bestClass;
	}
	text = text.trim();
	const confidence = confidenceCount === 0 ? 0 : confidenceTotal / confidenceCount;
	if (text.length < 1 || text.length > 2_048 || confidence < 0.5) return null;
	return Object.freeze({ text, confidence: Math.fround(confidence) });
}

async function readDictionary(path: string): Promise<readonly string[]> {
	let text: string;
	try { text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path)); }
	catch { throw new TypeError('The PP-OCR character dictionary is not canonical UTF-8.'); }
	const rows = text.split('\n');
	if (rows.at(-1) === '') rows.pop();
	if (rows.length !== CHARACTER_CLASSES - 2
		|| rows.some((row) => row.length < 1 || row.length > 16 || /[\r\u0000]/u.test(row))) {
		throw new TypeError('The PP-OCR character dictionary is invalid.');
	}
	return Object.freeze(rows);
}

function assertSettingsAndGrants(context: AssistanceRuntimeFamilyWorkerExecutionContext): void {
	const { grant, settings } = context;
	if (grant.inputs.length < 1 || grant.inputs.some(({ role, mediaType }) =>
		role !== 'frame-pack' || mediaType !== 'application/vnd.soundscaper.frame-pack')
		|| grant.outputs.length !== 1 || grant.outputs[0]!.role !== 'recognized-text'
		|| !OUTPUT_MEDIA_TYPES.has(grant.outputs[0]!.mediaType)
		|| settings.schemaVersion !== 1 || settings.operation !== 'optical-character-recognition'
		|| JSON.stringify(settings.inputRoles) !== JSON.stringify(grant.inputs.map(() => 'frame-pack'))
		|| JSON.stringify(settings.outputRoles) !== '["recognized-text"]') {
		throw new TypeError('PP-OCR grants/settings do not bind exact OCR execution.');
	}
}

function neighbors(index: number, x: number, y: number, width: number, height: number): number[] {
	const result: number[] = [];
	if (x > 0) result.push(index - 1);
	if (x + 1 < width) result.push(index + 1);
	if (y > 0) result.push(index - width);
	if (y + 1 < height) result.push(index + width);
	return result;
}

function multiple32(value: number): number {
	return Math.max(32, Math.ceil(value / 32) * 32);
}
