/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { withFramescaperRawImageDerivedCurrentV1 } from '../src/common/editor/timeline-image-raw-derived-current-v1.ts';
import { prepareFramescaperRawImageEncodedCurrentV1 } from '../src/common/editor/timeline-image-raw-encoded-current-v1.ts';
import { prepareFramescaperRawImageOriginalCurrentV1, withFramescaperRawImageOriginalCurrentV1 } from '../src/common/editor/timeline-image-raw-pack-current-v1.ts';
import { encodeFramescaperImageConversionReceiptV1 } from '../src/common/editor/timeline-image-conversion-receipt-v1.ts';
import { decodeFramescaperImageFramePackHeaderV1, encodeFramescaperImageFramePackHeaderV1, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES } from '../src/common/editor/timeline-image-frame-pack-v1-layout.ts';
import { rawDerivedFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-derived-frame-current-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

function observe<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
function retired(values: readonly ArrayBuffer[]): void { for (const value of values) assert.ok(new Uint8Array(value).every(byte => byte === 0)); }
function sha256(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }

test('Frame derived codec authenticates actual pack/ABI1 words then joins recovery before lending native Float32 on the same encoded bytes', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1(), before = sha256(new Uint8Array(f.pack.bytes));
	try {
		const result = await withFramescaperRawImageDerivedCurrentV1(f.request(), view => {
			assert.equal(view.profile, 'highlight-recovery-v1'); assert.equal(view.rawFlip, f.raw.rawFlip);
			assert.equal(view.frame.descriptor.sampleFormat, 'float32'); assert.deepEqual([view.frame.descriptor.width, view.frame.descriptor.height], [128, 96]);
			assert.equal(f.native.canonical.active(), 0); assert.equal(f.native.recovery.active(), 0); retired(f.native.words);
			const green = [36, 48, 60, 72].map(x => view.frame.pixels[(40 * 128 + x) * 4 + 1]!);
			assert.ok(green[3]! - green[0]! > .4); assert.ok(green[3]! > 1.5); return 'Frame-native';
		}, f.ports);
		assert.equal(result, 'Frame-native'); assert.equal(f.native.inputs.length, 2); assert.equal(f.native.inputs[0], f.native.inputs[1]);
		assert.ok(f.native.inputs[0]!.every(byte => byte === 0)); retired([...f.native.words, ...f.native.floats]);
		assert.equal(sha256(new Uint8Array(f.pack.bytes)), before); assert.equal(sha256(f.original), f.binding.pack.original.sha256);
	} finally { await f.close(); }
});

test('Narrow Frame binding accepts only strict Source1 plus native receipt and plans the Float32 maximum independently of declared extent', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1();
	try {
		const plan = prepareFramescaperRawImageEncodedCurrentV1(f.binding);
		assert.equal(plan.decodeWorkingBytes, 512n * 1024n * 1024n + 256n * 1024n * 1024n + 2n * BigInt(f.original.length) + 32n * 1024n * 1024n);
		assert.equal(plan.frameBytes, 128 * 96 * 8); assert.equal(plan.derivedFrameBytes, 128 * 96 * 16);
		assert.throws(() => prepareFramescaperRawImageEncodedCurrentV1({ ...f.binding, develop: f.source.develop }), TypeError);
		assert.throws(() => prepareFramescaperRawImageEncodedCurrentV1({ ...f.binding, pack: f.source }), TypeError);
		assert.throws(() => prepareFramescaperRawImageEncodedCurrentV1({ ...f.binding, raw: { ...f.raw, decoder: { ...f.raw.decoder, abiVersion: 2 } } }), RangeError);
		assert.throws(() => prepareFramescaperRawImageEncodedCurrentV1({ ...f.binding, pack: { ...f.binding.pack, canonical: { ...f.binding.pack.canonical, frameCount: 2 } } }), RangeError);
	} finally { await f.close(); }
});

test('Canonical full Source4 wrapper retains exact ABI1 words/Original bytes and performs no recovery decode', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1(), value = f.request();
	try {
		const result = await withFramescaperRawImageOriginalCurrentV1({ source: f.source,
			read(offset, length) { return value.read(offset, length); } }, view => {
			assert.equal(view.frame.descriptor.sampleFormat, 'unorm16'); assert.deepEqual(Array.from(view.frame.pixels), f.canonical.words);
			assert.equal(view.rawFlip, f.raw.rawFlip); assert.deepEqual(view.originalBytes, f.original); return 'canonical';
		}, { withRawOriginal: (request, consume) => f.ports.withRawOriginal!(request, consume) });
		assert.equal(result, 'canonical'); assert.equal(f.native.recovery.statistics.created, 0); assert.ok(f.native.inputs[0]!.every(byte => byte === 0)); retired(f.native.words);
	} finally { await f.close(); }
});

