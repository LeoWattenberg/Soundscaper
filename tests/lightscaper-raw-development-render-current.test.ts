/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compilePinnedLibRawRecoveryModuleV2 } from '../src/common/editor/raw/libraw-runtime-asset-v2.ts';
import { withDecodedRawRecoveryFrameV2 } from '../src/common/editor/raw/libraw-runtime-v2.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { setImageDevelopRawDevelopmentCurrentV1 } from '../src/common/editor/imaging/image-develop-raw-development-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { withImageDevelopFrameCurrentV1 } from '../src/common/editor/imaging/image-develop-frame-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { rawRecoveryDngFixtureV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { rawRecoveryWorkerFixtureV2 } from './helpers/lightscaper-raw-recovery-worker-current-fixture.ts';
import { readPixelFrameV1, type PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const module = readFile(new URL('../runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm', import.meta.url))
	.then(bytes => compilePinnedLibRawRecoveryModuleV2(new Uint8Array(bytes)));
function develop(mode: 'headroom' | 'recovery') {
	return setImageDevelopRawDevelopmentCurrentV1(defaultImageDevelopStateV1(), { schemaVersion: 1, mode });
}
function canonicalFourth() {
	return setImageDevelopRawDevelopmentCurrentV1(develop('recovery'), { schemaVersion: 1, mode: 'canonical' });
}
function bytes(frame: Readonly<PixelFrameV1>) {
	return new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength);
}

test('actual RAW profiles reach Current full, proxy and direct linear evaluation while preserving their finite native samples', async () => {
	for (const [mode, profile] of [['headroom', 'linear-headroom-v1'], ['recovery', 'highlight-recovery-v1']] as const) {
		const workers = await rawRecoveryWorkerFixtureV2(), recipe = develop(mode), runtime = createPhotoDevelopRenderRuntimeCurrentV1();
		const serialized = JSON.stringify(recipe), stop = new AbortController();
		try {
			await withDecodedRawRecoveryFrameV2({ bytes: rawRecoveryDngFixtureV1({ variant: 'color-canary' }).bytes, profile }, async source => {
				const original = bytes(source.frame).slice(); let rendered: Uint8Array | undefined;
				const compare = (frame: Readonly<PixelFrameV1>) => {
					assert.equal(frame.descriptor.sampleFormat, 'float32'); assert.deepEqual(frame.descriptor, source.frame.descriptor);
					assert.deepEqual(bytes(frame), original); rendered = bytes(frame); return mode;
				};
				assert.equal(await runtime.withFullResolution({ frame: source.frame, develop: recipe, signal: stop.signal }, view => compare(view.frame)), mode);
				assert.ok(rendered?.every(value => value === 0));
				assert.equal(await runtime.withProxy({ frame: source.frame, develop: recipe, signal: stop.signal }, view => compare(view.frame)), mode);
				assert.ok(rendered?.every(value => value === 0));
				assert.equal(await withImageDevelopLinearCurrentV1({ frame: source.frame, develop: recipe, signal: stop.signal }, compare, PHOTO_DEVELOP_LINEAR_LIMITS_V1), mode);
				assert.ok(rendered?.every(value => value === 0)); assert.deepEqual(bytes(source.frame), original);
				assert.equal(JSON.stringify(recipe), serialized); assert.equal(recipe.processVersion, 4);
			}, { loadModule: () => module, createWorker: workers.createWorker });
		} finally { await workers.close(); }
	}
});

