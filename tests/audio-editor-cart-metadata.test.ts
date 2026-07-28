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
