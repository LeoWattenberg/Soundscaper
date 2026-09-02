/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AIFF_MARK_MAXIMUM_MARKERS,
	createAiffMarkChunk,
	parseAiffMarkChunk,
} from '../src/common/editor/aiff-markers.ts';
import { encodeAiff, encodeIeeeExtended80, inspectAiffLayout } from '../src/common/editor/aiff.js';
import { inspectAiffBlobPcm } from '../src/common/editor/aiff-pcm-chunk-reader.ts';
import { scanEncodedAudioMarkers } from '../src/common/editor/encoded-audio-marker-scan.ts';
import { mediaExportFormatCarriesCues } from '../src/common/editor/media-export.js';

test('the MARK codec round-trips points, flattens regions, and truncates names at 255 bytes', () => {
	const longName = `${'a'.repeat(254)}\u{1f600}`;
	const chunk = createAiffMarkChunk([
		{ id: 900, sampleOffset: 48_000, sampleLength: 24_000, label: 'Region', note: 'dropped' },
		{ id: 7, sampleOffset: 100, label: 'Point' },
		{ id: 8, sampleOffset: 200, label: longName },
	]);
	assert.equal(chunk.byteLength % 2, 0);
	assert.equal(String.fromCharCode(...chunk.subarray(0, 4)), 'MARK');

	const markers = parseAiffMarkChunk(chunk.subarray(8));
	assert.deepEqual(markers.map(({ sampleOffset, sampleLength, label, note }) => ({ sampleOffset, sampleLength, label, note })), [
		{ sampleOffset: 100, sampleLength: 0, label: 'Point', note: '' },
		{ sampleOffset: 200, sampleLength: 0, label: 'a'.repeat(254), note: '' },
		{ sampleOffset: 48_000, sampleLength: 0, label: 'Region', note: '' },
	]);
	assert.ok(markers.every(({ id }) => id > 0 && id <= AIFF_MARK_MAXIMUM_MARKERS));

	assert.equal(createAiffMarkChunk([]).byteLength, 0);
	assert.throws(() => createAiffMarkChunk(Array.from(
		{ length: AIFF_MARK_MAXIMUM_MARKERS + 1 },
		(_, index) => ({ sampleOffset: index }),
	)), /at most 32767/u);
	assert.throws(() => parseAiffMarkChunk(Uint8Array.of(0, 1, 0, 1, 0, 0)), /ends inside a marker/u);
});

test('an AIFF export writes its markers as a MARK chunk the layout accounts for', () => {
	const markers = [
		{ id: 1, sampleOffset: 2, sampleLength: 0, label: 'Intro', note: '' },
		{ id: 2, sampleOffset: 3, sampleLength: 4, label: 'Chorus', note: 'flattened' },
	];
	const options = {
		sampleRate: 48_000,
		bitDepth: 16,
		markers,
		metadata: { title: 'Marked' },
	} as const;
	const bytes = encodeAiff([Float32Array.of(0, 0.5, -0.5, 0.25)], options) as Uint8Array;
	const layout = inspectAiffLayout({ ...options, channelCount: 1, totalFrames: 4 });

	assert.equal(bytes.byteLength, layout.byteLength);
	const parsed = parseAiffMarkChunk(findFormChunk(bytes, 'MARK'));
	assert.deepEqual(parsed.map(({ sampleOffset, label }) => ({ sampleOffset, label })), [
		{ sampleOffset: 2, label: 'Intro' },
		{ sampleOffset: 3, label: 'Chorus' },
	]);
	const unmarked = inspectAiffLayout({
		sampleRate: 48_000, bitDepth: 16, channelCount: 1, totalFrames: 4, metadata: options.metadata,
	});
	assert.ok(layout.byteLength > unmarked.byteLength, 'the marker chunk occupies layout bytes');
});

test('AIFF inspection surfaces MARK markers on the descriptor and tolerates malformed ones', async () => {
	const descriptor = await inspectAiffBlobPcm(byteSource(aiffFile()));
	assert.deepEqual(descriptor.markers?.map(({ sampleOffset, label }) => ({ sampleOffset, label })), [
		{ sampleOffset: 1, label: 'One' },
		{ sampleOffset: 3, label: 'Three' },
	]);

	const malformed = aiffFile(Uint8Array.of(
		...new TextEncoder().encode('MARK'), 0, 0, 0, 2, 0, 9,
	));
	const tolerant = await inspectAiffBlobPcm(byteSource(malformed));
	assert.deepEqual(tolerant.markers, []);
});

test('the encoded-audio marker scan reads AIFF MARK chunks and the declared rate', async () => {
	const scan = await scanEncodedAudioMarkers(byteSource(aiffFile()));
	assert.equal(scan?.sampleRate, 24_000);
	assert.deepEqual(scan?.markers.map(({ sampleOffset, label }) => ({ sampleOffset, label })), [
		{ sampleOffset: 1, label: 'One' },
		{ sampleOffset: 3, label: 'Three' },
	]);
});

test('AIFF declares that it carries cues', () => {
	assert.equal(mediaExportFormatCarriesCues('aiff'), true);
	assert.equal(mediaExportFormatCarriesCues('mp3'), false);
});

function aiffFile(markChunk?: Uint8Array): Uint8Array {
	const comm = new Uint8Array(18);
	const commView = new DataView(comm.buffer);
	commView.setUint16(0, 1, false);
	commView.setUint32(2, 4, false);
	commView.setUint16(6, 16, false);
	comm.set(encodeIeeeExtended80(24_000), 8);
	const ssnd = new Uint8Array(8 + 8);
	const mark = markChunk ?? createAiffMarkChunk([
		{ id: 1, sampleOffset: 1, label: 'One' },
		{ id: 2, sampleOffset: 3, label: 'Three' },
	]);
	const body = concatBytes(
		new TextEncoder().encode('AIFF'),
		formChunk('COMM', comm),
		mark,
		formChunk('SSND', ssnd),
	);
	const file = new Uint8Array(8 + body.byteLength);
	file.set(new TextEncoder().encode('FORM'), 0);
	new DataView(file.buffer).setUint32(4, body.byteLength, false);
	file.set(body, 8);
	return file;
}

function formChunk(id: string, payload: Uint8Array): Uint8Array {
	const chunk = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	chunk.set(new TextEncoder().encode(id), 0);
	new DataView(chunk.buffer).setUint32(4, payload.byteLength, false);
	chunk.set(payload, 8);
	return chunk;
}

function findFormChunk(bytes: Uint8Array, id: string): Uint8Array {
	for (let offset = 12; offset + 8 <= bytes.byteLength;) {
		const chunkId = String.fromCharCode(...bytes.subarray(offset, offset + 4));
		const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, false);
		if (chunkId === id) return bytes.subarray(offset + 8, offset + 8 + size);
		offset += 8 + size + (size & 1);
	}
	throw new Error(`No ${id} chunk in the encoded AIFF file.`);
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
	return result;
}

function byteSource(bytes: Uint8Array) {
	return {
		size: bytes.byteLength,
		slice: (start: number, end: number) => ({
			arrayBuffer: async () => bytes.slice(start, end).buffer as ArrayBuffer,
		}),
	};
}
