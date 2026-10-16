/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { preparePixelFrameWebGl2LutCurrentV1, readPixelFrameWebGl2LutCurrentV1, isPixelFrameWebGl2LutCurrentV1,
	planPixelFrameWebGl2LutsCurrentV1, withPixelFrameWebGl2LutsCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-lut-current-v1.ts';

const SWAP = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
const SIGNED = 'LUT_3D_SIZE 2\nDOMAIN_MIN -1 -1 -1\nDOMAIN_MAX 1 1 1\n-2 0 3\n2 0 3\n-2 1 3\n2 1 3\n-2 0 5\n2 0 5\n-2 1 5\n2 1 5';
function fixture(text = SWAP, domainMin: readonly number[] = [0, 0, 0], domainMax: readonly number[] = [1, 1, 1]) {
	const bytes = new TextEncoder().encode(text), sha256 = createHash('sha256').update(bytes).digest('hex');
	return { bytes, reference: { storageKey: `lut-sha256:${sha256}`, sha256, byteLength: bytes.byteLength, size: 2, domainMin, domainMax } };
}
function sourceFor(...items: ReturnType<typeof fixture>[]): CubeLutSourcePortV1 {
	const bank = new Map(items.map(item => [item.reference.storageKey, item.bytes]));
	return { async withBytes(reference, consume) {
		const bytes = bank.get(reference.storageKey)?.slice(); assert.ok(bytes);
		try { return await consume(bytes); } finally { bytes.fill(0); }
	} };
}
function gate() {
	let resolve!: () => void;
	const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
}
function observe<Result>(promise: Promise<Result>) {
	return promise.then(value => ({ value }), (error: unknown) => ({ error }));
}

test('GPU LUT metadata is private, immutable and deduplicates complete references with explicit phase costs', () => {
	const selected = fixture(), first = preparePixelFrameWebGl2LutCurrentV1({ id: 'first', reference: selected.reference });
	const second = preparePixelFrameWebGl2LutCurrentV1({ id: 'second', reference: selected.reference });
	assert.equal(first.type, 'cube-lut-profile-v1'); assert.equal(first.kind, 8); assert.ok(Object.isFrozen(first));
	assert.ok(Object.isFrozen(first.reference)); assert.ok(Object.isFrozen(first.reference.domainMin));
	assert.equal(readPixelFrameWebGl2LutCurrentV1(first), first); assert.equal(isPixelFrameWebGl2LutCurrentV1(first), true);
	const plan = planPixelFrameWebGl2LutsCurrentV1([first, second]);
	assert.equal(plan.references.length, 1); assert.equal(plan.oracleBytes, 2 ** 3 * 3 * 8);
	assert.equal(plan.uploadBytes, 2 ** 3 * 4 * 4); assert.equal(plan.textureBytes, plan.uploadBytes);
	assert.equal(plan.capturePeakBytes, plan.oracleBytes + 128 * 1024 * 1024 + 16 * 1024 * 1024 + selected.bytes.byteLength);
	assert.equal(plan.maximumSize, 2); assert.equal(plan.eligible, true);
	let reflected = 0;
	const forged = new Proxy({}, { get() { reflected++; assert.fail('LUT identity reflection'); }, ownKeys() { reflected++; assert.fail('LUT identity enumeration'); } });
	assert.equal(isPixelFrameWebGl2LutCurrentV1(forged), false); assert.throws(() => readPixelFrameWebGl2LutCurrentV1(forged), TypeError);
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	assert.equal(isPixelFrameWebGl2LutCurrentV1(revoked.proxy), false); assert.throws(() => readPixelFrameWebGl2LutCurrentV1(revoked.proxy), TypeError);
	assert.equal(reflected, 0);
});

test('authenticated GPU LUT resources capture tables sequentially, sample native Double values and retire before capability reuse', async () => {
	const first = fixture(), second = fixture(SIGNED, [-1, -1, -1]), bank = new Map([first, second].map(item => [item.reference.storageKey, item]));
	const a = preparePixelFrameWebGl2LutCurrentV1({ id: 'swap', reference: first.reference });
	const b = preparePixelFrameWebGl2LutCurrentV1({ id: 'signed', reference: second.reference });
	const repeat = preparePixelFrameWebGl2LutCurrentV1({ id: 'swap-again', reference: first.reference });
	const log: string[] = []; let live = 0, retired: (() => void) | undefined;
	const source: CubeLutSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, source); assert.equal(live, 0, 'Resource borrows must never nest.'); live++;
		const item = bank.get(reference.storageKey); assert.ok(item); const bytes = item.bytes.slice(); log.push(`open:${reference.sha256}`);
		try { return await consume(bytes); } finally { bytes.fill(0); live--; log.push(`close:${reference.sha256}`); }
	} };
	await withPixelFrameWebGl2LutsCurrentV1([a, b, repeat], source, resources => {
		assert.equal(live, 0, 'All parser/source operations retire before resource consumption.');
		assert.deepEqual(log, [`open:${first.reference.sha256}`, `close:${first.reference.sha256}`, `open:${second.reference.sha256}`, `close:${second.reference.sha256}`]);
		assert.equal(resources.maximumSize, 2); assert.equal(resources.supported(a), true); assert.equal(resources.supported(b), true);
		const rgb = { red: 0, green: 0, blue: 0 };
		resources.writeChannels(a, .125, .5, .875, rgb); assert.deepEqual(rgb, { red: .875, green: .5, blue: .125 });
		resources.writeChannels(b, .25, -.5, 2, rgb); assert.deepEqual(rgb, { red: .5, green: .25, blue: 5 });
		resources.writeChannels(repeat, .125, .5, .875, rgb); assert.deepEqual(rgb, { red: .875, green: .5, blue: .125 });
		const upload = new Float32Array(64).fill(19), count = resources.writeUpload(a, upload);
		assert.equal(count, 32); assert.deepEqual([...upload.subarray(0, 8)], [0, 0, 0, 1, 0, 0, 1, 1]);
		assert.ok(upload.subarray(count).every(value => value === 19)); upload.fill(0);
		retired = () => { resources.writeChannels(a, .125, .5, .875, rgb); };
	});
	assert.ok(retired); assert.throws(retired, TypeError); assert.equal(live, 0);
	assert.deepEqual(first.bytes, new TextEncoder().encode(SWAP)); assert.deepEqual(second.bytes, new TextEncoder().encode(SIGNED));
});

