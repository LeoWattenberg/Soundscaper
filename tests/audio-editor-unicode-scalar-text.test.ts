/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { hasOnlyUnicodeScalars } from '../src/common/editor/unicode-scalar-text.ts';

test('Unicode scalar admission accepts complete pairs and rejects lone surrogates', () => {
	for (const value of ['', 'plain text', 'A\u{1f3a7}Z']) assert.equal(hasOnlyUnicodeScalars(value), true);
	for (const value of ['\ud800', '\udfff', '\ud800x', 'x\udfff', '\udfff\ud800']) {
		assert.equal(hasOnlyUnicodeScalars(value), false);
	}
});
