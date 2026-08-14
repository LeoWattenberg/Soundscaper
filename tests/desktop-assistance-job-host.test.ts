/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceJobHost,
	type AssistanceHelperChannel,
} from '../desktop/assistance-job-host.ts';
import {
	ASSISTANCE_JOB_PROTOCOL_VERSION,
	validateAssistanceJobRequest,
} from '../desktop/assistance-job-protocol.ts';

const REQUEST = Object.freeze({
	protocolVersion: ASSISTANCE_JOB_PROTOCOL_VERSION,
	jobId: 'job-1',
	kind: 'transcribe' as const,
	modelId: 'parakeet-tdt-0.6b-v2',
	mediaPaths: ['/media/source.wav'],
	options: { language: 'en' },
});

class FakeChannel implements AssistanceHelperChannel {
	readonly sent: unknown[] = [];

	killed = false;

	#messageListener: ((message: unknown) => void) | null = null;

	#exitListener: ((code: number | null) => void) | null = null;

	postMessage(message: unknown): void {
		this.sent.push(message);
	}

	onMessage(listener: (message: unknown) => void): void {
		this.#messageListener = listener;
	}

	onExit(listener: (code: number | null) => void): void {
		this.#exitListener = listener;
	}

	kill(): void {
		this.killed = true;
	}

	emit(message: unknown): void {
		this.#messageListener?.(message);
	}

	exit(code: number | null): void {
		this.#exitListener?.(code);
	}
}

function hostWith(channel: FakeChannel, overrides = {}) {
	return createAssistanceJobHost({ spawn: () => channel, ...overrides });
}

test('a job forwards progress and resolves with the helper result', { timeout: 10_000 }, async () => {
	const channel = new FakeChannel();
	const host = hostWith(channel);
	const progress: number[] = [];

	const run = host.start(REQUEST, ({ completed }) => progress.push(completed));
	assert.equal(host.isBusy, true);
	assert.deepEqual(channel.sent[0], validateAssistanceJobRequest(REQUEST));

	channel.emit({ type: 'progress', jobId: 'job-1', completed: 5, total: 10 });
	channel.emit({ type: 'result', jobId: 'job-1', payload: { segments: [] } });

	assert.deepEqual(await run.completed, { segments: [] });
	assert.deepEqual(progress, [5]);
	assert.equal(channel.killed, true, 'a finished job releases its helper');
	assert.equal(host.isBusy, false);
});

test('a helper error surfaces as a typed failure', { timeout: 10_000 }, async () => {
	const channel = new FakeChannel();
	const run = hostWith(channel).start(REQUEST);

	channel.emit({ type: 'error', jobId: 'job-1', reason: 'the model failed to load' });

	await assert.rejects(run.completed, (error: Error & { cause?: string }) => {
		assert.equal(error.name, 'AssistanceJobError');
		assert.equal(error.cause, 'helper-error');
		assert.match(error.message, /model failed to load/iu);
		return true;
	});
});

test('a helper crash fails the job instead of the editor', { timeout: 10_000 }, async () => {
	const channel = new FakeChannel();
	const host = hostWith(channel);
	const run = host.start(REQUEST);

	channel.exit(139);

	await assert.rejects(run.completed, (error: Error & { cause?: string }) => {
		assert.equal(error.cause, 'helper-exit');
		return true;
	});
	assert.equal(host.isBusy, false, 'the host is usable again after a crash');
});

test('a malformed helper message is rejected rather than partially trusted', { timeout: 10_000 }, async () => {
	const channel = new FakeChannel();
	const run = hostWith(channel).start(REQUEST);

	channel.emit({ type: 'progress', jobId: 'job-1', completed: 50, total: 10 });

	await assert.rejects(run.completed, (error: Error & { cause?: string }) => {
		assert.equal(error.cause, 'malformed-message');
		return true;
	});
});

