/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { HELPER_CONTRACT_VERSION, type HelperHostMessage } from '../desktop/helper-contract.ts';
import {
	HelperSupervisionError,
	HelperSupervisor,
	type HelperChannel,
} from '../desktop/helper-supervisor.ts';

const JOB_KIND = 'probe-video-source' as const;
const GRANT = Object.freeze({
	mediaPath: '/media/example.mp4',
	mediaBytes: 2_048,
	identity: Object.freeze({ dev: 3, ino: 42 }),
});

class FakeTimers {
	now = 0;
	#timers = new Map<number, { at: number; handler: () => void }>();
	#sequence = 0;

	setTimeout = (handler: () => void, delayMs: number) => {
		this.#sequence += 1;
		this.#timers.set(this.#sequence, { at: this.now + delayMs, handler });
		return this.#sequence as unknown as ReturnType<typeof setTimeout>;
	};

	clearTimeout = (timer: unknown) => {
		this.#timers.delete(timer as number);
	};

	advance(byMs: number): void {
		const target = this.now + byMs;
		for (;;) {
			const due = [...this.#timers.entries()]
				.filter(([, entry]) => entry.at <= target)
				.sort(([, left], [, right]) => left.at - right.at)[0];
			if (!due) break;
			this.now = due[1].at;
			this.#timers.delete(due[0]);
			due[1].handler();
		}
		this.now = target;
	}
}

class FakeChannel implements HelperChannel {
	readonly posted: HelperHostMessage[] = [];
	killed = 0;
	autoHello = true;
	#messageListener: ((message: unknown) => void) | null = null;
	#exitListener: ((code: number | null) => void) | null = null;

	postMessage(message: HelperHostMessage): void {
		this.posted.push(message);
	}

	onMessage(listener: (message: unknown) => void): void {
		this.#messageListener = listener;
		// A real utility process cannot deliver messages before the listener
		// exists; the double greets as soon as supervision starts listening.
		if (this.autoHello) queueMicrotask(() => this.hello());
	}

	onExit(listener: (code: number | null) => void): void {
		this.#exitListener = listener;
	}

	kill(): void {
		this.killed += 1;
	}

	receive(message: unknown): void {
		this.#messageListener?.(message);
	}

	hello(): void {
		this.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'hello', kinds: [JOB_KIND] });
	}

	exit(code: number | null): void {
		this.#exitListener?.(code);
	}
}

function createHarness(options: Readonly<{
	verifyBinary?: () => Promise<void>;
	sampleRss?: () => number | null;
}> = {}) {
	const timers = new FakeTimers();
	const channels: FakeChannel[] = [];
	let jobSequence = 0;
	const supervisor = new HelperSupervisor({
		spawn: () => {
			const channel = new FakeChannel();
			channels.push(channel);
			return channel;
		},
		verifyBinary: options.verifyBinary ?? (async () => {}),
		mintJobId: () => (++jobSequence).toString(16).padStart(40, '0'),
		sampleRss: options.sampleRss,
		now: () => timers.now,
		setTimeoutImpl: timers.setTimeout as typeof setTimeout,
		clearTimeoutImpl: timers.clearTimeout as typeof clearTimeout,
	});
	return { supervisor, timers, channels, latest: () => channels.at(-1)! };
}

function supervisionCause(error: unknown): string | null {
	return error instanceof HelperSupervisionError ? error.cause_ : null;
}

function settled(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

test('helper supervisor completes a verified round trip and enforces single-job admission', async () => {
	const { supervisor, channels, latest } = createHarness();
	const job = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	const channel = latest();
	assert.equal(channels.length, 1);
	const posted = channel.posted[0];
	assert.equal(posted.type, 'job');
	await assert.rejects(
		supervisor.runJob({ kind: JOB_KIND, grant: GRANT }),
		(error: unknown) => supervisionCause(error) === 'helper-error',
		'a second concurrent job must be refused',
	);
	channel.receive({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'result',
		jobId: posted.type === 'job' ? posted.jobId : '',
		result: { probed: true },
	});
	assert.deepEqual(await job, { probed: true });
	assert.equal(supervisor.snapshot().state, 'ready');
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

test('helper supervisor detects heartbeat silence within the crash-detection budget and kills the helper', async () => {
	const { supervisor, timers, latest } = createHarness();
	const job = supervisor.runJob({ kind: JOB_KIND, grant: GRANT });
	await settled();
	const channel = latest();
	timers.advance(1_999);
	channel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'heartbeat', jobId: null });
	timers.advance(1_999);
	assert.equal(channel.killed, 0, 'a live heartbeat stream must keep the helper alive');
	timers.advance(2);
	await assert.rejects(job, (error: unknown) => supervisionCause(error) === 'heartbeat');
	assert.equal(channel.killed, 1);
});

test('helper supervisor acknowledges cancellation inside the budget or kills on overrun', async () => {
	const { supervisor, timers, latest } = createHarness();
	const acknowledged = new AbortController();
	const ackJob = supervisor.runJob({ kind: JOB_KIND, grant: GRANT, signal: acknowledged.signal });
	await settled();
	const ackChannel = latest();
	const ackJobId = (ackChannel.posted[0] as { jobId: string }).jobId;
	acknowledged.abort();
	assert.equal(ackChannel.posted.at(-1)?.type, 'cancel');
	ackChannel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'cancelled', jobId: ackJobId });
	await assert.rejects(ackJob, (error: unknown) => supervisionCause(error) === 'cancelled');
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
	for (let tick = 0; tick < 4; tick += 1) {
		expired.timers.advance(1_000);
		expiredChannel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'heartbeat', jobId: null });
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
	throttledChannel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'heartbeat', jobId: null });
	rss = 512 * 1024 ** 2;
	throttledChannel.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'heartbeat', jobId: null });
	await assert.rejects(throttledJob, (error: unknown) => supervisionCause(error) === 'resource-violation');
	assert.equal(throttledChannel.killed, 1);
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
