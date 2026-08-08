/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DesktopMainWindowRecovery } from '../desktop/main-window-recovery.ts';

test('unexpected renderer loss drains ownership before one trusted reload', async () => {
	const events: string[] = [];
	let releaseCleanup: (() => void) | undefined;
	const cleanupBarrier = new Promise<void>((resolve) => { releaseCleanup = resolve; });
	const recovery = new DesktopMainWindowRecovery({
		cleanup: async () => { events.push('cleanup'); await cleanupBarrier; },
		reload: async () => { events.push('reload'); },
		exit: () => { events.push('exit'); },
		reportError: () => { events.push('error'); },
	});

	const first = recovery.recover();
	const duplicate = recovery.recover();
	assert.equal(first, duplicate);
	assert.deepEqual(events, ['cleanup']);
	releaseCleanup?.();
	await first;
	assert.deepEqual(events, ['cleanup', 'reload']);
	await recovery.recover();
	assert.deepEqual(events, ['cleanup', 'reload', 'cleanup', 'reload']);
});

test('renderer cleanup or trusted reload failure exits nonzero', async () => {
	for (const failingStep of ['cleanup', 'reload'] as const) {
		const exits: number[] = [];
		const errors: unknown[] = [];
		const failure = new Error(`planned ${failingStep} failure`);
		const recovery = new DesktopMainWindowRecovery({
			cleanup: async () => { if (failingStep === 'cleanup') throw failure; },
			reload: async () => { if (failingStep === 'reload') throw failure; },
			exit: (code) => { exits.push(code); },
			reportError: (error) => { errors.push(error); },
		});
		await recovery.recover();
		assert.deepEqual(exits, [1]);
		assert.deepEqual(errors, [failure]);
	}
});
