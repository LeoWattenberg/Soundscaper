/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRiffMarkerChunks, parseRiffMarkers } from '../src/common/editor/riff-markers.ts';

test('RIFF cue and adtl chunks round-trip point markers, regions, labels, and notes', () => {
	const bytes = createRiffMarkerChunks([
		{ id: 7, sampleOffset: 480, label: 'Intro', note: 'Fade complete' },
		{ id: 9, sampleOffset: 960, sampleLength: 240, label: 'Interview' },
	]);
	assert.equal(text(bytes, 0, 4), 'cue ');
	const cueSize = view(bytes).getUint32(4, true);
	const listOffset = 8 + cueSize + (cueSize & 1);
	assert.equal(text(bytes, listOffset, 4), 'LIST');
	assert.deepEqual(parseRiffMarkers(
		bytes.subarray(8, 8 + cueSize),
		[bytes.subarray(listOffset + 12, listOffset + 8 + view(bytes).getUint32(listOffset + 4, true))],
	), [
		{ id: 7, sampleOffset: 480, sampleLength: 0, label: 'Intro', note: 'Fade complete' },
		{ id: 9, sampleOffset: 960, sampleLength: 240, label: 'Interview', note: '' },
	]);
});

test('RIFF marker normalization rejects unsafe offsets and resolves duplicate generated IDs', () => {
	assert.throws(() => createRiffMarkerChunks([{ sampleOffset: 0x1_0000_0000 }]), /32-bit/u);
	const bytes = createRiffMarkerChunks([{ id: 1, sampleOffset: 1 }, { id: 1, sampleOffset: 2 }]);
	const cueSize = view(bytes).getUint32(4, true);
	assert.deepEqual(parseRiffMarkers(bytes.subarray(8, 8 + cueSize)).map(({ id }) => id), [1, 2]);
});

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function text(bytes: Uint8Array, offset: number, length: number): string {
	return new TextDecoder().decode(bytes.subarray(offset, offset + length));
}
