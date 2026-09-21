/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-runtime.mjs';
import { DESKTOP_PROJECT_RUNTIME_FILES } from '../scripts/lib/desktop-project-runtime-files.mjs';

test('the shared desktop project inventory is sorted, unique and fully staged', () => {
	assert.deepEqual(DESKTOP_PROJECT_RUNTIME_FILES, [...DESKTOP_PROJECT_RUNTIME_FILES].sort());
	assert.equal(new Set(DESKTOP_PROJECT_RUNTIME_FILES).size, DESKTOP_PROJECT_RUNTIME_FILES.length);
	for (const member of DESKTOP_PROJECT_RUNTIME_FILES) {
		assert.equal(DESKTOP_EXPECTED_RUNTIME_FILES.includes(member), true, member);
	}
});
