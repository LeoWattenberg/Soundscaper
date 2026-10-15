/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { admitPhotoOriginalDerivedBindingCurrentV1, withPhotoOriginalDerivedFrameCurrentV1 } from '../src/lightscaper/preview/photo-original-derived-frame-current-v1.ts';
import type { PhotoOriginalDerivedFramePortsCurrentV1 } from '../src/lightscaper/preview/photo-original-derived-frame-current-v1.ts';
import { withDecodedRawOriginalV1 } from '../src/common/editor/raw/libraw-runtime-v1.ts';
import { withDecodedRawRecoveryFrameV2 } from '../src/common/editor/raw/libraw-runtime-v2.ts';
import { RAW_RECOVERY_ROIS } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { rawDerivedOriginalFixtureCurrentV1, rawDerivedOriginalNativeCurrentV1 } from './helpers/lightscaper-raw-derived-original-current-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

const PROFILE = 'highlight-recovery-v1' as const;
function observe<Value>(work: Promise<Value>) {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
function request(f: ReturnType<typeof rawDerivedOriginalFixtureCurrentV1>) { return { binding: f.binding, body: f.body, profile: PROFILE }; }
function retired(values: readonly ArrayBuffer[]): void { for (const buffer of values) assert.ok(new Uint8Array(buffer).every(value => value === 0)); }

test('Current derived Original lends genuine recovered Float32 only after canonical ABI 1 words and native worker retire', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1(), native = await rawDerivedOriginalNativeCurrentV1(), before = f.bytes.slice();
	try {
		const result = await withPhotoOriginalDerivedFrameCurrentV1(request(f), view => {
			assert.equal(native.canonical.statistics.joined, 1); assert.equal(native.recovery.statistics.joined, 1); retired(native.words);
			assert.deepEqual(view.frame.descriptor, { schemaVersion: 1, width: 128, height: 96, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' });
			assert.equal(view.profile, PROFILE); assert.equal(view.rawFlip, 0); assert.ok(view.exposureScale > 1.5 && view.exposureScale < 2.5);
			const samples = RAW_RECOVERY_ROIS.highlights.map(roi => view.frame.pixels[(roi.y * 128 + roi.x) * 4 + 1]!);
			assert.ok(samples[3]! - samples[0]! > 0.4); assert.ok(samples[3]! > 1.5);
			for (let at = 3; at < view.frame.pixels.length; at += 4) assert.equal(view.frame.pixels[at], 1);
			return 'derived-native';
		}, native.ports);
		assert.equal(result, 'derived-native'); retired([...native.words, ...native.floats]);
		assert.ok(native.inputs.length === 2 && native.inputs[0] === native.inputs[1]); assert.ok(native.inputs[0]!.every(value => value === 0));
		assert.ok(native.events.indexOf('canonical-retired') < native.events.indexOf('recovery-start'));
		assert.deepEqual(new Uint8Array(await f.body.arrayBuffer()), before); assert.deepEqual(f.bytes, before);
	} finally { await native.close(); }
});

test('Current derived Original pins same-instance orientation and supports both explicit fixed profiles', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1(6), native = await rawDerivedOriginalNativeCurrentV1();
	try {
		for (const profile of ['linear-headroom-v1', PROFILE] as const) {
			// Each operation retains one snapshot; the observer's identity register is
			// scoped to that borrow rather than comparing separate legitimate reads.
			native.inputs.length = 0;
			await withPhotoOriginalDerivedFrameCurrentV1({ ...request(f), profile }, view => {
				assert.equal(view.rawFlip, 6); assert.equal(view.profile, profile);
				assert.deepEqual([view.frame.descriptor.width, view.frame.descriptor.height], [96, 128]);
			}, native.ports);
		}
		retired([...native.words, ...native.floats]);
	} finally { await native.close(); }
});

test('Derived admission captures closed profile/binding/ports before the first asynchronous current fence', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1(), native = await rawDerivedOriginalNativeCurrentV1();
	const entered = deferred<void>(), release = deferred<void>(), value = { ...request(f), binding: { ...f.binding } };
	const raw = native.ports.withRawFrame, recover = native.ports.withRecoveryFrame; let calls = 0;
	native.hooks.current = async () => { if (calls++ === 0) { entered.resolve(); await release.promise; } };
	let task: Promise<string> | undefined;
	try {
		task = withPhotoOriginalDerivedFrameCurrentV1(value, view => { assert.equal(view.profile, PROFILE); return 'captured'; }, native.ports);
		await entered.promise;
		Object.defineProperty(value, 'profile', { value: 'linear-headroom-v1' }); value.binding.width = 16;
		Object.defineProperty(native.ports, 'withRawFrame', { value() { throw new Error('Replaced canonical method was read.'); }, configurable: true });
		Object.defineProperty(native.ports, 'withRecoveryFrame', { value() { throw new Error('Replaced recovery method was read.'); }, configurable: true });
		release.resolve(); assert.equal(await task, 'captured');
	} finally {
		release.resolve(); if (task) await Promise.allSettled([task]);
		Object.defineProperty(native.ports, 'withRawFrame', { value: raw, configurable: true });
		Object.defineProperty(native.ports, 'withRecoveryFrame', { value: recover, configurable: true }); await native.close();
	}
});

