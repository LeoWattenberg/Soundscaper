/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated CPU U²-Net-P saliency detection over VFR-bound sampled frames. */

import {
	reviewAssistanceSaliencyResultV1,
} from '../src/common/editor/assistance/visual-semantic-results-v1.ts';
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
	exactAssistanceFloatTensorV1,
	resizeAssistanceRgbaToChwFloatV1,
} from './assistance-onnx-visual-tensors.ts';

const MODEL_ROLES = Object.freeze(['u2netp'] as const);
const INPUT_NAMES = Object.freeze(['input.1']);
const OUTPUT_NAMES = Object.freeze(['1959', '1960', '1961', '1962', '1963', '1964', '1965']);
const OUTPUT_MEDIA_TYPES = new Set([
	'application/json', 'application/vnd.soundscaper.saliency-map+json',
]);
const SIZE = 320;
const NORMALIZATION = Object.freeze({ channelOrder: 'rgb' as const,
	mean: Object.freeze([0.485, 0.456, 0.406] as const),
	standardDeviation: Object.freeze([0.229, 0.224, 0.225] as const), scale: 1 / 255 });

export function createAssistanceOnnxSaliencyWorkerAdapterV1(
	loadRuntime: AssistanceOnnxVisualRuntimeLoaderV1,
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) => Promise<unknown> {
	if (typeof loadRuntime !== 'function') throw new TypeError('The saliency runtime loader is invalid.');
	return async (context) => executeSaliency(context, loadRuntime);
}

async function executeSaliency(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	loadRuntime: AssistanceOnnxVisualRuntimeLoaderV1,
): Promise<unknown> {
	assertAssistanceOnnxVisualRuntimeJobV1(context, 'saliency-detection');
	assertSettingsAndGrants(context);
	const models = exactAssistanceOnnxVisualArtifactsV1(context.grant.models,
		'u2netp-saliency', '1.0.0', MODEL_ROLES);
	context.onProgress(0);
	const source = await openAssistanceOnnxVisualFrameSourceV1(context.grant.inputs, context.signal);
	const runtime = assistanceOnnxRuntimeValueV1(
		await loadRuntime(context.job.descriptor.entrypoint),
	);
	const session = await createAssistanceOnnxVisualCpuSessionV1(
		runtime, models.u2netp.path, INPUT_NAMES, OUTPUT_NAMES,
	);
	const frames: unknown[] = [];
	try {
		for (let index = 0; index < source.frameCount; index += 1) {
			context.signal?.throwIfAborted();
			const frame = await source.readFrame(index);
			const data = resizeAssistanceRgbaToChwFloatV1(frame.rgba,
				source.rasterWidth, source.rasterHeight, SIZE, SIZE, NORMALIZATION);
			const outputs = exactAssistanceOnnxOutputsV1(await session.run({
				'input.1': new runtime.Tensor('float32', data, [1, 3, SIZE, SIZE]),
			}), OUTPUT_NAMES);
			for (const name of OUTPUT_NAMES) {
				exactAssistanceFloatTensorV1(outputs[name], [1, 1, SIZE, SIZE],
					`U2-Net-P ${name}`);
			}
			frames.push(Object.freeze({ sourceFrame: frame.sourceFrame,
				presentationTick: frame.presentationTick,
				saliency: saliencyPoint(outputs['1959']!.data as Float32Array) }));
			context.onProgress((index + 1) / (source.frameCount + 1));
		}
		const authority = assistanceOnnxVisualAuthorityJsonV1(source);
		const reviewed = reviewAssistanceSaliencyResultV1({ schemaVersion: 1,
			width: source.width, height: source.height, timescale: source.timescale, frames }, authority);
		return await publishAssistanceOnnxVisualOutputV1(
			context, Buffer.from(JSON.stringify(reviewed), 'utf8'),
		);
	} finally {
		source.release();
		await session.release?.();
	}
}

function assertSettingsAndGrants(context: AssistanceRuntimeFamilyWorkerExecutionContext): void {
	const { grant, settings } = context;
	if (grant.inputs.length < 1 || grant.inputs.some(({ role, mediaType }) =>
		role !== 'frame-pack' || mediaType !== 'application/vnd.soundscaper.frame-pack')
		|| grant.outputs.length !== 1 || grant.outputs[0]!.role !== 'saliency-map'
		|| !OUTPUT_MEDIA_TYPES.has(grant.outputs[0]!.mediaType)
		|| settings.schemaVersion !== 1 || settings.operation !== 'saliency-detection'
		|| JSON.stringify(settings.inputRoles) !== JSON.stringify(grant.inputs.map(() => 'frame-pack'))
		|| JSON.stringify(settings.outputRoles) !== '["saliency-map"]') {
		throw new TypeError('U2-Net-P grants/settings do not bind exact saliency detection.');
	}
}

function saliencyPoint(data: Float32Array): Readonly<{
	x: number; y: number; score: number;
}> | null {
	let minimum = 1;
	let maximum = 0;
	for (const value of data) {
		if (value < 0 || value > 1) throw new RangeError('U2-Net-P saliency probabilities are invalid.');
		minimum = Math.min(minimum, value);
		maximum = Math.max(maximum, value);
	}
	const range = maximum - minimum;
	if (maximum <= 0.05 || range <= 1e-6) return null;
	let total = 0;
	let weightedX = 0;
	let weightedY = 0;
	for (let index = 0; index < data.length; index += 1) {
		const weight = Math.max(0, (data[index]! - minimum) / range - 0.5);
		if (weight === 0) continue;
		total += weight;
		weightedX += ((index % SIZE) + 0.5) / SIZE * weight;
		weightedY += (Math.floor(index / SIZE) + 0.5) / SIZE * weight;
	}
	if (total <= 1e-12) return null;
	return Object.freeze({ x: Math.fround(weightedX / total),
		y: Math.fround(weightedY / total), score: Math.fround(maximum) });
}
