/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sourceLineCount } from '../scripts/lib/source-line-count.mjs';

test('a trailing newline does not add a line', () => {
	// The module-size tests once counted the empty string after the final newline, so a file
	// exactly on the 600-line ceiling passed scripts/check-file-size.mjs and failed the test.
	assert.equal(sourceLineCount('one\ntwo\n'), 2);
	assert.equal(sourceLineCount('one\ntwo'), 2);
	assert.equal(sourceLineCount('one\ntwo\n\n'), 3);
	assert.equal(sourceLineCount('one'), 1);
	assert.equal(sourceLineCount(''), 0);
});

test('every newline convention counts the same way', () => {
	assert.equal(sourceLineCount('one\r\ntwo\r\n'), 2);
	assert.equal(sourceLineCount('one\rtwo\r'), 2);
	assert.equal(sourceLineCount('one\r\ntwo\nthree\r'), 3);
});