test('Malformed profiles, accessors and over-budget scalar geometry refuse before body IO or native work', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1(); let reads = 0, calls = 0;
	const original = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer')!;
	Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, value() { reads++; throw new Error('Unexpected body IO.'); } });
	const ports: PhotoOriginalDerivedFramePortsCurrentV1 = {
		withRawFrame() { calls++; throw new Error('Unexpected canonical decode.'); }, withRecoveryFrame() { calls++; throw new Error('Unexpected recovery decode.'); },
	};
	try {
		for (const value of [{ ...request(f), profile: 'future' }, { ...request(f), extra: true },
			{ ...request(f), binding: { ...f.binding, width: 8192, height: 8192 } },
			Object.defineProperty({ ...request(f) }, 'profile', { get() { throw new Error('Profile getter executed.'); } })]) {
			await assert.rejects(withPhotoOriginalDerivedFrameCurrentV1(value, () => undefined, ports), error => error instanceof TypeError || error instanceof RangeError);
		}
		await assert.rejects(withPhotoOriginalDerivedFrameCurrentV1(request(f), undefined as never, ports), TypeError);
		assert.equal(reads, 0); assert.equal(calls, 0);
	} finally { Object.defineProperty(Blob.prototype, 'arrayBuffer', original); }
});

test('Derived RAW input beyond 64 MiB refuses in scalar admission before native Blob reads or output allocation', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1(), saved = Object.getOwnPropertyDescriptor(Reflect, 'apply')!, apply = Reflect.apply, read = Blob.prototype.arrayBuffer;
	let reads = 0, calls = 0;
	const ports: PhotoOriginalDerivedFramePortsCurrentV1 = {
		withRawFrame() { calls++; throw new Error('Oversized input reached canonical allocation.'); },
		withRecoveryFrame() { calls++; throw new Error('Oversized input reached recovery allocation.'); },
	};
	Object.defineProperty(Reflect, 'apply', { configurable: true, value(target: (...args: never[]) => unknown, receiver: unknown, args: unknown[]): unknown {
		if (target === read) { reads++; throw new Error('Oversized input reached intrinsic Blob IO.'); }
		return apply(target, receiver, args);
	} });
	try {
		assert.doesNotThrow(() => admitPhotoOriginalDerivedBindingCurrentV1({ ...f.binding, byteLength: 64 * 1024 * 1024 }));
		for (const byteLength of [64 * 1024 * 1024 + 1, 65 * 1024 * 1024, 74 * 1024 * 1024]) {
			const binding = { ...f.binding, byteLength };
			assert.throws(() => admitPhotoOriginalDerivedBindingCurrentV1(binding), RangeError);
			await assert.rejects(withPhotoOriginalDerivedFrameCurrentV1({ ...request(f), binding }, () => undefined, ports), RangeError);
		}
		assert.equal(reads, 0); assert.equal(calls, 0);
	} finally { Object.defineProperty(Reflect, 'apply', saved); }
});

