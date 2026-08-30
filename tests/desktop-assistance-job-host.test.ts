/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceJobHost,
	type AssistanceHelperChannel,
} from '../desktop/assistance-job-host.ts';
import {
	ASSISTANCE_CANCELLATION_BUDGET_MS,
	ASSISTANCE_JOB_PROTOCOL_VERSION,
	validateAssistanceJobRequest,
} from '../desktop/assistance-job-protocol.ts';
import { SPEECH_RUNTIME_MODULE_ID } from '../desktop/assistance-speech-runtime.ts';
import {
	HELPER_CONTRACT_VERSION,
	HELPER_CANCELLATION_BUDGET_MS,
	helperJobSubcontractVersion,
} from '../desktop/helper-contract.ts';

const JOB_ID = 'ab'.repeat(20);
const REQUEST = Object.freeze({
	protocolVersion: ASSISTANCE_JOB_PROTOCOL_VERSION,
	jobId: JOB_ID,
	kind: 'speech' as const,
	grant: Object.freeze({ operation: 'status' as const, moduleId: SPEECH_RUNTIME_MODULE_ID }),
});
const STATUS = Object.freeze({ available: false, reason: 'not installed', moduleId: SPEECH_RUNTIME_MODULE_ID });

class FakeChannel implements AssistanceHelperChannel {
	readonly sent: unknown[] = [];
	killed = false;
	#messageListener: ((message: unknown) => void) | null = null;
	#exitListener: ((code: number | null) => void) | null = null;

