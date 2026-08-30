/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { CART_FIXED_PAYLOAD_BYTES, encodeCartPayload, parseCartPayload } from '../src/common/editor/cart-metadata.ts';

test('AES46 CART metadata round-trips continuity fields and eight post timers', () => {
	const timers = Array.from({ length: 8 }, (_, index) => ({ usage: `T${index}`.padEnd(4, ' '), value: index * 48_000 }));
	const payload = encodeCartPayload({ title: 'Morning News', artist: 'Station', cutId: 'NEWS-001', outCue: 'Back in three', startDate: '2026-07-28', startTime: '06:00:00', producerAppId: 'Soundscaper', levelReference: -2300, postTimers: timers, url: 'https://example.test/item', tagText: '<meta />' });
	assert.ok(payload.byteLength > CART_FIXED_PAYLOAD_BYTES);
	const parsed = parseCartPayload(payload);
	assert.equal(parsed.cutId, 'NEWS-001');
	assert.equal(parsed.postTimers.length, 8);
	assert.equal(parsed.postTimers[7].value, 336_000);
	assert.equal(parsed.tagText, '<meta />');
});

test('CART rejects a ninth timer and non-ASCII fixed-field data', () => {
	assert.throws(() => encodeCartPayload({ postTimers: Array.from({ length: 9 }, () => ({ usage: 'TEST', value: 0 })) }), /eight/u);
	assert.throws(() => encodeCartPayload({ title: 'Grüße' }), /ASCII/u);
});

test('CART interoperates with the AES46 fixed URL field and trailing TagText', () => {
	const url = 'https://example.test/aes46';
	const tagText = 'line one\r\nline two\r\n';
	const tagBytes = new TextEncoder().encode(tagText);
	const fixture = new Uint8Array(2_048 + tagBytes.byteLength);
	fixture.set(new TextEncoder().encode('0101'), 0);
	fixture.set(new TextEncoder().encode(url), 1_024);
	fixture.set(tagBytes, 2_048);

	const parsed = parseCartPayload(fixture);
	assert.equal(parsed.url, url);
	assert.equal(parsed.tagText, tagText);

	const encoded = encodeCartPayload({ url, tagText });
	assert.equal(CART_FIXED_PAYLOAD_BYTES, 2_048);
	assert.equal(new TextDecoder('ascii').decode(encoded.subarray(1_024, 1_024 + url.length)), url);
	assert.equal(new TextDecoder('ascii').decode(encoded.subarray(2_048, 2_048 + tagBytes.length)), tagText);
});
