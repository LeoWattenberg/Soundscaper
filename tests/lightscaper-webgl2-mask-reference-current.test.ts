/* SPDX-License-Identifier: AGPL-3.0-only */
// Normative CPU replay and proof transport; native GL execution is covered separately.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { prepareLinearDevelopMetadataCurrentV1 as prepareMetadata } from '../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { preparePixelFrameWebGl2MaskPlanCurrentV1 as preparePlan } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-plan-current-v1.ts';
import { replayPixelFrameWebGl2MaskReferenceCurrentV1 as replay } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-reference-current-v1.ts';
import { withPixelFrameWebGl2MaskReceiptsCurrentV1 as withReceipts, capturePixelFrameWebGl2MaskCheckpointCurrentV1 as capture,
	capturePixelFrameWebGl2MaskOverlayCurrentV1 as captureOverlay, sealPixelFrameWebGl2MaskCheckpointsCurrentV1 as seal,
	finishPixelFrameWebGl2MaskCheckpointsCurrentV1 as finish } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-checkpoint-current-v1.ts';
import { withPixelFrameWebGl2LutsCurrentV1, type PixelFrameWebGl2LutResourcesCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-lut-current-v1.ts';
import { LinearDevelopOwnerV1 } from '../src/common/editor/imaging/image-develop-linear-owner-v1.ts';
import { withImageDevelopLinearCurrentV1 as cpu } from '../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { validatePixelFrameWebGl2MaskedReferenceCurrentV1 as validate } from '../src/common/editor/imaging/pixel-frame-webgl2-reference-current-v1.ts';
import { withPreparedBrushMaskResourceV1, type PreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { withMaskRasterSourceScopeV1, type MaskRasterSourceScopeV1 } from '../src/common/editor/imaging/mask-raster-source-scope-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';

const gradient = { id: 'range', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
const extent = (value: Readonly<{ width: number; height: number }>) => ({ width: value.width, height: value.height });
const frame = (width: number, height: number, values: ArrayLike<number>) => ({ descriptor: { schemaVersion: 1 as const, width, height,
	sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels: Float32Array.from(values) });
function recipe(effects: readonly unknown[], bindings: readonly string[], node: unknown = gradient) {
	return { ...defaultImageDevelopStateV2(), effects, masks: [{ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [], nodes: [node], outputNodeId: 'range' }],
		maskBindings: bindings.map(effectId => ({ effectId, maskId: 'local' })) };
}
class CountingOwner extends LinearDevelopOwnerV1 {
	readonly allocated: Float32Array<ArrayBuffer>[] = [];
	override floats(length: number): Float32Array<ArrayBuffer> { const values = super.floats(length); this.allocated.push(values); return values; }
}
async function run(metadata: ReturnType<typeof prepareMetadata>, source: Float32Array<ArrayBuffer>, coverages: readonly Uint8Array<ArrayBuffer>[],
	overlay?: Uint8Array<ArrayBuffer>, resources?: Readonly<PixelFrameWebGl2LutResourcesCurrentV1>, preparedPlan = preparePlan(metadata), maskScope?: Readonly<MaskRasterSourceScopeV1>) {
	const plan = preparedPlan, owner = new CountingOwner(0, 2 * plan.maximumFrameBytes), before = source.slice();
	const output = await withReceipts(plan, async receipts => {
		for (const c of plan.executedCheckpoints) await capture(receipts, c, extent(c), (top, rows, target) => {
			target.set(coverages[c.executionIndex!]!.subarray(top * c.width, (top + rows) * c.width));
		});
		if (overlay) await captureOverlay(receipts, plan.executedCheckpoints[plan.selectedExecutionIndex!], extent(plan.finalDescriptor), (top, rows, target) => {
			target.set(overlay.subarray(top * plan.finalDescriptor.width, (top + rows) * plan.finalDescriptor.width));
		});
		seal(receipts);
		return owner.run(async () => {
			const pixels = owner.floats(source.length); pixels.set(source);
			const result = await replay(plan, { descriptor: plan.sourceDescriptor, pixels }, owner, receipts, () => {}, resources, maskScope);
			return { pixels: result.pixels.slice(), descriptor: result.descriptor, matched: finish(receipts) };
		});
	});
	assert.deepEqual(source, before); assert.ok(owner.allocated.every(values => values.every(value => value === 0)));
	return { ...output, allocations: owner.allocated.length };
}

test('bound pointwise candidate never mutates incoming before native range coverage', async () => {
	const source = frame(1, 1, [.25, .25, .25, .375]);
	const develop = recipe([createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })], ['tone'],
		{ id: 'range', kind: 'luminance-range', lower: .3, upper: .6, falloff: 0 });
	const metadata = prepareMetadata({ frame: source, develop }, PROFILE, {}), output = await run(metadata, source.pixels, [Uint8Array.of(0)]);
	assert.equal(output.matched, true); assert.deepEqual(output.pixels, source.pixels); assert.equal(output.allocations, 2);
	// Mutating A to candidate .5 first would incorrectly enter the range.
});

test('bound color stages store Float32 before the next stage rather than fusing inverse exposures', async () => {
	const source = frame(1, 1, [2 ** -149, -(2 ** -149), .25, 1]);
	const effects = [createVideoEffect('tone-ladder-v1', { id: 'down', params: { exposure: -1 } }),
		createVideoEffect('tone-ladder-v1', { id: 'up', params: { exposure: 1 } })];
	const develop = recipe(effects, ['down', 'up'], { id: 'range', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 });
	const metadata = prepareMetadata({ frame: source, develop }, PROFILE, {}), output = await run(metadata, source.pixels, [Uint8Array.of(255), Uint8Array.of(255)]);
	const expected = await cpu({ frame: source, develop }, result => result.pixels.slice(), PROFILE);
	assert.equal(output.matched, true); assert.deepEqual(output.pixels, expected);
	assert.deepEqual([...output.pixels], [0, 0, .25, 1]); assert.equal(output.allocations, 3);
});

test('selected disabled and neutral slots observe exact incoming coverage without candidate allocation', async () => {
	for (const enabled of [false, true]) {
		const source = frame(1, 1, [-0, .25, .75, .5]);
		const develop = recipe([createVideoEffect('tone-ladder-v1', { id: 'tone', enabled })], ['tone']);
		const metadata = prepareMetadata({ frame: source, develop, maskOverlay: { maskId: 'local', effectId: 'tone' } }, PROFILE, {});
		const output = await run(metadata, source.pixels, [Uint8Array.of(128)], Uint8Array.of(128));
		assert.equal(output.matched, true); assert.deepEqual(output.pixels, source.pixels); assert.equal(output.allocations, 1);
		assert.ok(Object.is(output.pixels[0], -0));
	}
});

test('bound color → authenticated Double LUT keeps each candidate F32 boundary and noncommuting order', async () => {
	const bytes = new TextEncoder().encode('LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1');
	const sha256 = createHash('sha256').update(bytes).digest('hex'), reference = { storageKey: `lut-sha256:${sha256}`, sha256, byteLength: bytes.length,
		size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
	const source = frame(1, 1, [.125, .25, .375, .5]); let reads = 0, live = false;
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
		assert.equal(live, false); live = true; reads++; const owned = bytes.slice();
		try { return await consume(owned); } finally { owned.fill(0); live = false; }
	} };
	const effects = [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } }),
		createVideoEffectV2('cube-lut-profile-v1', { id: 'swap', params: { lut: reference } })];
	const metadata = prepareMetadata({ frame: source, develop: recipe(effects, ['tone', 'swap']) }, PROFILE, { source: port }), plan = preparePlan(metadata);
	await withPixelFrameWebGl2LutsCurrentV1(plan.passes.filter(pass => pass.kind === 8), port, async resources => {
		assert.equal(live, false, 'Source borrower retires before retained Double table is used.');
		const output = await run(metadata, source.pixels, [Uint8Array.of(128), Uint8Array.of(128)], undefined, resources, plan);
		const first = [.125, .25, .375].map(value => Math.fround(value + 128 / 255 * value));
		const expected = [Math.fround(first[0]! + 128 / 255 * (first[2]! - first[0]!)), first[1]!,
			Math.fround(first[2]! + 128 / 255 * (first[0]! - first[2]!)), .5];
		assert.equal(output.matched, true); assert.deepEqual([...output.pixels], expected); assert.equal(output.allocations, 3);
	}); assert.equal(reads, 1);
});

