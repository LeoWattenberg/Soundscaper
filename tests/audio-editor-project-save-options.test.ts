/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	projectProtectedLinkedVideoSourceIds,
	projectPublicationAdmission,
} from '../src/common/editor/storage/project-publication-options.ts';

test('project save options snapshot immutable authoritative linked-video roots', () => {
	const requested = ['source-a', 'source-b'];
	const roots = projectProtectedLinkedVideoSourceIds({
		protectedLinkedVideoSourceIds: requested,
	});
	requested[0] = 'changed-after-admission';

	assert.deepEqual(roots, ['source-a', 'source-b']);
	assert.equal(Object.isFrozen(roots), true);
});

test('project save options accept publication admission and source protection together', () => {
	const admitProjectPublication = async () => undefined;
	const options = { admitProjectPublication, protectedLinkedVideoSourceIds: [] };

	assert.strictEqual(projectPublicationAdmission(options), admitProjectPublication);
	assert.deepEqual(projectProtectedLinkedVideoSourceIds(options), []);
});

test('invalid or incomplete source protection cannot authorize destructive cleanup', () => {
	assert.throws(
		() => projectProtectedLinkedVideoSourceIds({ protectedLinkedVideoSourceIds: 'source-a' }),
		/array limit/iu,
	);
	assert.throws(
		() => projectProtectedLinkedVideoSourceIds({ protectedLinkedVideoSourceIds: ['source-a', 'source-a'] }),
		/duplicate/iu,
	);
	assert.throws(
		() => projectProtectedLinkedVideoSourceIds({ protectedLinkedVideoSourceIds: [' noncanonical'] }),
		/canonical/iu,
	);
	assert.equal(projectProtectedLinkedVideoSourceIds({}), null);
});
