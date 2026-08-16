/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	isProjectRevision,
	isStrictlyHigherProjectRevision,
} from '../src/common/editor/project-revision-cas.ts';

test('a project revision is exactly a non-negative safe integer', () => {
	for (const value of [0, 1, 4_096, Number.MAX_SAFE_INTEGER]) {
		assert.equal(isProjectRevision(value), true, `${String(value)} is a revision`);
	}
	for (const value of [
		-1, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
		Number.MAX_SAFE_INTEGER + 1, '1', 1n, null, undefined, {}, [1],
	]) {
		assert.equal(isProjectRevision(value), false, `${String(value)} is not a revision`);
	}
});

test('a coalesced autosave may skip revisions but never repeat or regress one', () => {
	assert.equal(isStrictlyHigherProjectRevision(1, 0), true);
	assert.equal(isStrictlyHigherProjectRevision(2, 0), true);
	assert.equal(isStrictlyHigherProjectRevision(Number.MAX_SAFE_INTEGER, 0), true);
	assert.equal(isStrictlyHigherProjectRevision(0, 0), false);
	assert.equal(isStrictlyHigherProjectRevision(1, 1), false);
	assert.equal(isStrictlyHigherProjectRevision(1, 2), false);
	assert.equal(isStrictlyHigherProjectRevision(0, 1), false);
});

test('the safe-integer ceiling leaves no admissible revision above it', () => {
	assert.equal(isStrictlyHigherProjectRevision(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1), true);
	assert.equal(isStrictlyHigherProjectRevision(Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER), false);
	assert.equal(isStrictlyHigherProjectRevision(Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER), false);
	assert.equal(isStrictlyHigherProjectRevision(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), false);
});

test('a non-integer or negative revision is refused on either side', () => {
	assert.equal(isStrictlyHigherProjectRevision(1.5, 1), false);
	assert.equal(isStrictlyHigherProjectRevision(2, 1.5), false);
	assert.equal(isStrictlyHigherProjectRevision(0, -1), false);
	assert.equal(isStrictlyHigherProjectRevision(-1, -2), false);
	assert.equal(isStrictlyHigherProjectRevision(Number.NaN, 0), false);
	assert.equal(isStrictlyHigherProjectRevision(1, Number.NaN), false);
	assert.equal(isStrictlyHigherProjectRevision('2', 1), false);
	assert.equal(isStrictlyHigherProjectRevision(2, '1'), false);
	assert.equal(isStrictlyHigherProjectRevision(null, undefined), false);
});
