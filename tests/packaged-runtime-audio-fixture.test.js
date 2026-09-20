/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createPackagedRuntimeAudioWave,
	packagedRuntimeAudioArguments,
} from './browser/helpers/packaged-runtime-audio-fixture.js';

test('packaged audio fixture supplies a deterministic non-silent PCM microphone', () => {
	const wave = createPackagedRuntimeAudioWave();

	assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
	assert.equal(wave.toString('ascii', 8, 12), 'WAVE');
	assert.equal(wave.readUInt16LE(20), 1);
	assert.equal(wave.readUInt16LE(22), 1);
	assert.equal(wave.readUInt32LE(24), 48_000);
	assert.equal(wave.readUInt16LE(34), 16);
	assert.equal(wave.toString('ascii', 36, 40), 'data');
	assert.equal(wave.readUInt32LE(40), 96_000);
	assert.ok(wave.subarray(44).some((sample) => sample !== 0));
});

test('packaged audio fixture launch arguments require an absolute wave path', () => {
	assert.deepEqual(packagedRuntimeAudioArguments('/tmp/soundscaper-input.wav'), [
		'--use-fake-device-for-media-stream',
		'--use-file-for-fake-audio-capture=/tmp/soundscaper-input.wav',
	]);
	assert.throws(() => packagedRuntimeAudioArguments('relative.wav'), /absolute/u);
});
