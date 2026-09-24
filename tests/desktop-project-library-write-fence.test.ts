/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertDesktopExpectedProjectDocument,
	DesktopProjectWriteFenceConflict,
	DesktopProjectWriteFences,
} from '../desktop/project-library-write-fence.ts';

test('main write-fence claims invalidate older generations without a save', () => {
	const authority = new DesktopProjectWriteFences();
	const first = authority.claim('project-a');
	authority.assertCurrent('project-a', first);
	const second = authority.claim('project-a');
	assert.notEqual(first, second);
	assert.throws(() => authority.assertCurrent('project-a', first), DesktopProjectWriteFenceConflict);
	authority.assertCurrent('project-a', second);
	assert.throws(() => authority.assertCurrent('project-b', second), DesktopProjectWriteFenceConflict);
	authority.revoke('project-a');
	assert.throws(() => authority.assertCurrent('project-a', second), DesktopProjectWriteFenceConflict);
});

test('expected document comparison uses full document values', () => {
	const actual = { id: 'p', revision: 1, tracks: [{ gain: 0.5 }] };
	assert.doesNotThrow(() => assertDesktopExpectedProjectDocument(
		{ tracks: [{ gain: 0.5 }], revision: 1, id: 'p' }, JSON.stringify(actual),
	));
	assert.throws(() => assertDesktopExpectedProjectDocument(
		{ ...actual, tracks: [{ gain: 0.6 }] }, JSON.stringify(actual),
	), DesktopProjectWriteFenceConflict);
});
