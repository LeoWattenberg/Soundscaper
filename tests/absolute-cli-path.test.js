/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAbsoluteCliPath } from '../scripts/lib/absolute-cli-path.mjs';

test('absolute CLI paths normalize the mixed separators emitted by Git Bash', () => {
	assert.equal(
		normalizeAbsoluteCliPath('D:\\a\\_temp/soundscaper-professional-work', 'work root'),
		'D:\\a\\_temp\\soundscaper-professional-work',
	);
	assert.equal(
		normalizeAbsoluteCliPath('/tmp/soundscaper-professional-work', 'work root'),
		'/tmp/soundscaper-professional-work',
	);
});

test('absolute CLI paths reject relative and NUL-containing values', () => {
	assert.throws(() => normalizeAbsoluteCliPath('relative/work', 'work root'), /absolute path/iu);
	assert.throws(() => normalizeAbsoluteCliPath('/tmp/work\0suffix', 'work root'), /absolute path/iu);
	assert.throws(() => normalizeAbsoluteCliPath(undefined, 'work root'), /absolute path/iu);
});
