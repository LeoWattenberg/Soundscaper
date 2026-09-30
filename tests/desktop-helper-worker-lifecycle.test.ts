/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHelperResourcePolicy } from '../desktop/helper-contract.ts';
import { createHelperWorkerLifecycle } from '../desktop/helper-worker-lifecycle.ts';
import { deferred } from './helpers/async-test-control.ts';

const JOB_ID = 'cd'.repeat(20);

test('the shared helper lifecycle owns hello, heartbeat, settlement, and timer cleanup', async () => {
	const messages: Array<Record<string, unknown>> = [];
	const exits: number[] = [];
	const timers = intervalHarness();
	const completion = deferred<unknown>();
	const worker = createHelperWorkerLifecycle({
		kinds: ['probe-video-source'],
		post: (message) => messages.push(message as Record<string, unknown>),
		admitsJob: (message) => message.kind === 'probe-video-source',
		transferredPortCount: () => 0,
		runJob: () => ({ completion: completion.promise, cancel: async () => undefined }),
		setIntervalImpl: timers.setInterval as unknown as typeof setInterval,
		clearIntervalImpl: timers.clearInterval as unknown as typeof clearInterval,
		exit: (code) => exits.push(code),
	});

	assert.deepEqual(messages[0], {
		contractVersion: 1, type: 'hello', kinds: ['probe-video-source'],
	});
	timers.fire();
	assert.deepEqual(messages.at(-1), {
		contractVersion: 1, type: 'heartbeat', jobId: null,
	});
	worker.handleMessage(probeMessage(), []);
	timers.fire();
	assert.deepEqual(messages.at(-1), {
		contractVersion: 1, type: 'heartbeat', jobId: JOB_ID,
	});
	completion.resolve({ probe: true });
	await tick();
	assert.deepEqual(messages.at(-1), {
		contractVersion: 1, type: 'result', jobId: JOB_ID, result: { probe: true },
	});

	worker.dispose(7);
	assert.deepEqual(exits, [7]);
	assert.equal(timers.clears, 1);
	worker.dispose(9);
	assert.deepEqual(exits, [7], 'disposal and exit are idempotent');
});

test('the shared helper lifecycle waits for cancellation and suppresses late settlement', async () => {
	const messages: Array<Record<string, unknown>> = [];
	const completion = deferred<unknown>();
	const cancellation = deferred<void>();
	const worker = createHelperWorkerLifecycle({
		kinds: ['probe-video-source'],
		post: (message) => messages.push(message as Record<string, unknown>),
		admitsJob: (message) => message.kind === 'probe-video-source',
		transferredPortCount: () => 0,
		runJob: () => ({ completion: completion.promise, cancel: () => cancellation.promise }),
		setIntervalImpl: inertInterval as unknown as typeof setInterval,
		clearIntervalImpl: () => undefined,
	});

	worker.handleMessage(probeMessage(), []);
	worker.handleMessage({ contractVersion: 1, type: 'cancel', jobId: JOB_ID }, []);
	completion.resolve({ late: true });
	await tick();
	assert.equal(messages.some(({ type }) => type === 'result' || type === 'cancelled'), false);
	cancellation.resolve();
	await tick();
	assert.deepEqual(messages.at(-1), {
		contractVersion: 1, type: 'cancelled', jobId: JOB_ID,
	});
	worker.dispose();
});

test('the shared helper lifecycle exposes rejected-port cleanup and synchronous-failure policy hooks', () => {
	const released: unknown[] = [];
	const messages: Array<Record<string, unknown>> = [];
	const exits: number[] = [];
	const recoverable = createHelperWorkerLifecycle({
		kinds: ['probe-video-source'],
		post: (message) => messages.push(message as Record<string, unknown>),
		admitsJob: (message) => message.kind === 'probe-video-source',
		transferredPortCount: () => 0,
		runJob: () => { throw new Error('recoverable'); },
		releasePorts: (ports) => released.push(ports),
		setIntervalImpl: inertInterval as unknown as typeof setInterval,
		clearIntervalImpl: () => undefined,
		exit: (code) => exits.push(code),
	});
	recoverable.handleMessage(probeMessage(), []);
	assert.equal(messages.at(-1)?.type, 'error');
	assert.deepEqual(exits, []);
	assert.equal(released.length, 1);
	recoverable.dispose();

	const fatalExits: number[] = [];
	const fatal = createHelperWorkerLifecycle({
		kinds: ['probe-video-source'], post: () => undefined,
		admitsJob: (message) => message.kind === 'probe-video-source',
		transferredPortCount: () => 0,
		runJob: () => { throw new Error('fatal'); },
		isFatalRunError: () => true,
		setIntervalImpl: inertInterval as unknown as typeof setInterval,
		clearIntervalImpl: () => undefined,
		exit: (code) => fatalExits.push(code),
	});
	fatal.handleMessage(probeMessage(), []);
	assert.deepEqual(fatalExits, [1]);
});

function probeMessage() {
	return {
		contractVersion: 1,
		type: 'job',
		jobId: JOB_ID,
		kind: 'probe-video-source',
		jobContractVersion: 1,
		grant: { mediaPath: '/media/video.mov', mediaBytes: 12, identity: { dev: 1, ino: 2 } },
		resourcePolicy: normalizeHelperResourcePolicy(undefined, 'probe-video-source'),
	} as const;
}

function intervalHarness() {
	let callback: (() => void) | null = null;
	let clears = 0;
	return {
		setInterval(fn: () => void) {
			callback = fn;
			return { unref() {} };
		},
		clearInterval() { clears += 1; },
		fire() { callback?.(); },
		get clears() { return clears; },
	};
}

function inertInterval(): ReturnType<typeof setInterval> {
	return { unref() {} } as unknown as ReturnType<typeof setInterval>;
}

async function tick(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}
