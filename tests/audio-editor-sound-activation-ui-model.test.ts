/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SOUND_ACTIVATION_UI_RANGES,
	createSoundActivationUiModel,
} from '../src/common/editor/ui/sound-activation-ui-model.ts';
import type { SoundActivationPolicySnapshot } from '../src/common/editor/controller/sound-activation-policy-service.ts';

const COPY = Object.freeze({
	soundActivationGuardReadOnly: 'This project is read-only.',
	soundActivationGuardPreferenceUpdate: 'Saving sound-activation settings.',
	soundActivationGuardRecordingScheduling: 'Recording inputs are being prepared.',
	soundActivationGuardRecordingPrepared: 'A timed recording is prepared.',
	soundActivationGuardRecordingActive: 'Recording is active.',
	soundActivationGuardRecordingFinishing: 'Recording is finishing.',
	soundActivationStatusEnabled: 'Sound-activated recording is on.',
	soundActivationStatusDisabled: 'Sound-activated recording is off.',
	soundActivationDecibelsValue: '{value} dB',
	soundActivationMillisecondsValue: '{value} ms',
});

test('sound activation UI model exposes bounded canonical controls and localized values', () => {
	const model = createSoundActivationUiModel(policy(), false, 'de', COPY);

	assert.deepEqual(model.preferences, {
		enabled: false,
		thresholdDb: -40,
		hysteresisDb: 6,
		holdMilliseconds: 250,
	});
	assert.equal(model.controlsDisabled, false);
	assert.equal(model.blockReason, null);
	assert.equal(model.statusMessage, COPY.soundActivationStatusDisabled);
	assert.equal(model.thresholdValueText, '-40 dB');
	assert.equal(model.hysteresisValueText, '6 dB');
	assert.equal(model.holdValueText, '250 ms');
	assert.deepEqual(SOUND_ACTIVATION_UI_RANGES, {
		thresholdDb: { minimum: -100, maximum: 0, step: 1 },
		hysteresisDb: { minimum: 0, maximum: 24, step: 1 },
		holdMilliseconds: { minimum: 0, maximum: 600_000, step: 10 },
	});
	assert.equal(Object.isFrozen(model), true);
	assert.equal(Object.isFrozen(SOUND_ACTIVATION_UI_RANGES), true);
	assert.equal(Object.isFrozen(SOUND_ACTIVATION_UI_RANGES.thresholdDb), true);
});

test('read-only and every policy transition produce one explicit mutation guard', () => {
	const readOnly = createSoundActivationUiModel(policy(), true, 'en', COPY);
	assert.equal(readOnly.controlsDisabled, true);
	assert.equal(readOnly.blockReason, 'read-only');
	assert.equal(readOnly.statusMessage, COPY.soundActivationGuardReadOnly);
	assert.equal(readOnly.preferenceUpdatePending, false);

	for (const [reason, message] of [
		['preference-update', COPY.soundActivationGuardPreferenceUpdate],
		['recording-scheduling', COPY.soundActivationGuardRecordingScheduling],
		['recording-prepared', COPY.soundActivationGuardRecordingPrepared],
		['recording-active', COPY.soundActivationGuardRecordingActive],
		['recording-finishing', COPY.soundActivationGuardRecordingFinishing],
	] as const) {
		const guarded = createSoundActivationUiModel(policy(reason), false, 'en', COPY);
		assert.equal(guarded.controlsDisabled, true, reason);
		assert.equal(guarded.blockReason, reason, reason);
		assert.equal(guarded.statusMessage, message, reason);
		assert.equal(guarded.preferenceUpdatePending, reason === 'preference-update', reason);
	}
});

test('sound activation UI model rejects contradictory guard state and invalid preferences', () => {
	assert.throws(() => createSoundActivationUiModel({
		...policy(),
		preferenceMutationBlocked: true,
	}, false, 'en', COPY), /block reason/iu);
	assert.throws(() => createSoundActivationUiModel({
		...policy(),
		preferences: { enabled: false, thresholdDb: 1, hysteresisDb: 6, holdMilliseconds: 250 },
	}, false, 'en', COPY), /sound activation preferences/iu);
});

function policy(
	reason: SoundActivationPolicySnapshot['preferenceMutationBlockReason'] = null,
): SoundActivationPolicySnapshot {
	return Object.freeze({
		preferences: Object.freeze({
			enabled: false,
			thresholdDb: -40,
			hysteresisDb: 6,
			holdMilliseconds: 250,
		}),
		preferenceMutationBlocked: reason !== null,
		preferenceMutationBlockReason: reason,
		sources: Object.freeze([]),
	});
}
