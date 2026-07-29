/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

import type { ScapeInspectionQuiescenceOptions } from '../src/common/editor/controller/scape-inspection-quiescence.ts';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return {
				url: 'data:text/javascript,export default "mock-ffmpeg-asset"',
				shortCircuit: true,
			};
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/common/editor/app.js');
const { createProjectStore } = await import('../src/common/editor/storage.js');
const {
	ScapeInspectionSettlementTimeoutError,
} = await import('../src/common/editor/controller/scape-inspection-quiescence.ts');

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

test('public Scape inspection is lifetime-owned and closes its reader on disposal', async () => {
	const started = deferred<void>();
	let closeCalls = 0;
	let inspectionSignal: AbortSignal | undefined;
	const controller = createAudioEditorController(null, {
		headless: true,
		locale: 'en',
		engine: createTestEngine(),
		ffmpeg: { dispose() {} },
	});

	try {
		await controller.ready;
		const inspect = controller.actions.project.inspectScape;
		const open = controller.actions.project.openScapeFile;
		if (typeof inspect !== 'function') throw new TypeError('Scape inspection must be callable.');
		if (typeof open !== 'function') throw new TypeError('Scape file open must be callable.');
		const pending = inspect(new Blob(['synthetic archive']), {
			archiveReaderFactory: (_input: Blob, signal?: AbortSignal) => {
				assert.ok(signal);
				inspectionSignal = signal;
				return {
					async *getEntriesGenerator() {
						started.resolve();
						await new Promise<void>((_resolve, reject) => {
							if (signal.aborted) reject(signal.reason);
							else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
						});
						return false;
					},
					async close() { closeCalls += 1; },
				};
			},
		});
		await started.promise;

		const disposing = controller.dispose();
		await assert.rejects(pending, (error) => (
			error === inspectionSignal?.reason
			&& (error as Readonly<{ code?: string }>).code === 'DISPOSED'
		));
		await disposing;
		assert.equal(closeCalls, 1);
	} finally {
		await controller.dispose().catch(() => undefined);
	}
});

test('controller disposal joins every Scape inspection generation through gated reader cleanup', async () => {
	const events: string[] = [];
	const started = [deferred<void>(), deferred<void>()];
	const closeStarted = [deferred<void>(), deferred<void>()];
	const closeGates = [deferred<void>(), deferred<void>()];
	const signals: Array<AbortSignal | undefined> = [];
	let deviceListeners = 0;
	const store = createObservedStore(events, 'scape-inspection-generation-drain');
	const controller = createAudioEditorController(null, {
		headless: true,
		locale: 'en',
		store,
		engine: createTestEngine(() => { events.push('engine-dispose'); }),
		ffmpeg: { dispose() {} },
		mediaDevices: {
			addEventListener() { deviceListeners += 1; },
			removeEventListener() { deviceListeners -= 1; },
		},
	});
	const inspections: Promise<unknown>[] = [];

	try {
		await controller.ready;
		assert.equal(deviceListeners, 1);
		const inspect = controller.actions.project.inspectScape;
		if (typeof inspect !== 'function') throw new TypeError('Scape inspection must be callable.');
		const inspectGeneration = (index: number): Promise<unknown> => inspect(
			new Blob([`synthetic archive ${String(index)}`]),
			{
				archiveReaderFactory: (_input: Blob, signal?: AbortSignal) => {
					assert.ok(signal);
					signals[index] = signal;
					return {
						async *getEntriesGenerator() {
							started[index]?.resolve();
							await new Promise<void>((_resolve, reject) => {
								if (signal.aborted) reject(signal.reason);
								else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
							});
							return false;
						},
						async close() {
							events.push(`reader-${String(index)}-close-start`);
							closeStarted[index]?.resolve();
							await closeGates[index]?.promise;
							events.push(`reader-${String(index)}-close-end`);
						},
					};
				},
			},
		);

		const first = inspectGeneration(0);
		inspections.push(first);
		const firstRejected = assert.rejects(first, (error) => error === signals[0]?.reason);
		await started[0]?.promise;

		const second = inspectGeneration(1);
		inspections.push(second);
		const secondRejected = assert.rejects(second, (error) => (
			error === signals[1]?.reason
			&& (error as Readonly<{ code?: string }>).code === 'DISPOSED'
		));
		await Promise.all([started[1]?.promise, closeStarted[0]?.promise]);

		const disposing = controller.dispose();
		await closeStarted[1]?.promise;
		assert.equal(deviceListeners, 0, 'synchronous disposal cancellation must not wait for reader cleanup');
		const settledWithBothReadersGated = await settlesByNextTurn(disposing);
		const teardownWithBothReadersGated = events.filter(isTeardownEvent);

		closeGates[0]?.resolve();
		await closeEnded(events, 0);
		const settledWithOneReaderGated = await settlesByNextTurn(disposing);
		const teardownWithOneReaderGated = events.filter(isTeardownEvent);

		closeGates[1]?.resolve();
		await Promise.all([firstRejected, secondRejected, disposing]);

		assert.equal(settledWithBothReadersGated, false, 'disposal must await both inspection generations');
		assert.deepEqual(teardownWithBothReadersGated, [], 'teardown must not overtake reader cleanup');
		assert.equal(settledWithOneReaderGated, false, 'disposal must await the remaining reader generation');
		assert.deepEqual(teardownWithOneReaderGated, [], 'teardown must remain behind the final reader close');
		assert.ok(events.indexOf('reader-0-close-end') < events.indexOf('engine-dispose'));
		assert.ok(events.indexOf('reader-1-close-end') < events.indexOf('engine-dispose'));
		assert.ok(events.indexOf('reader-0-close-end') < events.indexOf('store-close'));
		assert.ok(events.indexOf('reader-1-close-end') < events.indexOf('store-close'));
	} finally {
		for (const gate of closeGates) gate.resolve();
		await Promise.allSettled(inspections);
		await controller.dispose().catch(() => undefined);
	}
});

