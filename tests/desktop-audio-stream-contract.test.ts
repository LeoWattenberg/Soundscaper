/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDesktopAudioStreamPlan, normalizeDesktopAudioStreamCommand,
	DESKTOP_AUDIO_STREAM_MAXIMUM_PCM_BYTES } from '../desktop/desktop-audio-stream-contract.ts';

const plan = { schemaVersion: 1, frameCount: 3600 * 48000, maximumOutputBytes: 1_000_000_000,
	tuple: { operation: 'audio-encode', format: 'mp3', sampleRate: 48000, channelCount: 2, settings: { bitrateKbps: 192 } } };
test('one-hour stereo scratch may exceed the original and encoded file cap while wire packets remain bounded', () => {
	assert.equal(normalizeDesktopAudioStreamPlan(plan).frameCount * 8, 1_382_400_000);
	const command = normalizeDesktopAudioStreamCommand({ type: 'write', operationId: `desktop-audio-stream-${'a'.repeat(32)}`,
		offset: 1_382_400_000 - 8, bytes: new Uint8Array(8) });
	assert.equal(command.type, 'write');
	assert.throws(() => normalizeDesktopAudioStreamPlan({ ...plan, maximumOutputBytes: 1_000_000_001 }), /bound/u);
	assert.throws(() => normalizeDesktopAudioStreamPlan({ ...plan, frameCount: plan.frameCount + 1 }), /bound/u);
	assert.throws(() => normalizeDesktopAudioStreamCommand({ type: 'write', operationId: `desktop-audio-stream-${'a'.repeat(32)}`,
		offset: DESKTOP_AUDIO_STREAM_MAXIMUM_PCM_BYTES + 1, bytes: new Uint8Array(8) }), /bound/u);
	assert.throws(() => normalizeDesktopAudioStreamCommand({ type: 'write', operationId: `desktop-audio-stream-${'a'.repeat(32)}`,
		offset: 0, bytes: new Uint8Array(1024 ** 2 + 1) }), /bound/u);
});
