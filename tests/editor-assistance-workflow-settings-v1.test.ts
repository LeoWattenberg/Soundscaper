/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_WORKFLOW_SETTINGS_VERSION,
	defaultAssistanceWorkflowSettingsV1,
	serializeAssistanceWorkflowSettingsV1,
	validateAssistanceWorkflowSettingsV1,
} from '../src/common/editor/assistance/workflow-settings-v1.ts';
import {
	ASSISTANCE_GUIDED_WORKFLOW_IDS,
	ADVANCED_ASSISTANCE_WORKFLOW_IDS,
} from '../src/common/editor/assistance/workflow.ts';

test('every guided and advanced recipe has one strict versioned default', () => {
	for (const workflowId of [...ASSISTANCE_GUIDED_WORKFLOW_IDS, ...ADVANCED_ASSISTANCE_WORKFLOW_IDS]) {
		const settings = defaultAssistanceWorkflowSettingsV1(workflowId);
		assert.equal(settings.settingsVersion, ASSISTANCE_WORKFLOW_SETTINGS_VERSION);
		assert.equal(settings.workflowId, workflowId);
		assert.deepEqual(validateAssistanceWorkflowSettingsV1(settings, workflowId), settings);
		assert.equal(Object.isFrozen(settings), true);
	}
});

test('guided defaults bind the product decisions without silently enabling publication', () => {
	assert.deepEqual(defaultAssistanceWorkflowSettingsV1('transcribe-captions'), {
		settingsVersion: 1, workflowId: 'transcribe-captions', recognizer: 'parakeet',
		language: 'auto', englishWhisperAlignment: 'when-installed',
	});
	assert.deepEqual(defaultAssistanceWorkflowSettingsV1('clean-filler-silence'), {
		settingsVersion: 1, workflowId: 'clean-filler-silence', preset: 'balanced',
	});
	assert.deepEqual(defaultAssistanceWorkflowSettingsV1('mark-reactions'), {
		settingsVersion: 1, workflowId: 'mark-reactions', threshold: 0.5,
	});
	assert.deepEqual(defaultAssistanceWorkflowSettingsV1('detect-beats-tempo'), {
		settingsVersion: 1, workflowId: 'detect-beats-tempo', publishBeatLabels: false,
		applyTempoMap: false,
	});
	assert.deepEqual(defaultAssistanceWorkflowSettingsV1('mark-cuts'), {
		settingsVersion: 1, workflowId: 'mark-cuts', mode: 'fast',
	});
	assert.deepEqual(defaultAssistanceWorkflowSettingsV1('reframe'), {
		settingsVersion: 1, workflowId: 'reframe', targetAspectWidth: 9,
		targetAspectHeight: 16,
	});
	assert.deepEqual(defaultAssistanceWorkflowSettingsV1('make-highlights'), {
		settingsVersion: 1, workflowId: 'make-highlights', resultCount: 5,
		minimumDurationSeconds: 15, maximumDurationSeconds: 60,
		targetAspectWidth: 9, targetAspectHeight: 16,
	});
	assert.deepEqual(defaultAssistanceWorkflowSettingsV1('generate-editorial-text'), {
		settingsVersion: 1, workflowId: 'generate-editorial-text', enabled: false,
		fields: ['title', 'hook', 'chapters', 'explanation'],
	});
});

test('workflow settings reject unknown keys, cross-workflow values, and unsafe bounds', () => {
	assert.throws(() => validateAssistanceWorkflowSettingsV1({
		...defaultAssistanceWorkflowSettingsV1('mark-cuts'), mode: 'automatic',
	}), /mode/iu);
	assert.throws(() => validateAssistanceWorkflowSettingsV1({
		...defaultAssistanceWorkflowSettingsV1('mark-reactions'), threshold: Number.NaN,
	}), /threshold/iu);
	assert.throws(() => validateAssistanceWorkflowSettingsV1({
		...defaultAssistanceWorkflowSettingsV1('make-highlights'), resultCount: 21,
	}), /result count/iu);
	assert.throws(() => validateAssistanceWorkflowSettingsV1({
		...defaultAssistanceWorkflowSettingsV1('make-highlights'), maximumDurationSeconds: 181,
	}), /maximum duration/iu);
	assert.throws(() => validateAssistanceWorkflowSettingsV1({
		...defaultAssistanceWorkflowSettingsV1('reframe'), targetAspectWidth: 100,
	}), /aspect/iu);
	assert.throws(() => validateAssistanceWorkflowSettingsV1({
		...defaultAssistanceWorkflowSettingsV1('mark-cuts'), path: '/private/video.mp4',
	}), /schema fields/iu);
	assert.throws(() => validateAssistanceWorkflowSettingsV1(
		defaultAssistanceWorkflowSettingsV1('mark-cuts'), 'reframe',
	), /workflow/iu);
});

test('advanced recipes remain exact single-operation recipes with no hidden parameters', () => {
	const settings = defaultAssistanceWorkflowSettingsV1('advanced:audio-tagging');
	assert.deepEqual(settings, {
		settingsVersion: 1, workflowId: 'advanced:audio-tagging', operationSettings: {},
	});
	assert.throws(() => validateAssistanceWorkflowSettingsV1({
		...settings, operationSettings: { shell: 'curl example.test' },
	}), /operation settings/iu);
});

test('canonical serialization is stable and contains only the admitted settings body', () => {
	const settings = defaultAssistanceWorkflowSettingsV1('make-highlights');
	assert.equal(serializeAssistanceWorkflowSettingsV1(settings),
		'{"maximumDurationSeconds":60,"minimumDurationSeconds":15,"resultCount":5,"settingsVersion":1,"targetAspectHeight":16,"targetAspectWidth":9,"workflowId":"make-highlights"}');
	assert.equal(serializeAssistanceWorkflowSettingsV1({
		workflowId: 'mark-cuts', mode: 'accurate', settingsVersion: 1,
	}), '{"mode":"accurate","settingsVersion":1,"workflowId":"mark-cuts"}');
});
