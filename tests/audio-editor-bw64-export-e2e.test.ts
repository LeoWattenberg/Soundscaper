/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAdmChna,
	encodeChnaPayload,
	generateAdmAxml,
	parseRiffAxmlChunk,
	parseRiffChnaChunk,
	validateAdmChnaConsistency,
} from '../src/common/editor/adm-metadata.ts';
import { createImportedAdmPassthroughMetadata } from '../src/common/editor/controller/wav-import-metadata.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { createAudioEditorProjectV7 } from '../src/common/editor/project-v7.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';

const CHANNEL_ORDER = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] as const;
const UINT32_SENTINEL = 0xffff_ffff;

test('authored 5.1 plan encodes an inspectable BW64 with consistent CHNA and AXML', async () => {
	const project = createAudioEditorProjectV7({
		id: 'bw64-export-e2e',
		title: 'International drama',
		now: '2026-07-28T12:00:00.000Z',
		masterChannels: 6,
		sources: [{
			id: 'source', storageKey: 'pcm/source', name: '5.1 bed', mimeType: 'audio/wav',
			frameCount: 3, channelCount: 6, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 3 }],
		tracks: [{ type: 'audio', id: 'bed', name: 'Bed', clipIds: ['clip'] }],
		metadata: {
			adm: {
				mode: 'authored',
				programme: { name: 'Drama programme', language: 'eng' },
				content: { name: 'German mix', language: 'deu' },
				bed: {
					name: 'Main 5.1 bed',
					layout: '5.1',
					assignments: CHANNEL_ORDER.map((bedChannel, sourceChannel) => ({
						stripKind: 'track' as const, stripId: 'bed', sourceChannel, bedChannel,
					})),
				},
			},
		},
	});
	const plan = createExportPlan(project, { format: 'bw64', dither: 'none' });
	assert.ok(plan.bext && plan.preDataChunks && plan.trailingChunks);
	const bytes = encodeWav(
		Array.from({ length: 6 }, (_, channel) => Float32Array.of(channel / 10, 0, -channel / 10)),
		{
			container: 'bw64', sampleRate: plan.sampleRate, bitDepth: 24, dither: 'none',
			bext: plan.bext, preDataChunks: plan.preDataChunks, trailingChunks: plan.trailingChunks,
		},
	);

	assert.equal(ascii(bytes, 0, 4), 'BW64');
	assert.equal(new DataView(bytes.buffer).getUint32(4, true), UINT32_SENTINEL);
	const chunks = riffChunks(bytes);
	assert.equal(chunks[0]?.id, 'ds64');
	const formatIndex = chunks.findIndex(({ id }) => id === 'fmt ');
	const chnaIndex = chunks.findIndex(({ id }) => id === 'chna');
	const dataIndex = chunks.findIndex(({ id }) => id === 'data');
	const axmlIndex = chunks.findIndex(({ id }) => id === 'axml');
	assert.equal(chnaIndex, formatIndex + 1, 'CHNA immediately follows the PCM format chunk');
	assert.ok(chnaIndex < dataIndex, 'CHNA precedes PCM essence');
	assert.ok(axmlIndex > dataIndex, 'AXML follows PCM essence');

	const ownedBytes = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(ownedBytes).set(bytes);
	const descriptor = await inspectWavBlobPcm(new Blob([ownedBytes], { type: 'audio/wav' }));
	assert.equal(descriptor.channelCount, 6);
	assert.equal(descriptor.frameCount, 3);
	assert.equal(descriptor.sampleFormat, 'int24');
	assert.equal(descriptor.bext?.version, 2);
	assert.equal(descriptor.adm?.valid, true);

	const chna = parseRiffChnaChunk(completeChunk(bytes, chunks[chnaIndex]));
	const axml = parseRiffAxmlChunk(completeChunk(bytes, chunks[axmlIndex]));
	assert.equal(chna.numTracks, 6);
	assert.equal(chna.entries.length, 6);
	assert.equal(validateAdmChnaConsistency(axml, chna, 6), true);
	assert.equal(axml.programmes[0]?.language, 'eng');
	assert.equal(axml.contents[0]?.language, 'deu');
});

