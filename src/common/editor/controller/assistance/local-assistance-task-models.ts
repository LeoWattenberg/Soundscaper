/* SPDX-License-Identifier: AGPL-3.0-only */
import { assistanceWorkflowStageGraph } from '../../assistance/workflow-recipes.ts';
import type { AssistanceWorkflowSettingsV1 } from '../../assistance/workflow-settings-v1.ts';
import type { LocalAssistanceModel } from '../../assistance/local-assistance-bridge.ts';
import { localAssistanceGuidedModelMatches } from
	'./internal/guided/local-assistance-guided-model-selection.ts';
import { selectLocalAssistanceGuidedStages } from
	'./internal/guided/local-assistance-guided-stage-selection.ts';

type Model = Pick<LocalAssistanceModel, 'modelId' | 'version' | 'task'>;

export function assistanceTaskModelFilter(settings: AssistanceWorkflowSettingsV1): (model: Model) => boolean {
	const slots = assistanceWorkflowStageGraph(settings.workflowId).flatMap((stage) => stage.modelSlots);
	return (model) => slots.some((slot) => localAssistanceGuidedModelMatches(slot.slotId, model, settings));
}

/** Include optional stages and selectable recognizers in a task's download catalog. */
export function assistanceTaskAvailableModelFilter(
	settings: AssistanceWorkflowSettingsV1,
): (model: Model) => boolean {
	const settingsOptions = settings.workflowId === 'transcribe-captions'
		? [{ ...settings, recognizer: 'parakeet' as const }, { ...settings, recognizer: 'whisper' as const }]
		: [settings];
	const filters = settingsOptions.map(assistanceTaskModelFilter);
	return (model) => filters.some((filter) => filter(model));
}

/** Model-free default paths can open without a model-download preflight. */
export function assistanceTaskRequiresModels(settings: AssistanceWorkflowSettingsV1): boolean {
	const graph = assistanceWorkflowStageGraph(settings.workflowId);
	const stages = selectLocalAssistanceGuidedStages(graph, settings, [], []) ?? graph;
	return stages.some((stage) => stage.modelSlots.some((slot) => slot.required || requiresAccurateModel(settings)));
}

export function assistanceTaskModelsReady(settings: AssistanceWorkflowSettingsV1,
	models: readonly Model[], inventory: readonly Readonly<{ mediaKind: string }>[],
): boolean {
	const graph = assistanceWorkflowStageGraph(settings.workflowId);
	const stages = selectLocalAssistanceGuidedStages(graph, settings, models, inventory) ?? graph;
	return stages.every((stage) => stage.modelSlots.every((slot) => {
		if (!slot.required && !requiresAccurateModel(settings)) return true;
		return models.filter((model) => localAssistanceGuidedModelMatches(slot.slotId, model, settings)).length === 1;
	}));
}

function requiresAccurateModel(settings: AssistanceWorkflowSettingsV1): boolean {
	return (settings.workflowId === 'mark-cuts' && settings.mode === 'accurate')
		|| (settings.workflowId === 'index-video' && settings.shotMode === 'accurate');
}
