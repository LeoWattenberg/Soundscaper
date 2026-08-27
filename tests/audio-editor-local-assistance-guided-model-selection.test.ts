/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import { localAssistanceGuidedModelCandidates, localAssistanceGuidedModelMatches } from
	'../src/common/editor/controller/local-assistance-guided-model-selection.ts';
import type { LocalAssistanceModel } from
	'../src/common/editor/ui/local-assistance-bridge.ts';

test('Guided Parakeet and Whisper preparation select one exact engine without substitution', () => {
	const parakeetSettings = defaultAssistanceWorkflowSettingsV1('transcribe-captions');
	const installed = [
		model('parakeet-tdt-0.6b-v2', '2.0.0', 'speech-recognition', 1),
		model('parakeet-tdt-0.6b-v3', '3.0.0', 'speech-recognition', 2),
		model('whisper-large-v3-turbo-ggml', '1.0.0', 'speech-recognition', 3),
	];
	assert.deepEqual(localAssistanceGuidedModelCandidates(
		'speech-recognizer', installed, parakeetSettings,
	).map(({ modelId, version }) => ({ modelId, version })), [
		{ modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0' },
	]);
	if (parakeetSettings.workflowId !== 'transcribe-captions') assert.fail('Settings identity changed.');
	const whisperSettings = { ...parakeetSettings, recognizer: 'whisper' as const };
	assert.deepEqual(localAssistanceGuidedModelCandidates(
		'speech-recognizer', installed, whisperSettings,
	).map(({ modelId }) => modelId), ['whisper-large-v3-turbo-ggml']);
	assert.equal(localAssistanceGuidedModelMatches('speech-recognizer',
		model('whisper-large-v3-turbo-ggml', '1.0.1', 'speech-recognition', 4),
		whisperSettings), false, 'another Whisper version cannot substitute for the catalog pin');
});

test('Guided Beat This preparation pins small0 while final0 remains explicit-only', () => {
	const settings = defaultAssistanceWorkflowSettingsV1('detect-beats-tempo');
	const installed = [model('beat-this-final0', '1.1.0', 'beat-tracking', 1),
		model('beat-this-small0', '1.1.0', 'beat-tracking', 2)];
	assert.deepEqual(localAssistanceGuidedModelCandidates(
		'beat-tracker', installed, settings,
	).map(({ modelId, version }) => ({ modelId, version })), [
		{ modelId: 'beat-this-small0', version: '1.1.0' },
	]);
	assert.equal(localAssistanceGuidedModelMatches('beat-tracker', installed[0]!, settings), false);
	assert.equal(localAssistanceGuidedModelMatches('beat-tracker',
		model('beat-this-small0', '1.1.1', 'beat-tracking', 3), settings), false);
});

function model(
	modelId: string,
	version: string,
	task: string,
	ordinal: number,
): LocalAssistanceModel {
	return Object.freeze({ modelId, version, task,
		artifactSha256s: Object.freeze([ordinal.toString(16).padStart(64, '0')]) });
}
