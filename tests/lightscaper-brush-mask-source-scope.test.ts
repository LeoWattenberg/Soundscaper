/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { assertMaskRasterSourceScopeV1, captureMaskRasterSourceV1, maskRasterSourceScopeWorkingBytesV1, scopedBrushMaskResourceV1,
	withMaskRasterSourceScopeV1, withMaskRasterSourceScopeWorkV1,
	type MaskRasterSourceScopeV1 } from '../src/common/editor/imaging/mask-raster-source-scope-v1.ts';
import { normalizeBrushMaskResourceReferenceV1, type BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { PhotoMaskRasterRepositoryV1 } from '../src/lightscaper/storage/photo-mask-raster-repository-v1.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

function resource(last = 255) {
	// Independent SCMASK01 framing and Node SHA; no renderer or encoder oracle.
	const bytes = new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 2, 0, 0, 0, 0, 64, 128, last]);
	const hash = createHash('sha256').update(bytes).digest('hex');
	return { bytes, reference: normalizeBrushMaskResourceReferenceV1(`brush-mask-v1:2:2:${hash}`) };
}
function opaque() { const pair = Proxy.revocable({}, {}); pair.revoke(); return pair.proxy; }
function outcome(work: Promise<unknown>) {
	return work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
}
async function exactFailure(work: Promise<unknown>, reason: unknown) {
	const result = await outcome(work); assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
}
function bodies(inputs = [resource()]): MaskRasterSourcePortV1 {
	return { async withBytes(reference, consume) {
		const input = inputs.find(input => input.reference.storageKey === reference.storageKey);
		assert.ok(input); return await consume(new Uint8Array(input.bytes));
	} };
}
const selected = (reference: Readonly<BrushMaskResourceReferenceV1>) => new Set([reference.storageKey]);

test('brush source capture pins genuine own method and receiver without function metadata reads', async () => {
	const input = resource(); let reflected = 0, calls = 0;
	const source: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, source); assert.deepEqual(reference, input.reference); calls++; return await consume(input.bytes);
	} };
	source.withBytes = new Proxy(source.withBytes, { get() { reflected++; assert.fail('Function metadata read'); } });
	const captured = captureMaskRasterSourceV1(source);
	source.withBytes = () => assert.fail('Replacement method used');
	assert.equal(await captured.withBytes(input.reference, bytes => bytes[16]), 0);
	assert.equal(calls, 1); assert.equal(reflected, 0); assert.equal(Object.isFrozen(captured), true);
});

test('source admission rejects inherited/accessor methods and preserves exact opaque reflection failures', () => {
	let getters = 0;
	const accessor = Object.defineProperty({}, 'withBytes', { get() { getters++; assert.fail('Getter used'); } });
	const inherited: unknown = Object.create({ withBytes() {} });
	for (const value of [undefined, null, {}, inherited, accessor, { withBytes: 3 }]) assert.throws(() => captureMaskRasterSourceV1(value));
	const reason = opaque();
	try { captureMaskRasterSourceV1(new Proxy({}, { getOwnPropertyDescriptor() { throw reason; } })); assert.fail('Expected refusal'); }
	catch (error) { assert.equal(Object.is(error, reason), true); }
	assert.equal(getters, 0);
});

test('serial complete authentication joins each source cleanup before next and retains selected alpha only', async () => {
	const first = resource(), second = resource(254), entered = deferred<void>(), release = deferred<void>();
	const events: string[] = []; let saved: Readonly<MaskRasterSourceScopeV1> | undefined, alpha: Uint8Array | undefined;
	const source: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		const input = reference.storageKey === first.reference.storageKey ? first : second;
		events.push(`read:${input.bytes[19]}`); const result = await consume(new Uint8Array(input.bytes));
		if (input === first) { entered.resolve(); await release.promise; }
		events.push(`retired:${input.bytes[19]}`); return result;
	} };
	const work = withMaskRasterSourceScopeV1([first.reference, second.reference, first.reference], selected(first.reference), source, scope => {
		saved = scope; assert.equal(Object.isFrozen(scope), true);
		const view = scopedBrushMaskResourceV1(scope, first.reference.storageKey); alpha = view.alpha;
		assert.equal(Object.isFrozen(view), true); assert.deepEqual(view.reference, first.reference); assert.deepEqual([...view.alpha], [0, 64, 128, 255]);
		assert.throws(() => scopedBrushMaskResourceV1(scope, second.reference.storageKey));
		assert.deepEqual(events, ['read:255', 'retired:255', 'read:254', 'retired:254']); return 'retained';
	});
	try { await Promise.race([entered.promise, work]); assert.equal(await remainsPending(work), true); assert.deepEqual(events, ['read:255']); }
	finally { release.resolve(); }
	assert.equal(await work, 'retained'); assert.ok(alpha?.every(value => value === 0));
	assert.throws(() => scopedBrushMaskResourceV1(saved, first.reference.storageKey));
});

