/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { repairSequenceCurrentFixture, sequenceOutcome, type RepairSequenceCaptureView } from './helpers/lightscaper-repair-sequence-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

test('forgotten held brush child joins consumer failure and Close before physical body retirement', async () => {
	const f = await repairSequenceCurrentFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	const retained: { bytes?: Uint8Array<ArrayBuffer>; read?: RepairSequenceCaptureView['withMaskRasterBytes'] } = {};
	const work = f.capture(async view => {
		retained.read = view.withMaskRasterBytes;
		void view.withMaskRasterBytes(f.resources.brushes[0]!, async bytes => { retained.bytes = bytes; entered.resolve(); await release.promise; });
		throw reason.proxy;
	}, { signal: stop.signal }), outcome = sequenceOutcome(work), closing: { work?: Promise<void> } = {};
	try { assert.equal(await Promise.race([entered.promise.then(() => 'entered'), outcome.then(() => 'settled')]), 'entered');
		assert.equal(await remainsPending(work), true); assert.ok(retained.bytes?.some(byte => byte !== 0));
		stop.abort(reason.proxy); closing.work = f.session.close(); assert.equal(await remainsPending(closing.work), true); assert.equal(f.closed.resources, 0);
		release.resolve(); const result = await outcome; assert.equal(result.ok, false); if (result.ok) assert.fail('Opaque primary must reject.');
		assert.equal(result.error === reason.proxy, true); await closing.work;
		assert.ok(retained.bytes?.every(byte => byte === 0)); assert.equal(f.closed.resources, 1);
		assert.ok(retained.read); await assert.rejects(retained.read(f.resources.brushes[0]!, () => undefined), /closed/iu);
	} finally { release.resolve(); await outcome; await closing.work; await f.close(); }
});

test('a held LUT child refuses concurrent and reentrant brush metadata before reflection without poisoning the admitted child', async () => {
	const f = await repairSequenceCurrentFixture(), entered = deferred<void>(), release = deferred<void>(); let reflected = 0;
	const hostile = new Proxy({}, { ownKeys() { reflected++; throw Symbol('not admitted'); }, getOwnPropertyDescriptor() { reflected++; throw Symbol('not admitted'); } });
	try { await f.capture(async view => {
		const work = view.withLutBytes(f.resources.luts[0]!, async () => {
			await assert.rejects(Reflect.apply(view.withMaskRasterBytes, view, [hostile, () => assert.fail('Reentrant brush must not enter.')]) as Promise<unknown>);
			entered.resolve(); await release.promise;
		});
		await entered.promise;
		await assert.rejects(Reflect.apply(view.withMaskRasterBytes, view, [hostile, () => assert.fail('Concurrent brush must not enter.')]) as Promise<unknown>);
		assert.equal(reflected, 0); release.resolve(); await work;
		await view.withMaskRasterBytes(f.resources.brushes[0]!, bytes => assert.deepEqual(bytes, f.bodies.get(f.resources.brushes[0]!.storageKey)));
	}); } finally { release.resolve(); await f.close(); }
});

test('native cancellation during held Original joins the actual operation and preserves the exact opaque reason', async () => {
	const f = await repairSequenceCurrentFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	f.hooks.original = async () => { entered.resolve(); await release.promise; };
	const work = f.capture(() => assert.fail('Cancelled collection must not deliver.'), { signal: stop.signal }), outcome = sequenceOutcome(work);
	const closing: { work?: Promise<void> } = {};
	try { assert.equal(await Promise.race([entered.promise.then(() => 'entered'), outcome.then(() => 'settled')]), 'entered'); stop.abort(reason.proxy);
		closing.work = f.session.close(); assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing.work), true);
		assert.equal(f.closed.resources, 0); release.resolve(); const result = await outcome;
		assert.equal(result.ok, false); if (result.ok) assert.fail('Native cancellation must reject.'); assert.equal(result.error === reason.proxy, true);
		await closing.work; assert.equal(f.closed.resources, 1);
	} finally { release.resolve(); await outcome; await closing.work; await f.close(); }
});

test('independent opaque source and forgotten consumer failures remain ordered and distinct after child join', async () => {
	const f = await repairSequenceCurrentFixture(), entered = deferred<void>(), release = deferred<void>();
	const primary = Symbol('top consumer'), child = Symbol('brush child');
	const work = f.capture(async view => {
		void view.withMaskRasterBytes(f.resources.brushes[0]!, async () => { entered.resolve(); await release.promise; throw child; });
		throw primary;
	}), outcome = sequenceOutcome(work);
	try { assert.equal(await Promise.race([entered.promise.then(() => 'entered'), outcome.then(() => 'settled')]), 'entered'); assert.equal(await remainsPending(work), true);
		release.resolve(); const result = await outcome; assert.equal(result.ok, false); if (result.ok) assert.fail('Both failures must reject.');
		assert.ok(result.error instanceof AggregateError); assert.equal(result.error.cause, primary); assert.deepEqual(result.error.errors, [primary, child]);
	} finally { release.resolve(); await outcome; await f.close(); }
});

test('retained Current resource, Original and metadata capabilities reject late demand after the top consumer settles', async () => {
	const f = await repairSequenceCurrentFixture(), retained: { view?: Readonly<RepairSequenceCaptureView> } = {};
	try { await f.capture(view => { retained.view = view; }); assert.ok(retained.view);
		await assert.rejects(retained.view.withOriginal(f.selectedPhotos[0]!.id, () => undefined), /closed/iu);
		await assert.rejects(retained.view.withLutBytes(f.resources.luts[0]!, () => undefined), /closed/iu);
		await assert.rejects(retained.view.withMaskRasterBytes(f.resources.brushes[0]!, () => undefined), /closed/iu);
	} finally { await f.close(); }
});

test('construction pins selected query/resource/Original receivers and methods before the first held verifier yields', async () => {
	const f = await repairSequenceCurrentFixture(), entered = deferred<void>(), release = deferred<void>();
	f.hooks.verifyBrush = async () => { entered.resolve(); await release.promise; };
	const work = f.capture(view => assert.equal(view.photos.length, 4)), outcome = sequenceOutcome(work);
	try { assert.equal(await Promise.race([entered.promise.then(() => 'entered'), outcome.then(() => 'settled')]), 'entered');
		Object.defineProperty(f.ports, 'cubeLutResources', { value: async () => { throw Symbol('late LUT factory'); } });
		Object.defineProperty(f.ports, 'maskRasterResources', { value: async () => { throw Symbol('late brush factory'); } });
		Object.defineProperty(f.backup, 'loadOriginal', { value: async () => { throw Symbol('late Original loader'); } });
		release.resolve(); const result = await outcome; assert.equal(result.ok, true);
	} finally { release.resolve(); await outcome; await f.close(); }
});
