/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAXIMUM_RAW_PCM_IMPORT_BYTES,
	prepareRawPcmWaveFile,
} from '../src/common/editor/controller/raw-pcm-import.ts';

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