test('scope admission captures detached references, retained set and source before held first read', async () => {
	const input = resource(), reference = { ...input.reference }, references = [reference], keys = selected(reference);
	const entered = deferred<void>(), release = deferred<void>(); let reads = 0;
	const source: MaskRasterSourcePortV1 = { async withBytes(actual, consume) {
		assert.equal(this, source); assert.deepEqual(actual, input.reference); reads++; entered.resolve(); await release.promise; return await consume(input.bytes);
	} };
	const work = withMaskRasterSourceScopeV1(references, keys, source, scope => [...scopedBrushMaskResourceV1(scope, input.reference.storageKey).alpha]);
	reference.width = 1; references.length = 0; keys.clear(); source.withBytes = () => assert.fail('Late replacement used');
	try { await Promise.race([entered.promise, work]); } finally { release.resolve(); }
	assert.deepEqual(await work, [0, 64, 128, 255]); assert.equal(reads, 1);
});

test('complete unused-body corruption refuses before consumer and wipes earlier retained alpha', async () => {
	const first = resource(), second = resource(254); let consumers = 0, reads = 0;
	const source: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		reads++; const bytes = new Uint8Array(reference.storageKey === first.reference.storageKey ? first.bytes : second.bytes);
		if (reads === 2) bytes[19] = 7; return await consume(bytes);
	} };
	await assert.rejects(withMaskRasterSourceScopeV1([first.reference, second.reference], selected(first.reference), source, () => { consumers++; }), /SHA256/u);
	assert.equal(reads, 2); assert.equal(consumers, 0);
});

test('closed canonical reference and retained-key admission precede source access', async () => {
	const input = resource(); let getters = 0, reads = 0;
	const source: MaskRasterSourcePortV1 = { async withBytes() { reads++; assert.fail('Invalid scope acquired source'); } };
	const accessor = Object.defineProperty({ ...input.reference }, 'width', { enumerable: true, get() { getters++; return 2; } });
	const sparse = new Array<Readonly<BrushMaskResourceReferenceV1>>(1);
	for (const references of [[{ ...input.reference, width: 1 }], [{ ...input.reference, future: true }], [accessor], sparse,
		[{ ...input.reference, storageKey: input.reference.storageKey.replace('v1', 'v2') }]]) {
		await assert.rejects(withMaskRasterSourceScopeV1(references, selected(input.reference), source, () => undefined));
	}
	await assert.rejects(withMaskRasterSourceScopeV1([input.reference], new Set(['missing']), source, () => undefined));
	await assert.rejects(withMaskRasterSourceScopeV1([input.reference], {} as ReadonlySet<string>, source, () => undefined));
	assert.equal(getters, 0); assert.equal(reads, 0);
});

test('direct scope refuses complete unique reference and logical byte overflow before acquiring bodies', async () => {
	let reads = 0;
	const source: MaskRasterSourcePortV1 = { async withBytes() { reads++; assert.fail('Overflow acquired source'); } };
	const references = Array.from({ length: 4095 }, (_, index) => normalizeBrushMaskResourceReferenceV1(`brush-mask-v1:1:1:${index.toString(16).padStart(64, '0')}`));
	await assert.rejects(withMaskRasterSourceScopeV1(references, new Set(), source, () => undefined), RangeError);
	const large = Array.from({ length: 16 }, (_, index) => normalizeBrushMaskResourceReferenceV1(`brush-mask-v1:1024:1024:${index.toString(16).padStart(64, '0')}`));
	await assert.rejects(withMaskRasterSourceScopeV1(large, new Set(), source, () => undefined), RangeError);
	assert.equal(reads, 0);
});

