/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	ASSISTANCE_WORKFLOW_CONTRACT_VERSION,
	ASSISTANCE_WORKFLOW_FENCE_VERSION,
	assistanceWorkflowModelBindingsSha256V1,
	assistanceWorkflowRecipeSha256V1,
	normalizeAssistanceWorkflowId,
	type AssistanceWorkflowV1,
} from '../../src/common/editor/assistance/workflow.ts';
import {
	assistanceWorkflowSettingsSha256V1,
	defaultAssistanceWorkflowSettingsV1,
} from '../../src/common/editor/assistance/workflow-settings-v1.ts';

export const WORKFLOW_JOB_ID = '01'.repeat(20);

export function assistanceWorkflowFixture(
	overrides: Readonly<Record<string, unknown>> = {},
): AssistanceWorkflowV1 {
	const jobId = typeof overrides.jobId === 'string' ? overrides.jobId : WORKFLOW_JOB_ID;
	const workflowId = normalizeAssistanceWorkflowId(
		overrides.workflowId ?? 'transcribe-captions',
	);
	const settings = (overrides.settings ?? defaultAssistanceWorkflowSettingsV1(workflowId)) as
		AssistanceWorkflowV1['settings'];
	const defaultStageIds = ['detect-speech', 'recognize-speech', 'assemble-captions'] as const;
	const stageIds = (Array.isArray(overrides.stageIds) ? overrides.stageIds : defaultStageIds) as
		readonly string[];
	const defaultModels = [
		{ bindingVersion: 1 as const, stageId: 'detect-speech', slotId: 'vad', modelId: 'silero-vad',
			version: '6.2.0', artifactSha256s: ['01'.repeat(32)] },
		{ bindingVersion: 1 as const, stageId: 'recognize-speech', slotId: 'speech-recognizer',
			modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0', artifactSha256s: ['02'.repeat(32)] },
	];
	const models = (Array.isArray(overrides.models) ? overrides.models : defaultModels) as
		AssistanceWorkflowV1['models'];
	const defaultFence = {
		fenceVersion: ASSISTANCE_WORKFLOW_FENCE_VERSION,
		projectId: 'project-a',
		schemaVersion: 31,
		revision: 8,
		sequenceId: 'sequence-a',
		sourceRanges: [{
			slotId: 'primary-audio', mediaKind: 'audio' as const, sourceId: 'source-a',
			sourceSha256: '12'.repeat(32), sourceSampleRate: 48_000,
			occurrenceIds: ['occurrence-a'],
			sourceStartFrame: 0, sourceEndFrame: 96_000,
			linkMembershipSha256: '34'.repeat(32), timingAuthoritySha256: '56'.repeat(32),
			retimeKind: 'identity' as const,
		}],
		transcriptBodySha256: null,
		recipeSha256: assistanceWorkflowRecipeSha256V1(workflowId, 1, stageIds),
		settingsSha256: assistanceWorkflowSettingsSha256V1(settings),
		modelBindingsSha256: assistanceWorkflowModelBindingsSha256V1(models),
	};
	return {
		contractVersion: ASSISTANCE_WORKFLOW_CONTRACT_VERSION,
		jobId,
		workflowId,
		recipeVersion: 1,
		settingsVersion: 1,
		settings,
		fence: defaultFence,
		stageIds,
		models,
		inputs: [
			claim('input', jobId, 'detect-speech', 'audio', 1),
			claim('input', jobId, 'recognize-speech', 'audio', 2),
			claim('input', jobId, 'assemble-captions', 'transcript', 3),
		],
		outputs: [
			claim('output', jobId, 'detect-speech', 'voice-activity', 4),
			claim('output', jobId, 'recognize-speech', 'transcript', 5),
			claim('output', jobId, 'assemble-captions', 'captions', 6),
		],
		...overrides,
	} as AssistanceWorkflowV1;
}

function claim(
	direction: 'input' | 'output',
	jobId: string,
	stageId: string,
	slotId: string,
	index: number,
) {
	return {
		claimVersion: 1 as const,
		direction,
		claimId: index.toString(16).padStart(40, '0'),
		jobId,
		stageId,
		slotId,
	};
}
