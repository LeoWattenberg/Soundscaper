/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openFramescaperCurrentImageFrameSource } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { prepareFramescaperRawImageWorkingCurrentV1 } from '../src/framescaper/internal/timeline-image-raw-working-plan-current-v1.ts';
import { framescaperEditableImageWorkingBytes } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function displayWord(word: number): number {
	return displayLinear(Math.fround(word / 65535));
}
function displayLinear(linear: number): number {
	const value = Math.max(0, Math.min(1, linear));
	return Math.round(255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055));
}

test('actual Current Frame reader borrows authenticated oriented RAW words and delivers developed display after its production worker retires', { timeout: 20_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1({ orientation: 6 });
	try { await f.withDefaultTransport(async () => {
		const store = { async loadMediaAsset(key: string) {
			assert.equal(this, store); assert.equal(key, f.source.storageKey);
			return f.body;
		} };
		const reader = await openFramescaperCurrentImageFrameSource(store, f.source);
		try {
			assert.equal(reader.timings.length, 1); assert.equal(reader.frameIndexAtTicks(0n), 0);
			await reader.withCanonicalFrame(async frame => {
				assert.deepEqual(frame.descriptor, f.native.descriptor); assert.ok(frame.pixels instanceof Uint16Array);
				assert.deepEqual([...frame.pixels], f.native.words); assert.equal(f.workers.active(), 0);
				assert.equal(f.workers.statistics.created, f.workers.statistics.joined);
				await Promise.resolve(); assert.deepEqual([...frame.pixels], f.native.words);
			});
			const output = await reader.readFrame(0);
			try { assert.deepEqual([...output], f.native.words.map((word, index) => index % 4 === 3 ? 255 : displayWord(word)));
				assert.equal(f.workers.active(), 0); assert.equal(f.workers.statistics.created, f.workers.statistics.joined);
			} finally { output.fill(0); }
			const original = await reader.readOriginal(); try { assert.deepEqual(original, f.original); } finally { original.fill(0); }
			assert.deepEqual(new Uint8Array(await f.body.arrayBuffer()), f.pack.bytes);
		} finally { await reader.closeAndJoin(); }
	}); } finally { await f.close(); }
});

test('RAW Frame cache has no Develop authority: actual Clone, mirror, WB and exposure use native words before final display', { timeout: 20_000 }, async () => {
	const base = defaultImageDevelopStateV2(), develop = normalizeImageDevelopStateCurrentV1({ ...base, processVersion: 3,
		geometry: { ...base.geometry, flipHorizontal: true }, repairs: { schemaVersion: 1, spots: [{ id: 'native-clone', mode: 'clone', enabled: true,
			target: { x: 24.5 / 32, y: 24.5 / 32 }, source: { x: 8.5 / 32, y: 24.5 / 32 }, radius: .0125, feather: 0, opacity: 1 }] },
		effects: [{ id: 'wb', type: 'white-balance-v1', enabled: true, params: { temperature: 100, tint: 0 } },
			{ id: 'exposure', type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } }] });
	const f = await createRawFrameFixtureCurrentV1({ develop, orientation: 8 });
	try { await f.withDefaultTransport(async () => {
		const wrongCache = Uint8Array.from({ length: 32 * 32 * 4 }, (_, index) => index % 4 === 3 || index % 4 === 0 ? 255 : 0);
		const pack = createFramescaperImageFramePackV1({ original: f.original, receipt: { schemaVersion: 1, kind: 'raw-original', raw: f.raw },
			width: 32, height: 32, timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: wrongCache }] });
		const source = { ...f.source, contentSha256: pack.contentSha256, assetByteLength: pack.assetByteLength, conversionReceiptSha256: pack.conversionReceiptSha256 };
		const reader = await openFramescaperCurrentImageFrameSource({ loadMediaAsset: async () => new Blob([new Uint8Array(pack.bytes)]) }, source);
		try {
			const expected: number[] = [];
			for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
				const originalX = 31 - x, donorX = originalX === 24 && y === 24 ? 8 : originalX;
				for (let c = 0; c < 3; c++) {
					const native = Math.fround(f.native.words[(y * 32 + donorX) * 4 + c]! / 65535);
					const balanced = Math.fround(native * [2, 1, .5][c]!);
					expected.push(displayLinear(Math.fround(balanced * .5)));
				} expected.push(255);
			}
			const output = await reader.readFrame(0);
			try { assert.deepEqual([...output], expected); assert.notDeepEqual(output, wrongCache); assert.equal(f.workers.active(), 0); }
			finally { output.fill(0); }
		} finally { await reader.closeAndJoin(); }
	}); } finally { await f.close(); }
});

