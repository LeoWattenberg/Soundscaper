/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createMotionAeHostSha256 } from '../src/common/editor/motion-ae-host-sha256.ts';
test('ES3 media hashing matches SHA-256 across padding boundaries and bounded chunks', () => {
	for (const length of [0, 1, 55, 56, 63, 64, 65, 127, 1024, 65_537]) {
		const bytes = Buffer.from(Array.from({ length }, (_, index) => (index * 73 + 11) % 256)), digest = createMotionAeHostSha256();
		for (let offset = 0; offset < bytes.length; offset += 37) digest.update(bytes.subarray(offset, offset + 37).toString('latin1'));
		assert.equal(digest.finish(), createHash('sha256').update(bytes).digest('hex')); assert.equal(digest.finish().length, 64);
		assert.throws(() => digest.update('a'), /finished/u);
	}
});
test('ES3 media hashing rejects non-binary strings and unbounded input chunks', () => {
	assert.throws(() => createMotionAeHostSha256().update('𝄞'), /binary/u);
	assert.throws(() => createMotionAeHostSha256().update('x'.repeat(1_048_577)), /chunk/u);
});