test('Pre-aborted derived requests preserve an opaque reason before hostile profile or capability metadata is inspected', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy);
	let profileInspections = 0, capabilityInspections = 0;
	const value = new Proxy({ ...request(f), signal: stop.signal }, {
		getOwnPropertyDescriptor(target, key) {
			if (key === 'profile') { profileInspections++; throw new Error('Pre-aborted profile metadata was inspected.'); }
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	});
	const ports = new Proxy({}, { ownKeys() { capabilityInspections++; throw new Error('Pre-aborted capabilities were inspected.'); } });
	for (const [input, options] of [[value, {}], [{ ...request(f), signal: stop.signal }, ports]] as const) {
		const outcome = await observe(withPhotoOriginalDerivedFrameCurrentV1(input, () => undefined, options));
		assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, reason.proxy));
	}
	assert.equal(profileInspections, 0); assert.equal(capabilityInspections, 0);
});

test('Whole Original SHA, length and RAW signature are authenticated before either native decoder', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1(); let calls = 0;
	const ports: PhotoOriginalDerivedFramePortsCurrentV1 = {
		withRawFrame() { calls++; throw new Error('Unverified bytes entered canonical decode.'); },
		withRecoveryFrame() { calls++; throw new Error('Unverified bytes entered recovery decode.'); },
	};
	const changed = f.bytes.slice(); changed[changed.length - 1]! ^= 1;
	for (const value of [{ ...request(f), body: new Blob([changed]) }, { ...request(f), body: new Blob([f.bytes.subarray(1)]) },
		{ ...request(f), body: new Blob([new Uint8Array(f.bytes.length)]) }]) {
		await assert.rejects(withPhotoOriginalDerivedFrameCurrentV1(value, () => undefined, ports));
	}
	assert.equal(calls, 0);
});

test('A canonical geometry mismatch retires real ABI 1 words and prevents recovery decoding', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1(), native = await rawDerivedOriginalNativeCurrentV1(), raw = native.ports.withRawFrame!;
	Object.defineProperty(native.ports, 'withRawFrame', { configurable: true, value<Result>(value: unknown,
		consume: Parameters<typeof withDecodedRawOriginalV1<Result>>[1]) {
		return Reflect.apply(raw, native.ports, [value, (view: Parameters<Parameters<typeof withDecodedRawOriginalV1>[1]>[0]) =>
			consume({ ...view, frame: { ...view.frame, descriptor: { ...view.frame.descriptor, width: 64, height: 192 } } })]) as Promise<Result>;
	} });
	try {
		await assert.rejects(withPhotoOriginalDerivedFrameCurrentV1(request(f), () => { throw new Error('Mismatched canonical result published.'); }, native.ports));
		assert.equal(native.recovery.statistics.created, 0); retired(native.words); assert.ok(native.inputs[0]!.every(value => value === 0));
	} finally { await native.close(); }
});

test('Stale current authority after joined canonical retirement prevents ABI 2 initialization', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1(), native = await rawDerivedOriginalNativeCurrentV1(), stale = new Error('Stale selected Photo revision.'); let current = true;
	native.hooks.afterCanonical = async () => { current = false; };
	native.hooks.current = async () => { if (!current) throw stale; };
	try {
		const outcome = await observe(withPhotoOriginalDerivedFrameCurrentV1(request(f), () => undefined, native.ports));
		assert.ok(!outcome.ok); assert.equal(outcome.error, stale); assert.equal(native.recovery.statistics.created, 0); retired(native.words);
	} finally { await native.close(); }
});

test('Derived mismatch of profile, native orientation or geometry refuses and retires the actual recovered plane', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1();
	for (const change of ['flip', 'profile', 'geometry'] as const) {
		const native = await rawDerivedOriginalNativeCurrentV1(), recover = native.ports.withRecoveryFrame!;
		Object.defineProperty(native.ports, 'withRecoveryFrame', { configurable: true, value<Result>(value: unknown,
			consume: Parameters<typeof withDecodedRawRecoveryFrameV2<Result>>[1]) {
			return Reflect.apply(recover, native.ports, [value, (view: Parameters<Parameters<typeof withDecodedRawRecoveryFrameV2>[1]>[0]) => consume({ ...view,
				...(change === 'flip' ? { rawFlip: 1 } : change === 'profile' ? { profile: 'linear-headroom-v1' as const }
					: { frame: { ...view.frame, descriptor: { ...view.frame.descriptor, width: 64, height: 192 } } }) })]) as Promise<Result>;
		} });
		try {
			await assert.rejects(withPhotoOriginalDerivedFrameCurrentV1(request(f), () => { throw new Error('Mismatched recovery published.'); }, native.ports));
			retired([...native.words, ...native.floats]); assert.equal(native.recovery.statistics.joined, 1);
		} finally { await native.close(); }
	}
});

