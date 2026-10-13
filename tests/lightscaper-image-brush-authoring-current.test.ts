/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageBrushMaskAuthoringV1, type ImageBrushMaskAuthoringOptionsV1 } from '../src/common/editor/controller/shared/image-brush-mask-authoring-v1.ts';
import type { ImageBrushMaskResourceAcknowledgementV1, ImageBrushMaskResourcePortV1 } from '../src/common/editor/image-brush-mask-resource-port-v1.ts';
import { withBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

interface Receipt extends ImageBrushMaskResourceAcknowledgementV1 { readonly projectId: string }
const CROSS = [0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0];
function fixture() {
	const bodies = new Map<string, Uint8Array<ArrayBuffer>>(), seen: Uint8Array<ArrayBuffer>[] = [];
	const hooks = { installed: async (): Promise<void> => undefined, delivered: async (): Promise<void> => undefined };
	let current = true, installs = 0;
	const source: ImageBrushMaskResourcePortV1<Receipt>['source'] = { async withBytes(reference, consume) {
		assert.equal(this, source); const saved = bodies.get(reference.storageKey); assert.ok(saved);
		const bytes = saved.slice(); seen.push(bytes);
		try { return await consume(bytes); } finally { bytes.fill(0); await hooks.delivered(); }
	} };
	const port: ImageBrushMaskResourcePortV1<Receipt> = { schemaVersion: 1, source, async install(referenceValue, bytesValue) {
		assert.equal(this, port); const reference = referenceValue as Readonly<BrushMaskResourceReferenceV1>, bytes = bytesValue as Uint8Array<ArrayBuffer>;
		await withBrushMaskResourceV1({ reference, bytes }, () => undefined); installs++;
		const created = !bodies.has(reference.storageKey); if (created) bodies.set(reference.storageKey, bytes.slice());
		seen.push(bytes); await hooks.installed(); return { schemaVersion: 1, projectId: 'real-frame-project', reference, created, notices: [] };
	} };
	const options: ImageBrushMaskAuthoringOptionsV1<Receipt> = { port, isCurrent() { assert.equal(this, options); return current; },
		prepareAcknowledgement(value, expected) { assert.equal(this, options);
			const receipt = value as Receipt; assert.equal(receipt.projectId, 'real-frame-project'); assert.deepEqual(receipt.reference, expected);
			return Object.freeze(receipt); } };
	return { owner: new ImageBrushMaskAuthoringV1(options), options, port, source, bodies, seen, hooks, installs: () => installs, stale() { current = false; } };
}
const stroke = (mode: 'paint' | 'erase' = 'paint', opacity = 1) => ({ mode, radius: .25, hardness: 1, opacity, points: [{ x: .375, y: .375 }] });

test('neutral brush owner authors real paint/erase/undo/redo and installs a genuine typed Frame ACK without Photo identity', async () => {
	const f = fixture();
	try { await f.owner.open({ width: 4, height: 4 }); f.owner.append(stroke('paint', .5));
		assert.deepEqual(await f.owner.withDisplay(alpha => [...alpha]), CROSS.map(value => value ? 128 : 0));
		f.owner.append(stroke('erase', .5)); assert.deepEqual(await f.owner.withDisplay(alpha => [...alpha]), CROSS.map(value => value ? 64 : 0));
		f.owner.undo(); f.owner.redo(); f.owner.undo(); f.owner.append(stroke()); assert.equal(f.owner.snapshot().history.strokes.length, 2);
		assert.deepEqual(await f.owner.withDisplay(alpha => [...alpha]), CROSS); assert.equal(f.installs(), 0);
		const receipt = await f.owner.install(); assert.equal(receipt.projectId, 'real-frame-project'); assert.equal(Object.hasOwn(receipt, 'catalogId'), false);
		assert.equal(receipt.created, true); assert.equal(f.owner.snapshot().receipt, receipt);
		assert.ok(f.seen.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.owner.cancelAndJoin(); }
});

test('neutral re-edit authenticates its installed predecessor and leaves immutable body bytes untouched', async () => {
	const f = fixture();
	try { await f.owner.open({ width: 4, height: 4 }); f.owner.append(stroke()); const first = await f.owner.install();
		const prior = f.bodies.get(first.reference.storageKey)!.slice(); await f.owner.cancelAndJoin();
		const next = new ImageBrushMaskAuthoringV1(f.options);
		try { await next.open({ width: 4, height: 4, reference: first.reference }); next.append(stroke('erase'));
			assert.deepEqual(await next.withDisplay(alpha => [...alpha]), new Array<number>(16).fill(0)); next.undo();
			assert.deepEqual(await next.withDisplay(alpha => [...alpha]), CROSS); const reused = await next.install(); assert.equal(reused.created, false);
			assert.deepEqual(f.bodies.get(first.reference.storageKey), prior);
		} finally { await next.cancelAndJoin(); }
	} finally { await f.owner.cancelAndJoin(); }
});

test('neutral brush owner pins source, installer, currentness and ACK validator before any borrowed operation yields', async () => {
	const f = fixture();
	for (const [owner, keys] of [[f.port, ['install']], [f.source, ['withBytes']], [f.options, ['isCurrent', 'prepareAcknowledgement']]] as const) {
		for (const key of keys) Object.defineProperty(owner, key, { get() { assert.fail('An admitted native capability must retain its original receiver and method.'); } });
	}
	try { await f.owner.open({ width: 4, height: 4 }); f.owner.append(stroke()); assert.deepEqual(await f.owner.withDisplay(alpha => [...alpha]), CROSS);
		assert.equal((await f.owner.install()).projectId, 'real-frame-project');
	} finally { await f.owner.cancelAndJoin(); }
});

test('neutral Close joins a held replay consumer and preserves exact opaque failure on the operation', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), revoked = Proxy.revocable({}, {}); revoked.revoke();
	let observed: Uint8Array<ArrayBuffer> | undefined;
	try { await f.owner.open({ width: 4, height: 4 }); f.owner.append(stroke());
		const work = f.owner.withDisplay(async alpha => { observed = alpha; entered.resolve(); await release.promise; throw revoked.proxy; });
		const outcome = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error })); await entered.promise;
		const closing = f.owner.cancelAndJoin(); assert.equal(await remainsPending(closing), true); assert.deepEqual([...(observed ?? [])], CROSS);
		release.resolve(); const result = await outcome; assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, revoked.proxy), true);
		await closing; assert.ok(observed?.every(byte => byte === 0));
	} finally { release.resolve(); await f.owner.cancelAndJoin(); }
});

