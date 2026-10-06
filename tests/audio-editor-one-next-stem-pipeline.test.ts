/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runOneNextStemPipeline } from '../src/common/editor/controller/export/internal/archive/one-next-stem-pipeline.ts';

function deferred<Value>() { let resolve: (value: Value) => void = () => undefined; const promise = new Promise<Value>((accept) => { resolve = accept; }); return { promise, resolve }; }
const tick = () => new Promise<void>((resolve) => { setImmediate(resolve); });

test('one next render overlaps a blocked archive write with at most one active render and two owned outputs', async () => {
	const blocked = deferred<void>(); const events: string[] = []; const cleaned: number[] = []; let active = 0; let peak = 0;
	const running = runOneNextStemPipeline({ entries: [0, 1, 2], signal: new AbortController().signal, assertCurrent() {},
		async render(entry) { active++; peak = Math.max(peak, active); events.push(`render:${entry}`); await tick(); active--; return { value: entry, cleanup() { cleaned.push(entry); } }; },
		validate() {}, async consume(output, entry) { events.push(`write:${entry}`); if (entry === 0) await blocked.promise; assert.equal(output.value, entry); },
	});
	await tick(); await tick(); await tick();
	assert.deepEqual(events, ['render:0', 'render:1', 'write:0']); assert.equal(peak, 1); assert.deepEqual(cleaned, []);
	blocked.resolve(); await running;
	assert.deepEqual(events.filter((value) => value.startsWith('write:')), ['write:0', 'write:1', 'write:2']);
	assert.deepEqual(cleaned, [0, 1, 2]); assert.equal(peak, 1);
});

test('archive failure aborts and drains speculative render then cleans both spools exactly once', async () => {
	const blocked = deferred<void>(); const entered = deferred<void>(); const cleaned: number[] = []; const primary = new Error('archive failed'); let speculativeAborted = false;
	const running = runOneNextStemPipeline({ entries: [0, 1, 2], signal: new AbortController().signal, assertCurrent() {}, validate() {},
		async render(entry, _index, signal) { if (entry === 1) { entered.resolve(); await blocked.promise; speculativeAborted = signal.aborted; } return { cleanup() { cleaned.push(entry); } }; },
		async consume() { await entered.promise; throw primary; },
	});
	await entered.promise; await tick(); assert.equal(cleaned.includes(0), true);
	blocked.resolve(); await assert.rejects(running, (error: unknown) => error === primary);
	assert.equal(speculativeAborted, true); assert.deepEqual(cleaned.sort(), [0, 1]);
});

test('early speculative failure aborts a blocked write and preserves its primary error without unhandled rejection', async () => {
	const primary = new Error('next render failed'); const cleaned: number[] = []; let written = 0;
	await assert.rejects(runOneNextStemPipeline({ entries: [0, 1, 2], signal: new AbortController().signal, assertCurrent() {}, validate() {},
		async render(entry) { if (entry === 1) throw primary; return { cleanup() { cleaned.push(entry); } }; },
		consume: async (_output, _entry, _index, signal) => { written++; if (!signal.aborted) await new Promise<void>((resolve) => { signal.addEventListener('abort', () => resolve(), { once: true }); }); signal.throwIfAborted(); },
	}), (error: unknown) => error === primary);
	assert.equal(written, 1); assert.deepEqual(cleaned, [0]);
});

test('cancellation fences following entries, drains late output, and aggregates cleanup failures after primary', async () => {
	const abort = new AbortController(); const blocked = deferred<void>(); const entered = deferred<void>(); const primary = new Error('cancelled'); const cleanup = new Error('cleanup failed'); let renders = 0;
	const running = runOneNextStemPipeline({ entries: [0, 1, 2], signal: abort.signal, assertCurrent() {}, validate() {},
		async render(entry) { renders++; if (entry === 1) { entered.resolve(); await blocked.promise; } return { cleanup() { if (entry === 1) throw cleanup; } }; },
		async consume(_output, _entry, _index, signal) { await entered.promise; if (!signal.aborted) await new Promise<void>((resolve) => { signal.addEventListener('abort', () => resolve(), { once: true }); }); signal.throwIfAborted(); },
	});
	await entered.promise; abort.abort(primary); blocked.resolve();
	await assert.rejects(running, (error: unknown) => { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); return true; });
	assert.equal(renders, 2);
});

test('later speculative rollback failures remain alongside the primary archive error', async () => {
	const blocked = deferred<void>(); const entered = deferred<void>(); const primary = new Error('archive failed');
	const render = new Error('speculative render failed'); const rollback = new Error('speculative rollback failed');
	const secondary = new AggregateError([render, rollback], 'render and rollback failed'); const cleaned: number[] = [];
	const running = runOneNextStemPipeline({ entries: [0, 1], signal: new AbortController().signal, assertCurrent() {}, validate() {},
		async render(entry) { if (entry === 1) { entered.resolve(); await blocked.promise; throw secondary; } return { cleanup() { cleaned.push(entry); } }; },
		async consume() { await entered.promise; throw primary; },
	});
	await entered.promise; await tick(); blocked.resolve();
	await assert.rejects(running, (error: unknown) => { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, secondary]); return true; });
	assert.deepEqual(cleaned, [0]);
});

test('later archive cleanup tree remains alongside an earlier speculative render failure', async () => {
	const primary = new Error('following failed'); const rollback = new Error('archive rollback failed');
	const later = new AggregateError([primary, rollback], 'archive aborted and rollback failed'); const cleaned: number[] = [];
	await assert.rejects(runOneNextStemPipeline({ entries: [0, 1], signal: new AbortController().signal, assertCurrent() {}, validate() {},
		async render(entry) { if (entry === 1) throw primary; return { cleanup() { cleaned.push(entry); } }; },
		async consume(_output, _entry, _index, signal) { if (!signal.aborted) await new Promise<void>((resolve) => { signal.addEventListener('abort', () => resolve(), { once: true }); }); throw later; },
	}), (error: unknown) => { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, later]); return true; });
	assert.deepEqual(cleaned, [0]);
});