test('Current computational admission rejects forged, expired and mismatched RAW leases while permanent V3 refuses the saved successor', async () => {
	const workers = await rawRecoveryWorkerFixtureV2(), runtime = createPhotoDevelopRenderRuntimeCurrentV1(), permanent = createPhotoDevelopRenderRuntimeV3();
	const recipe = develop('headroom'), signal = new AbortController().signal;
	let expired: Readonly<PixelFrameV1> | undefined;
	try {
		await withDecodedRawRecoveryFrameV2({ bytes: rawRecoveryDngFixtureV1().bytes, profile: 'linear-headroom-v1' }, async view => {
			expired = view.frame;
			for (const frame of [{ ...view.frame, pixels: view.frame.pixels.slice() }, view.frame]) {
				const selected = frame === view.frame ? develop('recovery') : recipe;
				await assert.rejects(runtime.withFullResolution({ frame, develop: selected, signal }, () => assert.fail('Unproven source reached rendering.')));
				await assert.rejects(runtime.withProxy({ frame, develop: selected, signal }, () => assert.fail('Unproven source reached proxy sampling.')));
			}
			// @ts-expect-error Permanent V3 must refuse process4 at runtime as well.
			await assert.rejects(permanent.withFullResolution({ frame: view.frame, develop: recipe, signal }, () => assert.fail('Permanent V3 widened its recipe policy.')));
		}, { loadModule: () => module, createWorker: workers.createWorker });
		assert.ok(expired);
		await assert.rejects(runtime.withFullResolution({ frame: expired, develop: recipe, signal }, () => assert.fail('Expired source reached rendering.')));
	} finally { await workers.close(); }
});

test('canonical process4 remains byte-exact through Current full, proxy and direct byte rendering without widening permanent V3', async () => {
	const frame: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
		pixels: new Uint8Array([1, 2, 3, 255, 149, 101, 72, 255]) };
	const original = bytes(frame).slice(), recipe = canonicalFourth(), signal = new AbortController().signal;
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1(); let backing: Uint8Array | undefined;
	const compare = (actual: Readonly<PixelFrameV1>) => { assert.deepEqual(bytes(actual), original); backing = bytes(actual); return 'canonical'; };
	assert.equal(await runtime.withFullResolution({ frame, develop: recipe, signal }, view => compare(view.frame)), 'canonical');
	assert.ok(backing?.every(value => value === 0));
	assert.equal(await runtime.withProxy({ frame, develop: recipe, signal }, view => compare(view.frame)), 'canonical');
	assert.ok(backing?.every(value => value === 0));
	assert.equal(await withImageDevelopFrameCurrentV1({ frame, develop: recipe, signal, maskOverlay: undefined }, view => compare(readPixelFrameV1(view.frame, PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.render)), PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1), 'canonical');
	assert.ok(backing?.every(value => value === 0)); assert.deepEqual(bytes(frame), original);
});

test('RAW rendering joins held consumption on opaque cancellation and wipes output before the native source scope settles', async () => {
	const workers = await rawRecoveryWorkerFixtureV2(), runtime = createPhotoDevelopRenderRuntimeCurrentV1(), stop = new AbortController();
	const entered = deferred<void>(), release = deferred<void>(), reason = Symbol('recovery-render-cancel');
	let output: Uint8Array | undefined, original: Uint8Array | undefined;
	const work = withDecodedRawRecoveryFrameV2({ bytes: rawRecoveryDngFixtureV1().bytes, profile: 'highlight-recovery-v1' }, async view => {
		original = bytes(view.frame);
		return runtime.withFullResolution({ frame: view.frame, develop: develop('recovery'), signal: stop.signal }, async rendered => {
			output = bytes(rendered.frame); entered.resolve(); await release.promise; return 'held';
		});
	}, { loadModule: () => module, createWorker: workers.createWorker });
	const settled = work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await Promise.race([entered.promise, work.then(() => assert.fail('No held output.'), (error: unknown) => { throw error; })]);
		stop.abort(reason); assert.equal(await remainsPending(work), true); assert.ok(output?.some(value => value !== 0));
		release.resolve(); const result = await settled; assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, reason);
		assert.ok(output?.every(value => value === 0)); assert.ok(original?.every(value => value === 0));
	} finally { release.resolve(); await settled; await workers.close(); }
});