test('a message for another job is refused', { timeout: 10_000 }, async () => {
	const channel = new FakeChannel();
	const run = hostWith(channel).start(REQUEST);

	channel.emit({ type: 'result', jobId: 'job-2', payload: null });

	await assert.rejects(run.completed, (error: Error & { cause?: string }) => {
		assert.equal(error.cause, 'job-mismatch');
		return true;
	});
});

test('a silent helper is failed by the heartbeat', { timeout: 10_000 }, async () => {
	const channel = new FakeChannel();
	const run = hostWith(channel, { heartbeatMs: 10 }).start(REQUEST);

	await assert.rejects(run.completed, (error: Error & { cause?: string }) => {
		assert.equal(error.cause, 'heartbeat');
		return true;
	});
});

test('progress re-arms the heartbeat so a long job is not killed', { timeout: 10_000 }, async () => {
	const channel = new FakeChannel();
	const run = hostWith(channel, { heartbeatMs: 60 }).start(REQUEST);

	for (let index = 0; index < 4; index += 1) {
		await new Promise((resolve) => { setTimeout(resolve, 20); });
		channel.emit({ type: 'progress', jobId: 'job-1', completed: index + 1, total: 10 });
	}
	channel.emit({ type: 'result', jobId: 'job-1', payload: 'done' });

	assert.equal(await run.completed, 'done');
});

test('cancellation asks the helper and settles the job', { timeout: 10_000 }, async () => {
	const channel = new FakeChannel();
	const run = hostWith(channel).start(REQUEST);

	const cancelling = run.cancel();
	assert.deepEqual(channel.sent[1], { type: 'cancel', jobId: 'job-1' });
	channel.emit({ type: 'cancelled', jobId: 'job-1' });
	await cancelling;

	await assert.rejects(run.completed, (error: Error & { cause?: string }) => {
		assert.equal(error.cause, 'cancelled');
		return true;
	});
});

test('a helper that ignores cancellation is abandoned within the budget', { timeout: 10_000 }, async () => {
	const channel = new FakeChannel();
	const run = hostWith(channel, { heartbeatMs: 60_000, cancellationBudgetMs: 10 }).start(REQUEST);

	await run.cancel();

	await assert.rejects(run.completed, (error: Error & { cause?: string }) => {
		assert.equal(error.cause, 'cancellation-timeout');
		return true;
	});
	assert.equal(channel.killed, true);
});

test('only one job runs at a time', { timeout: 10_000 }, async () => {
	const channel = new FakeChannel();
	const host = hostWith(channel);
	const run = host.start(REQUEST);

	assert.throws(() => host.start({ ...REQUEST, jobId: 'job-2' }), /already running/iu);

	channel.emit({ type: 'result', jobId: 'job-1', payload: null });
	await run.completed;

	const second = host.start({ ...REQUEST, jobId: 'job-2' });
	assert.equal(host.isBusy, true, 'the slot is reusable once the first job settles');
	host.dispose();
	await assert.rejects(second.completed, (error: Error & { cause?: string }) => {
		assert.equal(error.cause, 'disposed');
		return true;
	});
});

test('a request that names no media or an unusable path is refused', () => {
	assert.throws(() => validateAssistanceJobRequest({ ...REQUEST, mediaPaths: [] }), /between one and 64/iu);
	assert.throws(
		() => validateAssistanceJobRequest({ ...REQUEST, mediaPaths: ['relative/source.wav'] }),
		/must be absolute/iu,
	);
	assert.throws(
		() => validateAssistanceJobRequest({ ...REQUEST, mediaPaths: ['/media/../etc/passwd'] }),
		/must not traverse/iu,
	);
	assert.throws(() => validateAssistanceJobRequest({ ...REQUEST, kind: 'summarize' }), /kind is unrecognised/iu);
	assert.throws(() => validateAssistanceJobRequest({ ...REQUEST, protocolVersion: 2 }), /protocol version/iu);
	assert.throws(() => validateAssistanceJobRequest({ ...REQUEST, modelId: '' }), /must name a model/iu);
});