test('scope identity is private, rejects clones/forged/revoked proxies without their reflection and expires', async () => {
	const input = resource(); let retained: Readonly<MaskRasterSourceScopeV1> | undefined, traps = 0;
	await withMaskRasterSourceScopeV1([input.reference], selected(input.reference), bodies(), scope => {
		retained = scope;
		const hostile = new Proxy({}, { ownKeys() { traps++; assert.fail('Forged scope reflected'); }, getPrototypeOf() { traps++; assert.fail('Forged scope inspected'); } });
		for (const value of [structuredClone(scope), { ...scope }, hostile, opaque(), null, undefined]) {
			assert.throws(() => scopedBrushMaskResourceV1(value, input.reference.storageKey), TypeError);
		}
		assert.deepEqual([...scopedBrushMaskResourceV1(scope, input.reference.storageKey).alpha], [0, 64, 128, 255]);
	});
	assert.equal(traps, 0); assert.throws(() => scopedBrushMaskResourceV1(retained, input.reference.storageKey), TypeError);
});

test('complete authenticated closure proof admits unused declarations and refuses missing or changed graph requirements', async () => {
	const first = resource(), second = resource(254); let saved: Readonly<MaskRasterSourceScopeV1> | undefined;
	await withMaskRasterSourceScopeV1([first.reference], new Set(), bodies([first]), scope => {
		saved = scope; assertMaskRasterSourceScopeV1(scope, []); assertMaskRasterSourceScopeV1(scope, [first.reference, first.reference]);
		assert.throws(() => scopedBrushMaskResourceV1(scope, first.reference.storageKey));
		assert.throws(() => assertMaskRasterSourceScopeV1(scope, [second.reference]));
		assert.throws(() => assertMaskRasterSourceScopeV1(scope, [{ ...first.reference, width: 1 }]));
	});
	assert.throws(() => assertMaskRasterSourceScopeV1(saved, []), TypeError);
});

test('closure proof rejects forged scope before requirements reflection and respects active native cancellation', async () => {
	const input = resource(), stop = new AbortController(), reason = opaque(); let traps = 0;
	const requirements = new Proxy([], { getOwnPropertyDescriptor() { traps++; assert.fail('Forged scope reflected graph requirements'); } });
	assert.throws(() => assertMaskRasterSourceScopeV1(opaque(), requirements), TypeError);
	await exactFailure(withMaskRasterSourceScopeV1([input.reference], new Set(), bodies(), scope => {
		assertMaskRasterSourceScopeV1(scope, [input.reference]); stop.abort(reason);
		try { assertMaskRasterSourceScopeV1(scope, requirements); assert.fail('Cancelled scope admitted'); }
		catch (error) { assert.equal(Object.is(error, reason), true); }
	}, stop.signal), reason);
	assert.equal(traps, 0);
});

test('scope working-byte proof charges complete retained alpha and largest declared body, including unused declarations', async () => {
	const first = resource(), second = resource(254); let saved: Readonly<MaskRasterSourceScopeV1> | undefined;
	await withMaskRasterSourceScopeV1([first.reference, second.reference], new Set([first.reference.storageKey, second.reference.storageKey]), bodies([first, second]), scope => {
		saved = scope; assertMaskRasterSourceScopeV1(scope, [first.reference]);
		assert.equal(maskRasterSourceScopeWorkingBytesV1(scope), 4 + 4 + 4 * 20 + 64);
	});
	assert.throws(() => maskRasterSourceScopeWorkingBytesV1(saved), TypeError);
	const bytes = new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, 3, 0, 0, 0, 2, 0, 0, 0, 1, 2, 3, 4, 5, 6]);
	const hash = createHash('sha256').update(bytes).digest('hex'), larger = { bytes, reference: normalizeBrushMaskResourceReferenceV1(`brush-mask-v1:3:2:${hash}`) };
	await withMaskRasterSourceScopeV1([first.reference, larger.reference], selected(first.reference), bodies([first, larger]), scope => {
		assert.equal(maskRasterSourceScopeWorkingBytesV1(scope), 4 + 4 * 22 + 64);
	});
	await withMaskRasterSourceScopeV1([], new Set(), bodies(), scope => { assert.equal(maskRasterSourceScopeWorkingBytesV1(scope), 0); });
});