test('RAW reader Close seals synchronously and joins a held native callback before native words are wiped', { timeout: 20_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1(), entered = deferred<void>(), release = deferred<void>();
	try { await f.withDefaultTransport(async () => {
		const reader = await openFramescaperCurrentImageFrameSource({ loadMediaAsset: async () => f.body }, f.source);
		let held: Uint16Array | undefined;
		const work = reader.withCanonicalFrame(async frame => { assert.ok(frame.pixels instanceof Uint16Array); held = frame.pixels;
			assert.equal(f.workers.active(), 0); entered.resolve(); await release.promise; assert.deepEqual([...frame.pixels], f.native.words); });
		void work.catch(() => undefined);
		try { await entered.promise; const close = reader.closeAndJoin(); assert.equal(await remainsPending(close), true);
			await assert.rejects(reader.readFrame(0), /closed|retired/iu); release.resolve(); await assert.rejects(work, /retired/iu); await close;
			assert.ok(held!.every(word => word === 0)); assert.equal(f.workers.active(), 0);
		} finally { release.resolve(); await Promise.allSettled([work, reader.closeAndJoin()]); }
	}); } finally { release.resolve(); await f.close(); }
});

test('RAW reader propagates an exact opaque cancellation only after the accepted native consumer retires', { timeout: 20_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('raw-word-cancel');
	try { await f.withDefaultTransport(async () => {
		const reader = await openFramescaperCurrentImageFrameSource({ loadMediaAsset: async () => f.body }, f.source); let held: Uint16Array | undefined;
		const work = reader.withCanonicalFrame(async frame => { assert.ok(frame.pixels instanceof Uint16Array); held = frame.pixels; entered.resolve(); await release.promise; }, stop.signal)
			.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		try { await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); release.resolve(); const outcome = await work;
			assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(Object.is(outcome.error, reason), true); assert.ok(held!.every(word => word === 0));
		} finally { release.resolve(); await work; await reader.closeAndJoin(); }
	}); } finally { release.resolve(); await f.close(); }
});

test('RAW Frame metadata reserves the maximum native output, rejects oversized resident packs before loading, and never invokes planning-only resource ports', { timeout: 20_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1();
	try {
		const plan = prepareFramescaperRawImageWorkingCurrentV1(f.source);
		assert.ok(plan.decodePeakBytes >= 672n * 1024n * 1024n + 3n * BigInt(f.source.assetByteLength));
		assert.equal(plan.maximumWorkingBytes, 1024 * 1024 * 1024); assert.equal(framescaperEditableImageWorkingBytes(f.source), plan.recipeWorkingBytes);
		let loads = 0; await assert.rejects(openFramescaperCurrentImageFrameSource({ async loadMediaAsset() { loads++; return f.body; } },
			{ ...f.source, assetByteLength: 128 * 1024 * 1024 }), /1 GiB/u); assert.equal(loads, 0);
		const gradient = normalizeImageDevelopStateCurrentV1({ ...f.source.develop, effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: .5 } }],
			masks: [{ schemaVersion: 2, id: 'gradient', name: 'Native local', kind: 'matte', inputs: [], nodes: [{ id: 'ramp', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'ramp' }],
			maskBindings: [{ maskId: 'gradient', effectId: 'tone' }] });
		const masked = prepareFramescaperRawImageWorkingCurrentV1(f.source, { develop: gradient, maskOverlay: { maskId: 'gradient', effectId: 'tone' } });
		assert.equal(masked.descriptor.sampleFormat, 'float32'); assert.ok(masked.renderPeakBytes > 0n);
	} finally { await f.close(); }
});
