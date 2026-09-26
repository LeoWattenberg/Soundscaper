/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectMp3GaplessGeometry } from '../src/common/editor/mp3-gapless-import.ts';

function xingFrame(crcProtected: boolean, shiftForCrc: boolean): Blob {
	const bytes = new Uint8Array(256);
	bytes.set([0xff, crcProtected ? 0xfa : 0xfb, 0x90, 0x00]);
	const offset = 4 + 32 + (shiftForCrc ? 2 : 0);
	bytes.set(new TextEncoder().encode('Xing'), offset);
	const view = new DataView(bytes.buffer);
	view.setUint32(offset + 4, 1);
	view.setUint32(offset + 8, 100);
	const lameOffset = offset + 12;
	bytes.set(new TextEncoder().encode('LAME'), lameOffset);
	bytes[lameOffset + 21] = 0x24;
	bytes[lameOffset + 22] = 0x02;
	bytes[lameOffset + 23] = 0x40;
	return new Blob([bytes]);
}

test('MP3 gapless geometry reads Xing after CRC-protected side information', async () => {
	const expected = { sampleRate: 44_100, encodedFrames: 115_200, sourceFrames: 114_048, leadingFrames: 1_105 };
	assert.deepEqual(await inspectMp3GaplessGeometry(xingFrame(false, false)), expected);
	assert.deepEqual(await inspectMp3GaplessGeometry(xingFrame(true, false)), expected);
	assert.deepEqual(await inspectMp3GaplessGeometry(xingFrame(true, true)), expected);
});