test('Encoded snapshot mutation between real native phases is refused before recovery', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1(), native = await rawDerivedOriginalNativeCurrentV1();
	native.hooks.afterCanonical = async () => { native.inputs[0]![native.inputs[0]!.length - 1]! ^= 1; };
	try {
		await assert.rejects(withPhotoOriginalDerivedFrameCurrentV1(request(f), () => undefined, native.ports));
		assert.equal(native.recovery.statistics.created, 0); assert.ok(native.inputs[0]!.every(value => value === 0)); retired(native.words);
	} finally { await native.close(); }
});

test('Derived borrow joins a held consumer and preserves exact opaque cancellation before all owned bytes retire', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1(), native = await rawDerivedOriginalNativeCurrentV1(), stop = new AbortController();
	const entered = deferred<ArrayBuffer>(), release = deferred<void>(), reason = Proxy.revocable({}, {}); reason.revoke(); let settled = false;
	const task = withPhotoOriginalDerivedFrameCurrentV1({ ...request(f), signal: stop.signal }, async view => {
		entered.resolve(view.frame.pixels.buffer); await release.promise; return 'late';
	}, native.ports);
	const watched = observe(task).then(value => { settled = true; return value; });
	try {
		const backing = await Promise.race([entered.promise, watched.then(() => { throw new Error('Derived consumer never entered.'); })]);
		stop.abort(reason.proxy); await Promise.resolve(); assert.equal(settled, false); assert.ok(new Uint8Array(backing).some(value => value !== 0));
		release.resolve(); const outcome = await watched; assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, reason.proxy));
		retired([...native.words, ...native.floats]); assert.ok(native.inputs[0]!.every(value => value === 0));
	} finally { release.resolve(); await Promise.allSettled([task]); await native.close(); }
});

test('Independent downstream AggregateError survives simultaneous abort and encoded/output physical retirement', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1(), native = await rawDerivedOriginalNativeCurrentV1(), stop = new AbortController();
	const primary = Proxy.revocable({}, {}); primary.revoke(); const cleanup = new Error('Independent renderer cleanup.'), failure = new AggregateError([primary.proxy, cleanup]);
	try {
		const outcome = await observe(withPhotoOriginalDerivedFrameCurrentV1({ ...request(f), signal: stop.signal }, () => {
			stop.abort(primary.proxy); throw failure;
		}, native.ports));
		assert.ok(!outcome.ok); assert.equal(outcome.error, failure); retired([...native.words, ...native.floats]);
		assert.ok(native.inputs[0]!.every(value => value === 0));
	} finally { await native.close(); }
});

test('Transferred recovered output refuses physical retirement while preserving an opaque consumer failure', async () => {
	const f = rawDerivedOriginalFixtureCurrentV1(), native = await rawDerivedOriginalNativeCurrentV1(), primary = Proxy.revocable({}, {}); primary.revoke();
	let transferred: ArrayBuffer | undefined;
	try {
		const outcome = await observe(withPhotoOriginalDerivedFrameCurrentV1(request(f), view => {
			transferred = structuredClone(view.frame.pixels.buffer, { transfer: [view.frame.pixels.buffer] }); throw primary.proxy;
		}, native.ports));
		assert.ok(!outcome.ok); assert.ok(outcome.error instanceof AggregateError); assert.ok(Object.is(outcome.error.errors[0], primary.proxy));
		assert.ok(outcome.error.errors.some((value: unknown) => !Object.is(value, primary.proxy) && value instanceof TypeError));
		assert.ok(native.inputs[0]!.every(value => value === 0)); retired(native.words);
	} finally { if (transferred) new Uint8Array(transferred).fill(0); await native.close(); }
});