test('Canonical scalar admission retains positive ABI1 extents while derived minimum16 refuses before range IO', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1(); let reads = 0;
	const raw = { ...f.raw, descriptor: { ...f.raw.descriptor, width: 8, height: 8 } };
	const receipt = encodeFramescaperImageConversionReceiptV1({ schemaVersion: 1, kind: 'raw-original', raw });
	try {
		// This is metadata admission only, not a claim that the retained128×96
		// Bayer container authenticates as8×8 or that ABI2 can decode that extent.
		const canonical = { ...f.binding.pack.canonical, width: 8, height: 8 };
		const pack = { ...f.binding.pack, canonical, conversionReceiptSha256: sha256(receipt) }, binding = { pack, raw };
		assert.doesNotThrow(() => prepareFramescaperRawImageEncodedCurrentV1(binding));
		assert.doesNotThrow(() => prepareFramescaperRawImageOriginalCurrentV1({ ...f.source, ...pack, schemaVersion: 4, raw, developed: { width: 8, height: 8 } }));
		await assert.rejects(withFramescaperRawImageDerivedCurrentV1({ binding, profile: 'highlight-recovery-v1',
			read() { reads++; throw new Error('ABI2 minimum extent reached range IO.'); } }, () => undefined, f.ports), /sixteen/iu);
		assert.equal(reads, 0); assert.equal(f.native.recovery.statistics.created, 0);
	} finally { receipt.fill(0); await f.close(); }
});

test('Honestly rehashed byte presentation caches cannot influence Frame native recovery pixels or canonical receipts', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1(); let first: Float32Array<ArrayBuffer> | undefined;
	try {
		await withFramescaperRawImageDerivedCurrentV1(f.request(), view => { first = view.frame.pixels.slice(); }, f.ports);
		const changed = f.body(211); assert.notEqual(changed.pack.contentSha256, f.pack.contentSha256); assert.equal(changed.pack.conversionReceiptSha256, f.pack.conversionReceiptSha256);
		f.native.inputs.length = 0;
		await withFramescaperRawImageDerivedCurrentV1(f.request('highlight-recovery-v1', changed), view => { assert.deepEqual(view.frame.pixels, first); }, f.ports);
		retired([...f.native.words, ...f.native.floats]);
	} finally { first?.fill(0); await f.close(); }
});

test('Corrupt full pack and dishonest native receipt words refuse before ABI2 and retire owned encoded snapshots', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1();
	try {
		const value = f.request(), before = f.native.canonical.statistics.created, corrupted = new Uint8Array(f.pack.bytes.slice(0)); corrupted[corrupted.length - 1]! ^= 1;
		await assert.rejects(withFramescaperRawImageDerivedCurrentV1({ ...value,
			read(offset: number, length: number) { return corrupted.subarray(offset, offset + length); } }, () => undefined, f.ports));
		assert.equal(f.native.canonical.statistics.created, before); assert.equal(f.native.recovery.statistics.created, 0);
		const wrong = f.body(17, { ...f.raw, pixelsSha256: 'a'.repeat(64) });
		await assert.rejects(withFramescaperRawImageDerivedCurrentV1(f.request('highlight-recovery-v1', wrong), () => undefined, f.ports));
		assert.equal(f.native.canonical.statistics.created, before + 1); assert.equal(f.native.recovery.statistics.created, 0); retired(f.native.words);
	} finally { await f.close(); }
});

test('Exact RAW receipt length is fenced before generic pack metadata allocation or Original reads', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1(); let reads = 0;
	try {
		const header = decodeFramescaperImageFramePackHeaderV1(f.pack.bytes.subarray(0, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES), f.binding.pack);
		const sections = { ...header, receiptByteLength: header.receiptByteLength + 8, indexOffset: header.indexOffset + 8, frameDataOffset: header.frameDataOffset + 8 };
		const forged = encodeFramescaperImageFramePackHeaderV1({ sections, totalByteLength: f.pack.assetByteLength + 8,
			width: 128, height: 96, frameCount: 1, durationTicks: 5_000_000n, timingMode: 'fallback', hasAlpha: false,
			originalSha256: f.pack.originalSha256, conversionReceiptSha256: f.pack.conversionReceiptSha256 });
		const binding = { ...f.binding, pack: { ...f.binding.pack, assetByteLength: f.pack.assetByteLength + 8 } };
		const predecessor = f.request(), value = { ...predecessor, binding,
			read(offset: number, length: number) { assert.equal(this, value); reads++; assert.equal(offset, 0); assert.equal(length, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES); return forged; },
			async assertCurrent() { assert.equal(this, value); await predecessor.assertCurrent(); },
		};
		await assert.rejects(withFramescaperRawImageDerivedCurrentV1(value, () => undefined, f.ports), /exact/iu);
		assert.equal(reads, 1); assert.equal(f.native.recovery.statistics.created, 0);
	} finally { await f.close(); }
});