test('over-capacity unique LUT sets are valid plans but direct resource capture refuses before any source I/O', async () => {
	const passes = Array.from({ length: 256 }, (_, index) => {
		const sha256 = index.toString(16).padStart(64, '0');
		return preparePixelFrameWebGl2LutCurrentV1({ id: String(index), reference: { storageKey: `lut-sha256:${sha256}`, sha256,
			byteLength: 16 * 1024 * 1024, size: 65, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } });
	});
	const plan = planPixelFrameWebGl2LutsCurrentV1(passes); assert.equal(plan.references.length, 256); assert.equal(plan.eligible, false);
	assert.ok(plan.capturePeakBytes > 768 * 1024 * 1024); let calls = 0;
	const source: CubeLutSourcePortV1 = { withBytes() { calls++; throw new Error('Capacity refusal must precede source I/O.'); } };
	await assert.rejects(withPixelFrameWebGl2LutsCurrentV1(passes, source, () => { calls++; }), RangeError); assert.equal(calls, 0);
});

test('the Double oracle remains independent of its rounded upload bank', async () => {
	const endpoint = 2 ** -25, rows = Array.from({ length: 8 }, (_, index) => `${index % 2 ? -1 + endpoint : 1 + endpoint} .25 .5`);
	const selected = fixture(`LUT_3D_SIZE 2\n${rows.join('\n')}`), pass = preparePixelFrameWebGl2LutCurrentV1({ id: 'double', reference: selected.reference });
	await withPixelFrameWebGl2LutsCurrentV1([pass], sourceFor(selected), resources => {
		const rgb = { red: 0, green: 0, blue: 0 }, upload = new Float32Array(32);
		resources.writeChannels(pass, .5, .5, .5, rgb); assert.equal(rgb.red, endpoint); assert.equal(rgb.green, .25); assert.equal(rgb.blue, .5);
		resources.writeUpload(pass, upload); assert.equal(upload[0], 1); assert.equal(upload[4], -1);
		assert.equal(upload[0]! + (upload[4]! - upload[0]!) * .5, 0, 'Rounded upload is an invalid normative oracle.');
		upload.fill(73); resources.writeChannels(pass, .5, .5, .5, rgb); assert.equal(rgb.red, endpoint);
	});
});

