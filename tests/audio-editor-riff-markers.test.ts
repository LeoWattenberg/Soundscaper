/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRiffMarkerChunks, parseRiffMarkers } from '../src/common/editor/riff-markers.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { encodeWav } from '../src/common/editor/wav.js';

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

test('WAV import keeps valid INFO when cue markers are malformed', async () => {
	const wav = encodeWav([Float32Array.of(0.25)], {
		metadata: { title: 'Field recording' },
		markers: [{ id: 7, sampleOffset: 0, label: 'Start' }],
	});
	view(wav).setUint32(findChunk(wav, 'cue ') + 8, 2, true);
	const descriptor = await inspectWavBlobPcm(new Blob([new Uint8Array(wav)]));
	assert.deepEqual(descriptor.markers, []);
	assert.deepEqual(descriptor.info, { title: 'Field recording' });
	assert.equal(descriptor.metadataWarnings.some((warning) => warning.code === 'riff-markers-invalid'), true);
});

test('WAV import keeps valid cue markers when INFO is malformed', async () => {
	const wav = encodeWav([Float32Array.of(0.25)], {
		metadata: { title: 'Field recording' },
		markers: [{ id: 7, sampleOffset: 0, label: 'Start' }],
	});
	view(wav).setUint32(findChunk(wav, 'LIST', 'INFO') + 16, 0xffff_ffff, true);
	const descriptor = await inspectWavBlobPcm(new Blob([new Uint8Array(wav)]));
	assert.deepEqual(descriptor.markers, [{
		id: 7, sampleOffset: 0, sampleLength: 0, label: 'Start', note: '',
	}]);
	assert.deepEqual(descriptor.info, {});
	assert.equal(descriptor.metadataWarnings.some((warning) => warning.code === 'riff-info-invalid'), true);
});

function findChunk(bytes: Uint8Array, id: string, listType?: string): number {
	const data = view(bytes);
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = data.getUint32(offset + 4, true);
		if (text(bytes, offset, 4) === id && (!listType || text(bytes, offset + 8, 4) === listType)) {
			return offset;
		}
		offset += 8 + size + (size & 1);
	}
	throw new Error(`No ${id} chunk was found.`);
}

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function text(bytes: Uint8Array, offset: number, length: number): string {
	return new TextDecoder().decode(bytes.subarray(offset, offset + length));
}
