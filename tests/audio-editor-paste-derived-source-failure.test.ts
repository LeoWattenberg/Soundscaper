/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { rollbackDerivedSourcesAfterFailure } from '../src/common/editor/controller/edit/internal/paste-derived-source-failure.ts';

test('derived-source failure skips rollback when no records were persisted', async () => {
	const primaryFailure = new Error('primary failure');
	let rollbackCalls = 0;

	await assert.rejects(rollbackDerivedSourcesAfterFailure([], primaryFailure, {
		message: 'Operation and rollback both failed.',
		rollback: () => { rollbackCalls += 1; },
	}), (error: unknown) => error === primaryFailure);
	assert.equal(rollbackCalls, 0);
});

test('derived-source failure rethrows the primary failure after a successful rollback', async () => {
	const primaryFailure = new Error('primary failure');
	const records = [{ source: { id: 'derived' } }] as const;
	let rolledBack: readonly (typeof records)[number][] | null = null;

	await assert.rejects(rollbackDerivedSourcesAfterFailure(records, primaryFailure, {
		message: 'Operation and rollback both failed.',
		rollback: (received) => { rolledBack = received; },
	}), (error: unknown) => error === primaryFailure);
	assert.equal(rolledBack, records);
});

test('derived-source failure aggregates the primary and configurable rollback failures', async () => {
	const primaryFailure = new Error('primary failure');
	const rollbackFailure = new Error('rollback failure');
	const message = 'Caller-specific operation and rollback both failed.';

	await assert.rejects(rollbackDerivedSourcesAfterFailure([{ source: { id: 'derived' } }], primaryFailure, {
		message,
		rollback: () => { throw rollbackFailure; },
	}), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [primaryFailure, rollbackFailure]);
		assert.equal(error.message, message);
		assert.equal(error.cause, rollbackFailure);
		return true;
	});
});