test('native maskable spatial and optics stages replay through the unchanged Current CPU authority', async () => {
	const cases = [ ['detail-sharpen-v1', { amount: 50, threshold: 0 }], ['clarity-v1', { amount: 25 }],
		['noise-reduction-v1', { luminance: 25, color: 40 }], ['grain-v1', { amount: 25, seed: 417 }],
		['texture-v1', { amount: -25 }], ['dehaze-v1', { amount: 25 }], ['post-crop-vignette-v1', { amount: -30 }],
		['chromatic-aberration-v1', { red: -100, blue: 0 }], ['defringe-v1', { purple: 100 }], ['optical-vignette-v1', { amount: 50 }] ] as const;
	const source = frame(3, 3, Array.from({ length: 9 }, (_, index) => [index / 16 - .125, index % 2 ? .25 : .5, 1 + index / 8, index === 8 ? 0 : .5]).flat());
	for (const [type, params] of cases) {
		const develop = recipe([createVideoEffect(type, { id: 'local-effect', params })], ['local-effect']);
		const expected = await cpu({ frame: source, develop }, result => result.pixels.slice(), PROFILE);
		const metadata = prepareMetadata({ frame: source, develop }, PROFILE, {}), output = await run(metadata, source.pixels, [Uint8Array.of(43, 128, 213, 43, 128, 213, 43, 128, 213)]);
		assert.equal(output.matched, true, type); assert.deepEqual(output.pixels, expected, type);
		assert.equal(output.allocations, 2, 'One incoming and one candidate, including a neighborhood stage.');
	}
});