test('working-byte proof refuses forged identities without reflection and uses the active native cancellation reason', async () => {
	const input = resource(), stop = new AbortController(), reason = opaque(); let traps = 0;
	const hostile = new Proxy({}, { get() { traps++; assert.fail('Peak proof reflected forged scope'); }, getPrototypeOf() { traps++; assert.fail('Peak proof inspected scope'); } });
	for (const value of [hostile, opaque(), { kind: 'mask-raster-source-scope-v1' }]) assert.throws(() => maskRasterSourceScopeWorkingBytesV1(value), TypeError);
	await exactFailure(withMaskRasterSourceScopeV1([input.reference], selected(input.reference), bodies(), scope => {
		assert.equal(maskRasterSourceScopeWorkingBytesV1(scope), 148); stop.abort(reason);
		try { maskRasterSourceScopeWorkingBytesV1(scope); assert.fail('Cancelled peak proof admitted'); } catch (error) { assert.equal(Object.is(error, reason), true); }
	}, stop.signal), reason);
	assert.equal(traps, 0);
});

test('borrowed retained alpha is independently copied and native backing is pinned before consumer reflection', async () => {
	const input = resource(), reason = opaque(); let alpha: Uint8Array | undefined, getters = 0;
	const work = withMaskRasterSourceScopeV1([input.reference], selected(input.reference), bodies([input]), scope => {
		alpha = scopedBrushMaskResourceV1(scope, input.reference.storageKey).alpha; input.bytes.fill(17);
		assert.deepEqual([...alpha], [0, 64, 128, 255]);
		Object.defineProperty(alpha, 'buffer', { get() { getters++; assert.fail('Cleanup backing reflected'); } }); throw reason;
	});
	await exactFailure(work, reason); assert.equal(getters, 0); assert.ok(alpha?.every(value => value === 0)); assert.ok(input.bytes.every(value => value === 17));
});

test('source callback claim rejects repeated delivery even when source ignores the refused callback', async () => {
	const input = resource(); let consumers = 0, second: Promise<unknown> | undefined;
	const source: MaskRasterSourcePortV1 = { async withBytes<Result>(_reference: Readonly<BrushMaskResourceReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>) {
		const result = await consume(input.bytes); second = Promise.resolve(consume(input.bytes)); await second.catch(() => undefined); return result;
	} };
	await assert.rejects(withMaskRasterSourceScopeV1([input.reference], selected(input.reference), source, () => { consumers++; }));
	assert.ok(second); await assert.rejects(second); assert.equal(consumers, 0);
});

test('reentrant concurrent delivery is latched even while the first child is unsettled', async () => {
	const input = resource(); let consumers = 0;
	const source: MaskRasterSourcePortV1 = { async withBytes<Result>(_reference: Readonly<BrushMaskResourceReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>) {
		const first = Promise.resolve(consume(input.bytes)), second = Promise.resolve(consume(input.bytes));
		await second.catch(() => undefined); return await first;
	} };
	await assert.rejects(withMaskRasterSourceScopeV1([input.reference], selected(input.reference), source, () => { consumers++; })); assert.equal(consumers, 0);
});

test('callback is claimed before invalid-body admission and cannot be replaced by a second valid delivery', async () => {
	const input = resource(); let consumers = 0;
	const source: MaskRasterSourcePortV1 = { async withBytes<Result>(_reference: Readonly<BrushMaskResourceReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>) {
		await Promise.resolve(consume({} as Uint8Array<ArrayBuffer>)).catch(() => undefined);
		await Promise.resolve(consume(input.bytes)).catch(() => undefined); return undefined as Result;
	} };
	await assert.rejects(withMaskRasterSourceScopeV1([input.reference], selected(input.reference), source, () => { consumers++; })); assert.equal(consumers, 0);
});