	postMessage(message: unknown): void { this.sent.push(message); }
	onMessage(listener: (message: unknown) => void): void {
		this.#messageListener = listener;
		queueMicrotask(() => this.emit({ contractVersion: 1, type: 'hello', kinds: ['assistance-speech'] }));
	}
	onExit(listener: (code: number | null) => void): void { this.#exitListener = listener; }
	kill(): void { this.killed = true; }
	emit(message: unknown): void { this.#messageListener?.(message); }
	exit(code: number | null): void { this.#exitListener?.(code); }
}

function harness(overrides = {}) {
	const channel = new FakeChannel();
	const host = createAssistanceJobHost({ spawn: () => channel, ...overrides });
	return { channel, host };
}

async function ready(channel: FakeChannel): Promise<void> {
	for (let attempt = 0; attempt < 10 && channel.sent.length === 0; attempt += 1) {
		await new Promise((resolve) => { setImmediate(resolve); });
	}
	assert.ok(channel.sent.length > 0, 'the assistance helper handshake must admit its job');
}

test('assistance uses the shared control-v1 envelope and its speech subcontract', async () => {
	assert.equal(ASSISTANCE_CANCELLATION_BUDGET_MS, HELPER_CANCELLATION_BUDGET_MS);
	const { channel, host } = harness();
	const progress: AssistanceProgress[] = [];
	const run = host.start(REQUEST, (value) => progress.push(value));
	await ready(channel);
	assert.deepEqual(channel.sent[0], {
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'job',
		jobId: JOB_ID,
		kind: 'assistance-speech',
		jobContractVersion: helperJobSubcontractVersion('assistance-speech'),
		grant: REQUEST.grant,
		resourcePolicy: {
			maximumInputBytes: 4 * 1024 ** 3,
			maximumJobDurationMs: 24 * 60 * 60_000,
			maximumRssBytes: 1024 ** 3,
			allowNetwork: false,
			allowChildProcesses: false,
			allowOutputFiles: false,
		},
	});
	channel.emit({ contractVersion: 1, type: 'progress', jobId: JOB_ID, value: 0.5 });
	channel.emit({ contractVersion: 1, type: 'result', jobId: JOB_ID, result: STATUS });
	assert.deepEqual(await run.completed, STATUS);
	assert.deepEqual(progress, [{ completed: 0.5, total: 1 }]);
	assert.equal(host.isBusy, false);
});

test('concurrent assistance jobs queue without losing either admitted identity', async () => {
	const { channel, host } = harness();
	const secondId = 'cd'.repeat(20);
	const first = host.start(REQUEST);
	const second = host.start({ ...REQUEST, jobId: secondId });
	await ready(channel);
	assert.equal((channel.sent[0] as { jobId?: string }).jobId, JOB_ID);
	channel.emit({ contractVersion: 1, type: 'result', jobId: JOB_ID, result: STATUS });
	assert.deepEqual(await first.completed, STATUS);
	for (let attempt = 0; attempt < 10 && channel.sent.length < 2; attempt += 1) {
		await new Promise((resolve) => { setImmediate(resolve); });
	}
	assert.equal((channel.sent[1] as { jobId?: string }).jobId, secondId);
	channel.emit({ contractVersion: 1, type: 'result', jobId: secondId, result: STATUS });
	assert.deepEqual(await second.completed, STATUS);
	assert.equal(host.isBusy, false);
});

test('helper faults are contained and translated to assistance failures', async () => {
	for (const [mode, expected] of [['error', 'helper-error'], ['exit', 'helper-exit']] as const) {
		const { channel, host } = harness();
		const run = host.start(REQUEST);
		await ready(channel);
		if (mode === 'error') channel.emit({
			contractVersion: 1, type: 'error', jobId: JOB_ID,
			error: { name: 'Error', message: 'native inference failed' },
		});
		else channel.exit(139);
		await assert.rejects(run.completed, (error: Error & { cause?: string }) => {
			assert.equal(error.name, 'AssistanceJobError');
			assert.equal(error.cause, expected);
			return true;
		});
		host.dispose();
	}
});

test('cancellation is supervised by the shared one-second budget', async () => {
	const { channel, host } = harness({ cancellationBudgetMs: 10 });
	const run = host.start(REQUEST);
	await ready(channel);
	const cancelling = run.cancel();
	assert.deepEqual(channel.sent[1], { contractVersion: 1, type: 'cancel', jobId: JOB_ID });
	channel.emit({ contractVersion: 1, type: 'cancelled', jobId: JOB_ID });
	await cancelling;
	await assert.rejects(run.completed, (error: Error & { cause?: string }) => {
		assert.equal(error.cause, 'cancelled');
		return true;
	});
});

test('an external AbortSignal reaches the helper and settles only after cancellation acknowledgement', async () => {
	const { channel, host } = harness({ cancellationBudgetMs: 50 });
	const controller = new AbortController();
	const run = host.start(REQUEST, { signal: controller.signal });
	await ready(channel);
	controller.abort(new DOMException('user cancelled', 'AbortError'));
	assert.deepEqual(channel.sent[1], { contractVersion: 1, type: 'cancel', jobId: JOB_ID });
	let settled = false;
	void run.completed.catch(() => { settled = true; });
	await Promise.resolve();
	assert.equal(settled, false, 'the run cannot report cancellation before helper quiescence is acknowledged');
	channel.emit({ contractVersion: 1, type: 'cancelled', jobId: JOB_ID });
	await assert.rejects(run.completed, (error: Error & { cause?: string }) => {
		assert.equal(error.cause, 'cancelled');
		return true;
	});
});

test('a signal aborted before admission refuses without spawning or misclassifying its reason', async () => {
	const { channel, host } = harness();
	const controller = new AbortController();
	controller.abort(new Error('replacement task owns the slot'));
	const run = host.start(REQUEST, { signal: controller.signal });
	await assert.rejects(run.completed, (error: Error & { cause?: string }) => {
		assert.equal(error.cause, 'cancelled');
		return true;
	});
	assert.deepEqual(channel.sent, []);
});

test('cancel rejects when the helper misses its acknowledgement budget', async () => {
	const { channel, host } = harness({ cancellationBudgetMs: 5 });
	const run = host.start(REQUEST);
	await ready(channel);
	await assert.rejects(run.cancel(), (error: Error & { cause?: string }) => {
		assert.equal(error.cause, 'cancellation-timeout');
		return true;
	});
	assert.equal(channel.killed, true);
});

test('a silent helper is killed and another job may be admitted', async () => {
	const { channel, host } = harness({ crashDetectionMs: 10 });
	const run = host.start(REQUEST);
	await ready(channel);
	await assert.rejects(run.completed, (error: Error & { cause?: string }) => {
		assert.equal(error.cause, 'heartbeat');
		return true;
	});
	assert.equal(channel.killed, true);
	assert.equal(host.isBusy, false);
});

test('the assistance façade rejects old, path-only requests before spawning', () => {
	const { host } = harness();
	for (const request of [
		{ ...REQUEST, protocolVersion: 1 },
		{ ...REQUEST, jobId: 'job-1' },
		{ ...REQUEST, kind: 'transcribe' },
		{ ...REQUEST, mediaPaths: ['/media/source.wav'] },
	]) {
		assert.throws(() => host.start(request), /protocol|job id|kind|schema keys/iu);
	}
	assert.deepEqual(validateAssistanceJobRequest(REQUEST), REQUEST);
});

type AssistanceProgress = Readonly<{ completed: number; total: number }>;
