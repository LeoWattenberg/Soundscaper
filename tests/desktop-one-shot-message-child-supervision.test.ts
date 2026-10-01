/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	superviseOneShotMessageChild,
	type OneShotMessageChild,
} from '../desktop/one-shot-message-child-supervision.ts';

interface ControlledChild extends OneShotMessageChild {
	readonly messages: unknown[];
	readonly kills: number;
	readonly removals: Readonly<{ message: number; exit: number }>;
	message(value: unknown): void;
	exit(code: number | null): void;
}

function child(options: Readonly<{
	readonly postError?: Error;
	readonly killError?: Error;
}> = {}): ControlledChild {
	let messageListener: ((value: unknown) => void) | undefined;
	let exitListener: ((code: number | null) => void) | undefined;
	const messages: unknown[] = [];
	let kills = 0;
	const removals = { message: 0, exit: 0 };
	return {
		messages,
		get kills() { return kills; },
		removals,
		postMessage(value) {
			if (options.postError) throw options.postError;
			messages.push(value);
		},
		onMessage(listener) {
			messageListener = listener;
			return () => { removals.message += 1; messageListener = undefined; };
		},
		onExit(listener) {
			exitListener = listener;
			return () => { removals.exit += 1; exitListener = undefined; };
		},
		kill() { kills += 1; if (options.killError) throw options.killError; },
		message(value) { messageListener?.(value); },
		exit(code) { exitListener?.(code); },
	};
}

function supervise(
	controlled: ControlledChild,
	options: Readonly<{
		readonly signal?: AbortSignal;
		readonly inspectReady?: (value: unknown) => void;
		readonly inspectTerminal?: (value: unknown) => string;
		readonly maximumDurationMs?: number;
		readonly killWaitMs?: number;
	}> = {},
) {
	return superviseOneShotMessageChild({
		child: controlled,
		...(options.signal ? { signal: options.signal } : {}),
		maximumDurationMs: options.maximumDurationMs ?? 1_000,
		killWaitMs: options.killWaitMs ?? 10,
		inspectReady: options.inspectReady ?? ((value) => {
			if (value !== 'ready') throw new TypeError('ready');
		}),
		createJob: () => 'job',
		inspectTerminal: options.inspectTerminal ?? ((value) => {
			if (value !== 'result') throw new TypeError('terminal');
			return 'accepted';
		}),
		inspectionFailure: (error) => error instanceof RangeError ? 'job-failed' : 'protocol',
		cancelledFailure: 'cancelled',
		crashedFailure: 'crashed',
		timeoutFailure: 'timeout',
	});
}

test('one-shot supervision aborts before ready and removes listeners after exit', async () => {
	const controlled = child();
	const abort = new AbortController();
	abort.abort();
	const completion = supervise(controlled, { signal: abort.signal });
	assert.equal(controlled.kills, 1);
	controlled.exit(null);
	assert.deepEqual(await completion, { status: 'failed', reason: 'cancelled' });
	assert.deepEqual(controlled.removals, { message: 1, exit: 1 });
});

test('one-shot supervision maps ready inspection and post failures', async () => {
	for (const [controlled, options] of [
		[child(), { inspectReady: () => { throw new RangeError('ready'); } }],
		[child({ postError: new Error('post') }), {}],
	] as const) {
		const completion = supervise(controlled, options);
		controlled.message('ready');
		controlled.exit(null);
		assert.deepEqual(await completion, {
			status: 'failed', reason: options.inspectReady ? 'job-failed' : 'protocol',
		});
	}
});

test('one-shot supervision requires ready, one terminal result, and a clean exit', async () => {
	const beforeReady = child();
	const beforeReadyCompletion = supervise(beforeReady);
	beforeReady.exit(0);
	assert.deepEqual(await beforeReadyCompletion, { status: 'failed', reason: 'crashed' });

	const clean = child();
	const cleanCompletion = supervise(clean);
	clean.message('ready');
	clean.message('result');
	clean.exit(0);
	assert.deepEqual(await cleanCompletion, { status: 'complete', result: 'accepted' });
	assert.deepEqual(clean.messages, ['job']);

	const nonzero = child();
	const nonzeroCompletion = supervise(nonzero);
	nonzero.message('ready');
	nonzero.message('result');
	nonzero.exit(7);
	assert.deepEqual(await nonzeroCompletion, { status: 'failed', reason: 'crashed' });
});

test('one-shot supervision rejects duplicate terminal messages and ignores late messages', async () => {
	const duplicate = child();
	const completion = supervise(duplicate);
	duplicate.message('ready');
	duplicate.message('result');
	duplicate.message('result');
	assert.equal(duplicate.kills, 1);
	duplicate.exit(null);
	assert.deepEqual(await completion, { status: 'failed', reason: 'protocol' });
	duplicate.message('late');
	duplicate.exit(0);
	assert.deepEqual(duplicate.removals, { message: 1, exit: 1 });
});

test('one-shot supervision settles when kill throws or a killed child never exits', async () => {
	const throwing = child({ killError: new Error('kill') });
	const abort = new AbortController();
	const throwingCompletion = supervise(throwing, { signal: abort.signal });
	abort.abort();
	assert.deepEqual(await throwingCompletion, { status: 'failed', reason: 'cancelled' });

	const hanging = child();
	const hangingAbort = new AbortController();
	const hangingCompletion = supervise(hanging, { signal: hangingAbort.signal, killWaitMs: 1 });
	hangingAbort.abort();
	assert.deepEqual(await hangingCompletion, { status: 'failed', reason: 'cancelled' });
	assert.deepEqual(hanging.removals, { message: 1, exit: 1 });
});
