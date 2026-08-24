/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { HELPER_CONTRACT_VERSION } from '../desktop/helper-contract.ts';
import { HelperSupervisionError, HelperSupervisor } from '../desktop/helper-supervisor.ts';
import {
	FakeChannel,
	GRANT,
	JOB_KIND,
	createHarness,
	settled,
	supervisionCause,
} from './helpers/helper-supervisor-double.ts';

test('helper supervisor completes a verified round trip and admits one job at a time', async () => {
	const { supervisor, channels, latest } = createHarness();
	const job = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	const queued = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	const channel = latest();
	assert.equal(channels.length, 1);
	const posted = channel.posted[0];
	assert.equal(posted.type, 'job');
	assert.equal(channel.posted.length, 1, 'a pre-handshake concurrent job must wait, not run');
	channel.receive({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'result',
		jobId: posted.type === 'job' ? posted.jobId : '',
		result: { probed: true },
	});
	assert.deepEqual(await job, { probed: true });
	await settled();
	const queuedPosted = channel.posted[1];
	assert.equal(queuedPosted.type, 'job');
	channel.receive({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'result',
		jobId: queuedPosted.type === 'job' ? queuedPosted.jobId : '',
		result: { probed: 'again' },
	});
	assert.deepEqual(await queued, { probed: 'again' });
	assert.equal(supervisor.snapshot().state, 'ready');
});

test('two surfaces sharing one supervisor queue behind each other instead of colliding', async () => {
	const { supervisor, channels, latest } = createHarness({ kinds: [JOB_KIND, 'audio-device'] });
	const probe = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	const inventory = supervisor.runJob({
		kind: 'audio-device',
		grant: { backend: 'alsa', deviceHandle: 'inventory', direction: 'duplex', mode: 'shared' },
	});
	await settled();
	const channel = latest();
	assert.equal(channels.length, 1, 'one payload admits one helper, not one per surface');
	assert.equal(channel.posted.length, 1, 'a queued job must not be posted while another is in flight');
	assert.equal(supervisor.snapshot().state, 'busy');
	const probeJobId = (channel.posted[0] as { jobId: string }).jobId;
	channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId: probeJobId, result: 'probed' });
	assert.equal(await probe, 'probed');
	await settled();
	assert.equal(channel.posted.length, 2, 'the queued job must run once the helper is free');
	const inventoryJobId = (channel.posted[1] as { jobId: string }).jobId;
	assert.notEqual(inventoryJobId, probeJobId);
	channel.receive({
		contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId: inventoryJobId, result: 'described',
	});
	assert.equal(await inventory, 'described');
	assert.equal(supervisor.snapshot().recentCrashes, 0, 'a collision between surfaces is nobody\'s fault');
});

test('a persistent role receives exactly its bound port under its job subcontract', async () => {
	const streamId = 'ab'.repeat(20);
	const port = { postMessage: (_message: unknown) => undefined, close: () => undefined };
	const { supervisor, latest } = createHarness({ kinds: ['audio-device'] });
	const job = supervisor.runJob({
		kind: 'audio-device',
		grant: {
			backend: 'coreaudio', deviceHandle: 'default-output', direction: 'output', mode: 'shared',
			persistentPort: {
				portContractVersion: 1, transport: 'message-port', purpose: 'audio-realtime',
				streamId, generation: 1, maximumMessageBytes: 16_384, maximumInFlightMessages: 4,
			},
		},
		dataPlaneTransfers: [{ streamId, port }],
	});
	await settled();
	const channel = latest();
	assert.deepEqual(channel.transfers, [[port]]);
	const message = channel.posted[0];
	assert.equal(message.type, 'job');
	if (message.type !== 'job') return;
	assert.equal(message.jobContractVersion, 1);
	channel.receive({
		contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId: message.jobId, result: { closed: true },
	});
	assert.deepEqual(await job, { closed: true });
});

