/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The deterministic scheduler the Node suites wait on.
 *
 * A test that drives an asynchronous service has to let the runtime advance
 * before it can assert on what the service did, and the suites used to do that
 * by hand: a bounded loop that polled one queue - microtasks in some files,
 * `setImmediate` in others, `setTimeout` in the rest - and reported "timed out"
 * with no mention of what it was waiting for. A wait written against the wrong
 * queue passes only because some other work happens to push the condition over
 * the line, which is exactly the shape of a flaky test.
 *
 * `settle` and `waitFor` yield through every queue in one fixed order per turn,
 * so a wait is answered the same way whichever queue the work under test uses,
 * and a wait that runs out of turns names the condition it never saw.
 */

import assert from 'node:assert/strict';

/**
 * How many times a turn drains the microtask queue before it yields to the
 * macrotask queues. A promise chain settles one link per drain, so this is the
 * depth of chained continuations a single turn can carry.
 */
const MICROTASK_DRAINS = 8;

/** The turns a wait spends before it reports what it was waiting for. */
const DEFAULT_WAIT_TURNS = 100;

export interface SettleOptions {
	/**
	 * Milliseconds the timer phase of each turn waits. Zero keeps the drain as
	 * fast as the event loop allows; a wait on work outside this process - a
	 * file another process writes, a helper that answers over a pipe - states a
	 * small delay so its turns cost wall time rather than spinning.
	 */
	readonly delayMs?: number;
}

export interface WaitForOptions extends SettleOptions {
	/** How many turns the wait may take before it fails. */
	readonly turns?: number;
}

/**
 * One scheduler turn: microtasks, then the immediate queue, then the timer
 * queue. The order is fixed so a wait observes the same interleaving on every
 * run, and every queue is visited so no caller has to know which one the work
 * it is waiting on will land in.
 */
async function turn(delayMs: number): Promise<void> {
	for (let drain = 0; drain < MICROTASK_DRAINS; drain += 1) await Promise.resolve();
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	await new Promise<void>((resolve) => { setTimeout(resolve, delayMs); });
}

/** Yield through `turns` complete scheduler turns. */
export async function settle(turns = 1, { delayMs = 0 }: SettleOptions = {}): Promise<void> {
	if (!Number.isInteger(turns) || turns < 0) {
		throw new RangeError('A settle takes a whole number of turns.');
	}
	for (let index = 0; index < turns; index += 1) await turn(delayMs);
}

/**
 * Yield until `predicate` holds, and fail naming `description` if it never does.
 *
 * The predicate is evaluated before the first turn, so a condition that already
 * holds costs nothing, and once more after the last turn, so the bound is the
 * number of turns spent waiting rather than one turn short of it.
 */
export async function waitFor(
	predicate: () => boolean | Promise<boolean>,
	description: string,
	{ turns = DEFAULT_WAIT_TURNS, delayMs = 0 }: WaitForOptions = {},
): Promise<void> {
	if (!Number.isInteger(turns) || turns < 1) {
		throw new RangeError('A wait takes at least one turn.');
	}
	for (let index = 0; index < turns; index += 1) {
		if (await predicate()) return;
		await turn(delayMs);
	}
	if (await predicate()) return;
	assert.fail(`Timed out after ${turns} turns waiting for ${description}.`);
}

/** Wait until `expected` has been recorded in `events`. */
export async function waitForEvent(events: readonly string[], expected: string): Promise<void> {
	await waitFor(() => events.includes(expected), `event ${expected}`);
}

export function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
	return { promise, resolve, reject };
}

export async function remainsPending(operation: Promise<unknown>): Promise<boolean> {
	const marker = Symbol('pending');
	return await Promise.race([
		operation.then(() => false, () => false),
		new Promise<typeof marker>((resolve) => { setImmediate(() => { resolve(marker); }); }),
	]) === marker;
}
