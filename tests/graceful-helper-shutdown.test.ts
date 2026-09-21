/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { awaitGracefulHelperShutdown } from '../desktop/graceful-helper-shutdown.ts';

test('a synchronously fired injected deadline still kills and reports graceful failure', async () => {
	let kills = 0;
	let posts = 0;
	await assert.rejects(awaitGracefulHelperShutdown({
		channel: {
			postMessage() { posts += 1; throw new Error('must not post after the deadline'); },
			onExit() {},
			kill() { kills += 1; },
		},
		message: { type: 'shutdown' },
		timeoutMs: 1,
		label: 'fixture helper',
		setTimeoutImpl: ((handler: () => void) => {
			handler();
			return 1 as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout,
		clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
	}), /graceful shutdown deadline/iu);
	assert.equal(posts, 0);
	assert.equal(kills, 1);
});

test('a synchronously replayed clean exit does not post a stale shutdown request', async () => {
	let posts = 0;
	await awaitGracefulHelperShutdown({
		channel: {
			postMessage() { posts += 1; },
			onExit(listener) { listener(0); },
			kill() { assert.fail('a clean exit must not be killed'); },
		},
		message: { type: 'shutdown' }, timeoutMs: 1_000, label: 'fixture helper',
	});
	assert.equal(posts, 0);
});

test('a synchronous clean exit wins when posting reports a stale channel error', async () => {
	let exit: ((code: number | null) => void) | null = null;
	let kills = 0;
	await awaitGracefulHelperShutdown({
		channel: {
			postMessage() { exit?.(0); throw new Error('channel closed after exit'); },
			onExit(listener) { exit = listener; },
			kill() { kills += 1; },
		},
		message: { type: 'shutdown' }, timeoutMs: 1_000, label: 'fixture helper',
	});
	assert.equal(kills, 0);
});
