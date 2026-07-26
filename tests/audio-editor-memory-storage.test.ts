/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

test('memory storage isolates names and retains a process-local named database', () => {
	const first = getMemoryDatabase('first');
	const same = getMemoryDatabase('first');
	const other = getMemoryDatabase('other');
	first.settings.set('theme', 'dark');
	assert.equal(same, first);
	assert.equal(same.settings.get('theme'), 'dark');
	assert.notEqual(other, first);
	assert.equal(other.settings.has('theme'), false);
});
