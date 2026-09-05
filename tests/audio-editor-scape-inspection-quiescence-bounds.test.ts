/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createScapeInspectionService } from '../src/common/editor/controller/scape-inspection-service.ts';
import * as quiescenceModule from '../src/common/editor/controller/scape-inspection-quiescence.ts';
import type {
	ScapeInspectionAdmission,
	ScapeInspectionQuiescence,
} from '../src/common/editor/controller/scape-inspection-quiescence.ts';

interface ScapeInspectionQuiescenceLimits {
	readonly maximumActiveInspections: number;
	readonly settlementTimeoutMs: number;
}

interface ScapeInspectionQuiescenceOptions {
	readonly limits?: Partial<ScapeInspectionQuiescenceLimits>;
	readonly setTimeout?: (callback: () => void, delayMs: number) => unknown;
	readonly clearTimeout?: (handle: unknown) => void;
}

interface ScapeInspectionCapacityErrorShape extends Error {
	readonly code: 'SCAPE_INSPECTION_CAPACITY';
	readonly limit: number;
	readonly activeInspections: number;
}

interface ScapeInspectionSettlementTimeoutErrorShape extends Error {
	readonly code: 'SCAPE_INSPECTION_SETTLEMENT_TIMEOUT';
	readonly timeoutMs: number;
	readonly pendingInspections: number;
}

type ErrorConstructor<ErrorType extends Error> = new (...args: never[]) => ErrorType;

interface BoundedQuiescenceModule {
	readonly SCAPE_INSPECTION_QUIESCENCE_HARD_LIMITS?: Readonly<ScapeInspectionQuiescenceLimits>;
	readonly ScapeInspectionCapacityError?: ErrorConstructor<ScapeInspectionCapacityErrorShape>;
	readonly ScapeInspectionSettlementTimeoutError?: ErrorConstructor<ScapeInspectionSettlementTimeoutErrorShape>;
	readonly resolveScapeInspectionQuiescenceLimits?: (
		overrides?: unknown,
	) => Readonly<ScapeInspectionQuiescenceLimits>;
}

const boundedModule = quiescenceModule as unknown as BoundedQuiescenceModule;
const createBoundedQuiescence = quiescenceModule.createScapeInspectionQuiescence as unknown as (
	options?: ScapeInspectionQuiescenceOptions,
) => ScapeInspectionQuiescence;

const EXPECTED_HARD_LIMITS = Object.freeze({
	maximumActiveInspections: 8,
	settlementTimeoutMs: 30_000,
});

test('Scape inspection quiescence exposes frozen lower-only production limits', () => {
	assert.deepEqual(boundedModule.SCAPE_INSPECTION_QUIESCENCE_HARD_LIMITS, EXPECTED_HARD_LIMITS);
	assert.equal(Object.isFrozen(boundedModule.SCAPE_INSPECTION_QUIESCENCE_HARD_LIMITS), true);
	assert.equal(typeof boundedModule.ScapeInspectionCapacityError, 'function');
	assert.equal(typeof boundedModule.ScapeInspectionSettlementTimeoutError, 'function');

	const resolveLimits = boundedModule.resolveScapeInspectionQuiescenceLimits;
	assert.equal(typeof resolveLimits, 'function');
	if (!resolveLimits) return;
	assert.deepEqual(resolveLimits(), EXPECTED_HARD_LIMITS);
	const lowered = resolveLimits({ maximumActiveInspections: 2, settlementTimeoutMs: 25 });
	assert.deepEqual(lowered, { maximumActiveInspections: 2, settlementTimeoutMs: 25 });
	assert.equal(Object.isFrozen(lowered), true);

	for (const limits of [
		null,
		[],
		{ maximumActiveInspections: 0 },
		{ maximumActiveInspections: 1.5 },
		{ maximumActiveInspections: EXPECTED_HARD_LIMITS.maximumActiveInspections + 1 },
		{ settlementTimeoutMs: 0 },
		{ settlementTimeoutMs: 1.5 },
		{ settlementTimeoutMs: EXPECTED_HARD_LIMITS.settlementTimeoutMs + 1 },
		{ unsupportedLimit: 1 },
	]) {
		assert.throws(
			() => resolveLimits(limits),
			(error: unknown) => error instanceof TypeError || error instanceof RangeError,
		);
	}
});

test('the default Scape inspection capacity is reserved synchronously', async () => {
	const quiescence = createBoundedQuiescence();
	const admissions: ScapeInspectionAdmission[] = [];
	try {
		for (let index = 0; index < EXPECTED_HARD_LIMITS.maximumActiveInspections; index += 1) {
			admissions.push(quiescence.admit());
		}
		expectCapacityError(quiescence, admissions, {
			limit: EXPECTED_HARD_LIMITS.maximumActiveInspections,
			activeInspections: EXPECTED_HARD_LIMITS.maximumActiveInspections,
		});
	} finally {
		for (const admission of admissions) admission.finish({ status: 'fulfilled' });
		await quiescence.drain();
	}
});

