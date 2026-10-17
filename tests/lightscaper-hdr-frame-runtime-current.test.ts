/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openFramescaperCurrentImageFrameSource, framescaperEditableImageWorkingBytes } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { normalizeFramescaperImageSourceV4 } from '../src/common/editor/timeline-image-model-v4.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { hdrFrameFixtureCurrentV1, HDR_FRAME_SAMPLES, hdrFrameDisplay } from './helpers/lightscaper-hdr-frame-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { collectFramescaperImageProjectResourcesCurrentV1 } from '../src/common/editor/video-cube-lut-project-references-current-v1.ts';
import { IMAGE_DEVELOP_RESOURCE_REACHABILITY_LIMITS_CURRENT_V1 } from '../src/common/editor/imaging/image-develop-resource-reachability-current-v1.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';

test('Current Source5 reader develops authentic signed Float32 Original rather than its unrelated byte cache', async () => {
	const f = await hdrFrameFixtureCurrentV1({ ...defaultImageDevelopStateV2(), effects: [{ id: 'exposure', type: 'tone-ladder-v1', enabled: true, params: { exposure: -2 } }] });
	assert.equal(normalizeFramescaperImageSourceCurrentV1(f.source).schemaVersion, 5);
	assert.throws(() => normalizeFramescaperImageSourceV4(f.source));
	const reader = await openFramescaperCurrentImageFrameSource({ loadMediaAsset: async () => f.body }, f.source);
	let native: Float32Array | undefined;
	try {
		await reader.withCanonicalFrame(frame => { assert.ok(frame.pixels instanceof Float32Array); native = frame.pixels;
			assert.deepEqual([...frame.pixels], [...Float32Array.from(HDR_FRAME_SAMPLES)]); assert.ok(Object.is(frame.pixels[5], -0)); });
		assert.ok(native?.every(sample => sample === 0));
		const pixels = await reader.readFrame(0);
		try { assert.deepEqual([...pixels], HDR_FRAME_SAMPLES.map((sample, index) => index % 4 === 3 ? 255 : hdrFrameDisplay(Math.fround(sample * .25)))); }
		finally { pixels.fill(0); }
		const original = await reader.readOriginal(); try { assert.deepEqual(original, f.original); } finally { original.fill(0); }
		assert.deepEqual(new Uint8Array(await f.body.arrayBuffer()), f.pack.bytes);
	} finally { await reader.closeAndJoin(); }
});

test('Source5 reader Close and opaque abort join accepted float consumers before physical retirement', async () => {
	for (const mode of ['close', 'abort'] as const) {
		const f = await hdrFrameFixtureCurrentV1(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol(mode);
		const reader = await openFramescaperCurrentImageFrameSource({ loadMediaAsset: async () => f.body }, f.source);
		let pixels: Float32Array | undefined;
		const work = reader.withCanonicalFrame(async frame => { assert.ok(frame.pixels instanceof Float32Array); pixels = frame.pixels;
			entered.resolve(); await release.promise; assert.equal(pixels[0], 3); }, stop.signal).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		try {
			await entered.promise; const closing = mode === 'close' ? reader.closeAndJoin() : undefined;
			if (mode === 'abort') stop.abort(reason);
			assert.equal(await remainsPending(closing ?? work), true); release.resolve(); const result = await work; assert.equal(result.ok, false);
			if (!result.ok && mode === 'abort') assert.ok(Object.is(result.error, reason));
			await closing; assert.ok(pixels?.every(sample => sample === 0));
		} finally { release.resolve(); await work; await reader.closeAndJoin(); }
	}
});

test('Source5 phase admission rejects oversized resident packs before loading native bodies', async () => {
	const f = await hdrFrameFixtureCurrentV1(), source = { ...f.source, assetByteLength: 512 * 1024 * 1024 }; let reads = 0;
	assert.throws(() => framescaperEditableImageWorkingBytes(source), /working|bound|GiB/iu);
	await assert.rejects(openFramescaperCurrentImageFrameSource({ loadMediaAsset: async () => { reads++; return f.body; } }, source), /working|bound|GiB/iu);
	assert.equal(reads, 0);
});

test('Source5-only project closes clip LUTs under the combined Current resource capacity', async () => {
	const f = await hdrFrameFixtureCurrentV1(), count = IMAGE_DEVELOP_RESOURCE_REACHABILITY_LIMITS_CURRENT_V1.maximumReferences + 1;
	const effects = Array.from({ length: count }, (_, index) => {
		const sha256 = (index + 1).toString(16).padStart(64, '0');
		return { id: `disabled-${index}`, type: 'cube-lut-profile-v1', enabled: false,
			params: { lut: { storageKey: `lut-sha256:${sha256}`, sha256, byteLength: 73, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } };
	});
	assert.throws(() => collectFramescaperImageProjectResourcesCurrentV1({ sources: [f.source], clips: [{ videoEffects: effects }] }), /combined|capacity/iu);
});

test('Source5 cross-source closure refuses one brush SHA presented with conflicting physical geometry', async () => {
	const sha = 'a'.repeat(64), recipe = (width: number, height: number) => ({ ...defaultImageDevelopStateV2(), masks: [{ schemaVersion: 2 as const, id: 'paint', name: 'Paint', kind: 'matte' as const,
		inputs: [{ name: 'body', kind: 'alpha' as const, sourceRef: `brush-mask-v1:${width}:${height}:${sha}` }], nodes: [{ id: 'alpha', kind: 'alpha' as const, inputName: 'body' }], outputNodeId: 'alpha' }] });
	const first = await hdrFrameFixtureCurrentV1(recipe(1, 2)), second = await hdrFrameFixtureCurrentV1(recipe(2, 1));
	assert.throws(() => collectFramescaperImageProjectResourcesCurrentV1({ sources: [first.source, { ...second.source, id: 'second', storageKey: 'second' }] }), /conflicting|identity/iu);
});

test('Current Source5 native borrow refuses an honestly repacked Original whose native payload disagrees with the saved HDR receipt', async () => {
	const f = await hdrFrameFixtureCurrentV1(), original = f.original.slice(); original[original.length - 1]! ^= 1;
	const pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, kind: 'hdr-original', hdr: f.hdr }, width: 2, height: 1,
		timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: Uint8Array.of(0, 0, 0, 255, 0, 0, 0, 255) }] });
	const source = { ...f.source, contentSha256: pack.contentSha256, assetByteLength: pack.assetByteLength, conversionReceiptSha256: pack.conversionReceiptSha256,
		original: { ...f.source.original, sha256: pack.originalSha256 }, provenance: { ...f.source.provenance, original: { ...f.source.provenance.original, sha256: pack.originalSha256 } } };
	const reader = await openFramescaperCurrentImageFrameSource({ loadMediaAsset: async () => new Blob([new Uint8Array(pack.bytes)]) }, source); let consumed = false;
	try { await assert.rejects(reader.withCanonicalFrame(() => { consumed = true; }), /native|receipt|body/iu); assert.equal(consumed, false); }
	finally { await reader.closeAndJoin(); }
});