test('reader close failure rejects inspection and disposal after remaining teardown completes', async () => {
	const events: string[] = [];
	const started = deferred<void>();
	const closeStarted = deferred<void>();
	const closeGate = deferred<void>();
	const closeFailure = new Error('Injected Scape reader close failure.');
	const store = createObservedStore(events, 'scape-inspection-close-failure');
	let inspectionSignal: AbortSignal | undefined;
	const controller = createAudioEditorController(null, {
		headless: true,
		locale: 'en',
		store,
		engine: createTestEngine(() => { events.push('engine-dispose'); }),
		ffmpeg: { dispose() {} },
	});
	let pending: Promise<unknown> | null = null;

	try {
		await controller.ready;
		const inspect = controller.actions.project.inspectScape;
		if (typeof inspect !== 'function') throw new TypeError('Scape inspection must be callable.');
		pending = inspect(new Blob(['synthetic archive']), {
			archiveReaderFactory: (_input: Blob, signal?: AbortSignal) => {
				assert.ok(signal);
				inspectionSignal = signal;
				return {
					async *getEntriesGenerator() {
						started.resolve();
						await new Promise<void>((_resolve, reject) => {
							if (signal.aborted) reject(signal.reason);
							else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
						});
						return false;
					},
					async close() {
						events.push('reader-close-start');
						closeStarted.resolve();
						await closeGate.promise;
						events.push('reader-close-failed');
						throw closeFailure;
					},
				};
			},
		});
		await started.promise;

		const disposing = controller.dispose();
		await closeStarted.promise;
		const settledBeforeCloseFailure = await settlesByNextTurn(disposing);
		const teardownBeforeCloseFailure = events.filter(isTeardownEvent);
		closeGate.resolve();
		const [inspectionResult, disposalResult] = await Promise.allSettled([pending, disposing]);

		assert.equal(settledBeforeCloseFailure, false, 'disposal must join the failing reader close');
		assert.deepEqual(teardownBeforeCloseFailure, [], 'remaining teardown must wait for reader cleanup');
		assert.equal(inspectionResult.status, 'rejected');
		assert.ok(inspectionResult.status === 'rejected'
			&& inspectionResult.reason instanceof AggregateError
			&& inspectionResult.reason.errors.includes(inspectionSignal?.reason)
			&& inspectionResult.reason.errors.includes(closeFailure));
		assert.equal(disposalResult.status, 'rejected', 'reader cleanup failure must reject disposal');
		assert.ok(disposalResult.status === 'rejected' && nestedErrorContains(disposalResult.reason, closeFailure));
		assert.ok(events.includes('engine-dispose'), 'engine teardown must continue after reader failure');
		assert.ok(events.includes('store-close'), 'storage teardown must continue after reader failure');
		assert.equal(controller.getSnapshot().phase, 'disposed');
	} finally {
		closeGate.resolve();
		if (pending) await Promise.allSettled([pending]);
		await controller.dispose().catch(() => undefined);
	}
});