test('missing and late callbacks refuse without delivering a scope or touching hostile bytes', async () => {
	const input = resource(); let late: ((bytes: Uint8Array<ArrayBuffer>) => unknown) | undefined, consumers = 0, traps = 0;
	const source: MaskRasterSourcePortV1 = { async withBytes<Result>(_reference: Readonly<BrushMaskResourceReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>) {
		late = consume; return undefined as Result;
	} };
	await assert.rejects(withMaskRasterSourceScopeV1([input.reference], selected(input.reference), source, () => { consumers++; }));
	const hostile = new Proxy({}, { ownKeys() { traps++; assert.fail('Late body reflected'); }, get() { traps++; assert.fail('Late body read'); } });
	assert.ok(late); await assert.rejects(Promise.resolve(late(hostile as Uint8Array<ArrayBuffer>)));
	assert.equal(traps, 0); assert.equal(consumers, 0);
});

test('forgotten admitted authentication failure joins source and preserves sole opaque source failure exactly', async () => {
	const input = resource(), reason = opaque(); let child: Promise<unknown> | undefined, consumers = 0;
	const source: MaskRasterSourcePortV1 = { async withBytes<Result>(_reference: Readonly<BrushMaskResourceReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>) {
		child = Promise.resolve(consume(input.bytes)); void child.catch(() => undefined); throw reason;
	} };
	await exactFailure(withMaskRasterSourceScopeV1([input.reference], selected(input.reference), source, () => { consumers++; }), reason);
	assert.ok(child); await child; assert.equal(consumers, 0);
});

test('forgotten auth child joins before success and a swallowed corrupt delivery still refuses', async () => {
	const input = resource(); let child: Promise<unknown> | undefined, consumers = 0;
	for (const corrupt of [false, true]) {
		const source: MaskRasterSourcePortV1 = { async withBytes<Result>(_reference: Readonly<BrushMaskResourceReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>) {
			const bytes = new Uint8Array(input.bytes); if (corrupt) bytes[19] = 3;
			child = Promise.resolve(consume(bytes)); void child.catch(() => undefined); return undefined as Result;
		} };
		const work = withMaskRasterSourceScopeV1([input.reference], selected(input.reference), source, scope => {
			consumers++; return [...scopedBrushMaskResourceV1(scope, input.reference.storageKey).alpha];
		});
		if (corrupt) await assert.rejects(work, /SHA256/u); else assert.deepEqual(await work, [0, 64, 128, 255]);
		assert.ok(child); await child.catch(() => undefined);
	}
	assert.equal(consumers, 1);
});

test('source cleanup failure remains exact and distinct authentication failure is retained once', async () => {
	const input = resource(), reason = opaque(); let consumers = 0;
	const only: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { await consume(input.bytes); throw reason; } };
	await exactFailure(withMaskRasterSourceScopeV1([input.reference], selected(input.reference), only, () => { consumers++; }), reason);
	let primary: unknown;
	const both: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) {
		const bytes = new Uint8Array(input.bytes); bytes[19] = 7;
		try { await consume(bytes); } catch (error) { primary = error; } throw reason;
	} };
	const result = await outcome(withMaskRasterSourceScopeV1([input.reference], selected(input.reference), both, () => { consumers++; }));
	assert.equal(result.failed, true); assert.ok(result.error instanceof AggregateError);
	const errors: unknown = Object.getOwnPropertyDescriptor(result.error, 'errors')?.value; assert.ok(Array.isArray(errors));
	assert.equal(errors.length, 2); assert.equal(Object.is(errors[0], primary), true); assert.equal(Object.is(errors[1], reason), true); assert.equal(consumers, 0);
});

test('identical authentication and source failures preserve the exact primary without aggregate duplication', async () => {
	const input = resource(); let primary: unknown;
	const source: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) {
		const bytes = new Uint8Array(input.bytes); bytes[19] = 7;
		try { await consume(bytes); } catch (error) { primary = error; throw error; } assert.fail('Invalid body admitted');
	} };
	const result = await outcome(withMaskRasterSourceScopeV1([input.reference], selected(input.reference), source, () => assert.fail('Scope delivered')));
	assert.equal(result.failed, true); assert.equal(Object.is(result.error, primary), true);
});

