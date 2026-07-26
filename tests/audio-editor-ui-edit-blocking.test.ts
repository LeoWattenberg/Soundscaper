import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_EDIT_BLOCK_REASONS,
	selectAudioEditorBusyBlock,
	selectAudioEditorEditBlock,
} from '../src/common/editor/ui/edit-blocking.ts';

const cases = [
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.READ_ONLY, { readOnly: true }, false],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.IMPORTING, { importing: true }, true],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.RECORDING_STARTING, { recordingStarting: true }, true],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.RECORDING_SCHEDULING, { recordingScheduling: true }, true],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.SCHEDULED_RECORDING, { scheduledRecording: { startTimeMs: 1 } }, true],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.RECORDING, { recording: true }, true],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.PLAYBACK_PREPARING, { playbackOptions: { preparing: true } }, true],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.EXPORTING, { exporting: true }, true],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.PROCESSING_EFFECT, { processingEffect: { type: 'normalize' } }, true],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.ANALYSIS_PROCESSING, { analysisProcessing: true }, true],
	[AUDIO_EDITOR_EDIT_BLOCK_REASONS.SAMPLE_EDIT_PROCESSING, { sampleEdit: { processing: true } }, true],
] as const;

test('edit-blocking selectors classify every busy state with a stable reason code', () => {
	for (const [reason, snapshot, blocksBusyActions] of cases) {
		const editBlock = selectAudioEditorEditBlock(snapshot);
		assert.equal(editBlock.blocked, true, reason);
		assert.equal(editBlock.reason, reason, reason);
		assert.deepEqual(editBlock.reasons, [reason], reason);

		const busyBlock = selectAudioEditorBusyBlock(snapshot);
		assert.equal(busyBlock.blocked, blocksBusyActions, reason);
		assert.equal(busyBlock.reason, blocksBusyActions ? reason : null, reason);
	}
});

test('edit-blocking selectors use deterministic priority and expose all active reasons', () => {
	const snapshot = {
		readOnly: true,
		importing: true,
		recording: true,
		exporting: true,
		sampleEdit: { processing: true },
	};
	const editBlock = selectAudioEditorEditBlock(snapshot);
	assert.equal(editBlock.reason, AUDIO_EDITOR_EDIT_BLOCK_REASONS.READ_ONLY);
	assert.deepEqual(editBlock.reasons, [
		AUDIO_EDITOR_EDIT_BLOCK_REASONS.READ_ONLY,
		AUDIO_EDITOR_EDIT_BLOCK_REASONS.IMPORTING,
		AUDIO_EDITOR_EDIT_BLOCK_REASONS.RECORDING,
		AUDIO_EDITOR_EDIT_BLOCK_REASONS.EXPORTING,
		AUDIO_EDITOR_EDIT_BLOCK_REASONS.SAMPLE_EDIT_PROCESSING,
	]);
	assert.ok(Object.isFrozen(editBlock));
	assert.ok(Object.isFrozen(editBlock.reasons));

	const busyBlock = selectAudioEditorBusyBlock(snapshot);
	assert.equal(busyBlock.reason, AUDIO_EDITOR_EDIT_BLOCK_REASONS.IMPORTING);
	assert.ok(!busyBlock.reasons.includes(AUDIO_EDITOR_EDIT_BLOCK_REASONS.READ_ONLY));
});

test('edit-blocking selectors share a frozen unblocked result for inactive snapshots', () => {
	const editBlock = selectAudioEditorEditBlock({});
	const busyBlock = selectAudioEditorBusyBlock({});
	assert.deepEqual(editBlock, { blocked: false, reason: null, reasons: [] });
	assert.equal(editBlock, busyBlock);
	assert.ok(Object.isFrozen(editBlock));
	assert.ok(Object.isFrozen(editBlock.reasons));
});