test('a lowered inspection capacity rejects before task creation or archive work', async () => {
	const quiescence = createBoundedQuiescence({ limits: { maximumActiveInspections: 1 } });
	const firstWork = deferred<string>();
	const firstStarted = deferred<void>();
	let startCalls = 0;
	let finishCalls = 0;
	let workCalls = 0;
	const service = createScapeInspectionService<string>({
		lifetime: {
			startTask(name) {
				startCalls += 1;
				const controller = new AbortController();
				return {
					name,
					generation: startCalls,
					scope: null,
					abort() {},
					signal: controller.signal,
					assertCurrent() {},
					finish() { finishCalls += 1; },
				};
			},
		},
		scapeInspectionQuiescence: quiescence,
		store: null,
		inspectScapeProject: () => {
			workCalls += 1;
			if (workCalls === 1) {
				firstStarted.resolve();
				return firstWork.promise;
			}
			return 'unexpected second inspection';
		},
	});
	const first = service.inspect(new Blob(['first']));
	await firstStarted.promise;

	try {
		const second = await observe(service.inspect(new Blob(['capacity excess'])));
		assert.equal(startCalls, 1, 'capacity must reject before the named task is created');
		assert.equal(workCalls, 1, 'capacity must reject before archive inspection starts');
		assert.equal(second.status, 'rejected');
		if (second.status === 'rejected') {
			assertCapacityError(second.reason, { limit: 1, activeInspections: 1 });
		}
	} finally {
		firstWork.resolve('first inspection');
		await first;
		await quiescence.drain();
	}
	assert.equal(finishCalls, 1);
});

test('fence and close reasons take precedence over capacity refusal', async () => {
	const quiescence = createBoundedQuiescence({ limits: { maximumActiveInspections: 1 } });
	const active = quiescence.admit();
	const fenceReason = new DOMException('A project switch is in progress.', 'AbortError');
	const fence = quiescence.beginFence(fenceReason);

	assert.throws(() => quiescence.admit(), (error: unknown) => error === fenceReason);
	fence.release();
	const closeReason = Object.assign(new Error('The editor controller was disposed.'), {
		code: 'DISPOSED',
	});
	quiescence.close(closeReason);
	assert.throws(() => quiescence.admit(), (error: unknown) => error === closeReason);

	active.finish({ status: 'rejected', reason: active.signal.reason });
	await quiescence.drain();
});

test('the default settlement deadline is scheduled once and cleared after early settlement', async () => {
	const timers = new ManualTimers();
	const quiescence = createBoundedQuiescence({
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});
	const provider = deferred<void>();
	const admission = retainFinished(quiescence, provider.promise);
	const fence = quiescence.beginFence(new DOMException('Project changed.', 'AbortError'));
	const waiting = fence.wait();

	try {
		await Promise.resolve();
		assert.deepEqual(timers.scheduledDelays, [EXPECTED_HARD_LIMITS.settlementTimeoutMs]);
		assert.equal(timers.pendingCount, 1);
		provider.resolve();
		await waiting;
		assert.equal(timers.pendingCount, 0, 'settlement must clear the unused deadline timer');
	} finally {
		provider.resolve();
		await Promise.allSettled([waiting]);
		fence.release();
		admission.finish({ status: 'fulfilled' });
		await quiescence.drain();
	}
});

test('each inspection reuses one lowered deadline across overlapping waits and close', async () => {
	const timers = new ManualTimers();
	const quiescence = createBoundedQuiescence({
		limits: { maximumActiveInspections: 2, settlementTimeoutMs: 7 },
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});
	const firstProvider = deferred<void>();
	const secondProvider = deferred<void>();
	retainFinished(quiescence, firstProvider.promise);
	retainFinished(quiescence, secondProvider.promise);
	const firstFence = quiescence.beginFence(new DOMException('Project changed.', 'AbortError'));
	const firstWaiting = firstFence.wait();
	const secondFence = quiescence.beginFence(new DOMException('Another fence.', 'AbortError'));
	const overlappingWaits = [firstWaiting, firstFence.wait(), secondFence.wait(), quiescence.drain()];
	quiescence.close(new DOMException('Controller closed.', 'AbortError'));
	overlappingWaits.push(quiescence.drain());

	try {
		await Promise.resolve();
		assert.deepEqual(
			timers.scheduledDelays,
			[7, 7],
			'each inspection receives one deadline shared by every overlapping waiter',
		);
		assert.equal(timers.pendingCount, 2);
		timers.fireNext();
		overlappingWaits.push(firstFence.wait(), secondFence.wait(), quiescence.drain());
		assert.deepEqual(
			timers.scheduledDelays,
			[7, 7],
			'an expired inspection deadline must not be restarted or extended by a later wait',
		);
		timers.fireNext();
		for (const settled of await Promise.all(overlappingWaits.map(observe))) {
			assert.equal(settled.status, 'rejected');
			if (settled.status === 'rejected') {
				assertSettlementTimeoutError(settled.reason, { timeoutMs: 7, pendingInspections: 2 });
			}
		}
	} finally {
		firstProvider.resolve();
		secondProvider.resolve();
		await Promise.allSettled(overlappingWaits);
		firstFence.release();
		secondFence.release();
		await quiescence.drain();
	}
});

