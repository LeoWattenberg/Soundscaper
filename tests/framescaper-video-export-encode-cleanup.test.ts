/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { runFramescaperFinishingEncode } from
	'../src/framescaper/video-export-encode-cleanup.ts';

test('finishing encode cleanup retains both the primary and disposal failures', async () => {
	const primary = new Error('encode failed');
	const cleanup = new Error('decoder disposal failed');

	await assert.rejects(
		() => runFramescaperFinishingEncode(
			async () => { throw primary; },
			async () => { throw cleanup; },
		),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.cause, primary);
			assert.deepEqual(error.errors, [primary, cleanup]);
			return true;
		},
	);
});

test('finishing encode cleanup preserves one primary failure and enforces successful cleanup', async () => {
	const primary = new Error('encode failed');
	await assert.rejects(
		() => runFramescaperFinishingEncode(async () => { throw primary; }, async () => undefined),
		(error: unknown) => error === primary,
	);

	const cleanup = new Error('decoder disposal failed');
	await assert.rejects(
		() => runFramescaperFinishingEncode(async () => 'encoded', async () => { throw cleanup; }),
		(error: unknown) => error === cleanup,
	);
});