test('cancellation during held source cleanup joins before refusing consumer with exact native opaque reason', async () => {
	const input = resource(), stop = new AbortController(), reason = opaque(), entered = deferred<void>(), release = deferred<void>();
	let consumers = 0;
	const source: MaskRasterSourcePortV1 = { async withBytes(reference, consume, options) {
		assert.deepEqual(reference, input.reference); assert.equal(options?.signal, stop.signal); const result = await consume(input.bytes);
		entered.resolve(); await release.promise; return result;
	} };
	const work = withMaskRasterSourceScopeV1([input.reference], selected(input.reference), source, () => { consumers++; }, stop.signal), result = outcome(work);
	try { await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(work), true); }
	finally { release.resolve(); await result; }
	await exactFailure(work, reason); assert.equal(consumers, 0);
});

test('consumer cancellation joins held work before retiring scope and wiping retained alpha', async () => {
	const input = resource(), stop = new AbortController(), reason = opaque(), entered = deferred<void>(), release = deferred<void>();
	let saved: Readonly<MaskRasterSourceScopeV1> | undefined, alpha: Uint8Array | undefined;
	const work = withMaskRasterSourceScopeV1([input.reference], selected(input.reference), bodies(), async scope => {
		saved = scope; alpha = scopedBrushMaskResourceV1(scope, input.reference.storageKey).alpha; entered.resolve(); await release.promise;
	}, stop.signal), result = outcome(work);
	try {
		await Promise.race([entered.promise, work]); stop.abort(reason); await settle(2); assert.equal(await remainsPending(work), true);
		assert.deepEqual([...alpha!], [0, 64, 128, 255]); assert.throws(() => scopedBrushMaskResourceV1(saved, input.reference.storageKey), error => Object.is(error, reason));
	} finally { release.resolve(); await result; }
	await exactFailure(work, reason); assert.ok(alpha?.every(value => value === 0)); assert.throws(() => scopedBrushMaskResourceV1(saved, input.reference.storageKey), TypeError);
});

test('native pre-cancelled and shadowed signals refuse before source or reference reflection', async () => {
	const stop = new AbortController(), reason = opaque(); stop.abort(reason); let reflected = 0, reads = 0;
	const references = new Proxy([], { getOwnPropertyDescriptor() { reflected++; assert.fail('Cancelled references reflected'); } });
	const source: MaskRasterSourcePortV1 = { async withBytes() { reads++; assert.fail('Cancelled source acquired'); } };
	await exactFailure(withMaskRasterSourceScopeV1(references, new Set(), source, () => undefined, stop.signal), reason);
	const signal = new AbortController().signal; Object.defineProperty(signal, 'throwIfAborted', { value() {} });
	await assert.rejects(withMaskRasterSourceScopeV1([], new Set(), source, () => undefined, signal)); assert.equal(reflected, 0); assert.equal(reads, 0);
});

test('actual selected immutable repository supplies complete serial bodies while the scope joins its held consumer', async () => {
	const first = resource(), second = resource(254), memory = getMemoryDatabase(`lightscaper-brush-scope-${randomUUID()}`);
	const repository = new PhotoMaskRasterRepositoryV1({ memory, database: async () => null });
	const entered = deferred<void>(), release = deferred<void>(); let alpha: Uint8Array | undefined;
	try {
		await repository.put(first.reference, first.bytes); await repository.put(second.reference, second.bytes);
		const source: MaskRasterSourcePortV1 = { withBytes: repository.withBytes.bind(repository) };
		const work = withMaskRasterSourceScopeV1([first.reference, second.reference], selected(first.reference), source, async scope => {
			alpha = scopedBrushMaskResourceV1(scope, first.reference.storageKey).alpha; entered.resolve(); await release.promise; return 'complete';
		});
		try { await Promise.race([entered.promise, work]); assert.equal(await remainsPending(work), true); }
		finally { release.resolve(); }
		assert.equal(await work, 'complete'); assert.ok(alpha?.every(value => value === 0));
		await repository.withBytes(first.reference, bytes => { assert.deepEqual(bytes, first.bytes); });
		assert.equal(memory.analysis.size, 2); assert.equal(memory.mediaAssets.size, 0);
	} finally { release.resolve(); await repository.close(); }
});

