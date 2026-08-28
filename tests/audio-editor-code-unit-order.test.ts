/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { compareCodeUnits } from '../src/common/editor/code-unit-order.ts';

test('compareCodeUnits provides locale-independent UTF-16 ordering', () => {
	assert.deepEqual(
		['a', 'ä', 'z', 'Z', 'A'].sort(compareCodeUnits),
		['A', 'Z', 'a', 'z', 'ä'],
	);
	assert.equal(compareCodeUnits('same', 'same'), 0);
});
