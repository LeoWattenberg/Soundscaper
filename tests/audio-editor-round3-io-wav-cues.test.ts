/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRiffMarkerChunks, parseRiffMarkers } from '../src/common/editor/riff-markers.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

test('unchanged libsndfile zero-based cue indices retain both exact marker positions', async () => {
	const encoded = await readFile(new URL('./fixtures/libsndfile-zero-based-cues.wav.base64', import.meta.url), 'ascii');
	const bytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
	const descriptor = await inspectWavBlobPcm(new Blob([bytes.buffer]));
	assert.equal(descriptor.sampleRate, 48_000);
	assert.equal(descriptor.frameCount, 4_800);
	assert.deepEqual(descriptor.markers, [
		{ id: 0, sampleOffset: 1_200, sampleLength: 0, label: '', note: '' },
		{ id: 1, sampleOffset: 2_400, sampleLength: 0, label: '', note: '' },
	]);
	assert.equal(descriptor.metadataWarnings.length, 0);
});

test('zero is a valid cue identity for labels and regions when writing RIFF metadata', () => {
	const bytes = createRiffMarkerChunks([{ id: 0, sampleOffset: 1_200, sampleLength: 600, label: 'Pickup', note: 'First cue' }]);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const cueSize = view.getUint32(4, true);
	const listStart = 8 + cueSize + cueSize % 2;
	assert.deepEqual(parseRiffMarkers(bytes.subarray(8, 8 + cueSize), [bytes.subarray(listStart + 12)]), [
		{ id: 0, sampleOffset: 1_200, sampleLength: 600, label: 'Pickup', note: 'First cue' },
	]);
});
