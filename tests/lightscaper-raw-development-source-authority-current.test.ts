/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compilePinnedLibRawRecoveryModuleV2 } from '../src/common/editor/raw/libraw-runtime-asset-v2.ts';
import { withDecodedRawRecoveryFrameV2 } from '../src/common/editor/raw/libraw-runtime-v2.ts';
import { assertRawRecoveryFrameAuthorityV1 } from '../src/common/editor/raw/internal/raw-recovery-frame-authority-v1.ts';
import { prepareImageDevelopRawSourceCurrentV1 } from '../src/common/editor/imaging/image-develop-raw-source-current-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { setImageDevelopRawDevelopmentCurrentV1 } from '../src/common/editor/imaging/image-develop-raw-development-current-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { rawRecoveryDngFixtureV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { rawRecoveryWorkerFixtureV2 } from './helpers/lightscaper-raw-recovery-worker-current-fixture.ts';

const bytes = rawRecoveryDngFixtureV1().bytes;
const module = readFile(new URL('../runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm', import.meta.url))
	.then(value => compilePinnedLibRawRecoveryModuleV2(new Uint8Array(value)));

test('only the active real fixed-profile RAW lease authorizes a matching source-processing projection', async () => {
	for (const [mode, profile] of [['headroom', 'linear-headroom-v1'], ['recovery', 'highlight-recovery-v1']] as const) {
		const workers = await rawRecoveryWorkerFixtureV2(); let held: PixelFrameV1 | undefined;
		const develop = setImageDevelopRawDevelopmentCurrentV1(defaultImageDevelopStateV1(), { schemaVersion: 1, mode });
		try {
			await withDecodedRawRecoveryFrameV2({ bytes, profile }, view => {
				assert.equal(workers.active(), 0); held = view.frame;
				assert.doesNotThrow(() => assertRawRecoveryFrameAuthorityV1(view.frame, profile));
				const normalizedWrapper = { descriptor: { ...view.frame.descriptor }, pixels: view.frame.pixels };
				assert.doesNotThrow(() => assertRawRecoveryFrameAuthorityV1(normalizedWrapper, profile));
				const projected = prepareImageDevelopRawSourceCurrentV1(develop, normalizedWrapper);
				assert.equal(projected.processVersion, 3); assert.deepEqual(projected.effects, develop.effects);
				assert.deepEqual(projected.masks, develop.masks); assert.deepEqual(projected.geometry, develop.geometry);
				assert.equal(Object.hasOwn(projected, 'rawDevelopment'), false); assert.equal(develop.processVersion, 4);
				assert.throws(() => assertRawRecoveryFrameAuthorityV1(view.frame, profile === 'linear-headroom-v1' ? 'highlight-recovery-v1' : 'linear-headroom-v1'));
				assert.throws(() => assertRawRecoveryFrameAuthorityV1({ ...view.frame, pixels: view.frame.pixels.slice() }, profile));
				assert.throws(() => assertRawRecoveryFrameAuthorityV1({ ...view.frame, descriptor: { ...view.frame.descriptor, width: 16 } }, profile));
			}, { loadModule: () => module, createWorker: workers.createWorker });
			assert.ok(held); assert.throws(() => assertRawRecoveryFrameAuthorityV1(held, profile));
			assert.throws(() => prepareImageDevelopRawSourceCurrentV1(develop, held));
		} finally { await workers.close(); }
	}
});

test('metadata and copied Float32 samples cannot claim native RAW reconstruction', () => {
	const pixels = new Float32Array(16 * 16 * 4); for (let index = 3; index < pixels.length; index += 4) pixels[index] = 1;
	const frame = { descriptor: { schemaVersion: 1, width: 16, height: 16, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels };
	for (const mode of ['headroom', 'recovery'] as const) {
		const develop = setImageDevelopRawDevelopmentCurrentV1(defaultImageDevelopStateV1(), { schemaVersion: 1, mode });
		assert.throws(() => prepareImageDevelopRawSourceCurrentV1(develop, frame));
	}
	let inspected = 0;
	const hostileFrame = new Proxy({}, { getOwnPropertyDescriptor() { inspected++; throw new Error('Malformed recipe must be refused first.'); } });
	assert.throws(() => prepareImageDevelopRawSourceCurrentV1({ processVersion: 4, rawDevelopment: { schemaVersion: 1, mode: 'future' } }, hostileFrame));
	assert.equal(inspected, 0);
});

test('canonical source selection preserves legacy admission and privately projects all process4 repair metadata', () => {
	const old = defaultImageDevelopStateV1(); assert.deepEqual(prepareImageDevelopRawSourceCurrentV1(old, null), old);
	const fourth = setImageDevelopRawDevelopmentCurrentV1(setImageDevelopRawDevelopmentCurrentV1(old, { schemaVersion: 1, mode: 'recovery' }), { schemaVersion: 1, mode: 'canonical' });
	assert.equal(fourth.processVersion, 4);
	const projection = prepareImageDevelopRawSourceCurrentV1(fourth, null);
	assert.equal(projection.processVersion, 3); assert.deepEqual(projection.effects, fourth.effects);
	assert.deepEqual(projection.geometry, fourth.geometry); assert.equal(Object.hasOwn(projection, 'rawDevelopment'), false);
});
