/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { WavPackCodecClient } from '../src/common/editor/wavpack/client.js';
import { crc32, packPlanarFloat32, PCM_ENCODING_RAW_F32LE } from '../src/common/editor/wavpack/pcm.js';
import { PcmRepository } from '../src/common/editor/storage/pcm-repository.ts';

class ChecksumOnlyCodec extends WavPackCodecClient {
	async encode(): Promise<never> { throw new Error('This test must only use the checksum operation.'); }
	async decode(): Promise<never> { throw new Error('This test must only use the checksum operation.'); }
}

test('the PCM worker checks raw data without loading WASM and keeps returned payload custody', async (context) => {
	let receive!: (event: { data: Record<string, unknown> }) => void;
	const listeners = new Map<string, (event: { data: unknown }) => void>();
	let failNextPost = false;
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
	Reflect.set(globalThis, 'self', {
		addEventListener(_type: string, callback: typeof receive) { receive = callback; },
		postMessage(message: unknown, transfer: ArrayBuffer[]) {
			listeners.get('message')?.({ data: structuredClone(message, { transfer }) });
		},
	});
	context.after(() => {
		if (previous) Object.defineProperty(globalThis, 'self', previous);
		else Reflect.deleteProperty(globalThis, 'self');
	});
	const fetch = context.mock.method(globalThis, 'fetch', async () => { throw new Error('Checksums must not initialize WASM.'); });
	await import('../src/common/editor/wavpack/worker.js');
	const client = new ChecksumOnlyCodec({ workerFactory: () => ({
		addEventListener(type: string, listener: (event: { data: unknown }) => void) { listeners.set(type, listener); },
		postMessage(message: Record<string, unknown>, transfer: ArrayBuffer[]) {
			if (failNextPost) { failNextPost = false; throw new Error('The checksum worker is unavailable.'); }
			receive({ data: structuredClone(message, { transfer }) });
		},
		terminate() {},
	}) });
	context.after(() => { client.close(); });
	const input = packPlanarFloat32([new Float32Array(8_192).fill(0.25), new Float32Array(8_192).fill(-0.5)]) as ArrayBuffer;
	const options = { frames: 8_192, channelCount: 2, sampleRate: 48_000, priority: 'foreground' };
	const checked = await client.checksum(input, { ...options, pcmCrc32: crc32(input) });
	assert.ok(checked && typeof checked === 'object' && 'pcmCrc32' in checked && 'payload' in checked);
	assert.ok(checked.payload instanceof ArrayBuffer);
	assert.equal(checked.pcmCrc32, crc32(input));
	assert.deepEqual(new Uint8Array(checked.payload), new Uint8Array(input));
	assert.notEqual(checked.payload, input);
	assert.equal(input.byteLength, 65_536);
	await assert.rejects(client.checksum(input, { ...options, pcmCrc32: (crc32(input) + 1) >>> 0 }), /CRC-32/iu);
	assert.equal(fetch.mock.callCount(), 0);

	const pcm = new PcmRepository({ codec: client });
	pcm.setOptimizationMode('speed');
	const encoded = await pcm.encode(input, { ...options, allowRawOnFailure: true });
	assert.equal(encoded.encoding, PCM_ENCODING_RAW_F32LE);
	assert.equal(encoded.pcmCrc32, crc32(input));
	assert.notEqual(encoded.payload, input);
	const record = { encoding: PCM_ENCODING_RAW_F32LE, payload: input, frames: 8_192, index: 0, pcmCrc32: crc32(input) };
	const decoded = await pcm.decodeRecord(record, { channelCount: 2, sampleRate: 48_000 });
	assert.ok(decoded.channels[0].every((sample) => sample === 0.25));
	assert.ok(decoded.channels[1].every((sample) => sample === -0.5));
	assert.equal(decoded.channels[0].buffer, decoded.channels[1].buffer);
	assert.notEqual(decoded.channels[0].buffer, input);
	decoded.channels[0].fill(1);
	assert.equal(new Float32Array(input)[0], 0.25);
	failNextPost = true;
	const fallback = await pcm.encode(input, { ...options, allowRawOnFailure: true });
	assert.equal(fallback.payload, input);
	assert.equal(fallback.pcmCrc32, crc32(input));
	const corrupt = input.slice(0);
	new Uint8Array(corrupt)[0] ^= 1;
	await assert.rejects(pcm.decodeRecord({ ...record, payload: corrupt }, { channelCount: 2, sampleRate: 48_000 }), {
		name: 'PcmStorageCorruptionError', code: 'PCM_CRC_MISMATCH',
	});
	const abort = new AbortController();
	abort.abort();
	await assert.rejects(client.checksum(input, { ...options, signal: abort.signal }), { name: 'AbortError' });
});
