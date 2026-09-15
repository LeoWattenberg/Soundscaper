/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	selectAudioEditorControllerLabelEditBlock,
	selectAudioEditorLabelEditBlock,
} from '../src/common/editor/label-edit-blocking.ts';
import { evaluateAudacityActionEnablement } from '../src/common/editor/audacity-action-parity.js';

test('label edits remain available during capture while every other edit blocker remains effective', () => {
	assert.equal(selectAudioEditorLabelEditBlock({ recording: true }).blocked, false);
	assert.equal(selectAudioEditorControllerLabelEditBlock({ recorder: {} }).blocked, false);
	for (const flag of ['readOnly', 'takeCycleRecovery', 'recordingStarting', 'recordingScheduling', 'scheduledRecording', 'importing', 'exporting', 'processingEffect', 'analysisProcessing']) {
		assert.equal(selectAudioEditorLabelEditBlock({ recording: true, [flag]: true }).blocked, true, flag);
	}
	assert.equal(selectAudioEditorLabelEditBlock({ recording: true, sampleEdit: { processing: true } }).blocked, true);
	assert.equal(selectAudioEditorLabelEditBlock({ recording: true, playbackOptions: { preparing: true } }).blocked, true);
});

test('label add and contextual F2 permit capture metadata while audio and blank-item edits stay disabled', () => {
	const context = {
		snapshot: {
			project: { tracks: [{ id: 'labels', type: 'label', labels: [{ id: 'cue' }] }], clips: [], selection: { startFrame: 0, endFrame: 200, trackIds: ['labels'], clipIds: [] } },
			selectedTrackId: 'labels', selectedClipId: null, recording: true, readOnly: false, recordingStarting: false,
		},
		telemetry: { recording: true }, focusedLabel: { trackId: 'labels', labelId: 'cue' },
	};
	assert.equal(evaluateAudacityActionEnablement('label-add', context), true);
	assert.equal(evaluateAudacityActionEnablement('rename-item', context), true);
	assert.equal(evaluateAudacityActionEnablement('split-labels', context), false);
	assert.equal(evaluateAudacityActionEnablement('rename-item', { ...context, focusedLabel: null }), false);
	context.snapshot.recordingStarting = true;
	assert.equal(evaluateAudacityActionEnablement('label-add', context), false);
	assert.equal(evaluateAudacityActionEnablement('rename-item', context), false);
	context.snapshot.recordingStarting = false;
	context.snapshot.readOnly = true;
	assert.equal(evaluateAudacityActionEnablement('label-add', context), false);
	assert.equal(evaluateAudacityActionEnablement('rename-item', context), false);
});