test('cleanup failure and a per-inspection timeout remain observable together', async () => {
	const timers = new ManualTimers();
	const quiescence = createBoundedQuiescence({
		limits: { maximumActiveInspections: 2, settlementTimeoutMs: 9 },
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});
	const first = quiescence.admit();
	const provider = deferred<void>();
	const second = quiescence.admit();
	second.retain(provider.promise);
	const fence = quiescence.beginFence(new DOMException('Project changed.', 'AbortError'));
	const waiting = fence.wait();
	const cleanupFailure = new Error('The archive reader could not close.');

	first.finish({ status: 'rejected', reason: cleanupFailure });
	second.finish({ status: 'rejected', reason: second.signal.reason });
	try {
		await Promise.resolve();
		assert.deepEqual(timers.scheduledDelays, [9, 9]);
		assert.equal(timers.pendingCount, 1, 'the settled inspection must clear only its own timer');
		timers.fireNext();
		await assert.rejects(waiting, (error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.errors.length, 2);
			assert.equal(error.errors[0], cleanupFailure);
			assertSettlementTimeoutError(error.errors[1], { timeoutMs: 9, pendingInspections: 1 });
			return true;
		});
	} finally {
		provider.resolve();
		await Promise.allSettled([waiting]);
		fence.release();
		await quiescence.drain();
	}
});

test('an expired deadline remains visible when a queued fence waits after late settlement', async () => {
	const timers = new ManualTimers();
	const quiescence = createBoundedQuiescence({
		limits: { maximumActiveInspections: 1, settlementTimeoutMs: 13 },
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});
	const provider = deferred<void>();
	retainFinished(quiescence, provider.promise);
	const fence = quiescence.beginFence(new DOMException('Queued project changed.', 'AbortError'));

	try {
		assert.deepEqual(timers.scheduledDelays, [13]);
		timers.fireNext();
		provider.resolve();
		await provider.promise;
		await new Promise<void>((resolve) => { setImmediate(resolve); });

		await assert.rejects(fence.wait(), (error: unknown) => {
			assertSettlementTimeoutError(error, { timeoutMs: 13, pendingInspections: 1 });
			return true;
		});
	} finally {
		provider.resolve();
		fence.release();
		await quiescence.drain();
	}
});

test('timed-out inspections retain capacity until each late settlement releases its charge', async () => {
	const timers = new ManualTimers();
	const quiescence = createBoundedQuiescence({
		limits: { maximumActiveInspections: 2, settlementTimeoutMs: 5 },
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});
	const firstProvider = deferred<void>();
	const secondProvider = deferred<void>();
	retainFinished(quiescence, firstProvider.promise);
	retainFinished(quiescence, secondProvider.promise);
	const fence = quiescence.beginFence(new DOMException('Project changed.', 'AbortError'));
	const waiting = fence.wait();
	const waitingOutcome = observe(waiting);
	const cleanupAdmissions: ScapeInspectionAdmission[] = [];

	try {
		await Promise.resolve();
		assert.deepEqual(timers.scheduledDelays, [5, 5]);
		timers.fireAll();
		const timedOut = await waitingOutcome;
		assert.equal(timedOut.status, 'rejected');
		if (timedOut.status === 'rejected') {
			assertSettlementTimeoutError(timedOut.reason, { timeoutMs: 5, pendingInspections: 2 });
		}
		fence.release();

		expectCapacityError(quiescence, cleanupAdmissions, { limit: 2, activeInspections: 2 });
		firstProvider.resolve();
		await firstProvider.promise;
		await Promise.resolve();
		const replacement = quiescence.admit();
		cleanupAdmissions.push(replacement);
		expectCapacityError(quiescence, cleanupAdmissions, { limit: 2, activeInspections: 2 });
		replacement.finish({ status: 'fulfilled' });

		secondProvider.reject(new Error('Late provider failure.'));
		await Promise.allSettled([secondProvider.promise]);
		await Promise.resolve();
		const afterLateRelease = [quiescence.admit(), quiescence.admit()];
		cleanupAdmissions.push(...afterLateRelease);
		expectCapacityError(quiescence, cleanupAdmissions, { limit: 2, activeInspections: 2 });
		for (const admission of afterLateRelease) admission.finish({ status: 'fulfilled' });
		await quiescence.drain();
	} finally {
		fence.release();
		firstProvider.resolve();
		secondProvider.resolve();
		for (const admission of cleanupAdmissions) admission.finish({ status: 'fulfilled' });
		await Promise.allSettled([waiting, firstProvider.promise, secondProvider.promise]);
		await quiescence.drain();
	}
});

