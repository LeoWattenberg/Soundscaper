/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createScapeInspectionQuiescence } from '../src/common/editor/controller/scape-inspection-quiescence.ts';

test('a fence drains every admitted inspection generation after replacement', async () => {
	const quiescence = createScapeInspectionQuiescence();
	const first = quiescence.admit();
	const replacementReason = new DOMException('The Scape inspection was superseded.', 'AbortError');
	first.cancel(replacementReason);
	const second = quiescence.admit();
	const switchReason = new DOMException('The active project changed.', 'AbortError');
	const fence = quiescence.beginFence(switchReason);
	const waiting = fence.wait();

	assert.equal(first.signal.aborted, true);
	assert.equal(first.signal.reason, replacementReason);
	assert.equal(second.signal.aborted, true);
	assert.equal(second.signal.reason, switchReason);

	second.finish({ status: 'rejected', reason: second.signal.reason });
	assert.equal(
		await settlesByNextTurn(waiting),
		false,
		'the current generation finishing must not forget its superseded predecessor',
	);
	first.finish({ status: 'rejected', reason: first.signal.reason });
	await waiting;
	fence.release();

	const next = quiescence.admit();
	next.finish({ status: 'fulfilled' });
	await quiescence.drain();
});

test('a drain is all-settled and treats only the exact registration abort reason as benign', async () => {
	const quiescence = createScapeInspectionQuiescence();
	const first = quiescence.admit();
	const second = quiescence.admit();
	const cancellation = new DOMException('The active project changed.', 'AbortError');
	const fence = quiescence.beginFence(cancellation);
	const waiting = fence.wait();
	const closeError = new Error('The Scape archive reader could not close.');
	const cleanupFailure = new AggregateError(
		[first.signal.reason, closeError],
		'The Scape inspection and archive-reader cleanup both failed.',
	);
	cleanupFailure.name = 'AbortError';

	first.finish({ status: 'rejected', reason: cleanupFailure });
	assert.equal(
		await settlesByNextTurn(waiting),
		false,
		'a cleanup failure must not make the drain overtake another active generation',
	);
	second.finish({ status: 'rejected', reason: second.signal.reason });

	await assert.rejects(waiting, (error: unknown) => error === cleanupFailure);
	fence.release();
});

test('overlapping fences retain admission and permanent close preserves its exact reason', async () => {
	const quiescence = createScapeInspectionQuiescence();
	const switchReason = new DOMException('A project switch is in progress.', 'AbortError');
	const firstFence = quiescence.beginFence(switchReason);
	const secondFence = quiescence.beginFence(switchReason);
	await Promise.all([firstFence.wait(), secondFence.wait()]);

	assertThrowsExact(() => quiescence.admit(), switchReason);
	firstFence.release();
	assertThrowsExact(
		() => quiescence.admit(),
		switchReason,
		'releasing one overlapping fence must not reopen inspection admission',
	);
	secondFence.release();

	const active = quiescence.admit();
	const closeReason = Object.assign(new Error('The editor controller was disposed.'), {
		code: 'DISPOSED',
	});
	quiescence.close(closeReason);
	const draining = quiescence.drain();
	assert.equal(active.signal.aborted, true);
	assert.equal(active.signal.reason, closeReason);
	assertThrowsExact(() => quiescence.admit(), closeReason);
	assert.equal(
		await settlesByNextTurn(draining),
		false,
		'terminal drain must wait for cleanup admitted before close',
	);

	quiescence.close(new Error('A later close reason must not replace the terminal reason.'));
	assertThrowsExact(() => quiescence.admit(), closeReason);
	active.finish({ status: 'rejected', reason: active.signal.reason });
	await draining;
});

test('terminal drain waits all captured generations before surfacing cleanup failure', async () => {
	const quiescence = createScapeInspectionQuiescence();
	const first = quiescence.admit();
	const second = quiescence.admit();
	const closeReason = new DOMException('Controller disposed.', 'AbortError');
	quiescence.close(closeReason);
	const cleanupFailure = new AggregateError(
		[first.signal.reason, new Error('Reader close failed.')],
		'The inspection and cleanup both failed.',
	);
	cleanupFailure.name = 'AbortError';
	const draining = quiescence.drain();

	first.finish({ status: 'rejected', reason: cleanupFailure });
	assert.equal(
		await settlesByNextTurn(draining),
		false,
		'a failed generation must not let terminal drain overtake another generation',
	);
	second.finish({ status: 'rejected', reason: second.signal.reason });
	await assert.rejects(draining, (error: unknown) => error === cleanupFailure);
});

function assertThrowsExact(operation: () => unknown, reason: unknown, message?: string): void {
	assert.throws(operation, (error: unknown) => error === reason, message);
}

async function settlesByNextTurn(promise: Promise<unknown>): Promise<boolean> {
	return Promise.race([
		promise.then(() => true, () => true),
		new Promise<false>((resolve) => { setImmediate(() => resolve(false)); }),
	]);
}