test('selected incoming byte overlay stores after EACH later lens warp rather than at the end', async () => {
	const source = frame(3, 1, [.25, .5, .75, 1, .25, .5, .75, 1, .25, .5, .75, 1]);
	const effects = [createVideoEffect('tone-ladder-v1', { id: 'selected', enabled: false }),
		createVideoEffect('lens-distortion-v1', { id: 'lens-first', params: { amount: 52.083333333333336 } }),
		createVideoEffect('lens-distortion-v1', { id: 'lens-last', params: { amount: 52.083333333333336 } })];
	const metadata = prepareMetadata({ frame: source, develop: recipe(effects, ['selected']), maskOverlay: { maskId: 'local', effectId: 'selected' } }, PROFILE, {});
	// k=5/32, border displacement1/16; 213→round(199.6875)=200→round(187.5)=188.
	// A single final quantization would instead give round(213*(15/16)^2)=187.
	const correct = await run(metadata, source.pixels, [Uint8Array.of(43, 128, 213)], Uint8Array.of(38, 128, 188));
	assert.equal(correct.matched, true); assert.equal(correct.allocations, 3);
	const fused = await run(metadata, source.pixels, [Uint8Array.of(43, 128, 213)], Uint8Array.of(38, 128, 187));
	assert.equal(fused.matched, false);
});


test('selected coverage follows actual changing-extent geometry → lens → flip suffix in authored order', async () => {
	const source = frame(3, 1, [.25, .5, .75, 1, .25, .5, .75, 1, .25, .5, .75, 1]);
	const effects = [createVideoEffect('tone-ladder-v1', { id: 'selected', enabled: false }),
		createVideoEffect('develop-geometry-v1', { id: 'clockwise', params: { rotationDegrees: 90 } }),
		createVideoEffect('lens-distortion-v1', { id: 'lens', params: { amount: 52.083333333333336 } }),
		createVideoEffect('develop-geometry-v1', { id: 'vertical-flip', params: { flipVertical: 1 } })];
	const metadata = prepareMetadata({ frame: source, develop: recipe(effects, ['selected']), maskOverlay: { maskId: 'local', effectId: 'selected' } }, PROFILE, {});
	// CW maps3×1 to1×3; outward lens attenuates end bytes43/213 to40/200;
	// final vertical flip reverses the three rows, preserving final extent1×3.
	const output = await run(metadata, source.pixels, [Uint8Array.of(43, 128, 213)], Uint8Array.of(200, 128, 40));
	assert.equal(output.matched, true); assert.deepEqual(extent(output.descriptor), { width: 1, height: 3 });
	assert.equal(output.allocations, 4);
});

