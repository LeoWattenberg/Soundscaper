/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PORTABLE_FILE_STEM_MAX_LENGTH,
	portableFileStem,
} from '../src/common/editor/portable-file-stem.ts';

test('portable artifact stems share one bounded ASCII filename policy', () => {
	assert.equal(portableFileStem('  Mix / one..two  '), 'Mix-one-two');
	assert.equal(portableFileStem('Café Film'), 'Caf-Film');
	assert.equal(portableFileStem('../..', 'project'), 'project');
	assert.equal(portableFileStem(null), '');
	assert.equal(
		portableFileStem('x'.repeat(PORTABLE_FILE_STEM_MAX_LENGTH + 1)).length,
		PORTABLE_FILE_STEM_MAX_LENGTH,
	);
});
