/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';

test('ID3 aliases emit one canonical text frame independent of metadata key order', () => {
	for (const metadata of [
		{ track: '1', tracknumber: '1/12', year: '1999', date: '2026-08-31' },
		{ date: '2026-08-31', year: '1999', tracknumber: '1/12', track: '1' },
	]) {
		const frames = readFrames(createAudioMetadataId3Tag(metadata));
		assert.deepEqual(frames.filter(({ id }) => id === 'TRCK').map(textValue), ['1/12']);
		assert.deepEqual(frames.filter(({ id }) => id === 'TDRC').map(textValue), ['2026-08-31']);
		assert.deepEqual(
			frames.filter(({ id }) => id === 'TXXX').map(userTextValue).sort(),
			[['track', '1'], ['year', '1999']],
		);
	}
});

function readFrames(tag) {
	const frames = [];
	for (let offset = 10; offset < tag.byteLength;) {
		const id = new TextDecoder().decode(tag.subarray(offset, offset + 4));
		const size = decodeSynchsafe(tag.subarray(offset + 4, offset + 8));
		frames.push({ id, payload: tag.subarray(offset + 10, offset + 10 + size) });
		offset += 10 + size;
	}
	return frames;
}

function textValue(frame) {
	return new TextDecoder().decode(frame.payload.subarray(1));
}

function userTextValue(frame) {
	const separator = frame.payload.indexOf(0, 1);
	return [
		new TextDecoder().decode(frame.payload.subarray(1, separator)),
		new TextDecoder().decode(frame.payload.subarray(separator + 1)),
	];
}

function decodeSynchsafe(bytes) {
	return bytes.reduce((value, byte) => (value << 7) | byte, 0);
}