test('scope joins a forgotten held work child before alpha or native identity retirement', async () => {
	const input = resource(), entered = deferred<void>(), release = deferred<void>();
	let saved: Readonly<MaskRasterSourceScopeV1> | undefined, child: Promise<string> | undefined, alpha: Uint8Array | undefined;
	const parent = withMaskRasterSourceScopeV1([input.reference], selected(input.reference), bodies(), scope => {
		saved = scope; child = withMaskRasterSourceScopeWorkV1(scope, async () => {
			alpha = scopedBrushMaskResourceV1(scope, input.reference.storageKey).alpha; entered.resolve(); await release.promise;
			assert.deepEqual([...alpha], [0, 64, 128, 255]); return 'child';
		});
		void child.catch(() => undefined); return 'parent';
	}), result = outcome(parent);
	try {
		await Promise.race([entered.promise, parent]); assert.equal(await remainsPending(parent), true);
		assert.deepEqual([...alpha!], [0, 64, 128, 255]); assertMaskRasterSourceScopeV1(saved, [input.reference]);
	} finally { release.resolve(); await result; }
	assert.equal(await parent, 'parent'); assert.equal(await child, 'child'); assert.ok(alpha?.every(value => value === 0));
	assert.throws(() => assertMaskRasterSourceScopeV1(saved, []), TypeError);
});

test('scope native cancellation joins forgotten work and preserves the exact opaque reason before wipes', async () => {
	const input = resource(), stop = new AbortController(), reason = opaque(), entered = deferred<void>(), release = deferred<void>();
	let child: Promise<unknown> | undefined, alpha: Uint8Array | undefined;
	const parent = withMaskRasterSourceScopeV1([input.reference], selected(input.reference), bodies(), scope => {
		child = withMaskRasterSourceScopeWorkV1(scope, async () => {
			alpha = scopedBrushMaskResourceV1(scope, input.reference.storageKey).alpha; entered.resolve(); await release.promise; return 'late';
		}); void child.catch(() => undefined);
	}, stop.signal), result = outcome(parent);
	try {
		await Promise.race([entered.promise, parent]); stop.abort(reason); assert.equal(await remainsPending(parent), true);
		assert.deepEqual([...alpha!], [0, 64, 128, 255]);
	} finally { release.resolve(); await result; }
	await exactFailure(parent, reason); assert.ok(child); await exactFailure(child, reason); assert.ok(alpha?.every(value => value === 0));
});

test('top consumer settlement seals new claims while already admitted work still owns active alpha', async () => {
	const input = resource(), entered = deferred<void>(), release = deferred<void>();
	let saved: Readonly<MaskRasterSourceScopeV1> | undefined, child: Promise<void> | undefined, callbacks = 0;
	const parent = withMaskRasterSourceScopeV1([input.reference], selected(input.reference), bodies(), scope => {
		saved = scope; child = withMaskRasterSourceScopeWorkV1(scope, async () => { entered.resolve(); await release.promise; });
		void child.catch(() => undefined);
	}), result = outcome(parent);
	try {
		await Promise.race([entered.promise, parent]); await settle(2); assert.equal(await remainsPending(parent), true);
		await assert.rejects(withMaskRasterSourceScopeWorkV1(saved, () => { callbacks++; }), TypeError);
		assert.deepEqual([...scopedBrushMaskResourceV1(saved, input.reference.storageKey).alpha], [0, 64, 128, 255]);
	} finally { release.resolve(); await result; }
	await parent; await child; assert.equal(callbacks, 0);
});