test('a durable Frame brush ACK survives joined stale retirement without granting any recipe publication', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>();
	f.hooks.installed = async () => { entered.resolve(); await release.promise; };
	try { await f.owner.open({ width: 4, height: 4 }); f.owner.append(stroke()); const work = f.owner.install(); await entered.promise;
		assert.equal(f.installs(), 1); f.stale(); const closing = f.owner.cancelAndJoin(); assert.equal(await remainsPending(closing), true);
		release.resolve(); const receipt = await work; assert.equal(receipt.projectId, 'real-frame-project'); assert.equal(f.owner.snapshot().receipt, receipt);
		await closing; assert.ok(f.seen.every(bytes => bytes.every(byte => byte === 0)));
	} finally { release.resolve(); await f.owner.cancelAndJoin(); }
});

test('neutral replay certifies its actual physical backing and retains an opaque consumer failure beside independent detachment', async () => {
	const f = fixture(), revoked = Proxy.revocable({}, {}); revoked.revoke(); let transferred: ArrayBuffer | undefined;
	try { await f.owner.open({ width: 4, height: 4 }); f.owner.append(stroke());
		const result = await f.owner.withDisplay(alpha => {
			transferred = structuredClone(alpha.buffer, { transfer: [alpha.buffer] }); throw revoked.proxy;
		}).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		assert.equal(result.ok, false); if (!result.ok) {
			assert.ok(result.error instanceof AggregateError); const errors: unknown = Object.getOwnPropertyDescriptor(result.error, 'errors')?.value;
			assert.ok(Array.isArray(errors)); assert.equal(errors.length, 2); assert.equal(Object.is(errors[0], revoked.proxy), true); assert.ok(errors[1] instanceof TypeError);
		}
	} finally { if (transferred) new Uint8Array(transferred).fill(0); await f.owner.cancelAndJoin(); }
});