test('Frame derived codec captures profile/read/decoder receivers before a held current fence', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1(), value = f.request(), entered = deferred<void>(), release = deferred<void>(); let first = true;
	f.hooks.current = async () => { if (first) { first = false; entered.resolve(); await release.promise; } };
	const raw = f.ports.withRawOriginal, recover = f.ports.withRecoveryFrame; let task: Promise<string> | undefined;
	try {
		task = withFramescaperRawImageDerivedCurrentV1(value, view => { assert.equal(view.profile, 'highlight-recovery-v1'); return 'captured'; }, f.ports);
		await entered.promise;
		Object.defineProperty(value, 'read', { value() { throw new Error('Replaced range method was read.'); }, configurable: true });
		Object.defineProperty(value, 'profile', { value: 'linear-headroom-v1' });
		Object.defineProperty(f.ports, 'withRawOriginal', { value() { throw new Error('Replaced canonical method was read.'); }, configurable: true });
		Object.defineProperty(f.ports, 'withRecoveryFrame', { value() { throw new Error('Replaced recovery method was read.'); }, configurable: true });
		release.resolve(); assert.equal(await task, 'captured');
	} finally {
		release.resolve(); if (task) await Promise.allSettled([task]); Object.defineProperty(f.ports, 'withRawOriginal', { value: raw, configurable: true });
		Object.defineProperty(f.ports, 'withRecoveryFrame', { value: recover, configurable: true }); await f.close();
	}
});

test('Stale Frame current authority after canonical retirement prevents recovery and preserves exact failure', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1(), stale = new Error('Frame source replaced.'); let current = true;
	f.native.hooks.afterCanonical = async () => { current = false; }; f.hooks.current = async () => { if (!current) throw stale; };
	try {
		const result = await observe(withFramescaperRawImageDerivedCurrentV1(f.request(), () => undefined, f.ports));
		assert.ok(!result.ok); assert.equal(result.error, stale); assert.equal(f.native.recovery.statistics.created, 0); retired(f.native.words);
		assert.ok(f.native.inputs[0]!.every(byte => byte === 0));
	} finally { await f.close(); }
});

test('Frame derived borrow joins held consumption, preserves opaque cancellation and wipes both native and encoded ownership', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1(), stop = new AbortController(), entered = deferred<ArrayBuffer>(), release = deferred<void>();
	const reason = Proxy.revocable({}, {}); reason.revoke(); let settled = false;
	const task = withFramescaperRawImageDerivedCurrentV1(f.request('highlight-recovery-v1', undefined, stop.signal), async view => {
		entered.resolve(view.frame.pixels.buffer); await release.promise;
	}, f.ports), watched = observe(task).then(value => { settled = true; return value; });
	try {
		const backing = await Promise.race([entered.promise, watched.then(() => { throw new Error('Held Frame consumer did not enter.'); })]);
		stop.abort(reason.proxy); await Promise.resolve(); assert.equal(settled, false); assert.ok(new Uint8Array(backing).some(byte => byte !== 0));
		release.resolve(); const result = await watched; assert.ok(!result.ok); assert.ok(Object.is(result.error, reason.proxy));
		retired([...f.native.words, ...f.native.floats]); assert.ok(f.native.inputs[0]!.every(byte => byte === 0));
	} finally { release.resolve(); await Promise.allSettled([task]); await f.close(); }
});

test('Canonical and derived Frame scopes preserve independent downstream AggregateError despite simultaneous abort', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1(), primary = Proxy.revocable({}, {}); primary.revoke();
	const failure = new AggregateError([primary.proxy, new Error('Independent downstream cleanup.')]);
	try {
		for (const kind of ['canonical', 'derived'] as const) {
			f.native.inputs.length = 0; const stop = new AbortController(), value = f.request('highlight-recovery-v1', undefined, stop.signal);
			const reject = () => { stop.abort(primary.proxy); throw failure; };
			const work = kind === 'derived' ? withFramescaperRawImageDerivedCurrentV1(value, reject, f.ports)
				: withFramescaperRawImageOriginalCurrentV1({ source: f.source, signal: stop.signal,
					read(offset, length) { return value.read(offset, length); } }, reject,
				{ withRawOriginal: (request, consume) => f.ports.withRawOriginal!(request, consume) });
			const result = await observe(work); assert.ok(!result.ok); assert.equal(result.error, failure);
			retired([...f.native.words, ...f.native.floats]); assert.ok(f.native.inputs[0]!.every(byte => byte === 0));
		}
	} finally { await f.close(); }
});

test('Pre-aborted Frame derived request returns its opaque reason before binding/profile/capability metadata', async () => {
	const stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy); let reads = 0;
	const value = new Proxy({ signal: stop.signal }, { ownKeys() { reads++; throw new Error('Pre-aborted request inspected.'); } });
	const result = await observe(withFramescaperRawImageDerivedCurrentV1(value, () => undefined));
	assert.ok(!result.ok); assert.ok(Object.is(result.error, reason.proxy)); assert.equal(reads, 0);
});
