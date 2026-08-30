/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	canonicalNativeChildFileIdentity,
	nativeChildFileIdentityFromStat,
} from '../desktop/native-child-file-identity.ts';

test('native child identities preserve the complete unsigned 64-bit filesystem tuple', () => {
	assert.deepEqual(canonicalNativeChildFileIdentity({
		dev: '18446744073709551615', ino: '9007199254740993',
	}), { dev: '18446744073709551615', ino: '9007199254740993' });
	assert.deepEqual(nativeChildFileIdentityFromStat({
		dev: -1n, ino: 9_007_199_254_740_993n,
	}), { dev: '18446744073709551615', ino: '9007199254740993' });
	assert.deepEqual(canonicalNativeChildFileIdentity({ dev: 1, ino: 2 }), { dev: '1', ino: '2' });
});

test('native child identities reject rounded or non-canonical filesystem numbers', () => {
	for (const identity of [
		{ dev: 1, ino: 9_007_199_254_740_992 },
		{ dev: '01', ino: '2' },
		{ dev: '18446744073709551616', ino: '2' },
	]) {
		assert.throws(() => canonicalNativeChildFileIdentity(identity), /file (?:device|inode) is invalid/iu);
	}
});
