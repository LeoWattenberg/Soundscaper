/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoPreviewSessionOwner } from '../src/common/editor/controller/clip-video/video-preview-session-owner.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

interface Session { readonly id: number; dispose(): void; close?(): Promise<void> }

test('replacement joins the held previous frame cleanup before admitting a new factory', async () => {
	const held = deferred<void>(), events: string[] = [];
	const owner = createVideoPreviewSessionOwner<Session>(value => { events.push(`publish:${String(value?.id)}`); });
	await owner.replace(async () => ({ id: 1, dispose() {}, close() { events.push('close:1'); return held.promise; } }));
	const next = owner.replace(async () => { events.push('create:2'); return { id: 2, dispose() {} }; });
	assert.equal(await remainsPending(next), true); assert.ok(events.includes('close:1')); assert.ok(!events.includes('create:2'));
	held.resolve(); await next; assert.ok(events.indexOf('close:1') < events.indexOf('create:2')); await owner.close();
});

test('a held retired factory and its late session close join before only the latest replacement starts', async () => {
	const held = deferred<Session>(), cleanup = deferred<void>(), entered = deferred<void>(), events: number[] = [];
	const owner = createVideoPreviewSessionOwner<Session>(value => { if (value) events.push(value.id); });
	const old = owner.replace(() => { entered.resolve(); return held.promise; }); await entered.promise;
	let middle = 0, latest = 0;
	const skipped = owner.replace(async () => { middle++; return { id: 2, dispose() {} }; });
	const next = owner.replace(async () => { latest++; return { id: 3, dispose() {} }; });
	held.resolve({ id: 1, dispose() {}, close() { return cleanup.promise; } });
	assert.equal(await remainsPending(next), true); assert.equal(latest, 0); cleanup.resolve();
	await old; await skipped; await next; assert.equal(middle, 0); assert.equal(latest, 1); assert.deepEqual(events, [3]); await owner.close();
});

test('opaque failed retirement blocks every replacement and remains observable through close without reflection', async () => {
	let traps = 0, factories = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const owner = createVideoPreviewSessionOwner<Session>(() => undefined);
	await owner.replace(async () => ({ id: 1, dispose() {}, close() { return Promise.reject(reason); } }));
	const replacement = owner.replace(async () => { factories++; return { id: 2, dispose() {} }; });
	const result = await replacement.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	assert.equal(result.error, reason); const closing = owner.close(); assert.equal(owner.close(), closing);
	assert.equal((await closing.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }))).error, reason);
	assert.equal(factories, 0); assert.equal(traps, 0);
});

test('synchronous retirement reentry sees the same close promise and cannot start a factory', async () => {
	let nested: Promise<void> | undefined, starts = 0;
	const owner = createVideoPreviewSessionOwner<Session>(() => undefined);
	await owner.replace(async () => ({ id: 1, dispose() {}, async close() { nested = owner.close();
		const rejected = owner.replace(async () => { starts++; return null; }); await rejected.catch(() => undefined); } }));
	const closing = owner.close(); await closing; assert.equal(nested, closing); assert.equal(starts, 0);
});

test('factory and retirement method identities retain their receivers without reading shadowed bind metadata', async () => {
	let bindReads = 0, checks = 0;
	const session = { id: 1, dispose() {}, close() { assert.equal(this, session); checks++; return Promise.resolve(); } };
	Object.defineProperty(session.close, 'bind', { get() { bindReads++; throw Error('bind'); } });
	const owner = createVideoPreviewSessionOwner<Session>(() => undefined);
	await owner.replace(async () => session); await owner.close(); assert.equal(checks, 1); assert.equal(bindReads, 0);
});

test('failed session retirement still joins the hard epoch barrier and preserves its distinct cleanup failure', async () => {
	const held = deferred<void>(), entered = deferred<void>(), first = Object.freeze({ first: true }), second = Object.freeze({ second: true });
	let hardRetirement = false;
	const owner = createVideoPreviewSessionOwner<Session>(() => undefined, async () => {
		if (hardRetirement) { entered.resolve(); await held.promise; throw second; }
	});
	await owner.replace(async () => ({ id: 1, dispose() {}, close() { return Promise.reject(first); } }));
	hardRetirement = true;
	const closing = owner.close(), outcome = closing.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	try {
		await Promise.race([entered.promise, new Promise<void>(resolve => { setImmediate(resolve); })]);
		assert.equal(await remainsPending(closing), true); held.resolve();
		const { error } = await outcome; assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [first, second]);
	} finally { held.resolve(); await outcome; }
});

for (const action of ['close', 'replace'] as const) test(`publication that synchronously requests ${action} cannot deliver the retired session`, async () => {
	const held = deferred<void>(); let closing: Promise<void> | undefined, replacement: Promise<Session | null> | undefined, starts = 0;
	const session = { id: 1, dispose() {}, close() { return held.promise; } };
	const owner = createVideoPreviewSessionOwner<Session>(value => {
		if (value !== session) return;
		if (action === 'close') closing = owner.close();
		else replacement = owner.replace(() => { starts++; return { id: 2, dispose() {} }; });
	});
	try {
		assert.equal(await owner.replace(() => session), null);
		assert.equal(await remainsPending(closing ?? replacement!), true); assert.equal(starts, 0);
		held.resolve();
		if (closing) await closing;
		if (replacement) assert.equal((await replacement)?.id, 2);
	} finally { held.resolve(); await closing; await replacement; await owner.close(); }
});