test('extensible 20-valid-bit ADM survives decode, project provenance, and 20-bit BW64 re-export', async () => {
	const chna = createAdmChna({ layout: 'stereo' });
	const axml = generateAdmAxml({ programmeName: 'Imported 20-bit master', layout: 'stereo' });
	const sourceChannels = [
		Float32Array.of(-1, 0, 524_287 / 524_288),
		Float32Array.of(524_287 / 524_288, 0, -1),
	];
	const classic = encodeWav(sourceChannels, {
		container: 'bw64', sampleRate: 48_000, bitDepth: 24, dither: 'none',
		preDataChunks: riffChunk('chna', encodeChnaPayload(chna)),
		trailingChunks: riffChunk('axml', new TextEncoder().encode(axml)),
	});
	const importedBytes = replaceFormatWithExtensible20Bit(classic);
	const importedBlob = blobOf(importedBytes);
	const descriptor = await inspectWavBlobPcm(importedBlob);
	assert.equal(descriptor.bitDepth, 24);
	assert.equal(descriptor.validBitsPerSample, 20);
	assert.equal(descriptor.adm?.valid, true);

	const decoded: Float32Array[][] = [];
	await streamWavBlobPcm(importedBlob, {
		descriptor,
		onChunk(channels: Float32Array[]) { decoded.push(channels); },
	});
	assert.deepEqual(decoded[0], sourceChannels);

	const source = {
		id: 'source', storageKey: 'pcm/source', name: 'Imported', mimeType: 'audio/wav',
		frameCount: 3, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32',
	};
	const importedAdm = createImportedAdmPassthroughMetadata({
		candidate: descriptor.adm,
		source,
		descriptor,
		project: { revision: 0 },
	});
	assert.ok(importedAdm?.mode === 'passthrough');
	assert.equal(importedAdm.geometry.bitDepth, 20);
	const project = createAudioEditorProjectV7({
		id: 'imported-20-bit-adm', now: '2026-07-28T12:00:00.000Z', revision: 1,
		masterChannels: 2,
		sources: [source],
		clips: [{ id: 'clip', sourceId: source.id, durationFrames: source.frameCount }],
		tracks: [{ type: 'audio', id: 'bed', name: 'Bed', clipIds: ['clip'] }],
		metadata: { adm: importedAdm },
	});
	const plan = createExportPlan(project, { format: 'bw64', bitDepth: 20, dither: 'none' });
	const encoding = (plan as typeof plan & {
		readonly encoding: Readonly<{ sampleFormat: string; bitDepth: 20 }>;
	}).encoding;
	assert.equal(encoding.sampleFormat, 'int20');
	assert.equal(encoding.bitDepth, 20);
	assert.equal(plan.adm?.mode, 'passthrough');
	const outputBytes = encodeWav(decoded[0] ?? [], {
		container: 'bw64', sampleRate: plan.sampleRate, bitDepth: encoding.bitDepth, dither: 'none',
		bext: plan.bext, preDataChunks: plan.preDataChunks, trailingChunks: plan.trailingChunks,
	});
	const outputBlob = blobOf(outputBytes);
	const output = await inspectWavBlobPcm(outputBlob);
	assert.equal(output.sampleFormat, 'int20');
	assert.equal(output.bitDepth, 20);
	assert.equal(output.validBitsPerSample, 20);
	assert.equal(output.adm?.valid, true);
	const roundTripped: Float32Array[][] = [];
	await streamWavBlobPcm(outputBlob, {
		descriptor: output,
		onChunk(channels: Float32Array[]) { roundTripped.push(channels); },
	});
	assert.deepEqual(roundTripped[0], sourceChannels);
});

interface RiffChunkLocation {
	readonly id: string;
	readonly offset: number;
	readonly payloadBytes: number;
}

function riffChunks(bytes: Uint8Array): RiffChunkLocation[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const dataBytes = Number(view.getBigUint64(28, true));
	const chunks: RiffChunkLocation[] = [];
	let offset = 12;
	while (offset + 8 <= bytes.byteLength) {
		const id = ascii(bytes, offset, 4);
		const declaredBytes = view.getUint32(offset + 4, true);
		const payloadBytes = id === 'data' && declaredBytes === UINT32_SENTINEL ? dataBytes : declaredBytes;
		chunks.push({ id, offset, payloadBytes });
		offset += 8 + payloadBytes + (payloadBytes & 1);
	}
	assert.equal(offset, bytes.byteLength);
	return chunks;
}

function completeChunk(bytes: Uint8Array, location: RiffChunkLocation | undefined): Uint8Array {
	assert.ok(location);
	return bytes.subarray(location.offset, location.offset + 8 + location.payloadBytes + (location.payloadBytes & 1));
}

function replaceFormatWithExtensible20Bit(bytes: Uint8Array): Uint8Array {
	const format = riffChunks(bytes).find(({ id }) => id === 'fmt ');
	assert.ok(format);
	assert.equal(format.payloadBytes, 16);
	const output = new Uint8Array(bytes.byteLength + 24);
	output.set(bytes.subarray(0, format.offset), 0);
	writeAscii(output, format.offset, 'fmt ');
	const inputView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const outputView = new DataView(output.buffer);
	outputView.setUint32(format.offset + 4, 40, true);
	outputView.setUint16(format.offset + 8, 0xfffe, true);
	output.set(bytes.subarray(format.offset + 10, format.offset + 24), format.offset + 10);
	outputView.setUint16(format.offset + 24, 22, true);
	outputView.setUint16(format.offset + 26, 20, true);
	outputView.setUint32(format.offset + 28, 0x3, true);
	outputView.setUint32(format.offset + 32, 1, true);
	output.set([0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], format.offset + 36);
	output.set(bytes.subarray(format.offset + 24), format.offset + 48);
	outputView.setBigUint64(20, BigInt(output.byteLength - 8), true);
	assert.equal(inputView.getUint16(format.offset + 22, true), 24);
	return output;
}

function riffChunk(id: string, payload: Uint8Array): Uint8Array {
	const chunk = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	writeAscii(chunk, 0, id);
	new DataView(chunk.buffer).setUint32(4, payload.byteLength, true);
	chunk.set(payload, 8);
	return chunk;
}

function blobOf(bytes: Uint8Array): Blob {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return new Blob([copy.buffer], { type: 'audio/wav' });
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return new TextDecoder('ascii').decode(bytes.subarray(offset, offset + length));
}
