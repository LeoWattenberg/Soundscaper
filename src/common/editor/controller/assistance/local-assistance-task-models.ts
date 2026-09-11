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

export function assistanceTaskModelsReady(settings: AssistanceWorkflowSettingsV1,
	models: readonly LocalAssistanceModel[], inventory: readonly Readonly<{ mediaKind: string }>[],
): boolean {
	const stages = selectLocalAssistanceGuidedStages(
		assistanceWorkflowStageGraph(settings.workflowId), settings, models, inventory,
	);
	return stages !== null && stages.every((stage) => stage.modelSlots.every((slot) => {
		const accurate = (settings.workflowId === 'mark-cuts' && settings.mode === 'accurate')
			|| (settings.workflowId === 'index-video' && settings.shotMode === 'accurate');
		if (!slot.required && !accurate) return true;
		return models.filter((model) => localAssistanceGuidedModelMatches(slot.slotId, model, settings)).length === 1;
	}));
}
