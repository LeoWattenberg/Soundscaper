/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	raceAbortablePromise,
	raceAbortableRead,
} from '../src/common/editor/abort-race.ts';

test('an already-aborted lazy read rejects without starting the provider', async () => {
	const controller = new AbortController();
	const reason = Symbol('cancelled read');
	controller.abort(reason);
	let reads = 0;

	await assert.rejects(
		raceAbortableRead(() => {
			reads += 1;
			return 'unreachable';
		}, controller.signal),
		(error) => error === reason,
	);
	assert.equal(reads, 0);
});

test('a lazy read turns a synchronous provider failure into a rejection', async () => {
	const failure = new Error('read failed');
	const operation = raceAbortableRead(() => { throw failure; });

	await assert.rejects(operation, (error) => error === failure);
});

test('read invocation timing is explicit while both modes retain promise failures', async () => {
	let deferredReads = 0;
	const deferred = raceAbortableRead(() => { deferredReads += 1; return 'deferred'; });
	assert.equal(deferredReads, 0);
	assert.equal(await deferred, 'deferred');

	let immediateReads = 0;
	const immediate = raceAbortableRead(
		() => { immediateReads += 1; return 'immediate'; },
		undefined,
		'immediate',
	);
	assert.equal(immediateReads, 1);
	assert.equal(await immediate, 'immediate');
});

test('an abort wins a pending lazy read exactly once with the selected reason', async () => {
	const controller = new AbortController();
	const fallback = new Error('provider-specific reason');
	let finishRead: ((value: string) => void) | undefined;
	const operation = raceAbortableRead(
		() => new Promise<string>((resolve) => { finishRead = resolve; }),
		controller.signal,
	);
	await Promise.resolve();

	controller.abort(fallback);
	finishRead?.('late success');

	await assert.rejects(operation, (error) => error === fallback);
});

test('the eager promise race preserves caller-specific abort-reason policy', async () => {
	const controller = new AbortController();
	let settle: ((value: string) => void) | undefined;
	const started = new Promise<string>((resolve) => { settle = resolve; });
	const boundary = new DOMException('export cancelled', 'AbortError');
	const operation = raceAbortablePromise(started, controller.signal, () => boundary);

	controller.abort(new Error('ignored transport reason'));
	settle?.('late result');

	await assert.rejects(operation, (error) => error === boundary);
});

test('settled operations remove their abort race and retain their own outcome', async () => {
	const controller = new AbortController();
	const operation = raceAbortablePromise(Promise.resolve('complete'), controller.signal, () => {
		throw new Error('abort reason must not be consulted after settlement');
	});

	assert.equal(await operation, 'complete');
	controller.abort();
});