test('controller disposal completes teardown after a non-settling inspection deadline', async () => {
	const events: string[] = [];
	const started = deferred<void>();
	const neverSettles = deferred<void>();
	const timerHandle = Object.freeze({ id: 'scape-inspection-deadline' });
	const timer: { deadline: (() => void) | null } = { deadline: null };
	let closeCalls = 0;
	let inspectionSignal: AbortSignal | undefined;
	const quiescenceOptions: ScapeInspectionQuiescenceOptions = {
		limits: { maximumActiveInspections: 1, settlementTimeoutMs: 5 },
		setTimeout(callback, delayMs) {
			assert.equal(delayMs, 5);
			assert.equal(timer.deadline, null, 'one admission must own only one deadline');
			timer.deadline = callback;
			return timerHandle;
		},
		clearTimeout(handle) {
			assert.equal(handle, timerHandle);
			timer.deadline = null;
		},
	};
	const store = createObservedStore(events, 'scape-inspection-disposal-deadline');
	const controller = createAudioEditorController(null, {
		headless: true,
		locale: 'en',
		store,
		engine: createTestEngine(() => { events.push('engine-dispose'); }),
		ffmpeg: { dispose() {} },
		scapeInspectionQuiescenceOptions: quiescenceOptions,
	});

	try {
		await controller.ready;
		const inspect = controller.actions.project.inspectScape;
		if (typeof inspect !== 'function') throw new TypeError('Scape inspection must be callable.');
		const pending = inspect(new Blob(['synthetic archive']), {
			archiveReaderFactory: (_input: Blob, signal?: AbortSignal) => {
				assert.ok(signal);
				inspectionSignal = signal;
				return {
					async *getEntriesGenerator() {
						started.resolve();
						await neverSettles.promise;
						return false;
					},
					async close() { closeCalls += 1; },
				};
			},
		});
		void pending.catch(() => undefined);
		await started.promise;

		const disposing = controller.dispose();
		assert.equal(inspectionSignal?.aborted, true);
		assert.equal(await settlesByNextTurn(disposing), false);
		assert.ok(timer.deadline, 'disposal must arm the inspection settlement deadline');
		timer.deadline();
		timer.deadline = null;

		await assert.rejects(disposing, (error: unknown) => (
			error instanceof ScapeInspectionSettlementTimeoutError
			&& error.timeoutMs === 5
			&& error.pendingInspections === 1
		));
		assert.ok(events.includes('engine-dispose'), 'engine teardown must continue after the timeout');
		assert.ok(events.includes('store-close'), 'storage teardown must continue after the timeout');
		assert.equal(controller.getSnapshot().phase, 'disposed');
		assert.equal(closeCalls, 0, 'a signal-ignoring reader must not be reported as closed');
	} finally {
		timer.deadline?.();
		await controller.dispose().catch(() => undefined);
	}
});

function createTestEngine(onDispose: () => void = () => undefined) {
	return {
		setSourceResolver() { return this; },
		loadProject() {},
		async applyProject() {},
		getState() { return { state: 'stopped', loop: { enabled: false } }; },
		getPositionFrames() { return 0; },
		stop() {},
		async dispose() { onDispose(); },
	};
}

function createObservedStore(events: string[], name: string) {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `${name}-${String(Date.now())}-${String(Math.random())}`,
	});
	const close = store.close.bind(store);
	store.close = () => {
		events.push('store-close');
		return close();
	};
	return store;
}

function isTeardownEvent(event: string): boolean {
	return event === 'engine-dispose' || event === 'store-close';
}

async function settlesByNextTurn(value: PromiseLike<unknown>): Promise<boolean> {
	let settled = false;
	void Promise.resolve(value).then(
		() => { settled = true; },
		() => { settled = true; },
	);
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	return settled;
}

async function closeEnded(events: readonly string[], index: number): Promise<void> {
	const expected = `reader-${String(index)}-close-end`;
	for (let turn = 0; turn < 20 && !events.includes(expected); turn += 1) {
		await new Promise<void>((resolve) => { setImmediate(resolve); });
	}
	assert.ok(events.includes(expected), `reader ${String(index)} did not finish closing`);
}

function nestedErrorContains(error: unknown, expected: unknown): boolean {
	if (error === expected) return true;
	return error instanceof AggregateError && error.errors.some((entry) => nestedErrorContains(entry, expected));
}
