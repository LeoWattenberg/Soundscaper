/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The gate that keeps a non-critical site task off the boot path.
 *
 * The sidebar's translation manifest is the task this exists for: it must not
 * compete with the editor chunk for the network, but it must also be there the
 * moment a visitor opens the language picker. So the scheduler waits for the
 * editor to bind, then for an idle moment, and a direct request skips both.
 * Every one of those gates is a decision nothing else observes, which is why
 * they are driven here against injected window and document stand-ins rather
 * than through the component that owns the task.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	APPLICATION_READY_EVENT,
	APPLICATION_READY_SELECTOR,
	createApplicationReadyScheduler,
} from '../src/common/site/application-ready-scheduler.js';

interface SchedulerHarness {
	readonly windowObject: Record<string, unknown>;
	readonly documentObject: { querySelector: (selector: string) => unknown };
	readonly runs: number[];
	readonly cancelledIdle: number[];
	readonly clearedTimeouts: number[];
	readonly selectors: string[];
	ready(): void;
	runIdle(): void;
	runTimeout(): void;
}

/**
 * A window whose idle and timer queues are held rather than run, so a test can
 * say exactly when the deferred task is allowed to happen.
 *
 * @param options.idle whether this browser offers `requestIdleCallback`
 * @param options.bound whether the editor has already bound when the scheduler is made
 */
function harness({ idle = true, bound = false } = {}): SchedulerHarness {
	const listeners = new Map<string, Set<() => void>>();
	const idleCallbacks = new Map<number, () => void>();
	const timeouts = new Map<number, () => void>();
	const runs: number[] = [];
	const cancelledIdle: number[] = [];
	const clearedTimeouts: number[] = [];
	const selectors: string[] = [];
	let handle = 0;
	const windowObject: Record<string, unknown> = {
		addEventListener: (type: string, listener: () => void) => {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)?.add(listener);
		},
		removeEventListener: (type: string, listener: () => void) => { listeners.get(type)?.delete(listener); },
		setTimeout: (callback: () => void) => { handle += 1; timeouts.set(handle, callback); return handle; },
		clearTimeout: (given: number) => { clearedTimeouts.push(given); timeouts.delete(given); },
	};
	if (idle) {
		windowObject.requestIdleCallback = (callback: () => void) => {
			handle += 1;
			idleCallbacks.set(handle, callback);
			return handle;
		};
		windowObject.cancelIdleCallback = (given: number) => {
			cancelledIdle.push(given);
			idleCallbacks.delete(given);
		};
	}
	return {
		windowObject,
		documentObject: {
			querySelector: (selector: string) => {
				selectors.push(selector);
				return bound ? { tagName: 'DIV' } : null;
			},
		},
		runs,
		cancelledIdle,
		clearedTimeouts,
		selectors,
		ready() { for (const listener of listeners.get(APPLICATION_READY_EVENT) ?? []) listener(); },
		runIdle() { for (const [, callback] of [...idleCallbacks]) callback(); },
		runTimeout() { for (const [, callback] of [...timeouts]) callback(); },
	};
}

function scheduler(context: SchedulerHarness) {
	return createApplicationReadyScheduler({
		windowObject: context.windowObject as never,
		documentObject: context.documentObject,
		task: () => { context.runs.push(context.runs.length + 1); },
	});
}

test('a scheduler without a task refuses to be made', () => {
	const context = harness();
	assert.throws(
		() => createApplicationReadyScheduler({
			windowObject: context.windowObject as never,
			documentObject: context.documentObject,
			task: undefined as never,
		}),
		{ name: 'TypeError', message: 'An application-ready task is required.' },
	);
	// Refused before it listened, so nothing is left registered to run later.
	assert.deepEqual(context.selectors, []);
});

test('the task waits for the editor to bind and then for an idle moment', () => {
	const context = harness();
	const gate = scheduler(context);
	// Asked before anything has bound: the surfaces that count as bound are the
	// bound editor, the privacy dialog, and the alert a failed boot leaves.
	assert.deepEqual(context.selectors, [APPLICATION_READY_SELECTOR]);
	assert.deepEqual(context.runs, []);

	context.ready();
	assert.deepEqual(context.runs, [], 'a bound editor runs the deferred task before the browser is idle');
	context.runIdle();
	assert.deepEqual(context.runs, [1]);
	gate.dispose();
});

test('a browser without an idle callback falls back to a timer', () => {
	const context = harness({ idle: false });
	const gate = scheduler(context);
	context.ready();
	assert.deepEqual(context.runs, []);
	context.runTimeout();
	assert.deepEqual(context.runs, [1]);
	gate.dispose();
});

test('an editor that had already bound schedules without waiting for the announcement', () => {
	const context = harness({ bound: true });
	const gate = scheduler(context);
	context.runIdle();
	assert.deepEqual(context.runs, [1]);
	gate.dispose();
});

test('repeated announcements neither queue a second idle callback nor run the task twice', () => {
	const context = harness();
	const gate = scheduler(context);
	context.ready();
	context.ready();
	context.runIdle();
	assert.deepEqual(context.runs, [1]);
	context.ready();
	context.runIdle();
	assert.deepEqual(context.runs, [1]);
	gate.dispose();
	// One idle callback was ever requested, so the run that overtook it and the
	// disposal after it both name the same single handle.
	assert.deepEqual(context.cancelledIdle, [1]);
});

test('a direct request runs the task at once and cancels the idle wait it beat', () => {
	const context = harness();
	const gate = scheduler(context);
	context.ready();
	gate.request();
	assert.deepEqual(context.runs, [1]);
	assert.deepEqual(context.cancelledIdle, [1], 'the idle callback the request overtook is still pending');
	// The idle callback would run the task a second time if it had been left.
	gate.request();
	assert.deepEqual(context.runs, [1]);
	gate.dispose();
});

test('a disposed scheduler forgets its listener and refuses to run afterwards', () => {
	const context = harness({ idle: false });
	const gate = scheduler(context);
	context.ready();
	gate.dispose();
	assert.deepEqual(context.clearedTimeouts, [1]);
	context.ready();
	context.runTimeout();
	gate.request();
	assert.deepEqual(context.runs, []);
	// Unmounting twice is ordinary in React's strict double-invoked effects, and
	// the second pass must not cancel a handle the first already released.
	gate.dispose();
	assert.deepEqual(context.clearedTimeouts, [1]);
});
