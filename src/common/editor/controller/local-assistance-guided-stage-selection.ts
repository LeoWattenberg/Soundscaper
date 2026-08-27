/* SPDX-License-Identifier: AGPL-3.0-only */

/** Settings-, inventory-, and exact-model-bound optional Guided stage selection. */

import type { AssistanceWorkflowStageSpec } from '../assistance/workflow.ts';
import type { AssistanceWorkflowSettingsV1 } from '../assistance/workflow-settings-v1.ts';
import type { LocalAssistanceModel } from '../ui/local-assistance-bridge.ts';
import { localAssistanceGuidedModelCandidates } from './local-assistance-guided-model-selection.ts';

export function selectLocalAssistanceGuidedStages(
	graph: readonly AssistanceWorkflowStageSpec[],
	settings: AssistanceWorkflowSettingsV1,
	models: readonly LocalAssistanceModel[],
	inventory: readonly Readonly<{ mediaKind: string }>[],
): readonly AssistanceWorkflowStageSpec[] | null {
	if (settings.workflowId === 'generate-editorial-text' && !settings.enabled) return null;
	return Object.freeze(graph.filter((stage) => {
		if (stage.required) return true;
		if (stage.stageId === 'align-words') return settings.workflowId === 'transcribe-captions'
			&& settings.recognizer === 'whisper'
			&& (settings.language === 'en' || settings.language === 'auto')
			&& settings.englishWhisperAlignment === 'when-installed'
			&& hasExactModel('alignment', models, settings);
		if (stage.stageId === 'recognize-speech') {
			return hasExactModel('speech-recognizer', models, settings);
		}
		if (stage.stageId === 'recognize-text') {
			return settings.workflowId === 'index-video' && settings.includeOcr;
		}
		if (stage.stageId === 'tag-highlight-reactions') {
			return settings.workflowId === 'make-highlights'
				&& inventory.some(({ mediaKind }) => mediaKind === 'audio')
				&& hasExactModel('audio-tagger', models, settings);
		}
		if (stage.stageId === 'rerank-editorial') return settings.workflowId === 'make-highlights'
			&& settings.editorialRerank;
		return false;
	}));
}

function hasExactModel(
	slotId: string,
	models: readonly LocalAssistanceModel[],
	settings: AssistanceWorkflowSettingsV1,
): boolean {
	return localAssistanceGuidedModelCandidates(slotId, models, settings).length > 0;
}
