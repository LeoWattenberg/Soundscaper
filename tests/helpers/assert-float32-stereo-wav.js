/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

/**
 * @param {Blob} blob
 * @param {number} expectedFrames
 * @param {number} expectedSampleRate
 */
export async function assertFloat32StereoWav(blob, expectedFrames, expectedSampleRate) {
	assert.equal(blob.type, 'audio/wav');
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const decoder = new TextDecoder();
	const expectedPcmBytes = expectedFrames * 2 * 4;
	assert.equal(decoder.decode(bytes.subarray(0, 4)), 'RIFF');
	assert.equal(decoder.decode(bytes.subarray(8, 12)), 'WAVE');
	assert.equal(decoder.decode(bytes.subarray(36, 40)), 'data');
	assert.equal(header.getUint32(4, true), 36 + expectedPcmBytes, 'RIFF payload size');
	assert.equal(header.getUint16(20, true), 3, 'IEEE float WAV');
	assert.equal(header.getUint16(22, true), 2, 'stereo mix');
	assert.equal(header.getUint32(24, true), expectedSampleRate, 'project sample rate');
	assert.equal(header.getUint16(34, true), 32, '32-bit float samples');
	assert.equal(header.getUint32(40, true), expectedPcmBytes, 'audio payload size');
	assert.equal(bytes.byteLength, 44 + expectedPcmBytes);
}
