/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { scanEncodedAudioMarkers } from '../src/common/editor/encoded-audio-marker-scan.ts';
import { createProjectImportService } from '../src/common/editor/controller/project-import-service.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createRiffMarkerChunks } from '../src/common/editor/riff-markers.ts';
import {
	commandOfType,
	createFixture,
	type TestFile,
} from './audio-editor-project-import-service-fixture.ts';

const MPEG_FORMAT_TAG = 0x0055;

test('the marker scan reads cues and the declared rate out of a non-PCM WAV', async () => {
	const scan = await scanEncodedAudioMarkers(byteSource(nonPcmWav()));

	assert.ok(scan);
	assert.equal(scan?.sampleRate, 24_000);
	assert.deepEqual(scan?.markers.map(({ sampleOffset, label }) => ({ sampleOffset, label })), [
		{ sampleOffset: 12_000, label: 'Verse' },
	]);
});

test('the marker scan tolerates foreign containers, truncated tails, and malformed cue tables', async () => {
	assert.equal(await scanEncodedAudioMarkers(byteSource(new TextEncoder().encode('ID3 not riff at all'))), null);

	const truncated = nonPcmWav();
	// Declare a final chunk whose payload runs past the end of the file.
	const withTruncatedTail = concatBytes(truncated, new TextEncoder().encode('JUNK'), Uint8Array.of(0xff, 0xff, 0, 0));
	const scan = await scanEncodedAudioMarkers(byteSource(withTruncatedTail));
	assert.equal(scan?.markers.length, 1);

	const malformed = nonPcmWav();
	// Corrupt the cue count so the table no longer matches its payload size.
	const cueOffset = findChunk(malformed, 'cue ');
	new DataView(malformed.buffer).setUint32(cueOffset + 8, 999, true);
	assert.equal(await scanEncodedAudioMarkers(byteSource(malformed)), null);
});

test('a non-PCM WAV that falls to the decode path still imports its cues', async () => {
	const fixture = createFixture();
	fixture.setProject(createCurrentAudioEditorProject({
		id: 'cue-rescue',
		title: 'Cue rescue',
		now: '2026-09-02T00:00:00.000Z',
	}) as unknown as Record<string, unknown>);
	const service = createProjectImportService(fixture.runtime);

	const result = await service.importFile(byteFile('compressed.wav', nonPcmWav()));

	assert.equal(result.destination, 'timeline');
	const added = commandOfType(fixture.commands[0]?.command, 'timeline-annotation/add') as {
		annotation?: { kind?: string; positionFrame?: number; name?: string };
	} | undefined;
	assert.ok(added, 'expected the rescued cue to become a timeline annotation');
	assert.equal(added?.annotation?.kind, 'marker');
	assert.equal(added?.annotation?.name, 'Verse');
	// 12,000 frames at the file's declared 24 kHz land at 24,000 project frames.
	assert.equal(added?.annotation?.positionFrame, 24_000);
});

function nonPcmWav(): Uint8Array {
	const fmt = new Uint8Array(16);
	const fmtView = new DataView(fmt.buffer);
	fmtView.setUint16(0, MPEG_FORMAT_TAG, true);
	fmtView.setUint16(2, 1, true);
	fmtView.setUint32(4, 24_000, true);
	fmtView.setUint32(8, 3_000, true);
	fmtView.setUint16(12, 1, true);
	const body = concatBytes(
		new TextEncoder().encode('WAVE'),
		riffChunk('fmt ', fmt),
		riffChunk('data', Uint8Array.of(1, 2, 3, 4)),
		createRiffMarkerChunks([{ id: 7, sampleOffset: 12_000, label: 'Verse' }]),
	);
	const file = new Uint8Array(8 + body.byteLength);
	file.set(new TextEncoder().encode('RIFF'), 0);
	new DataView(file.buffer).setUint32(4, body.byteLength, true);
	file.set(body, 8);
	return file;
}

function riffChunk(id: string, payload: Uint8Array): Uint8Array {
	const chunk = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	chunk.set(new TextEncoder().encode(id), 0);
	new DataView(chunk.buffer).setUint32(4, payload.byteLength, true);
	chunk.set(payload, 8);
	return chunk;
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
	return result;
}

function findChunk(bytes: Uint8Array, id: string): number {
	for (let offset = 12; offset + 8 <= bytes.byteLength;) {
		const chunkId = String.fromCharCode(...bytes.subarray(offset, offset + 4));
		const size = new DataView(bytes.buffer, offset + 4, 4).getUint32(0, true);
		if (chunkId === id) return offset;
		offset += 8 + size + (size & 1);
	}
	throw new Error(`No ${id} chunk in the test file.`);
}

function byteSource(bytes: Uint8Array) {
	return {
		size: bytes.byteLength,
		slice: (start: number, end: number) => ({
			arrayBuffer: async () => bytes.slice(start, end).buffer as ArrayBuffer,
		}),
	};
}

function byteFile(name: string, bytes: Uint8Array): TestFile {
	const fileOf = (view: Uint8Array): TestFile => ({
		name,
		type: 'audio/wav',
		size: view.byteLength,
		arrayBuffer: async () => view.slice().buffer as ArrayBuffer,
		slice: (start = 0, end = view.byteLength) => fileOf(view.subarray(start, end)),
	});
	return fileOf(bytes);
}