test('a queued job that is disposed or quarantined before its turn never reaches the helper', async () => {
	const { supervisor, latest } = createHarness();
	const active = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	const queued = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	assert.equal(latest().posted.length, 1);
	supervisor.dispose();
	await assert.rejects(active, (error: unknown) => supervisionCause(error) === 'disposed');
	await assert.rejects(queued, (error: unknown) => supervisionCause(error) === 'disposed');
	assert.equal(latest().posted.length, 1, 'a disposed supervisor must not post a job it queued');
});

test('a queued job cancelled while it waits its turn is never posted', async () => {
	const { supervisor, latest } = createHarness();
	const controller = new AbortController();
	const active = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	const queued = supervisor.runJob({ kind: JOB_KIND, grant: GRANT, signal: controller.signal });
	await settled();
	const channel = latest();
	controller.abort(new HelperSupervisionError('cancelled', 'The inventory owner went away.'));
	await assert.rejects(queued, (error: unknown) => supervisionCause(error) === 'cancelled');
	const replacement = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	assert.equal(channel.posted.length, 1, 'a cancelled waiter settles while the first job remains active');
	const jobId = (channel.posted[0] as { jobId: string }).jobId;
	channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId, result: 'ok' });
	assert.equal(await active, 'ok');
	await settled();
	const replacementId = (channel.posted[1] as { jobId: string }).jobId;
	channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId: replacementId, result: 'next' });
	assert.equal(await replacement, 'next');
});

test('helper supervisor cannot resume verification or spawn after disposal', { timeout: 1_000 }, async () => {
	for (const phase of ['verification', 'spawn'] as const) {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const { supervisor, channels } = createHarness({
			verifyBinary: phase === 'verification' ? () => gate : undefined,
			completeSpawn: phase === 'spawn' ? async (channel) => { await gate; return channel; } : undefined,
		});
		const job = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
		if (phase === 'verification') await Promise.resolve();
		else await settled();
		supervisor.dispose();
		release();
		await assert.rejects(job, (error: unknown) => supervisionCause(error) === 'disposed');
		await settled();
		assert.deepEqual(
			[channels.length, channels[0]?.killed ?? 0],
			phase === 'verification' ? [0, 0] : [1, 1],
		);
	}
});

test('helper supervisor refuses to spawn on a binary mismatch and never creates a channel', async () => {
	const { supervisor, channels } = createHarness({
		verifyBinary: async () => {
			throw new Error('digest mismatch');
		},
	});
	await assert.rejects(
		supervisor.runJob({ kind: JOB_KIND, grant: GRANT }),
		(error: unknown) => supervisionCause(error) === 'binary-mismatch',
	);
	assert.equal(channels.length, 0, 'no process may be spawned from an unverified payload');
});

test('helper supervisor rejects an invalid main request without faulting its healthy channel', async () => {
	const { supervisor, channels, latest } = createHarness({ quarantineCrashLimit: 1 });
	await assert.rejects(
		supervisor.runJob({
			kind: JOB_KIND,
			grant: { ...GRANT, mediaPath: 'renderer-relative.mp4' },
		}),
		(error: unknown) => supervisionCause(error) === 'invalid-request',
	);
	assert.equal(channels.length, 0, 'an invalid request must fail before helper verification or spawn');
	assert.equal(supervisor.snapshot().quarantined, false);

	const valid = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	const channel = latest();
	const jobId = (channel.posted[0] as { jobId: string }).jobId;
	channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId, result: 'ok' });
	assert.equal(await valid, 'ok', 'the admitted channel must remain usable');
});

test('helper supervisor never posts a known job kind the helper did not negotiate', async () => {
	const { supervisor, latest } = createHarness({ quarantineCrashLimit: 1 });
	await assert.rejects(
		supervisor.runJob({
			kind: 'audio-device',
			grant: {
				backend: 'coreaudio',
				deviceHandle: 'main-owned-default-device',
				direction: 'duplex',
				mode: 'shared',
			},
		}),
		(error: unknown) => supervisionCause(error) === 'unsupported-kind',
	);
	const channel = latest();
	assert.equal(channel.posted.length, 0);
	assert.equal(channel.killed, 0);
	assert.equal(supervisor.snapshot().quarantined, false);
});

