/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { repairFrameHandoffFixture, observed, type RepairImageCaptureView } from './helpers/lightscaper-repair-frame-handoff-current-fixture.ts';

test('Current capture Close joins actual held Original and refuses consumer publication after retirement', async () => {
	const f = await repairFrameHandoffFixture(), entered = deferred<void>(), release = deferred<void>(); let consumers = 0;
	const joins: { work?: ReturnType<typeof observed>; close?: Promise<void> } = {};
	try { f.hooks.beforeOriginal = async () => { entered.resolve(); await release.promise; };
		joins.work = observed(f.capture(() => { consumers++; })); assert.equal(await Promise.race([entered.promise.then(() => true), joins.work.then(() => false)]), true);
		joins.close = f.session.close(); assert.equal(await remainsPending(joins.close), true); release.resolve();
		const outcome = await joins.work; assert.equal(outcome.ok, false); await joins.close; assert.equal(consumers, 0);
	} finally { release.resolve(); await joins.work; await joins.close?.catch(() => undefined); await f.close(); }
});

test('Current capture joins a forgotten held brush child and preserves an exact revoked consumer primary while physically wiping bytes', async () => {
	const f = await repairFrameHandoffFixture('active', true), entered = deferred<void>(), release = deferred<void>(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	const joins: { work?: ReturnType<typeof observed>; child?: ReturnType<typeof observed> } = {}; let borrowed: Uint8Array<ArrayBuffer> | undefined;
	try { joins.work = observed(f.capture(view => {
		joins.child = observed(view.withMaskRasterBytes(view.maskRasterReferences[0]!, async bytes => { borrowed = bytes; entered.resolve(); await release.promise; })); throw opaque.proxy;
	})); assert.equal(await Promise.race([entered.promise.then(() => true), joins.work.then(() => false)]), true);
		assert.equal(await remainsPending(joins.work), true); assert.ok(borrowed?.some(value => value !== 0)); release.resolve();
		const outcome = await joins.work; assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(outcome.error, opaque.proxy);
		await joins.child; assert.ok(borrowed?.every(value => value === 0));
	} finally { release.resolve(); await joins.work; await joins.child; await f.close(); }
});

test('Current scoped resource readers share one serial admission across LUT and brush before hostile callback reflection', async () => {
	const f = await repairFrameHandoffFixture('active', true), entered = deferred<void>(), release = deferred<void>(); let reflections = 0;
	const joins: { work?: ReturnType<typeof observed>; child?: Promise<unknown> } = {};
	const hostile = new Proxy(() => undefined, { apply() { reflections++; throw new Error('Concurrent callback must not run.'); }, getOwnPropertyDescriptor() { reflections++; throw new Error('Concurrent callback must not be reflected.'); } });
	try { joins.work = observed(f.capture(async view => {
		joins.child = view.withMaskRasterBytes(view.maskRasterReferences[0]!, async () => { entered.resolve(); await release.promise; });
		await entered.promise; await assert.rejects(view.withLutBytes(view.lutReferences[0]!, hostile), /pending|serial|busy|active/iu);
		assert.equal(reflections, 0); release.resolve(); await joins.child;
		await view.withLutBytes(view.lutReferences[0]!, bytes => { assert.ok(bytes.some(value => value !== 0)); });
	})); const result = await joins.work; assert.equal(result.ok, true);
	} finally { release.resolve(); await joins.work; await joins.child; await f.close(); }
});

test('Current resource reader retires before any retained caller metadata reflection after capture settles', async () => {
	const f = await repairFrameHandoffFixture('active', true); let retained: Readonly<RepairImageCaptureView> | undefined, reflected = 0;
	try { await f.capture(view => { retained = view; }); const hostile = new Proxy({}, { ownKeys() { reflected++; throw new Error('Closed reference reflection'); } });
		assert.ok(retained); await assert.rejects(Reflect.apply(retained.withMaskRasterBytes, retained, [hostile, () => undefined]) as Promise<unknown>, /closed|retired/iu); assert.equal(reflected, 0);
	} finally { await f.close(); }
});

test('Current archive cancellation joins held native decode and Session Close with exact first opaque reason', async () => {
	const f = await repairFrameHandoffFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	const joins: { work?: ReturnType<typeof observed>; close?: Promise<void> } = {};
	try { f.nativeHooks.nativeDecode = async () => { entered.resolve(); await release.promise; }; joins.work = observed(f.archive(stop.signal));
		assert.equal(await Promise.race([entered.promise.then(() => true), joins.work.then(() => false)]), true); stop.abort(opaque.proxy);
		joins.close = f.session.close(); assert.equal(await remainsPending(joins.close), true); release.resolve();
		const result = await joins.work; assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, opaque.proxy); await joins.close;
		assert.equal(f.events.filter(value => value === 'native-close').length, 1);
	} finally { release.resolve(); await joins.work; await joins.close?.catch(() => undefined); await f.close(); }
});
