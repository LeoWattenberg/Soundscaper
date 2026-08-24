/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { HELPER_CONTRACT_VERSION } from '../desktop/helper-contract.ts';
import {
	GRANT,
	JOB_KIND,
	createHarness,
	settled,
	supervisionCause,
} from './helpers/helper-supervisor-double.ts';

test('a terminal racing a cancellation settles as cancelled instead of killing the helper', async () => {
	for (const terminal of [
		{ contractVersion: HELPER_CONTRACT_VERSION, type: 'result', result: 'late' },
		{ contractVersion: HELPER_CONTRACT_VERSION, type: 'error', error: { name: 'Error', message: 'late' } },
	] as const) {
		const { supervisor, latest } = createHarness();
		const controller = new AbortController();
		const job = supervisor.runJob({ kind: JOB_KIND, grant: GRANT, signal: controller.signal });
		await settled();
		const channel = latest();
		const jobId = (channel.posted[0] as { jobId: string }).jobId;
		controller.abort();
		assert.equal(channel.posted.at(-1)?.type, 'cancel');
		// The helper posted its terminal before the cancel reached it, and it
		// will ignore a cancel for a settled job — no acknowledgement follows.
		channel.receive({ ...terminal, jobId });
		await assert.rejects(job, (error: unknown) => supervisionCause(error) === 'cancelled');
		assert.equal(channel.killed, 0, 'a benign wire race must not kill the helper');
		assert.equal(supervisor.snapshot().quarantined, false);
		const replacement = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
		await settled();
		const next = channel.posted.at(-1) as { type: string; jobId: string };
		assert.equal(next.type, 'job', 'the healthy helper keeps serving jobs');
		channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId: next.jobId, result: 'after' });
		assert.equal(await replacement, 'after');
	}
});

test('helper supervisor faults an unrequested cancellation acknowledgement', async () => {
	const { supervisor, latest } = createHarness({ quarantineCrashLimit: 1 });
	const job = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	const channel = latest();
	const jobId = (channel.posted[0] as { jobId: string }).jobId;
	channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'cancelled', jobId });
	await assert.rejects(job, (error: unknown) => supervisionCause(error) === 'malformed-message');
	assert.equal(channel.killed, 1, 'an invalid terminal must tear down its generation');
	assert.equal(supervisor.snapshot().quarantined, true);
	await assert.rejects(
		supervisor.runJob({ kind: JOB_KIND, grant: GRANT }),
		(error: unknown) => supervisionCause(error) === 'quarantined',
		'a replacement cannot start after an unproven terminal',
	);
});

test('an idle heartbeat racing job admission is liveness, not a job mismatch', async () => {
	const { supervisor, latest } = createHarness();
	const job = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	const channel = latest();
	const jobId = (channel.posted[0] as { jobId: string }).jobId;
	// The helper's heartbeat timer fired before the just-posted job message
	// reached it, so the beat still says idle while the supervisor owns a job.
	channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'heartbeat', jobId: null });
	assert.equal(channel.killed, 0, 'an in-flight idle heartbeat must not crash the generation');
	channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId, result: 'done' });
	assert.equal(await job, 'done');
	assert.equal(supervisor.snapshot().recentCrashes, 0);
});

test('concurrent starts join one spawn instead of refusing or double-spawning', async () => {
	const { supervisor, channels } = createHarness();
	await Promise.all([supervisor.start(), supervisor.start()]);
	assert.equal(channels.length, 1, 'two cold starters must share one helper process');
	assert.equal(supervisor.snapshot().state, 'ready');
});