test('helper supervisor detects heartbeat silence within the crash-detection budget and kills the helper', async () => {
	const { supervisor, timers, latest } = createHarness();
	const job = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	const channel = latest();
	const jobId = (channel.posted[0] as { jobId: string }).jobId;
	timers.advance(1_999);
	channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'heartbeat', jobId });
	timers.advance(1_999);
	assert.equal(channel.killed, 0, 'a live heartbeat stream must keep the helper alive');
	timers.advance(2);
	await assert.rejects(job, (error: unknown) => supervisionCause(error) === 'heartbeat');
	assert.equal(channel.killed, 1);
});

test('helper supervisor faults duplicate handshakes and stale-generation heartbeats', async () => {
	const duplicate = createHarness({ quarantineCrashLimit: 1 });
	const duplicateJob = duplicate.supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	duplicate.latest().hello();
	await assert.rejects(duplicateJob, (error: unknown) => supervisionCause(error) === 'handshake');
	assert.equal(duplicate.supervisor.snapshot().quarantined, true);

	const stale = createHarness({ quarantineCrashLimit: 1 });
	const staleJob = stale.supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	stale.latest().receive({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'heartbeat',
		jobId: 'ff'.repeat(20),
	});
	await assert.rejects(staleJob, (error: unknown) => supervisionCause(error) === 'job-mismatch');
	assert.equal(stale.supervisor.snapshot().quarantined, true);
});

test('helper supervisor requires hello to be the first process message', async () => {
	const { supervisor, latest } = createHarness({ autoHello: false, quarantineCrashLimit: 1 });
	const pending = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	latest().receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'heartbeat', jobId: null });
	await assert.rejects(pending, (error: unknown) => supervisionCause(error) === 'handshake');
	assert.equal(latest().killed, 1);
	assert.equal(supervisor.snapshot().quarantined, true);
});

test('helper supervisor acknowledges cancellation inside the budget or kills on overrun', async () => {
	const { supervisor, timers, latest } = createHarness();
	const acknowledged = new AbortController();
	const progress: Array<number | null> = [];
	const ackJob = supervisor.runJob({
		kind: JOB_KIND,
		grant: GRANT,
		signal: acknowledged.signal,
		onProgress: (value) => progress.push(value),
	});
	await settled();
	const ackChannel = latest();
	const ackJobId = (ackChannel.posted[0] as { jobId: string }).jobId;
	acknowledged.abort();
	assert.equal(ackChannel.posted.at(-1)?.type, 'cancel');
	ackChannel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'progress', jobId: ackJobId, value: 0.5 });
	ackChannel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'cancelled', jobId: ackJobId });
	await assert.rejects(ackJob, (error: unknown) => supervisionCause(error) === 'cancelled');
	assert.deepEqual(progress, [], 'a cancelled generation must not update editor progress');
	assert.equal(ackChannel.killed, 0, 'an acknowledged cancellation must not kill the helper');

	const overrun = new AbortController();
	const overrunJob = supervisor.runJob({ kind: JOB_KIND, grant: GRANT, signal: overrun.signal });
	await settled();
	const overrunChannel = latest();
	overrun.abort();
	timers.advance(1_000);
	await assert.rejects(overrunJob, (error: unknown) => supervisionCause(error) === 'cancellation-timeout');
	assert.equal(overrunChannel.killed, 1, 'a missed acknowledgement budget must terminate the helper');
});

