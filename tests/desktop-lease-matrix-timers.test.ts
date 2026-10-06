/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import { withMockLeaseExpiry } from './helpers/desktop-lease-matrix-timers.ts';

test('lease fixture expiry advances promise timers and restores their imported aliases', async (context) => {
	const originalDelay = delay;
	const result = await withMockLeaseExpiry(context, 'stale-lease-takeover', async () => {
		assert.notEqual(delay, originalDelay);
		await Promise.resolve();
		return delay(5_500, 'expired');
	});
	assert.equal(result, 'expired');
	assert.equal(delay, originalDelay);
	assert.equal(await delay(0, 'restored'), 'restored');
});

test('a failed lease case restores promise-timer aliases in its finally path', async (context) => {
	const originalDelay = delay;
	await assert.rejects(withMockLeaseExpiry(context, 'crash-restart-recovery', async () => {
		await Promise.resolve();
		await delay(5_500);
		throw new Error('Lease case failed after expiry.');
	}), /Lease case failed after expiry/u);
	assert.equal(delay, originalDelay);
	assert.equal(await delay(0, 'restored'), 'restored');
});
