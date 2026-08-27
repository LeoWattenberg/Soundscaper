/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assistanceWorkflowStageGraph } from
	'../src/common/editor/assistance/workflow-recipes.ts';
import { selectLocalAssistanceGuidedStages } from
	'../src/common/editor/controller/local-assistance-guided-stage-selection.ts';

const models = Object.freeze([
	{ modelId: 'silero-vad-v6', version: '6.2.1', task: 'voice-activity-detection',
		artifactSha256s: ['01'.repeat(32)] },
	{ modelId: 'whisper-large-v3-turbo-ggml', version: '1.0.0', task: 'speech-recognition',
		artifactSha256s: ['02'.repeat(32)] },
	{ modelId: 'wav2vec2-base-960h', version: '1.0.0', task: 'word-alignment',
		artifactSha256s: ['03'.repeat(32)] },
]);

test('auto-language Whisper retains alignment for worker-side English admission', () => {
	const graph = assistanceWorkflowStageGraph('transcribe-captions');
	const settings = { settingsVersion: 1 as const, workflowId: 'transcribe-captions' as const,
		recognizer: 'whisper' as const, language: 'auto' as const,
		englishWhisperAlignment: 'when-installed' as const };
	assert.deepEqual(selectLocalAssistanceGuidedStages(graph, settings, models, [])
		?.map(({ stageId }) => stageId), [
			'detect-speech', 'recognize-speech', 'align-words', 'assemble-captions',
		]);
	assert.equal(selectLocalAssistanceGuidedStages(graph,
		{ ...settings, englishWhisperAlignment: 'off' }, models, [])
		?.some(({ stageId }) => stageId === 'align-words'), false);
	assert.equal(selectLocalAssistanceGuidedStages(graph, settings, models.slice(0, 2), [])
		?.some(({ stageId }) => stageId === 'align-words'), false);
});
