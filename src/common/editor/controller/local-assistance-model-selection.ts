/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Chooses the models a local assistance operation admits, and in which slot order.
 *
 * Like prepared-media normalization, this is controller-owned policy rather than
 * presentation: Advanced workflow preparation reaches it from editor core, which must stay
 * independent of the presentation modules. `assistance/local-assistance-preparation.ts`
 * re-exports it for the session stores that have always imported it from there.
 */

import type { AssistanceOperation } from '../assistance/operation.ts';
import {
	LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_ID,
	LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_TASK,
	normalizeLocalAssistanceShotDetectionMode,
	type LocalAssistanceShotDetectionMode,
} from '../assistance/shot-detection-mode.ts';
import type { LocalAssistanceModel } from '../assistance/local-assistance-bridge.ts';
import type { LocalAssistanceModelTaskSlot } from '../assistance/local-assistance-preparation.ts';

const MODEL_TASK_SLOTS = Object.freeze({
	'voice-activity-detection': modelTaskSlots(['voice-activity-detection']),
	'speech-recognition': modelTaskSlots(['speech-recognition']),
	'word-alignment': modelTaskSlots(['word-alignment']),
	'speaker-diarization': modelTaskSlots(['speaker-segmentation'], ['speaker-embedding']),
	'speech-enhancement': modelTaskSlots(['speech-enhancement']),
	'dereverberation': modelTaskSlots(['dereverberation']),
	'source-separation': modelTaskSlots(['source-separation']),
	'audio-tagging': modelTaskSlots(['audio-tagging']),
	'beat-tracking': modelTaskSlots(['beat-tracking']),
	'text-embedding': modelTaskSlots(['text-embedding']),
	'image-text-embedding': modelTaskSlots(['image-text-embedding']),
	'optical-character-recognition': modelTaskSlots(['optical-character-recognition']),
	'shot-detection': modelTaskSlots(),
	'subject-detection': modelTaskSlots(['face-detection'], ['object-detection']),
	'saliency-detection': modelTaskSlots(['saliency-detection']),
	'editorial-generation': modelTaskSlots(['editorial-generation']),
} satisfies Readonly<Record<AssistanceOperation, readonly LocalAssistanceModelTaskSlot[]>>);

const ACCURATE_SHOT_MODEL_TASK_SLOTS = modelTaskSlots([LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_TASK]);

const YUNET_FACE_DETECTION_MODEL_ID = 'yunet-face-detection-2026may';
const DFINE_OBJECT_DETECTION_MODEL_ID = 'dfine-nano-coco';

export function localAssistanceModelCompatible(
	operation: AssistanceOperation,
	model: LocalAssistanceModel,
	shotDetectionMode?: LocalAssistanceShotDetectionMode,
): boolean {
	const slots = operationModelTaskSlots(operation, shotDetectionMode);
	return slots.some((slot) => slot.includes(model.task))
		&& (operation !== 'shot-detection' || model.modelId === LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_ID)
		&& (operation !== 'subject-detection'
			|| model.task === 'face-detection' && model.modelId === YUNET_FACE_DETECTION_MODEL_ID
			|| model.task === 'object-detection' && model.modelId === DFINE_OBJECT_DETECTION_MODEL_ID);
}

export function localAssistanceModelTaskSlots(
	operation: AssistanceOperation,
	shotDetectionMode?: LocalAssistanceShotDetectionMode,
): readonly LocalAssistanceModelTaskSlot[] {
	return operationModelTaskSlots(operation, shotDetectionMode);
}

export function localAssistanceOperationModelsAvailable(
	operation: AssistanceOperation,
	models: readonly LocalAssistanceModel[],
	shotDetectionMode?: LocalAssistanceShotDetectionMode,
): boolean {
	return operationModelTaskSlots(operation, shotDetectionMode).every(
		(slot) => models.some((model) => slot.includes(model.task)
			&& localAssistanceModelCompatible(operation, model, shotDetectionMode)),
	);
}

export function localAssistanceSelectedModels(
	operation: AssistanceOperation,
	models: readonly LocalAssistanceModel[],
	selectedModelIds: readonly string[],
	shotDetectionMode?: LocalAssistanceShotDetectionMode,
): readonly LocalAssistanceModel[] | null {
	const slots = operationModelTaskSlots(operation, shotDetectionMode);
	if (new Set(selectedModelIds).size !== selectedModelIds.length) return null;
	const selected = selectedModelIds.map(
		(modelId) => models.find((model) => model.modelId === modelId) ?? null,
	);
	if (selected.some((model) => model === null)) return null;
	const resolved = selected as readonly LocalAssistanceModel[];
	if (resolved.length !== slots.length || resolved.some(
		(model) => !localAssistanceModelCompatible(operation, model, shotDetectionMode),
	)) return null;
	const ordered: LocalAssistanceModel[] = [];
	for (const slot of slots) {
		const matches = resolved.filter((model) => slot.includes(model.task)
			&& localAssistanceModelCompatible(operation, model, shotDetectionMode));
		if (matches.length !== 1) return null;
		ordered.push(matches[0]!);
	}
	return Object.freeze(ordered);
}

function operationModelTaskSlots(
	operation: AssistanceOperation,
	shotDetectionMode?: LocalAssistanceShotDetectionMode,
): readonly LocalAssistanceModelTaskSlot[] {
	if (operation !== 'shot-detection') {
		if (shotDetectionMode !== undefined) throw new TypeError('Only Mark Cuts has a detection mode.');
		return MODEL_TASK_SLOTS[operation];
	}
	const mode = shotDetectionMode === undefined
		? 'fast' : normalizeLocalAssistanceShotDetectionMode(shotDetectionMode);
	return mode === 'accurate' ? ACCURATE_SHOT_MODEL_TASK_SLOTS : MODEL_TASK_SLOTS[operation];
}

function modelTaskSlots(
	...slots: readonly (readonly string[])[]
): readonly LocalAssistanceModelTaskSlot[] {
	return Object.freeze(slots.map((slot) => Object.freeze([...slot])));
}
