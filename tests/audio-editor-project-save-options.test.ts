/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	projectProtectedLinkedOriginalSourceReferences,
	projectProtectedLinkedVideoSourceIds,
	projectPublicationAdmission,
} from '../src/common/editor/storage/project-publication-options.ts';

test('project save options snapshot and deterministically unite kindful caller roots', () => {
	const requested = [
		{ kind: 'video', sourceId: 'shared-source' },
		{ kind: 'audio', sourceId: 'shared-source' },
		{ kind: 'video', sourceId: 'shared-source' },
	];
	const roots = projectProtectedLinkedOriginalSourceReferences({
		protectedLinkedOriginalSourceReferences: requested,
		protectedLinkedVideoSourceIds: ['legacy-source', 'shared-source'],
	});
	requested[0]!.sourceId = 'changed-after-admission';

	assert.deepEqual(roots, [
		{ kind: 'audio', sourceId: 'shared-source' },
		{ kind: 'video', sourceId: 'legacy-source' },
		{ kind: 'video', sourceId: 'shared-source' },
	]);
	assert.equal(Object.isFrozen(roots), true);
	assert.equal(Object.isFrozen(roots?.[0]), true);
});

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
	const options = {
		admitProjectPublication,
		protectedLinkedOriginalSourceReferences: [],
		protectedLinkedVideoSourceIds: [],
	};

	assert.strictEqual(projectPublicationAdmission(options), admitProjectPublication);
	assert.deepEqual(projectProtectedLinkedOriginalSourceReferences(options), []);
	assert.deepEqual(projectProtectedLinkedVideoSourceIds(options), []);
});

test('kindful project save roots are closed, bounded, and canonical', () => {
	assert.throws(
		() => projectProtectedLinkedOriginalSourceReferences({
			protectedLinkedOriginalSourceReferences: 'source-a',
		}),
		/array limit/iu,
	);
	assert.throws(
		() => projectProtectedLinkedOriginalSourceReferences({
			protectedLinkedOriginalSourceReferences: [{ kind: 'image', sourceId: 'source-a' }],
		}),
		/audio or video/iu,
	);
	assert.throws(
		() => projectProtectedLinkedOriginalSourceReferences({
			protectedLinkedOriginalSourceReferences: [{
				kind: 'audio',
				sourceId: 'source-a',
				unsupported: true,
			}],
		}),
		/unsupported field/iu,
	);
	assert.throws(
		() => projectProtectedLinkedOriginalSourceReferences({
			protectedLinkedOriginalSourceReferences: [{ kind: 'audio', sourceId: ' noncanonical' }],
		}),
		/canonical/iu,
	);
	assert.throws(
		() => projectProtectedLinkedOriginalSourceReferences({
			protectedLinkedOriginalSourceReferences: Array.from(
				{ length: 100_001 },
				() => ({ kind: 'audio', sourceId: 'source-a' }),
			),
		}),
		/array limit/iu,
	);
	assert.throws(
		() => projectProtectedLinkedOriginalSourceReferences({
			protectedLinkedVideoSourceIds: ['source-a', 'source-a'],
		}),
		/duplicate/iu,
	);
	assert.equal(projectProtectedLinkedOriginalSourceReferences({}), null);
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
