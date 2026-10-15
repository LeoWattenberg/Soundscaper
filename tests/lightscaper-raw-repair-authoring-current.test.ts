/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as authoring from '../src/common/editor/controller/shared/image-repair-spots-authoring-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withImageDevelopLinearCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { compilePinnedLibRawModuleV1 } from '../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { withDecodedRawOriginalV1 } from '../src/common/editor/raw/libraw-runtime-v1.ts';
import { withPhotoOriginalFrameCurrentV1 } from '../src/lightscaper/preview/photo-original-frame-current-v1.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { rawDngFixtureV1 } from './helpers/lightscaper-raw-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './helpers/lightscaper-raw-worker-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

let modulePromise: Promise<WebAssembly.Module> | undefined;
function moduleBytes() {
	modulePromise ??= readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url))
		.then(bytes => compilePinnedLibRawModuleV1(new Uint8Array(bytes)));
	return modulePromise;
}
async function rawOriginal() {
	const bytes = rawDngFixtureV1().bytes, body = new Blob([bytes]), photo = queryPhotoV1(), workers = await rawWorkerFixtureV1();
	const binding = { catalogId: photo.catalogId, photoId: photo.id, originalId: photo.original.id, storageKey: photo.original.storageKey,
		contentSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, width: 32, height: 32 };
	const borrowed: Uint16Array[] = [];
	const withOriginalFrame: authoring.WithImageRepairSpotsOriginalFrameV1 = (consume, options) => withPhotoOriginalFrameCurrentV1({ binding, body,
		...(options?.signal ? { signal: options.signal } : {}) }, async frame => {
		assert.ok(frame.pixels instanceof Uint16Array); borrowed.push(frame.pixels); return consume(frame);
	}, { withRawFrame: (request, consume) => withDecodedRawOriginalV1(request, consume, { loadModule: moduleBytes, createWorker: workers.createWorker }) });
	return { bytes, body, borrowed, withOriginalFrame, workers, options: { withOriginalFrame, develop: defaultImageDevelopStateV2(), isCurrent: () => true } };
}

test('explicit Current repair authoring opens and applies Clone against a genuine authenticated native DNG Original', async () => {
	const Current = (authoring as typeof authoring & { readonly ImageRepairSpotsAuthoringCurrentV1?: typeof authoring.ImageRepairSpotsAuthoringV1 }).ImageRepairSpotsAuthoringCurrentV1;
	assert.equal(typeof Current, 'function', 'The Current menu needs its native repair policy owner.'); assert.ok(Current);
	const f = await rawOriginal(), owner = new Current(f.options);
	try {
		await owner.open(); assert.equal(owner.snapshot().ready, true); assert.equal(owner.snapshot().width, 32);
		owner.add({ id: 'native-clone', mode: 'clone', enabled: true, target: { x: 24.5 / 32, y: 20.5 / 32 },
			source: { x: 8.5 / 32, y: 20.5 / 32 }, radius: 0.01, feather: 0, opacity: 1 });
		const result = await owner.apply(); assert.equal(result.processVersion, 3); assert.equal(result.repairs.spots[0]?.id, 'native-clone');
		let rendered: Float32Array | undefined;
		await owner.withOriginalFrame(frame => {
			const source = frame.pixels; assert.ok(source instanceof Uint16Array);
			const expected = Float32Array.from(source, value => value / 65535), target = (20 * 32 + 24) * 4, donor = (20 * 32 + 8) * 4;
			for (let channel = 0; channel < 3; channel++) expected[target + channel] = source[donor + channel]! / 65535;
			return withImageDevelopLinearCurrentV1({ frame, develop: result }, output => {
				rendered = output.pixels; assert.deepEqual(output.pixels, expected);
			}, PHOTO_DEVELOP_LINEAR_LIMITS_V1);
		});
		assert.ok(rendered?.every(value => value === 0));
		assert.deepEqual(new Uint8Array(await f.body.arrayBuffer()), f.bytes);
		assert.ok(f.borrowed.every(pixels => pixels.every(value => value === 0))); assert.equal(f.workers.active(), 0);
	} finally { await owner.cancelAndJoin(); await f.workers.close(); }
});

test('permanent V1 authoring still refuses genuine native RAW pixels instead of accepting a display copy', async () => {
	const f = await rawOriginal(), owner = new authoring.ImageRepairSpotsAuthoringV1(f.options);
	try { await assert.rejects(owner.open(), /admitted|UNORM8/u); assert.equal(owner.snapshot().ready, false);
		assert.ok(f.borrowed.every(pixels => pixels.every(value => value === 0)));
	} finally { await owner.cancelAndJoin(); await f.workers.close(); }
});

test('Current native Original cancellation and Close join a held real word consumer with exact opaque reason', async () => {
	const f = await rawOriginal(), stop = new AbortController(), owner = new authoring.ImageRepairSpotsAuthoringCurrentV1({ ...f.options, signal: stop.signal });
	const entered = deferred<void>(), release = deferred<void>(), reason = Proxy.revocable({}, {}); reason.revoke();
	let work: Promise<void> | undefined;
	try {
		await owner.open();
		work = owner.withOriginalFrame(async frame => { entered.resolve(); await release.promise; assert.ok(frame.pixels.some(value => value !== 0)); });
		const outcome = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		await entered.promise; stop.abort(reason.proxy);
		const closing = owner.cancelAndJoin(); assert.equal(owner.cancelAndJoin(), closing); assert.equal(await remainsPending(closing), true);
		assert.ok(f.borrowed.at(-1)?.some(value => value !== 0)); release.resolve();
		const result = await outcome; assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, reason.proxy), true);
		await closing; assert.ok(f.borrowed.every(pixels => pixels.every(value => value === 0)));
		assert.deepEqual(new Uint8Array(await f.body.arrayBuffer()), f.bytes);
	} finally { release.resolve(); if (work) await Promise.allSettled([work]); await owner.cancelAndJoin(); await f.workers.close(); }
});

test('Current pre-abort rejects before any malformed Original metadata is reflected', () => {
	const stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy);
	let probes = 0;
	const never: authoring.WithImageRepairSpotsOriginalFrameV1 = () => Promise.reject(new Error('Pre-aborted Original acquired.'));
	const options = Object.defineProperty({ withOriginalFrame: never, develop: defaultImageDevelopStateV2(), isCurrent: () => true, signal: stop.signal },
		'withOriginalFrame', { enumerable: true, get() { probes++; throw new Error('Original getter'); } });
	let error: unknown;
	try { new authoring.ImageRepairSpotsAuthoringCurrentV1(options); } catch (reason) { error = reason; }
	assert.equal(Object.is(error, reason.proxy), true); assert.equal(probes, 0);
});
