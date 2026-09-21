/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const SOURCE = resolve(import.meta.dirname, '../native/soundscaper-professional-host/src');

test('Windows AAC and MP3 encode share one exact Float32-to-PCM16 input authority', async () => {
	const [authority, aac, mp3] = await Promise.all([
		readFile(join(SOURCE, 'os_audio_codec_windows_file_bytes.h'), 'utf8'),
		readFile(join(SOURCE, 'os_audio_codec_windows.cpp'), 'utf8'),
		readFile(join(SOURCE, 'os_mp3_encode_windows.cpp'), 'utf8'),
	]);
	assert.match(authority, /inline bool readFloat32StereoPcm16/u);
	for (const caller of [aac, mp3]) {
		assert.match(caller, /readFloat32StereoPcm16\(inputPath, request->input_bytes, pcm, frameCount\)/u);
		assert.doesNotMatch(caller, /bool read(?:Exact)?FloatInput\(/u);
	}
	assert.match(mp3, /soundscaper::os_audio::readAllBytes\(input, bytes\.data\(\), bytes\.size\(\)\)/u);
	assert.doesNotMatch(mp3, /\breadAll\(/u);
});
