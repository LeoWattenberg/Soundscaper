/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createControllerTimers } from '../src/common/editor/controller/controller-timers.ts';

test('controller timers preserve host handles and pair each cancellation with its scheduler', () => {
	const cleared: string[] = [];
	const timers = createControllerTimers({
		setTimeout: () => 42, setInterval: () => 43,
		clearTimeout: handle => { cleared.push(`timeout:${handle}`); },
		clearInterval: handle => { cleared.push(`interval:${handle}`); },
	});
	timers.clearScheduledTimer(timers.scheduleTimer(() => {}, 10));
	timers.clearScheduledInterval(timers.scheduleInterval(() => {}, 10));
	timers.clearScheduledTimer(null);
	timers.clearScheduledInterval(undefined);
	assert.deepEqual(cleared, ['timeout:42', 'interval:43']);
});

test('numeric controller handles cancel the real Node timer and interval', async () => {
	const timers = createControllerTimers({});
	let calls = 0;
	const timeout = timers.scheduleTimer(() => { calls += 1; }, 1);
	const interval = timers.scheduleInterval(() => { calls += 1; }, 1);
	assert.equal(typeof timeout, 'number');
	assert.equal(typeof interval, 'number');
	timers.clearScheduledTimer(timeout);
	timers.clearScheduledInterval(interval);
	await delay(10);
	assert.equal(calls, 0);
});
