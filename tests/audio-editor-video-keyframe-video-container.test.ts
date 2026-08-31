/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertFiniteVideoKeyframeContainer } from '../src/common/editor/video-keyframe-video-container.ts';

const EBML_ID = Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3);
const DOCTYPE = Uint8Array.of(0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d);

test('finite WebM validation refuses a noncanonical DocType before reading its payload', () => {
	const docTypePayload = new Uint8Array(64).fill(0x61);
	const child = join(Uint8Array.of(0x42, 0x82), ebmlSize(docTypePayload.byteLength), docTypePayload);
	const size = ebmlSize(child.byteLength);
	const bytes = join(EBML_ID, size, child);
	const payloadOffset = EBML_ID.byteLength + size.byteLength + 2 + 1;

	assertInvalidWebmBeforeGuard(bytes, payloadOffset);
});

test('finite WebM validation enforces its element cap inside the EBML header', () => {
	// Header + DocType consume two of the 65,536 admitted elements. The final
	// empty child is therefore the first element beyond the cap.
	const emptyChildren = 65_535;
	const payload = new Uint8Array(DOCTYPE.byteLength + emptyChildren * 2);
	payload.set(DOCTYPE);
	for (let index = 0; index < emptyChildren; index += 1) {
		payload.set([0x81, 0x80], DOCTYPE.byteLength + index * 2);
	}
	const size = ebmlSize(payload.byteLength);
	const bytes = join(EBML_ID, size, payload);
	const payloadOffset = EBML_ID.byteLength + size.byteLength;
	const firstOverLimitOffset = payloadOffset + DOCTYPE.byteLength + (emptyChildren - 1) * 2;

	assertInvalidWebmBeforeGuard(bytes, firstOverLimitOffset);
});

function assertInvalidWebmBeforeGuard(bytes: Uint8Array, guardedOffset: number): void {
	const unexpectedRead = new Error('validator read beyond its bounded WebM admission');
	const guarded = new Proxy(bytes, {
		get(target, property) {
			if (typeof property === 'string' && /^\d+$/u.test(property)
				&& Number(property) >= guardedOffset) throw unexpectedRead;
			return Reflect.get(target, property, target) as unknown;
		},
	}) as unknown as Uint8Array;
	assert.throws(
		() => assertFiniteVideoKeyframeContainer(guarded, 'webm'),
		(error: unknown) => error instanceof TypeError && /finite WebM container/u.test(error.message),
	);
}

function ebmlSize(value: number): Uint8Array {
	if (value <= 0x7e) return Uint8Array.of(0x80 | value);
	if (value <= 0x3ffe) return Uint8Array.of(0x40 | (value >>> 8), value & 0xff);
	if (value <= 0x1f_fffe) {
		return Uint8Array.of(0x20 | (value >>> 16), (value >>> 8) & 0xff, value & 0xff);
	}
	throw new RangeError('Fixture EBML payload is too large.');
}

function join(...parts: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}