test('helper supervisor faults cancellation terminals that do not prove requested quiescence', async () => {
	for (const [cancel, terminal] of [
		[true, { contractVersion: HELPER_CONTRACT_VERSION, type: 'result', result: 'late' }],
		[true, { contractVersion: HELPER_CONTRACT_VERSION, type: 'error', error: { name: 'Error', message: 'late' } }],
		[false, { contractVersion: HELPER_CONTRACT_VERSION, type: 'cancelled' }],
	] as const) {
		const { supervisor, channels, latest } = createHarness({ quarantineCrashLimit: 1 });
		const controller = new AbortController();
		const job = supervisor.runJob({
			kind: JOB_KIND, grant: GRANT, ...(cancel ? { signal: controller.signal } : {}),
		});
		await settled();
		const channel = latest();
		const jobId = (channel.posted[0] as { jobId: string }).jobId;
		if (cancel) controller.abort();
		channel.receive({ ...terminal, jobId });
		await assert.rejects(job, (error: unknown) => supervisionCause(error) === 'malformed-message');
		assert.equal(channel.killed, 1, 'an invalid terminal must tear down its generation');
		assert.equal(supervisor.snapshot().quarantined, true);
		await assert.rejects(
			supervisor.runJob({ kind: JOB_KIND, grant: GRANT }),
			(error: unknown) => supervisionCause(error) === 'quarantined',
			'a replacement cannot start after an unproven terminal',
		);
		assert.equal(channels.length, 1);
	}
});

test('helper supervisor publishes bounded monotonic progress suitable for a task coordinator', async () => {
	const progress: Array<number | null> = [];
	const { supervisor, latest } = createHarness();
	const job = supervisor.runJob({
		kind: JOB_KIND,
		grant: GRANT,
		onProgress: (value) => progress.push(value),
	});
	await settled();
	const channel = latest();
	const jobId = (channel.posted[0] as { jobId: string }).jobId;
	for (const value of [null, null, 0.6, 0.2, 0.6, 0.9]) {
		channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'progress', jobId, value });
	}
	assert.deepEqual(progress, [null, 0.6, 0.9], 'duplicates and regressions must not churn editor progress');
	channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId, result: 'ok' });
	assert.equal(await job, 'ok');
});

test('forced cancellation, resource-policy, and contract kills are qualifying quarantine faults', async () => {
	const cancellation = createHarness({ quarantineCrashLimit: 1 });
	const controller = new AbortController();
	const cancelled = cancellation.supervisor.runJob({ kind: JOB_KIND, grant: GRANT, signal: controller.signal });
	await settled();
	controller.abort();
	cancellation.timers.advance(1_000);
	await assert.rejects(cancelled, (error: unknown) => supervisionCause(error) === 'cancellation-timeout');
	assert.equal(cancellation.supervisor.snapshot().quarantined, true);

	const duration = createHarness({ quarantineCrashLimit: 1 });
	const expired = duration.supervisor.runJob({
		kind: JOB_KIND,
		grant: GRANT,
		resourcePolicy: { maximumJobDurationMs: 1 },
	});
	await settled();
	duration.timers.advance(1);
	await assert.rejects(expired, (error: unknown) => supervisionCause(error) === 'resource-violation');
	assert.equal(duration.supervisor.snapshot().quarantined, true);

	const contract = createHarness({ quarantineCrashLimit: 1 });
	const malformed = contract.supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	contract.latest().receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'exec', payload: 'rm -rf' });
	await assert.rejects(malformed, (error: unknown) => supervisionCause(error) === 'malformed-message');
	assert.equal(contract.supervisor.snapshot().quarantined, true);
});

test('acknowledged user cancellation and editor shutdown are not quarantine faults', async () => {
	const { supervisor, latest } = createHarness({ quarantineCrashLimit: 1 });
	const controller = new AbortController();
	const job = supervisor.runJob({ kind: JOB_KIND, grant: GRANT, signal: controller.signal });
	await settled();
	const channel = latest();
	const jobId = (channel.posted[0] as { jobId: string }).jobId;
	controller.abort();
	channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'cancelled', jobId });
	await assert.rejects(job, (error: unknown) => supervisionCause(error) === 'cancelled');
	assert.equal(supervisor.snapshot().recentCrashes, 0);
	assert.equal(supervisor.snapshot().quarantined, false);

	const shutdown = createHarness({ quarantineCrashLimit: 1 });
	const active = shutdown.supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	shutdown.supervisor.dispose();
	await assert.rejects(active, (error: unknown) => supervisionCause(error) === 'disposed');
	assert.equal(shutdown.supervisor.snapshot().recentCrashes, 0);
});

