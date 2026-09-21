/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { awaitAssistanceCleanupPhases } from '../desktop/assistance-cleanup-barrier.ts';

test('assistance cleanup all-settles each phase and every helper flush before aggregating failures', async () => {
	const calls: string[] = [];
	let releaseCleanup!: () => void;
	let releaseHelper!: () => void;
	const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve; });
	const helper = new Promise<void>((resolve) => { releaseHelper = resolve; });
	const barrier = awaitAssistanceCleanupPhases([
		[
			() => { calls.push('workflow'); throw new Error('workflow cleanup failed'); },
			async () => { calls.push('operation'); await cleanup; },
		],
		[
			() => { calls.push('families'); throw new Error('family flush failed'); },
			async () => { calls.push('legacy'); await helper; },
		],
	]);
	await Promise.resolve();
	assert.deepEqual(calls, ['workflow', 'operation']);
	releaseCleanup();
	while (calls.length < 4) await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(calls, ['workflow', 'operation', 'families', 'legacy']);
	let settled = false;
	void barrier.finally(() => { settled = true; }).catch(() => undefined);
	await Promise.resolve();
	assert.equal(settled, false, 'a helper failure cannot skip another helper exit barrier');
	releaseHelper();
	await assert.rejects(barrier, (error: unknown) => error instanceof AggregateError
		&& error.errors.length === 2
		&& error.errors.some((entry) => /workflow cleanup failed/u.test(String(entry)))
		&& error.errors.some((entry) => /family flush failed/u.test(String(entry))));
});

test('ordered cleanup phases release one shared active operation exactly once after an earlier failure', async () => {
	const jobs = new Set(['active-job']);
	let registryReleases = 0;
	const disposeSharedOperations = async () => {
		const owned = [...jobs];
		await Promise.resolve();
		for (const job of owned) {
			jobs.delete(job);
			registryReleases += 1;
		}
	};
	await assert.rejects(awaitAssistanceCleanupPhases([
		[() => { throw new Error('workflow cleanup failed'); }],
		[disposeSharedOperations],
		[disposeSharedOperations],
	]), (error: unknown) => error instanceof AggregateError && error.errors.length === 1);
	assert.equal(registryReleases, 1,
		'the IPC owner and outer composition may dispose the same service, but never concurrently');
});
