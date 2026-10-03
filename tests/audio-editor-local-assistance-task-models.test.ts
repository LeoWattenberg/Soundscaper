/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assistanceTaskAvailableModelFilter,
	assistanceTaskModelFilter,
	assistanceTaskRequiresModels,
} from '../src/common/editor/controller/assistance/local-assistance-task-models.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';

test('enhancement preflight uses exact catalog identities without installed artifact metadata', () => {
	const settings = defaultAssistanceWorkflowSettingsV1('enhance-dialogue');
	const filter = assistanceTaskAvailableModelFilter(settings);
	assert.equal(assistanceTaskRequiresModels(settings), true);
	assert.equal(filter({ modelId: 'deepfilternet3', version: '3.0.0', task: 'speech-enhancement' }), true);
	assert.equal(filter({ modelId: 'deepfilternet3', version: '3.0.1', task: 'speech-enhancement' }), false);
	assert.equal(filter({ modelId: 'deepfilternet3', version: '3.0.0', task: 'dereverberation' }), false);
	assert.equal(filter({ modelId: 'dereverb-room', version: '1.0.0', task: 'dereverberation' }), false);
});

test('speaker identification preflight offers every required graph model', () => {
	const settings = defaultAssistanceWorkflowSettingsV1('identify-speakers');
	const filter = assistanceTaskAvailableModelFilter(settings);
	assert.equal(assistanceTaskRequiresModels(settings), true);
	assert.equal(filter({ modelId: 'pyannote-segmentation-3.0', version: '3.0.0',
		task: 'speaker-segmentation' }), true);
	assert.equal(filter({ modelId: 'speech-3d-speaker-eres2net', version: '1.0.0',
		task: 'speaker-embedding' }), true);
	assert.equal(filter({ modelId: 'silero-vad-v6', version: '6.2.1',
		task: 'voice-activity-detection' }), false);
});

test('transcription preflight offers both recognizers and optional alignment without changing selection', () => {
	const settings = defaultAssistanceWorkflowSettingsV1('transcribe-captions');
	const filter = assistanceTaskAvailableModelFilter(settings);
	const whisper = { modelId: 'whisper-large-v3-turbo-ggml', version: '1.0.0', task: 'speech-recognition' };
	assert.equal(assistanceTaskRequiresModels(settings), true);
	assert.equal(filter({ modelId: 'silero-vad-v6', version: '6.2.1', task: 'voice-activity-detection' }), true);
	assert.equal(filter({ modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0', task: 'speech-recognition' }), true);
	assert.equal(filter(whisper), true);
	assert.equal(filter({ ...whisper, version: '1.0.1' }), false);
	assert.equal(filter({ modelId: 'wav2vec2-base-960h', version: '1.0.0', task: 'word-alignment' }), true);
	assert.equal(assistanceTaskModelFilter(settings)(whisper), false);
	assert.equal(filter({ modelId: 'parakeet-tdt-0.6b-v2', version: '2.0.0', task: 'speech-recognition' }), false);
	if (settings.workflowId !== 'transcribe-captions') assert.fail('Expected transcription settings.');
	const whisperFilter = assistanceTaskAvailableModelFilter({ ...settings, recognizer: 'whisper' });
	assert.equal(whisperFilter({ modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0',
		task: 'speech-recognition' }), true);
});

test('preflight catalogs include optional graph stages', () => {
	const settings = defaultAssistanceWorkflowSettingsV1('clean-filler-silence');
	assert.equal(assistanceTaskAvailableModelFilter(settings)({ modelId: 'parakeet-tdt-0.6b-v3',
		version: '3.0.0', task: 'speech-recognition' }), true);
	assert.equal(assistanceTaskAvailableModelFilter(defaultAssistanceWorkflowSettingsV1('index-video'))({
		modelId: 'ppocr-v4-mobile', version: '4.0.0', task: 'optical-character-recognition',
	}), true);
});

test('fast cut marking and default highlights can start without installing optional models', () => {
	const settings = defaultAssistanceWorkflowSettingsV1('mark-cuts');
	assert.equal(assistanceTaskRequiresModels(settings), false);
	assert.equal(assistanceTaskAvailableModelFilter(settings)({ modelId: 'transnetv2', version: '1.0.0',
		task: 'shot-detection' }), true);
	if (settings.workflowId !== 'mark-cuts') assert.fail('Expected cut settings.');
	assert.equal(assistanceTaskRequiresModels({ ...settings, mode: 'accurate' }), true);
	const highlights = defaultAssistanceWorkflowSettingsV1('make-highlights');
	assert.equal(assistanceTaskRequiresModels(highlights), false);
	if (highlights.workflowId !== 'make-highlights') assert.fail('Expected highlight settings.');
	assert.equal(assistanceTaskRequiresModels({ ...highlights, editorialRerank: true }), true);
});
