/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdmChna, encodeChnaPayload, generateAdmAxml } from '../src/common/editor/adm-metadata.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

const UINT32_SENTINEL = 0xffff_ffff;

test('BW64 inspection preserves modeled and opaque nonstructural chunks in exact sequence', async () => {
	const xml = generateAdmAxml({ layout: 'mono' });
	const xmlBytes = new TextEncoder().encode(xml);
	const chna = encodeChnaPayload(createAdmChna({ layout: 'mono' }));
	const info = listPayload('INFO', [
		riffChunk('IENG', new TextEncoder().encode('Mixer\0')),
		riffChunk('IKEY', new TextEncoder().encode('news\0')),
		riffChunk('ISBJ', new TextEncoder().encode('Bulletin\0')),
	]);
	const adtl = listPayload('adtl', [riffChunk('VEND', Uint8Array.of(9, 8, 7), false, 0x5a)]);
	const expected = [
		riffChunk('chna', chna),
		riffChunk('LIST', info),
		riffChunk('PEAK', Uint8Array.of(1, 2, 3), false, 0xa5),
		riffChunk('axml', xmlBytes),
		riffChunk('LIST', adtl),
		riffChunk('MD5 ', Uint8Array.of(4, 5)),
	];
	const descriptor = await inspectWavBlobPcm(createBw64({
		before: expected.slice(0, 2),
		after: expected.slice(2),
	}));

	assert.equal(descriptor.adm?.valid, true);
	assert.deepEqual(descriptor.adm?.riffChunkSequence, expected.map((raw, index) => ({
		id: ascii(raw, 0, 4),
		placement: index < 2 ? 'before-data' : 'after-data',
		rawBase64: Buffer.from(raw).toString('base64'),
	})));
	assert.deepEqual(descriptor.adm?.opaqueRiffChunks?.map(({ id }) => id), ['PEAK', 'MD5 ']);
	assert.deepEqual(descriptor.info, {});
	assert.deepEqual(descriptor.markers, []);
});

test('BW64 fact is never admitted to pristine ADM chunk preservation', async () => {
	const xml = generateAdmAxml({ layout: 'mono' });
	const descriptor = await inspectWavBlobPcm(createBw64({
		before: [
			riffChunk('fact', Uint8Array.of(1, 0, 0, 0)),
			riffChunk('chna', encodeChnaPayload(createAdmChna({ layout: 'mono' }))),
		],
		after: [riffChunk('axml', new TextEncoder().encode(xml))],
	}));

	assert.equal(descriptor.adm?.valid, false);
	assert.equal(descriptor.adm?.riffChunkSequence?.some(({ id }) => id === 'fact'), false);
	assert.ok(descriptor.metadataWarnings.some(({ code }) => code === 'adm-bw64-fact-forbidden'));
});

function createBw64(options: Readonly<{
	before: readonly Uint8Array[];
	after: readonly Uint8Array[];
}>): Blob {
	const dataBytes = Uint8Array.of(0, 0);
	const ds64 = riffChunk('ds64', new Uint8Array(28));
	const format = riffChunk('fmt ', formatPayload());
	const data = riffChunk('data', dataBytes, true);
	const byteLength = 12 + [ds64, format, ...options.before, data, ...options.after]
		.reduce((size, chunk) => size + chunk.byteLength, 0);
	const output = new Uint8Array(byteLength);
	const view = new DataView(output.buffer);
	writeAscii(output, 0, 'BW64');
	view.setUint32(4, UINT32_SENTINEL, true);
	writeAscii(output, 8, 'WAVE');
	let offset = 12;
	output.set(ds64, offset);
	view.setBigUint64(offset + 8, BigInt(byteLength - 8), true);
	view.setBigUint64(offset + 16, BigInt(dataBytes.byteLength), true);
	offset += ds64.byteLength;
	for (const chunk of [format, ...options.before, data, ...options.after]) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new Blob([output], { type: 'audio/wav' });
}

function formatPayload(): Uint8Array {
	const output = new Uint8Array(16);
	const view = new DataView(output.buffer);
	view.setUint16(0, 1, true);
	view.setUint16(2, 1, true);
	view.setUint32(4, 48_000, true);
	view.setUint32(8, 96_000, true);
	view.setUint16(12, 2, true);
	view.setUint16(14, 16, true);
	return output;
}

function listPayload(kind: string, chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(4 + chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
	writeAscii(output, 0, kind);
	let offset = 4;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function riffChunk(id: string, payload: Uint8Array, sentinel = false, padByte = 0): Uint8Array {
	const output = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	writeAscii(output, 0, id);
	new DataView(output.buffer).setUint32(4, sentinel ? UINT32_SENTINEL : payload.byteLength, true);
	output.set(payload, 8);
	if (payload.byteLength & 1) output[output.byteLength - 1] = padByte;
	return output;
}

function writeAscii(output: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) output[offset + index] = value.charCodeAt(index);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return new TextDecoder('ascii').decode(bytes.subarray(offset, offset + length));
}