test('a channel failure during cancellation is a helper fault, not a user-cancellation fault', async () => {
	const { supervisor, latest } = createHarness({ quarantineCrashLimit: 1 });
	const controller = new AbortController();
	const job = supervisor.runJob({ kind: JOB_KIND, grant: GRANT, signal: controller.signal });
	await settled();
	const channel = latest();
	channel.throwOnPost = true;
	controller.abort();
	await assert.rejects(job, (error: unknown) => supervisionCause(error) === 'helper-exit');
	assert.equal(channel.killed, 1);
	assert.equal(supervisor.snapshot().quarantined, true);
});

test('helper supervisor settles a kill-mid-job exit, restarts fresh, and quarantines repeated crashes', async () => {
	const { supervisor, timers, channels, latest } = createHarness();
	for (let crash = 0; crash < 3; crash += 1) {
		const job = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
		await Promise.resolve();
		await Promise.resolve();
		latest().exit(9);
		await assert.rejects(job, (error: unknown) => supervisionCause(error) === 'helper-exit');
		timers.advance(1_000);
	}
	assert.equal(channels.length, 3, 'every crash must be followed by a fresh spawn on the next job');
	assert.equal(supervisor.snapshot().quarantined, true, 'three crashes inside the window must quarantine the helper');
	await assert.rejects(
		supervisor.runJob({ kind: JOB_KIND, grant: GRANT }),
		(error: unknown) => supervisionCause(error) === 'quarantined',
	);
	supervisor.clearQuarantine();
	assert.equal(supervisor.snapshot().quarantined, false);
	const recovered = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	const channel = latest();
	const jobId = (channel.posted[0] as { jobId: string }).jobId;
	channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId, result: 'ok' });
	assert.equal(await recovered, 'ok');
});

test('helper supervisor treats malformed and mismatched helper messages as crashes', async () => {
	const malformed = createHarness();
	const malformedJob = malformed.supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	malformed.latest().receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'exec', payload: 'rm -rf' });
	await assert.rejects(malformedJob, (error: unknown) => supervisionCause(error) === 'malformed-message');
	assert.equal(malformed.latest().killed, 1);

	const mismatched = createHarness();
	const mismatchedJob = mismatched.supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	mismatched.latest().receive({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'result',
		jobId: 'ff'.repeat(20),
		result: 'stolen',
	});
	await assert.rejects(mismatchedJob, (error: unknown) => supervisionCause(error) === 'job-mismatch');

	const workerProtocol = createHarness({ quarantineCrashLimit: 1 });
	const workerProtocolJob = workerProtocol.supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	const workerProtocolJobId = (workerProtocol.latest().posted[0] as { jobId: string }).jobId;
	workerProtocol.latest().receive({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'error',
		jobId: workerProtocolJobId,
		error: {
			name: 'TypeError',
			message: 'malformed engine frame',
			code: 'HELPER_ENGINE_PROTOCOL_VIOLATION',
		},
	});
	await assert.rejects(workerProtocolJob, (error: unknown) => supervisionCause(error) === 'malformed-message');
	assert.equal(workerProtocol.latest().killed, 1);
	assert.equal(workerProtocol.supervisor.snapshot().quarantined, true);
});