test('all declared brush bodies authenticate and retire serially before any GPU/reference sentinel, including unused declarations', async () => {
	const bodies: Readonly<PreparedBrushMaskResourceV1>[] = [];
	for (const amount of [64, 192]) bodies.push(await withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(amount) }, prepared => ({ reference: prepared.reference, bytes: prepared.bytes.slice() })));
	for (const fault of ['none', 'unbound-corrupt', 'source-cleanup']) {
		let active = false, consumed = 0; const events: string[] = [], borrowed: Uint8Array<ArrayBuffer>[] = [];
		const reason = Proxy.revocable({}, {}); reason.revoke();
		const port: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
			assert.equal(this, port); assert.equal(active, false); active = true; events.push(`read:${reference.storageKey}`);
			const body = bodies.find(body => body.reference.storageKey === reference.storageKey); assert.ok(body);
			const bytes = body.bytes.slice(); borrowed.push(bytes);
			if (fault === 'unbound-corrupt' && body === bodies[1]) bytes[16] = bytes[16]! ^ 1;
			try { const result = await consume(bytes); if (fault === 'source-cleanup') throw reason.proxy; return result; }
			finally { bytes.fill(0); active = false; events.push(`retired:${reference.storageKey}`); }
		} };
		const source = frame(1, 1, [.125, .25, .5, 1]);
		const develop = recipe([createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })], ['tone']);
		const graph = develop.masks[0]!;
		const capturedDevelop = { ...develop, masks: [
			{ ...graph, inputs: [{ name: 'unused-bound-input', sourceRef: bodies[0]!.reference.storageKey, kind: 'alpha' }] },
			{ ...graph, id: 'entirely-unbound', inputs: [{ name: 'unused-unbound-input', sourceRef: bodies[1]!.reference.storageKey, kind: 'alpha' }] } ] };
		const metadata = prepareMetadata({ frame: source, develop: capturedDevelop }, PROFILE, { maskSource: port });
		const outcome = await withMaskRasterSourceScopeV1(metadata.masks.references, metadata.masks.retainedStorageKeys, port, async scope => {
			consumed++; assert.equal(active, false); assert.equal(events.length, 4);
			assert.ok(events[0]!.startsWith('read:') && events[1]!.startsWith('retired:') && events[2]!.startsWith('read:') && events[3]!.startsWith('retired:'));
			return run(metadata, source.pixels, [Uint8Array.of(128)], undefined, undefined, undefined, scope);
		}).then(result => ({ result }), (error: unknown) => ({ error }));
		assert.ok(borrowed.every(bytes => bytes.every(byte => byte === 0)));
		if (fault === 'none') { assert.ok('result' in outcome && outcome.result.matched); assert.equal(consumed, 1); }
		else { assert.equal(consumed, 0); assert.ok('error' in outcome); if (fault === 'source-cleanup') assert.ok(Object.is(outcome.error, reason.proxy)); }
	}
	for (const body of bodies) body.bytes.fill(0);
});


test('whole native masked validator requires byte proof even when the final image is exact', async () => {
	const source = frame(1, 1, [.25, .25, .25, .375]);
	const develop = recipe([createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })], ['tone'],
		{ id: 'range', kind: 'luminance-range', lower: .3, upper: .6, falloff: 0 });
	const p = preparePlan(prepareMetadata({ frame: source, develop }, PROFILE, {})), c = p.executedCheckpoints[0]!;
	for (const q of [0, 1]) {
		const matched = await withReceipts(p, async receipts => {
			await capture(receipts, c, extent(c), (_top, _rows, target) => { target[0] = q; }); seal(receipts);
			return validate(source, source, p, receipts, () => {});
		});
		assert.equal(matched, q === 0, 'One wrong coverage byte refuses an otherwise identical final image.');
	}
});

test('whole native masked validator completes all checkpoint proof before an early final-pixel mismatch', async () => {
	const source = frame(1, 1, [.125, .25, .5, .375]);
	const develop = recipe([createVideoEffect('tone-ladder-v1', { id: 'first', params: { exposure: 1 } }),
		createVideoEffect('tone-ladder-v1', { id: 'last', params: { exposure: -1 } })], ['first', 'last']);
	const p = preparePlan(prepareMetadata({ frame: source, develop }, PROFILE, {}));
	const wrong = frame(1, 1, [99, .25, .5, .375]);
	assert.equal(await withReceipts(p, async receipts => {
		for (const c of p.executedCheckpoints) await capture(receipts, c, extent(c), (_top, _rows, target) => { target[0] = 128; });
		seal(receipts); return validate(source, wrong, p, receipts, () => {});
	}), false, 'A numerical mismatch still closes the complete receipt protocol.');
});
