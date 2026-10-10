/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoCubeLutReferenceV1, VIDEO_COLOR_LIMITS_V1 } from '../src/common/editor/cube-lut-reference-contract.ts';
import { VIDEO_COLOR_LIMITS_V1 as bodyLimits } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { normalizeVideoColorGradeV1, VIDEO_COLOR_LIMITS_V1 as gradeLimits } from '../src/common/editor/video-color-management-v27.ts';

function reference() {
	return { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: '73', size: '2',
		domainMin: [-65_536, 0, -Number.MIN_VALUE], domainMax: [65_536, Number.MIN_VALUE, 0] };
}

test('the scalar owner retains public V27 limits and the exact canonical detached custody record', () => {
	assert.deepEqual(VIDEO_COLOR_LIMITS_V1, { maximumCubeLutBytes: 16 * 1024 * 1024, maximumCubeLutSize: 65 });
	assert.equal(bodyLimits, VIDEO_COLOR_LIMITS_V1); assert.equal(gradeLimits, VIDEO_COLOR_LIMITS_V1);
	const input = reference(), normalized = normalizeVideoCubeLutReferenceV1(input);
	assert.deepEqual(normalized, { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 73, size: 2,
		domainMin: [-65_536, 0, -Number.MIN_VALUE], domainMax: [65_536, Number.MIN_VALUE, 0] });
	assert.deepEqual(normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(), lut: input }).lut, normalized);
	assert.equal(Object.isFrozen(normalized), true); assert.equal(Object.isFrozen(normalized.domainMin), true);
	assert.equal(Object.isFrozen(normalized.domainMax), true);
	input.sha256 = 'cd'.repeat(32); input.domainMin[0] = -1;
	assert.equal(normalized.sha256, 'ab'.repeat(32)); assert.equal(normalized.domainMin[0], -65_536);
});

test('the scalar boundary preserves inherited digest, domain and integer refusals without getter reads', () => {
	for (const [change, message] of [
		[{ storageKey: 'unbound' }, 'The cube LUT storage key must bind its SHA-256.'],
		[{ sha256: 'AB'.repeat(32) }, 'cube LUT digest must be lowercase SHA-256.'],
		[{ byteLength: '0' }, 'cube LUT bytes is outside its integer bound.'],
		[{ size: '66' }, 'cube LUT size is outside its integer bound.'],
		[{ domainMin: [-0, 0, 0] }, 'cube LUT domain minimum[0] must be a finite number other than negative zero.'],
		[{ domainMax: [65_537, Number.MIN_VALUE, 0] }, 'cube LUT domain maximum[0] is outside its bound.'],
		[{ domainMin: [65_536, 0, -Number.MIN_VALUE] }, 'The cube LUT reference domain minimum must precede its maximum.'],
	] as const) {
		assert.throws(() => normalizeVideoCubeLutReferenceV1({ ...reference(), ...change }), { message });
	}
	let reads = 0;
	const input = Object.defineProperty(reference(), 'domainMin', { enumerable: true, get() { reads++; throw Error('getter'); } });
	assert.throws(() => normalizeVideoCubeLutReferenceV1(input)); assert.equal(reads, 0);
});

test('reflection failures retain opaque identity and the scalar API donates no parsed-body or pixel authority', async () => {
	let inspected = 0;
	const reason = new Proxy({}, { get() { inspected++; throw Error('reason reflected'); } });
	const input = new Proxy(reference(), { ownKeys() { throw reason; } });
	let actual: unknown;
	try { normalizeVideoCubeLutReferenceV1(input); assert.fail('Expected refusal'); } catch (error) { actual = error; }
	assert.equal(actual, reason); assert.equal(inspected, 0);
	assert.deepEqual(Object.keys(await import('../src/common/editor/cube-lut-reference-contract.ts')).sort(),
		['VIDEO_COLOR_LIMITS_V1', 'normalizeVideoCubeLutReferenceV1']);
});
