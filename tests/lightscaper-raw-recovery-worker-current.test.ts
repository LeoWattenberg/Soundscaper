/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { compilePinnedLibRawRecoveryModuleV2 } from '../src/common/editor/raw/libraw-runtime-asset-v2.ts';
import { decodeLibRawRecoveryWasmV2 } from '../src/common/editor/raw/libraw-wasm-instance-v2.ts';
import { withDecodedRawRecoveryFrameV2, type RawRecoveryProfileV2 } from '../src/common/editor/raw/libraw-runtime-v2.ts';
import { rawRecoveryWorkerFixtureV2 } from './helpers/lightscaper-raw-recovery-worker-current-fixture.ts';
import { rawRecoveryDngFixtureV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';

let module: WebAssembly.Module;
test.before(async () => {
	const bytes = new Uint8Array(await readFile(new URL('../runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm', import.meta.url)));
	try { module = await compilePinnedLibRawRecoveryModuleV2(bytes); } finally { bytes.fill(0); }
});
function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>(yes => { resolve = yes; }); return { promise, resolve };
}
function observe<Result>(promise: Promise<Result>) {
	return promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

for (const profile of ['linear-headroom-v1', 'highlight-recovery-v1'] as const) test(`Actual production recovery worker transfers ${profile} oriented native words and exits before consumption`, async () => {
	const bytes = rawRecoveryDngFixtureV1({ orientation: 6 }).bytes, before = bytes.slice(), workers = await rawRecoveryWorkerFixtureV2();
	const expected = decodeLibRawRecoveryWasmV2(module, bytes, profile); let backing: ArrayBuffer | undefined;
	try {
		const result = await withDecodedRawRecoveryFrameV2({ bytes, profile }, view => {
			assert.equal(workers.active(), 0); assert.equal(workers.statistics.joined, 1); assert.equal(workers.statistics.exits, 1);
			assert.deepEqual(view.frame.descriptor, expected.frame.descriptor);
			assert.deepEqual([view.frame.descriptor.width, view.frame.descriptor.height], [96, 128]);
			assert.equal(view.profile, profile); assert.equal(view.rawFlip, expected.rawFlip); assert.equal(view.exposureScale, expected.exposureScale);
			assert.ok(view.frame.pixels instanceof Float32Array); assert.deepEqual(view.frame.pixels, expected.frame.pixels);
			assert.ok(view.frame.pixels.some((value, index) => index % 4 !== 3 && value > 1));
			for (let i = 3; i < view.frame.pixels.length; i += 4) assert.equal(view.frame.pixels[i], 1);
			backing = view.frame.pixels.buffer; return 'real-recovery-consumed';
		}, { loadModule: () => Promise.resolve(module), createWorker: workers.createWorker });
		assert.equal(result, 'real-recovery-consumed'); assert.ok(backing); assert.ok(new Uint8Array(backing).every(byte => byte === 0));
		assert.deepEqual(bytes, before); assert.deepEqual(workers.statistics, { created: 1, posts: 1, messages: 1, terminations: 1, joined: 1, exits: 1 });
		assert.ok(workers.events.indexOf('exit') < workers.events.indexOf('joined'));
	} finally { expected.frame.pixels.fill(0); await workers.close(); }
});

test('Actual production recovery worker reads the owned Original snapshot across an awaited module load', async () => {
	const profile: RawRecoveryProfileV2 = 'highlight-recovery-v1', bytes = rawRecoveryDngFixtureV1().bytes, before = bytes.slice();
	const expected = decodeLibRawRecoveryWasmV2(module, before, profile), workers = await rawRecoveryWorkerFixtureV2();
	const loading = deferred<void>(), release = deferred<WebAssembly.Module>(); let task: Promise<string> | undefined;
	try {
		task = withDecodedRawRecoveryFrameV2({ bytes, profile }, view => {
			assert.deepEqual(view.frame.pixels, expected.frame.pixels); assert.equal(workers.statistics.joined, 1); return 'captured-original';
		}, { loadModule() { loading.resolve(); return release.promise; }, createWorker: workers.createWorker });
		await loading.promise; assert.equal(workers.statistics.created, 0); bytes.fill(0); release.resolve(module);
		assert.equal(await task, 'captured-original'); assert.ok(bytes.every(byte => byte === 0)); assert.equal(workers.active(), 0);
	} finally { release.resolve(module); if (task) await Promise.allSettled([task]); expected.frame.pixels.fill(0); before.fill(0); await workers.close(); }
});

test('Actual production recovery output remains owned through held consumption and retires after exact opaque cancellation', async () => {
	const bytes = rawRecoveryDngFixtureV1().bytes, before = bytes.slice(), workers = await rawRecoveryWorkerFixtureV2();
	const controller = new AbortController(), entered = deferred<ArrayBuffer>(), release = deferred<void>();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); let settled = false;
	const task = withDecodedRawRecoveryFrameV2({ bytes, profile: 'highlight-recovery-v1', signal: controller.signal }, async view => {
		assert.equal(workers.active(), 0); assert.equal(workers.statistics.joined, 1); entered.resolve(view.frame.pixels.buffer); await release.promise; return 'late';
	}, { loadModule: () => Promise.resolve(module), createWorker: workers.createWorker });
	const observed = observe(task).then(outcome => { settled = true; return outcome; });
	try {
		const backing = await Promise.race([entered.promise, observed.then(() => { throw new Error('Recovery consumer never entered.'); })]);
		controller.abort(opaque.proxy); await Promise.resolve(); assert.equal(settled, false); assert.ok(new Uint8Array(backing).some(byte => byte !== 0));
		release.resolve(); const outcome = await observed; assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy));
		assert.ok(new Uint8Array(backing).every(byte => byte === 0)); assert.deepEqual(bytes, before);
	} finally { release.resolve(); await Promise.allSettled([task]); await workers.close(); }
});

test('Actual production recovery worker refuses corrupt RAW without delivery and joins its failed native thread', async () => {
	const workers = await rawRecoveryWorkerFixtureV2(); let consumed = false;
	try {
		await assert.rejects(withDecodedRawRecoveryFrameV2({ bytes: new Uint8Array(64).fill(17), profile: 'highlight-recovery-v1' }, () => { consumed = true; },
			{ loadModule: () => Promise.resolve(module), createWorker: workers.createWorker }), /LibRaw|RAW|native/u);
		assert.equal(consumed, false); assert.equal(workers.active(), 0); assert.equal(workers.statistics.joined, 1); assert.equal(workers.statistics.exits, 1);
	} finally { await workers.close(); }
});
