/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { WavPackCodecClient } from '../src/common/editor/wavpack/client.js';
import { crc32, packPlanarFloat32, PCM_ENCODING_WAVPACK_F32_V1 } from '../src/common/editor/wavpack/pcm.js';
import { PcmRepository } from '../src/common/editor/storage/pcm-repository.ts';

test('decoded PCM gets a separate worker CRC fence and private owned channel views with safe fallback', async (t) => {
	const input = packPlanarFloat32([new Float32Array(8_192).fill(0.25), new Float32Array(8_192).fill(-0.5)]) as ArrayBuffer;
	let receive!: (event: { data: unknown }) => void, reply!: (event: { data: unknown }) => void;
	let checks = 0, fail = false, corrupt = false;
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
	Reflect.set(globalThis, 'self', { addEventListener(_type: string, listener: typeof receive) { receive = listener; },
		postMessage(value: unknown, transfer: ArrayBuffer[]) { reply({ data: structuredClone(value, { transfer }) }); } });
	t.after(() => { if (previous) Object.defineProperty(globalThis, 'self', previous); else Reflect.deleteProperty(globalThis, 'self'); });
	await import('../src/common/editor/wavpack/worker.js');
	class DecodedFixtureCodec extends WavPackCodecClient {
		async encode(): Promise<never> { throw new Error('Encoding is outside this fixture.'); }
		async decode() { const payload = input.slice(0); if (corrupt) new Uint8Array(payload)[0] ^= 1; return { payload }; }
	}
	const codec = new DecodedFixtureCodec({ workerFactory: () => ({ addEventListener(type: string, listener: typeof reply) { if (type === 'message') reply = listener; },
		postMessage(value: unknown, transfer: ArrayBuffer[]) { checks += 1; if (fail) throw new Error('Worker unavailable.'); receive({ data: structuredClone(value, { transfer }) }); }, terminate() {} }) });
	t.after(() => { codec.close(); });
	const repository = new PcmRepository({ codec });
	const record = { encoding: PCM_ENCODING_WAVPACK_F32_V1, payload: Uint8Array.of(1, 2, 3).buffer, index: 0, frames: 8_192, pcmCrc32: crc32(input) };
	const source = { sampleRate: 48_000, channelCount: 2 };
	const first = await repository.decodeRecord(record, source);
	assert.equal(checks, 1, 'the renderer CRC is performed by the independently owned checksum operation');
	assert.equal(first.channels[0]?.buffer, first.channels[1]?.buffer);
	assert.notEqual(first.channels[0]?.buffer, input);
	first.channels[0]?.fill(1);
	assert.equal((await repository.decodeRecord(record, source)).channels[0]?.[0], 0.25);
	corrupt = true; await assert.rejects(repository.decodeRecord(record, source), /CRC-32/iu);
	corrupt = false; fail = true;
	const fallback = await repository.decodeRecord(record, source);
	assert.equal(fallback.channels[0]?.[0], 0.25);
	assert.notEqual(fallback.channels[0]?.buffer, fallback.channels[1]?.buffer);
	corrupt = true; await assert.rejects(repository.decodeRecord(record, source), /CRC-32/iu);
});