function retainFinished(
	quiescence: ScapeInspectionQuiescence,
	settlement: PromiseLike<unknown>,
): ScapeInspectionAdmission {
	const admission = quiescence.admit();
	admission.retain(settlement);
	admission.finish({ status: 'fulfilled' });
	return admission;
}

function expectCapacityError(
	quiescence: ScapeInspectionQuiescence,
	cleanupAdmissions: ScapeInspectionAdmission[],
	expected: Readonly<{ limit: number; activeInspections: number }>,
): void {
	assert.throws(
		() => { cleanupAdmissions.push(quiescence.admit()); },
		(error: unknown) => {
			assertCapacityError(error, expected);
			return true;
		},
	);
}

function assertCapacityError(
	error: unknown,
	expected: Readonly<{ limit: number; activeInspections: number }>,
): asserts error is ScapeInspectionCapacityErrorShape {
	const ErrorType = boundedModule.ScapeInspectionCapacityError;
	if (!ErrorType) assert.fail('Expected ScapeInspectionCapacityError to be exported.');
	assert.equal(error instanceof ErrorType, true);
	const typed = error as ScapeInspectionCapacityErrorShape;
	assert.deepEqual(
		{
			name: typed.name,
			code: typed.code,
			limit: typed.limit,
			activeInspections: typed.activeInspections,
		},
		{ name: 'ScapeInspectionCapacityError', code: 'SCAPE_INSPECTION_CAPACITY', ...expected },
	);
}

function assertSettlementTimeoutError(
	error: unknown,
	expected: Readonly<{ timeoutMs: number; pendingInspections: number }>,
): asserts error is ScapeInspectionSettlementTimeoutErrorShape {
	const ErrorType = boundedModule.ScapeInspectionSettlementTimeoutError;
	if (!ErrorType) assert.fail('Expected ScapeInspectionSettlementTimeoutError to be exported.');
	assert.equal(error instanceof ErrorType, true);
	const typed = error as ScapeInspectionSettlementTimeoutErrorShape;
	assert.deepEqual(
		{
			name: typed.name,
			code: typed.code,
			timeoutMs: typed.timeoutMs,
			pendingInspections: typed.pendingInspections,
		},
		{ name: 'TimeoutError', code: 'SCAPE_INSPECTION_SETTLEMENT_TIMEOUT', ...expected },
	);
}

type Observed<Value> = Readonly<
	| { status: 'fulfilled'; value: Value }
	| { status: 'rejected'; reason: unknown }
>;

function observe<Value>(promise: Promise<Value>): Promise<Observed<Value>> {
	return promise.then(
		(value) => ({ status: 'fulfilled' as const, value }),
		(reason: unknown) => ({ status: 'rejected' as const, reason }),
	);
}

class ManualTimers {
	readonly scheduledDelays: number[] = [];
	readonly #pending = new Map<object, () => void>();
	#nextId = 1;

	readonly setTimeout = (callback: () => void, delayMs: number): unknown => {
		const handle = Object.freeze({ id: this.#nextId });
		this.#nextId += 1;
		this.scheduledDelays.push(delayMs);
		this.#pending.set(handle, callback);
		return handle;
	};

	readonly clearTimeout = (handle: unknown): void => {
		if (handle && typeof handle === 'object') this.#pending.delete(handle);
	};

	get pendingCount(): number {
		return this.#pending.size;
	}

	fireNext(): void {
		const next = this.#pending.entries().next();
		if (next.done) throw new Error('Expected a pending Scape inspection settlement deadline.');
		const [handle, callback] = next.value;
		this.#pending.delete(handle);
		callback();
	}

	fireAll(): void {
		while (this.pendingCount > 0) this.fireNext();
	}
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	let reject: (reason?: unknown) => void = () => undefined;
	const promise = new Promise<Value>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { promise, reject, resolve };
}
