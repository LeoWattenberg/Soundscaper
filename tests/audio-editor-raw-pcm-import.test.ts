/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAXIMUM_RAW_PCM_IMPORT_BYTES,
	prepareRawPcmWaveFile,
} from '../src/common/editor/controller/import/raw-pcm-import.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

test('raw PCM import wraps a bounded little-endian stream as canonical WAV', async () => {
	const input = new File([new Uint8Array([0x34, 0x12, 0xcc, 0xed])], 'voice.raw');
	const wav = await prepareRawPcmWaveFile(input, {
		sampleFormat: 'int16', byteOrder: 'little', sampleRate: 48_000, channelCount: 1, offsetBytes: 0,
	});
	const bytes = new Uint8Array(await wav.arrayBuffer());
	assert.equal(wav.name, 'voice.wav');
	assert.equal(wav.type, 'audio/wav');
	assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
	assert.equal(new DataView(bytes.buffer).getUint16(20, true), 1);
	assert.equal(new DataView(bytes.buffer).getUint16(22, true), 1);
	assert.equal(new DataView(bytes.buffer).getUint32(24, true), 48_000);
	assert.deepEqual([...bytes.slice(44)], [0x34, 0x12, 0xcc, 0xed]);
});

test('raw PCM import byte-swaps only complete big-endian samples', async () => {
	const input = new File([new Uint8Array([9, 9, 0x12, 0x34, 0x56, 0x78])], 'stereo.pcm');
	const wav = await prepareRawPcmWaveFile(input, {
		sampleFormat: 'int16', byteOrder: 'big', sampleRate: 44_100, channelCount: 2, offsetBytes: 2,
	});
	assert.deepEqual([...new Uint8Array(await wav.arrayBuffer()).slice(44)], [0x34, 0x12, 0x78, 0x56]);
});

test('raw PCM import rejects open-ended formats, partial frames, and oversized input before reading', async () => {
	const input = new File([new Uint8Array([0, 1, 2])], 'bad.raw');
	await assert.rejects(prepareRawPcmWaveFile(input, {
		sampleFormat: 'int16', byteOrder: 'little', sampleRate: 44_100, channelCount: 1, offsetBytes: 0,
	}), /complete interleaved frames/);
	await assert.rejects(prepareRawPcmWaveFile(input, {
		sampleFormat: 'mulaw' as never, byteOrder: 'little', sampleRate: 44_100, channelCount: 1, offsetBytes: 0,
	}), /sample format/);
	const oversized = { size: MAXIMUM_RAW_PCM_IMPORT_BYTES + 1, name: 'huge.raw' } as File;
	await assert.rejects(prepareRawPcmWaveFile(oversized, {
		sampleFormat: 'uint8', byteOrder: 'little', sampleRate: 44_100, channelCount: 1, offsetBytes: 0,
	}), /size limit/);
});

test('desktop raw PCM imports a 7 GiB source through bounded RF64 slices', async () => {
	const size = 7 * 1024 ** 3;
	const reads: number[] = [];
	const source = {
		name: 'huge.raw', size, lastModified: 0,
		slice(start: number, end: number) {
			reads.push(end - start);
			const bytes = new Uint8Array(end - start);
			for (let index = 0; index < bytes.length; index++) bytes[index] = (start + index) % 2 ? 0x34 : 0x12;
			return new Blob([bytes]);
		},
	} as File;
	const wav = await prepareRawPcmWaveFile(source, {
		sampleFormat: 'int16', byteOrder: 'big', sampleRate: 48_000, channelCount: 1, offsetBytes: 0,
	}, { desktop: true });
	assert.equal(wav.name, 'huge.wav');
	assert.equal(wav.size, size + 80);
	const header = new DataView(await wav.slice(0, 80).arrayBuffer());
	assert.equal(new TextDecoder().decode(new Uint8Array(header.buffer, 0, 4)), 'RF64');
	assert.equal(header.getBigUint64(28, true), BigInt(size));
	assert.equal(header.getBigUint64(36, true), BigInt(size / 2));
	const inspected = await inspectWavBlobPcm(wav);
	assert.equal(inspected.frameCount, size / 2);
	assert.deepEqual(new Uint8Array(await wav.slice(80, 84).arrayBuffer()), new Uint8Array([0x34, 0x12, 0x34, 0x12]));
	assert.deepEqual(new Uint8Array(await wav.slice(wav.size - 2).arrayBuffer()), new Uint8Array([0x34, 0x12]));
	assert.ok(reads.every((length) => length <= 4 * 1024 * 1024));
});
