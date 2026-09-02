/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed Guided defaults. Optional/Advanced alternatives never substitute for these identities. */

import type { AssistanceWorkflowSettingsV1 } from '../assistance/workflow-settings-v1.ts';
import type { LocalAssistanceModel } from '../ui/local-assistance-bridge.ts';

interface ExactGuidedModel {
	readonly modelId: string;
	readonly version: string;
	readonly task: string;
}

const EXACT_GUIDED_MODELS: Readonly<Record<string, ExactGuidedModel>> = Object.freeze({
	vad: exact('silero-vad-v6', '6.2.1', 'voice-activity-detection'),
	alignment: exact('wav2vec2-base-960h', '1.0.0', 'word-alignment'),
	diarizer: exact('pyannote-segmentation-3.0', '3.0.0', 'speaker-segmentation'),
	'speaker-embedding': exact('speech-3d-speaker-eres2net', '1.0.0', 'speaker-embedding'),
	enhancer: exact('deepfilternet3', '3.0.0', 'speech-enhancement'),
	dereverberator: exact('dereverb-room', '1.0.0', 'dereverberation'),
	separator: exact('tiger-dnr', '1.0.0', 'source-separation'),
	'audio-tagger': exact('panns-cnn10', '1.0.0', 'audio-tagging'),
	'beat-tracker': exact('beat-this-small0', '1.1.0', 'beat-tracking'),
	'text-embedder': exact('nomic-embed-text-v1.5', '1.5.0', 'text-embedding'),
	'accurate-shot-detector': exact('transnetv2', '1.0.0', 'shot-detection'),
	'visual-embedder': exact('siglip2-base-patch16-224', '2.0.0', 'image-text-embedding'),
	'text-detector': exact('ppocr-v4-mobile', '4.0.0', 'optical-character-recognition'),
	'text-recognizer': exact('ppocr-v4-mobile', '4.0.0', 'optical-character-recognition'),
	'face-detector': exact('yunet-face-detection-2026may', '2026.5.0', 'face-detection'),
	'object-detector': exact('dfine-nano-coco', '1.0.0', 'object-detection'),
	'saliency-detector': exact('u2netp-saliency', '1.0.0', 'saliency-detection'),
	'editorial-generator': exact('qwen3-4b-q4-k-m', '1.0.0', 'editorial-generation'),
});

const PARAKEET = exact('parakeet-tdt-0.6b-v3', '3.0.0', 'speech-recognition');
const WHISPER = exact('whisper-large-v3-turbo-ggml', '1.0.0', 'speech-recognition');

export function localAssistanceGuidedModelCandidates(
	slotId: string,
	models: readonly LocalAssistanceModel[],
	settings: AssistanceWorkflowSettingsV1,
): readonly LocalAssistanceModel[] {
	return Object.freeze(models.filter((model) =>
		localAssistanceGuidedModelMatches(slotId, model, settings)));
}

export function localAssistanceGuidedModelMatches(
	slotId: string,
	model: Pick<LocalAssistanceModel, 'modelId' | 'version' | 'task'>,
	settings: AssistanceWorkflowSettingsV1,
): boolean {
	const requirement = slotId === 'speech-recognizer'
		? settings.workflowId === 'transcribe-captions' && settings.recognizer === 'whisper'
			? WHISPER : PARAKEET
		: EXACT_GUIDED_MODELS[slotId];
	return requirement !== undefined && model.modelId === requirement.modelId
		&& model.version === requirement.version && model.task === requirement.task;
}

function exact(modelId: string, version: string, task: string): ExactGuidedModel {
	return Object.freeze({ modelId, version, task });
}