test('Float32-collapsed domains and overflowing uploads retain authenticated Double sampling', async () => {
	const near = 1 + 2 ** -40, constant = Array.from({ length: 8 }, () => '.1 .2 .3').join('\n');
	const collapsed = fixture(`LUT_3D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX ${near} ${near} ${near}\n${constant}`, [1, 1, 1], [near, near, near]);
	const overflow = fixture(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '1e100 .2 .3').join('\n')}`);
	const passes = [collapsed, overflow].map((item, index) => preparePixelFrameWebGl2LutCurrentV1({ id: String(index), reference: item.reference }));
	await withPixelFrameWebGl2LutsCurrentV1(passes, sourceFor(collapsed, overflow), resources => {
		for (const [index, pass] of passes.entries()) {
			assert.equal(resources.supported(pass), false);
			const rgb = { red: 0, green: 0, blue: 0 }, upload = new Float32Array(32).fill(17);
			resources.writeChannels(pass, 1, 1, 1, rgb); assert.equal(rgb.red, index === 0 ? .1 : 1e100);
			assert.throws(() => resources.writeUpload(pass, upload), RangeError); assert.ok(upload.every(value => value === 17));
		}
	});
});

test('unsupported GPU metadata never bypasses later body authentication', async () => {
	const near = 1 + 2 ** -40, first = fixture(`LUT_3D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX ${near} ${near} ${near}\n${SWAP.split('\n').slice(1).join('\n')}`, [1, 1, 1], [near, near, near]);
	const second = fixture(SIGNED, [-1, -1, -1]), passes = [first, second].map((item, index) => preparePixelFrameWebGl2LutCurrentV1({ id: String(index), reference: item.reference }));
	let calls = 0, consumed = false;
	const source: CubeLutSourcePortV1 = { async withBytes(reference, consume) {
		calls++; const bytes = (reference.storageKey === first.reference.storageKey ? first.bytes : second.bytes).slice();
		if (calls === 2) bytes[bytes.length - 1] = 48;
		try { return await consume(bytes); } finally { bytes.fill(0); }
	} };
	await assert.rejects(withPixelFrameWebGl2LutsCurrentV1(passes, source, () => { consumed = true; }), /digest|geometry/u);
	assert.equal(calls, 2); assert.equal(consumed, false);
});

test('all source receivers are pinned before awaits and no scope begins before final source retirement', async () => {
	const first = fixture(), second = fixture(SIGNED, [-1, -1, -1]), passes = [first, second].map((item, index) => preparePixelFrameWebGl2LutCurrentV1({ id: String(index), reference: item.reference }));
	const held = gate(), entered = gate(); let calls = 0, consumed = false;
	const source: CubeLutSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, source); calls++;
		source.withBytes = () => { assert.fail('Captured source method must survive caller replacement.'); };
		const bytes = (reference.storageKey === first.reference.storageKey ? first.bytes : second.bytes).slice();
		try { const result = await consume(bytes); if (calls === 2) { entered.resolve(); await held.promise; } return result; }
		finally { bytes.fill(0); }
	} };
	const operation = withPixelFrameWebGl2LutsCurrentV1(passes, source, () => { consumed = true; });
	await entered.promise; assert.equal(calls, 2); assert.equal(consumed, false); held.resolve(); await operation; assert.equal(consumed, true);
});

test('missing or swallowed repeated source deliveries refuse resource consumption', async () => {
	const selected = fixture(), pass = preparePixelFrameWebGl2LutCurrentV1({ id: 'source', reference: selected.reference }); let consumed = 0;
	await assert.rejects(withPixelFrameWebGl2LutsCurrentV1([pass], { async withBytes() { /* Deliberately deliver no body. */ } }, () => { consumed++; }), /without delivering/u);
	const source: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
		const bytes = selected.bytes.slice();
		try { const result = await consume(bytes); try { await consume(bytes); } catch { /* Malformed source swallows repeat refusal. */ } return result; }
		finally { bytes.fill(0); }
	} };
	await assert.rejects(withPixelFrameWebGl2LutsCurrentV1([pass], source, () => { consumed++; }), /repeated|retired/u); assert.equal(consumed, 0);
});

test('cancellation preserves opaque primary and independent source cleanup errors', async () => {
	const selected = fixture(), pass = preparePixelFrameWebGl2LutCurrentV1({ id: 'abort', reference: selected.reference });
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const primary = opaque.proxy, cleanup = new Error('source cleanup'), controller = new AbortController();
	let consumed = false, wiped = false;
	const source: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
		const bytes = selected.bytes.slice(); controller.abort(primary);
		try { await consume(bytes); } catch { /* Independent child failure must survive the source's cleanup failure. */ }
		bytes.fill(0); wiped = true; throw cleanup;
	} };
	const result = await observe(withPixelFrameWebGl2LutsCurrentV1([pass], source, () => { consumed = true; }, controller.signal));
	assert.ok('error' in result); assert.ok(result.error instanceof AggregateError); assert.equal(result.error.cause, primary);
	assert.equal(result.error.errors.length, 2); assert.equal(result.error.errors[0], primary); assert.equal(result.error.errors[1], cleanup);
	assert.equal(consumed, false); assert.equal(wiped, true);
});

test('held consumers join before retirement and their exact primary failure survives cancellation', async () => {
	const selected = fixture(), pass = preparePixelFrameWebGl2LutCurrentV1({ id: 'held', reference: selected.reference }), entered = gate(), held = gate();
	const controller = new AbortController(), primary = new Error('consumer primary'); let completed = false, escaped: (() => boolean) | undefined;
	const operation = observe(withPixelFrameWebGl2LutsCurrentV1([pass], sourceFor(selected), async resources => {
		escaped = () => resources.supported(pass); entered.resolve(); await held.promise; throw primary;
	}, controller.signal)).then(result => { completed = true; return result; });
	await entered.promise; controller.abort(new Error('later cancellation')); await Promise.resolve(); assert.equal(completed, false);
	held.resolve(); const result = await operation; assert.ok('error' in result); assert.equal(result.error, primary);
	assert.ok(escaped); assert.throws(escaped, /retired/u);
});

test('scope enrollment and native upload geometry remain closed without exposing private tables', async () => {
	const selected = fixture(), pass = preparePixelFrameWebGl2LutCurrentV1({ id: 'selected', reference: selected.reference });
	const other = preparePixelFrameWebGl2LutCurrentV1({ id: 'unenrolled', reference: selected.reference });
	await withPixelFrameWebGl2LutsCurrentV1([pass], sourceFor(selected), resources => {
		assert.throws(() => resources.supported(other), /enrolled/u);
		assert.throws(() => resources.writeUpload(pass, new Float32Array(31)), RangeError);
		assert.throws(() => resources.writeUpload(pass, new Float32Array(new ArrayBuffer(132), 4, 32)), RangeError);
		let reflected = 0; const bank = new Float32Array(32);
		Object.defineProperty(bank, 'buffer', { get() { reflected++; assert.fail('Upload backing shadow may not run.'); } });
		assert.throws(() => resources.writeUpload(pass, bank), TypeError); assert.equal(reflected, 0);
		const detached = new Float32Array(32); structuredClone(detached.buffer, { transfer: [detached.buffer] });
		assert.throws(() => resources.writeUpload(pass, detached), RangeError);
	});
});

test('pre-abort and conflicting complete identities refuse before source reflection', async () => {
	let reflected = 0;
	const source = new Proxy({}, { getOwnPropertyDescriptor() { reflected++; assert.fail('Source reflection must follow metadata admission.'); } });
	const controller = new AbortController(), primary = new Error('pre-abort'); controller.abort(primary);
	const aborted = await observe(withPixelFrameWebGl2LutsCurrentV1([], source, () => { assert.fail('Pre-aborted consumer.'); }, controller.signal));
	assert.ok('error' in aborted); assert.equal(aborted.error, primary);
	const selected = fixture(), first = preparePixelFrameWebGl2LutCurrentV1({ id: 'one', reference: selected.reference });
	const second = preparePixelFrameWebGl2LutCurrentV1({ id: 'two', reference: { ...selected.reference, size: 3 } });
	await assert.rejects(withPixelFrameWebGl2LutsCurrentV1([first, second], source, () => { assert.fail('Conflicting reference consumer.'); }), /conflict/u);
	assert.equal(await withPixelFrameWebGl2LutsCurrentV1([], source, resources => resources.maximumSize), 0); assert.equal(reflected, 0);
});

test('bounded padded source views authenticate while their complete physical backing is reserved', async () => {
	const selected = fixture(), pass = preparePixelFrameWebGl2LutCurrentV1({ id: 'padded', reference: selected.reference });
	const backing = new Uint8Array(16 * 1024 * 1024), offset = 37; backing.set(selected.bytes, offset); backing[backing.length - 1] = 93;
	const source: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { return await consume(backing.subarray(offset, offset + selected.bytes.length)); } };
	const plan = planPixelFrameWebGl2LutsCurrentV1([pass]); assert.ok(plan.capturePeakBytes >= backing.byteLength + selected.bytes.length + 128 * 1024 * 1024 + plan.oracleBytes);
	await withPixelFrameWebGl2LutsCurrentV1([pass], source, resources => {
		const rgb = { red: 0, green: 0, blue: 0 }; resources.writeChannels(pass, .25, .5, .75, rgb);
		assert.deepEqual(rgb, { red: .75, green: .5, blue: .25 });
	});
	assert.equal(backing[backing.length - 1], 93); assert.deepEqual(backing.subarray(offset, offset + selected.bytes.length), selected.bytes);
	backing.fill(0);
});

test('a source that does not join its delivered child cannot hide late physical refusal', async () => {
	const size = 18, selected = fixture(`LUT_3D_SIZE ${size}\n${Array.from({ length: size ** 3 }, () => '0 0 0').join('\n')}`);
	const pass = preparePixelFrameWebGl2LutCurrentV1({ id: 'late-child', reference: { ...selected.reference, size } }); let consumed = false;
	const source = { withBytes(_reference: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => unknown) {
		const bytes = selected.bytes.slice(), child = Promise.resolve(consume(bytes)); void child.catch(() => { /* Owner must still join this child. */ });
		structuredClone(bytes.buffer, { transfer: [bytes.buffer] }); return Promise.resolve();
	} };
	await assert.rejects(withPixelFrameWebGl2LutsCurrentV1([pass], source, () => { consumed = true; }), /detached|changed/u);
	assert.equal(consumed, false);
});
