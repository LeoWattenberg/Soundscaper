/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreOwnedAvcConfiguration } from '../src/common/editor/video-avc-native-configuration.ts';
import { completeVideoAvcColorDescription, createVideoAvcColorNormalizer } from '../src/common/editor/video-avc-color-description.ts';

// Firefox153 actual owned callback: reserved-zero avcC and a duplicated NAL header on each set.
const description = Uint8Array.from(Buffer.from('AU1ACgMBABZnZ01ACuyjE0IAAAMAAgA9CQAeJEssAQAFaGjr7LI=', 'base64'));
const sps = Uint8Array.from(Buffer.from('674d400aeca313420000030002003d09001e244b2c', 'hex'));
const pps = Uint8Array.from(Buffer.from('68ebecb2', 'hex'));
const picture = Uint8Array.of(0x65, 0x88, 0x84, 0, 0x7f);
const prefix = (nal: Uint8Array) => Uint8Array.of(0, 0, nal.length >> 8, nal.length & 255, ...nal);
const body = (...nals: Uint8Array[]) => Uint8Array.from(nals.flatMap(nal => [...prefix(nal)]));
const config = (value = description) => ({ decoderConfig: { codec: 'avc1.4d000a', codedWidth: 96, codedHeight: 64,
	colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } as const, description: value } });
const packet = (data = body(sps, pps, picture), type: 'key' | 'delta' = 'key') => ({ byteLength: data.length, type, timestamp: 0,
	duration: 500_000, copyTo(target: Uint8Array) { target.set(data); } });
const canonical = Uint8Array.of(1, 77, 64, 10, 255, 225, 0, sps.length, ...sps, 1, 0, pps.length, ...pps);

test('Motion repairs only the owned native duplicate-header record with matching actual key parameter sets', () => {
	assert.throws(() => completeVideoAvcColorDescription(description), /AVC/u, 'general metadata parser stays strict');
	const original = description.slice(); const input = body(sps, pps, picture); const raw = input.slice();
	assert.deepEqual(restoreOwnedAvcConfiguration(description, input, 'key'), canonical);
	assert.equal(restoreOwnedAvcConfiguration(canonical, input, 'key'), canonical);
	const received = createVideoAvcColorNormalizer(96, 64)(packet(input), config());
	assert.deepEqual(received.metadata!.decoderConfig!.description, completeVideoAvcColorDescription(canonical, { width: 96, height: 64 }));
	assert.equal(received.metadata!.decoderConfig!.codec, 'avc1.4d000a');
	const output = new Uint8Array(received.chunk.byteLength); received.chunk.copyTo(output);
	const repaired = new Uint8Array(received.metadata!.decoderConfig!.description as Uint8Array);
	const length = repaired[6]! * 256 + repaired[7]!;
	assert.deepEqual(output, body(repaired.slice(8, 8 + length), pps, picture), 'only separately authorized SPS color completion changes packet bytes');
	assert.deepEqual(input, raw); assert.deepEqual(description, original);
	assert.deepEqual([received.chunk.type, received.chunk.timestamp, received.chunk.duration], ['key', 0, 500_000]);
});

test('Motion refuses native serializer repair without exact owned key-packet custody', () => {
	for (const candidate of [packet(body(picture)), packet(body(sps, picture)), packet(body(pps, picture)), packet(undefined, 'delta'),
		packet(body(sps, pps, sps, picture)), packet(body(sps, pps, pps, picture)),
		packet(Uint8Array.of(0, 0, 0, 0)), packet(Uint8Array.of(0, 0, 0, 30, 0x67)), packet(Uint8Array.of(0, 0)),
		packet(body(sps, Uint8Array.of(0x68, 0x81), picture)), packet(body(Uint8Array.of(...sps.slice(0, -1), 0x2d), pps, picture))]) {
		assert.throws(() => createVideoAvcColorNormalizer(96, 64)(candidate, config()), /AVC/u);
	}
});

test('Motion native serializer inverse refuses partial signatures, extra sets, malformed lengths and trailers', () => {
	const changed = (index: number, value: number) => { const bytes = description.slice(); bytes[index] = value; return bytes; };
	for (const bytes of [changed(0, 2), changed(1, 66), changed(4, 255), changed(5, 225), changed(5, 2),
		changed(7, 255), changed(8, 0x27), changed(9, 0x47), changed(description.length - 5, 0x28),
		description.slice(0, -1), Uint8Array.of(...description, 0)]) {
		assert.throws(() => createVideoAvcColorNormalizer(96, 64)(packet(), config(bytes)), /AVC/u);
	}
	assert.throws(() => createVideoAvcColorNormalizer(95, 64)(packet(), config()), /AVC/u);
	assert.throws(() => createVideoAvcColorNormalizer(96, 64)(packet(), { decoderConfig: { ...config().decoderConfig,
		colorSpace: { ...config().decoderConfig.colorSpace, matrix: 'smpte170m' } } }), /AVC/u);
});