test('helper supervisor enforces per-job resource policy: input bytes, duration, and peak RSS', async () => {
	const oversizedInput = createHarness();
	await assert.rejects(
		oversizedInput.supervisor.runJob({
			kind: JOB_KIND,
			grant: { ...GRANT, mediaBytes: 2_048 },
			resourcePolicy: { maximumInputBytes: 1_024 },
		}),
		(error: unknown) => supervisionCause(error) === 'resource-violation',
	);

	const expired = createHarness();
	const expiredJob = expired.supervisor.runJob({
		kind: JOB_KIND,
		grant: GRANT,
		resourcePolicy: { maximumJobDurationMs: 5_000 },
	});
	await settled();
	const expiredChannel = expired.latest();
	const expiredJobId = (expiredChannel.posted[0] as { jobId: string }).jobId;
	for (let tick = 0; tick < 4; tick += 1) {
		expired.timers.advance(1_000);
		expiredChannel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'heartbeat', jobId: expiredJobId });
	}
	expired.timers.advance(1_000);
	await assert.rejects(expiredJob, (error: unknown) => supervisionCause(error) === 'resource-violation');
	assert.equal(expiredChannel.killed, 1);

	let rss = 128 * 1024 ** 2;
	const throttled = createHarness({ sampleRss: () => rss });
	const throttledJob = throttled.supervisor.runJob({
		kind: JOB_KIND,
		grant: GRANT,
		resourcePolicy: { maximumRssBytes: 256 * 1024 ** 2 },
	});
	await settled();
	const throttledChannel = throttled.latest();
	const throttledJobId = (throttledChannel.posted[0] as { jobId: string }).jobId;
	throttledChannel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'heartbeat', jobId: throttledJobId });
	rss = 512 * 1024 ** 2;
	throttledChannel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'heartbeat', jobId: throttledJobId });
	await assert.rejects(throttledJob, (error: unknown) => supervisionCause(error) === 'resource-violation');
	assert.equal(throttledChannel.killed, 1);
	assert.equal(throttled.supervisor.snapshot().recentCrashes, 1, 'an RSS kill is a qualifying fault');
});

test('helper supervisor rejects results the kind-specific validator refuses', async () => {
	const { supervisor, latest } = createHarness();
	const job = supervisor.runJob({
		kind: JOB_KIND,
		grant: GRANT,
		validateResult: () => {
			throw new Error('not a probe payload');
		},
	});
	await settled();
	const channel = latest();
	const jobId = (channel.posted[0] as { jobId: string }).jobId;
	channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId, result: { bogus: true } });
	await assert.rejects(job, (error: unknown) => supervisionCause(error) === 'malformed-message');
	assert.equal(channel.killed, 1, 'a helper returning contract-violating results is terminated');
});

test('helper supervisor dispose settles the active job and kills the channel', async () => {
	const { supervisor, latest } = createHarness();
	const job = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	supervisor.dispose();
	await assert.rejects(job, (error: unknown) => supervisionCause(error) === 'disposed');
	assert.equal(latest().killed, 1);
	await assert.rejects(
		supervisor.runJob({ kind: JOB_KIND, grant: GRANT }),
		(error: unknown) => supervisionCause(error) === 'disposed',
	);
});

test('editor shutdown also settles a helper still waiting for its first hello without a fault', async () => {
	const { supervisor, latest } = createHarness({ autoHello: false, quarantineCrashLimit: 1 });
	const starting = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	supervisor.dispose();
	await assert.rejects(starting, (error: unknown) => supervisionCause(error) === 'disposed');
	assert.equal(latest().killed, 1);
	assert.equal(supervisor.snapshot().recentCrashes, 0);
});

test('helper supervisor restores a fresh editor job within five real monotonic seconds', async () => {
	const channels: FakeChannel[] = [];
	let jobSequence = 0;
	const supervisor = new HelperSupervisor({
		spawn: () => {
			const channel = new FakeChannel();
			channels.push(channel);
			return channel;
		},
		verifyBinary: async () => {},
		mintJobId: () => (++jobSequence).toString(16).padStart(40, '0'),
		now: () => performance.now(),
	});
	const failed = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	const recoveryStarted = performance.now();
	channels[0].exit(9);
	await assert.rejects(failed, (error: unknown) => supervisionCause(error) === 'helper-exit');

	const recovered = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	const recoveredChannel = channels[1];
	const jobId = (recoveredChannel.posted[0] as { jobId: string }).jobId;
	recoveredChannel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'result', jobId, result: 'ok' });
	assert.equal(await recovered, 'ok');
	const recoveryMs = performance.now() - recoveryStarted;
	assert.ok(recoveryMs <= 5_000, `editor recovery took ${recoveryMs.toFixed(3)} ms`);
	supervisor.dispose();
});
