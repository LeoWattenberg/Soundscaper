/* SPDX-License-Identifier: AGPL-3.0-only */

/** Runtime archives needed by each reviewed model in the local catalog. */

import type { AssistanceRuntimeDistributionFamily } from './assistance-runtime-distribution.ts';

const SHERPA_TASKS = new Set([
	'voice-activity-detection', 'speaker-segmentation', 'speaker-embedding',
]);
const ONNX_TASKS = new Set([
	'speech-enhancement', 'face-detection', 'object-detection', 'saliency-detection',
	'optical-character-recognition', 'text-embedding', 'image-text-embedding',
	'word-alignment', 'source-separation', 'audio-tagging', 'beat-tracking',
	'shot-detection', 'dereverberation',
]);

export function assistanceRuntimeFamiliesForModel(
	modelId: string,
	task: string,
): readonly AssistanceRuntimeDistributionFamily[] {
	if (task === 'speech-recognition') {
		return Object.freeze([modelId === 'whisper-large-v3-turbo-ggml'
			? 'whisper-cpp' : 'sherpa-onnx-node']);
	}
	if (SHERPA_TASKS.has(task)) return Object.freeze(['sherpa-onnx-node']);
	if (task === 'editorial-generation') return Object.freeze(['llama-cpp']);
	if (task === 'text-to-speech') return Object.freeze(['onnxruntime-node', 'kokoro-g2p']);
	if (ONNX_TASKS.has(task)) return Object.freeze(['onnxruntime-node']);
	throw new TypeError(`No reviewed runtime mapping exists for local model ${modelId}.`);
}
