/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inspectMp3GaplessGeometry } from '../src/common/editor/mp3-gapless-import.ts';

test('unchanged FFmpeg libmp3lame output retains its standard Xing delay and padding geometry', async () => {
	// Ubuntu FFmpeg 6.1.1, without any header edits:
	// ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000:duration=1 -c:a libmp3lame -b:a 128k one-second.mp3
	const encoded = await readFile(new URL('./fixtures/ffmpeg-libmp3lame-one-second.mp3.base64', import.meta.url), 'utf8');
	const bytes = Buffer.from(encoded, 'base64');
	assert.equal(bytes.length, 16_941);
	assert.equal(bytes.subarray(186, 195).toString('ascii'), 'Lavc60.31');
	const expected = { sampleRate: 48_000, encodedFrames: 49_536, sourceFrames: 48_000, leadingFrames: 1_105 };
	assert.deepEqual(await inspectMp3GaplessGeometry(new Blob([bytes])), expected);
	// A chooser may supply a bounded byte view; unrelated backing bytes do not
	// belong to this original recording.
	const backing = new Uint8Array(bytes.length + 16);
	backing.set(bytes, 8);
	assert.deepEqual(await inspectMp3GaplessGeometry(new Blob([backing.subarray(8, 8 + bytes.length)])), expected);
});