test('consumer failure joins ignored work and preserves each distinct child cleanup once', async () => {
	const input = resource();
	for (const distinct of [false, true]) {
		const primary = opaque(), cleanup = distinct ? opaque() : primary, entered = deferred<void>(), release = deferred<void>();
		let child: Promise<never> | undefined, alpha: Uint8Array | undefined;
		const parent = withMaskRasterSourceScopeV1([input.reference], selected(input.reference), bodies(), scope => {
			child = withMaskRasterSourceScopeWorkV1(scope, async () => {
				alpha = scopedBrushMaskResourceV1(scope, input.reference.storageKey).alpha; entered.resolve(); await release.promise; throw cleanup;
			}); void child.catch(() => undefined); throw primary;
		}), result = outcome(parent);
		try { await Promise.race([entered.promise, parent]); assert.equal(await remainsPending(parent), true); assert.deepEqual([...alpha!], [0, 64, 128, 255]); }
		finally { release.resolve(); await result; }
		assert.ok(child); await exactFailure(child, cleanup); assert.ok(alpha?.every(value => value === 0));
		const failure = await result; assert.equal(failure.failed, true);
		if (!distinct) assert.equal(Object.is(failure.error, primary), true);
		else {
			assert.ok(failure.error instanceof AggregateError);
			const errors: unknown = Object.getOwnPropertyDescriptor(failure.error, 'errors')?.value; assert.ok(Array.isArray(errors));
			assert.equal(errors.length, 2); assert.equal(Object.is(errors[0], primary), true); assert.equal(Object.is(errors[1], cleanup), true);
		}
	}
});

test('work admission checks identity before callback metadata and refuses forged or retired reentry', async () => {
	const input = resource(); let saved: Readonly<MaskRasterSourceScopeV1> | undefined, metadata = 0, invoked = 0;
	const work = new Proxy(() => { invoked++; return 9; }, { get() { metadata++; assert.fail('Work function metadata read'); } });
	for (const scope of [opaque(), { kind: 'mask-raster-source-scope-v1' }, undefined]) await assert.rejects(withMaskRasterSourceScopeWorkV1(scope, work), TypeError);
	await withMaskRasterSourceScopeV1([input.reference], selected(input.reference), bodies(), async scope => {
		saved = scope; assert.equal(await withMaskRasterSourceScopeWorkV1(scope, work), 9);
	});
	await assert.rejects(withMaskRasterSourceScopeWorkV1(saved, work), TypeError); assert.equal(metadata, 0); assert.equal(invoked, 1);
});

test('one held scope work refuses a concurrent claim before callback reflection and then admits sequential work', async () => {
	const input = resource(), entered = deferred<void>(), release = deferred<void>(); let metadata = 0, invoked = 0;
	const hostile = new Proxy(() => { invoked++; return 'overlap'; }, { get() { metadata++; assert.fail('Concurrent callback metadata read'); } });
	assert.equal(await withMaskRasterSourceScopeV1([input.reference], selected(input.reference), bodies(), async scope => {
		const alpha = scopedBrushMaskResourceV1(scope, input.reference.storageKey).alpha;
		const first = withMaskRasterSourceScopeWorkV1(scope, async () => { entered.resolve(); await release.promise; return 'first'; });
		const firstResult = outcome(first);
		try {
			await entered.promise; assert.equal(await remainsPending(first), true);
			await assert.rejects(withMaskRasterSourceScopeWorkV1(scope, hostile), TypeError);
			assert.equal(metadata, 0); assert.equal(invoked, 0); assert.deepEqual([...alpha], [0, 64, 128, 255]);
		} finally { release.resolve(); await firstResult; }
		assert.equal(await first, 'first');
		assert.equal(await withMaskRasterSourceScopeWorkV1(scope, () => 'next'), 'next');
		return 'parent';
	}), 'parent');
	assert.equal(metadata, 0); assert.equal(invoked, 0);
});

test('a synchronous work callback refuses reentrant work without poisoning its own admitted outcome', async () => {
	const input = resource(); let metadata = 0, invoked = 0;
	const hostile = new Proxy(() => { invoked++; return 'reentrant'; }, { get() { metadata++; assert.fail('Reentrant callback metadata read'); } });
	assert.equal(await withMaskRasterSourceScopeV1([input.reference], selected(input.reference), bodies(), async scope => {
		const first = withMaskRasterSourceScopeWorkV1(scope, async () => {
			await assert.rejects(withMaskRasterSourceScopeWorkV1(scope, hostile), TypeError);
			assert.deepEqual([...scopedBrushMaskResourceV1(scope, input.reference.storageKey).alpha], [0, 64, 128, 255]);
			return 'first';
		});
		assert.equal(await first, 'first');
		assert.equal(await withMaskRasterSourceScopeWorkV1(scope, () => 'sequential'), 'sequential');
		return 'parent';
	}), 'parent');
	assert.equal(metadata, 0); assert.equal(invoked, 0);
});
